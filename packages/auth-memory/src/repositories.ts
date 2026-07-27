import type {
  Account,
  AccountRepository,
  AccountSession,
  AccountSessionRepository,
} from "@flowmind/auth-core";
import { join } from "node:path";
import { JsonStore } from "./json-store.js";

export class JsonAccountRepository implements AccountRepository {
  private readonly store: JsonStore<Account>;

  public constructor(storagePath: string) {
    this.store = new JsonStore(join(storagePath, "auth-accounts.json"), isAccount);
  }

  public async findByEmail(email: string): Promise<Account | undefined> {
    const normalized = email.trim().toLocaleLowerCase("en-US");
    return (await this.store.read()).find((account) => account.email === normalized);
  }

  public async findById(id: string): Promise<Account | undefined> {
    return (await this.store.read()).find((account) => account.id === id);
  }

  public async count(): Promise<number> {
    return (await this.store.read()).length;
  }

  public async save(account: Account): Promise<void> {
    await this.store.mutate((accounts) => {
      const duplicate = accounts.find(
        (candidate) => candidate.email === account.email && candidate.id !== account.id,
      );
      if (duplicate) throw new Error("An account with this email already exists.");
      return [...accounts.filter((candidate) => candidate.id !== account.id), account];
    });
  }
}

export class JsonAccountSessionRepository implements AccountSessionRepository {
  private readonly store: JsonStore<AccountSession>;

  public constructor(storagePath: string) {
    this.store = new JsonStore(join(storagePath, "auth-sessions.json"), isSession);
  }

  public async findByTokenHash(tokenHash: string): Promise<AccountSession | undefined> {
    return (await this.store.read()).find((session) => session.tokenHash === tokenHash);
  }

  public async save(session: AccountSession): Promise<void> {
    await this.store.mutate((sessions) => [
      ...sessions.filter((candidate) => candidate.id !== session.id),
      session,
    ]);
  }

  public async delete(id: string): Promise<void> {
    await this.store.mutate((sessions) => sessions.filter((session) => session.id !== id));
  }

  public async deleteExpired(now: string): Promise<void> {
    await this.store.mutate((sessions) => sessions.filter((session) => session.expiresAt > now));
  }
}

function isAccount(value: unknown): value is Account {
  if (!isRecord(value)) return false;
  return (
    strings(value, ["id", "name", "email", "passwordHash", "createdAt", "updatedAt"]) &&
    (value.role === "admin" || value.role === "operator") &&
    typeof value.active === "boolean"
  );
}

function isSession(value: unknown): value is AccountSession {
  return (
    isRecord(value) && strings(value, ["id", "accountId", "tokenHash", "expiresAt", "createdAt"])
  );
}

function strings(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof value[field] === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
