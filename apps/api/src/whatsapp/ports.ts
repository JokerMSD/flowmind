import type { ChannelConnection, ChannelProvider, ConversationType } from "@flowmind/channel-core";
import type {
  WhatsAppConnectionSnapshot,
  WhatsAppContact,
  WhatsAppWebProviderOptions,
} from "@flowmind/whatsapp-web";

export interface WhatsAppProviderPort extends ChannelProvider {
  logout(connectionId: string): Promise<void>;
  getSnapshot(connectionId: string): WhatsAppConnectionSnapshot | undefined;
  listContacts?(connectionId: string): readonly WhatsAppContact[];
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
