import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Validator<T> = (value: unknown) => value is T;

export class JsonStore<T> {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly path: string;

  public constructor(
    path: string,
    private readonly validator: Validator<T>,
  ) {
    this.path = resolve(path);
  }

  public async read(): Promise<readonly T[]> {
    await this.ensure();
    return this.readValidated();
  }

  public async mutate(operation: (values: T[]) => T[]): Promise<void> {
    const previous = JsonStore.queues.get(this.path) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const values = await this.read();
        await this.write(operation([...values]));
      });
    JsonStore.queues.set(this.path, current);
    try {
      await current;
    } finally {
      if (JsonStore.queues.get(this.path) === current) JsonStore.queues.delete(this.path);
    }
  }

  private async ensure(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      await readFile(this.path, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await writeFile(this.path, "[]\n", { encoding: "utf8", mode: 0o600 });
    }
  }

  private async readValidated(): Promise<T[]> {
    const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
    if (!Array.isArray(parsed) || !parsed.every(this.validator)) {
      throw new Error(`Invalid authentication storage: ${this.path}`);
    }
    return parsed;
  }

  private async write(values: readonly T[]): Promise<void> {
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}
