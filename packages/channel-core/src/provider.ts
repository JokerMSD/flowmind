import type {
  ChannelConnection,
  ChannelConnectionStatusEvent,
  ProviderConnection,
} from "./connection.js";
import type { InboundMessage, OutboundMessage, SendResult } from "./message.js";

export interface ChannelProviderListener {
  onMessage(message: InboundMessage): void | Promise<void>;
  onStatus(event: ChannelConnectionStatusEvent): void | Promise<void>;
}

export interface ChannelProvider {
  readonly id: string;
  readonly channelId: ChannelConnection["channelId"];
  connect(
    connection: ChannelConnection,
    listener: ChannelProviderListener,
  ): Promise<ProviderConnection>;
  disconnect(connectionId: string): Promise<void>;
  send(message: OutboundMessage): Promise<SendResult>;
}

export interface ChannelProviderRegistry<TProvider extends ChannelProvider = ChannelProvider> {
  register(provider: TProvider): void;
  get(providerId: string): TProvider | undefined;
  resolve(providerId: string): TProvider;
  list(): readonly TProvider[];
}
