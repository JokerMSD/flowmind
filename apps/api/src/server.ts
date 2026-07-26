import Fastify, { type FastifyInstance } from "fastify";
import { DefaultNodeRegistry, Engine } from "@flowmind/engine";
import { registerCoreNodes } from "@flowmind/node-core";
import type { Workflow } from "@flowmind/schema";
import { createAgentContainer } from "./agents/container.js";
import { registerAgentErrorHandler } from "./agents/error-handler.js";
import { registerAgentRoutes } from "./agents/routes.js";

export function createServer(environment: NodeJS.ProcessEnv = process.env): FastifyInstance {
  const server = Fastify({
    logger: true,
  });
  const agents = createAgentContainer(environment);

  server.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      await reply.code(204).send();
    }
  });

  server.get("/", async () => ({
    name: "FlowMind",
    status: "ok",
  }));

  server.post<{ Body: Workflow }>("/api/execute", async (request) => {
    const registry = new DefaultNodeRegistry();
    registerCoreNodes(registry);

    const engine = new Engine({ registry });
    return engine.execute(request.body);
  });

  registerAgentRoutes(server, agents);
  registerAgentErrorHandler(server);
  server.addHook("onReady", async () => agents.initialize());
  server.addHook("onClose", async () => agents.scheduler.stop());

  return server;
}
