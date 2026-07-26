import type { AgentDefinition, ChatMessage, ChatSession } from "@flowmind/agent-core";

export interface ConversationInput {
  readonly agent: AgentDefinition;
  readonly session: ChatSession;
  readonly message: ChatMessage;
}

export interface ConversationOutput {
  readonly content: string;
}

export interface ConversationProvider {
  readonly id: string;
  generateResponse(input: ConversationInput): Promise<ConversationOutput>;
}

export interface ConversationContext extends ConversationInput {}

export interface ConversationRule {
  readonly id: string;
  readonly priority: number;
  matches(context: ConversationContext): boolean;
  respond(context: ConversationContext): Promise<string>;
}
