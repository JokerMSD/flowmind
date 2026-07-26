import { WHATSAPP_CHANNEL_ID } from "./channel.js";
import type { ChannelId } from "./channel.js";

export const CHANNEL_CONNECTION_STATUSES = [
  "disconnected",
  "connecting",
  "waiting_for_qr",
  "authenticated",
  "connected",
  "reconnecting",
  "logged_out",
  "error",
] as const;

export type ChannelConnectionStatus = (typeof CHANNEL_CONNECTION_STATUSES)[number];

export interface ChannelAddress {
  readonly channelId: ChannelId;
  readonly externalId: string;
}

export interface ChannelConnection {
  readonly id: string;
  readonly channelId: ChannelId;
  readonly providerId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly status: ChannelConnectionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChannelConnectionStatusEvent {
  readonly connectionId: string;
  readonly status: ChannelConnectionStatus;
  readonly address?: ChannelAddress;
  readonly error?: string;
  readonly occurredAt: string;
}

export interface ProviderConnection {
  readonly connectionId: string;
  readonly channelId: ChannelId;
  readonly providerId: string;
}

export const WHATSAPP_PERSONAL_CONNECTION_ID = "whatsapp-personal";
export const WHATSAPP_WEB_PROVIDER_ID = "whatsapp-web";

export function createWhatsAppPersonalConnectionSeed(timestamp: string): ChannelConnection {
  return {
    id: WHATSAPP_PERSONAL_CONNECTION_ID,
    channelId: WHATSAPP_CHANNEL_ID,
    providerId: WHATSAPP_WEB_PROVIDER_ID,
    name: "WhatsApp pessoal",
    enabled: false,
    status: "disconnected",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
