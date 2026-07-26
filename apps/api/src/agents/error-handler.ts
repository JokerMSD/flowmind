import { AgentCoreError } from "@flowmind/agent-core";
import type { FastifyInstance } from "fastify";

const notFoundCodes = new Set(["AGENT_NOT_FOUND", "SESSION_NOT_FOUND", "REMINDER_NOT_FOUND"]);
const conflictCodes = new Set(["SESSION_AGENT_MISMATCH", "SESSION_CONFLICT", "AGENT_DISABLED"]);
const badRequestCodes = new Set(["INVALID_PAYLOAD", "INVALID_TIME", "INVALID_TIMEZONE"]);

export function registerAgentErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AgentCoreError) {
      request.log.warn({ code: error.code }, error.message);
      const status = notFoundCodes.has(error.code)
        ? 404
        : conflictCodes.has(error.code)
          ? 409
          : badRequestCodes.has(error.code)
            ? 400
            : 500;
      await reply.code(status).send({ code: error.code, message: toPublicMessage(error) });
      return;
    }

    if (isClientError(error)) {
      request.log.warn({ code: error.code }, error.message);
      await reply.code(error.statusCode).send({ code: "INVALID_REQUEST", message: "Requisicao invalida." });
      return;
    }

    request.log.error(error);
    await reply.code(500).send({ code: "INTERNAL_ERROR", message: "Falha interna do FlowMind." });
  });
}

function isClientError(error: unknown): error is { readonly statusCode: number; readonly code?: string; readonly message: string } {
  return typeof error === "object"
    && error !== null
    && "statusCode" in error
    && typeof error.statusCode === "number"
    && error.statusCode >= 400
    && error.statusCode < 500
    && "message" in error
    && typeof error.message === "string";
}

function toPublicMessage(error: AgentCoreError): string {
  const messages: Readonly<Record<string, string>> = {
    AGENT_NOT_FOUND: "Agente nao encontrado.",
    AGENT_DISABLED: "Agente desativado.",
    SESSION_NOT_FOUND: "Sessao nao encontrada.",
    SESSION_AGENT_MISMATCH: "A sessao pertence a outro agente.",
    REMINDER_NOT_FOUND: "Lembrete nao encontrado.",
    INVALID_PAYLOAD: error.message,
    INVALID_TIME: "Horario invalido. Use HH:mm.",
    INVALID_PERSISTENCE: "Armazenamento JSON invalido.",
    PROVIDER_NOT_REGISTERED: "Provider de conversa nao registrado.",
  };
  return messages[error.code] ?? "Requisicao invalida.";
}
