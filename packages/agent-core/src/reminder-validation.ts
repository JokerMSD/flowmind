import { InvalidPayloadError, InvalidTimeError } from "./errors.js";
import type { ReminderSchedule, Weekday } from "./models.js";

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface ReminderScheduleInput {
  readonly daysOfWeek: readonly number[];
  readonly times: readonly string[];
  readonly timezone: string;
}

export function normalizeReminderSchedule(input: ReminderScheduleInput): ReminderSchedule {
  const timezone = input.timezone.trim();
  if (!timezone) throw new InvalidPayloadError("Reminder timezone is required");
  if (input.daysOfWeek.length === 0) throw new InvalidPayloadError("At least one weekday is required");
  if (input.times.length === 0) throw new InvalidPayloadError("At least one reminder time is required");
  const days = [...new Set(input.daysOfWeek)].sort((left, right) => left - right);
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new InvalidPayloadError("Reminder weekdays must be between 0 and 6");
  }
  const times = [...new Set(input.times.map((time) => time.trim()))].sort();
  for (const time of times) if (!timePattern.test(time)) throw new InvalidTimeError(time);
  return { daysOfWeek: days as Weekday[], times, timezone };
}

export function normalizeReminderMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) throw new InvalidPayloadError("Reminder message is required");
  return normalized;
}
