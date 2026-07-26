import assert from "node:assert/strict";
import test from "node:test";
import { csnfAgent } from "@flowmind/agent-core";
import type {
  AgentDefinition, AgentRepository, ChatSession, Reminder, ReminderOccurrence, ReminderOccurrenceFilters,
  ReminderOccurrenceRepository, ReminderRepository, SessionRepository,
} from "@flowmind/agent-core";
import { AgentRuntime } from "./agent-runtime.js";
import { FixedClock } from "./clock.js";
import { ConversationProviderRegistry } from "./conversation-provider-registry.js";
import { FakeConversationProvider } from "./fake-conversation-provider.js";
import { InAppReminderDeliveryProvider } from "./in-app-reminder-delivery-provider.js";
import { TimezoneReminderDueEvaluator } from "./reminder-due-evaluator.js";
import { ReminderScheduler } from "./reminder-scheduler.js";
import { ReminderService } from "./reminder-service.js";

class MemoryAgents implements AgentRepository {
  public constructor(private readonly values: readonly AgentDefinition[]) {}
  public async findById(id: string): Promise<AgentDefinition | undefined> { return this.values.find((agent) => agent.id === id); }
  public async list(): Promise<readonly AgentDefinition[]> { return this.values; }
  public async save(_agent: AgentDefinition): Promise<void> {}
}

class MemorySessions implements SessionRepository {
  public readonly values = new Map<string, ChatSession>();
  public async findById(id: string): Promise<ChatSession | undefined> { return this.values.get(id); }
  public async save(session: ChatSession): Promise<void> { this.values.set(session.id, session); }
}

class MemoryReminders implements ReminderRepository {
  public readonly values = new Map<string, Reminder>();
  public async findById(id: string): Promise<Reminder | undefined> { return this.values.get(id); }
  public async list(agentId?: string): Promise<readonly Reminder[]> { return [...this.values.values()].filter((item) => !agentId || item.agentId === agentId); }
  public async save(reminder: Reminder): Promise<void> { this.values.set(reminder.id, reminder); }
  public async delete(id: string): Promise<void> { this.values.delete(id); }
}

class MemoryOccurrences implements ReminderOccurrenceRepository {
  public readonly values = new Map<string, ReminderOccurrence>();
  public async findByReminderAndScheduledFor(reminderId: string, scheduledFor: string): Promise<ReminderOccurrence | undefined> {
    return [...this.values.values()].find((item) => item.reminderId === reminderId && item.scheduledFor === scheduledFor);
  }
  public async list(filters?: ReminderOccurrenceFilters): Promise<readonly ReminderOccurrence[]> {
    return [...this.values.values()].filter((item) => !filters?.status || item.status === filters.status);
  }
  public async save(occurrence: ReminderOccurrence): Promise<void> { this.values.set(occurrence.id, occurrence); }
}

class SequenceIds { private current = 0; public next(): string { this.current += 1; return `id-${this.current}`; } }

test("chat persists a new session and continues it through the registry", async () => {
  const sessions = new MemorySessions();
  const registry = new ConversationProviderRegistry();
  registry.register(new FakeConversationProvider());
  const runtime = new AgentRuntime(new MemoryAgents([csnfAgent]), sessions, registry, new FixedClock(new Date("2026-07-26T12:00:00Z")), new SequenceIds());
  const greeting = await runtime.chat({ agentId: "csnf", message: "Ola" });
  const reminder = await runtime.chat({ agentId: "csnf", message: "Me lembra da foto" });
  const accentedGreeting = await runtime.chat({ agentId: "csnf", message: "Olá" });
  const first = await runtime.chat({ agentId: "csnf", message: "  preciso treinar  " });
  const second = await runtime.chat({ agentId: "csnf", sessionId: first.session.id, message: "qualquer assunto" });
  assert.equal(first.message.content, "Bora! Qual grupo muscular voce pretende treinar hoje?");
  assert.equal(greeting.message.content, "Fala! Como esta o shape hoje?");
  assert.equal(accentedGreeting.message.content, "Fala! Como esta o shape hoje?");
  assert.equal(reminder.message.content, "Voce pode configurar aqui os dias e horarios do lembrete da foto do shape.");
  assert.equal(second.session.messages.length, 4);
  assert.match(second.message.content, /To contigo/);
  assert.throws(() => registry.resolve("missing"), /Provider is not registered/);
  await sessions.save({
    id: "foreign-session",
    agentId: "other",
    createdAt: "2026-07-26T12:00:00Z",
    updatedAt: "2026-07-26T12:00:00Z",
    messages: [],
  });
  await assert.rejects(
    runtime.chat({ agentId: "csnf", sessionId: "foreign-session", message: "Ola" }),
    /does not belong/,
  );
  await assert.rejects(runtime.chat({ agentId: "csnf", message: "   " }), /required/);
});

test("reminders are normalized, delivered once, and ignored when disabled", async () => {
  const clock = new FixedClock(new Date("2026-07-27T11:00:00Z"));
  const reminders = new MemoryReminders();
  const occurrences = new MemoryOccurrences();
  const service = new ReminderService(new MemoryAgents([csnfAgent]), reminders, clock, new SequenceIds());
  const reminder = await service.create({
    agentId: "csnf", type: "shape-photo", message: " Foto do shape ", enabled: true,
    schedule: { daysOfWeek: [1, 1], times: ["08:00", "08:00"], timezone: "America/Sao_Paulo" },
  });
  const scheduler = new ReminderScheduler(reminders, occurrences, new TimezoneReminderDueEvaluator(), new InAppReminderDeliveryProvider(occurrences, clock), clock, { recoveryWindowMs: 0 });
  await scheduler.runOnce();
  await scheduler.runOnce();
  assert.equal((await occurrences.list()).length, 1);
  assert.equal((await occurrences.list())[0]?.status, "delivered");
  await service.setStatus(reminder.id, false);
  await scheduler.runOnce();
  assert.equal((await occurrences.list()).length, 1);
});

test("scheduler recovers only occurrences inside the configured window", async () => {
  const clock = new FixedClock(new Date("2026-07-27T11:10:00Z"));
  const reminders = new MemoryReminders();
  const occurrences = new MemoryOccurrences();
  const service = new ReminderService(new MemoryAgents([csnfAgent]), reminders, clock, new SequenceIds());
  await service.create({
    agentId: "csnf",
    type: "shape-photo",
    message: "Dentro da janela",
    enabled: true,
    schedule: { daysOfWeek: [1], times: ["08:05"], timezone: "America/Sao_Paulo" },
  });
  await service.create({
    agentId: "csnf",
    type: "shape-photo",
    message: "Fora da janela",
    enabled: true,
    schedule: { daysOfWeek: [1], times: ["07:59"], timezone: "America/Sao_Paulo" },
  });
  const scheduler = new ReminderScheduler(
    reminders,
    occurrences,
    new TimezoneReminderDueEvaluator(),
    new InAppReminderDeliveryProvider(occurrences, clock),
    clock,
    { intervalMs: 60_000, recoveryWindowMs: 10 * 60_000 },
  );
  await scheduler.start();
  await scheduler.stop();
  const delivered = await occurrences.list();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.status, "delivered");
});
