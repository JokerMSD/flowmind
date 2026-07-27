import type {
  AdminSession,
  ConnectionStatus,
  Conversation,
  ConversationMessage,
  ConversationMode,
  WhatsAppContact,
  WhatsAppConnection,
} from "./types";

const apiUrl = process.env.NEXT_PUBLIC_FLOWMIND_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Falha na API (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function unwrap<T>(payload: T | { data: T }): T {
  return typeof payload === "object" && payload !== null && "data" in payload
    ? (payload as { data: T }).data
    : (payload as T);
}

function asMode(value: unknown): ConversationMode {
  return value === "disabled" ||
    value === "enabled" ||
    value === "paused" ||
    value === "manual" ||
    value === "blocked"
    ? value
    : "enabled";
}

function connectionFrom(payload: unknown): WhatsAppConnection {
  const value = unwrap(payload as Record<string, unknown>) as Record<string, unknown>;
  return {
    id: String(value.connectionId ?? value.id ?? "whatsapp-personal"),
    name: String(value.name ?? value.accountName ?? "WhatsApp"),
    channel: String(value.channel ?? "WhatsApp Web"),
    method: String(value.method ?? "QR code"),
    status: (value.status ?? "disconnected") as ConnectionStatus,
    qr: typeof (value.qr ?? value.qrCode) === "string" ? String(value.qr ?? value.qrCode) : null,
    qrExpiresAt: typeof value.qrExpiresAt === "string" ? value.qrExpiresAt : null,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    globalEnabled: Boolean(value.globalEnabled ?? value.enabled),
    paused: Boolean(value.paused ?? value.pauseAll),
  };
}

function conversationsFrom(payload: unknown): Conversation[] {
  const value = unwrap(payload as unknown[] | { items?: unknown[]; conversations?: unknown[] });
  const list = Array.isArray(value) ? value : (value.items ?? value.conversations ?? []);
  return list.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      id: String(row.id ?? row.conversationId),
      name: String(row.name ?? row.contactName ?? row.phone ?? "Contato"),
      type: row.type === "group" ? "group" : "private",
      unread: Number(row.unread ?? row.unreadCount ?? 0),
      mode: asMode(row.automationMode ?? row.mode),
      ...(typeof row.phone === "string" ? { phone: row.phone } : {}),
      ...(typeof row.avatarUrl === "string" ? { avatarUrl: row.avatarUrl } : {}),
      ...(typeof row.preview === "string" ? { preview: row.preview } : {}),
      ...(typeof row.updatedAt === "string" ? { updatedAt: row.updatedAt } : {}),
    };
  });
}

function contactsFrom(payload: unknown): WhatsAppContact[] {
  const value = unwrap(payload as unknown[] | { items?: unknown[]; contacts?: unknown[] });
  const list = Array.isArray(value) ? value : (value.items ?? value.contacts ?? []);
  return list.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name ?? row.phone ?? "Contato"),
      ...(typeof row.phone === "string" ? { phone: row.phone } : {}),
      ...(typeof row.avatarUrl === "string" ? { avatarUrl: row.avatarUrl } : {}),
      ...(typeof row.conversationId === "string" ? { conversationId: row.conversationId } : {}),
    };
  });
}

export const whatsAppApi = {
  session: async () =>
    unwrap(await request<AdminSession | { data: AdminSession }>("/admin/auth/status")),
  login: async (email: string, password: string) =>
    unwrap(
      await request<AdminSession | { data: AdminSession }>("/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    ),
  logoutAdmin: () => request<AdminSession>("/admin/auth/logout", { method: "POST" }),
  connection: async () => connectionFrom(await request<unknown>("/integrations/whatsapp/status")),
  connect: (connectionId: string) =>
    request<unknown>("/integrations/whatsapp/connect", {
      method: "POST",
      body: JSON.stringify({ connectionId }),
    }),
  logoutConnection: (connectionId: string) =>
    request<unknown>("/integrations/whatsapp/logout", {
      method: "POST",
      body: JSON.stringify({ connectionId }),
    }),
  settings: (globalEnabled: boolean) =>
    request<unknown>("/integrations/whatsapp/settings", {
      method: "PATCH",
      body: JSON.stringify({ globalEnabled }),
    }),
  pause: (paused: boolean) =>
    request<unknown>(`/integrations/whatsapp/${paused ? "pause" : "resume"}`, { method: "POST" }),
  conversations: async (query = "", mode = "all") =>
    conversationsFrom(
      await request<unknown>(
        `/integrations/whatsapp/conversations?search=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`,
      ),
    ),
  contacts: async (connectionId: string) =>
    contactsFrom(
      await request<unknown>(
        `/integrations/whatsapp/contacts?connectionId=${encodeURIComponent(connectionId)}`,
      ),
    ),
  messages: async (id: string) =>
    unwrap(
      await request<ConversationMessage[] | { data: ConversationMessage[] }>(
        `/integrations/whatsapp/conversations/${encodeURIComponent(id)}/messages`,
      ),
    ),
  setMode: (id: string, mode: ConversationMode) =>
    request<unknown>(`/integrations/whatsapp/conversations/${encodeURIComponent(id)}/mode`, {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }),
  reset: (id: string) =>
    request<unknown>(`/integrations/whatsapp/conversations/${encodeURIComponent(id)}/reset`, {
      method: "POST",
    }),
  send: (id: string, body: string) =>
    request<unknown>(`/integrations/whatsapp/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
};
