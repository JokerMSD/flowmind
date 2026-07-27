import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WHATSAPP_CHANNEL_ID,
  WHATSAPP_PERSONAL_CONNECTION_ID,
  WHATSAPP_WEB_PROVIDER_ID,
} from "@flowmind/channel-core";
import type { Reminder, ReminderOccurrence } from "@flowmind/agent-core";
import { JsonReminderOccurrenceRepository } from "@flowmind/agent-memory";
import { JsonAccountRepository } from "@flowmind/auth-memory";
import type {
  ChannelConnection,
  ChannelConversation,
  ChannelProviderListener,
  OutboundMessage,
  ProviderConnection,
  SendResult,
} from "@flowmind/channel-core";
import { JsonChannelMemory } from "@flowmind/channel-memory";
import { ChannelProviderRegistry } from "@flowmind/channel-runtime";
import type { WhatsAppConnectionSnapshot } from "@flowmind/whatsapp-web";

import { createServer } from "./server.js";
import { createPasswordHasher } from "./admin/auth.js";
import { WhatsAppWebReminderDeliveryProvider } from "./whatsapp/index.js";
import type { WhatsAppProviderPort } from "./whatsapp/index.js";

test("agent chat persists a session and validates empty messages", async () => {
  await withServer(async (server) => {
    const agents = await server.inject({ method: "GET", url: "/agents" });
    assert.equal(agents.statusCode, 200);
    assert.equal(agents.json()[0].id, "csnf");

    const chat = await server.inject({
      method: "POST",
      url: "/chat",
      payload: { agentId: "csnf", message: "Ola" },
    });
    assert.equal(chat.statusCode, 200);
    assert.match(chat.json().message.content, /shape/);

    const session = await server.inject({
      method: "GET",
      url: `/sessions/${chat.json().sessionId}`,
    });
    assert.equal(session.json().messages.length, 2);

    const invalid = await server.inject({
      method: "POST",
      url: "/chat",
      payload: { agentId: "csnf", message: "   " },
    });
    assert.equal(invalid.statusCode, 400);
  });
});

test("agent routes reject invalid client input before reaching the domain", async () => {
  await withServer(async (server) => {
    const cases = [
      { method: "GET", url: "/agents/%20" },
      { method: "GET", url: "/sessions/%20" },
      { method: "POST", url: "/chat", payload: [] },
      { method: "GET", url: "/reminders?agentId=%20" },
      { method: "GET", url: "/reminders/%20" },
      { method: "PATCH", url: "/reminders/example/status", payload: { enabled: "false" } },
      { method: "GET", url: "/reminder-occurrences?status=unknown" },
      { method: "GET", url: "/reminder-occurrences?after=not-a-date" },
      { method: "GET", url: "/reminder-occurrences?agentId=%20" },
    ] as const;

    for (const request of cases) {
      const response = await server.inject(request);
      assert.ok(
        response.statusCode === 400 || response.statusCode === 422,
        `${request.method} ${request.url}`,
      );
    }

    const malformedJson = await server.inject({
      method: "POST",
      url: "/chat",
      payload: "{",
      headers: { "content-type": "application/json" },
    });
    assert.equal(malformedJson.statusCode, 400);
  });
});

test("workflow execution rejects invalid payloads as client errors", async () => {
  await withServer(async (server) => {
    for (const payload of [{}, { id: "flow", name: "Flow", version: "1", nodes: [], edges: [] }]) {
      const response = await server.inject({ method: "POST", url: "/api/execute", payload });
      assert.ok(response.statusCode === 400 || response.statusCode === 422);
    }
  });
});

test("reminder API creates, normalizes, updates status, and deletes", async () => {
  await withServer(async (server) => {
    const payload = {
      agentId: "csnf",
      type: "shape-photo",
      message: " Foto do shape ",
      schedule: {
        daysOfWeek: [5, 1, 1],
        times: ["20:00", "08:00", "08:00"],
        timezone: "America/Sao_Paulo",
      },
      enabled: true,
      target: {
        channelId: "whatsapp",
        connectionId: "whatsapp-personal",
        conversationId: "conversation-1",
      },
    };
    const created = await server.inject({ method: "POST", url: "/reminders", payload });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json().schedule.daysOfWeek, [1, 5]);
    assert.deepEqual(created.json().schedule.times, ["08:00", "20:00"]);
    assert.deepEqual(created.json().target, payload.target);
    const id = created.json().id as string;

    const paused = await server.inject({
      method: "PATCH",
      url: `/reminders/${id}/status`,
      payload: { enabled: false },
    });
    assert.equal(paused.json().enabled, false);

    const listed = await server.inject({ method: "GET", url: "/reminders?agentId=csnf" });
    assert.equal(listed.json().length, 1);

    const removed = await server.inject({ method: "DELETE", url: `/reminders/${id}` });
    assert.deepEqual(removed.json(), { deleted: true });
    const missing = await server.inject({ method: "GET", url: `/reminders/${id}` });
    assert.equal(missing.statusCode, 404);
  });
});

test("reminder API rejects invalid payloads and timezones", async () => {
  await withServer(async (server) => {
    const invalidPayload = await server.inject({
      method: "POST",
      url: "/reminders",
      payload: {
        agentId: "csnf",
        type: "shape-photo",
        message: "Foto",
        enabled: true,
        schedule: [],
      },
    });
    assert.equal(invalidPayload.statusCode, 400);

    const invalidTimezone = await server.inject({
      method: "POST",
      url: "/reminders",
      payload: {
        agentId: "csnf",
        type: "shape-photo",
        message: "Foto",
        enabled: true,
        schedule: { daysOfWeek: [1], times: ["08:00"], timezone: "Invalid/Timezone" },
      },
    });
    assert.equal(invalidTimezone.statusCode, 400);
  });
});

test("admin login routes integrate with the API and protect every WhatsApp alias", async () => {
  await withServer(async (server) => {
    const protectedUrls = [
      "/integrations/whatsapp/status",
      "/api/integrations/whatsapp/status",
      "/api/admin/whatsapp/status",
    ];
    for (const url of protectedUrls) {
      assert.equal((await server.inject({ method: "GET", url })).statusCode, 401);
    }

    const login = await server.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "admin@flowmind.local", password: "test-admin-token" },
    });
    assert.equal(login.statusCode, 200);
    const cookie = sessionCookie(login.headers["set-cookie"]);

    const session = await server.inject({
      method: "GET",
      url: "/admin/auth/session",
      headers: { cookie },
    });
    assert.deepEqual(session.json(), {
      authenticated: true,
      user: {
        id: "test-admin",
        name: "Test Admin",
        email: "admin@flowmind.local",
        role: "admin",
      },
    });

    for (const url of protectedUrls) {
      const response = await server.inject({ method: "GET", url, headers: { cookie } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().connectionId, WHATSAPP_PERSONAL_CONNECTION_ID);
      assert.equal(response.json().globalEnabled, false);
      assert.equal(response.json().qr, null);
    }
  });
});

test("WhatsApp settings accept aliases, persist safe defaults, and reject invalid payloads", async () => {
  await withServer(async (server) => {
    const cookie = await loginCookie(server);
    const initial = await server.inject({
      method: "GET",
      url: "/integrations/whatsapp/settings",
      headers: { cookie },
    });
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.json().enabled, false);
    assert.equal(initial.json().defaultConversationMode, "disabled");
    assert.equal(initial.json().allowGroups, false);

    const updated = await server.inject({
      method: "PATCH",
      url: "/integrations/whatsapp/settings",
      headers: { cookie },
      payload: {
        globalEnabled: true,
        paused: true,
        defaultConversationMode: "agent",
        rateLimit: { global: { maxMessages: 2, windowMs: 60_000 } },
      },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().enabled, true);
    assert.equal(updated.json().pauseAll, true);
    assert.equal(updated.json().defaultConversationMode, "enabled");
    assert.deepEqual(updated.json().rateLimit.global, { maxMessages: 2, windowMs: 60_000 });

    for (const payload of [
      {},
      { globalEnabled: "true" },
      { enabled: true, globalEnabled: false },
      { rateLimit: { global: { maxMessages: -1, windowMs: 0 } } },
    ]) {
      const invalid = await server.inject({
        method: "PATCH",
        url: "/integrations/whatsapp/settings",
        headers: { cookie },
        payload,
      });
      assert.equal(invalid.statusCode, 400);
    }
  });
});

test("WhatsApp conversations expose detail, modes, messages, manual send, and reset aliases", async () => {
  await withServer(async (server, context) => {
    const cookie = await loginCookie(server);
    const conversation = await seedConversation(context.memory, {
      automationMode: "paused",
      sessionId: "session-to-reset",
    });
    await seedConversation(context.memory, {
      id: "internal-lid-conversation",
      externalConversationId: "123456789@lid",
      displayName: "123456789@lid",
      automationMode: "paused",
    });
    await context.memory.messages.save({
      id: "inbound-1",
      conversationId: conversation.id,
      connectionId: conversation.connectionId,
      direction: "inbound",
      content: "Ola",
      status: "received",
      providerMessageId: "provider-inbound-1",
      createdAt: "2026-07-26T12:01:00.000Z",
    });

    const listed = await server.inject({
      method: "GET",
      url: `/integrations/whatsapp/conversations?connectionId=${WHATSAPP_PERSONAL_CONNECTION_ID}&mode=paused`,
      headers: { cookie },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().length, 1);
    assert.equal(listed.json()[0].id, conversation.id);
    assert.equal(listed.json()[0].mode, "paused");

    const contacts = await server.inject({
      method: "GET",
      url: `/integrations/whatsapp/contacts?connectionId=${WHATSAPP_PERSONAL_CONNECTION_ID}`,
      headers: { cookie },
    });
    assert.equal(contacts.statusCode, 200);
    assert.deepEqual(contacts.json(), [
      {
        id: conversation.externalConversationId,
        name: "Cliente",
        phone: conversation.externalConversationId,
        conversationId: conversation.id,
      },
    ]);

    const detail = await server.inject({
      method: "GET",
      url: `/integrations/whatsapp/conversations/${conversation.id}`,
      headers: { cookie },
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().phone, conversation.externalConversationId);

    const mode = await server.inject({
      method: "PATCH",
      url: `/api/admin/whatsapp/conversations/${conversation.id}/automation-mode`,
      headers: { cookie },
      payload: { automationMode: "manual" },
    });
    assert.equal(mode.statusCode, 200);
    assert.equal(mode.json().automationMode, "manual");
    assert.equal(mode.json().mode, "manual");

    const sent = await server.inject({
      method: "POST",
      url: `/integrations/whatsapp/conversations/${conversation.id}/send`,
      headers: { cookie },
      payload: { message: "  Mensagem manual  " },
    });
    assert.equal(sent.statusCode, 201);
    assert.equal(sent.json().body, "Mensagem manual");
    assert.equal(sent.json().direction, "outgoing");
    assert.equal(context.provider.sent.length, 1);

    const messages = await server.inject({
      method: "GET",
      url: `/integrations/whatsapp/conversations/${conversation.id}/messages`,
      headers: { cookie },
    });
    assert.equal(messages.statusCode, 200);
    assert.deepEqual(
      messages.json().map((message: { direction: string }) => message.direction),
      ["incoming", "outgoing"],
    );

    const reset = await server.inject({
      method: "POST",
      url: `/integrations/whatsapp/conversations/${conversation.id}/reset-session`,
      headers: { cookie },
    });
    assert.equal(reset.statusCode, 200);
    assert.equal("sessionId" in reset.json(), false);
  });
});

test("manual WhatsApp send rejects groups, blocked conversations, invalid payloads, and rate overflow", async () => {
  await withServer(async (server, context) => {
    const cookie = await loginCookie(server);
    const privateConversation = await seedConversation(context.memory, {
      id: "private-rate-limited",
      automationMode: "disabled",
    });
    const groupConversation = await seedConversation(context.memory, {
      id: "group-conversation",
      externalConversationId: "120363000000000000@g.us",
      type: "group",
      automationMode: "manual",
    });
    const blockedConversation = await seedConversation(context.memory, {
      id: "blocked-conversation",
      externalConversationId: "5511999999999",
      automationMode: "blocked",
    });
    const current = await context.memory.settings.get();
    await context.memory.settings.save({
      ...current,
      enabled: true,
      rateLimit: {
        ...current.rateLimit,
        global: { maxMessages: 1, windowMs: 60_000 },
      },
    });

    const first = await server.inject({
      method: "POST",
      url: `/integrations/whatsapp/conversations/${privateConversation.id}/messages`,
      headers: { cookie },
      payload: { body: "Primeira" },
    });
    assert.equal(first.statusCode, 201);
    const limited = await server.inject({
      method: "POST",
      url: `/integrations/whatsapp/conversations/${privateConversation.id}/messages`,
      headers: { cookie },
      payload: { content: "Segunda" },
    });
    assert.equal(limited.statusCode, 429);

    for (const conversation of [groupConversation, blockedConversation]) {
      const response = await server.inject({
        method: "POST",
        url: `/integrations/whatsapp/conversations/${conversation.id}/messages`,
        headers: { cookie },
        payload: { body: "Nao enviar" },
      });
      assert.equal(response.statusCode, 409);
    }

    for (const payload of [[], {}, { body: "   " }]) {
      const response = await server.inject({
        method: "POST",
        url: `/integrations/whatsapp/conversations/${privateConversation.id}/messages`,
        headers: { cookie },
        payload,
      });
      assert.equal(response.statusCode, 400);
    }
  });
});

test("WHATSAPP_WEB_ENABLED=false never connects and connection payloads validate as 400", async () => {
  await withServer(async (server, context) => {
    const cookie = await loginCookie(server);
    assert.equal(context.provider.connectCalls, 0);

    const disabled = await server.inject({
      method: "POST",
      url: "/integrations/whatsapp/connect",
      headers: { cookie },
      payload: { connectionId: WHATSAPP_PERSONAL_CONNECTION_ID },
    });
    assert.equal(disabled.statusCode, 503);
    assert.equal(context.provider.connectCalls, 0);

    const invalid = await server.inject({
      method: "POST",
      url: "/integrations/whatsapp/connect",
      headers: { cookie },
      payload: { connectionId: "   " },
    });
    assert.equal(invalid.statusCode, 400);
  });
});

test("WhatsApp connection endpoints connect, reconnect, expose QR, and logout through the fake provider", async () => {
  await withServer(
    async (server, context) => {
      const cookie = await loginCookie(server);
      const connected = await server.inject({
        method: "POST",
        url: `/api/admin/whatsapp/connections/${WHATSAPP_PERSONAL_CONNECTION_ID}/connect`,
        headers: { cookie },
      });
      assert.equal(connected.statusCode, 200);
      assert.equal(connected.json().status, "connected");
      assert.equal(context.provider.connectCalls, 1);

      context.provider.setSnapshot({
        connectionId: WHATSAPP_PERSONAL_CONNECTION_ID,
        status: "waiting_for_qr",
        qr: {
          value: "qr-payload-not-logged",
          expiresAt: "2026-07-26T12:05:00.000Z",
        },
      });
      const qr = await server.inject({
        method: "GET",
        url: `/integrations/whatsapp/qr?connectionId=${WHATSAPP_PERSONAL_CONNECTION_ID}`,
        headers: { cookie },
      });
      assert.equal(qr.statusCode, 200);
      assert.equal(qr.json().qr, "qr-payload-not-logged");

      const reconnected = await server.inject({
        method: "POST",
        url: "/integrations/whatsapp/reconnect",
        headers: { cookie },
        payload: { connectionId: WHATSAPP_PERSONAL_CONNECTION_ID },
      });
      assert.equal(reconnected.statusCode, 200);
      assert.equal(context.provider.connectCalls, 2);

      const loggedOut = await server.inject({
        method: "POST",
        url: `/api/integrations/whatsapp/${WHATSAPP_PERSONAL_CONNECTION_ID}/logout`,
        headers: { cookie },
      });
      assert.equal(loggedOut.statusCode, 200);
      assert.equal(loggedOut.json().status, "logged_out");
      const stored = await context.memory.connections.findById(WHATSAPP_PERSONAL_CONNECTION_ID);
      assert.equal(stored?.enabled, false);
      assert.equal(stored?.status, "logged_out");
    },
    { WHATSAPP_WEB_ENABLED: "true" },
  );
});

test("WhatsApp reminder delivery resolves target/provider and persists delivered occurrence", async () => {
  await withServer(async (_server, context) => {
    const conversation = await seedConversation(context.memory);
    const occurrences = new JsonReminderOccurrenceRepository(context.storagePath);
    const providers = new ChannelProviderRegistry();
    providers.register(context.provider);
    const delivery = new WhatsAppWebReminderDeliveryProvider({
      connections: context.memory.connections,
      conversations: context.memory.conversations,
      settings: context.memory.settings,
      providers,
      occurrences,
      now: () => new Date("2026-07-26T12:03:00.000Z"),
    });
    const occurrence: ReminderOccurrence = {
      id: "occurrence-whatsapp",
      reminderId: "reminder-whatsapp",
      scheduledFor: "2026-07-26T12:02:00.000Z",
      detectedAt: "2026-07-26T12:02:00.000Z",
      status: "pending",
    };
    const reminder: Reminder = {
      id: "reminder-whatsapp",
      agentId: "csnf",
      type: "shape-photo",
      message: "Envie a foto do shape",
      schedule: {
        daysOfWeek: [0],
        times: ["09:00"],
        timezone: "America/Sao_Paulo",
      },
      enabled: true,
      target: {
        channelId: WHATSAPP_CHANNEL_ID,
        connectionId: conversation.connectionId,
        conversationId: conversation.id,
      },
      createdAt: "2026-07-26T12:00:00.000Z",
      updatedAt: "2026-07-26T12:00:00.000Z",
    };
    await occurrences.save(occurrence);
    await delivery.deliver(occurrence, reminder);

    assert.equal(context.provider.sent.length, 2);
    assert.match(context.provider.sent[0]?.content ?? "", /Eu sou o CSNF/i);
    assert.equal(context.provider.sent.at(-1)?.content, reminder.message);
    const saved = await occurrences.findByReminderAndScheduledFor(
      reminder.id,
      occurrence.scheduledFor,
    );
    assert.equal(saved?.status, "delivered");
    assert.equal(saved?.deliveredAt, "2026-07-26T12:03:00.000Z");

    const settings = await context.memory.settings.get();
    await context.memory.settings.save({ ...settings, pauseAll: true });
    await assert.rejects(
      delivery.deliver({ ...occurrence, id: "paused-occurrence" }, reminder),
      /disabled/,
    );
  });
});

interface TestContext {
  readonly storagePath: string;
  readonly memory: JsonChannelMemory;
  readonly provider: FakeWhatsAppProvider;
}

async function withServer(
  run: (server: ReturnType<typeof createServer>, context: TestContext) => Promise<void>,
  environmentOverrides: NodeJS.ProcessEnv = {},
): Promise<void> {
  const storagePath = await mkdtemp(join(tmpdir(), "flowmind-api-"));
  const accounts = new JsonAccountRepository(join(storagePath, "auth"));
  const createdAt = new Date().toISOString();
  await accounts.save({
    id: "test-admin",
    name: "Test Admin",
    email: "admin@flowmind.local",
    passwordHash: await createPasswordHasher().hash("test-admin-token"),
    role: "admin",
    active: true,
    createdAt,
    updatedAt: createdAt,
  });
  const provider = new FakeWhatsAppProvider();
  const server = createServer(
    {
      FLOWMIND_STORAGE_PATH: storagePath,
      FLOWMIND_SCHEDULER_INTERVAL_MS: "60000",
      FLOWMIND_REMINDER_RECOVERY_MINUTES: "1",
      WHATSAPP_WEB_ENABLED: "false",
      ...environmentOverrides,
    },
    {
      whatsAppProviderFactory: () => provider,
    },
  );
  try {
    await server.ready();
    await run(server, {
      storagePath,
      memory: new JsonChannelMemory(join(storagePath, "channels", "whatsapp")),
      provider,
    });
  } finally {
    await server.close();
    await rm(storagePath, { force: true, recursive: true });
  }
}

async function loginCookie(server: ReturnType<typeof createServer>): Promise<string> {
  const login = await server.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email: "admin@flowmind.local", password: "test-admin-token" },
  });
  assert.equal(login.statusCode, 200);
  return sessionCookie(login.headers["set-cookie"]);
}

function sessionCookie(header: string | string[] | undefined): string {
  assert.ok(header);
  const value = Array.isArray(header) ? header[0] : header;
  assert.ok(value);
  const cookie = value.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function seedConversation(
  memory: JsonChannelMemory,
  overrides: Partial<ChannelConversation> = {},
): Promise<ChannelConversation> {
  const connection = await memory.connections.findById(WHATSAPP_PERSONAL_CONNECTION_ID);
  assert.ok(connection);
  const connected: ChannelConnection = {
    ...connection,
    enabled: true,
    status: "connected",
    updatedAt: "2026-07-26T12:00:00.000Z",
  };
  await memory.connections.save(connected);
  const settings = await memory.settings.get();
  await memory.settings.save({ ...settings, enabled: true });
  const conversation: ChannelConversation = {
    id: "private-conversation",
    channelId: WHATSAPP_CHANNEL_ID,
    connectionId: WHATSAPP_PERSONAL_CONNECTION_ID,
    externalConversationId: "5511888888888",
    type: "private",
    displayName: "Contato Teste",
    normalizedPhone: "5511888888888",
    agentId: "csnf",
    automationMode: "manual",
    unreadCount: 1,
    lastMessagePreview: "Ola",
    lastMessageAt: "2026-07-26T12:01:00.000Z",
    metadata: {},
    createdAt: "2026-07-26T12:00:00.000Z",
    updatedAt: "2026-07-26T12:01:00.000Z",
    ...overrides,
  };
  await memory.conversations.save(conversation);
  return conversation;
}

class FakeWhatsAppProvider implements WhatsAppProviderPort {
  public readonly id = WHATSAPP_WEB_PROVIDER_ID;
  public readonly channelId = WHATSAPP_CHANNEL_ID;
  public readonly sent: OutboundMessage[] = [];
  public connectCalls = 0;
  private readonly snapshots = new Map<string, WhatsAppConnectionSnapshot>();

  public async connect(
    connection: ChannelConnection,
    listener: ChannelProviderListener,
  ): Promise<ProviderConnection> {
    this.connectCalls += 1;
    const snapshot: WhatsAppConnectionSnapshot = {
      connectionId: connection.id,
      status: "connected",
      address: "5511000000000",
    };
    this.snapshots.set(connection.id, snapshot);
    await listener.onStatus({
      connectionId: connection.id,
      status: "connected",
      occurredAt: "2026-07-26T12:00:00.000Z",
    });
    return {
      connectionId: connection.id,
      channelId: this.channelId,
      providerId: this.id,
    };
  }

  public async disconnect(connectionId: string): Promise<void> {
    this.snapshots.delete(connectionId);
  }

  public async logout(connectionId: string): Promise<void> {
    this.snapshots.delete(connectionId);
  }

  public async send(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message);
    return {
      connectionId: message.connectionId,
      providerMessageId: `sent-${this.sent.length}`,
      sentAt: `2026-07-26T12:0${this.sent.length}:00.000Z`,
    };
  }

  public getSnapshot(connectionId: string): WhatsAppConnectionSnapshot | undefined {
    return this.snapshots.get(connectionId);
  }

  public listContacts(): readonly {
    id: string;
    name: string;
    phone: string;
  }[] {
    return [{ id: "5511888888888", name: "Cliente", phone: "5511888888888" }];
  }

  public setSnapshot(snapshot: WhatsAppConnectionSnapshot): void {
    this.snapshots.set(snapshot.connectionId, snapshot);
  }
}
