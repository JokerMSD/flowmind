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
  OllamaConversationProvider,
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
  const fallbackProvider = new FakeConversationProvider();
  providers.register(fallbackProvider);
  providers.register(
    new OllamaConversationProvider({
      ...(environment.OLLAMA_BASE_URL === undefined
        ? {}
        : { baseUrl: environment.OLLAMA_BASE_URL }),
      ...(environment.OLLAMA_MODEL === undefined ? {} : { model: environment.OLLAMA_MODEL }),
      timeoutMs: readPositiveInteger(environment.OLLAMA_TIMEOUT_MS, 120_000),
      fallback: fallbackProvider,
    }),
  );

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
      const csnf = await seedCsnf(agents);
      if (environment.FLOWMIND_AI_PROVIDER === "ollama") {
        await agents.save({
          ...csnf,
          conversationProvider: "ollama",
          aiModel: {
            provider: "ollama",
            model: environment.OLLAMA_MODEL ?? "gemma4:e2b-it-qat",
            settings: {
              baseUrl: environment.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
            },
          },
          activationPolicy: {
            ...csnf.activationPolicy,
            mention: true,
          },
        });
      }
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
