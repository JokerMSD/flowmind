import { join } from "node:path";
import { createDefaultChannelSettings, externalMessageKey } from "@flowmind/channel-core";
import type {
  ChannelConnection,
  ChannelConnectionRepository,
  ChannelConversation,
  ChannelConversationRepository,
  ChannelMessage,
  ChannelMessageRepository,
  ChannelSettings,
  ChannelSettingsRepository,
  ExternalMessageRecord,
  ExternalMessageRecordRepository,
} from "@flowmind/channel-core";
import { JsonStore } from "./json-store.js";
import {
  isArrayOf,
  isChannelConnection,
  isChannelConversation,
  isChannelMessage,
  isChannelSettings,
  isExternalMessageRecord,
} from "./validators.js";

export interface ChannelMemoryRetention {
  readonly messagesMaxAgeMs?: number;
  readonly externalMessagesMaxAgeMs?: number;
}

export interface JsonChannelMemoryOptions {
  readonly defaultSettings?: ChannelSettings;
  readonly now?: () => Date;
  readonly retention?: ChannelMemoryRetention;
}

export interface ListOptions {
  readonly search?: string;
  readonly order?: "asc" | "desc";
}

export interface ConversationListOptions extends ListOptions {
  readonly channelId?: string;
  readonly connectionId?: string;
  readonly externalConversationId?: string;
  readonly type?: ChannelConversation["type"];
  readonly automationMode?: ChannelConversation["automationMode"];
}

export interface MessageListOptions extends ListOptions {
  readonly direction?: ChannelMessage["direction"];
  readonly status?: ChannelMessage["status"];
}

export interface ConnectionListOptions extends ListOptions {
  readonly channelId?: string;
  readonly providerId?: string;
  readonly enabled?: boolean;
  readonly status?: ChannelConnection["status"];
}

export class JsonChannelConnectionRepository implements ChannelConnectionRepository {
  private readonly collection: JsonStore<ChannelConnection[]>;

  public constructor(storagePath: string) {
    this.collection = collection(storagePath, "connections.json", isChannelConnection);
  }

  public async list(options?: ConnectionListOptions): Promise<readonly ChannelConnection[]> {
    return sort(
      (await this.collection.read()).filter(
        (item) =>
          (options?.channelId === undefined || item.channelId === options.channelId) &&
          (options?.providerId === undefined || item.providerId === options.providerId) &&
          (options?.enabled === undefined || item.enabled === options.enabled) &&
          (options?.status === undefined || item.status === options.status) &&
          matches(options?.search, item.id, item.name, item.channelId, item.providerId),
      ),
      options?.order,
    );
  }

  public async findById(id: string): Promise<ChannelConnection | undefined> {
    return (await this.collection.read()).find((item) => item.id === id);
  }

  public async save(connection: ChannelConnection): Promise<void> {
    await upsert(this.collection, connection);
  }
}

export class JsonChannelConversationRepository implements ChannelConversationRepository {
  private readonly collection: JsonStore<ChannelConversation[]>;

  public constructor(storagePath: string) {
    this.collection = collection(storagePath, "conversations.json", isChannelConversation);
  }

  public async list(options?: ConversationListOptions): Promise<readonly ChannelConversation[]> {
    return sortConversations(
      (await this.collection.read()).filter(
        (item) =>
          (options?.channelId === undefined || item.channelId === options.channelId) &&
          (options?.connectionId === undefined || item.connectionId === options.connectionId) &&
          (options?.externalConversationId === undefined ||
            item.externalConversationId === options.externalConversationId) &&
          (options?.type === undefined || item.type === options.type) &&
          (options?.automationMode === undefined ||
            item.automationMode === options.automationMode) &&
          matches(
            options?.search,
            item.id,
            item.externalConversationId,
            item.agentId,
            item.displayName ?? "",
            item.normalizedPhone ?? "",
            item.lastMessagePreview ?? "",
          ),
      ),
      options?.order,
    );
  }

  public async findById(id: string): Promise<ChannelConversation | undefined> {
    return (await this.collection.read()).find((item) => item.id === id);
  }

  public async findByConnectionAndExternalConversationId(
    connectionId: string,
    externalConversationId: string,
  ): Promise<ChannelConversation | undefined> {
    return (await this.collection.read()).find(
      (item) =>
        item.connectionId === connectionId &&
        item.externalConversationId === externalConversationId,
    );
  }

  public async save(conversation: ChannelConversation): Promise<void> {
    await upsert(this.collection, conversation);
  }
}

export class JsonChannelMessageRepository implements ChannelMessageRepository {
  private readonly collection: JsonStore<ChannelMessage[]>;

  public constructor(
    storagePath: string,
    private readonly options: JsonChannelMemoryOptions = {},
  ) {
    this.collection = collection(storagePath, "messages.json", isChannelMessage);
  }

  public async listByConversation(
    conversationId: string,
    options?: MessageListOptions,
  ): Promise<readonly ChannelMessage[]> {
    await this.cleanup();
    return sort(
      (await this.collection.read()).filter(
        (item) =>
          item.conversationId === conversationId &&
          (options?.direction === undefined || item.direction === options.direction) &&
          (options?.status === undefined || item.status === options.status) &&
          matches(options?.search, item.id, item.content, item.providerMessageId ?? ""),
      ),
      options?.order,
    );
  }

  public async findById(id: string): Promise<ChannelMessage | undefined> {
    await this.cleanup();
    return (await this.collection.read()).find((item) => item.id === id);
  }

  public async save(message: ChannelMessage): Promise<void> {
    await this.cleanup();
    await upsert(this.collection, message);
  }

  public async cleanup(): Promise<void> {
    const maxAge = this.options.retention?.messagesMaxAgeMs;
    if (maxAge === undefined) return;
    const cutoff = this.now().getTime() - maxAge;
    await this.collection.mutate((items) =>
      items.filter((item) => dateValue(item.createdAt) >= cutoff),
    );
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

export class JsonExternalMessageRecordRepository implements ExternalMessageRecordRepository {
  private readonly collection: JsonStore<ExternalMessageRecord[]>;

  public constructor(
    storagePath: string,
    private readonly options: JsonChannelMemoryOptions = {},
  ) {
    this.collection = collection(storagePath, "external-messages.json", isExternalMessageRecord);
  }

  public async find(
    connectionId: string,
    providerMessageId: string,
  ): Promise<ExternalMessageRecord | undefined> {
    await this.cleanup();
    return (await this.collection.read()).find(
      (item) => item.connectionId === connectionId && item.providerMessageId === providerMessageId,
    );
  }

  public async claim(record: ExternalMessageRecord): Promise<boolean> {
    let claimed = false;
    await this.collection.mutate((items) => {
      const retained = this.applyRetention(items);
      if (retained.some((item) => externalMessageKey(item) === externalMessageKey(record)))
        return retained;
      claimed = true;
      return [...retained, record];
    });
    return claimed;
  }

  public async save(record: ExternalMessageRecord): Promise<void> {
    await this.collection.mutate((items) => {
      const retained = this.applyRetention(items);
      const index = retained.findIndex(
        (item) => externalMessageKey(item) === externalMessageKey(record),
      );
      if (index < 0) return [...retained, record];
      return retained.map((item) =>
        externalMessageKey(item) === externalMessageKey(record) ? record : item,
      );
    });
  }

  public async cleanup(): Promise<void> {
    await this.collection.mutate((items) => this.applyRetention(items));
  }

  private applyRetention(items: ExternalMessageRecord[]): ExternalMessageRecord[] {
    const maxAge = this.options.retention?.externalMessagesMaxAgeMs;
    if (maxAge === undefined) return items;
    const cutoff = this.now().getTime() - maxAge;
    return items.filter((item) => dateValue(item.recordedAt) >= cutoff);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

export class JsonChannelSettingsRepository implements ChannelSettingsRepository {
  private readonly store: JsonStore<ChannelSettings>;

  public constructor(
    storagePath: string,
    defaultSettings: ChannelSettings = createDefaultChannelSettings(),
  ) {
    this.store = new JsonStore(
      join(storagePath, "settings.json"),
      isChannelSettings,
      () => defaultSettings,
    );
  }

  public get(): Promise<ChannelSettings> {
    return this.store.read();
  }
  public async save(settings: ChannelSettings): Promise<void> {
    await this.store.mutate(() => settings);
  }
}

export class JsonChannelMemory {
  public readonly connections: JsonChannelConnectionRepository;
  public readonly conversations: JsonChannelConversationRepository;
  public readonly messages: JsonChannelMessageRepository;
  public readonly externalMessages: JsonExternalMessageRecordRepository;
  public readonly settings: JsonChannelSettingsRepository;

  public constructor(storagePath: string, options: JsonChannelMemoryOptions = {}) {
    this.connections = new JsonChannelConnectionRepository(storagePath);
    this.conversations = new JsonChannelConversationRepository(storagePath);
    this.messages = new JsonChannelMessageRepository(storagePath, options);
    this.externalMessages = new JsonExternalMessageRecordRepository(storagePath, options);
    this.settings = new JsonChannelSettingsRepository(storagePath, options.defaultSettings);
  }

  public async cleanup(): Promise<void> {
    await Promise.all([this.messages.cleanup(), this.externalMessages.cleanup()]);
  }
}

function collection<T>(
  storagePath: string,
  name: string,
  isItem: (value: unknown) => value is T,
): JsonStore<T[]> {
  return new JsonStore(join(storagePath, name), isArrayOf(isItem), () => []);
}

async function upsert<T extends { readonly id: string }>(
  store: JsonStore<T[]>,
  item: T,
): Promise<void> {
  await store.mutate((items) => {
    const index = items.findIndex((existing) => existing.id === item.id);
    return index < 0
      ? [...items, item]
      : items.map((existing) => (existing.id === item.id ? item : existing));
  });
}

function sort<T extends { readonly createdAt: string }>(
  items: readonly T[],
  order: ListOptions["order"],
): readonly T[] {
  const direction = order === "desc" ? -1 : 1;
  return [...items].sort(
    (left, right) => direction * left.createdAt.localeCompare(right.createdAt),
  );
}

function sortConversations(
  items: readonly ChannelConversation[],
  order: ListOptions["order"],
): readonly ChannelConversation[] {
  const direction = order === "desc" ? -1 : 1;
  return [...items].sort((left, right) => {
    const leftDate = left.lastMessageAt ?? left.createdAt;
    const rightDate = right.lastMessageAt ?? right.createdAt;
    return direction * leftDate.localeCompare(rightDate);
  });
}

function matches(search: string | undefined, ...values: readonly string[]): boolean {
  if (search === undefined || search === "") return true;
  const needle = search.toLocaleLowerCase();
  return values.some((value) => value.toLocaleLowerCase().includes(needle));
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
