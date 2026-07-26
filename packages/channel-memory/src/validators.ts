import type {
  ChannelConnection,
  ChannelConversation,
  ChannelMessage,
  ChannelSettings,
  ExternalMessageRecord,
} from "@flowmind/channel-core";

const modes = new Set(["disabled", "enabled", "paused", "manual", "blocked"]);
const connectionStatuses = new Set([
  "disconnected",
  "connecting",
  "waiting_for_qr",
  "authenticated",
  "connected",
  "reconnecting",
  "logged_out",
  "error",
]);
const messageStatuses = new Set(["received", "pending", "sent", "failed", "ignored"]);
const externalStatuses = new Set(["received", "processing", "processed", "failed", "ignored"]);

export function isChannelConnection(value: unknown): value is ChannelConnection {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.channelId) &&
    isString(value.providerId) &&
    isString(value.name) &&
    typeof value.enabled === "boolean" &&
    isString(value.status) &&
    connectionStatuses.has(value.status) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

export function isChannelConversation(value: unknown): value is ChannelConversation {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.channelId) &&
    isString(value.connectionId) &&
    isString(value.externalConversationId) &&
    (value.type === "private" || value.type === "group") &&
    optionalString(value.displayName) &&
    optionalString(value.normalizedPhone) &&
    isString(value.agentId) &&
    optionalString(value.sessionId) &&
    isString(value.automationMode) &&
    modes.has(value.automationMode) &&
    typeof value.unreadCount === "number" &&
    optionalString(value.lastMessagePreview) &&
    optionalString(value.lastMessageAt) &&
    optionalString(value.lastInboundAt) &&
    optionalString(value.lastOutboundAt) &&
    optionalString(value.lastError) &&
    isObject(value.metadata) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

export function isChannelMessage(value: unknown): value is ChannelMessage {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.conversationId) &&
    isString(value.connectionId) &&
    (value.direction === "inbound" || value.direction === "outbound") &&
    isString(value.content) &&
    isString(value.status) &&
    messageStatuses.has(value.status) &&
    optionalString(value.providerMessageId) &&
    optionalString(value.replyToMessageId) &&
    optionalString(value.error) &&
    isString(value.createdAt)
  );
}

export function isExternalMessageRecord(value: unknown): value is ExternalMessageRecord {
  return (
    isObject(value) &&
    isString(value.connectionId) &&
    isString(value.providerMessageId) &&
    isString(value.messageId) &&
    isString(value.status) &&
    externalStatuses.has(value.status) &&
    isString(value.recordedAt) &&
    isString(value.updatedAt) &&
    optionalString(value.error)
  );
}

export function isChannelSettings(value: unknown): value is ChannelSettings {
  return (
    isObject(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.pauseAll === "boolean" &&
    isString(value.defaultAgentId) &&
    isString(value.defaultConversationMode) &&
    modes.has(value.defaultConversationMode) &&
    typeof value.allowGroups === "boolean" &&
    typeof value.processMessagesFromSelf === "boolean" &&
    isRateLimit(value.rateLimit)
  );
}

export function isArrayOf<T>(
  isItem: (value: unknown) => value is T,
): (value: unknown) => value is T[] {
  return (value): value is T[] => Array.isArray(value) && value.every(isItem);
}

function isRateLimit(value: unknown): boolean {
  return isObject(value) && isLimit(value.auto) && isLimit(value.global);
}

function isLimit(value: unknown): boolean {
  return (
    isObject(value) && typeof value.maxMessages === "number" && typeof value.windowMs === "number"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
function optionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}
