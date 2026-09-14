import type { FastifyInstance } from "fastify";
import type { AgentContainer } from "../agents/container.js";
import {
  addCsnfModule,
  removeCsnfModule,
  runtimeWorkspaces,
  updateCsnfWorkspace,
} from "./runtime-workspaces.js";

export function registerEditorRoutes(server: FastifyInstance, container: AgentContainer): void {
  server.get("/editor/runtime-workspaces", async () => runtimeWorkspaces(container));
  server.patch<{ Body: unknown }>("/editor/runtime-workspaces/csnf", async (request, reply) => {
    try {
      return await updateCsnfWorkspace(container, request.body);
    } catch (error) {
      return reply.code(400).send({
        code: "INVALID_RUNTIME_WORKSPACE",
        message: error instanceof Error ? error.message : "Invalid agent configuration.",
      });
    }
  });
  server.post<{ Body: unknown }>(
    "/editor/runtime-workspaces/csnf/modules",
    async (request, reply) => {
      const body = request.body as { type?: unknown } | null;
      if (!body || typeof body.type !== "string") {
        return reply
          .code(400)
          .send({ code: "INVALID_MODULE", message: "Tipo do modulo e obrigatorio." });
      }
      try {
        return await addCsnfModule(container, body.type);
      } catch (error) {
        return reply
          .code(400)
          .send({
            code: "INVALID_MODULE",
            message: error instanceof Error ? error.message : "Modulo invalido.",
          });
      }
    },
  );
  server.delete<{ Params: { moduleId: string } }>(
    "/editor/runtime-workspaces/csnf/modules/:moduleId",
    async (request, reply) => {
      try {
        return await removeCsnfModule(container, request.params.moduleId);
      } catch (error) {
        return reply
          .code(400)
          .send({
            code: "INVALID_MODULE",
            message: error instanceof Error ? error.message : "Modulo invalido.",
          });
      }
    },
  );
  server.post<{ Body: unknown }>("/editor/runtime-workspaces/csnf/test", async (request, reply) => {
    const body = request.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof (body as Record<string, unknown>).message !== "string"
    ) {
      return reply
        .code(400)
        .send({ code: "INVALID_TEST_MESSAGE", message: "Message is required." });
    }
    const value = body as Record<string, unknown>;
    const message = (value.message as string).trim();
    if (!message || message.length > 2_000)
      return reply
        .code(400)
        .send({ code: "INVALID_TEST_MESSAGE", message: "Message is required." });
    const sessionId =
      typeof value.sessionId === "string" && value.sessionId.trim()
        ? value.sessionId.trim()
        : undefined;
    const result = await container.runtime.chat({
      agentId: "csnf",
      message,
      ...(sessionId ? { sessionId } : {}),
    });
    return { message: result.message.content, sessionId: result.session.id };
  });
}
