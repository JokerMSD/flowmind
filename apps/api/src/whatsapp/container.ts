import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { ReminderOccurrenceRepository, ReminderRepository } from "@flowmind/agent-core";
import type { AgentRuntime, ReminderService } from "@flowmind/agent-runtime";
import {
  createDefaultChannelSettings,
  createWhatsAppPersonalConnectionSeed,
  WHATSAPP_CHANNEL_ID,
  WHATSAPP_PERSONAL_CONNECTION_ID,
} from "@flowmind/channel-core";
import type {
  ChannelConnection,
  ChannelConversation,
  ChannelMessage,
  ChannelSettings,
  ConversationMode,
} from "@flowmind/channel-core";
import { JsonChannelMemory } from "@flowmind/channel-memory";
import {
  ChannelProviderRegistry,
  ChannelRuntime,
  ConversationProcessor,
  SlidingWindowRateLimiter,
} from "@flowmind/channel-runtime";
import type { AgentRuntimePort } from "@flowmind/channel-runtime";
import { WhatsAppWebProvider } from "@flowmind/whatsapp-web";

import { conflict, notFound, unavailable, WhatsAppApiError } from "./errors.js";
import type {
  WhatsAppConnectionManagerPort,
  WhatsAppProviderFactory,
  WhatsAppProviderPort,
} from "./ports.js";
import { WhatsAppWebReminderDeliveryProvider } from "./reminder-delivery-provider.js";
import { WhatsAppReminderCommands } from "./reminder-commands.js";

export interface CreateWhatsAppContainerOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly storagePath: string;
  readonly agentRuntime: AgentRuntime;
  readonly reminderService: ReminderService;
  readonly reminders: ReminderRepository;
  readonly occurrences: ReminderOccurrenceRepository;
  readonly providerFactory?: WhatsAppProviderFactory;
  readonly now?: () => Date;
  readonly nextId?: () => string;
}

export interface ManualMessageInput {
  readonly conversationId: string;
  readonly content: string;
}

function hasContactDisplayName(conversation: ChannelConversation): boolean {
  const name = conversation.displayName?.trim();
  if (!name || name.endsWith("@lid") || /^\d+$/.test(name)) return false;
  return name !== conversation.externalConversationId;
}

export function createWhatsAppContainer(options: CreateWhatsAppContainerOptions) {
  const environment = options.environment ?? process.env;
  const now = options.now ?? (() => new Date());
  const nextId = options.nextId ?? randomUUID;
  const featureEnabled = environment.WHATSAPP_WEB_ENABLED === "true";
  const channelStoragePath = join(options.storagePath, "channels", "whatsapp");
  const memory = new JsonChannelMemory(channelStoragePath, {
    defaultSettings: createDefaultChannelSettings("csnf"),
  });
  const providers = new ChannelProviderRegistry();
  const provider = (
    options.providerFactory ?? ((providerOptions) => new WhatsAppWebProvider(providerOptions))
  )({
    authDirectory:
      environment.WHATSAPP_WEB_AUTH_PATH ??
      environment.FLOWMIND_WHATSAPP_AUTH_PATH ??
      join(options.storagePath, "whatsapp-web-auth"),
    now,
  });
  providers.register(provider);

  const clock = { now };
  const identifiers = { next: nextId };
  const rateLimiter = new SlidingWindowRateLimiter();
  const agentRuntimePort = mapAgentRuntimePort(
    options.agentRuntime,
    new WhatsAppReminderCommands(options.reminderService, options.reminders, now),
  );
  const processor = new ConversationProcessor({
    connections: memory.connections,
    conversations: memory.conversations,
    messages: memory.messages,
    externalMessages: memory.externalMessages,
    settings: memory.settings,
    providers,
    agents: agentRuntimePort,
    clock,
    identifiers,
    rateLimiter,
  });
  const runtime = new ChannelRuntime(memory.connections, providers, processor);
  const manager = new WhatsAppConnectionManager(memory, provider, runtime, featureEnabled, now);
  const reminderDelivery = new WhatsAppWebReminderDeliveryProvider({
    connections: memory.connections,
    conversations: memory.conversations,
    settings: memory.settings,
    providers,
    occurrences: options.occurrences,
    now,
  });

  async function initialize(): Promise<void> {
    if (!(await memory.connections.findById(WHATSAPP_PERSONAL_CONNECTION_ID))) {
      await memory.connections.save(createWhatsAppPersonalConnectionSeed(now().toISOString()));
    }
    await memory.settings.get();
    await memory.cleanup();
  }

  async function start(): Promise<void> {
    await initialize();
    if (featureEnabled) await runtime.start();
  }

  async function stop(): Promise<void> {
    await runtime.stop();
  }

  async function updateSettings(update: Partial<ChannelSettings>): Promise<ChannelSettings> {
    const current = await memory.settings.get();
    const next: ChannelSettings = {
      ...current,
      ...update,
      rateLimit: update.rateLimit ?? current.rateLimit,
    };
    await memory.settings.save(next);
    return next;
  }

  async function setConversationMode(
    conversationId: string,
    automationMode: ConversationMode,
  ): Promise<ChannelConversation> {
    const conversation = await requireConversation(memory, conversationId);
    const updated = {
      ...conversation,
      automationMode,
      updatedAt: now().toISOString(),
    };
    await memory.conversations.save(updated);
    return updated;
  }

  async function resetConversationSession(conversationId: string): Promise<ChannelConversation> {
    const conversation = await requireConversation(memory, conversationId);
    const { sessionId: _sessionId, ...withoutSession } = conversation;
    const updated: ChannelConversation = {
      ...withoutSession,
      updatedAt: now().toISOString(),
    };
    await memory.conversations.save(updated);
    return updated;
  }

  async function hydrateConversationIdentities(
    conversations: readonly ChannelConversation[],
  ): Promise<readonly ChannelConversation[]> {
    const resolveIdentity = provider.resolveConversationIdentity?.bind(provider);
    if (!resolveIdentity) return conversations;
    return Promise.all(
      conversations.map(async (conversation) => {
        if (
          hasContactDisplayName(conversation) &&
          typeof conversation.metadata.avatarUrl === "string"
        ) {
          return conversation;
        }
        try {
          const identity = await resolveIdentity(
            conversation.connectionId,
            conversation.externalConversationId,
            conversation.type,
            conversation.displayName,
          );
          if (!identity.displayName && !identity.avatarUrl) return conversation;
          const updated: ChannelConversation = {
            ...conversation,
            ...(identity.displayName === undefined ? {} : { displayName: identity.displayName }),
            metadata: {
              ...conversation.metadata,
              ...(identity.avatarUrl === undefined ? {} : { avatarUrl: identity.avatarUrl }),
            },
            updatedAt: now().toISOString(),
          };
          await memory.conversations.save(updated);
          return updated;
        } catch {
          return conversation;
        }
      }),
    );
  }

  async function sendManualMessage(input: ManualMessageInput): Promise<ChannelMessage> {
    const conversation = await requireConversation(memory, input.conversationId);
    if (conversation.type !== "private" || conversation.automationMode === "blocked") {
      throw conflict("Envio manual permitido apenas em conversas privadas nao bloqueadas.");
    }
    const [settings, connection] = await Promise.all([
      memory.settings.get(),
      memory.connections.findById(conversation.connectionId),
    ]);
    if (!settings.enabled) {
      throw conflict("O canal WhatsApp esta desativado.");
    }
    if (!connection || !connection.enabled || connection.status !== "connected") {
      throw conflict("A conexao WhatsApp nao esta pronta para envio.");
    }
    if (!rateLimiter.allow("global", settings.rateLimit.global, now())) {
      throw new WhatsAppRateLimitError();
    }

    const createdAt = now().toISOString();
    const pending: ChannelMessage = {
      id: nextId(),
      conversationId: conversation.id,
      connectionId: connection.id,
      direction: "outbound",
      content: input.content,
      status: "pending",
      createdAt,
    };
    await memory.messages.save(pending);
    try {
      const sent = await providers.resolve(connection.providerId).send({
        connectionId: connection.id,
        conversationAddress: {
          channelId: WHATSAPP_CHANNEL_ID,
          externalId: conversation.externalConversationId,
        },
        content: input.content,
      });
      const delivered: ChannelMessage = {
        ...pending,
        status: "sent",
        providerMessageId: sent.providerMessageId,
      };
      const { lastError: _lastError, ...conversationWithoutError } = conversation;
      await Promise.all([
        memory.messages.save(delivered),
        memory.conversations.save({
          ...conversationWithoutError,
          lastMessagePreview: input.content.slice(0, 120),
          lastMessageAt: sent.sentAt,
          lastOutboundAt: sent.sentAt,
          updatedAt: sent.sentAt,
        }),
      ]);
      return delivered;
    } catch {
      const failed: ChannelMessage = {
        ...pending,
        status: "failed",
        error: "Falha ao enviar mensagem pelo WhatsApp.",
      };
      await memory.messages.save(failed);
      throw unavailable("Nao foi possivel enviar a mensagem pelo WhatsApp.");
    }
  }

  return {
    agentRuntimePort,
    featureEnabled,
    initialize,
    hydrateConversationIdentities,
    manager,
    memory,
    processor,
    provider,
    providers,
    reminderDelivery,
    resetConversationSession,
    runtime,
    sendManualMessage,
    setConversationMode,
    start,
    stop,
    updateSettings,
  };
}

export type WhatsAppContainer = ReturnType<typeof createWhatsAppContainer>;

export function mapAgentRuntimePort(
  runtime: AgentRuntime,
  reminderCommands?: WhatsAppReminderCommands,
): AgentRuntimePort {
  return {
    chat: async (request) => {
      const result = await runtime.chat(request);
      const commandResponse = reminderCommands ? await reminderCommands.handle(request) : undefined;
      return {
        session: { id: result.session.id },
        message: { content: commandResponse ?? result.message.content },
      };
    },
  };
}

class WhatsAppConnectionManager implements WhatsAppConnectionManagerPort {
  public constructor(
    private readonly memory: JsonChannelMemory,
    private readonly provider: WhatsAppProviderPort,
    private readonly runtime: ChannelRuntime,
    private readonly featureEnabled: boolean,
    private readonly now: () => Date,
  ) {}

  public async connect(connectionId: string): Promise<ChannelConnection> {
    this.requireFeature();
    const connection = await this.requireConnection(connectionId);
    const connecting = await this.save(connection, {
      enabled: true,
      status: "connecting",
    });
    try {
      await this.runtime.start();
      return (await this.memory.connections.findById(connectionId)) ?? connecting;
    } catch {
      await this.save(connecting, { status: "error" });
      throw unavailable("Nao foi possivel iniciar a conexao WhatsApp.");
    }
  }

  public async reconnect(connectionId: string): Promise<ChannelConnection> {
    this.requireFeature();
    const connection = await this.requireConnection(connectionId);
    try {
      await this.provider.disconnect(connectionId);
      const reconnecting = await this.save(connection, {
        enabled: true,
        status: "reconnecting",
      });
      await this.runtime.start();
      return (await this.memory.connections.findById(connectionId)) ?? reconnecting;
    } catch {
      await this.save(connection, { enabled: true, status: "error" });
      throw unavailable("Nao foi possivel reconectar o WhatsApp.");
    }
  }

  public async logout(connectionId: string): Promise<ChannelConnection> {
    this.requireFeature();
    const connection = await this.requireConnection(connectionId);
    try {
      if (this.provider.getSnapshot(connectionId)) {
        await this.provider.logout(connectionId);
      } else {
        await this.provider.disconnect(connectionId);
      }
      return this.save(connection, { enabled: false, status: "logged_out" });
    } catch {
      throw unavailable("Nao foi possivel encerrar a sessao WhatsApp.");
    }
  }

  private requireFeature(): void {
    if (!this.featureEnabled) {
      throw unavailable("Integracao WhatsApp desativada neste ambiente.");
    }
  }

  private async requireConnection(connectionId: string): Promise<ChannelConnection> {
    const connection = await this.memory.connections.findById(connectionId);
    if (!connection || connection.channelId !== WHATSAPP_CHANNEL_ID) {
      throw notFound("Conexao WhatsApp nao encontrada.");
    }
    return connection;
  }

  private async save(
    connection: ChannelConnection,
    update: Pick<ChannelConnection, "enabled" | "status"> | Pick<ChannelConnection, "status">,
  ): Promise<ChannelConnection> {
    const saved: ChannelConnection = {
      ...connection,
      ...update,
      updatedAt: this.now().toISOString(),
    };
    await this.memory.connections.save(saved);
    return saved;
  }
}

class WhatsAppRateLimitError extends WhatsAppApiError {
  public constructor() {
    super(429, "WHATSAPP_RATE_LIMITED", "Limite de envio do WhatsApp atingido.");
  }
}

async function requireConversation(
  memory: JsonChannelMemory,
  conversationId: string,
): Promise<ChannelConversation> {
  const conversation = await memory.conversations.findById(conversationId);
  if (!conversation || conversation.channelId !== WHATSAPP_CHANNEL_ID) {
    throw notFound("Conversa WhatsApp nao encontrada.");
  }
  return conversation;
}
