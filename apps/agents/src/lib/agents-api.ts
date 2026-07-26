import type {
  AgentSummary,
  ChatResponse,
  ChatSession,
  Reminder,
  ReminderInput,
  ReminderOccurrence,
} from "../types";

const apiUrl = process.env.NEXT_PUBLIC_FLOWMIND_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Falha na API (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

export const agentsApi = {
  listAgents: () => request<AgentSummary[]>("/agents"),
  getSession: (sessionId: string) => request<ChatSession>(`/sessions/${encodeURIComponent(sessionId)}`),
  sendMessage: (agentId: string, message: string, sessionId?: string) =>
    request<ChatResponse>("/chat", {
      method: "POST",
      body: JSON.stringify({ agentId, message, ...(sessionId ? { sessionId } : {}) }),
    }),
  listReminders: (agentId: string) =>
    request<Reminder[]>(`/reminders?agentId=${encodeURIComponent(agentId)}`),
  createReminder: (input: ReminderInput) =>
    request<Reminder>("/reminders", { method: "POST", body: JSON.stringify(input) }),
  updateReminder: (id: string, input: ReminderInput) =>
    request<Reminder>(`/reminders/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteReminder: (id: string) =>
    request<{ deleted: true }>(`/reminders/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setReminderStatus: (id: string, enabled: boolean) =>
    request<Reminder>(`/reminders/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  listOccurrences: (agentId: string) =>
    request<ReminderOccurrence[]>(`/reminder-occurrences?agentId=${encodeURIComponent(agentId)}`),
};
