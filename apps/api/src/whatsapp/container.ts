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
  formatCsnfMessage,
  SlidingWindowRateLimiter,
} from "@flowmind/channel-runtime";
import type { AgentRuntimePort } from "@flowmind/channel-runtime";
import { WhatsAppWebProvider } from "@flowmind/whatsapp-web";
import { WhatsAppWebJsProvider } from "@flowmind/whatsapp-webjs";

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
  const retentionMs = parseRetentionMs(environment.WHATSAPP_WEB_MESSAGE_RETENTION_DAYS);
  const memory = new JsonChannelMemory(channelStoragePath, {
    defaultSettings: createDefaultChannelSettings("csnf"),
    retention: {
      messagesMaxAgeMs: retentionMs,
      externalMessagesMaxAgeMs: retentionMs,
    },
  });
  const providers = new ChannelProviderRegistry();
  const selectedProvider = parseWhatsAppProvider(environment.WHATSAPP_PROVIDER);
  const defaultAuthDirectory =
    environment.WHATSAPP_WEB_AUTH_PATH ??
    environment.FLOWMIND_WHATSAPP_AUTH_PATH ??
    join(options.storagePath, "whatsapp-web-auth");
  const providerOptions = {
    authDirectory:
      selectedProvider === "webjs"
        ? (environment.WHATSAPP_WEBJS_AUTH_PATH ?? join(options.storagePath, "whatsapp-webjs-auth"))
        : defaultAuthDirectory,
    ...(selectedProvider === "webjs"
      ? {
          headless: environment.WHATSAPP_WEBJS_HEADLESS !== "false",
          ...(environment.WHATSAPP_WEBJS_EXECUTABLE_PATH
            ? { executablePath: environment.WHATSAPP_WEBJS_EXECUTABLE_PATH }
            : {}),
        }
      : {}),
    now,
  };
  const provider: WhatsAppProviderPort = options.providerFactory
    ? options.providerFactory(providerOptions)
    : selectedProvider === "webjs"
      ? new WhatsAppWebJsProvider(providerOptions)
      : new WhatsAppWebProvider(providerOptions);
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
  let proactiveTimer: ReturnType<typeof setInterval> | undefined;
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
    const existing = await memory.connections.findById(WHATSAPP_PERSONAL_CONNECTION_ID);
    if (!existing) {
      await memory.connections.save(
        createWhatsAppPersonalConnectionSeed(now().toISOString(), provider.id),
      );
    } else if (existing.providerId !== provider.id) {
      await memory.connections.save({
        ...existing,
        providerId: provider.id,
        enabled: false,
        status: "disconnected",
        updatedAt: now().toISOString(),
      });
    }
    await memory.settings.get();
    await memory.cleanup();
  }

  async function start(): Promise<void> {
    await initialize();
    if (featureEnabled) {
      await runtime.start();
      proactiveTimer = setInterval(() => void runProactiveOnce(), 60_000);
    }
  }

  async function stop(): Promise<void> {
    if (proactiveTimer) clearInterval(proactiveTimer);
    proactiveTimer = undefined;
    await runtime.stop();
  }

  async function runProactiveOnce(): Promise<void> {
    const current = now();
    if (current.getHours() < 9 || current.getHours() >= 21) return;
    const [settings, connection, conversations] = await Promise.all([
      memory.settings.get(),
      memory.connections.findById(WHATSAPP_PERSONAL_CONNECTION_ID),
      memory.conversations.list({
        connectionId: WHATSAPP_PERSONAL_CONNECTION_ID,
        automationMode: "enabled",
        order: "asc",
      }),
    ]);
    if (
      !settings.enabled ||
      settings.pauseAll ||
      !connection?.enabled ||
      connection.status !== "connected" ||
      !agentRuntimePort.initiate
    ) {
      return;
    }
    const inactivityCutoff = current.getTime() - 24 * 60 * 60_000;
    const cooldownCutoff = current.getTime() - 24 * 60 * 60_000;
    const conversation = conversations.find((candidate) => {
      if (candidate.type !== "private") return false;
      const lastActivity = Date.parse(candidate.lastMessageAt ?? candidate.updatedAt);
      const lastProactive =
        typeof candidate.metadata.agentProactiveAt === "string"
          ? Date.parse(candidate.metadata.agentProactiveAt)
          : Number.NEGATIVE_INFINITY;
      const activeUntil =
        typeof candidate.metadata.agentActiveUntil === "string"
          ? Date.parse(candidate.metadata.agentActiveUntil)
          : Number.NEGATIVE_INFINITY;
      const preferredTime =
        typeof candidate.metadata.preferredCheckInTime === "string"
          ? candidate.metadata.preferredCheckInTime
          : undefined;
      const scheduledNow = preferredTime ? isPreferredCheckInWindow(current, preferredTime) : false;
      const proactiveDay =
        typeof candidate.metadata.agentProactiveDay === "string"
          ? candidate.metadata.agentProactiveDay
          : undefined;
      const today = localDateKey(current);
      return activeUntil <= current.getTime() &&
        lastProactive <= cooldownCutoff &&
        proactiveDay !== today &&
        (scheduledNow || lastActivity <= inactivityCutoff);
    });
    if (!conversation) return;
    try {
      const initiated = await agentRuntimePort.initiate({
        agentId: conversation.agentId,
        ...(conversation.sessionId === undefined ? {} : { sessionId: conversation.sessionId }),
        target: {
          channelId: conversation.channelId,
          connectionId: conversation.connectionId,
          conversationId: conversation.id,
        },
      });
      const sent = await providers.resolve(connection.providerId).send({
        connectionId: connection.id,
        conversationAddress: {
          channelId: conversation.channelId,
          externalId: conversation.externalConversationId,
        },
        content: formatCsnfMessage(initiated.message.content),
      });
      const proactiveContent = formatCsnfMessage(initiated.message.content);
      await Promise.all([
        memory.messages.save({
          id: nextId(),
          conversationId: conversation.id,
          connectionId: connection.id,
          direction: "outbound",
          content: proactiveContent,
          status: "sent",
          providerMessageId: sent.providerMessageId,
          createdAt: sent.sentAt,
        }),
        memory.conversations.save({
          ...conversation,
          sessionId: initiated.session.id,
          lastMessagePreview: proactiveContent.slice(0, 120),
          lastMessageAt: sent.sentAt,
          lastOutboundAt: sent.sentAt,
          metadata: {
            ...conversation.metadata,
            agentProactiveAt: sent.sentAt,
            agentProactiveDay: localDateKey(current),
            agentActiveUntil: new Date(current.getTime() + 30 * 60_000).toISOString(),
          },
          updatedAt: sent.sentAt,
        }),
      ]);
    } catch {
      // A proactive failure must not affect inbound WhatsApp processing.
    }
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
        const hasAvatar = typeof conversation.metadata.avatarUrl === "string";
        if (hasContactDisplayName(conversation) && hasAvatar) return conversation;
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

  async function syncProviderChats(connectionId: string): Promise<void> {
    const chats = provider.listChats?.(connectionId) ?? [];
    if (chats.length === 0) return;
    const [settings, contacts, existingConversations] = await Promise.all([
      memory.settings.get(),
      Promise.resolve(provider.listContacts?.(connectionId) ?? []),
      memory.conversations.list({ connectionId }),
    ]);
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    const conversationsByExternalId = new Map(
      existingConversations.map((conversation) => [
        conversation.externalConversationId,
        conversation,
      ]),
    );
    await Promise.all(
      chats.map(async (chat) => {
        const existing = conversationsByExternalId.get(chat.externalId);
        const contact = contactsById.get(chat.externalId);
        if (existing) {
          const lastMessageAt =
            existing.lastMessageAt && existing.lastMessageAt > chat.lastActivityAt
              ? existing.lastMessageAt
              : chat.lastActivityAt;
          const displayName = contact?.name ?? existing.displayName;
          const pinnedAt = chat.pinnedAt ?? existing.metadata.pinnedAt;
          const avatarUrl = contact?.avatarUrl ?? existing.metadata.avatarUrl;
          if (
            existing.displayName === displayName &&
            existing.unreadCount === chat.unreadCount &&
            existing.lastMessageAt === lastMessageAt &&
            existing.metadata.pinnedAt === pinnedAt &&
            existing.metadata.avatarUrl === avatarUrl
          ) {
            return;
          }
          await memory.conversations.save({
            ...existing,
            ...(displayName === undefined ? {} : { displayName }),
            unreadCount: chat.unreadCount,
            lastMessageAt,
            metadata: {
              ...existing.metadata,
              ...(pinnedAt === undefined ? {} : { pinnedAt }),
              ...(avatarUrl === undefined ? {} : { avatarUrl }),
            },
            updatedAt: now().toISOString(),
          });
          return;
        }
        const createdAt = now().toISOString();
        await memory.conversations.save({
          id: nextId(),
          channelId: WHATSAPP_CHANNEL_ID,
          connectionId,
          externalConversationId: chat.externalId,
          type: chat.type,
          ...(contact?.name === undefined ? {} : { displayName: contact.name }),
          ...(chat.type === "private" && /^\d+$/.test(chat.externalId)
            ? { normalizedPhone: chat.externalId }
            : {}),
          agentId: settings.defaultAgentId,
          automationMode: chat.type === "group" ? "blocked" : settings.defaultConversationMode,
          unreadCount: chat.unreadCount,
          lastMessageAt: chat.lastActivityAt,
          metadata: {
            ...(chat.pinnedAt === undefined ? {} : { pinnedAt: chat.pinnedAt }),
            ...(contact?.avatarUrl === undefined ? {} : { avatarUrl: contact.avatarUrl }),
          },
          createdAt,
          updatedAt: chat.lastActivityAt,
        });
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
          metadata: withoutAgentEngagement(conversation.metadata),
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

  async function fetchAllConversationHistory(): Promise<{
    readonly requestedConversations: number;
    readonly countPerConversation: number;
  }> {
    const fetchHistory = provider.fetchMessageHistories?.bind(provider);
    if (!fetchHistory) {
      throw unavailable("Este provedor nao suporta busca de mensagens antigas.");
    }
    if (provider.getSnapshot(WHATSAPP_PERSONAL_CONNECTION_ID)?.status !== "connected") {
      throw conflict("Conecte o WhatsApp antes de buscar mensagens antigas.");
    }
    const conversations = await memory.conversations.list({
      connectionId: WHATSAPP_PERSONAL_CONNECTION_ID,
    });
    const messages = await memory.messages.list({ order: "asc" });
    const oldestMessageByConversation = new Map<string, ChannelMessage>();
    for (const message of messages) {
      if (
        message.providerMessageId &&
        !oldestMessageByConversation.has(message.conversationId)
      ) {
        oldestMessageByConversation.set(message.conversationId, message);
      }
    }
    const cursors = [];
    for (const conversation of conversations) {
      const cursor = oldestMessageByConversation.get(conversation.id);
      if (!cursor?.providerMessageId) continue;
      cursors.push({
        externalId: conversation.externalConversationId,
        providerMessageId: cursor.providerMessageId,
        occurredAt: cursor.createdAt,
        fromMe: cursor.direction === "outbound",
      });
    }
    if (cursors.length === 0) {
      throw conflict("Ainda nao existem conversas com cursor para buscar o historico.");
    }
    const count = 50;
    try {
      return fetchHistory(WHATSAPP_PERSONAL_CONNECTION_ID, cursors, count);
    } catch {
      throw conflict("O historico ja foi solicitado nesta sessao ou esta indisponivel.");
    }
  }

  return {
    agentRuntimePort,
    featureEnabled,
    fetchAllConversationHistory,
    initialize,
    hydrateConversationIdentities,
    manager,
    memory,
    processor,
    provider,
    providers,
    reminderDelivery,
    resetConversationSession,
    runProactiveOnce,
    runtime,
    sendManualMessage,
    setConversationMode,
    syncProviderChats,
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
    shouldRespond: (request) => runtime.shouldRespond(request),
    chat: async (request) => {
      const result = await runtime.chat(request);
      const commandResponse = reminderCommands ? await reminderCommands.handle(request) : undefined;
      return {
        session: { id: result.session.id },
        message: { content: commandResponse ?? result.message.content },
      };
    },
    initiate: async (request) => {
      const result = await runtime.initiate(request);
      return {
        session: { id: result.session.id },
        message: { content: result.message.content },
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
      await this.memory.clearConversationData();
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

function parseRetentionMs(value: string | undefined): number {
  const days = value === undefined ? 30 : Number(value);
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new Error("WHATSAPP_WEB_MESSAGE_RETENTION_DAYS must be a positive integer.");
  }
  return days * 24 * 60 * 60_000;
}

function parseWhatsAppProvider(value: string | undefined): "baileys" | "webjs" {
  const normalized = value?.trim().toLowerCase() ?? "baileys";
  if (normalized !== "baileys" && normalized !== "webjs") {
    throw new Error("WHATSAPP_PROVIDER must be either baileys or webjs.");
  }
  return normalized;
}

class WhatsAppRateLimitError extends WhatsAppApiError {
  public constructor() {
    super(429, "WHATSAPP_RATE_LIMITED", "Limite de envio do WhatsApp atingido.");
  }
}

function withoutAgentEngagement(
  metadata: ChannelConversation["metadata"],
): ChannelConversation["metadata"] {
  const {
    agentActiveUntil: _agentActiveUntil,
    agentActivatedAt: _agentActivatedAt,
    ...remaining
  } = metadata;
  return remaining;
}

function isPreferredCheckInWindow(now: Date, value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const preferredMinutes = hour * 60 + minute;
  return currentMinutes >= preferredMinutes + 5 && currentMinutes <= preferredMinutes + 35;
}

function localDateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
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
