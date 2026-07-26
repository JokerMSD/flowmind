export type ConversationMode = "disabled" | "enabled" | "paused" | "manual" | "blocked";
export type ConversationAutomationMode = ConversationMode;
export type ConversationType = "private" | "group";
export type ConversationMetadata = Readonly<Record<string, unknown>>;

export interface ChannelConversation {
  readonly id: string;
  readonly channelId: string;
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly type: ConversationType;
  readonly displayName?: string;
  readonly normalizedPhone?: string;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly automationMode: ConversationAutomationMode;
  readonly unreadCount: number;
  readonly lastMessagePreview?: string;
  readonly lastMessageAt?: string;
  readonly lastInboundAt?: string;
  readonly lastOutboundAt?: string;
  readonly lastError?: string;
  readonly metadata: ConversationMetadata;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function defaultAutomationModeForConversation(
  type: ConversationType,
): ConversationAutomationMode {
  return type === "group" ? "blocked" : "disabled";
}
