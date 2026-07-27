import type {
  ChannelConnectionStatus,
  ChannelProviderListener,
  InboundMessage,
} from "@flowmind/channel-core";
import { DisconnectReason } from "@whiskeysockets/baileys";
import type { AuthenticationCreds, ConnectionState } from "@whiskeysockets/baileys";
import { AuthStateRepository } from "./auth-state-repository.js";
import type {
  WhatsAppSocket,
  WhatsAppSocketFactory,
  WhatsAppSocketEventMap,
} from "./baileys-socket.js";
import { defaultWhatsAppSocketFactory } from "./baileys-socket.js";
import {
  WhatsAppConnectionUnavailableError,
  WhatsAppSendError,
  WhatsAppWebError,
} from "./errors.js";
import {
  normalizeInboundMessage,
  normalizeWhatsAppJid,
  toWhatsAppJid,
} from "./message-normalizer.js";

const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;
const DEFAULT_QR_TTL_MS = 60_000;
const IDENTITY_LOOKUP_TIMEOUT_MS = 1_500;

export interface WhatsAppQrSnapshot {
  readonly value: string;
  readonly expiresAt: string;
}

export interface WhatsAppConnectionSnapshot {
  readonly connectionId: string;
  readonly status: ChannelConnectionStatus;
  readonly qr?: WhatsAppQrSnapshot;
  readonly address?: string;
  readonly error?: string;
}

export interface WhatsAppSocketManagerOptions {
  readonly connectionId: string;
  readonly authState: AuthStateRepository;
  readonly socketFactory?: WhatsAppSocketFactory;
  readonly qrTtlMs?: number;
  readonly reconnectDelaysMs?: readonly number[];
  readonly maxReconnectAttempts?: number;
  readonly now?: () => Date;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly setTimer?: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

type ConnectionUpdate = WhatsAppSocketEventMap["connection.update"];
type CredsUpdate = WhatsAppSocketEventMap["creds.update"];
type MessagesUpsert = WhatsAppSocketEventMap["messages.upsert"];
type ContactsUpsert = WhatsAppSocketEventMap["contacts.upsert"];
type ContactsUpdate = WhatsAppSocketEventMap["contacts.update"];
type MessagingHistorySet = WhatsAppSocketEventMap["messaging-history.set"];

interface SocketBinding {
  readonly socket: WhatsAppSocket;
  readonly onConnectionUpdate: (update: ConnectionUpdate) => void;
  readonly onCredsUpdate: (update: CredsUpdate) => void;
  readonly onMessagesUpsert: (event: MessagesUpsert) => void;
  readonly onContactsUpsert: (event: ContactsUpsert) => void;
  readonly onContactsUpdate: (event: ContactsUpdate) => void;
  readonly onMessagingHistorySet: (event: MessagingHistorySet) => void;
}

interface ConversationIdentity {
  readonly displayName?: string;
  readonly avatarUrl?: string;
}

export interface WhatsAppContact {
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
  readonly avatarUrl?: string;
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("output" in error) {
    const output = (error as { output?: { statusCode?: unknown } }).output;
    if (typeof output?.statusCode === "number") return output.statusCode;
  }
  if ("statusCode" in error) {
    const value = (error as { statusCode?: unknown }).statusCode;
    if (typeof value === "number") return value;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown WhatsApp error");
}

function isAuthenticationFailure(code: number | undefined): boolean {
  return (
    code === DisconnectReason.badSession ||
    code === DisconnectReason.forbidden ||
    code === DisconnectReason.multideviceMismatch ||
    code === DisconnectReason.connectionReplaced
  );
}

export class WhatsAppSocketManager {
  private readonly socketFactory: WhatsAppSocketFactory;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly maxReconnectAttempts: number;
  private readonly qrTtlMs: number;
  private readonly now: () => Date;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly setTimer: (callback: () => void, milliseconds: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  private listener: ChannelProviderListener | undefined;
  private socket: WhatsAppSocket | undefined;
  private binding: SocketBinding | undefined;
  private status: ChannelConnectionStatus = "disconnected";
  private qr: WhatsAppQrSnapshot | undefined;
  private qrTimer: unknown;
  private address: string | undefined;
  private lastError: string | undefined;
  private desired = false;
  private terminal = false;
  private reconnectAttempts = 0;
  private generation = 0;
  private eventChain: Promise<void> = Promise.resolve();
  private readonly identityCache = new Map<string, Promise<ConversationIdentity>>();
  private readonly contacts = new Map<string, WhatsAppContact>();
  private readonly contactPhonesByAlias = new Map<string, string>();

  public readonly connectionId: string;
  public readonly authState: AuthStateRepository;

  public constructor(options: WhatsAppSocketManagerOptions) {
    this.connectionId = options.connectionId;
    this.authState = options.authState;
    this.socketFactory = options.socketFactory ?? defaultWhatsAppSocketFactory;
    this.qrTtlMs = options.qrTtlMs ?? DEFAULT_QR_TTL_MS;
    this.reconnectDelaysMs =
      options.reconnectDelaysMs && options.reconnectDelaysMs.length > 0
        ? options.reconnectDelaysMs
        : DEFAULT_RECONNECT_DELAYS_MS;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? this.reconnectDelaysMs.length;
    this.now = options.now ?? (() => new Date());
    this.delay = options.delay ?? defaultDelay;
    this.setTimer =
      options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  public async start(listener: ChannelProviderListener): Promise<void> {
    if (this.terminal) {
      throw new WhatsAppWebError(
        `WhatsApp connection ${this.connectionId} was permanently logged out`,
      );
    }
    if (this.desired) return;
    this.listener = listener;
    this.desired = true;
    this.reconnectAttempts = 0;
    this.generation += 1;
    await this.emitStatus("connecting");
    try {
      await this.openSocket(this.generation);
    } catch (error) {
      this.desired = false;
      this.lastError = errorMessage(error);
      await this.emitStatus("error", this.lastError);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    this.desired = false;
    this.generation += 1;
    this.clearQr();
    const socket = this.detachSocket();
    socket?.end(undefined);
    if (!this.terminal) await this.emitStatus("disconnected");
    await this.onIdle();
  }

  public async reconnect(): Promise<void> {
    if (this.terminal) {
      throw new WhatsAppWebError(
        `WhatsApp connection ${this.connectionId} was permanently logged out`,
      );
    }
    if (!this.listener) {
      throw new WhatsAppWebError(`WhatsApp connection ${this.connectionId} has not been started`);
    }

    this.desired = true;
    this.reconnectAttempts = 0;
    this.generation += 1;
    this.clearQr();
    const socket = this.detachSocket();
    socket?.end(undefined);
    await this.emitStatus("reconnecting");
    try {
      await this.openSocket(this.generation);
    } catch (error) {
      await this.reconnectWithBackoff(error);
    }
  }

  public async logout(): Promise<void> {
    this.desired = false;
    this.terminal = true;
    this.generation += 1;
    this.clearQr();
    const socket = this.detachSocket();
    try {
      await socket?.logout("Flowmind logout");
    } finally {
      await this.authState.logout();
      this.address = undefined;
      this.lastError = undefined;
      await this.emitStatus("logged_out");
      await this.onIdle();
    }
  }

  public async sendText(
    externalId: string,
    content: string,
  ): Promise<{
    readonly providerMessageId: string;
    readonly sentAt: string;
  }> {
    if (this.status !== "connected" || !this.socket) {
      throw new WhatsAppConnectionUnavailableError(this.connectionId);
    }
    try {
      const sent = await this.socket.sendMessage(toWhatsAppJid(externalId), { text: content });
      const providerMessageId = sent?.key?.id;
      if (!providerMessageId) {
        throw new WhatsAppSendError("Baileys did not return a sent message id");
      }
      return {
        providerMessageId,
        sentAt: this.now().toISOString(),
      };
    } catch (error) {
      if (error instanceof WhatsAppSendError) throw error;
      throw new WhatsAppSendError(`Unable to send WhatsApp text: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  public getSnapshot(): WhatsAppConnectionSnapshot {
    this.pruneExpiredQr();
    return {
      connectionId: this.connectionId,
      status: this.status,
      ...(this.qr === undefined ? {} : { qr: this.qr }),
      ...(this.address === undefined ? {} : { address: this.address }),
      ...(this.lastError === undefined ? {} : { error: this.lastError }),
    };
  }

  public onIdle(): Promise<void> {
    return this.eventChain;
  }

  public listContacts(): readonly WhatsAppContact[] {
    return [...this.contacts.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "pt-BR"),
    );
  }

  private enqueueEvent(operation: () => Promise<void>): void {
    this.eventChain = this.eventChain.then(operation, operation).catch(async (error: unknown) => {
      this.lastError = errorMessage(error);
      await this.emitStatus("error", this.lastError);
    });
  }

  private async openSocket(generation: number): Promise<void> {
    const auth = await this.authState.getState();
    if (!this.desired || generation !== this.generation) return;
    const socket = await this.socketFactory({ auth });
    if (!this.desired || generation !== this.generation) {
      socket.end(undefined);
      return;
    }
    this.socket = socket;
    const binding: SocketBinding = {
      socket,
      onConnectionUpdate: (update) => {
        this.enqueueEvent(async () => {
          if (this.socket !== socket) return;
          await this.handleConnectionUpdate(update);
        });
      },
      onCredsUpdate: (update) => {
        this.enqueueEvent(async () => {
          if (this.socket !== socket) return;
          await this.handleCredsUpdate(update);
        });
      },
      onMessagesUpsert: (event) => {
        this.enqueueEvent(async () => {
          if (this.socket !== socket) return;
          await this.handleMessagesUpsert(event);
        });
      },
      onContactsUpsert: (event) => {
        if (this.socket !== socket) return;
        for (const contact of event) this.cacheContact(contact);
      },
      onContactsUpdate: (event) => {
        if (this.socket !== socket) return;
        for (const contact of event) this.cacheContact(contact);
      },
      onMessagingHistorySet: (event) => {
        this.enqueueEvent(async () => {
          if (this.socket !== socket) return;
          await this.handleMessagingHistorySet(event);
        });
      },
    };
    this.binding = binding;
    socket.ev.on("connection.update", binding.onConnectionUpdate);
    socket.ev.on("creds.update", binding.onCredsUpdate);
    socket.ev.on("messages.upsert", binding.onMessagesUpsert);
    socket.ev.on("contacts.upsert", binding.onContactsUpsert);
    socket.ev.on("contacts.update", binding.onContactsUpdate);
    socket.ev.on("messaging-history.set", binding.onMessagingHistorySet);
  }

  private detachSocket(): WhatsAppSocket | undefined {
    const socket = this.socket;
    if (!socket) return undefined;
    const binding = this.binding;
    if (binding?.socket === socket) {
      socket.ev.off("connection.update", binding.onConnectionUpdate);
      socket.ev.off("creds.update", binding.onCredsUpdate);
      socket.ev.off("messages.upsert", binding.onMessagesUpsert);
      socket.ev.off("contacts.upsert", binding.onContactsUpsert);
      socket.ev.off("contacts.update", binding.onContactsUpdate);
      socket.ev.off("messaging-history.set", binding.onMessagingHistorySet);
    }
    this.binding = undefined;
    this.socket = undefined;
    return socket;
  }

  private async handleConnectionUpdate(update: ConnectionUpdate): Promise<void> {
    if (!this.desired || this.terminal) return;
    if (update.qr) {
      this.setQr(update.qr);
      await this.emitStatus("waiting_for_qr");
    }
    if (update.isNewLogin === true) {
      this.clearQr();
      await this.emitStatus("authenticated");
    }
    if (update.connection === "open") {
      this.clearQr();
      this.reconnectAttempts = 0;
      this.lastError = undefined;
      const userId = this.socket?.user?.id;
      this.address = userId ? normalizeWhatsAppJid(userId) : undefined;
      await this.emitStatus("connected");
      return;
    }
    if (update.connection !== "close") return;

    this.clearQr();
    this.detachSocket();
    const error = update.lastDisconnect?.error;
    const code = statusCode(error);
    if (code === DisconnectReason.loggedOut) {
      this.desired = false;
      this.terminal = true;
      await this.authState.logout();
      await this.emitStatus("logged_out");
      return;
    }
    if (isAuthenticationFailure(code)) {
      this.desired = false;
      this.terminal = true;
      await this.authState.logout();
      this.lastError = `WhatsApp authentication failed: ${errorMessage(error)}`;
      await this.emitStatus("error", this.lastError);
      return;
    }
    await this.reconnectWithBackoff(error);
  }

  private async reconnectWithBackoff(initialError: unknown): Promise<void> {
    let lastFailure = initialError;
    while (this.desired && !this.terminal) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.desired = false;
        this.lastError = `WhatsApp reconnect limit reached: ${errorMessage(lastFailure)}`;
        await this.emitStatus("error", this.lastError);
        return;
      }

      const index = Math.min(this.reconnectAttempts, this.reconnectDelaysMs.length - 1);
      const wait = this.reconnectDelaysMs[index] ?? 0;
      this.reconnectAttempts += 1;
      await this.emitStatus("reconnecting");
      await this.delay(wait);
      if (!this.desired || this.terminal) return;

      this.generation += 1;
      try {
        await this.openSocket(this.generation);
        return;
      } catch (error) {
        lastFailure = error;
      }
    }
  }

  private async handleCredsUpdate(update: Partial<AuthenticationCreds>): Promise<void> {
    await this.authState.updateCreds(update);
    if (update.registered === true && this.status === "waiting_for_qr") {
      this.clearQr();
      await this.emitStatus("authenticated");
    }
  }

  private async handleMessagesUpsert(event: MessagesUpsert): Promise<void> {
    if (event.type !== "notify" || !this.listener) return;
    for (const raw of event.messages) {
      await this.deliverMessage(raw);
    }
  }

  private async handleMessagingHistorySet(event: MessagingHistorySet): Promise<void> {
    if (!this.listener) return;
    const contacts = new Map<string, MessagingHistorySet["contacts"][number]>();
    for (const contact of event.contacts) {
      for (const id of [contact.id, contact.lid, contact.phoneNumber]) {
        if (id) contacts.set(normalizeWhatsAppJid(id), contact);
      }
      this.cacheContact(contact);
    }

    const latestByChat = new Map<string, MessagingHistorySet["messages"][number]>();
    for (const message of event.messages) {
      const jid = message.key.remoteJid;
      if (!jid) continue;
      const key = normalizeWhatsAppJid(jid);
      const current = latestByChat.get(key);
      if (!current || this.messageTimestamp(message) > this.messageTimestamp(current)) {
        latestByChat.set(key, message);
      }
    }

    for (const [externalId, message] of latestByChat) {
      const contact = contacts.get(externalId);
      const displayName = contact?.name ?? contact?.notify ?? contact?.verifiedName;
      const avatarUrl =
        contact?.imgUrl && contact.imgUrl !== "changed" ? contact.imgUrl : undefined;
      await this.deliverMessage(message, {
        ...(displayName === undefined ? {} : { displayName }),
        ...(avatarUrl === undefined ? {} : { avatarUrl }),
      });
    }
  }

  private cacheContact(contact: Partial<MessagingHistorySet["contacts"][number]>): void {
    const aliases = [contact.id, contact.lid, contact.phoneNumber].filter(
      (value): value is string => Boolean(value),
    );
    const phoneSource =
      contact.phoneNumber ??
      aliases.find((alias) => alias.endsWith("@s.whatsapp.net")) ??
      aliases.map((alias) => this.contactPhonesByAlias.get(alias)).find(Boolean);
    if (!phoneSource) return;
    const id = normalizeWhatsAppJid(phoneSource);
    if (!/^\d{8,15}$/.test(id)) return;
    for (const alias of aliases) {
      this.contactPhonesByAlias.set(alias, id);
      this.contactPhonesByAlias.set(normalizeWhatsAppJid(alias), id);
    }
    const previous = this.contacts.get(id);
    const name = contact.name ?? contact.notify ?? contact.verifiedName ?? previous?.name ?? id;
    const avatarUrl =
      contact.imgUrl && contact.imgUrl !== "changed" ? contact.imgUrl : previous?.avatarUrl;
    this.contacts.set(id, {
      id,
      name,
      phone: id,
      ...(avatarUrl === undefined ? {} : { avatarUrl }),
    });
  }

  private async deliverMessage(
    raw: MessagingHistorySet["messages"][number],
    historyIdentity: ConversationIdentity = {},
  ): Promise<void> {
    if (!this.listener) return;
    const normalized = normalizeInboundMessage(this.connectionId, raw);
    if (!normalized) return;
    const conversationId =
      this.contactPhonesByAlias.get(normalized.conversationAddress.externalId) ??
      normalized.conversationAddress.externalId;
    const senderId =
      this.contactPhonesByAlias.get(normalized.senderAddress.externalId) ??
      normalized.senderAddress.externalId;
    const addressed: InboundMessage = {
      ...normalized,
      conversationAddress: {
        ...normalized.conversationAddress,
        externalId: conversationId,
      },
      senderAddress: {
        ...normalized.senderAddress,
        externalId: senderId,
      },
    };
    const identity = await this.resolveConversationIdentity(
      addressed.conversationAddress.externalId,
      addressed.conversationType,
      historyIdentity.displayName ?? addressed.displayName,
    );
    const message: InboundMessage = {
      ...addressed,
      ...(identity.displayName === undefined ? {} : { displayName: identity.displayName }),
      ...(historyIdentity.avatarUrl === undefined && identity.avatarUrl === undefined
        ? {}
        : { avatarUrl: historyIdentity.avatarUrl ?? identity.avatarUrl }),
    };
    try {
      await this.listener.onMessage(message);
    } catch {
      // Consumer failures are isolated by the channel runtime.
    }
  }

  private messageTimestamp(message: MessagingHistorySet["messages"][number]): number {
    const timestamp = message.messageTimestamp;
    if (typeof timestamp === "number") return timestamp;
    if (timestamp && typeof timestamp === "object" && "toNumber" in timestamp) {
      return timestamp.toNumber();
    }
    return 0;
  }

  public async resolveConversationIdentity(
    externalId: string,
    conversationType: "private" | "group",
    displayName?: string,
  ): Promise<ConversationIdentity> {
    const jid = toWhatsAppJid(externalId);
    if (!this.socket) {
      return displayName === undefined ? {} : { displayName };
    }
    const cached = this.identityCache.get(jid);
    if (cached) {
      const identity = await cached;
      return {
        ...identity,
        ...(conversationType === "private" && displayName ? { displayName } : {}),
      };
    }

    const pending = this.fetchConversationIdentity(jid, conversationType, displayName);
    this.identityCache.set(jid, pending);
    return pending;
  }

  private async fetchConversationIdentity(
    jid: string,
    conversationType: "private" | "group",
    displayName?: string,
  ): Promise<ConversationIdentity> {
    const [groupName, avatarUrl] = await Promise.all([
      conversationType === "group" && this.socket?.groupMetadata
        ? settleWithin(
            this.socket
              .groupMetadata(jid)
              .then((metadata) => metadata.subject?.trim() || undefined),
            IDENTITY_LOOKUP_TIMEOUT_MS,
          )
        : Promise.resolve(displayName),
      this.socket?.profilePictureUrl
        ? settleWithin(this.socket.profilePictureUrl(jid, "preview"), IDENTITY_LOOKUP_TIMEOUT_MS)
        : Promise.resolve(undefined),
    ]);
    return {
      ...(groupName === undefined ? {} : { displayName: groupName }),
      ...(avatarUrl === undefined ? {} : { avatarUrl }),
    };
  }

  private async emitStatus(status: ChannelConnectionStatus, error?: string): Promise<void> {
    this.status = status;
    if (status !== "error") this.lastError = undefined;
    if (!this.listener) return;
    try {
      await this.listener.onStatus({
        connectionId: this.connectionId,
        status,
        ...(this.address === undefined
          ? {}
          : {
              address: {
                channelId: "whatsapp",
                externalId: this.address,
              },
            }),
        ...(error === undefined ? {} : { error }),
        occurredAt: this.now().toISOString(),
      });
    } catch {
      // Status consumers must not break the socket lifecycle.
    }
  }

  private setQr(value: string): void {
    this.clearQr();
    const expiresAt = new Date(this.now().getTime() + this.qrTtlMs);
    this.qr = { value, expiresAt: expiresAt.toISOString() };
    this.qrTimer = this.setTimer(() => {
      this.qr = undefined;
      this.qrTimer = undefined;
    }, this.qrTtlMs);
  }

  private clearQr(): void {
    if (this.qrTimer !== undefined) this.clearTimer(this.qrTimer);
    this.qrTimer = undefined;
    this.qr = undefined;
  }

  private pruneExpiredQr(): void {
    if (!this.qr) return;
    if (Date.parse(this.qr.expiresAt) <= this.now().getTime()) this.clearQr();
  }
}

function settleWithin<T>(operation: Promise<T>, milliseconds: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), milliseconds);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}
