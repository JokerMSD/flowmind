export type AccountRole = "admin" | "operator";

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: AccountRole;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountSession {
  readonly id: string;
  readonly accountId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface AuthenticatedAccount {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: AccountRole;
}
