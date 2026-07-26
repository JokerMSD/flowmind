import type { AgentId } from "@flowmind/schema";
import type {
  AgentDefinition,
  ChatSession,
  Reminder,
  ReminderOccurrence,
  ReminderOccurrenceStatus,
} from "./models.js";

export interface AgentRepository {
  findById(id: AgentId): Promise<AgentDefinition | undefined>;
  list(): Promise<readonly AgentDefinition[]>;
  save(agent: AgentDefinition): Promise<void>;
}

export interface SessionRepository {
  findById(id: string): Promise<ChatSession | undefined>;
  save(session: ChatSession): Promise<void>;
}

export interface ReminderRepository {
  findById(id: string): Promise<Reminder | undefined>;
  list(agentId?: AgentId): Promise<readonly Reminder[]>;
  save(reminder: Reminder): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ReminderOccurrenceRepository {
  findByReminderAndScheduledFor(reminderId: string, scheduledFor: string): Promise<ReminderOccurrence | undefined>;
  list(filters?: ReminderOccurrenceFilters): Promise<readonly ReminderOccurrence[]>;
  save(occurrence: ReminderOccurrence): Promise<void>;
}

export interface ReminderOccurrenceFilters {
  readonly reminderId?: string;
  readonly status?: ReminderOccurrenceStatus;
  readonly after?: string;
}

export interface Clock {
  now(): Date;
}

export interface Scheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ReminderDueEvaluator {
  evaluate(reminder: Reminder, now: Date): ReminderOccurrence | null;
}

export interface ReminderDeliveryProvider {
  readonly id: string;
  deliver(occurrence: ReminderOccurrence, reminder: Reminder): Promise<void>;
}
