import { WHATSAPP_CHANNEL_ID, WHATSAPP_PERSONAL_CONNECTION_ID } from "@flowmind/channel-core";
import type {
  ChannelConnection,
  ChannelProvider,
  ChannelProviderListener,
  ConversationType,
  OutboundMessage,
  ProviderConnection,
  SendResult,
} from "@flowmind/channel-core";
import { defaultWhatsAppWebJsClientFactory } from "./client-factory.js";
import { normalizeWebJsMessage } from "./message-normalizer.js";
import { WHATSAPP_WEBJS_PROVIDER_ID } from "./types.js";
import type {
  IdentityResult,
  WhatsAppWebJsChat,
  WhatsAppWebJsConnectionSnapshot,
  WhatsAppWebJsContact,
  WhatsAppWebJsHistoryCursor,
  WhatsAppWebJsMediaInfo,
  WhatsAppWebJsProviderOptions,
  WebJsClient,
  WebJsContact,
  WebJsMessage,
} from "./types.js";

interface Runtime {
  readonly connection: ChannelConnection;
  readonly listener: ChannelProviderListener;
  readonly client: WebJsClient;
  readonly generation: number;
  readonly directoryTimers: Set<ReturnType<typeof setTimeout>>;
}

const DEFAULT_QR_TTL_MS = 60_000;
const DIRECTORY_REFRESH_DELAYS_MS = [2_000, 10_000, 30_000] as const;

export class WhatsAppWebJsProvider implements ChannelProvider {
  public readonly id = WHATSAPP_WEBJS_PROVIDER_ID;
  public readonly channelId = WHATSAPP_CHANNEL_ID;

  private readonly runtimes = new Map<string, Runtime>();
  private readonly snapshots = new Map<string, WhatsAppWebJsConnectionSnapshot>();
  private readonly contacts = new Map<string, Map<string, WhatsAppWebJsContact>>();
  private readonly chats = new Map<string, Map<string, WhatsAppWebJsChat>>();
  private readonly media = new Map<string, Map<string, WebJsMessage>>();
  private generation = 0;

  public constructor(private readonly options: WhatsAppWebJsProviderOptions) {}

  public async connect(
    connection: ChannelConnection,
    listener: ChannelProviderListener,
  ): Promise<ProviderConnection> {
    this.assertConnection(connection);
    await this.disconnect(connection.id);

    const clientFactory = this.options.clientFactory ?? defaultWhatsAppWebJsClientFactory;
    const client = clientFactory({
      connectionId: connection.id,
      authDirectory: this.options.authDirectory,
      headless: this.options.headless ?? true,
      ...(this.options.executablePath === undefined
        ? {}
        : { executablePath: this.options.executablePath }),
    });
    const runtime: Runtime = {
      connection,
      listener,
      client,
      generation: ++this.generation,
      directoryTimers: new Set(),
    };
    this.runtimes.set(connection.id, runtime);
    this.contacts.set(connection.id, new Map());
    this.chats.set(connection.id, new Map());
    this.media.set(connection.id, new Map());
    this.updateStatus(runtime, "connecting");
    this.bind(runtime);

    try {
      await client.initialize();
      if (this.isCurrent(runtime)) {
        void this.refreshDirectory(runtime);
        this.scheduleDirectoryRefreshes(runtime);
      }
    } catch (error) {
      if (this.isCurrent(runtime)) {
        this.updateStatus(runtime, "error", errorMessage(error));
      }
      throw error;
    }

    return {
      connectionId: connection.id,
      channelId: this.channelId,
      providerId: this.id,
    };
  }

  public async disconnect(connectionId: string): Promise<void> {
    const runtime = this.runtimes.get(connectionId);
    if (!runtime) return;
    this.runtimes.delete(connectionId);
    this.clearDirectoryTimers(runtime);
    await runtime.client.destroy();
    this.setSnapshot(connectionId, {
      connectionId,
      status: "disconnected",
      historySyncStatus: "idle",
    });
  }

  public async logout(connectionId: string): Promise<void> {
    const runtime = this.requireRuntime(connectionId);
    this.runtimes.delete(connectionId);
    this.clearDirectoryTimers(runtime);
    await runtime.client.logout();
    this.contacts.delete(connectionId);
    this.chats.delete(connectionId);
    this.media.delete(connectionId);
    this.setSnapshot(connectionId, {
      connectionId,
      status: "logged_out",
      historySyncStatus: "idle",
    });
  }

  public async send(message: OutboundMessage): Promise<SendResult> {
    if (message.conversationAddress.channelId !== this.channelId) {
      throw new Error(`Expected channel ${this.channelId}`);
    }
    const sent = await this.requireRuntime(message.connectionId).client.sendMessage(
      message.conversationAddress.externalId,
      message.content,
    );
    return {
      connectionId: message.connectionId,
      providerMessageId: sent.id._serialized,
      sentAt: new Date(sent.timestamp * 1_000).toISOString(),
    };
  }

  public getSnapshot(connectionId: string): WhatsAppWebJsConnectionSnapshot | undefined {
    return this.snapshots.get(connectionId);
  }

  public listContacts(connectionId: string): readonly WhatsAppWebJsContact[] {
    return [...(this.contacts.get(connectionId)?.values() ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name, "pt-BR"),
    );
  }

  public listChats(connectionId: string): readonly WhatsAppWebJsChat[] {
    return [...(this.chats.get(connectionId)?.values() ?? [])].sort((left, right) =>
      right.lastActivityAt.localeCompare(left.lastActivityAt),
    );
  }

  public async fetchMessageHistory(
    connectionId: string,
    externalId: string,
    _cursor: WhatsAppWebJsHistoryCursor,
    count: number,
  ): Promise<string> {
    const runtime = this.requireRuntime(connectionId);
    const chat = await runtime.client.getChatById(externalId);
    const messages = await chat.fetchMessages({ limit: positiveCount(count) });
    for (const message of [...messages].sort((left, right) => left.timestamp - right.timestamp)) {
      await this.processMessage(runtime, message, true);
    }
    return messages.at(0)?.id._serialized ?? "";
  }

  public fetchMessageHistories(
    connectionId: string,
    cursors: readonly WhatsAppWebJsHistoryCursor[],
    count: number,
  ): { readonly requestedConversations: number; readonly countPerConversation: number } {
    const runtime = this.requireRuntime(connectionId);
    const countPerConversation = positiveCount(count);
    void this.fetchHistories(runtime, cursors, countPerConversation);
    return { requestedConversations: cursors.length, countPerConversation };
  }

  public getMediaInfo(
    connectionId: string,
    providerMessageId: string,
  ): WhatsAppWebJsMediaInfo | undefined {
    const message = this.media.get(connectionId)?.get(providerMessageId);
    return message ? mediaInfo(message) : undefined;
  }

  public async downloadMedia(
    connectionId: string,
    providerMessageId: string,
  ): Promise<{ readonly data: Buffer; readonly info: WhatsAppWebJsMediaInfo }> {
    const message = this.media.get(connectionId)?.get(providerMessageId);
    if (!message) throw new Error(`WhatsApp media not found: ${providerMessageId}`);
    const downloaded = await message.downloadMedia();
    if (!downloaded) throw new Error(`WhatsApp media unavailable: ${providerMessageId}`);
    const inferred = mediaInfo(message);
    return {
      data: Buffer.from(downloaded.data, "base64"),
      info: {
        ...inferred,
        mimeType: downloaded.mimetype,
        ...(downloaded.filename ? { fileName: downloaded.filename } : {}),
      },
    };
  }

  public async resolveConversationIdentity(
    connectionId: string,
    externalId: string,
    _conversationType: ConversationType,
    displayName?: string,
  ): Promise<IdentityResult> {
    const cached = this.contacts.get(connectionId)?.get(externalId);
    if (cached) {
      return {
        ...(cached.name ? { displayName: cached.name } : {}),
        ...(cached.avatarUrl ? { avatarUrl: cached.avatarUrl } : {}),
      };
    }
    const contact = await this.requireRuntime(connectionId).client.getContactById(externalId);
    const normalized = await this.normalizeContact(contact);
    this.contacts.get(connectionId)?.set(normalized.id, normalized);
    const resolvedName = normalized.name || displayName;
    return {
      ...(resolvedName ? { displayName: resolvedName } : {}),
      ...(normalized.avatarUrl ? { avatarUrl: normalized.avatarUrl } : {}),
    };
  }

  private bind(runtime: Runtime): void {
    runtime.client.on("qr", (qr) => {
      if (!this.isCurrent(runtime)) return;
      const expiresAt = new Date(
        this.now().getTime() + (this.options.qrTtlMs ?? DEFAULT_QR_TTL_MS),
      ).toISOString();
      this.setSnapshot(runtime.connection.id, {
        connectionId: runtime.connection.id,
        status: "waiting_for_qr",
        qr: { value: qr, expiresAt },
        historySyncStatus: "idle",
      });
      this.emitStatus(runtime, "waiting_for_qr");
    });
    runtime.client.on("authenticated", () => {
      if (this.isCurrent(runtime)) this.updateStatus(runtime, "authenticated");
    });
    runtime.client.on("ready", () => {
      if (!this.isCurrent(runtime)) return;
      this.updateStatus(runtime, "connected");
      void this.refreshDirectory(runtime);
      this.scheduleDirectoryRefreshes(runtime);
    });
    runtime.client.on("auth_failure", (reason) => {
      if (this.isCurrent(runtime)) this.updateStatus(runtime, "error", reason);
    });
    runtime.client.on("disconnected", (reason) => {
      if (this.isCurrent(runtime)) this.updateStatus(runtime, "disconnected", reason);
    });
    runtime.client.on("message", (message) => {
      if (this.isCurrent(runtime)) void this.processMessage(runtime, message, false);
    });
    runtime.client.on("message_create", (message) => {
      if (this.isCurrent(runtime) && message.fromMe) {
        void this.processMessage(runtime, message, false);
      }
    });
  }

  private async processMessage(
    runtime: Runtime,
    message: WebJsMessage,
    historical: boolean,
  ): Promise<void> {
    const normalized = await normalizeWebJsMessage(runtime.connection.id, message, historical);
    if (!normalized || !this.isCurrent(runtime)) return;
    if (message.hasMedia) {
      this.media.get(runtime.connection.id)?.set(message.id._serialized, message);
    }
    await runtime.listener.onMessage(normalized.inbound);
    await this.refreshChat(runtime, message);
  }

  private async refreshDirectory(runtime: Runtime): Promise<void> {
    const [contactsResult, chatsResult] = await Promise.allSettled([
      runtime.client.getContacts(),
      runtime.client.getChats(),
    ]);
    if (!this.isCurrent(runtime)) return;

    if (contactsResult.status === "fulfilled") {
      const contacts = contactsResult.value.filter((contact) =>
        isSavedUserContact(contact),
      );
      const normalizedContacts = contacts.map((contact) => this.normalizeContactBase(contact));
      const contactMap = new Map(normalizedContacts.map((contact) => [contact.id, contact]));
      this.contacts.set(runtime.connection.id, contactMap);
      void this.hydrateContactAvatars(runtime, contacts, contactMap);
    }

    if (chatsResult.status === "fulfilled") {
      const chats = chatsResult.value.filter((chat) => isUserDirectoryId(chat.id._serialized));
      this.chats.set(
        runtime.connection.id,
        new Map(chats.map((chat) => [chat.id._serialized, normalizeChat(chat)])),
      );
    }
  }

  private scheduleDirectoryRefresh(runtime: Runtime, delay: number): void {
    const timer = setTimeout(() => {
      runtime.directoryTimers.delete(timer);
      if (this.isCurrent(runtime)) void this.refreshDirectory(runtime);
    }, delay);
    timer.unref();
    runtime.directoryTimers.add(timer);
  }

  private scheduleDirectoryRefreshes(runtime: Runtime): void {
    if (runtime.directoryTimers.size > 0) return;
    for (const delay of DIRECTORY_REFRESH_DELAYS_MS) {
      this.scheduleDirectoryRefresh(runtime, delay);
    }
  }

  private clearDirectoryTimers(runtime: Runtime): void {
    for (const timer of runtime.directoryTimers) clearTimeout(timer);
    runtime.directoryTimers.clear();
  }

  private async refreshChat(runtime: Runtime, message: WebJsMessage): Promise<void> {
    const chat = await safe(() => message.getChat());
    if (!chat || !this.isCurrent(runtime)) return;
    this.chats.get(runtime.connection.id)?.set(chat.id._serialized, normalizeChat(chat));
  }

  private async normalizeContact(contact: WebJsContact): Promise<WhatsAppWebJsContact> {
    const normalized = this.normalizeContactBase(contact);
    const avatarUrl = await safe(() => contact.getProfilePicUrl());
    return {
      ...normalized,
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  }

  private normalizeContactBase(contact: WebJsContact): WhatsAppWebJsContact {
    const id = contact.id._serialized;
    return {
      id,
      name: contact.name ?? contact.pushname ?? contact.shortName ?? contact.number ?? stripId(id),
      ...(contact.number ? { phone: contact.number } : {}),
    };
  }

  private async hydrateContactAvatars(
    runtime: Runtime,
    contacts: readonly WebJsContact[],
    contactMap: Map<string, WhatsAppWebJsContact>,
  ): Promise<void> {
    const queue = [...contacts];
    const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (this.isCurrent(runtime)) {
        const contact = queue.shift();
        if (!contact) return;
        const avatarUrl = await safe(() => contact.getProfilePicUrl());
        if (!avatarUrl || !this.isCurrent(runtime)) continue;
        const existing = contactMap.get(contact.id._serialized);
        if (existing) contactMap.set(existing.id, { ...existing, avatarUrl });
      }
    });
    await Promise.all(workers);
  }

  private async fetchHistories(
    runtime: Runtime,
    cursors: readonly WhatsAppWebJsHistoryCursor[],
    count: number,
  ): Promise<void> {
    const total = cursors.length;
    this.setHistoryProgress(runtime.connection.id, "syncing", 0);
    for (let index = 0; index < cursors.length; index += 1) {
      if (!this.isCurrent(runtime)) return;
      const cursor = cursors[index];
      if (!cursor) continue;
      try {
        await this.fetchMessageHistory(runtime.connection.id, cursor.externalId, cursor, count);
      } catch {
        // A failed chat must not stop the remaining history import.
      }
      this.setHistoryProgress(
        runtime.connection.id,
        "syncing",
        Math.round(((index + 1) / Math.max(total, 1)) * 100),
      );
    }
    if (this.isCurrent(runtime)) this.setHistoryProgress(runtime.connection.id, "complete", 100);
  }

  private setHistoryProgress(
    connectionId: string,
    status: WhatsAppWebJsConnectionSnapshot["historySyncStatus"],
    progress: number,
  ): void {
    const current = this.snapshots.get(connectionId);
    if (!current) return;
    this.setSnapshot(connectionId, {
      ...current,
      historySyncStatus: status,
      historySyncProgress: progress,
    });
  }

  private updateStatus(
    runtime: Runtime,
    status: WhatsAppWebJsConnectionSnapshot["status"],
    error?: string,
  ): void {
    this.setSnapshot(runtime.connection.id, {
      connectionId: runtime.connection.id,
      status,
      historySyncStatus: this.snapshots.get(runtime.connection.id)?.historySyncStatus ?? "idle",
      ...(error ? { error } : {}),
    });
    this.emitStatus(runtime, status, error);
  }

  private emitStatus(
    runtime: Runtime,
    status: WhatsAppWebJsConnectionSnapshot["status"],
    error?: string,
  ): void {
    void runtime.listener.onStatus({
      connectionId: runtime.connection.id,
      status,
      ...(error ? { error } : {}),
      occurredAt: this.now().toISOString(),
    });
  }

  private setSnapshot(connectionId: string, snapshot: WhatsAppWebJsConnectionSnapshot): void {
    this.snapshots.set(connectionId, snapshot);
  }

  private assertConnection(connection: ChannelConnection): void {
    if (
      connection.id !== WHATSAPP_PERSONAL_CONNECTION_ID ||
      connection.channelId !== this.channelId ||
      connection.providerId !== this.id
    ) {
      throw new Error(
        `whatsapp-web.js requires id=${WHATSAPP_PERSONAL_CONNECTION_ID}, ` +
          `channelId=${this.channelId}, providerId=${this.id}`,
      );
    }
  }

  private requireRuntime(connectionId: string): Runtime {
    const runtime = this.runtimes.get(connectionId);
    if (!runtime) throw new Error(`WhatsApp connection not found: ${connectionId}`);
    return runtime;
  }

  private isCurrent(runtime: Runtime): boolean {
    return this.runtimes.get(runtime.connection.id)?.generation === runtime.generation;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function normalizeChat(chat: {
  readonly id: { readonly _serialized: string };
  readonly isGroup: boolean;
  readonly timestamp?: number;
  readonly unreadCount: number;
  readonly archived: boolean;
  readonly pinned?: boolean;
}): WhatsAppWebJsChat {
  const timestamp = chat.timestamp ?? 0;
  return {
    externalId: chat.id._serialized,
    type: chat.isGroup ? "group" : "private",
    lastActivityAt: new Date(timestamp * 1_000).toISOString(),
    archived: chat.archived,
    unreadCount: Math.max(0, chat.unreadCount),
    ...(chat.pinned ? { pinnedAt: timestamp } : {}),
  };
}

function mediaInfo(message: WebJsMessage): WhatsAppWebJsMediaInfo {
  const kind =
    message.type === "ptt"
      ? "audio"
      : message.type === "image" ||
          message.type === "video" ||
          message.type === "audio" ||
          message.type === "document" ||
          message.type === "sticker"
        ? message.type
        : "document";
  return { kind, mimeType: "application/octet-stream" };
}

function stripId(id: string): string {
  return id.replace(/@.+$/, "");
}

function isUserDirectoryId(id: string): boolean {
  return (
    id !== "status@broadcast" &&
    !id.endsWith("@broadcast") &&
    !id.endsWith("@newsletter") &&
    (id.endsWith("@c.us") ||
      id.endsWith("@g.us") ||
      id.endsWith("@lid") ||
      id.endsWith("@s.whatsapp.net"))
  );
}

function isSavedUserContact(contact: WebJsContact): boolean {
  return (
    contact.isMyContact === true &&
    contact.isUser !== false &&
    isUserDirectoryId(contact.id._serialized)
  );
}

function positiveCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 50;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safe<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch {
    return undefined;
  }
}
