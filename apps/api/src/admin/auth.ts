import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type {
  AccountRepository,
  AccountSessionRepository,
  AuthenticatedAccount,
  PasswordHasher,
} from "@flowmind/auth-core";
import type { FastifyReply, FastifyRequest } from "fastify";

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = "flowmind_account_session";
const SCRYPT_KEY_LENGTH = 64;
const scryptAsync = promisify(scrypt);

export interface AdminAuthOptions {
  readonly accounts: AccountRepository;
  readonly sessions: AccountSessionRepository;
  readonly environment?: NodeJS.ProcessEnv;
  readonly ttlMs?: number;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly passwordHasher?: PasswordHasher;
}

export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}

export interface AdminAuth {
  readonly cookieName: string;
  authenticate(request: FastifyRequest): Promise<AuthenticatedAccount | undefined>;
  requireAuthentication(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  login(
    credentials: LoginCredentials,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedAccount | undefined>;
  logout(request: FastifyRequest, reply: FastifyReply): Promise<void>;
}

export function createAdminAuth(options: AdminAuthOptions): AdminAuth {
  const environment = options.environment ?? process.env;
  const ttlMs = options.ttlMs ?? parseTtl(environment);
  const cookieName = options.cookieName ?? COOKIE_NAME;
  const now = options.now ?? (() => new Date());
  const hasher = options.passwordHasher ?? createPasswordHasher();
  const attempts = new LoginAttemptLimiter(now);

  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("FLOWMIND_ADMIN_SESSION_TTL_MINUTES must be a positive integer.");
  }

  async function authenticate(request: FastifyRequest): Promise<AuthenticatedAccount | undefined> {
    const token = readCookie(request, cookieName);
    if (!token) return undefined;
    const current = now();
    const session = await options.sessions.findByTokenHash(hashToken(token));
    if (!session || session.expiresAt <= current.toISOString()) return undefined;
    const account = await options.accounts.findById(session.accountId);
    return account?.active ? publicAccount(account) : undefined;
  }

  async function requireAuthentication(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (await authenticate(request)) return;
    await reply
      .code(401)
      .send({ code: "ADMIN_AUTH_REQUIRED", message: "Autenticacao administrativa necessaria." });
  }

  async function login(
    credentials: LoginCredentials,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedAccount | undefined> {
    const key = `${request.ip}:${credentials.email}`;
    if (!attempts.allow(key)) return undefined;
    const account = await options.accounts.findByEmail(credentials.email);
    if (!account?.active || !(await hasher.verify(credentials.password, account.passwordHash))) {
      attempts.recordFailure(key);
      return undefined;
    }
    attempts.clear(key);
    const token = randomBytes(32).toString("base64url");
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);
    await options.sessions.deleteExpired(createdAt.toISOString());
    await options.sessions.save({
      id: randomUUID(),
      accountId: account.id,
      tokenHash: hashToken(token),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    reply.header("Set-Cookie", serializeCookie(cookieName, token, expiresAt, request));
    return publicAccount(account);
  }

  async function logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = readCookie(request, cookieName);
    if (token) {
      const session = await options.sessions.findByTokenHash(hashToken(token));
      if (session) await options.sessions.delete(session.id);
    }
    reply.header("Set-Cookie", serializeCookie(cookieName, "", new Date(0), request));
  }

  return { cookieName, authenticate, requireAuthentication, login, logout };
}

export function createPasswordHasher(): PasswordHasher {
  return {
    hash: async (password) => {
      validatePassword(password);
      const salt = randomBytes(16);
      const derived = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
      return `scrypt$v1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
    },
    verify: async (password, encodedHash) => {
      const [algorithm, version, saltRaw, hashRaw] = encodedHash.split("$");
      if (algorithm !== "scrypt" || version !== "v1" || !saltRaw || !hashRaw) return false;
      try {
        const expected = Buffer.from(hashRaw, "base64url");
        const actual = (await scryptAsync(
          password,
          Buffer.from(saltRaw, "base64url"),
          expected.length,
        )) as Buffer;
        return actual.length === expected.length && timingSafeEqual(actual, expected);
      } catch {
        return false;
      }
    },
  };
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLocaleLowerCase("en-US");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Informe um e-mail valido.");
  }
  return email;
}

export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new Error("A senha deve ter entre 12 e 128 caracteres.");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function parseTtl(environment: NodeJS.ProcessEnv): number {
  const raw = environment.FLOWMIND_ADMIN_SESSION_TTL_MINUTES;
  if (raw === undefined) return DEFAULT_TTL_MS;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error("FLOWMIND_ADMIN_SESSION_TTL_MINUTES must be a positive integer.");
  }
  return Number(raw) * 60_000;
}

function publicAccount(account: {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: "admin" | "operator";
}): AuthenticatedAccount {
  return { id: account.id, name: account.name, email: account.email, role: account.role };
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  for (const part of request.headers.cookie?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function serializeCookie(
  name: string,
  value: string,
  expiresAt: Date,
  request: FastifyRequest,
): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (request.protocol === "https") attributes.push("Secure");
  return attributes.join("; ");
}

class LoginAttemptLimiter {
  private readonly failures = new Map<string, { count: number; blockedUntil: number }>();

  public constructor(private readonly now: () => Date) {}

  public allow(key: string): boolean {
    const state = this.failures.get(key);
    return !state || state.blockedUntil <= this.now().getTime();
  }

  public recordFailure(key: string): void {
    const current = this.failures.get(key);
    const count = (current?.count ?? 0) + 1;
    this.failures.set(key, {
      count,
      blockedUntil: count >= 5 ? this.now().getTime() + 15 * 60_000 : 0,
    });
  }

  public clear(key: string): void {
    this.failures.delete(key);
  }
}
