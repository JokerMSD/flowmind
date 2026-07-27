import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  JsonChannelConversationRepository,
  JsonChannelMemory,
  JsonChannelMessageRepository,
  JsonChannelSettingsRepository,
  JsonExternalMessageRecordRepository,
  JsonPersistenceError,
} from "../dist/index.js";

async function storage() {
  return mkdtemp(join(tmpdir(), "flowmind-channel-memory-"));
}
const now = "2026-07-26T00:00:00.000Z";

function conversation(id, connectionId, externalConversationId) {
  return {
    id,
    channelId: "whatsapp",
    connectionId,
    externalConversationId,
    type: "private",
    agentId: "agent-1",
    automationMode: "enabled",
    unreadCount: 0,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

function external(connectionId, providerMessageId, recordedAt = now) {
  return {
    connectionId,
    providerMessageId,
    messageId: `${connectionId}-${providerMessageId}`,
    status: "received",
    recordedAt,
    updatedAt: recordedAt,
  };
}

test("restaura conexoes, conversas e mensagens em nova instancia", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const memory = new JsonChannelMemory(path);
  await memory.connections.save({
    id: "whatsapp-personal",
    channelId: "whatsapp",
    providerId: "whatsapp-web",
    name: "Pessoal",
    enabled: true,
    status: "connected",
    createdAt: now,
    updatedAt: now,
  });
  await memory.conversations.save(
    conversation("conversation-1", "whatsapp-personal", "5511999999999"),
  );
  await memory.messages.save({
    id: "message-1",
    conversationId: "conversation-1",
    connectionId: "whatsapp-personal",
    direction: "inbound",
    content: "Oi",
    status: "received",
    createdAt: now,
  });
  const restored = new JsonChannelMemory(path);
  assert.equal((await restored.connections.findById("whatsapp-personal"))?.name, "Pessoal");
  assert.equal(
    (
      await restored.conversations.findByConnectionAndExternalConversationId(
        "whatsapp-personal",
        "5511999999999",
      )
    )?.id,
    "conversation-1",
  );
  assert.equal((await restored.messages.listByConversation("conversation-1")).length, 1);
});

test("isola conversas por connectionId e deduplica no mesmo processo", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const conversations = new JsonChannelConversationRepository(path);
  await conversations.save(conversation("one", "connection-1", "group-1"));
  await conversations.save(conversation("two", "connection-2", "group-1"));
  assert.equal(
    (await conversations.findByConnectionAndExternalConversationId("connection-2", "group-1"))?.id,
    "two",
  );
  const externalMessages = new JsonExternalMessageRecordRepository(path);
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      externalMessages.claim(external("connection-1", "provider-1")),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await externalMessages.claim(external("connection-2", "provider-1")), true);
});

test("ordena conversas pela mensagem mais recente", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const conversations = new JsonChannelConversationRepository(path);
  await conversations.save({
    ...conversation("created-first", "connection-1", "5511000000001"),
    createdAt: "2026-07-20T12:00:00.000Z",
    lastMessageAt: "2026-07-26T12:00:00.000Z",
  });
  await conversations.save({
    ...conversation("created-last", "connection-1", "5511000000002"),
    createdAt: "2026-07-25T12:00:00.000Z",
    lastMessageAt: "2026-07-25T12:00:00.000Z",
  });

  assert.deepEqual(
    (await conversations.list({ order: "desc" })).map((item) => item.id),
    ["created-first", "created-last"],
  );
});

test("cria e persiste settings padrao desabilitado", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const settings = new JsonChannelSettingsRepository(path);
  assert.equal((await settings.get()).enabled, false);
  assert.equal((await settings.get()).allowGroups, false);
  await settings.save({ ...(await settings.get()), enabled: true, allowGroups: true });
  assert.equal((await new JsonChannelSettingsRepository(path).get()).allowGroups, true);
});

test("relata JSON invalido sem sobrescrever o arquivo", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const repository = new JsonChannelConversationRepository(path);
  await repository.list();
  const file = join(path, "conversations.json");
  await writeFile(file, "{invalido", "utf8");
  await assert.rejects(repository.list(), (error) => error instanceof JsonPersistenceError);
  assert.equal(await readFile(file, "utf8"), "{invalido");
});

test("remove mensagens vencidas pela retencao configurada", async (t) => {
  const path = await storage();
  t.after(() => rm(path, { recursive: true, force: true }));
  const repository = new JsonChannelMessageRepository(path, {
    now: () => new Date("2026-07-26T01:00:00.000Z"),
    retention: { messagesMaxAgeMs: 1_000 },
  });
  await repository.save({
    id: "old",
    conversationId: "conversation-1",
    connectionId: "connection-1",
    direction: "inbound",
    content: "antiga",
    status: "received",
    createdAt: "2026-07-26T00:00:00.000Z",
  });
  await repository.save({
    id: "new",
    conversationId: "conversation-1",
    connectionId: "connection-1",
    direction: "inbound",
    content: "nova",
    status: "received",
    createdAt: "2026-07-26T00:59:59.500Z",
  });
  assert.deepEqual(
    (await repository.listByConversation("conversation-1")).map((message) => message.id),
    ["new"],
  );
});
