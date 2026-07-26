import { join } from "node:path";
import { JsonCollection } from "./json-collection.js";
import type {
  AgentRepository,
  ChatSession,
  Reminder,
  ReminderOccurrence,
  ReminderOccurrenceRepository,
  ReminderRepository,
  SessionRepository,
  StoredAgent,
} from "./types.js";
import {
  isChatSession,
  isReminder,
  isReminderOccurrence,
  isStoredAgent,
} from "./validators.js";

export class JsonAgentRepository implements AgentRepository {
  private readonly collection: JsonCollection<StoredAgent>;

  constructor(storagePath: string) {
    this.collection = new JsonCollection(join(storagePath, "agents.json"), isStoredAgent);
  }

  list(): Promise<readonly StoredAgent[]> { return this.collection.read(); }
  async findById(id: string): Promise<StoredAgent | undefined> {
    return (await this.list()).find((agent) => agent.id === id);
  }
  async save(agent: StoredAgent): Promise<void> { await upsert(this.collection, agent); }
}

export class JsonSessionRepository implements SessionRepository {
  private readonly collection: JsonCollection<ChatSession>;

  constructor(storagePath: string) {
    this.collection = new JsonCollection(join(storagePath, "sessions.json"), isChatSession);
  }

  list(): Promise<readonly ChatSession[]> { return this.collection.read(); }
  async findById(id: string): Promise<ChatSession | undefined> {
    return (await this.list()).find((session) => session.id === id);
  }
  async save(session: ChatSession): Promise<void> { await upsert(this.collection, session); }
}

export class JsonReminderRepository implements ReminderRepository {
  private readonly collection: JsonCollection<Reminder>;

  constructor(storagePath: string) {
    this.collection = new JsonCollection(join(storagePath, "reminders.json"), isReminder);
  }

  async list(agentId?: string): Promise<readonly Reminder[]> {
    const reminders = await this.collection.read();
    return agentId ? reminders.filter((reminder) => reminder.agentId === agentId) : reminders;
  }
  async findById(id: string): Promise<Reminder | undefined> {
    return (await this.list()).find((reminder) => reminder.id === id);
  }
  async save(reminder: Reminder): Promise<void> { await upsert(this.collection, reminder); }
  async delete(id: string): Promise<void> {
    await this.collection.mutate((items) => {
      const next = items.filter((item) => item.id !== id);
      return next;
    });
  }
}

export class JsonReminderOccurrenceRepository implements ReminderOccurrenceRepository {
  private readonly collection: JsonCollection<ReminderOccurrence>;

  constructor(storagePath: string) {
    this.collection = new JsonCollection(
      join(storagePath, "reminder-occurrences.json"), isReminderOccurrence,
    );
  }

  async findByReminderAndScheduledFor(reminderId: string, scheduledFor: string) {
    return (await this.list()).find((occurrence) => (
      occurrence.reminderId === reminderId && occurrence.scheduledFor === scheduledFor
    ));
  }
  async list(filters?: {
    readonly reminderId?: string;
    readonly status?: ReminderOccurrence["status"];
    readonly after?: string;
  }): Promise<readonly ReminderOccurrence[]> {
    const occurrences = await this.collection.read();
    return occurrences.filter((occurrence) => (
      (!filters?.reminderId || occurrence.reminderId === filters.reminderId)
      && (!filters?.status || occurrence.status === filters.status)
      && (!filters?.after || occurrence.scheduledFor > filters.after)
    ));
  }
  async save(occurrence: ReminderOccurrence): Promise<void> { await upsert(this.collection, occurrence); }
}

async function upsert<T extends { readonly id: string }>(
  collection: JsonCollection<T>, item: T,
): Promise<void> {
  await collection.mutate((items) => {
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index < 0) return [...items, item];
    return items.map((existing) => existing.id === item.id ? item : existing);
  });
}
