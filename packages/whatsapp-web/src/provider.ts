import { join } from "node:path";
import {
  WHATSAPP_CHANNEL_ID,
  WHATSAPP_PERSONAL_CONNECTION_ID,
  WHATSAPP_WEB_PROVIDER_ID,
} from "@flowmind/channel-core";
import type {
  ChannelConnection,
  ChannelProvider,
  ChannelProviderListener,
  OutboundMessage,
  ProviderConnection,
  SendResult,
} from "@flowmind/channel-core";
import type { ConversationType } from "@flowmind/channel-core";
import { AuthStateRepository } from "./auth-state-repository.js";
import type { WhatsAppSocketFactory } from "./baileys-socket.js";
import { InvalidWhatsAppConnectionError, WhatsAppConnectionNotFoundError } from "./errors.js";
import { WhatsAppSocketManager } from "./socket-manager.js";
import type {
  WhatsAppConnectionSnapshot,
  WhatsAppContact,
  WhatsAppSocketManagerOptions,
} from "./socket-manager.js";

export interface WhatsAppWebProviderOptions {
  readonly authDirectory: string;
  readonly socketFactory?: WhatsAppSocketFactory;
  readonly qrTtlMs?: number;
  readonly reconnectDelaysMs?: readonly number[];
  readonly maxReconnectAttempts?: number;
  readonly now?: () => Date;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly setTimer?: WhatsAppSocketManagerOptions["setTimer"];
  readonly clearTimer?: WhatsAppSocketManagerOptions["clearTimer"];
  readonly authStateRepositoryFactory?: (
    directory: string,
    connection: ChannelConnection,
  ) => AuthStateRepository;
}

export class WhatsAppWebProvider implements ChannelProvider {
  public readonly id = WHATSAPP_WEB_PROVIDER_ID;
  public readonly channelId = WHATSAPP_CHANNEL_ID;

  private readonly managers = new Map<string, WhatsAppSocketManager>();

  public constructor(private readonly options: WhatsAppWebProviderOptions) {}

  public async connect(
    connection: ChannelConnection,
    listener: ChannelProviderListener,
  ): Promise<ProviderConnection> {
    this.assertConnection(connection);
    const existing = this.managers.get(connection.id);
    if (existing) await existing.stop();

    const directory = join(this.options.authDirectory, connection.id);
    const authState =
      this.options.authStateRepositoryFactory?.(directory, connection) ??
      new AuthStateRepository(directory);
    const manager = new WhatsAppSocketManager({
      connectionId: connection.id,
      authState,
      ...(this.options.socketFactory === undefined
        ? {}
        : { socketFactory: this.options.socketFactory }),
      ...(this.options.qrTtlMs === undefined ? {} : { qrTtlMs: this.options.qrTtlMs }),
      ...(this.options.reconnectDelaysMs === undefined
        ? {}
        : { reconnectDelaysMs: this.options.reconnectDelaysMs }),
      ...(this.options.maxReconnectAttempts === undefined
        ? {}
        : { maxReconnectAttempts: this.options.maxReconnectAttempts }),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
      ...(this.options.delay === undefined ? {} : { delay: this.options.delay }),
      ...(this.options.setTimer === undefined ? {} : { setTimer: this.options.setTimer }),
      ...(this.options.clearTimer === undefined ? {} : { clearTimer: this.options.clearTimer }),
    });
    this.managers.set(connection.id, manager);
    try {
      await manager.start(listener);
    } catch (error) {
      this.managers.delete(connection.id);
      throw error;
    }
    return {
      connectionId: connection.id,
      channelId: this.channelId,
      providerId: this.id,
    };
  }

  public async disconnect(connectionId: string): Promise<void> {
    const manager = this.managers.get(connectionId);
    if (!manager) return;
    this.managers.delete(connectionId);
    await manager.stop();
  }

  public async logout(connectionId: string): Promise<void> {
    const manager = this.requireManager(connectionId);
    await manager.logout();
    this.managers.delete(connectionId);
  }

  public async reconnect(connectionId: string): Promise<void> {
    await this.requireManager(connectionId).reconnect();
  }

  public async send(message: OutboundMessage): Promise<SendResult> {
    if (message.conversationAddress.channelId !== this.channelId) {
      throw new InvalidWhatsAppConnectionError(
        `Expected channelId ${this.channelId}, received ${message.conversationAddress.channelId}`,
      );
    }
    const result = await this.requireManager(message.connectionId).sendText(
      message.conversationAddress.externalId,
      message.content,
    );
    return {
      connectionId: message.connectionId,
      providerMessageId: result.providerMessageId,
      sentAt: result.sentAt,
    };
  }

  public getSnapshot(connectionId: string): WhatsAppConnectionSnapshot | undefined {
    return this.managers.get(connectionId)?.getSnapshot();
  }

  public listContacts(connectionId: string): readonly WhatsAppContact[] {
    return this.managers.get(connectionId)?.listContacts() ?? [];
  }

  public async resolveConversationIdentity(
    connectionId: string,
    externalId: string,
    conversationType: ConversationType,
    displayName?: string,
  ): Promise<{ readonly displayName?: string; readonly avatarUrl?: string }> {
    return this.requireManager(connectionId).resolveConversationIdentity(
      externalId,
      conversationType,
      displayName,
    );
  }

  public onIdle(connectionId: string): Promise<void> {
    return this.requireManager(connectionId).onIdle();
  }

  private assertConnection(connection: ChannelConnection): void {
    if (
      connection.id !== WHATSAPP_PERSONAL_CONNECTION_ID ||
      connection.channelId !== this.channelId ||
      connection.providerId !== this.id
    ) {
      throw new InvalidWhatsAppConnectionError(
        `Experimental WhatsApp Web requires id=${WHATSAPP_PERSONAL_CONNECTION_ID}, ` +
          `channelId=${this.channelId}, providerId=${this.id}`,
      );
    }
  }

  private requireManager(connectionId: string): WhatsAppSocketManager {
    const manager = this.managers.get(connectionId);
    if (!manager) throw new WhatsAppConnectionNotFoundError(connectionId);
    return manager;
  }
}
