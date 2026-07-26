import type { ConversationMode } from "./conversation.js";

export interface RateLimitSettings {
  readonly maxMessages: number;
  readonly windowMs: number;
}

export interface ChannelRateLimitSettings {
  readonly auto: RateLimitSettings;
  readonly global: RateLimitSettings;
}

export interface ChannelSettings {
  readonly enabled: boolean;
  readonly pauseAll: boolean;
  readonly defaultAgentId: string;
  readonly defaultConversationMode: ConversationMode;
  readonly allowGroups: boolean;
  readonly processMessagesFromSelf: boolean;
  readonly rateLimit: ChannelRateLimitSettings;
}

export function createDefaultChannelSettings(defaultAgentId = ""): ChannelSettings {
  return {
    enabled: false,
    pauseAll: false,
    defaultAgentId,
    defaultConversationMode: "disabled",
    allowGroups: false,
    processMessagesFromSelf: false,
    rateLimit: {
      auto: { maxMessages: 5, windowMs: 60_000 },
      global: { maxMessages: 60, windowMs: 60_000 },
    },
  };
}

export const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = createDefaultChannelSettings();
