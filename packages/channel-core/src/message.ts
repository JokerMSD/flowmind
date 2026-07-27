import type { ChannelAddress } from "./connection.js";
import type { ConversationType } from "./conversation.js";

export interface InboundMessage {
  readonly connectionId: string;
  readonly providerMessageId: string;
  readonly conversationAddress: ChannelAddress;
  readonly conversationType: ConversationType;
  readonly senderAddress: ChannelAddress;
  readonly displayName?: string;
  readonly avatarUrl?: string;
  readonly content: string;
  readonly occurredAt: string;
  readonly fromSelf: boolean;
  readonly unsupported: boolean;
  readonly raw?: unknown;
}

export interface OutboundMessage {
  readonly connectionId: string;
  readonly conversationAddress: ChannelAddress;
  readonly content: string;
  readonly replyToProviderMessageId?: string;
}

export interface SendResult {
  readonly connectionId: string;
  readonly providerMessageId: string;
  readonly sentAt: string;
}

export type ChannelMessageDirection = "inbound" | "outbound";
export type ChannelMessageStatus = "received" | "pending" | "sent" | "failed" | "ignored";

export interface ChannelMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly connectionId: string;
  readonly direction: ChannelMessageDirection;
  readonly content: string;
  readonly status: ChannelMessageStatus;
  readonly providerMessageId?: string;
  readonly replyToMessageId?: string;
  readonly error?: string;
  readonly createdAt: string;
}

export type ChannelInboundMessage = InboundMessage;
export type ChannelOutboundMessage = OutboundMessage;
export type ChannelSendResult = SendResult;
