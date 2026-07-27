import assert from "node:assert/strict";
import test from "node:test";
import {
  DuplicateChannelProviderError,
  UnknownChannelProviderError,
  createDefaultChannelSettings,
  externalMessageKey,
} from "@flowmind/channel-core";
import type {
  ChannelConnection,
  ChannelConnectionRepository,
  ChannelConversation,
  ChannelConversationRepository,
  ChannelMessage,
  ChannelMessageRepository,
  ChannelProvider,
  ChannelProviderListener,
  ChannelSettings,
  ChannelSettingsRepository,
  ConversationMode,
  ExternalMessageRecord,
  ExternalMessageRecordRepository,
  ExternalMessageStatus,
  InboundMessage,
  OutboundMessage,
  ProviderConnection,
  SendResult,
} from "@flowmind/channel-core";
import { BoundedQueue } from "./bounded-queue.js";
import { ChannelRuntime } from "./channel-runtime.js";
import { ConversationProcessor } from "./conversation-processor.js";
import type {
  AgentChatRequest,
  AgentChatResult,
  AgentRuntimePort,
  Clock,
  IdentifierGenerator,
} from "./ports.js";
import { ChannelProviderRegistry } from "./provider-registry.js";

const BASE_TIME = "2026-07-26T12:00:00.000Z";

class FixedClock implements Clock {
  public constructor(private value: Date) {}

  public now(): Date {
    return new Date(this.value);
  }

  public set(value: Date): void {
    this.value = value;
  }
}

class SequenceIds implements IdentifierGenerator {
  private value = 0;

  public next(): string {
    this.value += 1;
    return `id-${this.value}`;
  }
}

class MemoryConnections implements ChannelConnectionRepository {
  public readonly values = new Map<string, ChannelConnection>();

  public constructor(values: readonly ChannelConnection[]) {
    for (const value of values) this.values.set(value.id, value);
  }

  public async findById(id: string): Promise<ChannelConnection | undefined> {
    return this.values.get(id);
  }

  public async list(): Promise<readonly ChannelConnection[]> {
    return [...this.values.values()];
  }

  public async save(connection: ChannelConnection): Promise<void> {
    this.values.set(connection.id, connection);
  }
}

class MemoryConversations implements ChannelConversationRepository {
  public readonly values = new Map<string, ChannelConversation>();

  public async findById(id: string): Promise<ChannelConversation | undefined> {
    return this.values.get(id);
  }

  public async findByConnectionAndExternalConversationId(
    connectionId: string,
    externalConversationId: string,
  ): Promise<ChannelConversation | undefined> {
    return [...this.values.values()].find(
      (value) =>
        value.connectionId === connectionId &&
        value.externalConversationId === externalConversationId,
    );
  }

  public async save(conversation: ChannelConversation): Promise<void> {
    this.values.set(conversation.id, conversation);
  }
}

class MemoryMessages implements ChannelMessageRepository {
  public readonly values = new Map<string, ChannelMessage>();

  public async findById(id: string): Promise<ChannelMessage | undefined> {
    return this.values.get(id);
  }

  public async listByConversation(conversationId: string): Promise<readonly ChannelMessage[]> {
    return [...this.values.values()].filter((value) => value.conversationId === conversationId);
  }

  public async save(message: ChannelMessage): Promise<void> {
    this.values.set(message.id, message);
  }
}

class MemoryExternalMessages implements ExternalMessageRecordRepository {
  public readonly values = new Map<string, ExternalMessageRecord>();
  public readonly statusHistory: ExternalMessageStatus[] = [];

  public async find(
    connectionId: string,
    providerMessageId: string,
  ): Promise<ExternalMessageRecord | undefined> {
    return this.values.get(externalMessageKey({ connectionId, providerMessageId }));
  }

  public async claim(record: ExternalMessageRecord): Promise<boolean> {
    const key = externalMessageKey(record);
    if (this.values.has(key)) return false;
    this.values.set(key, record);
    this.statusHistory.push(record.status);
    return true;
  }

  public async save(record: ExternalMessageRecord): Promise<void> {
    this.values.set(externalMessageKey(record), record);
    this.statusHistory.push(record.status);
  }
}

class MemorySettings implements ChannelSettingsRepository {
  public constructor(public value: ChannelSettings) {}

  public async get(): Promise<ChannelSettings> {
    return this.value;
  }

  public async save(settings: ChannelSettings): Promise<void> {
    this.value = settings;
  }
}

class FakeAgents implements AgentRuntimePort {
  public readonly requests: AgentChatRequest[] = [];

  public async chat(request: AgentChatRequest): Promise<AgentChatResult> {
    this.requests.push(request);
    return {
      session: { id: request.sessionId ?? "agent-session-1" },
      message: { content: `reply:${request.message}` },
    };
  }
}

class FakeProvider implements ChannelProvider {
  public readonly sent: OutboundMessage[] = [];
  public readonly connected: string[] = [];
  public readonly disconnected: string[] = [];
  public listener: ChannelProviderListener | undefined;
  public sendError: Error | undefined;

  public constructor(
    public readonly id = "whatsapp-web",
    public readonly channelId = "whatsapp",
  ) {}

  public async connect(
    connection: ChannelConnection,
    listener: ChannelProviderListener,
  ): Promise<ProviderConnection> {
    this.connected.push(connection.id);
    this.listener = listener;
    return {
      connectionId: connection.id,
      channelId: this.channelId,
      providerId: this.id,
    };
  }

  public async disconnect(connectionId: string): Promise<void> {
    this.disconnected.push(connectionId);
  }

  public async send(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message);
    if (this.sendError) throw this.sendError;
    return {
      connectionId: message.connectionId,
      providerMessageId: `sent-${this.sent.length}`,
      sentAt: BASE_TIME,
    };
  }
}

interface Fixture {
  readonly clock: FixedClock;
  readonly connections: MemoryConnections;
  readonly conversations: MemoryConversations;
  readonly messages: MemoryMessages;
  readonly externalMessages: MemoryExternalMessages;
  readonly settings: MemorySettings;
  readonly agents: FakeAgents;
  readonly provider: FakeProvider;
  readonly providers: ChannelProviderRegistry;
  readonly processor: ConversationProcessor;
}

function enabledSettings(overrides: Partial<ChannelSettings> = {}): ChannelSettings {
  return {
    enabled: true,
    pauseAll: false,
    defaultAgentId: "csnf",
    defaultConversationMode: "enabled",
    allowGroups: false,
    processMessagesFromSelf: false,
    rateLimit: {
      auto: { maxMessages: 10, windowMs: 60_000 },
      global: { maxMessages: 100, windowMs: 60_000 },
    },
    ...overrides,
  };
}

function fixture(
  settingsValue: ChannelSettings = enabledSettings(),
  connectionValues: readonly ChannelConnection[] = [connection("connection-1")],
): Fixture {
  const clock = new FixedClock(new Date(BASE_TIME));
  const connections = new MemoryConnections(connectionValues);
  const conversations = new MemoryConversations();
  const messages = new MemoryMessages();
  const externalMessages = new MemoryExternalMessages();
  const settings = new MemorySettings(settingsValue);
  const agents = new FakeAgents();
  const provider = new FakeProvider();
  const providers = new ChannelProviderRegistry();
  providers.register(provider);
  const processor = new ConversationProcessor({
    connections,
    conversations,
    messages,
    externalMessages,
    settings,
    providers,
    agents,
    clock,
    identifiers: new SequenceIds(),
  });
  return {
    clock,
    connections,
    conversations,
    messages,
    externalMessages,
    settings,
    agents,
    provider,
    providers,
    processor,
  };
}

function connection(id: string, overrides: Partial<ChannelConnection> = {}): ChannelConnection {
  return {
    id,
    channelId: "whatsapp",
    providerId: "whatsapp-web",
    name: "WhatsApp pessoal",
    enabled: true,
    status: "connected",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

function inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    connectionId: "connection-1",
    providerMessageId: "provider-message-1",
    conversationAddress: {
      channelId: "whatsapp",
      externalId: "5511888888888",
    },
    conversationType: "private",
    senderAddress: {
      channelId: "whatsapp",
      externalId: "5511888888888",
    },
    content: "Ola",
    occurredAt: BASE_TIME,
    fromSelf: false,
    unsupported: false,
    ...overrides,
  };
}

async function seedConversation(
  target: MemoryConversations,
  automationMode: ConversationMode,
  overrides: Partial<ChannelConversation> = {},
): Promise<ChannelConversation> {
  const value: ChannelConversation = {
    id: "conversation-existing",
    channelId: "whatsapp",
    connectionId: "connection-1",
    externalConversationId: "5511888888888",
    type: "private",
    normalizedPhone: "5511888888888",
    agentId: "csnf",
    automationMode,
    unreadCount: 0,
    metadata: {},
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
  await target.save(value);
  return value;
}

test("provider registry is extensible and rejects unknown or duplicate provider ids", () => {
  const providers = new ChannelProviderRegistry();
  const whatsapp = new FakeProvider();
  const futureProvider = new FakeProvider("future-provider", "future-channel");

  providers.register(whatsapp);
  providers.register(futureProvider);

  assert.equal(providers.resolve("whatsapp-web"), whatsapp);
  assert.equal(providers.resolve("future-provider"), futureProvider);
  assert.deepEqual(providers.list(), [whatsapp, futureProvider]);
  assert.throws(
    () => providers.resolve("unknown"),
    (error) => error instanceof UnknownChannelProviderError && error.providerId === "unknown",
  );
  assert.throws(
    () => providers.register(whatsapp),
    (error) =>
      error instanceof DuplicateChannelProviderError && error.providerId === "whatsapp-web",
  );
});

test("bounded queue enforces capacity and isolates worker and error-handler failures", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const visited: number[] = [];
  const errors: number[] = [];
  const queue = new BoundedQueue<number>(
    async (value) => {
      visited.push(value);
      if (value === 1) {
        await gate;
        throw new Error("broken item");
      }
    },
    {
      capacity: 2,
      onError: async (_error, value) => {
        errors.push(value);
        throw new Error("broken reporter");
      },
    },
  );

  queue.start();
  assert.deepEqual(queue.enqueue(1), { accepted: true, size: 1 });
  assert.deepEqual(queue.enqueue(2), { accepted: true, size: 2 });
  assert.deepEqual(queue.enqueue(3), { accepted: false, size: 2 });
  release?.();
  await queue.onIdle();
  assert.deepEqual(visited, [1, 2]);
  assert.deepEqual(errors, [1]);
  await queue.stop();
  assert.equal(queue.enqueue(4).accepted, false);
});

test("processor creates a complete private conversation and processes the external record", async () => {
  const context = fixture();
  const result = await context.processor.process(inbound());

  assert.equal(result.status, "processed");
  assert.deepEqual([...context.conversations.values.values()][0], {
    id: "id-2",
    channelId: "whatsapp",
    connectionId: "connection-1",
    externalConversationId: "5511888888888",
    type: "private",
    normalizedPhone: "5511888888888",
    agentId: "csnf",
    sessionId: "agent-session-1",
    automationMode: "enabled",
    unreadCount: 1,
    lastMessagePreview: "Ola",
    lastMessageAt: BASE_TIME,
    lastInboundAt: BASE_TIME,
    lastOutboundAt: BASE_TIME,
    metadata: { csnfIntroducedAt: BASE_TIME },
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });
  assert.deepEqual(context.agents.requests, [
    {
      agentId: "csnf",
      message: "Ola",
      target: {
        channelId: "whatsapp",
        connectionId: "connection-1",
        conversationId: "id-2",
      },
    },
  ]);
  assert.equal(context.provider.sent.length, 2);
  assert.match(context.provider.sent[0]?.content ?? "", /Eu sou o CSNF/i);
  assert.equal(context.provider.sent[1]?.connectionId, "connection-1");
  assert.deepEqual(context.externalMessages.statusHistory, ["received", "processing", "processed"]);
});

test("safe settings disable private automation without agent or send side effects", async () => {
  const context = fixture(createDefaultChannelSettings("csnf"));
  const result = await context.processor.process(inbound());

  assert.deepEqual(result, {
    status: "ignored",
    reason: "channel-disabled",
    conversationId: "id-2",
  });
  assert.equal(context.conversations.values.size, 1);
  assert.equal(context.messages.values.size, 1);
  assert.equal(context.agents.requests.length, 0);
  assert.equal(context.provider.sent.length, 0);
  assert.equal([...context.externalMessages.values.values()][0]?.status, "ignored");
});

test("inbox updates existing conversations while automation remains disabled", async () => {
  const context = fixture(createDefaultChannelSettings("csnf"));
  await seedConversation(context.conversations, "disabled", {
    unreadCount: 2,
    lastMessagePreview: "Anterior",
  });

  const result = await context.processor.process(inbound({ content: "Nova mensagem" }));

  assert.deepEqual(result, {
    status: "ignored",
    reason: "channel-disabled",
    conversationId: "conversation-existing",
  });
  assert.deepEqual(context.conversations.values.get("conversation-existing"), {
    id: "conversation-existing",
    channelId: "whatsapp",
    connectionId: "connection-1",
    externalConversationId: "5511888888888",
    type: "private",
    normalizedPhone: "5511888888888",
    agentId: "csnf",
    automationMode: "disabled",
    unreadCount: 3,
    lastMessagePreview: "Nova mensagem",
    lastMessageAt: BASE_TIME,
    lastInboundAt: BASE_TIME,
    metadata: {},
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });
  assert.equal(context.messages.values.size, 1);
  assert.equal(context.agents.requests.length, 0);
  assert.equal(context.provider.sent.length, 0);
});

test("inbox persists the provider display name and avatar", async () => {
  const context = fixture(createDefaultChannelSettings("csnf"));

  await context.processor.process(
    inbound({
      displayName: "Cliente Exemplo",
      avatarUrl: "https://example.com/avatar.jpg",
    }),
  );

  const conversation = [...context.conversations.values.values()][0];
  assert.equal(conversation?.displayName, "Cliente Exemplo");
  assert.equal(conversation?.normalizedPhone, "5511888888888");
  assert.equal(conversation?.metadata.avatarUrl, "https://example.com/avatar.jpg");
});

test("pauseAll and every non-enabled authorization mode prevent automatic replies", async () => {
  const paused = fixture(enabledSettings({ pauseAll: true }));
  assert.deepEqual(await paused.processor.process(inbound()), {
    status: "ignored",
    reason: "all-paused",
    conversationId: "id-2",
  });

  for (const mode of ["disabled", "paused", "manual", "blocked"] as const) {
    const context = fixture();
    await seedConversation(context.conversations, mode);
    const result = await context.processor.process(inbound());
    assert.equal(result.status, "ignored");
    if (result.status === "ignored") assert.equal(result.reason, "conversation-mode");
    assert.equal(context.agents.requests.length, 0);
  }
});

test("new private conversations default disabled and new groups default blocked", async () => {
  const privateContext = fixture(
    enabledSettings({ defaultConversationMode: "disabled", allowGroups: true }),
  );
  await privateContext.processor.process(inbound());
  assert.equal([...privateContext.conversations.values.values()][0]?.automationMode, "disabled");

  const groupContext = fixture(
    enabledSettings({ defaultConversationMode: "enabled", allowGroups: false }),
  );
  const result = await groupContext.processor.process(
    inbound({
      conversationType: "group",
      conversationAddress: { channelId: "whatsapp", externalId: "group-1" },
    }),
  );
  assert.equal(result.status, "ignored");
  if (result.status === "ignored") assert.equal(result.reason, "groups-not-allowed");
  assert.equal([...groupContext.conversations.values.values()][0]?.automationMode, "blocked");
  assert.equal(groupContext.agents.requests.length, 0);
});

test("fromSelf and unsupported messages are ignored unless explicitly authorized", async () => {
  const selfContext = fixture();
  const fromSelf = await selfContext.processor.process(inbound({ fromSelf: true }));
  assert.equal(fromSelf.status, "ignored");
  if (fromSelf.status === "ignored") {
    assert.equal(fromSelf.reason, "from-self");
    assert.equal(fromSelf.conversationId, "id-2");
  }
  assert.equal(selfContext.conversations.values.get("id-2")?.type, "private");
  assert.equal(selfContext.conversations.values.get("id-2")?.unreadCount, 0);
  assert.equal(selfContext.messages.values.get("id-1")?.direction, "outbound");
  assert.equal(selfContext.messages.values.get("id-1")?.status, "sent");

  const unsupportedContext = fixture();
  const unsupported = await unsupportedContext.processor.process(
    inbound({ content: "", unsupported: true }),
  );
  assert.equal(unsupported.status, "ignored");
  if (unsupported.status === "ignored") {
    assert.equal(unsupported.reason, "unsupported");
    assert.equal(unsupported.conversationId, "id-2");
  }
  assert.equal(unsupportedContext.conversations.values.get("id-2")?.lastMessagePreview, "[Midia]");
  assert.equal(unsupportedContext.messages.values.get("id-1")?.direction, "inbound");

  const allowedSelfContext = fixture(enabledSettings({ processMessagesFromSelf: true }));
  assert.equal(
    (await allowedSelfContext.processor.process(inbound({ fromSelf: true }))).status,
    "processed",
  );
});

test("deduplication uses connectionId plus providerMessageId", async () => {
  const context = fixture(enabledSettings(), [
    connection("connection-1"),
    connection("connection-2"),
  ]);

  assert.equal((await context.processor.process(inbound())).status, "processed");
  const duplicate = await context.processor.process(inbound());
  assert.equal(duplicate.status, "ignored");
  if (duplicate.status === "ignored") assert.equal(duplicate.reason, "duplicate");
  assert.equal(
    (await context.processor.process(inbound({ connectionId: "connection-2" }))).status,
    "processed",
  );
  assert.equal(context.agents.requests.length, 2);
  assert.equal(context.externalMessages.values.size, 2);
});

test("auto and global rate limits are independent", async () => {
  const autoLimited = fixture(
    enabledSettings({
      rateLimit: {
        auto: { maxMessages: 1, windowMs: 1_000 },
        global: { maxMessages: 10, windowMs: 1_000 },
      },
    }),
  );
  assert.equal((await autoLimited.processor.process(inbound())).status, "processed");
  const autoResult = await autoLimited.processor.process(
    inbound({ providerMessageId: "provider-message-2" }),
  );
  assert.equal(autoResult.status, "ignored");
  if (autoResult.status === "ignored") assert.equal(autoResult.reason, "auto-rate-limited");

  autoLimited.clock.set(new Date("2026-07-26T12:00:01.001Z"));
  const afterLimit = await autoLimited.processor.process(
    inbound({ providerMessageId: "provider-message-3" }),
  );
  assert.equal(afterLimit.status, "ignored");
  assert.equal([...autoLimited.conversations.values.values()][0]?.automationMode, "paused");

  const globallyLimited = fixture(
    enabledSettings({
      rateLimit: {
        auto: { maxMessages: 10, windowMs: 60_000 },
        global: { maxMessages: 1, windowMs: 60_000 },
      },
    }),
  );
  assert.equal((await globallyLimited.processor.process(inbound())).status, "processed");
  const globalResult = await globallyLimited.processor.process(
    inbound({
      providerMessageId: "provider-message-2",
      conversationAddress: { channelId: "whatsapp", externalId: "5511777777777" },
      senderAddress: { channelId: "whatsapp", externalId: "5511777777777" },
    }),
  );
  assert.equal(globalResult.status, "ignored");
  if (globalResult.status === "ignored") {
    assert.equal(globalResult.reason, "global-rate-limited");
  }
});

test("AgentRuntime session is reused for subsequent messages", async () => {
  const context = fixture();
  await context.processor.process(inbound());
  await context.processor.process(
    inbound({ providerMessageId: "provider-message-2", content: "Continuar" }),
  );

  assert.deepEqual(context.agents.requests, [
    {
      agentId: "csnf",
      message: "Ola",
      target: {
        channelId: "whatsapp",
        connectionId: "connection-1",
        conversationId: "id-2",
      },
    },
    {
      agentId: "csnf",
      message: "Continuar",
      sessionId: "agent-session-1",
      target: {
        channelId: "whatsapp",
        connectionId: "connection-1",
        conversationId: "id-2",
      },
    },
  ]);
});

test("send failures persist failed message and external-record statuses", async () => {
  const context = fixture();
  context.provider.sendError = new Error("provider offline");

  await assert.rejects(context.processor.process(inbound()), /provider offline/);
  const outbound = [...context.messages.values.values()].find(
    (value) => value.direction === "outbound",
  );
  assert.equal(outbound?.status, "failed");
  assert.equal(outbound?.error, "provider offline");
  assert.equal([...context.externalMessages.values.values()][0]?.status, "failed");
});

test("ChannelRuntime resolves connection.providerId and skips disabled connections", async () => {
  const selectedProvider = new FakeProvider("selected-provider");
  const unusedProvider = new FakeProvider("unused-provider");
  const connections = new MemoryConnections([
    connection("enabled-connection", { providerId: "selected-provider" }),
    connection("disabled-connection", {
      providerId: "missing-provider",
      enabled: false,
      status: "disconnected",
    }),
  ]);
  const context = fixture();
  const providers = new ChannelProviderRegistry();
  providers.register(unusedProvider);
  providers.register(selectedProvider);
  const runtime = new ChannelRuntime(connections, providers, context.processor, {
    queueCapacity: 2,
  });

  await runtime.start();
  assert.deepEqual(selectedProvider.connected, ["enabled-connection"]);
  assert.deepEqual(unusedProvider.connected, []);

  await selectedProvider.listener?.onStatus({
    connectionId: "enabled-connection",
    status: "waiting_for_qr",
    occurredAt: "2026-07-26T12:01:00.000Z",
  });
  assert.equal(connections.values.get("enabled-connection")?.status, "waiting_for_qr");

  await runtime.stop();
  assert.deepEqual(selectedProvider.disconnected, ["enabled-connection"]);
});
