import Fastify, { type FastifyInstance } from "fastify";
import { WHATSAPP_CHANNEL_ID } from "@flowmind/channel-core";
import { DefaultNodeRegistry, Engine } from "@flowmind/engine";
import { registerCoreNodes } from "@flowmind/node-core";
import { registerAdminAuthRoutes } from "./admin/index.js";
import { createAgentContainer } from "./agents/container.js";
import { registerAgentErrorHandler } from "./agents/error-handler.js";
import { registerAgentRoutes } from "./agents/routes.js";
import { createWhatsAppContainer, registerWhatsAppRoutes } from "./whatsapp/index.js";
import type { WhatsAppProviderFactory } from "./whatsapp/index.js";
import { parseWorkflow } from "./workflow-validation.js";

export interface CreateServerDependencies {
  readonly whatsAppProviderFactory?: WhatsAppProviderFactory;
}

export function createServer(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: CreateServerDependencies = {},
): FastifyInstance {
  const server = Fastify({
    logger: true,
  });
  const agents = createAgentContainer(environment);
  const whatsapp = createWhatsAppContainer({
    environment,
    storagePath: agents.storagePath,
    agentRuntime: agents.runtime,
    reminderService: agents.reminderService,
    reminders: agents.reminders,
    occurrences: agents.occurrences,
    ...(dependencies.whatsAppProviderFactory === undefined
      ? {}
      : { providerFactory: dependencies.whatsAppProviderFactory }),
  });
  agents.reminderDeliveries.register(WHATSAPP_CHANNEL_ID, whatsapp.reminderDelivery);

  server.addHook("onRequest", async (request, reply) => {
    const corsOrigin = resolveCorsOrigin(request.headers.origin, environment);
    if (corsOrigin) {
      reply.header("Access-Control-Allow-Origin", corsOrigin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Vary", "Origin");
    }
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      await reply.code(204).send();
    }
  });
  server.addHook("preValidation", async (request) => {
    if (request.method !== "POST" || request.url.split("?")[0] !== "/admin/auth/login") {
      return;
    }
    if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) {
      return;
    }
    const body = request.body as Record<string, unknown>;
    if (body.token === undefined && body.password !== undefined) {
      request.body = { ...body, token: body.password };
    }
  });

  server.get("/", async () => ({
    name: "FlowMind",
    status: "ok",
  }));

  server.post<{ Body: unknown }>("/api/execute", async (request) => {
    const registry = new DefaultNodeRegistry();
    registerCoreNodes(registry);

    const engine = new Engine({ registry });
    return engine.execute(parseWorkflow(request.body));
  });

  const adminAuth = registerAdminAuthRoutes(server, { environment });
  server.get("/admin/auth/session", async (request) => ({
    authenticated: adminAuth.isAuthenticated(request),
  }));
  registerAgentRoutes(server, agents);
  registerWhatsAppRoutes(server, whatsapp, adminAuth);
  registerAgentErrorHandler(server);
  server.addHook("onReady", async () => {
    await whatsapp.start();
    await agents.initialize();
  });
  server.addHook("onClose", async () => {
    await agents.scheduler.stop();
    await whatsapp.stop();
  });

  return server;
}

function resolveCorsOrigin(
  requestOrigin: string | undefined,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  if (!requestOrigin) return undefined;
  const configured = environment.FLOWMIND_CORS_ORIGIN?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowed =
    configured && configured.length > 0
      ? configured
      : [
          "http://localhost:3000",
          "http://localhost:3002",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:3002",
        ];
  return allowed.includes(requestOrigin) ? requestOrigin : undefined;
}
