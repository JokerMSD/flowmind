"use client";

import { useCallback, useEffect, useState } from "react";

import { agentsApi } from "../lib/agents-api";
import type { AgentSummary, ChatMessage, Feedback, Reminder, ReminderInput, ReminderOccurrence } from "../types";

const sessionStorageKey = "flowmind.csnf.session";

export function useAgentsWorkspace() {
  const [agents, setAgents] = useState<readonly AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [reminders, setReminders] = useState<readonly Reminder[]>([]);
  const [occurrences, setOccurrences] = useState<readonly ReminderOccurrence[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const refreshAgentData = useCallback(async (agentId: string) => {
    const [nextReminders, nextOccurrences] = await Promise.all([
      agentsApi.listReminders(agentId),
      agentsApi.listOccurrences(agentId),
    ]);
    setReminders(nextReminders);
    setOccurrences(nextOccurrences);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const nextAgents = await agentsApi.listAgents();
        const initialAgent = nextAgents.find((agent) => agent.id === "csnf") ?? nextAgents[0];
        setAgents(nextAgents);

        if (!initialAgent) {
          setFeedback({ kind: "error", message: "Nenhum agente disponivel." });
          return;
        }

        setSelectedAgentId(initialAgent.id);
        await refreshAgentData(initialAgent.id);
        const storedSession = window.localStorage.getItem(sessionStorageKey);

        if (storedSession) {
          const session = await agentsApi.getSession(storedSession);
          if (session.agentId === initialAgent.id) {
            setSessionId(session.id);
            setMessages(session.messages);
          }
        }
      } catch (error) {
        window.localStorage.removeItem(sessionStorageKey);
        setFeedback({ kind: "error", message: readError(error) });
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshAgentData]);

  useEffect(() => {
    if (!selectedAgentId) {
      return;
    }

    const timer = window.setInterval(() => {
      void agentsApi.listOccurrences(selectedAgentId).then(setOccurrences).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [selectedAgentId]);

  const sendMessage = useCallback(async (content: string) => {
    const normalized = content.trim().replace(/\s+/g, " ");
    if (!normalized || !selectedAgentId || sending) return;

    setSending(true);
    setFeedback(undefined);
    try {
      const response = await agentsApi.sendMessage(selectedAgentId, normalized, sessionId);
      window.localStorage.setItem(sessionStorageKey, response.sessionId);
      setSessionId(response.sessionId);
      const session = await agentsApi.getSession(response.sessionId);
      setMessages(session.messages);
    } catch (error) {
      setFeedback({ kind: "error", message: readError(error) });
    } finally {
      setSending(false);
    }
  }, [selectedAgentId, sending, sessionId]);

  const saveReminder = useCallback(async (input: ReminderInput, id?: string) => {
    try {
      await (id ? agentsApi.updateReminder(id, input) : agentsApi.createReminder(input));
      await refreshAgentData(input.agentId);
      setFeedback({ kind: "success", message: id ? "Lembrete atualizado." : "Lembrete criado." });
      return true;
    } catch (error) {
      setFeedback({ kind: "error", message: readError(error) });
      return false;
    }
  }, [refreshAgentData]);

  const deleteReminder = useCallback(async (id: string) => {
    if (!selectedAgentId) return;
    try {
      await agentsApi.deleteReminder(id);
      await refreshAgentData(selectedAgentId);
      setFeedback({ kind: "success", message: "Lembrete excluido." });
    } catch (error) {
      setFeedback({ kind: "error", message: readError(error) });
    }
  }, [refreshAgentData, selectedAgentId]);

  const toggleReminder = useCallback(async (reminder: Reminder) => {
    try {
      await agentsApi.setReminderStatus(reminder.id, !reminder.enabled);
      await refreshAgentData(reminder.agentId);
    } catch (error) {
      setFeedback({ kind: "error", message: readError(error) });
    }
  }, [refreshAgentData]);

  return {
    agents, deleteReminder, feedback, loading, messages, occurrences, reminders,
    saveReminder, selectedAgentId, sending, sendMessage, toggleReminder,
  };
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Falha inesperada.";
}
