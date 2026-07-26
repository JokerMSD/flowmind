import { AgentCoreError } from "@flowmind/agent-core";
import type { FastifyInstance } from "fastify";

const notFoundCodes = new Set(["AGENT_NOT_FOUND", "SESSION_NOT_FOUND", "REMINDER_NOT_FOUND"]);
const conflictCodes = new Set(["SESSION_AGENT_MISMATCH", "AGENT_DISABLED"]);

export function registerAgentErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AgentCoreError) {
      request.log.warn({ code: error.code }, error.message);
      const status = notFoundCodes.has(error.code) ? 404 : conflictCodes.has(error.code) ? 409 : 400;
      await reply.code(status).send({ code: error.code, message: toPublicMessage(error) });
      return;
    }

    request.log.error(error);
    await reply.code(500).send({ code: "INTERNAL_ERROR", message: "Falha interna do FlowMind." });
  });
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
