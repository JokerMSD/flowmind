import type { ChannelConnection, ChannelProvider, ConversationType } from "@flowmind/channel-core";
import type {
  WhatsAppConnectionSnapshot,
  WhatsAppChat,
  WhatsAppContact,
  WhatsAppWebProviderOptions,
  WhatsAppHistoryCursor,
  WhatsAppMediaInfo,
} from "@flowmind/whatsapp-web";

export interface WhatsAppProviderPort extends ChannelProvider {
  logout(connectionId: string): Promise<void>;
  getSnapshot(connectionId: string): WhatsAppConnectionSnapshot | undefined;
  listContacts?(connectionId: string): readonly WhatsAppContact[];
  listChats?(connectionId: string): readonly WhatsAppChat[];
  fetchMessageHistory?(
    connectionId: string,
    externalId: string,
    cursor: {
      readonly providerMessageId: string;
      readonly occurredAt: string;
      readonly fromMe: boolean;
    },
    count: number,
  ): Promise<string>;
  fetchMessageHistories?(
    connectionId: string,
    cursors: readonly WhatsAppHistoryCursor[],
    count: number,
  ): { readonly requestedConversations: number; readonly countPerConversation: number };
  getMediaInfo?(connectionId: string, providerMessageId: string): WhatsAppMediaInfo | undefined;
  downloadMedia?(
    connectionId: string,
    providerMessageId: string,
  ): Promise<{ readonly data: Buffer; readonly info: WhatsAppMediaInfo }>;
  resolveConversationIdentity?(
    connectionId: string,
    externalId: string,
    conversationType: ConversationType,
    displayName?: string,
  ): Promise<{ readonly displayName?: string; readonly avatarUrl?: string }>;
}

export type WhatsAppProviderFactory = (options: WhatsAppWebProviderOptions) => WhatsAppProviderPort;

export interface WhatsAppConnectionManagerPort {
  connect(connectionId: string): Promise<ChannelConnection>;
  reconnect(connectionId: string): Promise<ChannelConnection>;
  logout(connectionId: string): Promise<ChannelConnection>;
}
