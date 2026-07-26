export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "waiting_for_qr"
  | "authenticated"
  | "disconnected"
  | "logged_out"
  | "error";

export type ConversationMode = "disabled" | "enabled" | "paused" | "manual" | "blocked";

export interface WhatsAppConnection {
  id: string;
  name: string;
  channel: string;
  method: string;
  status: ConnectionStatus;
  qr?: string | null;
  qrExpiresAt?: string | null;
  globalEnabled: boolean;
  paused: boolean;
}

export interface Conversation {
  id: string;
  name: string;
  phone?: string;
  preview?: string;
  updatedAt?: string;
  unread?: number;
  mode: ConversationMode;
}

export interface ConversationMessage {
  id: string;
  body: string;
  direction: "incoming" | "outgoing";
  sentAt?: string;
  sender?: string;
}

export interface AdminSession {
  authenticated: boolean;
}
