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
  | "connection-not-ready";

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

    const settings = await this.dependencies.settings.get();
    if (!settings.enabled) return this.ignore(external, "channel-disabled");
    if (settings.pauseAll) return this.ignore(external, "all-paused");

    const connection = await this.dependencies.connections.findById(inbound.connectionId);
    if (!connection) return this.ignore(external, "connection-not-found");
    if (!connection.enabled) return this.ignore(external, "connection-disabled");
    if (connection.status !== "connected") return this.ignore(external, "connection-not-ready");
    if (
      inbound.unsupported ||
      inbound.conversationAddress.channelId !== connection.channelId ||
      inbound.senderAddress.channelId !== connection.channelId
    ) {
      return this.ignore(external, "unsupported");
    }
    if (inbound.fromSelf && !settings.processMessagesFromSelf) {
      return this.ignore(external, "from-self");
    }
    if (!this.rateLimiter.allow("global", settings.rateLimit.global, now)) {
      return this.ignore(external, "global-rate-limited");
    }

    const conversation = await this.resolveConversation(
      inbound,
      settings.defaultAgentId,
      settings.defaultConversationMode,
    );
    if (conversation.type === "group" && !settings.allowGroups) {
      return this.ignore(external, "groups-not-allowed", conversation.id);
    }
    if (conversation.automationMode !== "enabled") {
      return this.ignore(external, "conversation-mode", conversation.id);
    }

    const inboundMessage = this.inboundMessage(
      external.messageId,
      conversation.id,
      inbound,
      now.toISOString(),
    );
    if (!this.rateLimiter.allow(`auto:${conversation.id}`, settings.rateLimit.auto, now)) {
      await this.dependencies.messages.save({ ...inboundMessage, status: "ignored" });
      await this.dependencies.conversations.save({
        ...conversation,
        automationMode: "paused",
        lastError: "Limite de respostas automaticas atingido.",
        updatedAt: now.toISOString(),
      });
      return this.ignore(external, "auto-rate-limited", conversation.id);
    }
    await this.dependencies.messages.save(inboundMessage);
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
      const sent = await this.dependencies.providers.resolve(connection.providerId).send(request);
      await this.dependencies.messages.save({
        ...outbound,
        status: "sent",
        providerMessageId: sent.providerMessageId,
      });
      await this.dependencies.conversations.save({
        ...conversation,
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
    if (existing) return existing;
    const now = this.dependencies.clock.now().toISOString();
    const created: ChannelConversation = {
      id: this.dependencies.identifiers.next(),
      channelId: inbound.conversationAddress.channelId,
      connectionId: inbound.connectionId,
      externalConversationId: inbound.conversationAddress.externalId,
      type: inbound.conversationType,
      agentId: defaultAgentId,
      automationMode:
        inbound.conversationType === "group"
          ? defaultAutomationModeForConversation("group")
          : defaultMode,
      unreadCount: 1,
      lastMessagePreview: inbound.content.slice(0, 120),
      lastMessageAt: inbound.occurredAt,
      lastInboundAt: inbound.occurredAt,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.dependencies.conversations.save(created);
    return created;
  }

  private inboundMessage(
    id: string,
    conversationId: string,
    inbound: InboundMessage,
    createdAt: string,
  ): ChannelMessage {
    return {
      id,
      conversationId,
      connectionId: inbound.connectionId,
      direction: "inbound",
      content: inbound.content,
      status: "received",
      providerMessageId: inbound.providerMessageId,
      createdAt,
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
