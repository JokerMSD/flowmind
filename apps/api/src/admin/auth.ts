import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = "flowmind_admin_session";
const SESSION_VERSION = "v1";

export interface AdminAuthOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly ttlMs?: number;
  readonly cookieName?: string;
  readonly now?: () => number;
}

export interface AdminAuth {
  readonly cookieName: string;
  isAuthenticated(request: FastifyRequest): boolean;
  requireAuthentication(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  login(token: unknown, request: FastifyRequest, reply: FastifyReply): boolean;
  logout(request: FastifyRequest, reply: FastifyReply): void;
}

export function createAdminAuth(options: AdminAuthOptions = {}): AdminAuth {
  const environment = options.environment ?? process.env;
  const token = environment.FLOWMIND_ADMIN_TOKEN?.trim() || undefined;
  const localDevelopmentBypass = isLocalDevelopmentBypassEnabled(environment);
  const ttlMs = options.ttlMs ?? parseTtl(environment);
  const cookieName = options.cookieName ?? COOKIE_NAME;
  const now = options.now ?? Date.now;

  if (!token && !localDevelopmentBypass) {
    throw new Error(
      "FLOWMIND_ADMIN_TOKEN is required unless local development bypass is explicitly enabled.",
    );
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("FLOWMIND_ADMIN_SESSION_TTL_MS must be a positive integer.");
  }

  const sessionKey = token
    ? createHmac("sha256", token).update("flowmind-admin-session-v1").digest()
    : undefined;

  function isAuthenticated(request: FastifyRequest): boolean {
    if (localDevelopmentBypass) return isLocalRequest(request);
    const session = readCookie(request, cookieName);
    return Boolean(session && sessionKey && verifySession(session, sessionKey, now()));
  }

  async function requireAuthentication(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (isAuthenticated(request)) return;
    await reply
      .code(401)
      .send({ code: "ADMIN_AUTH_REQUIRED", message: "Autenticacao administrativa necessaria." });
  }

  function login(candidate: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
    if (localDevelopmentBypass) {
      return isLocalRequest(request);
    }
    if (!token || !sessionKey || !isTokenValid(candidate, token)) return false;

    const expiresAt = now() + ttlMs;
    const value = signSession(expiresAt, sessionKey);
    reply.header("Set-Cookie", serializeCookie(cookieName, value, expiresAt, request));
    return true;
  }

  function logout(request: FastifyRequest, reply: FastifyReply): void {
    reply.header("Set-Cookie", serializeCookie(cookieName, "", 0, request));
  }

  return { cookieName, isAuthenticated, requireAuthentication, login, logout };
}

function parseTtl(environment: NodeJS.ProcessEnv): number {
  const minutes = environment.FLOWMIND_ADMIN_SESSION_TTL_MINUTES;
  if (minutes !== undefined) {
    if (!/^\d+$/.test(minutes)) {
      throw new Error("FLOWMIND_ADMIN_SESSION_TTL_MINUTES must be a positive integer.");
    }
    return Number(minutes) * 60_000;
  }
  const raw = environment.FLOWMIND_ADMIN_SESSION_TTL_MS ?? environment.FLOWMIND_ADMIN_TTL_MS;
  if (raw === undefined) return DEFAULT_TTL_MS;
  if (!/^\d+$/.test(raw))
    throw new Error("FLOWMIND_ADMIN_SESSION_TTL_MS must be a positive integer.");
  return Number(raw);
}

function isLocalDevelopmentBypassEnabled(environment: NodeJS.ProcessEnv): boolean {
  const enabled = environment.FLOWMIND_ADMIN_ALLOW_LOCAL_DEV === "true";
  if (enabled && environment.NODE_ENV !== "development") {
    throw new Error("FLOWMIND_ADMIN_ALLOW_LOCAL_DEV is only allowed when NODE_ENV=development.");
  }
  return enabled;
}

function isTokenValid(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string") return false;
  const received = Buffer.from(candidate);
  const configured = Buffer.from(expected);
  return received.length === configured.length && timingSafeEqual(received, configured);
}

function signSession(expiresAt: number, key: Buffer): string {
  const nonce = randomBytes(18).toString("base64url");
  const unsigned = `${SESSION_VERSION}.${expiresAt}.${nonce}`;
  return `${unsigned}.${createHmac("sha256", key).update(unsigned).digest("base64url")}`;
}

function verifySession(value: string, key: Buffer, now: number): boolean {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== SESSION_VERSION) return false;
  const [version, expiresAtRaw, nonce, signature] = parts;
  if (!version || !expiresAtRaw || !nonce || !signature || !/^\d+$/.test(expiresAtRaw))
    return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  const unsigned = `${version}.${expiresAtRaw}.${nonce}`;
  const expected = createHmac("sha256", key).update(unsigned).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function serializeCookie(
  name: string,
  value: string,
  expiresAt: number,
  request: FastifyRequest,
): string {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`,
  ];
  if (request.protocol === "https") attributes.push("Secure");
  return attributes.join("; ");
}

function isLocalRequest(request: FastifyRequest): boolean {
  return request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1";
}
