import type { Reminder, ReminderDueEvaluator, ReminderOccurrence } from "@flowmind/agent-core";

export class TimezoneReminderDueEvaluator implements ReminderDueEvaluator {
  public evaluate(reminder: Reminder, now: Date): ReminderOccurrence | null {
    if (!reminder.enabled) return null;
    const local = localDateTime(now, reminder.schedule.timezone);
    if (!reminder.schedule.daysOfWeek.includes(local.weekday) || !reminder.schedule.times.includes(local.time)) return null;
    const scheduledFor = `${local.date}T${local.time}:00${local.offset}`;
    if (Date.parse(reminder.createdAt) > Date.parse(scheduledFor)) return null;
    return {
      id: `${reminder.id}:${scheduledFor}`,
      reminderId: reminder.id,
      scheduledFor,
      detectedAt: now.toISOString(),
      status: "pending",
    };
  }
}

interface LocalDateTime { readonly date: string; readonly time: string; readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; readonly offset: string; }

function localDateTime(value: Date, timezone: string): LocalDateTime {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
    }).formatToParts(value);
    const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
    const weekday = weekdayNumber(get("weekday"));
    const offsetName = get("timeZoneName");
    return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}`, weekday, offset: offsetName.replace("GMT", "") || "Z" };
  } catch { throw new RangeError(`Invalid timezone: ${timezone}`); }
}

function weekdayNumber(value: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const weekdays: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdays[value];
  if (weekday === undefined) throw new RangeError(`Invalid weekday: ${value}`);
  return weekday;
}
