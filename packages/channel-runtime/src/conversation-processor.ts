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
import { ensureCsnfIntroduction } from "./conversation-introduction.js";
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
    if (!(await this.dependencies.externalMessages.claim(external))) return ignored("duplicate");

    const connection = await this.dependencies.connections.findById(inbound.connectionId);
    if (!connection) return this.ignore(external, "connection-not-found");
    if (!connection.enabled) return this.ignore(external, "connection-disabled");
    if (connection.status !== "connected") return this.ignore(external, "connection-not-ready");
    if (
      inbound.conversationAddress.channelId !== connection.channelId ||
      inbound.senderAddress.channelId !== connection.channelId
    ) {
      return this.ignore(external, "unsupported");
    }
    const settings = await this.dependencies.settings.get();

    const conversation = await this.resolveConversation(
      inbound,
      settings.defaultAgentId,
      settings.defaultConversationMode,
    );
    const inboundMessage = this.recordedMessage(
      external.messageId,
      conversation.id,
      inbound,
      now.toISOString(),
    );
    await this.dependencies.messages.save(inboundMessage);

    if (inbound.historical) {
      return this.ignore(external, "historical", conversation.id);
    }
    if (inbound.unsupported) {
      return this.ignore(external, "unsupported", conversation.id);
    }
    if (inbound.fromSelf && !settings.processMessagesFromSelf) {
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
        ...(conversation.sessionId === undefined ? {} : { sessionId: conversation.sessionId }),
        target: {
          channelId: conversation.channelId,
          connectionId: conversation.connectionId,
          conversationId: conversation.id,
        },
      });
      outbound = {
        id: this.dependencies.identifiers.next(),
        conversationId: conversation.id,
        connectionId: inbound.connectionId,
        direction: "outbound",
        content: chat.message.content,
        status: "pending",
        replyToMessageId: inboundMessage.id,
        createdAt: this.dependencies.clock.now().toISOString(),
      };
      await this.dependencies.messages.save(outbound);

      const request: OutboundMessage = {
        connectionId: inbound.connectionId,
        conversationAddress: inbound.conversationAddress,
        content: chat.message.content,
        replyToProviderMessageId: inbound.providerMessageId,
      };
      const provider = this.dependencies.providers.resolve(connection.providerId);
      const introducedConversation = await ensureCsnfIntroduction({
        connection,
        conversation,
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
    createdAt: string,
  ): ChannelMessage {
    return {
      id,
      conversationId,
      connectionId: inbound.connectionId,
      direction: inbound.fromSelf ? "outbound" : "inbound",
      content: inbound.content,
      status: inbound.fromSelf ? "sent" : "received",
      providerMessageId: inbound.providerMessageId,
      createdAt,
    };
  }

  private messagePreview(inbound: InboundMessage): string {
    const content = inbound.content.trim();
    return (content.length > 0 ? content : "[Midia]").slice(0, 120);
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
