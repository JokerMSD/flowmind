import type { Agent as SchemaAgent, AgentId } from "@flowmind/schema";

export interface ActivationPolicy {
  readonly mention: boolean;
  readonly keywords: readonly string[];
  readonly probability: number;
  readonly canInitiateConversation: boolean;
  readonly cooldownMinutes: number;
}

export interface AgentDefinition extends SchemaAgent {
  readonly conversationProvider: string;
  readonly activationPolicy: ActivationPolicy;
  readonly capabilities: readonly string[];
  readonly enabled: boolean;
}

export type ChatRole = "user" | "agent" | "system";

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly timestamp: string;
}

export interface ChatSession {
  readonly id: string;
  readonly agentId: AgentId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessage[];
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ReminderSchedule {
  readonly daysOfWeek: readonly Weekday[];
  readonly times: readonly string[];
  readonly timezone: string;
}

export interface Reminder {
  readonly id: string;
  readonly agentId: AgentId;
  readonly type: "shape-photo";
  readonly message: string;
  readonly schedule: ReminderSchedule;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ReminderOccurrenceStatus = "pending" | "delivered" | "failed";

export interface ReminderOccurrence {
  readonly id: string;
  readonly reminderId: string;
  readonly scheduledFor: string;
  readonly detectedAt: string;
  readonly deliveredAt?: string;
  readonly status: ReminderOccurrenceStatus;
}
