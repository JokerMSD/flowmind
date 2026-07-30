import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class JsonPersistenceError extends Error {
  public constructor(
    message: string,
    readonly filePath: string,
  ) {
    super(message);
    this.name = "JsonPersistenceError";
  }
}

type Validator<T> = (value: unknown) => value is T;

export class JsonStore<T> {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly filePath: string;

  public constructor(
    filePath: string,
    private readonly isValue: Validator<T>,
    private readonly initialValue: () => T,
  ) {
    this.filePath = resolve(filePath);
  }

  public async read(): Promise<T> {
    await this.ensureFile();
    return this.readValidated();
  }

  public async mutate(mutation: (value: T) => T): Promise<T> {
    let result: T | undefined;
    await this.enqueue(async () => {
      await this.ensureFile();
      const next = mutation(await this.readValidated());
      this.assertValue(next);
      await this.writeAtomically(next);
      result = next;
    });
    if (result === undefined) throw new Error("JSON mutation did not produce a result.");
    return result;
  }

  private async enqueue(task: () => Promise<void>): Promise<void> {
    const previous = JsonStore.queues.get(this.filePath) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    JsonStore.queues.set(this.filePath, current);
    try {
      await current;
    } finally {
      if (JsonStore.queues.get(this.filePath) === current) {
        JsonStore.queues.delete(this.filePath);
      }
    }
  }

  private async ensureFile(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error;
      await this.writeAtomically(this.initialValue());
    }
  }

  private async readValidated(): Promise<T> {
    const current = await this.parseValidated(this.filePath);
    if (current !== undefined) return current;

    const recovered = await this.recoverLatestSnapshot();
    if (recovered !== undefined) return recovered;

    throw new JsonPersistenceError("Invalid JSON document.", this.filePath);
  }

  private async parseValidated(filePath: string): Promise<T | undefined> {
    const contents = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents) as unknown;
    } catch {
      return undefined;
    }
    return this.isValue(parsed) ? parsed : undefined;
  }

  private async recoverLatestSnapshot(): Promise<T | undefined> {
    const directory = dirname(this.filePath);
    const fileName = this.filePath.slice(directory.length + 1);
    const prefix = `${fileName}.`;
    const candidates = (await readdir(directory))
      .filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"))
      .map((name) => resolve(directory, name));
    const ordered = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        modifiedAt: (await stat(candidate)).mtimeMs,
      })),
    );
    ordered.sort((left, right) => right.modifiedAt - left.modifiedAt);

    for (const { candidate } of ordered) {
      const value = await this.parseValidated(candidate).catch(() => undefined);
      if (value === undefined) continue;
      await this.writeAtomically(value);
      return value;
    }
    return undefined;
  }

  private assertValue(value: unknown): asserts value is T {
    if (!this.isValue(value)) {
      throw new JsonPersistenceError("Invalid JSON document structure.", this.filePath);
    }
  }

  private async writeAtomically(value: T): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await rename(temporaryPath, this.filePath);
          return;
        } catch (error) {
          if (!isPermissionError(error) || attempt >= 4) throw error;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25 * 2 ** attempt));
        }
      }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}
