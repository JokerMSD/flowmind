export { WHATSAPP_CHANNEL_ID } from "./channel.js";
export type { Channel, ChannelId } from "./channel.js";
export {
  CHANNEL_CONNECTION_STATUSES,
  createWhatsAppPersonalConnectionSeed,
  WHATSAPP_PERSONAL_CONNECTION_ID,
  WHATSAPP_WEB_PROVIDER_ID,
} from "./connection.js";
export type {
  ChannelAddress,
  ChannelConnection,
  ChannelConnectionStatus,
  ChannelConnectionStatusEvent,
  ProviderConnection,
} from "./connection.js";
export { defaultAutomationModeForConversation } from "./conversation.js";
export type {
  ChannelConversation,
  ConversationAutomationMode,
  ConversationMetadata,
  ConversationMode,
  ConversationType,
} from "./conversation.js";
export { EXTERNAL_MESSAGE_STATUSES, externalMessageKey } from "./external-message.js";
export type {
  ExternalMessageKey,
  ExternalMessageRecord,
  ExternalMessageStatus,
} from "./external-message.js";
export {
  ChannelCoreError,
  DuplicateChannelProviderError,
  InvalidQueueOptionsError,
  UnknownChannelProviderError,
} from "./errors.js";
export type {
  ChannelInboundMessage,
  ChannelMessage,
  ChannelMessageDirection,
  ChannelMessageStatus,
  ChannelOutboundMessage,
  ChannelSendResult,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from "./message.js";
export type {
  ChannelProvider,
  ChannelProviderListener,
  ChannelProviderRegistry,
} from "./provider.js";
export type { MessageQueue, QueueErrorHandler, QueueOfferResult, QueueWorker } from "./queue.js";
export type {
  ChannelConnectionRepository,
  ChannelConversationRepository,
  ChannelMessageRepository,
  ChannelSettingsRepository,
  ExternalMessageRecordRepository,
} from "./repositories.js";
export { createDefaultChannelSettings, DEFAULT_CHANNEL_SETTINGS } from "./settings.js";
export type { ChannelRateLimitSettings, ChannelSettings, RateLimitSettings } from "./settings.js";
