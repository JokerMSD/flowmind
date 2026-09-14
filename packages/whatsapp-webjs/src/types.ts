import type {
  ChannelConnectionStatus,
  ChannelProviderListener,
  ConversationType,
  InboundMessage,
} from "@flowmind/channel-core";

export { WHATSAPP_WEBJS_PROVIDER_ID } from "@flowmind/channel-core";

export interface WhatsAppWebJsQrSnapshot {
  readonly value: string;
  readonly expiresAt: string;
}

export interface WhatsAppWebJsConnectionSnapshot {
  readonly connectionId: string;
  readonly status: ChannelConnectionStatus;
  readonly qr?: WhatsAppWebJsQrSnapshot;
  readonly address?: string;
  readonly error?: string;
  readonly historySyncStatus: "idle" | "syncing" | "complete" | "paused";
  readonly historySyncProgress?: number;
}

export interface WhatsAppWebJsContact {
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
  readonly avatarUrl?: string;
}

export interface WhatsAppWebJsChat {
  readonly externalId: string;
  readonly type: "private" | "group";
  readonly lastActivityAt: string;
  readonly pinnedAt?: number;
  readonly archived: boolean;
  readonly unreadCount: number;
}

export interface WhatsAppWebJsHistoryCursor {
  readonly externalId: string;
  readonly providerMessageId: string;
  readonly occurredAt: string;
  readonly fromMe: boolean;
}

export interface WhatsAppWebJsMediaInfo {
  readonly kind: "image" | "video" | "audio" | "document" | "sticker";
  readonly mimeType: string;
  readonly fileName?: string;
}

export interface WebJsId {
  readonly _serialized: string;
}

export interface WebJsContact {
  readonly id: WebJsId;
  readonly name?: string;
  readonly pushname?: string;
  readonly shortName?: string;
  readonly number?: string;
  readonly isMyContact?: boolean;
  readonly isUser?: boolean;
  getProfilePicUrl(): Promise<string | undefined>;
}

export interface WebJsChat {
  readonly id: WebJsId;
  readonly isGroup: boolean;
  readonly name?: string;
  readonly timestamp?: number;
  readonly unreadCount: number;
  readonly archived: boolean;
  readonly pinned?: boolean;
  fetchMessages(options: { readonly limit: number }): Promise<readonly WebJsMessage[]>;
}

export interface WebJsMedia {
  readonly data: string;
  readonly mimetype: string;
  readonly filename?: string;
}

export interface WebJsMessage {
  readonly id: WebJsId;
  readonly from: string;
  readonly to?: string;
  readonly author?: string;
  readonly fromMe: boolean;
  readonly body: string;
  readonly timestamp: number;
  readonly type: string;
  readonly hasMedia: boolean;
  getContact(): Promise<WebJsContact>;
  getChat(): Promise<WebJsChat>;
  downloadMedia(): Promise<WebJsMedia | undefined>;
}

export interface WebJsSentMessage {
  readonly id: WebJsId;
  readonly timestamp: number;
}

export interface WebJsClient {
  on(event: "qr", listener: (qr: string) => void): this;
  on(event: "authenticated" | "ready", listener: () => void): this;
  on(event: "auth_failure" | "disconnected", listener: (reason: string) => void): this;
  on(event: "message" | "message_create", listener: (message: WebJsMessage) => void): this;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  logout(): Promise<void>;
  getChats(): Promise<readonly WebJsChat[]>;
  getContacts(): Promise<readonly WebJsContact[]>;
  getChatById(id: string): Promise<WebJsChat>;
  getContactById(id: string): Promise<WebJsContact>;
  sendMessage(chatId: string, content: string): Promise<WebJsSentMessage>;
}

export interface WhatsAppWebJsClientContext {
  readonly connectionId: string;
  readonly authDirectory: string;
  readonly headless: boolean;
  readonly executablePath?: string;
}

export type WhatsAppWebJsClientFactory = (context: WhatsAppWebJsClientContext) => WebJsClient;

export interface WhatsAppWebJsProviderOptions {
  readonly authDirectory: string;
  readonly clientFactory?: WhatsAppWebJsClientFactory;
  readonly qrTtlMs?: number;
  readonly headless?: boolean;
  readonly executablePath?: string;
  readonly now?: () => Date;
}

export interface WebJsConnectionRuntime {
  readonly client: WebJsClient;
  readonly listener: ChannelProviderListener;
  readonly connectionId: string;
  readonly generation: number;
}

export interface NormalizedWebJsMessage {
  readonly inbound: InboundMessage;
  readonly mediaInfo?: WhatsAppWebJsMediaInfo;
}

export interface IdentityResult {
  readonly displayName?: string;
  readonly avatarUrl?: string;
}

export type IdentityResolver = (
  connectionId: string,
  externalId: string,
  conversationType: ConversationType,
  displayName?: string,
) => Promise<IdentityResult>;
