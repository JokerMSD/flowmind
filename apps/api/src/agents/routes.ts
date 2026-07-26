import type { FastifyInstance } from "fastify";
import type { ReminderOccurrenceStatus } from "@flowmind/agent-core";

import type { AgentContainer } from "./container.js";
import {
  parseChatBody,
  parseOccurrenceQuery,
  parseOptionalAgentId,
  parseReminderBody,
  parseRequiredId,
  parseStatusBody,
} from "./validation.js";

export function registerAgentRoutes(server: FastifyInstance, container: AgentContainer): void {
  server.get("/agents", async () => (await container.agents.list()).map(toAgentSummary));
  server.get<{ Params: { agentId: string } }>("/agents/:agentId", async (request, reply) => {
    const agent = await container.agents.findById(parseRequiredId(request.params.agentId, "agentId"));
    return agent ? toAgentSummary(agent) : reply.code(404).send({ code: "AGENT_NOT_FOUND", message: "Agente nao encontrado." });
  });

  server.post<{ Body: unknown }>("/chat", async (request) => {
    const result = await container.runtime.chat(parseChatBody(request.body));
    const agent = await container.agents.findById(result.session.agentId);
    return {
      sessionId: result.session.id,
      message: result.message,
      agent: { id: result.session.agentId, name: agent?.name ?? result.session.agentId },
    };
  });
  server.get<{ Params: { sessionId: string } }>("/sessions/:sessionId", async (request, reply) => {
    const session = await container.sessions.findById(parseRequiredId(request.params.sessionId, "sessionId"));
    return session ?? reply.code(404).send({ code: "SESSION_NOT_FOUND", message: "Sessao nao encontrada." });
  });

  server.get<{ Querystring: { agentId?: string } }>("/reminders", async (request) =>
    container.reminders.list(parseOptionalAgentId(request.query.agentId)));
  server.get<{ Params: { id: string } }>("/reminders/:id", async (request, reply) => {
    const reminder = await container.reminders.findById(parseRequiredId(request.params.id, "id"));
    return reminder ?? reply.code(404).send({ code: "REMINDER_NOT_FOUND", message: "Lembrete nao encontrado." });
  });
  server.post<{ Body: unknown }>("/reminders", async (request, reply) =>
    reply.code(201).send(await container.reminderService.create(parseReminderBody(request.body))));
  server.put<{ Params: { id: string }; Body: unknown }>("/reminders/:id", async (request) =>
    container.reminderService.update(parseRequiredId(request.params.id, "id"), parseReminderBody(request.body)));
  server.delete<{ Params: { id: string } }>("/reminders/:id", async (request) => {
    await container.reminderService.remove(parseRequiredId(request.params.id, "id"));
    return { deleted: true };
  });
  server.patch<{ Params: { id: string }; Body: unknown }>("/reminders/:id/status", async (request) =>
    container.reminderService.setStatus(parseRequiredId(request.params.id, "id"), parseStatusBody(request.body).enabled));

  server.get<{ Querystring: { agentId?: string; status?: ReminderOccurrenceStatus; after?: string } }>(
    "/reminder-occurrences",
    async (request) => {
      const query = parseOccurrenceQuery(request.query);
      const reminderIds = query.agentId
        ? new Set((await container.reminders.list(query.agentId)).map((reminder) => reminder.id))
        : undefined;
      const occurrences = await container.occurrences.list({
        ...(query.status ? { status: query.status } : {}),
        ...(query.after ? { after: query.after } : {}),
      });
      return occurrences
        .filter((occurrence) => !reminderIds || reminderIds.has(occurrence.reminderId))
        .sort((left, right) => right.scheduledFor.localeCompare(left.scheduledFor));
    },
  );
}

function toAgentSummary(agent: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly enabled: boolean;
}) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities,
    enabled: agent.enabled,
  };
}
