import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthStateCorruptionError, AuthStateRepository } from "./index.js";

async function storage(): Promise<string> {
  return mkdtemp(join(tmpdir(), "flowmind-whatsapp-auth-"));
}

test("persists and restores creds and keys in one atomic restricted file", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new AuthStateRepository(join(root, "whatsapp-personal"));
  const state = await repository.getState();

  assert.equal(state.creds.registered, false);
  await repository.updateCreds({ registered: true });
  await state.keys.set({
    "pre-key": {
      alpha: {
        public: Uint8Array.from([1, 2, 3]),
        private: Uint8Array.from([4, 5, 6]),
      },
    },
    session: {
      beta: Uint8Array.from([7, 8, 9]),
    },
  });

  const restored = await new AuthStateRepository(repository.directory).getState();
  assert.equal(restored.creds.registered, true);
  assert.deepEqual(
    Array.from((await restored.keys.get("pre-key", ["alpha"])).alpha?.public ?? []),
    [1, 2, 3],
  );
  assert.deepEqual(
    Array.from((await restored.keys.get("session", ["beta"])).beta ?? []),
    [7, 8, 9],
  );
  assert.equal(
    (await readdir(repository.directory)).some((name) => name.endsWith(".tmp")),
    false,
  );

  if (process.platform !== "win32") {
    assert.equal((await stat(repository.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(repository.filePath)).mode & 0o777, 0o600);
  }
});

test("serializes concurrent key and credential updates without losing data", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new AuthStateRepository(root);
  const state = await repository.getState();

  await Promise.all([
    ...Array.from({ length: 30 }, (_, index) =>
      state.keys.set({
        session: {
          [`session-${index}`]: Uint8Array.from([index]),
        },
      }),
    ),
    repository.updateCreds({ registered: true }),
  ]);

  const restored = await new AuthStateRepository(root).getState();
  const ids = Array.from({ length: 30 }, (_, index) => `session-${index}`);
  assert.equal(Object.keys(await restored.keys.get("session", ids)).length, 30);
  assert.equal(restored.creds.registered, true);
});

test("serializes mutations from independent repository instances", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = new AuthStateRepository(root);
  const second = new AuthStateRepository(root);
  const firstState = await first.getState();
  const secondState = await second.getState();

  await Promise.all([
    firstState.keys.set({ session: { first: Uint8Array.from([1]) } }),
    secondState.keys.set({ session: { second: Uint8Array.from([2]) } }),
    first.updateCreds({ registered: true }),
  ]);

  const restored = await new AuthStateRepository(root).getState();
  assert.deepEqual(Object.keys(await restored.keys.get("session", ["first", "second"])).sort(), [
    "first",
    "second",
  ]);
  assert.equal(restored.creds.registered, true);
});

test("reports corruption clearly and never overwrites the corrupt source", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new AuthStateRepository(root);
  await repository.updateCreds({ registered: true });
  await writeFile(repository.filePath, "{invalid-json", "utf8");

  const corrupted = new AuthStateRepository(root);
  await assert.rejects(
    corrupted.getState(),
    (error) =>
      error instanceof AuthStateCorruptionError &&
      error.filePath === repository.filePath &&
      error.message.includes("corrupt"),
  );
  assert.equal(await readFile(repository.filePath, "utf8"), "{invalid-json");
});

test("logout removes all persisted auth material and returns a fresh state", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new AuthStateRepository(root);
  const state = await repository.getState();
  await repository.updateCreds({ registered: true });
  await state.keys.set({ session: { secret: Uint8Array.from([9, 9, 9]) } });
  assert.equal(await repository.hasPersistedState(), true);

  await repository.logout();

  assert.equal(await repository.hasPersistedState(), false);
  const fresh = await repository.getState();
  assert.equal(fresh.creds.registered, false);
  assert.deepEqual(await fresh.keys.get("session", ["secret"]), {});
});
