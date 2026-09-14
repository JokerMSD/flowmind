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
  error?: string;
  globalEnabled: boolean;
  groupsEnabled: boolean;
  paused: boolean;
  historySyncStatus?: "idle" | "syncing" | "complete" | "paused";
  historySyncProgress?: number;
}

export interface Conversation {
  id: string;
  name: string;
  type: "private" | "group";
  phone?: string;
  avatarUrl?: string;
  preview?: string;
  updatedAt?: string;
  unread?: number;
  pinned?: boolean;
  mode: ConversationMode;
}

export interface WhatsAppContact {
  id: string;
  name: string;
  phone?: string;
  avatarUrl?: string;
  conversationId?: string;
}

export interface WhatsAppReminder {
  id: string;
  agentId: string;
  message: string;
  enabled: boolean;
  schedule: {
    daysOfWeek: readonly number[];
    times: readonly string[];
    timezone: string;
  };
  target?: {
    channelId: string;
    connectionId: string;
    conversationId: string;
  };
}

export interface ConversationMessage {
  id: string;
  body: string;
  direction: "incoming" | "outgoing";
  sentAt?: string;
  sender?: string;
  media?: {
    url: string;
    type: "image" | "video" | "audio" | "document" | "sticker";
    mimeType: string;
    fileName?: string;
  };
}

export interface AdminSession {
  authenticated: boolean;
  user?: AdminUser | null;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
}
