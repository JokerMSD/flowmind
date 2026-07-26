import type { Reminder, ReminderDeliveryProvider, ReminderOccurrence, ReminderOccurrenceRepository } from "@flowmind/agent-core";
import type { Clock } from "@flowmind/agent-core";

export class InAppReminderDeliveryProvider implements ReminderDeliveryProvider {
  public readonly id = "in-app";
  public constructor(private readonly occurrences: ReminderOccurrenceRepository, private readonly clock: Clock) {}

  public async deliver(occurrence: ReminderOccurrence, _reminder: Reminder): Promise<void> {
    await this.occurrences.save({ ...occurrence, status: "delivered", deliveredAt: this.clock.now().toISOString() });
  }
}
