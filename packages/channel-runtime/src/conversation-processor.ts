import type {
  ChannelConnectionRepository,
  ChannelConversation,
  ChannelConversationRepository,
  ChannelMessage,
  ChannelMessageRepository,
  ChannelProviderRegistry,
  ChannelSettingsRepository,
  ConversationMode,
  ExternalMessageRecord,
  ExternalMessageRecordRepository,
  ExternalMessageStatus,
  InboundMessage,
  OutboundMessage,
} from "@flowmind/channel-core";
import { defaultAutomationModeForConversation } from "@flowmind/channel-core";
import type { AgentRuntimePort, Clock, IdentifierGenerator } from "./ports.js";
import { ensureCsnfIntroduction, formatCsnfMessage } from "./conversation-introduction.js";

const AGENT_ENGAGEMENT_WINDOW_MS = 30 * 60_000;
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import type { RateLimiter } from "./rate-limiter.js";

export type IgnoredMessageReason =
  | "channel-disabled"
  | "all-paused"
  | "conversation-mode"
  | "groups-not-allowed"
  | "from-self"
  | "unsupported"
  | "duplicate"
  | "global-rate-limited"
  | "auto-rate-limited"
  | "connection-not-found"
  | "connection-disabled"
  | "connection-not-ready"
  | "activation-policy"
  | "historical";

export type ConversationProcessingResult =
  | {
      readonly status: "processed";
      readonly conversationId: string;
      readonly inboundMessageId: string;
      readonly outboundMessageId: string;
    }
  | {
      readonly status: "ignored";
      readonly reason: IgnoredMessageReason;
      readonly conversationId?: string;
    };

export interface ConversationProcessorDependencies {
  readonly connections: ChannelConnectionRepository;
  readonly conversations: ChannelConversationRepository;
  readonly messages: ChannelMessageRepository;
  readonly externalMessages: ExternalMessageRecordRepository;
  readonly settings: ChannelSettingsRepository;
  readonly providers: ChannelProviderRegistry;
  readonly agents: AgentRuntimePort;
  readonly clock: Clock;
  readonly identifiers: IdentifierGenerator;
  readonly rateLimiter?: RateLimiter;
}

export class ConversationProcessor {
  private readonly rateLimiter: RateLimiter;

  public constructor(private readonly dependencies: ConversationProcessorDependencies) {
    this.rateLimiter = dependencies.rateLimiter ?? new SlidingWindowRateLimiter();
  }

  public async process(inbound: InboundMessage): Promise<ConversationProcessingResult> {
    const now = this.dependencies.clock.now();
    const external: ExternalMessageRecord = {
      connectionId: inbound.connectionId,
      providerMessageId: inbound.providerMessageId,
      messageId: this.dependencies.identifiers.next(),
      status: "received",
      recordedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const connection = await this.dependencies.connections.findById(inbound.connectionId);
    if (!connection) return ignored("connection-not-found");
    if (!connection.enabled) return ignored("connection-disabled");
    if (connection.status !== "connected") return ignored("connection-not-ready");
    if (
      inbound.conversationAddress.channelId !== connection.channelId ||
      inbound.senderAddress.channelId !== connection.channelId
    ) {
      return ignored("unsupported");
    }
    if (!(await this.dependencies.externalMessages.claim(external))) return ignored("duplicate");
    const settings = await this.dependencies.settings.get();

    const conversation = await this.resolveConversation(
      inbound,
      settings.defaultAgentId,
      settings.defaultConversationMode,
    );
    const knownOutbound =
      inbound.fromSelf && this.dependencies.messages.findByProviderMessageId
        ? await this.dependencies.messages.findByProviderMessageId(
            inbound.connectionId,
            inbound.providerMessageId,
          )
        : undefined;
    if (knownOutbound?.direction === "outbound") {
      return this.ignore(external, "from-self", conversation.id);
    }
    const inboundMessage = this.recordedMessage(
      external.messageId,
      conversation.id,
      inbound,
    );
    await this.dependencies.messages.save(inboundMessage);

    if (inbound.historical) {
      return this.ignore(external, "historical", conversation.id);
    }
    if (inbound.unsupported) {
      return this.ignore(external, "unsupported", conversation.id);
    }
    if (inbound.fromSelf && !settings.processMessagesFromSelf) {
      await this.dependencies.conversations.save({
        ...conversation,
        metadata: withoutAgentEngagement(conversation.metadata),
        updatedAt: now.toISOString(),
      });
      return this.ignore(external, "from-self", conversation.id);
    }
    if (!settings.enabled) {
      return this.ignore(external, "channel-disabled", conversation.id);
    }
    if (settings.pauseAll) return this.ignore(external, "all-paused", conversation.id);
    if (conversation.type === "group" && !settings.allowGroups) {
      return this.ignore(external, "groups-not-allowed", conversation.id);
    }
    if (conversation.automationMode !== "enabled") {
      return this.ignore(external, "conversation-mode", conversation.id);
    }
    const explicitlyActivated = await this.dependencies.agents.shouldRespond({
      agentId: conversation.agentId,
      message: inbound.content,
    });
    const engagement = this.engagement(conversation, inbound.content, explicitlyActivated, now);
    if (!engagement.respond) {
      return this.ignore(external, "activation-policy", conversation.id);
    }
    const engagedConversation: ChannelConversation = {
      ...conversation,
      metadata: engagement.metadata,
      updatedAt: now.toISOString(),
    };
    await this.dependencies.conversations.save(engagedConversation);
    if (!this.rateLimiter.allow("global", settings.rateLimit.global, now)) {
      return this.ignore(external, "global-rate-limited", conversation.id);
    }
    if (!this.rateLimiter.allow(`auto:${conversation.id}`, settings.rateLimit.auto, now)) {
      await this.dependencies.conversations.save({
        ...conversation,
        automationMode: "paused",
        lastError: "Limite de respostas automaticas atingido.",
        updatedAt: now.toISOString(),
      });
      return this.ignore(external, "auto-rate-limited", conversation.id);
    }
    await this.saveExternal(external, "processing");

    let outbound: ChannelMessage | undefined;
    try {
      const chat = await this.dependencies.agents.chat({
        agentId: conversation.agentId,
        message: inbound.content,
        ...(engagedConversation.sessionId === undefined
          ? {}
          : { sessionId: engagedConversation.sessionId }),
        target: {
          channelId: conversation.channelId,
          connectionId: conversation.connectionId,
          conversationId: conversation.id,
        },
      });
      const currentConversation = await this.dependencies.conversations.findById(
        conversation.id,
      );
      if (!currentConversation || currentConversation.automationMode !== "enabled") {
        return this.ignore(external, "conversation-mode", conversation.id);
      }
      const agentContent = formatCsnfMessage(chat.message.content);
      outbound = {
        id: this.dependencies.identifiers.next(),
        conversationId: conversation.id,
        connectionId: inbound.connectionId,
        direction: "outbound",
        content: agentContent,
        status: "pending",
        replyToMessageId: inboundMessage.id,
        createdAt: this.dependencies.clock.now().toISOString(),
      };
      await this.dependencies.messages.save(outbound);

      const request: OutboundMessage = {
        connectionId: inbound.connectionId,
        conversationAddress: inbound.conversationAddress,
        content: agentContent,
        replyToProviderMessageId: inbound.providerMessageId,
      };
      const provider = this.dependencies.providers.resolve(connection.providerId);
      const introducedConversation = await ensureCsnfIntroduction({
        connection,
        conversation: {
          ...currentConversation,
          metadata: {
            ...currentConversation.metadata,
            ...engagement.metadata,
          },
        },
        conversations: this.dependencies.conversations,
        provider,
        now: () => this.dependencies.clock.now(),
      });
      const sent = await provider.send(request);
      await this.dependencies.messages.save({
        ...outbound,
        status: "sent",
        providerMessageId: sent.providerMessageId,
      });
      await this.dependencies.conversations.save({
        ...introducedConversation,
        sessionId: chat.session.id,
        metadata: engagement.endAfterResponse
          ? withoutAgentEngagement(introducedConversation.metadata)
          : { ...introducedConversation.metadata, ...engagement.metadata },
        lastOutboundAt: this.dependencies.clock.now().toISOString(),
        updatedAt: this.dependencies.clock.now().toISOString(),
      });
      await this.saveExternal(external, "processed");
      return {
        status: "processed",
        conversationId: conversation.id,
        inboundMessageId: inboundMessage.id,
        outboundMessageId: outbound.id,
      };
    } catch (error) {
      if (outbound) {
        await this.dependencies.messages.save({
          ...outbound,
          status: "failed",
          error: errorMessage(error),
        });
      }
      await this.saveExternal(external, "failed", errorMessage(error));
      throw error;
    }
  }

  private async resolveConversation(
    inbound: InboundMessage,
    defaultAgentId: string,
    defaultMode: ConversationMode,
  ): Promise<ChannelConversation> {
    const existing =
      await this.dependencies.conversations.findByConnectionAndExternalConversationId(
        inbound.connectionId,
        inbound.conversationAddress.externalId,
      );
    const now = this.dependencies.clock.now().toISOString();
    const normalizedPhone = this.normalizedPhone(inbound);
    const routineMetadata = preferredCheckInMetadata(inbound.content);
    if (existing) {
      const isLatest =
        existing.lastMessageAt === undefined || inbound.occurredAt >= existing.lastMessageAt;
      const updated: ChannelConversation = {
        ...existing,
        ...(inbound.displayName === undefined ? {} : { displayName: inbound.displayName }),
        ...(normalizedPhone === undefined ? {} : { normalizedPhone }),
        ...(isLatest
          ? {
              unreadCount:
                inbound.fromSelf || inbound.historical
                  ? existing.unreadCount
                  : existing.unreadCount + 1,
              lastMessagePreview: this.messagePreview(inbound),
              lastMessageAt: inbound.occurredAt,
              ...(inbound.fromSelf
                ? { lastOutboundAt: inbound.occurredAt }
                : { lastInboundAt: inbound.occurredAt }),
            }
          : {}),
        metadata: {
          ...existing.metadata,
          ...routineMetadata,
          ...inbound.conversationMetadata,
          ...(inbound.avatarUrl === undefined ? {} : { avatarUrl: inbound.avatarUrl }),
        },
        updatedAt: now,
      };
      await this.dependencies.conversations.save(updated);
      return updated;
    }
    const created: ChannelConversation = {
      id: this.dependencies.identifiers.next(),
      channelId: inbound.conversationAddress.channelId,
      connectionId: inbound.connectionId,
      externalConversationId: inbound.conversationAddress.externalId,
      type: inbound.conversationType,
      ...(inbound.displayName === undefined ? {} : { displayName: inbound.displayName }),
      ...(normalizedPhone === undefined ? {} : { normalizedPhone }),
      agentId: defaultAgentId,
      automationMode:
        inbound.conversationType === "group"
          ? defaultAutomationModeForConversation("group")
          : defaultMode,
      unreadCount: inbound.fromSelf || inbound.historical ? 0 : 1,
      lastMessagePreview: this.messagePreview(inbound),
      lastMessageAt: inbound.occurredAt,
      ...(inbound.fromSelf
        ? { lastOutboundAt: inbound.occurredAt }
        : { lastInboundAt: inbound.occurredAt }),
      metadata: {
        ...routineMetadata,
        ...inbound.conversationMetadata,
        ...(inbound.avatarUrl === undefined ? {} : { avatarUrl: inbound.avatarUrl }),
      },
      createdAt: now,
      updatedAt: now,
    };
    await this.dependencies.conversations.save(created);
    return created;
  }

  private normalizedPhone(inbound: InboundMessage): string | undefined {
    const externalId = inbound.conversationAddress.externalId;
    return inbound.conversationType === "private" && /^\d+$/.test(externalId)
      ? externalId
      : undefined;
  }

  private recordedMessage(
    id: string,
    conversationId: string,
    inbound: InboundMessage,
  ): ChannelMessage {
    return {
      id,
      conversationId,
      connectionId: inbound.connectionId,
      direction: inbound.fromSelf ? "outbound" : "inbound",
      content: inbound.content,
      status: inbound.fromSelf ? "sent" : "received",
      providerMessageId: inbound.providerMessageId,
      createdAt: inbound.occurredAt,
    };
  }

  private messagePreview(inbound: InboundMessage): string {
    const content = inbound.content.trim();
    return (content.length > 0 ? content : "[Midia]").slice(0, 120);
  }

  private engagement(
    conversation: ChannelConversation,
    content: string,
    explicitlyActivated: boolean,
    now: Date,
  ): {
    readonly respond: boolean;
    readonly endAfterResponse: boolean;
    readonly metadata: ChannelConversation["metadata"];
  } {
    if (conversation.type !== "private") {
      return {
        respond: explicitlyActivated,
        endAfterResponse: false,
        metadata: conversation.metadata,
      };
    }
    const activeUntil =
      typeof conversation.metadata.agentActiveUntil === "string"
        ? Date.parse(conversation.metadata.agentActiveUntil)
        : Number.NaN;
    const active = Number.isFinite(activeUntil) && activeUntil > now.getTime();
    if (!explicitlyActivated && !active) {
      return { respond: false, endAfterResponse: false, metadata: conversation.metadata };
    }
    const endAfterResponse = isConversationClosing(content);
    return {
      respond: true,
      endAfterResponse,
      metadata: {
        ...conversation.metadata,
        agentActiveUntil: new Date(now.getTime() + AGENT_ENGAGEMENT_WINDOW_MS).toISOString(),
        ...(explicitlyActivated ? { agentActivatedAt: now.toISOString() } : {}),
      },
    };
  }

  private async ignore(
    external: ExternalMessageRecord,
    reason: IgnoredMessageReason,
    conversationId?: string,
  ): Promise<ConversationProcessingResult> {
    await this.saveExternal(external, "ignored");
    return ignored(reason, conversationId);
  }

  private async saveExternal(
    external: ExternalMessageRecord,
    status: ExternalMessageStatus,
    error?: string,
  ): Promise<void> {
    await this.dependencies.externalMessages.save({
      ...external,
      status,
      updatedAt: this.dependencies.clock.now().toISOString(),
      ...(error === undefined ? {} : { error }),
    });
  }
}

function isConversationClosing(content: string): boolean {
  const normalized = content
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [
    "obrigado",
    "obrigada",
    "valeu",
    "tchau",
    "ate mais",
    "pode parar",
    "pode encerrar",
    "encerrar conversa",
    "ja resolveu",
    "era so isso",
  ].some((closing) => normalized === closing || normalized.endsWith(` ${closing}`));
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

function preferredCheckInMetadata(content: string): Readonly<Record<string, unknown>> {
  const normalized = content
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
  if (!/\b(treino|treinar|academia|exercicio|caminhada|corrida)\b/u.test(normalized)) return {};
  const explicit = normalized.match(/\b(?:as|pelas|por volta das?)\s*(\d{1,2})(?::(\d{2}))?\b/u);
  const hour = explicit ? Number(explicit[1]) : /\bde manha\b/u.test(normalized) ? 9 : undefined;
  const minute = explicit?.[2] ? Number(explicit[2]) : 0;
  if (hour === undefined || hour < 0 || hour > 23 || minute < 0 || minute > 59) return {};
  return {
    preferredCheckInTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    preferredCheckInContext: "treino",
  };
}

function ignored(
  reason: IgnoredMessageReason,
  conversationId?: string,
): ConversationProcessingResult {
  return conversationId === undefined
    ? { status: "ignored", reason }
    : { status: "ignored", reason, conversationId };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
