export type ChannelId = string;

export const WHATSAPP_CHANNEL_ID = "whatsapp";

export interface Channel {
  readonly id: ChannelId;
  readonly name: string;
}
