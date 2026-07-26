export type AgentSummary = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly enabled: boolean;
};

export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "agent" | "system";
  readonly content: string;
  readonly timestamp: string;
};

export type ChatSession = {
  readonly id: string;
  readonly agentId: string;
  readonly messages: readonly ChatMessage[];
};

export type ChatResponse = {
  readonly sessionId: string;
  readonly message: ChatMessage;
  readonly agent: Pick<AgentSummary, "id" | "name">;
};

export type ReminderInput = {
  readonly agentId: string;
  readonly type: "shape-photo";
  readonly message: string;
  readonly schedule: {
    readonly daysOfWeek: readonly number[];
    readonly times: readonly string[];
    readonly timezone: string;
  };
  readonly enabled: boolean;
};

export type Reminder = ReminderInput & {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ReminderOccurrence = {
  readonly id: string;
  readonly reminderId: string;
  readonly scheduledFor: string;
  readonly detectedAt: string;
  readonly deliveredAt?: string;
  readonly status: "pending" | "delivered" | "failed";
};

export type Feedback = {
  readonly kind: "success" | "error";
  readonly message: string;
};
