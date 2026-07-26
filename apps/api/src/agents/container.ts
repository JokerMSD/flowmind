import { randomUUID } from "node:crypto";

import {
  JsonAgentRepository,
  JsonReminderOccurrenceRepository,
  JsonReminderRepository,
  JsonSessionRepository,
  resolveStoragePath,
  seedCsnf,
} from "@flowmind/agent-memory";
import {
  AgentRuntime,
  ConversationProviderRegistry,
  FakeConversationProvider,
  InAppReminderDeliveryProvider,
  ReminderDeliveryProviderRegistry,
  ReminderScheduler,
  ReminderService,
  RoutingReminderDeliveryProvider,
  SystemClock,
  TimezoneReminderDueEvaluator,
} from "@flowmind/agent-runtime";

export function createAgentContainer(environment: NodeJS.ProcessEnv = process.env) {
  const storagePath = resolveStoragePath(environment);
  const agents = new JsonAgentRepository(storagePath);
  const sessions = new JsonSessionRepository(storagePath);
  const reminders = new JsonReminderRepository(storagePath);
  const occurrences = new JsonReminderOccurrenceRepository(storagePath);
  const clock = new SystemClock();
  const identifiers = { next: randomUUID };
  const providers = new ConversationProviderRegistry();
  providers.register(new FakeConversationProvider());

  const runtime = new AgentRuntime(agents, sessions, providers, clock, identifiers);
  const reminderService = new ReminderService(agents, reminders, clock, identifiers);
  const inAppDelivery = new InAppReminderDeliveryProvider(occurrences, clock);
  const reminderDeliveries = new ReminderDeliveryProviderRegistry();
  const delivery = new RoutingReminderDeliveryProvider(inAppDelivery, reminderDeliveries);
  const scheduler = new ReminderScheduler(
    reminders,
    occurrences,
    new TimezoneReminderDueEvaluator(),
    delivery,
    clock,
    {
      intervalMs: readPositiveInteger(environment.FLOWMIND_SCHEDULER_INTERVAL_MS, 30_000),
      recoveryWindowMs:
        readPositiveInteger(environment.FLOWMIND_REMINDER_RECOVERY_MINUTES, 10) * 60_000,
    },
  );

  return {
    agents,
    initialize: async () => {
      await seedCsnf(agents);
      await scheduler.start();
    },
    occurrences,
    reminderDeliveries,
    reminders,
    reminderService,
    runtime,
    scheduler,
    sessions,
    storagePath,
  };
}

export type AgentContainer = ReturnType<typeof createAgentContainer>;

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
