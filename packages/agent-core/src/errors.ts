export class AgentCoreError extends Error {
  public constructor(message: string, public readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AgentNotFoundError extends AgentCoreError {
  public constructor(agentId: string) { super(`Agent not found: ${agentId}`, "AGENT_NOT_FOUND"); }
}

export class AgentDisabledError extends AgentCoreError {
  public constructor(agentId: string) { super(`Agent is disabled: ${agentId}`, "AGENT_DISABLED"); }
}

export class SessionNotFoundError extends AgentCoreError {
  public constructor(sessionId: string) { super(`Session not found: ${sessionId}`, "SESSION_NOT_FOUND"); }
}

export class SessionAgentMismatchError extends AgentCoreError {
  public constructor(sessionId: string) { super(`Session does not belong to the requested agent: ${sessionId}`, "SESSION_AGENT_MISMATCH"); }
}

export class ReminderNotFoundError extends AgentCoreError {
  public constructor(reminderId: string) { super(`Reminder not found: ${reminderId}`, "REMINDER_NOT_FOUND"); }
}

export class InvalidPayloadError extends AgentCoreError {
  public constructor(message: string) { super(message, "INVALID_PAYLOAD"); }
}

export class InvalidTimeError extends AgentCoreError {
  public constructor(value: string) { super(`Invalid reminder time: ${value}`, "INVALID_TIME"); }
}

export class InvalidTimezoneError extends AgentCoreError {
  public constructor(value: string) { super(`Invalid reminder timezone: ${value}`, "INVALID_TIMEZONE"); }
}

export class InvalidPersistenceError extends AgentCoreError {
  public constructor(message: string) { super(message, "INVALID_PERSISTENCE"); }
}

export class ProviderNotRegisteredError extends AgentCoreError {
  public constructor(providerId: string) { super(`Provider is not registered: ${providerId}`, "PROVIDER_NOT_REGISTERED"); }
}

export class SessionConflictError extends AgentCoreError {
  public constructor(sessionId: string) { super(`Session was changed concurrently: ${sessionId}`, "SESSION_CONFLICT"); }
}
