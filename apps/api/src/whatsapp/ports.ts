import type { ChannelConnection, ChannelProvider } from "@flowmind/channel-core";
import type {
  WhatsAppConnectionSnapshot,
  WhatsAppWebProviderOptions,
} from "@flowmind/whatsapp-web";

export interface WhatsAppProviderPort extends ChannelProvider {
  logout(connectionId: string): Promise<void>;
  getSnapshot(connectionId: string): WhatsAppConnectionSnapshot | undefined;
}

export type WhatsAppProviderFactory = (options: WhatsAppWebProviderOptions) => WhatsAppProviderPort;

export interface WhatsAppConnectionManagerPort {
  connect(connectionId: string): Promise<ChannelConnection>;
  reconnect(connectionId: string): Promise<ChannelConnection>;
  logout(connectionId: string): Promise<ChannelConnection>;
}
