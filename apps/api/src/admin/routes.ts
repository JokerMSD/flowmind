import { join } from "node:path";

import { JsonAccountRepository, JsonAccountSessionRepository } from "@flowmind/auth-memory";
import type { FastifyInstance } from "fastify";

import { createAdminAuth, normalizeEmail, type AdminAuth, type AdminAuthOptions } from "./auth.js";

export interface RegisterAdminAuthOptions extends Omit<AdminAuthOptions, "accounts" | "sessions"> {
  readonly storagePath: string;
  readonly prefix?: string;
}

export function registerAdminAuthRoutes(
  server: FastifyInstance,
  options: RegisterAdminAuthOptions,
): AdminAuth {
  const authStorage = join(options.storagePath, "auth");
  const auth = createAdminAuth({
    ...options,
    accounts: new JsonAccountRepository(authStorage),
    sessions: new JsonAccountSessionRepository(authStorage),
  });
  const prefix = options.prefix ?? "/admin/auth";

  server.post<{ Body: unknown }>(`${prefix}/login`, async (request, reply) => {
    const credentials = readCredentials(request.body);
    if (!credentials) {
      return reply
        .code(400)
        .send({ code: "INVALID_LOGIN", message: "E-mail e senha sao obrigatorios." });
    }
    const account = await auth.login(credentials, request, reply);
    if (!account) {
      return reply
        .code(401)
        .send({ code: "ADMIN_LOGIN_FAILED", message: "Credenciais invalidas." });
    }
    return { authenticated: true, user: account };
  });

  server.post(`${prefix}/logout`, async (request, reply) => {
    await auth.logout(request, reply);
    return { authenticated: false };
  });

  server.get(`${prefix}/status`, async (request) => {
    const account = await auth.authenticate(request);
    return account ? { authenticated: true, user: account } : { authenticated: false };
  });
  return auth;
}

export function createAdminAuthHook(auth: AdminAuth) {
  return async (
    request: Parameters<AdminAuth["requireAuthentication"]>[0],
    reply: Parameters<AdminAuth["requireAuthentication"]>[1],
  ) => auth.requireAuthentication(request, reply);
}

function readCredentials(body: unknown): { email: string; password: string } | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const value = body as Record<string, unknown>;
  if (typeof value.email !== "string" || typeof value.password !== "string") return undefined;
  try {
    return { email: normalizeEmail(value.email), password: value.password };
  } catch {
    return undefined;
  }
}
