import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  JsonAgentRepository,
  JsonPersistenceError,
  JsonReminderOccurrenceRepository,
  JsonReminderRepository,
  JsonSessionRepository,
  seedCsnf,
} from "../dist/index.js";

async function storage() {
  return mkdtemp(join(tmpdir(), "flowmind-agent-memory-"));
}

function session(id) {
  return {
    id,
    agentId: "csnf",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    messages: [],
  };
}

test("cria os arquivos UTF-8 e persiste os repositorios", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const agents = new JsonAgentRepository(path);
  const sessions = new JsonSessionRepository(path);
  const reminders = new JsonReminderRepository(path);
  const occurrences = new JsonReminderOccurrenceRepository(path);

  await seedCsnf(agents);
  await sessions.save(session("session-1"));
  await reminders.save({
    id: "reminder-1", agentId: "csnf", type: "shape-photo", message: "Foto do shape",
    schedule: { daysOfWeek: [1], times: ["08:00"], timezone: "America/Sao_Paulo" },
    enabled: true, createdAt: "2026-07-26T00:00:00.000Z", updatedAt: "2026-07-26T00:00:00.000Z",
  });
  await occurrences.save({
    id: "occurrence-1", reminderId: "reminder-1", scheduledFor: "2026-07-26T08:00:00.000Z",
    detectedAt: "2026-07-26T08:00:01.000Z", status: "delivered", deliveredAt: "2026-07-26T08:00:01.000Z",
  });

  assert.equal((await new JsonAgentRepository(path).findById("csnf"))?.name, "CSNF");
  assert.equal((await new JsonSessionRepository(path).findById("session-1"))?.id, "session-1");
  assert.equal((await new JsonReminderRepository(path).list()).length, 1);
  assert.equal((await new JsonReminderOccurrenceRepository(path).list()).length, 1);
  assert.match(await readFile(join(path, "agents.json"), "utf8"), /CSNF/);
});

test("serializa gravacoes concorrentes sem perder sessoes", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const writes = Array.from({ length: 40 }, (_, index) => (
    new JsonSessionRepository(path).save(session(`session-${index}`))
  ));
  await Promise.all(writes);
  const sessions = await new JsonSessionRepository(path).list();
  assert.equal(sessions.length, 40);
  assert.equal((await readdir(path)).some((name) => name.endsWith(".tmp")), false);
});

test("relata JSON invalido sem sobrescrever o arquivo", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const file = join(path, "sessions.json");
  const repository = new JsonSessionRepository(path);
  await repository.list();
  await writeFile(file, "{invalido", "utf8");

  await assert.rejects(repository.list(), (error) => error instanceof JsonPersistenceError);
  assert.equal(await readFile(file, "utf8"), "{invalido");
});

test("seed CSNF e idempotente e preserva valores existentes", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const repository = new JsonAgentRepository(path);
  await repository.save({
    id: "csnf", name: "CSNF personalizado", description: "Preservado", conversationProvider: "fake",
    activationPolicy: { mention: false, keywords: [], probability: 1, canInitiateConversation: false, cooldownMinutes: 0 },
    capabilities: ["conversation"], enabled: false,
  });
  const seeded = await seedCsnf(repository);
  assert.equal(seeded.name, "CSNF personalizado");
  assert.equal((await repository.list()).length, 1);
});
