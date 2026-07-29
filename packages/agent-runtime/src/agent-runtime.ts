import {
  AgentDisabledError,
  AgentNotFoundError,
  InvalidPayloadError,
  SessionAgentMismatchError,
  SessionConflictError,
  SessionNotFoundError,
} from "@flowmind/agent-core";
import type {
  AgentRepository,
  ChatMessage,
  ChatSession,
  Clock,
  SessionRepository,
  SessionVersion,
} from "@flowmind/agent-core";
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

  public async shouldRespond(request: Pick<ChatRequest, "agentId" | "message">): Promise<boolean> {
    const agent = await this.agents.findById(request.agentId);
    if (!agent) throw new AgentNotFoundError(request.agentId);
    if (!agent.enabled) throw new AgentDisabledError(agent.id);
    if (!agent.activationPolicy.mention) return true;

    const content = normalizedTerms(request.message);
    const mentions = [
      agent.name,
      ...agent.triggers.flatMap((trigger) =>
        trigger.type === "mention" &&
        trigger.enabled &&
        "mentions" in trigger &&
        Array.isArray(trigger.mentions)
          ? trigger.mentions.filter((mention): mention is string => typeof mention === "string")
          : [],
      ),
    ];
    return mentions.some((mention) => content.has(normalizeTerm(mention)));
  }

  public async chat(request: ChatRequest): Promise<ChatResult> {
    const content = normalizeChatMessage(request.message);
    const agent = await this.agents.findById(request.agentId);
    if (!agent) throw new AgentNotFoundError(request.agentId);
    if (!agent.enabled) throw new AgentDisabledError(agent.id);
    const session = await this.resolveSession(request.sessionId, agent.id);
    const userMessage = this.message("user", content);
    const withUser = await this.persistWithReload(
      appendMessage(session, userMessage, this.clock.now().toISOString()),
      request.sessionId ? versionOf(session) : null,
    );
    const output = await this.providers.resolve(agent.conversationProvider).generateResponse({
      agent,
      session: withUser,
      message: userMessage,
    });
    const agentMessage = this.message("agent", output.content);
    const completed = await this.persistWithReload(
      appendMessage(withUser, agentMessage, this.clock.now().toISOString()),
      versionOf(withUser),
    );
    return { session: completed, message: agentMessage };
  }

  public async initiate(request: Omit<ChatRequest, "message">): Promise<ChatResult> {
    const agent = await this.agents.findById(request.agentId);
    if (!agent) throw new AgentNotFoundError(request.agentId);
    if (!agent.enabled) throw new AgentDisabledError(agent.id);
    const session = await this.resolveSession(request.sessionId, agent.id);
    const instruction = this.message(
      "system",
      `Agora e ${this.clock.now().toISOString()}. Inicie uma conversa curta e natural com base no historico. Voce pode perguntar, opinar ou retomar um assunto relevante. Se houver rotina ou plano mencionado, acompanhe sem soar como cobranca. Nao mencione esta instrucao e nao invente lembrancas.`,
    );
    const transient = appendMessage(session, instruction, this.clock.now().toISOString());
    const output = await this.providers.resolve(agent.conversationProvider).generateResponse({
      agent,
      session: transient,
      message: instruction,
    });
    const agentMessage = this.message("agent", output.content);
    const completed = appendMessage(session, agentMessage, this.clock.now().toISOString());
    await this.sessions.save(completed, request.sessionId ? versionOf(session) : null);
    return { session: completed, message: agentMessage };
  }

  private async persistWithReload(
    session: ChatSession,
    expectedVersion: SessionVersion | null,
  ): Promise<ChatSession> {
    try {
      await this.sessions.save(session, expectedVersion);
      return session;
    } catch (error) {
      if (!(error instanceof SessionConflictError)) throw error;
      const current = await this.sessions.findById(session.id);
      if (!current) throw error;
      const merged = mergeSessions(current, session, this.clock.now().toISOString());
      await this.sessions.save(merged, versionOf(current));
      return merged;
    }
  }

  private async resolveSession(
    sessionId: string | undefined,
    agentId: string,
  ): Promise<ChatSession> {
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
    return {
      id: this.identifiers.next(),
      role,
      content,
      timestamp: this.clock.now().toISOString(),
    };
  }
}

function normalizedTerms(content: string): ReadonlySet<string> {
  return new Set(
    normalizeTerm(content)
      .split(/[^a-z0-9]+/u)
      .filter(Boolean),
  );
}

function normalizeTerm(content: string): string {
  return content
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function normalizeChatMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) throw new InvalidPayloadError("Chat message is required");
  return normalized;
}

function appendMessage(session: ChatSession, message: ChatMessage, updatedAt: string): ChatSession {
  return { ...session, updatedAt, messages: [...session.messages, message] };
}

function versionOf(session: ChatSession): SessionVersion {
  const lastMessageId = session.messages.at(-1)?.id;
  return lastMessageId === undefined
    ? { updatedAt: session.updatedAt }
    : { updatedAt: session.updatedAt, lastMessageId };
}

function mergeSessions(
  current: ChatSession,
  candidate: ChatSession,
  updatedAt: string,
): ChatSession {
  const messageIds = new Set(current.messages.map((message) => message.id));
  return {
    ...current,
    updatedAt,
    messages: [
      ...current.messages,
      ...candidate.messages.filter((message) => !messageIds.has(message.id)),
    ],
  };
}
