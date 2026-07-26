import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
    const contents = await readFile(this.filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents) as unknown;
    } catch {
      throw new JsonPersistenceError("Invalid JSON document.", this.filePath);
    }
    this.assertValue(parsed);
    return parsed;
  }

  private assertValue(value: unknown): asserts value is T {
    if (!this.isValue(value)) {
      throw new JsonPersistenceError("Invalid JSON document structure.", this.filePath);
    }
  }

  private async writeAtomically(value: T): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
