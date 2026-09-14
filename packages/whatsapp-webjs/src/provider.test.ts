import assert from "node:assert/strict";
import test from "node:test";

import {
  createWhatsAppPersonalConnectionSeed,
  WHATSAPP_CHANNEL_ID,
  WHATSAPP_PERSONAL_CONNECTION_ID,
  WHATSAPP_WEBJS_PROVIDER_ID,
} from "@flowmind/channel-core";
import type { ChannelConnectionStatusEvent, InboundMessage } from "@flowmind/channel-core";

import { WhatsAppWebJsProvider } from "./provider.js";
import type { WebJsChat, WebJsClient, WebJsContact, WebJsMessage } from "./types.js";

const NOW = new Date("2026-07-28T12:00:00.000Z");

test("connects, exposes the QR and synchronizes chats and contacts", async () => {
  const client = new FakeClient();
  client.contacts = [
    contact("5511999999999@c.us", "Maria"),
    contact("status@broadcast", "Status"),
  ];
  client.chats = [
    chat("5511999999999@c.us", 200),
    chat("status@broadcast", 300),
  ];
  const statuses: ChannelConnectionStatusEvent[] = [];
  const provider = createProvider(client);

  await provider.connect(connection(), {
    onMessage: () => undefined,
    onStatus: (event) => {
      statuses.push(event);
    },
  });
  client.emit("qr", "qr-value");
  client.emit("authenticated");
  client.emit("ready");
  await settle();

  assert.equal(provider.getSnapshot(WHATSAPP_PERSONAL_CONNECTION_ID)?.status, "connected");
  assert.equal(provider.listContacts(WHATSAPP_PERSONAL_CONNECTION_ID)[0]?.name, "Maria");
  assert.equal(provider.listContacts(WHATSAPP_PERSONAL_CONNECTION_ID).length, 1);
  assert.equal(
    provider.listChats(WHATSAPP_PERSONAL_CONNECTION_ID)[0]?.externalId,
    "5511999999999@c.us",
  );
  assert.equal(provider.listChats(WHATSAPP_PERSONAL_CONNECTION_ID).length, 1);
  assert.deepEqual(
    statuses.map((event) => event.status),
    ["connecting", "waiting_for_qr", "authenticated", "connected"],
  );
});

test("keeps chat synchronization when contact loading fails", async () => {
  const client = new FakeClient();
  client.contactsError = new Error("contacts unavailable");
  client.chats = [chat("5511999999999@c.us", 200)];
  const provider = createProvider(client);

  await provider.connect(connection(), {
    onMessage: () => undefined,
    onStatus: () => undefined,
  });
  client.emit("ready");
  await settle();

  assert.equal(provider.listContacts(WHATSAPP_PERSONAL_CONNECTION_ID).length, 0);
  assert.equal(provider.listChats(WHATSAPP_PERSONAL_CONNECTION_ID).length, 1);
});

test("normalizes live messages, sends replies and downloads media", async () => {
  const client = new FakeClient();
  const received: InboundMessage[] = [];
  const provider = createProvider(client);
  await provider.connect(connection(), {
    onMessage: (value) => {
      received.push(value);
    },
    onStatus: () => undefined,
  });
  const incoming = message({
    body: "Oi",
    hasMedia: true,
    serializedId: "message-1",
  });
  client.emit("message", incoming);
  await settle();

  assert.equal(received[0]?.content, "Oi");
  assert.equal(received[0]?.unsupported, false);
  const media = await provider.downloadMedia(WHATSAPP_PERSONAL_CONNECTION_ID, "message-1");
  assert.equal(media.data.toString(), "media");
  assert.equal(media.info.mimeType, "image/png");

  const sent = await provider.send({
    connectionId: WHATSAPP_PERSONAL_CONNECTION_ID,
    conversationAddress: {
      channelId: WHATSAPP_CHANNEL_ID,
      externalId: "5511999999999@c.us",
    },
    content: "Resposta",
  });
  assert.equal(sent.providerMessageId, "sent-1");
  assert.deepEqual(client.sent, [["5511999999999@c.us", "Resposta"]]);
});

test("imports history without letting one failed chat stop the remaining chats", async () => {
  const client = new FakeClient();
  const received: InboundMessage[] = [];
  client.chatsById.set("broken@c.us", new Error("unavailable"));
  client.chatsById.set(
    "working@c.us",
    chat("working@c.us", 100, [message({ serializedId: "old-1" })]),
  );
  const provider = createProvider(client);
  await provider.connect(connection(), {
    onMessage: (value) => {
      received.push(value);
    },
    onStatus: () => undefined,
  });

  const result = provider.fetchMessageHistories(
    WHATSAPP_PERSONAL_CONNECTION_ID,
    [cursor("broken@c.us"), cursor("working@c.us")],
    25,
  );
  await settle();

  assert.equal(result.requestedConversations, 2);
  assert.equal(received[0]?.historical, true);
  assert.equal(provider.getSnapshot(WHATSAPP_PERSONAL_CONNECTION_ID)?.historySyncProgress, 100);
});

function createProvider(client: FakeClient): WhatsAppWebJsProvider {
  return new WhatsAppWebJsProvider({
    authDirectory: "unused",
    clientFactory: () => client,
    now: () => NOW,
  });
}

function connection() {
  return createWhatsAppPersonalConnectionSeed(NOW.toISOString(), WHATSAPP_WEBJS_PROVIDER_ID);
}

function contact(id: string, name: string): WebJsContact {
  return {
    id: { _serialized: id },
    name,
    number: id.replace(/@.+$/, ""),
    isMyContact: true,
    isUser: true,
    getProfilePicUrl: async () => "https://example.test/avatar.jpg",
  };
}

function chat(id: string, timestamp: number, messages: readonly WebJsMessage[] = []): WebJsChat {
  return {
    id: { _serialized: id },
    isGroup: false,
    timestamp,
    unreadCount: 0,
    archived: false,
    fetchMessages: async () => messages,
  };
}

function message(
  overrides: {
    readonly body?: string;
    readonly hasMedia?: boolean;
    readonly serializedId?: string;
    readonly timestamp?: number;
  } = {},
): WebJsMessage {
  const id = overrides.serializedId ?? "message-1";
  return {
    id: { _serialized: id },
    from: "5511999999999@c.us",
    to: "5531888888888@c.us",
    fromMe: false,
    body: overrides.body ?? "historical",
    timestamp: overrides.timestamp ?? 100,
    type: "image",
    hasMedia: overrides.hasMedia ?? false,
    getContact: async () => contact("5511999999999@c.us", "Maria"),
    getChat: async () => chat("5511999999999@c.us", 100),
    downloadMedia: async () => ({
      data: Buffer.from("media").toString("base64"),
      mimetype: "image/png",
      filename: "image.png",
    }),
  };
}

function cursor(externalId: string) {
  return {
    externalId,
    providerMessageId: "cursor",
    occurredAt: NOW.toISOString(),
    fromMe: false,
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

type EventName =
  "qr" | "authenticated" | "ready" | "auth_failure" | "disconnected" | "message" | "message_create";

class FakeClient implements WebJsClient {
  public contacts: readonly WebJsContact[] = [];
  public contactsError?: Error;
  public chats: readonly WebJsChat[] = [];
  public readonly chatsById = new Map<string, WebJsChat | Error>();
  public readonly sent: [string, string][] = [];
  private readonly listeners = new Map<EventName, ((value?: unknown) => void)[]>();

  public on(event: "qr", listener: (qr: string) => void): this;
  public on(event: "authenticated" | "ready", listener: () => void): this;
  public on(event: "auth_failure" | "disconnected", listener: (reason: string) => void): this;
  public on(event: "message" | "message_create", listener: (message: WebJsMessage) => void): this;
  public on(event: EventName, listener: (value: never) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener as (value?: unknown) => void);
    this.listeners.set(event, listeners);
    return this;
  }

  public emit(event: EventName, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }

  public async initialize(): Promise<void> {}
  public async destroy(): Promise<void> {}
  public async logout(): Promise<void> {}
  public async getChats(): Promise<readonly WebJsChat[]> {
    return this.chats;
  }
  public async getContacts(): Promise<readonly WebJsContact[]> {
    if (this.contactsError) throw this.contactsError;
    return this.contacts;
  }
  public async getChatById(id: string): Promise<WebJsChat> {
    const value = this.chatsById.get(id);
    if (value instanceof Error) throw value;
    if (!value) throw new Error(`Unknown chat: ${id}`);
    return value;
  }
  public async getContactById(id: string): Promise<WebJsContact> {
    return contact(id, "Maria");
  }
  public async sendMessage(chatId: string, content: string) {
    this.sent.push([chatId, content]);
    return { id: { _serialized: "sent-1" }, timestamp: 300 };
  }
}
