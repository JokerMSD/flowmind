import {
  InvalidPayloadError,
  normalizeReminderMessage,
  normalizeReminderSchedule,
} from "@flowmind/agent-core";
import type { ReminderOccurrenceStatus } from "@flowmind/agent-core";
import type { ReminderInput } from "@flowmind/agent-runtime";

export function parseChatBody(value: unknown): {
  readonly agentId: string;
  readonly message: string;
  readonly sessionId?: string;
} {
  const body = requireRecord(value);
  return {
    agentId: requireNonEmptyString(body.agentId, "agentId"),
    message: requireNonEmptyString(body.message, "message"),
    ...(body.sessionId === undefined
      ? {}
      : { sessionId: requireNonEmptyString(body.sessionId, "sessionId") }),
  };
}

export function parseReminderBody(value: unknown): ReminderInput {
  const body = requireRecord(value);
  const schedule = requireRecord(body.schedule);
  if (body.type !== "shape-photo") throw new InvalidPayloadError("type must be shape-photo");
  if (typeof body.enabled !== "boolean") throw new InvalidPayloadError("enabled must be boolean");
  const normalizedSchedule = normalizeReminderSchedule({
    daysOfWeek: requireNumberArray(schedule.daysOfWeek, "daysOfWeek"),
    times: requireStringArray(schedule.times, "times"),
    timezone: requireNonEmptyString(schedule.timezone, "timezone"),
  });
  validateTimezone(normalizedSchedule.timezone);
  return {
    agentId: requireNonEmptyString(body.agentId, "agentId"),
    type: "shape-photo",
    message: normalizeReminderMessage(requireNonEmptyString(body.message, "message")),
    enabled: body.enabled,
    schedule: normalizedSchedule,
    ...(body.target === undefined ? {} : { target: parseReminderTarget(body.target) }),
  };
}

function parseReminderTarget(value: unknown): NonNullable<ReminderInput["target"]> {
  const target = requireRecord(value);
  return {
    channelId: requireNonEmptyString(target.channelId, "target.channelId"),
    connectionId: requireNonEmptyString(target.connectionId, "target.connectionId"),
    conversationId: requireNonEmptyString(target.conversationId, "target.conversationId"),
  };
}

export function parseStatusBody(value: unknown): { readonly enabled: boolean } {
  const body = requireRecord(value);
  if (typeof body.enabled !== "boolean") throw new InvalidPayloadError("enabled must be boolean");
  return { enabled: body.enabled };
}

export function parseRequiredId(value: unknown, field: string): string {
  return requireNonEmptyString(value, field);
}

export function parseOptionalAgentId(value: unknown): string | undefined {
  return value === undefined ? undefined : requireNonEmptyString(value, "agentId");
}

export function parseOccurrenceQuery(value: unknown): {
  readonly agentId?: string;
  readonly status?: ReminderOccurrenceStatus;
  readonly after?: string;
} {
  const query = requireRecord(value);
  const status = query.status === undefined ? undefined : requireOccurrenceStatus(query.status);
  const after = query.after === undefined ? undefined : requireIsoTimestamp(query.after, "after");
  return {
    ...(query.agentId === undefined
      ? {}
      : { agentId: requireNonEmptyString(query.agentId, "agentId") }),
    ...(status === undefined ? {} : { status }),
    ...(after === undefined ? {} : { after }),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidPayloadError("Request body must be an object");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new InvalidPayloadError(`${field} must be a string`);
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  const string = requireString(value, field).trim();
  if (!string) throw new InvalidPayloadError(`${field} must not be empty`);
  return string;
}

function requireStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new InvalidPayloadError(`${field} must be a string array`);
  }
  return value;
}

function requireNumberArray(value: unknown, field: string): readonly number[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "number")) {
    throw new InvalidPayloadError(`${field} must be a number array`);
  }
  return value;
}

function requireOccurrenceStatus(value: unknown): ReminderOccurrenceStatus {
  if (value === "pending" || value === "delivered" || value === "failed") return value;
  throw new InvalidPayloadError("status must be pending, delivered, or failed");
}

function requireIsoTimestamp(value: unknown, field: string): string {
  const timestamp = requireNonEmptyString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new InvalidPayloadError(`${field} must be an ISO timestamp`);
  }
  return timestamp;
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new InvalidPayloadError("timezone must be a valid IANA timezone");
  }
}
