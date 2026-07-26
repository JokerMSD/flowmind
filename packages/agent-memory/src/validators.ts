import type {
  ActivationPolicy,
  ChatMessage,
  ChatSession,
  Reminder,
  ReminderOccurrence,
  StoredAgent,
} from "./types.js";

const roles = new Set(["user", "agent", "system"]);
const statuses = new Set(["pending", "delivered", "failed"]);

export function isStoredAgent(value: unknown): value is StoredAgent {
  if (!isRecord(value)) return false;
  return isString(value.id) && isString(value.name) && isString(value.description)
    && isString(value.conversationProvider) && isActivationPolicy(value.activationPolicy)
    && isStrings(value.capabilities) && typeof value.enabled === "boolean";
}

export function isChatSession(value: unknown): value is ChatSession {
  if (!isRecord(value)) return false;
  return isString(value.id) && isString(value.agentId) && isString(value.createdAt)
    && isString(value.updatedAt) && Array.isArray(value.messages)
    && value.messages.every(isChatMessage);
}

export function isReminder(value: unknown): value is Reminder {
  if (!isRecord(value) || !isRecord(value.schedule)) return false;
  const schedule = value.schedule;
  return isString(value.id) && isString(value.agentId) && isString(value.type)
    && isString(value.message) && isWeekdays(schedule.daysOfWeek) && isStrings(schedule.times)
    && isString(schedule.timezone) && typeof value.enabled === "boolean"
    && isString(value.createdAt) && isString(value.updatedAt);
}

export function isReminderOccurrence(value: unknown): value is ReminderOccurrence {
  if (!isRecord(value)) return false;
  const deliveredAt = value.deliveredAt;
  return isString(value.id) && isString(value.reminderId) && isString(value.scheduledFor)
    && isString(value.detectedAt) && typeof value.status === "string"
    && statuses.has(value.status) && (deliveredAt === undefined || isString(deliveredAt));
}

function isActivationPolicy(value: unknown): value is ActivationPolicy {
  if (!isRecord(value)) return false;
  return typeof value.mention === "boolean" && isStrings(value.keywords)
    && typeof value.probability === "number" && typeof value.canInitiateConversation === "boolean"
    && typeof value.cooldownMinutes === "number";
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value) && isString(value.id) && typeof value.role === "string"
    && roles.has(value.role) && isString(value.content) && isString(value.timestamp);
}

function isWeekdays(value: unknown): boolean {
  return Array.isArray(value) && value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
