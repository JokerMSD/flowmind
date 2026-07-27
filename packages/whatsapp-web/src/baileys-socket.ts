import makeWASocket from "@whiskeysockets/baileys";
import type {
  AuthenticationCreds,
  AuthenticationState,
  ConnectionState,
  WAMessage,
} from "@whiskeysockets/baileys";
import { pino } from "pino";

export interface WhatsAppSocketEventMap {
  readonly "connection.update": Partial<ConnectionState>;
  readonly "creds.update": Partial<AuthenticationCreds>;
  readonly "messages.upsert": {
    readonly messages: WAMessage[];
    readonly type: "append" | "notify";
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
  profilePictureUrl?(jid: string, type?: "preview" | "image"): Promise<string | undefined>;
  groupMetadata?(jid: string): Promise<{ readonly subject?: string }>;
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

export const defaultWhatsAppSocketFactory: WhatsAppSocketFactory = ({ auth }) => {
  const socket = makeWASocket({
    auth,
    logger: silentLogger,
    printQRInTerminal: false,
    emitOwnEvents: true,
    markOnlineOnConnect: false,
    shouldSyncHistoryMessage: () => false,
    syncFullHistory: false,
  });
  return {
    ev: socket.ev,
    get user() {
      return socket.user ? { id: socket.user.id } : undefined;
    },
    sendMessage: (jid, content) => socket.sendMessage(jid, content),
    profilePictureUrl: (jid, type) => socket.profilePictureUrl(jid, type),
    groupMetadata: (jid) => socket.groupMetadata(jid),
    end: (error) => socket.end(error),
    logout: (message) => socket.logout(message),
  };
};
