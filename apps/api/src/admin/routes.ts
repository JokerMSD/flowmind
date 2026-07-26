import type { FastifyInstance } from "fastify";

import { createAdminAuth, type AdminAuth, type AdminAuthOptions } from "./auth.js";

export interface RegisterAdminAuthOptions extends AdminAuthOptions {
  readonly prefix?: string;
}

export function registerAdminAuthRoutes(
  server: FastifyInstance,
  options: RegisterAdminAuthOptions = {},
): AdminAuth {
  const auth = createAdminAuth(options);
  const prefix = options.prefix ?? "/admin/auth";

  server.post<{ Body: unknown }>(`${prefix}/login`, async (request, reply) => {
    const token = readLoginToken(request.body);
    if (!auth.login(token, request, reply)) {
      return reply
        .code(401)
        .send({ code: "ADMIN_LOGIN_FAILED", message: "Credenciais invalidas." });
    }
    return { authenticated: true };
  });

  server.post(`${prefix}/logout`, async (request, reply) => {
    auth.logout(request, reply);
    return { authenticated: false };
  });

  server.get(`${prefix}/status`, async (request) => ({
    authenticated: auth.isAuthenticated(request),
  }));
  return auth;
}

export function createAdminAuthHook(auth: AdminAuth) {
  return async (
    request: Parameters<AdminAuth["requireAuthentication"]>[0],
    reply: Parameters<AdminAuth["requireAuthentication"]>[1],
  ) => auth.requireAuthentication(request, reply);
}

function readLoginToken(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  return (body as Record<string, unknown>).token;
}
