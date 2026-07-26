"use client";

import type React from "react";
import { useEffect, useState } from "react";

import type { Reminder, ReminderInput } from "../types";

const weekdays = [
  { value: 0, label: "Dom" }, { value: 1, label: "Seg" }, { value: 2, label: "Ter" },
  { value: 3, label: "Qua" }, { value: 4, label: "Qui" }, { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
] as const;

export function ReminderPanel({
  agentId,
  onDelete,
  onSave,
  onToggle,
  reminders,
}: {
  readonly agentId: string;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onSave: (input: ReminderInput, id?: string) => Promise<boolean>;
  readonly onToggle: (reminder: Reminder) => Promise<void>;
  readonly reminders: readonly Reminder[];
}): React.ReactElement {
  const [editing, setEditing] = useState<Reminder>();
  const [message, setMessage] = useState("Hora da foto do shape!");
  const [days, setDays] = useState<readonly number[]>([1, 3, 5]);
  const [times, setTimes] = useState<readonly string[]>(["20:00"]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setMessage(editing.message);
    setDays(editing.schedule.daysOfWeek);
    setTimes(editing.schedule.times);
    setEnabled(editing.enabled);
  }, [editing]);

  const reset = (): void => {
    setEditing(undefined);
    setMessage("Hora da foto do shape!");
    setDays([1, 3, 5]);
    setTimes(["20:00"]);
    setEnabled(true);
  };

  const submit = async (): Promise<void> => {
    if (!message.trim() || days.length === 0 || times.length === 0 || times.some((time) => !isValidTime(time))) return;
    setSaving(true);
    const saved = await onSave({
      agentId,
      type: "shape-photo",
      message: message.trim(),
      schedule: { daysOfWeek: days, times, timezone: "America/Sao_Paulo" },
      enabled,
    }, editing?.id);
    setSaving(false);
    if (saved) reset();
  };

  return (
    <section className="reminder-panel">
      <header className="panel-heading">
        <div><span className="eyebrow">Automacao</span><h2>Foto do shape</h2></div>
        {editing ? <button className="quiet-button" onClick={reset} type="button">Cancelar</button> : null}
      </header>
      <div className="reminder-form">
        <label>Mensagem<input onChange={(event) => setMessage(event.target.value)} value={message} /></label>
        <fieldset>
          <legend>Dias da semana</legend>
          <div className="weekday-grid">
            {weekdays.map((day) => (
              <button
                aria-pressed={days.includes(day.value)}
                className={days.includes(day.value) ? "selected" : ""}
                key={day.value}
                onClick={() => setDays(toggleValue(days, day.value))}
                type="button"
              >
                {day.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Horarios</legend>
          <div className="time-list">
            {times.map((time, index) => (
              <div key={`${index}-${time}`}>
                <input
                  aria-label={`Horario ${index + 1}`}
                  onChange={(event) => setTimes(times.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                  type="time"
                  value={time}
                />
                <button aria-label="Remover horario" disabled={times.length === 1} onClick={() => setTimes(times.filter((_, itemIndex) => itemIndex !== index))} type="button">x</button>
              </div>
            ))}
            <button className="quiet-button" onClick={() => setTimes([...times, "08:00"])} type="button">+ Horario</button>
          </div>
        </fieldset>
        <label className="toggle-row">
          <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
          <span>Lembrete ativo</span>
        </label>
        <button className="primary-button" disabled={saving || !message.trim() || days.length === 0} onClick={() => void submit()} type="button">
          {saving ? "Salvando..." : editing ? "Atualizar lembrete" : "Criar lembrete"}
        </button>
      </div>
      <div className="saved-reminders">
        <div className="section-heading"><h3>Lembretes configurados</h3><span>{reminders.length}</span></div>
        {reminders.length === 0 ? <p className="empty-copy">Nenhum lembrete configurado.</p> : null}
        {reminders.map((reminder) => (
          <article className="reminder-item" key={reminder.id}>
            <div className="reminder-copy">
              <span className={reminder.enabled ? "enabled-badge" : "disabled-badge"}>{reminder.enabled ? "Ativo" : "Pausado"}</span>
              <strong>{reminder.message}</strong>
              <small>{formatSchedule(reminder)}</small>
            </div>
            <div className="reminder-actions">
              <button onClick={() => void onToggle(reminder)} type="button">{reminder.enabled ? "Pausar" : "Ativar"}</button>
              <button onClick={() => setEditing(reminder)} type="button">Editar</button>
              <button className="danger-button" onClick={() => {
                if (window.confirm("Excluir este lembrete?")) void onDelete(reminder.id);
              }} type="button">Excluir</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function toggleValue(values: readonly number[], value: number): readonly number[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value].sort();
}

function isValidTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatSchedule(reminder: Reminder): string {
  const labels = reminder.schedule.daysOfWeek.map((value) => weekdays.find((day) => day.value === value)?.label).join(", ");
  return `${labels} as ${reminder.schedule.times.join(", ")} · ${reminder.schedule.timezone}`;
}
