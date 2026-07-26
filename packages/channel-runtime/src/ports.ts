export interface AgentChatRequest {
  readonly agentId: string;
  readonly message: string;
  readonly sessionId?: string;
  readonly target?: {
    readonly channelId: string;
    readonly connectionId: string;
    readonly conversationId: string;
  };
}

export interface AgentChatResult {
  readonly session: {
    readonly id: string;
  };
  readonly message: {
    readonly content: string;
  };
}

export interface AgentRuntimePort {
  chat(request: AgentChatRequest): Promise<AgentChatResult>;
}

export interface Clock {
  now(): Date;
}

export interface IdentifierGenerator {
  next(): string;
}
