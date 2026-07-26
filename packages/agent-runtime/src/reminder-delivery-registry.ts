import { ProviderNotRegisteredError } from "@flowmind/agent-core";
import type { Reminder, ReminderDeliveryProvider, ReminderOccurrence } from "@flowmind/agent-core";

export class ReminderDeliveryProviderRegistry {
  private readonly providers = new Map<string, ReminderDeliveryProvider>();

  public register(channelId: string, provider: ReminderDeliveryProvider): void {
    if (this.providers.has(channelId)) {
      throw new Error(`Reminder delivery provider already registered: ${channelId}`);
    }
    this.providers.set(channelId, provider);
  }

  public resolve(channelId: string): ReminderDeliveryProvider {
    const provider = this.providers.get(channelId);
    if (!provider) throw new ProviderNotRegisteredError(channelId);
    return provider;
  }
}

export class RoutingReminderDeliveryProvider implements ReminderDeliveryProvider {
  public readonly id = "routing";

  public constructor(
    private readonly internal: ReminderDeliveryProvider,
    private readonly registry: ReminderDeliveryProviderRegistry,
  ) {}

  public deliver(occurrence: ReminderOccurrence, reminder: Reminder): Promise<void> {
    if (!reminder.target) return this.internal.deliver(occurrence, reminder);
    return this.registry.resolve(reminder.target.channelId).deliver(occurrence, reminder);
  }
}
