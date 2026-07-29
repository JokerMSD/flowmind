import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatIndexRepository } from "./chat-index-repository.js";
import { ChatIndexCorruptionError } from "./errors.js";
import type { WhatsAppChat } from "./socket-manager.js";

test("serializes concurrent chat index writes without temporary file collisions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flowmind-chat-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new ChatIndexRepository(root);

  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      repository.save([chat(`551100000${index}`, index)]),
    ),
  );

  const restored = await repository.load();
  assert.deepEqual(restored, [chat("55110000029", 29)]);
  assert.equal(
    (await readdir(root)).some((name) => name.endsWith(".tmp")),
    false,
  );
});

test("reports a corrupt chat index without overwriting the source", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "flowmind-chat-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new ChatIndexRepository(root);
  await writeFile(repository.filePath, '{"version":1,"chats":[{"externalId":"0"}]}', "utf8");

  await assert.rejects(
    repository.load(),
    (error: unknown) =>
      error instanceof ChatIndexCorruptionError && error.filePath === repository.filePath,
  );
  assert.equal(
    await readFile(repository.filePath, "utf8"),
    '{"version":1,"chats":[{"externalId":"0"}]}',
  );
});

function chat(externalId: string, index: number): WhatsAppChat {
  return {
    externalId,
    type: "private",
    lastActivityAt: new Date(index * 1_000).toISOString(),
    archived: false,
    unreadCount: index,
  };
}
