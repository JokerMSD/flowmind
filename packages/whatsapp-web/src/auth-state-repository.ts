import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { BufferJSON, initAuthCreds, proto } from "@whiskeysockets/baileys";
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
  SignalKeyStore,
} from "@whiskeysockets/baileys";
import { AuthStateCorruptionError, AuthStatePersistenceError } from "./errors.js";

const AUTH_STATE_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

interface PersistedAuthState {
  readonly version: typeof AUTH_STATE_VERSION;
  readonly creds: AuthenticationCreds;
  readonly keys: Partial<{
    [T in keyof SignalDataTypeMap]: Record<string, SignalDataTypeMap[T]>;
  }>;
}

const fileQueues = new Map<string, Promise<void>>();

function serializeForFile<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = fileQueues.get(filePath) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  fileQueues.set(filePath, settled);
  void settled.finally(() => {
    if (fileQueues.get(filePath) === settled) fileQueues.delete(filePath);
  });
  return result;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPersistedState(
  value: unknown,
  filePath: string,
): asserts value is PersistedAuthState {
  if (
    !isRecord(value) ||
    value.version !== AUTH_STATE_VERSION ||
    !isRecord(value.creds) ||
    typeof value.creds.registered !== "boolean" ||
    !isRecord(value.keys)
  ) {
    throw new AuthStateCorruptionError(filePath);
  }
}

export interface AuthStateRepositoryOptions {
  readonly fileName?: string;
}

/**
 * Persists one complete Baileys auth state per connection.
 *
 * Writes are serialized and replace the destination atomically. QR values are
 * deliberately outside this model and can never be written by this repository.
 */
export class AuthStateRepository {
  public readonly directory: string;
  public readonly filePath: string;

  private initialized = false;
  private creds: AuthenticationCreds | undefined;
  private keys: PersistedAuthState["keys"] = {};
  private readonly keyStore: SignalKeyStore;

  public constructor(directory: string, options: AuthStateRepositoryOptions = {}) {
    this.directory = resolve(directory);
    this.filePath = join(this.directory, options.fileName ?? "auth-state.json");
    this.keyStore = {
      get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => this.getKeys(type, ids),
      set: (data: SignalDataSet) => this.updateKeys(data),
      clear: () => this.clearKeys(),
    };
  }

  public async getState(): Promise<AuthenticationState> {
    await this.ensureLoaded();
    return {
      creds: this.requireCreds(),
      keys: this.keyStore,
    };
  }

  public async updateCreds(update: Partial<AuthenticationCreds>): Promise<void> {
    await this.ensureLoaded();
    await serializeForFile(this.filePath, async () => {
      await this.rebaseFromDisk();
      Object.assign(this.requireCreds(), update);
      await this.persist();
    });
  }

  public async logout(): Promise<void> {
    await serializeForFile(this.filePath, async () => {
      await this.ensureDirectory();
      try {
        await unlink(this.filePath);
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
          throw new AuthStatePersistenceError(this.filePath, "remove", error);
        }
      }
      this.creds = initAuthCreds();
      this.keys = {};
      this.initialized = true;
    });
  }

  public async hasPersistedState(): Promise<boolean> {
    try {
      const info = await lstat(this.filePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new AuthStateCorruptionError(this.filePath);
      }
      return true;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      if (error instanceof AuthStateCorruptionError) throw error;
      throw new AuthStatePersistenceError(this.filePath, "inspect", error);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    await serializeForFile(this.filePath, async () => {
      if (this.initialized) return;
      await this.ensureDirectory();
      const decoded = await this.readPersisted();
      this.creds = decoded?.creds ?? initAuthCreds();
      this.keys = decoded?.keys ?? {};
      this.initialized = true;
      if (decoded) {
        await chmod(this.filePath, FILE_MODE).catch((error: unknown) => {
          throw new AuthStatePersistenceError(this.filePath, "secure", error);
        });
      }
    });
  }

  private async getKeys<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[],
  ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
    await this.ensureLoaded();
    const category = this.keys[type] as Record<string, SignalDataTypeMap[T]> | undefined;
    const values: Record<string, SignalDataTypeMap[T]> = {};
    for (const id of ids) {
      let value = category?.[id];
      if (type === "app-state-sync-key" && value !== undefined) {
        value = proto.Message.AppStateSyncKeyData.fromObject(
          value as proto.Message.IAppStateSyncKeyData,
        ) as unknown as SignalDataTypeMap[T];
      }
      if (value !== undefined) values[id] = value;
    }
    return values;
  }

  private async updateKeys(data: SignalDataSet): Promise<void> {
    await this.ensureLoaded();
    await serializeForFile(this.filePath, async () => {
      await this.rebaseFromDisk();
      for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
        const updates = data[type];
        if (!updates) continue;
        const category = {
          ...(this.keys[type] as Record<string, unknown> | undefined),
        };
        for (const [id, value] of Object.entries(updates)) {
          if (value === null || value === undefined) delete category[id];
          else category[id] = value;
        }
        if (Object.keys(category).length === 0) delete this.keys[type];
        else {
          this.keys[type] = category as never;
        }
      }
      await this.persist();
    });
  }

  private async clearKeys(): Promise<void> {
    await this.ensureLoaded();
    await serializeForFile(this.filePath, async () => {
      await this.rebaseFromDisk();
      this.keys = {};
      await this.persist();
    });
  }

  private requireCreds(): AuthenticationCreds {
    if (!this.creds) {
      throw new AuthStatePersistenceError(
        this.filePath,
        "access",
        new Error("Authentication state was not initialized"),
      );
    }
    return this.creds;
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: DIRECTORY_MODE });
      const info = await lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error("Authentication path must be a real directory, not a symlink");
      }
      await chmod(this.directory, DIRECTORY_MODE);
    } catch (error) {
      throw new AuthStatePersistenceError(this.filePath, "prepare directory for", error);
    }
  }

  private async readPersisted(): Promise<PersistedAuthState | undefined> {
    let encoded: string;
    try {
      const info = await lstat(this.filePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new AuthStateCorruptionError(this.filePath);
      }
      encoded = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined;
      if (error instanceof AuthStateCorruptionError) throw error;
      throw new AuthStatePersistenceError(this.filePath, "read", error);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded, BufferJSON.reviver);
    } catch (error) {
      throw new AuthStateCorruptionError(this.filePath, error);
    }
    assertPersistedState(decoded, this.filePath);
    return decoded;
  }

  private async rebaseFromDisk(): Promise<void> {
    const latest = await this.readPersisted();
    if (!latest) return;
    Object.assign(this.requireCreds(), latest.creds);
    this.keys = latest.keys;
  }

  private async persist(): Promise<void> {
    await this.ensureDirectory();
    const state: PersistedAuthState = {
      version: AUTH_STATE_VERSION,
      creds: this.requireCreds(),
      keys: this.keys,
    };
    const encoded = `${JSON.stringify(state, BufferJSON.replacer)}\n`;
    const tempPath = join(
      dirname(this.filePath),
      `.${this.filePath.split(/[\\/]/).at(-1) ?? "auth-state"}.${randomUUID()}.tmp`,
    );

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(tempPath, "wx", FILE_MODE);
      await handle.writeFile(encoded, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await chmod(tempPath, FILE_MODE);
      await rename(tempPath, this.filePath);
      await chmod(this.filePath, FILE_MODE);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      throw new AuthStatePersistenceError(this.filePath, "write", error);
    }
  }
}
