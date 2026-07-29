import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ChatIndexCorruptionError } from "./errors.js";
import type { WhatsAppChat } from "./socket-manager.js";

const VERSION = 1;

interface PersistedChatIndex {
  readonly version: typeof VERSION;
  readonly chats: readonly WhatsAppChat[];
}

export class ChatIndexRepository {
  public readonly filePath: string;
  private writes: Promise<void> = Promise.resolve();

  public constructor(directory: string) {
    this.filePath = join(directory, "chat-index.json");
  }

  public async load(): Promise<readonly WhatsAppChat[]> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw new ChatIndexCorruptionError(this.filePath, error);
    }
    if (!isPersistedChatIndex(value)) throw new ChatIndexCorruptionError(this.filePath);
    return value.chats;
  }

  public save(chats: readonly WhatsAppChat[]): Promise<void> {
    const snapshot = [...chats];
    const operation = this.writes.then(() => this.write(snapshot));
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  private async write(chats: readonly WhatsAppChat[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const value: PersistedChatIndex = { version: VERSION, chats };
    try {
      await writeFile(temporaryPath, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

function isPersistedChatIndex(value: unknown): value is PersistedChatIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === VERSION && Array.isArray(record.chats) && record.chats.every(isChat);
}

function isChat(value: unknown): value is WhatsAppChat {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const chat = value as Record<string, unknown>;
  return (
    typeof chat.externalId === "string" &&
    (chat.type === "private" || chat.type === "group") &&
    typeof chat.lastActivityAt === "string" &&
    Number.isFinite(Date.parse(chat.lastActivityAt)) &&
    typeof chat.archived === "boolean" &&
    typeof chat.unreadCount === "number" &&
    Number.isSafeInteger(chat.unreadCount) &&
    chat.unreadCount >= 0 &&
    (chat.pinnedAt === undefined || typeof chat.pinnedAt === "number")
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
