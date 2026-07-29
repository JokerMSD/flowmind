import makeWASocket, {
  Browsers,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import type {
  AuthenticationCreds,
  AuthenticationState,
  Chat,
  ConnectionState,
  Contact,
  LIDMapping,
  WAMessage,
  WAMessageKey,
  WAVersion,
} from "@whiskeysockets/baileys";
import { pino } from "pino";

export interface WhatsAppSocketEventMap {
  readonly "connection.update": Partial<ConnectionState>;
  readonly "creds.update": Partial<AuthenticationCreds>;
  readonly "messages.upsert": {
    readonly messages: WAMessage[];
    readonly type: "append" | "notify";
  };
  readonly "contacts.upsert": Contact[];
  readonly "contacts.update": Partial<Contact>[];
  readonly "chats.upsert": Chat[];
  readonly "chats.update": Partial<Chat>[];
  readonly "chats.delete": string[];
  readonly "lid-mapping.update": LIDMapping;
  readonly "messaging-history.set": {
    readonly chats: Chat[];
    readonly contacts: Contact[];
    readonly messages: WAMessage[];
    readonly lidPnMappings?: LIDMapping[];
    readonly isLatest?: boolean;
    readonly progress?: number | null;
  };
  readonly "messaging-history.status": {
    readonly status: "complete" | "paused";
    readonly explicit: boolean;
  };
}

export interface WhatsAppSocketEventEmitter {
  on<K extends keyof WhatsAppSocketEventMap>(
    event: K,
    listener: (value: WhatsAppSocketEventMap[K]) => void,
  ): void;
  off<K extends keyof WhatsAppSocketEventMap>(
    event: K,
    listener: (value: WhatsAppSocketEventMap[K]) => void,
  ): void;
}

export interface WhatsAppSocket {
  readonly ev: WhatsAppSocketEventEmitter;
  readonly user: { readonly id: string } | undefined;
  sendMessage(
    jid: string,
    content: { readonly text: string },
  ): Promise<{ readonly key?: { readonly id?: string | null } } | undefined>;
  fetchMessageHistory?(
    count: number,
    oldestMessageKey: WAMessageKey,
    oldestMessageTimestamp: number,
  ): Promise<string>;
  downloadMedia?(message: WAMessage): Promise<Buffer>;
  profilePictureUrl?(jid: string, type?: "preview" | "image"): Promise<string | undefined>;
  groupMetadata?(jid: string): Promise<{ readonly subject?: string }>;
  getPhoneNumberForLid?(lid: string): Promise<string | undefined>;
  end(error: Error | undefined): void;
  logout(message?: string): Promise<void>;
}

export interface WhatsAppSocketFactoryContext {
  readonly auth: AuthenticationState;
}

export type WhatsAppSocketFactory = (
  context: WhatsAppSocketFactoryContext,
) => WhatsAppSocket | Promise<WhatsAppSocket>;

const silentLogger = pino({ level: "silent" });
const VERSION_LOOKUP_TIMEOUT_MS = 5_000;
let latestVersion: Promise<WAVersion | undefined> | undefined;

function resolveWhatsAppVersion(): Promise<WAVersion | undefined> {
  latestVersion ??= lookupWhatsAppVersion();
  return latestVersion;
}

async function lookupWhatsAppVersion(): Promise<WAVersion | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchLatestBaileysVersion().then((result) => result.version),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), VERSION_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const defaultWhatsAppSocketFactory: WhatsAppSocketFactory = async ({ auth }) => {
  const version = await resolveWhatsAppVersion();
  const socket = makeWASocket({
    auth,
    ...(version === undefined ? {} : { version }),
    browser: Browsers.ubuntu("Desktop"),
    logger: silentLogger,
    printQRInTerminal: false,
    emitOwnEvents: true,
    markOnlineOnConnect: false,
    shouldSyncHistoryMessage: () => true,
    syncFullHistory: true,
  });
  return {
    ev: socket.ev,
    get user() {
      return socket.user ? { id: socket.user.id } : undefined;
    },
    sendMessage: (jid, content) => socket.sendMessage(jid, content),
    fetchMessageHistory: (count, oldestMessageKey, oldestMessageTimestamp) =>
      socket.fetchMessageHistory(count, oldestMessageKey, oldestMessageTimestamp),
    downloadMedia: (message) =>
      downloadMediaMessage(message, "buffer", {}, {
        logger: silentLogger,
        reuploadRequest: socket.updateMediaMessage,
      }),
    profilePictureUrl: (jid, type) => socket.profilePictureUrl(jid, type),
    groupMetadata: (jid) => socket.groupMetadata(jid),
    getPhoneNumberForLid: async (lid) =>
      (await socket.signalRepository.lidMapping.getPNForLID(lid)) ?? undefined,
    end: (error) => socket.end(error),
    logout: (message) => socket.logout(message),
  };
};
