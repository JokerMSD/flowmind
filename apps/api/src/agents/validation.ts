import { InvalidPayloadError } from "@flowmind/agent-core";
import type { ReminderInput } from "@flowmind/agent-runtime";

export function parseChatBody(value: unknown): {
  readonly agentId: string;
  readonly message: string;
  readonly sessionId?: string;
} {
  const body = requireRecord(value);
  return {
    agentId: requireString(body.agentId, "agentId"),
    message: requireString(body.message, "message"),
    ...(body.sessionId === undefined ? {} : { sessionId: requireString(body.sessionId, "sessionId") }),
  };
}

export function parseReminderBody(value: unknown): ReminderInput {
  const body = requireRecord(value);
  const schedule = requireRecord(body.schedule);
  if (body.type !== "shape-photo") throw new InvalidPayloadError("type must be shape-photo");
  if (typeof body.enabled !== "boolean") throw new InvalidPayloadError("enabled must be boolean");
  return {
    agentId: requireString(body.agentId, "agentId"),
    type: "shape-photo",
    message: requireString(body.message, "message"),
    enabled: body.enabled,
    schedule: {
      daysOfWeek: requireNumberArray(schedule.daysOfWeek, "daysOfWeek"),
      times: requireStringArray(schedule.times, "times"),
      timezone: requireString(schedule.timezone, "timezone"),
    },
  };
}

export function parseStatusBody(value: unknown): { readonly enabled: boolean } {
  const body = requireRecord(value);
  if (typeof body.enabled !== "boolean") throw new InvalidPayloadError("enabled must be boolean");
  return { enabled: body.enabled };
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
