import {
  AgentDisabledError,
  AgentNotFoundError,
  InvalidPayloadError,
  SessionAgentMismatchError,
  SessionNotFoundError,
} from "@flowmind/agent-core";
import type { AgentRepository, ChatMessage, ChatSession, Clock, SessionRepository } from "@flowmind/agent-core";
import type { ConversationProviderRegistry } from "./conversation-provider-registry.js";

export interface ChatRequest {
  readonly agentId: string;
  readonly message: string;
  readonly sessionId?: string;
}

export interface ChatResult {
  readonly session: ChatSession;
  readonly message: ChatMessage;
}

export interface IdentifierGenerator {
  next(): string;
}

export class AgentRuntime {
  public constructor(
    private readonly agents: AgentRepository,
    private readonly sessions: SessionRepository,
    private readonly providers: ConversationProviderRegistry,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async chat(request: ChatRequest): Promise<ChatResult> {
    const content = normalizeChatMessage(request.message);
    const agent = await this.agents.findById(request.agentId);
    if (!agent) throw new AgentNotFoundError(request.agentId);
    if (!agent.enabled) throw new AgentDisabledError(agent.id);
    const session = await this.resolveSession(request.sessionId, agent.id);
    const userMessage = this.message("user", content);
    const withUser = appendMessage(session, userMessage, this.clock.now().toISOString());
    await this.sessions.save(withUser);
    const output = await this.providers.resolve(agent.conversationProvider).generateResponse({
      agent, session: withUser, message: userMessage,
    });
    const agentMessage = this.message("agent", output.content);
    const completed = appendMessage(withUser, agentMessage, this.clock.now().toISOString());
    await this.sessions.save(completed);
    return { session: completed, message: agentMessage };
  }

  private async resolveSession(sessionId: string | undefined, agentId: string): Promise<ChatSession> {
    if (!sessionId) {
      const now = this.clock.now().toISOString();
      return { id: this.identifiers.next(), agentId, createdAt: now, updatedAt: now, messages: [] };
    }
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    if (session.agentId !== agentId) throw new SessionAgentMismatchError(sessionId);
    return session;
  }

  private message(role: ChatMessage["role"], content: string): ChatMessage {
    return { id: this.identifiers.next(), role, content, timestamp: this.clock.now().toISOString() };
  }
}

function normalizeChatMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) throw new InvalidPayloadError("Chat message is required");
  return normalized;
}

function appendMessage(session: ChatSession, message: ChatMessage, updatedAt: string): ChatSession {
  return { ...session, updatedAt, messages: [...session.messages, message] };
}
