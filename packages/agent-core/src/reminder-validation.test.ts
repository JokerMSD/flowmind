import assert from "node:assert/strict";
import test from "node:test";
import { InvalidPayloadError, InvalidTimeError } from "./errors.js";
import { normalizeReminderMessage, normalizeReminderSchedule } from "./reminder-validation.js";

test("normalizes reminder schedule into deterministic values", () => {
  const schedule = normalizeReminderSchedule({
    daysOfWeek: [5, 1, 1], times: ["20:00", "08:00", "20:00"], timezone: " America/Sao_Paulo ",
  });
  assert.deepEqual(schedule, { daysOfWeek: [1, 5], times: ["08:00", "20:00"], timezone: "America/Sao_Paulo" });
});

test("rejects missing reminder schedule fields and invalid time", () => {
  assert.throws(() => normalizeReminderSchedule({ daysOfWeek: [], times: ["08:00"], timezone: "UTC" }), InvalidPayloadError);
  assert.throws(() => normalizeReminderSchedule({ daysOfWeek: [1], times: [], timezone: "UTC" }), InvalidPayloadError);
  assert.throws(() => normalizeReminderSchedule({ daysOfWeek: [1], times: ["8:00"], timezone: "UTC" }), InvalidTimeError);
  assert.throws(() => normalizeReminderMessage("   "), InvalidPayloadError);
});
