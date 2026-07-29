import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ChannelConnection,
  ChannelConnectionStatusEvent,
  ChannelProviderListener,
  InboundMessage,
} from "@flowmind/channel-core";
import { ChannelProviderRegistry } from "@flowmind/channel-runtime";
import { DisconnectReason } from "@whiskeysockets/baileys";
import type { AuthenticationState, ConnectionState, WAMessage } from "@whiskeysockets/baileys";
import {
  AuthStateRepository,
  InvalidWhatsAppConnectionError,
  WhatsAppWebProvider,
  registerWhatsAppWebProvider,
} from "./index.js";
import type {
  WhatsAppSocket,
  WhatsAppSocketEventEmitter,
  WhatsAppSocketEventMap,
  WhatsAppSocketFactoryContext,
} from "./index.js";

const BASE_TIME = "2026-07-26T15:00:00.000Z";

type Listener<K extends keyof WhatsAppSocketEventMap> = (value: WhatsAppSocketEventMap[K]) => void;

class FakeEvents implements WhatsAppSocketEventEmitter {
  private readonly listeners = new Map<keyof WhatsAppSocketEventMap, Set<(value: never) => void>>();

  public on<K extends keyof WhatsAppSocketEventMap>(event: K, listener: Listener<K>): void {
    const values = this.listeners.get(event) ?? new Set();
    values.add(listener as (value: never) => void);
    this.listeners.set(event, values);
  }

  public off<K extends keyof WhatsAppSocketEventMap>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener as (value: never) => void);
  }

  public emit<K extends keyof WhatsAppSocketEventMap>(
    event: K,
    value: WhatsAppSocketEventMap[K],
  ): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value as never);
    }
  }
}

class FakeSocket implements WhatsAppSocket {
  public readonly ev = new FakeEvents();
  public readonly sent: { jid: string; content: { text: string } }[] = [];
  public readonly ended: (Error | undefined)[] = [];
  public readonly profilePictureRequests: string[] = [];
  public readonly historyRequests: {
    count: number;
    key: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null };
    timestamp: number;
  }[] = [];
  public logoutCalls = 0;
  public user: { id: string } | undefined;
  public sendId: string | null = "sent-1";

  public async sendMessage(
    jid: string,
    content: { readonly text: string },
  ): Promise<{ key: { id: string | null } }> {
    this.sent.push({ jid, content: { text: content.text } });
    return { key: { id: this.sendId } };
  }

  public async profilePictureUrl(jid: string): Promise<string | undefined> {
    this.profilePictureRequests.push(jid);
    return undefined;
  }

  public async fetchMessageHistory(
    count: number,
    key: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null },
    timestamp: number,
  ): Promise<string> {
    this.historyRequests.push({ count, key, timestamp });
    return "history-request-1";
  }

  public async downloadMedia(): Promise<Buffer> {
    return Buffer.from("media");
  }

  public end(error: Error | undefined): void {
    this.ended.push(error);
  }

  public async logout(): Promise<void> {
    this.logoutCalls += 1;
  }
}

class FakeSocketFactory {
  public readonly contexts: WhatsAppSocketFactoryContext[] = [];
  public readonly sockets: FakeSocket[] = [];
  public failures: Error[] = [];

  public create = async (context: WhatsAppSocketFactoryContext): Promise<FakeSocket> => {
    this.contexts.push(context);
    const failure = this.failures.shift();
    if (failure) throw failure;
    const socket = new FakeSocket();
    this.sockets.push(socket);
    return socket;
  };
}

interface ListenerCapture {
  readonly statuses: ChannelConnectionStatusEvent[];
  readonly messages: InboundMessage[];
  readonly listener: ChannelProviderListener;
}

function capture(): ListenerCapture {
  const statuses: ChannelConnectionStatusEvent[] = [];
  const messages: InboundMessage[] = [];
  return {
    statuses,
    messages,
    listener: {
      onStatus: (event) => {
        statuses.push(event);
      },
      onMessage: (message) => {
        messages.push(message);
      },
    },
  };
}

function connection(overrides: Partial<ChannelConnection> = {}): ChannelConnection {
  return {
    id: "whatsapp-personal",
    channelId: "whatsapp",
    providerId: "whatsapp-web",
    name: "WhatsApp pessoal",
    enabled: true,
    status: "disconnected",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

function closeUpdate(code: number, message: string): Partial<ConnectionState> {
  const error = new Error(message) as Error & {
    output: { statusCode: number };
  };
  error.output = { statusCode: code };
  return {
    connection: "close",
    lastDisconnect: {
      error,
      date: new Date(BASE_TIME),
    },
  };
}

async function storage(): Promise<string> {
  return mkdtemp(join(tmpdir(), "flowmind-whatsapp-provider-"));
}

test("provider identity, registry routing and fixed connection contract use providerId", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const registry = new ChannelProviderRegistry();
  const provider = registerWhatsAppWebProvider(registry, {
    authDirectory: root,
    socketFactory: new FakeSocketFactory().create,
  });

  assert.equal(provider.id, "whatsapp-web");
  assert.equal(provider.channelId, "whatsapp");
  assert.equal(registry.resolve("whatsapp-web"), provider);
  await assert.rejects(
    provider.connect(connection({ providerId: "legacy-provider" }), capture().listener),
    (error) => error instanceof InvalidWhatsAppConnectionError,
  );
  await assert.rejects(
    provider.connect(connection({ id: "legacy-connection" }), capture().listener),
    (error) => error instanceof InvalidWhatsAppConnectionError,
  );
});

test("QR is volatile, expires, is never logged or persisted, and clears on authentication/open", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const factory = new FakeSocketFactory();
  const events = capture();
  const timers: (() => void)[] = [];
  const provider = new WhatsAppWebProvider({
    authDirectory: root,
    socketFactory: factory.create,
    now: () => new Date(BASE_TIME),
    qrTtlMs: 30_000,
    setTimer: (callback) => {
      timers.push(callback);
      return callback;
    },
    clearTimer: () => undefined,
  });

  await provider.connect(connection(), events.listener);
  const socket = factory.sockets[0];
  assert.ok(socket);
  socket.ev.emit("connection.update", { qr: "SECRET-QR" });
  await provider.onIdle("whatsapp-personal");

  assert.deepEqual(provider.getSnapshot("whatsapp-personal")?.qr, {
    value: "SECRET-QR",
    expiresAt: "2026-07-26T15:00:30.000Z",
  });
  assert.equal(
    await new AuthStateRepository(join(root, "whatsapp-personal")).hasPersistedState(),
    false,
  );

  timers[0]?.();
  assert.equal(provider.getSnapshot("whatsapp-personal")?.qr, undefined);

  socket.ev.emit("connection.update", { qr: "SECOND-SECRET-QR" });
  socket.ev.emit("creds.update", { registered: true });
  await provider.onIdle("whatsapp-personal");
  assert.equal(provider.getSnapshot("whatsapp-personal")?.qr, undefined);
  const persisted = await readFile(join(root, "whatsapp-personal", "auth-state.json"), "utf8");
  assert.equal(persisted.includes("SECRET-QR"), false);
  assert.equal(persisted.includes("SECOND-SECRET-QR"), false);

  socket.user = { id: "5511999999999:3@s.whatsapp.net" };
  socket.ev.emit("connection.update", { connection: "open" });
  await provider.onIdle("whatsapp-personal");
  assert.deepEqual(
    events.statuses.map((event) => event.status),
    ["connecting", "waiting_for_qr", "waiting_for_qr", "authenticated", "connected"],
  );
  assert.deepEqual(events.statuses.at(-1)?.address, {
    channelId: "whatsapp",
    externalId: "5511999999999",
  });
});

test("restores persisted auth, normalizes inbound events and sends text", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new AuthStateRepository(join(root, "whatsapp-personal"));
  await repository.updateCreds({ registered: true });
  const factory = new FakeSocketFactory();
  const events = capture();
  const provider = new WhatsAppWebProvider({
    authDirectory: root,
    socketFactory: factory.create,
    now: () => new Date(BASE_TIME),
  });

  const connected = await provider.connect(connection(), events.listener);
  assert.deepEqual(connected, {
    connectionId: "whatsapp-personal",
    channelId: "whatsapp",
    providerId: "whatsapp-web",
  });
  assert.equal(factory.contexts[0]?.auth.creds.registered, true);
  const socket = factory.sockets[0];
  assert.ok(socket);
  socket.user = { id: "5511999999999@s.whatsapp.net" };
  socket.ev.emit("connection.update", { connection: "open" });
  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          id: "inbound-1",
          remoteJid: "5511888888888@s.whatsapp.net",
          fromMe: true,
        },
        message: { conversation: "Ola" },
        messageTimestamp: 1_721_996_400,
      } as WAMessage,
      {
        key: {
          id: "media-1",
          remoteJid: "120363000000000000@g.us",
          participant: "5511777777777@s.whatsapp.net",
          fromMe: false,
        },
        message: { imageMessage: { caption: "Foto" } },
        messageTimestamp: 1_721_996_400,
      } as WAMessage,
    ],
  });
  socket.ev.emit("messages.upsert", {
    type: "append",
    messages: [
      {
        key: { id: "history", remoteJid: "5511888888888@s.whatsapp.net" },
        message: { conversation: "Historico" },
        messageTimestamp: 1_721_996_300,
      } as WAMessage,
    ],
  });
  await provider.onIdle("whatsapp-personal");

  assert.equal(events.messages.length, 3);
  assert.equal(events.messages[0]?.fromSelf, true);
  assert.equal(events.messages[0]?.unsupported, false);
  assert.equal(events.messages[1]?.conversationType, "group");
  assert.equal(events.messages[1]?.senderAddress.externalId, "5511777777777");
  assert.equal(events.messages[1]?.unsupported, true);
  assert.equal(events.messages[2]?.providerMessageId, "history");
  assert.equal(events.messages[2]?.historical, true);
  assert.deepEqual(provider.getMediaInfo("whatsapp-personal", "media-1"), {
    kind: "image",
    mimeType: "image/jpeg",
  });
  const downloaded = await provider.downloadMedia("whatsapp-personal", "media-1");
  assert.equal(downloaded.data.toString(), "media");
  assert.equal(downloaded.info.kind, "image");

  const sent = await provider.send({
    connectionId: "whatsapp-personal",
    conversationAddress: {
      channelId: "whatsapp",
      externalId: "5511666666666",
    },
    content: "Resposta",
  });
  assert.deepEqual(socket.sent, [
    {
      jid: "5511666666666@s.whatsapp.net",
      content: { text: "Resposta" },
    },
  ]);
  assert.deepEqual(sent, {
    connectionId: "whatsapp-personal",
    providerMessageId: "sent-1",
    sentAt: BASE_TIME,
  });

  const historyRequestId = await provider.fetchMessageHistory(
    "whatsapp-personal",
    "5511888888888",
    {
      providerMessageId: "oldest-1",
      occurredAt: BASE_TIME,
      fromMe: false,
    },
    50,
  );
  assert.equal(historyRequestId, "history-request-1");
  assert.deepEqual(socket.historyRequests, [
    {
      count: 50,
      key: {
        remoteJid: "5511888888888@s.whatsapp.net",
        id: "oldest-1",
        fromMe: false,
      },
      timestamp: Math.floor(new Date(BASE_TIME).getTime() / 1_000),
    },
  ]);

  const allHistory = provider.fetchMessageHistories(
    "whatsapp-personal",
    [
      {
        externalId: "5511777777777",
        providerMessageId: "oldest-2",
        occurredAt: BASE_TIME,
        fromMe: true,
      },
      {
        externalId: "120363000000000000@g.us",
        providerMessageId: "oldest-3",
        occurredAt: BASE_TIME,
        fromMe: false,
      },
    ],
    50,
  );
  assert.deepEqual(allHistory, {
    requestedConversations: 2,
    countPerConversation: 50,
  });
  assert.throws(
    () => provider.fetchMessageHistories("whatsapp-personal", [], 50),
    /already requested/,
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(socket.historyRequests.length, 3);
});

test("history sync imports every message in chronological order", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const factory = new FakeSocketFactory();
  const events = capture();
  const provider = new WhatsAppWebProvider({
    authDirectory: root,
    socketFactory: factory.create,
  });

  await provider.connect(connection(), events.listener);
  const socket = factory.sockets[0];
  assert.ok(socket);
  socket.ev.emit("messaging-history.set", {
    chats: [],
    isLatest: false,
    progress: 60,
    contacts: [
      {
        id: "123456789@lid",
        phoneNumber: "5511888888888@s.whatsapp.net",
        name: "Maria",
        imgUrl: "https://example.com/maria.jpg",
      },
      {
        id: "987654321@lid",
        name: "Identificador interno",
      },
    ],
    messages: [
      {
        key: { id: "old", remoteJid: "123456789@lid" },
        message: { conversation: "Antiga" },
        messageTimestamp: 100,
      } as WAMessage,
      {
        key: { id: "latest", remoteJid: "123456789@lid" },
        message: { conversation: "Recente" },
        messageTimestamp: 200,
      } as WAMessage,
    ],
  });
  await provider.onIdle("whatsapp-personal");

  assert.equal(provider.getSnapshot("whatsapp-personal")?.historySyncStatus, "syncing");
  assert.equal(provider.getSnapshot("whatsapp-personal")?.historySyncProgress, 60);
  socket.ev.emit("messaging-history.status", {
    status: "paused",
    explicit: false,
  });
  await provider.onIdle("whatsapp-personal");
  assert.equal(provider.getSnapshot("whatsapp-personal")?.historySyncStatus, "paused");
  assert.equal(provider.getSnapshot("whatsapp-personal")?.historySyncProgress, 60);
  socket.ev.emit("messaging-history.set", {
    chats: [],
    contacts: [],
    messages: [],
    isLatest: false,
    progress: 60,
  });
  await provider.onIdle("whatsapp-personal");
  assert.equal(provider.getSnapshot("whatsapp-personal")?.historySyncStatus, "paused");
  assert.equal(events.messages.length, 2);
  assert.deepEqual(
    events.messages.map((message) => message.providerMessageId),
    ["old", "latest"],
  );
  assert.ok(events.messages.every((message) => message.historical));
  assert.deepEqual(
    provider.listChats("whatsapp-personal"),
    [],
    "historical messages must not create inbox chats",
  );
  assert.equal(events.messages[0]?.conversationAddress.externalId, "5511888888888");
  assert.equal(events.messages[0]?.displayName, "Maria");
  assert.equal(events.messages[0]?.avatarUrl, "https://example.com/maria.jpg");
  assert.equal(socket.profilePictureRequests.length, 0);
  socket.ev.emit("messaging-history.status", {
    status: "complete",
    explicit: true,
  });
  await provider.onIdle("whatsapp-personal");
  assert.equal(provider.getSnapshot("whatsapp-personal")?.historySyncStatus, "complete");
  assert.equal(provider.getSnapshot("whatsapp-personal")?.historySyncProgress, 100);
  assert.deepEqual(provider.listContacts("whatsapp-personal"), [
    {
      id: "5511888888888",
      name: "Maria",
      phone: "5511888888888",
      avatarUrl: "https://example.com/maria.jpg",
    },
  ]);

  socket.ev.emit("contacts.update", [
    {
      id: "123456789@lid",
      phoneNumber: "5511888888888@s.whatsapp.net",
      notify: "Maria Silva",
    },
  ]);
  await provider.onIdle("whatsapp-personal");
  assert.equal(
    provider.listContacts("whatsapp-personal")[0]?.name,
    "Maria",
    "the saved address-book name must take precedence over the public push name",
  );
  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: { id: "new-message", remoteJid: "123456789@lid" },
        message: { conversation: "Nova" },
        messageTimestamp: 300,
      } as WAMessage,
    ],
  });
  await provider.onIdle("whatsapp-personal");
  assert.equal(
    events.messages.length,
    3,
    JSON.stringify(provider.getSnapshot("whatsapp-personal")),
  );
  assert.equal(events.messages[2]?.displayName, "Maria");
  assert.equal(events.messages[2]?.conversationAddress.externalId, "5511888888888");
});

test("reconnects with bounded backoff and resets after an open socket", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const factory = new FakeSocketFactory();
  const waits: number[] = [];
  const events = capture();
  const provider = new WhatsAppWebProvider({
    authDirectory: root,
    socketFactory: factory.create,
    reconnectDelaysMs: [10, 20],
    maxReconnectAttempts: 2,
    delay: (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
    now: () => new Date(BASE_TIME),
  });

  await provider.connect(connection(), events.listener);
  factory.sockets[0]?.ev.emit(
    "connection.update",
    closeUpdate(DisconnectReason.connectionClosed, "network lost"),
  );
  await provider.onIdle("whatsapp-personal");

  assert.deepEqual(waits, [10]);
  assert.equal(factory.sockets.length, 2);
  assert.equal(provider.getSnapshot("whatsapp-personal")?.status, "reconnecting");
  factory.sockets[1]?.ev.emit("connection.update", { connection: "open" });
  await provider.onIdle("whatsapp-personal");
  assert.equal(provider.getSnapshot("whatsapp-personal")?.status, "connected");
});

test("supports an explicit reconnect without logging out", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const factory = new FakeSocketFactory();
  const provider = new WhatsAppWebProvider({
    authDirectory: root,
    socketFactory: factory.create,
  });

  await provider.connect(connection(), capture().listener);
  const first = factory.sockets[0];
  assert.ok(first);
  await provider.reconnect("whatsapp-personal");

  assert.equal(first.ended.length, 1);
  assert.equal(factory.sockets.length, 2);
  assert.equal(provider.getSnapshot("whatsapp-personal")?.status, "reconnecting");
});

test("stops after the reconnect limit when socket creation keeps failing", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const factory = new FakeSocketFactory();
  const waits: number[] = [];
  const events = capture();
  const provider = new WhatsAppWebProvider({
    authDirectory: root,
    socketFactory: factory.create,
    reconnectDelaysMs: [5, 15],
    maxReconnectAttempts: 2,
    delay: (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
  });

  await provider.connect(connection(), events.listener);
  factory.failures.push(new Error("factory-1"), new Error("factory-2"));
  factory.sockets[0]?.ev.emit(
    "connection.update",
    closeUpdate(DisconnectReason.connectionLost, "offline"),
  );
  await provider.onIdle("whatsapp-personal");

  assert.deepEqual(waits, [5, 15]);
  assert.equal(factory.contexts.length, 3);
  assert.equal(provider.getSnapshot("whatsapp-personal")?.status, "error");
  assert.match(provider.getSnapshot("whatsapp-personal")?.error ?? "", /reconnect limit/);
});

test("explicit logout is definitive, removes auth and never reconnects", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const factory = new FakeSocketFactory();
  const events = capture();
  const repository = new AuthStateRepository(join(root, "whatsapp-personal"));
  await repository.updateCreds({ registered: true });
  const provider = new WhatsAppWebProvider({
    authDirectory: root,
    socketFactory: factory.create,
    delay: () => Promise.resolve(),
  });

  await provider.connect(connection(), events.listener);
  const socket = factory.sockets[0];
  assert.ok(socket);
  socket.ev.emit("creds.update", { registered: true });
  await provider.logout("whatsapp-personal");

  assert.equal(socket.logoutCalls, 1);
  assert.equal(factory.sockets.length, 1);
  assert.equal(await repository.hasPersistedState(), false);
  assert.equal(provider.getSnapshot("whatsapp-personal"), undefined);
  assert.equal(events.statuses.at(-1)?.status, "logged_out");
});

test("remote logout and authentication failure clear QR/auth and do not reconnect", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const scenario of [
    { code: DisconnectReason.loggedOut, expected: "logged_out" },
    { code: DisconnectReason.badSession, expected: "error" },
  ] as const) {
    const scenarioRoot = join(root, String(scenario.code));
    const repository = new AuthStateRepository(join(scenarioRoot, "whatsapp-personal"));
    await repository.updateCreds({ registered: true });
    const factory = new FakeSocketFactory();
    const events = capture();
    const provider = new WhatsAppWebProvider({
      authDirectory: scenarioRoot,
      socketFactory: factory.create,
      delay: () => Promise.resolve(),
    });
    await provider.connect(connection(), events.listener);
    const socket = factory.sockets[0];
    assert.ok(socket);
    socket.ev.emit("connection.update", { qr: `secret-${scenario.code}` });
    socket.ev.emit("connection.update", closeUpdate(scenario.code, "authentication rejected"));
    await provider.onIdle("whatsapp-personal");

    assert.equal(provider.getSnapshot("whatsapp-personal")?.status, scenario.expected);
    assert.equal(provider.getSnapshot("whatsapp-personal")?.qr, undefined);
    assert.equal(await repository.hasPersistedState(), false);
    assert.equal(factory.sockets.length, 1);
  }
});

test("disconnect ends the socket without deleting restored credentials", async (t) => {
  const root = await storage();
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new AuthStateRepository(join(root, "whatsapp-personal"));
  await repository.updateCreds({ registered: true });
  const factory = new FakeSocketFactory();
  const provider = new WhatsAppWebProvider({
    authDirectory: root,
    socketFactory: factory.create,
  });

  await provider.connect(connection(), capture().listener);
  const socket = factory.sockets[0];
  assert.ok(socket);
  await provider.disconnect("whatsapp-personal");

  assert.equal(socket.ended.length, 1);
  assert.equal(await repository.hasPersistedState(), true);
});
