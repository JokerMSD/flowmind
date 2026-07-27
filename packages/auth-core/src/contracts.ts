import type { Account, AccountSession } from "./models.js";

export interface AccountRepository {
  findByEmail(email: string): Promise<Account | undefined>;
  findById(id: string): Promise<Account | undefined>;
  count(): Promise<number>;
  save(account: Account): Promise<void>;
}

export interface AccountSessionRepository {
  findByTokenHash(tokenHash: string): Promise<AccountSession | undefined>;
  save(session: AccountSession): Promise<void>;
  delete(id: string): Promise<void>;
  deleteExpired(now: string): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
}
