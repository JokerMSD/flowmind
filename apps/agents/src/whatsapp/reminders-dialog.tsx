"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";

import type { Conversation, WhatsAppReminder } from "./types";
import { whatsAppApi } from "./whatsapp-api";

const weekdays = [
  ["D", 0],
  ["S", 1],
  ["T", 2],
  ["Q", 3],
  ["Q", 4],
  ["S", 5],
  ["S", 6],
] as const;

export function RemindersDialog({
  connectionId,
  conversations,
  initialConversationId,
  onClose,
}: {
  readonly connectionId: string;
  readonly conversations: readonly Conversation[];
  readonly initialConversationId?: string;
  readonly onClose: () => void;
}): React.ReactElement {
  const eligible = useMemo(
    () =>
      conversations.filter(
        (conversation) => conversation.type === "private" && conversation.mode !== "blocked",
      ),
    [conversations],
  );
  const [available, setAvailable] = useState<readonly Conversation[]>(eligible);
  const [reminders, setReminders] = useState<WhatsAppReminder[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(
    initialConversationId ? [initialConversationId] : [],
  );
  const [message, setMessage] = useState("Hora da foto do shape!");
  const [days, setDays] = useState<readonly number[]>([1, 3, 5]);
  const [time, setTime] = useState("20:00");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async (): Promise<void> => {
    const [nextReminders, nextConversations] = await Promise.all([
      whatsAppApi.reminders(),
      whatsAppApi.conversations("", "all"),
    ]);
    setReminders(nextReminders);
    setAvailable(
      nextConversations.filter(
        (conversation) => conversation.type === "private" && conversation.mode !== "blocked",
      ),
    );
  };
  useEffect(() => {
    void load().catch(() => setError("Nao foi possivel carregar os lembretes."));
  }, []);

  const visible = available.filter((conversation) =>
    `${conversation.name} ${conversation.phone ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  const conversationById = new Map(
    available.map((conversation) => [conversation.id, conversation]),
  );

  const create = async (): Promise<void> => {
    if (!message.trim() || selectedIds.length === 0 || days.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      await Promise.all(
        selectedIds.map((conversationId) =>
          whatsAppApi.createReminder({
            agentId: "csnf",
            message: message.trim(),
            enabled: true,
            schedule: {
              daysOfWeek: days,
              times: [time],
              timezone: "America/Sao_Paulo",
            },
            target: {
              channelId: "whatsapp",
              connectionId,
              conversationId,
            },
          }),
        ),
      );
      setSelectedIds([]);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel criar o lembrete.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wa-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Lembretes do WhatsApp"
        aria-modal="true"
        className="wa-reminders-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="wa-kicker">AUTOMACAO</span>
            <h2>Lembretes</h2>
          </div>
          <button aria-label="Fechar" className="wa-icon-button" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="wa-reminder-layout">
          <div className="wa-reminder-form">
            <label>
              Mensagem
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
            </label>
            <fieldset>
              <legend>Dias</legend>
              <div className="wa-weekdays">
                {weekdays.map(([label, value]) => (
                  <button
                    aria-pressed={days.includes(value)}
                    className={days.includes(value) ? "active" : ""}
                    key={value}
                    onClick={() =>
                      setDays(
                        days.includes(value)
                          ? days.filter((day) => day !== value)
                          : [...days, value].sort(),
                      )
                    }
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label>
              Horario
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
            <label>
              Destinatarios
              <input
                placeholder="Buscar contato"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="wa-recipient-list">
              {visible.map((conversation) => (
                <label key={conversation.id}>
                  <input
                    checked={selectedIds.includes(conversation.id)}
                    onChange={() =>
                      setSelectedIds(
                        selectedIds.includes(conversation.id)
                          ? selectedIds.filter((id) => id !== conversation.id)
                          : [...selectedIds, conversation.id],
                      )
                    }
                    type="checkbox"
                  />
                  <span>{conversation.name}</span>
                  <small>{conversation.phone}</small>
                </label>
              ))}
            </div>
            {error ? <p className="wa-form-error">{error}</p> : null}
            <button
              className="wa-primary"
              disabled={busy || selectedIds.length === 0 || days.length === 0 || !message.trim()}
              onClick={() => void create()}
            >
              {busy ? "Criando..." : `Criar para ${selectedIds.length} contato(s)`}
            </button>
          </div>
          <div className="wa-saved-reminders">
            <h3>Agendados</h3>
            {reminders.length === 0 ? <p>Nenhum lembrete configurado.</p> : null}
            {reminders.map((reminder) => {
              const contact = reminder.target
                ? conversationById.get(reminder.target.conversationId)
                : undefined;
              return (
                <article key={reminder.id}>
                  <strong>{contact?.name ?? "Sem destinatario"}</strong>
                  <p>{reminder.message}</p>
                  <small>
                    {reminder.schedule.times.join(", ")} · {reminder.enabled ? "Ativo" : "Pausado"}
                  </small>
                  <div>
                    <button
                      onClick={() =>
                        void whatsAppApi
                          .setReminderStatus(reminder.id, !reminder.enabled)
                          .then(load)
                      }
                    >
                      {reminder.enabled ? "Pausar" : "Ativar"}
                    </button>
                    <button
                      className="wa-danger"
                      onClick={() => void whatsAppApi.deleteReminder(reminder.id).then(load)}
                    >
                      Excluir
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
