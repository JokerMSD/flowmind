import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export class JsonPersistenceError extends Error {
  constructor(message: string, readonly filePath: string) {
    super(message);
    this.name = "JsonPersistenceError";
  }
}

type Validator<T> = (value: unknown) => value is T;
type Mutation<T> = (items: T[]) => T[];

export class JsonCollection<T> {
  static readonly queues = new Map<string, Promise<void>>();

  readonly filePath: string;

  constructor(filePath: string, private readonly isItem: Validator<T>) {
    this.filePath = resolve(filePath);
  }

  async read(): Promise<readonly T[]> {
    await this.ensureFile();
    return this.readValidated();
  }

  async mutate(mutation: Mutation<T>): Promise<readonly T[]> {
    let result: readonly T[] = [];
    await this.enqueue(async () => {
      await this.ensureFile();
      const next = mutation(await this.readValidated());
      this.assertCollection(next);
      await this.writeAtomically(next);
      result = next;
    });
    return result;
  }

  private async enqueue(task: () => Promise<void>): Promise<void> {
    const previous = JsonCollection.queues.get(this.filePath) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    JsonCollection.queues.set(this.filePath, current);
    try {
      await current;
    } finally {
      if (JsonCollection.queues.get(this.filePath) === current) {
        JsonCollection.queues.delete(this.filePath);
      }
    }
  }

  private async ensureFile(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isNotFound(error)) {
        await writeFile(this.filePath, "[]\n", "utf8");
        return;
      }
      throw error;
    }
  }

  private async readValidated(): Promise<T[]> {
    const contents = await readFile(this.filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents) as unknown;
    } catch {
      throw new JsonPersistenceError("Invalid JSON collection.", this.filePath);
    }
    this.assertCollection(parsed);
    return parsed;
  }

  private assertCollection(value: unknown): asserts value is T[] {
    if (!Array.isArray(value) || !value.every((item) => this.isItem(item))) {
      throw new JsonPersistenceError("Invalid JSON collection structure.", this.filePath);
    }
  }

  private async writeAtomically(items: readonly T[]): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
