"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";

import type { ChatMessage } from "../types";

export function ChatPanel({
  agentName,
  connected,
  messages,
  onSend,
  sending,
}: {
  readonly agentName: string;
  readonly connected: boolean;
  readonly messages: readonly ChatMessage[];
  readonly onSend: (message: string) => Promise<void>;
  readonly sending: boolean;
}): React.ReactElement {
  const [message, setMessage] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const submit = async (): Promise<void> => {
    if (!message.trim() || sending) return;
    const content = message;
    setMessage("");
    await onSend(content);
  };

  return (
    <section className="chat-panel">
      <header className="panel-heading">
        <div><span className="eyebrow">Conversa</span><h2>{agentName}</h2></div>
        <span className={`status-dot ${connected ? "online" : "offline"}`}>
          {connected ? "Online local" : "Offline local"}
        </span>
      </header>
      <div className="message-list" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-state"><strong>Comece uma conversa</strong><span>Pergunte sobre treino, shape ou lembretes.</span></div>
        ) : null}
        {messages.map((item) => (
          <article className={`message ${item.role}`} key={item.id}>
            <span>{item.role === "user" ? "Voce" : agentName}</span>
            <p>{item.content}</p>
            <time>{formatTime(item.timestamp)}</time>
          </article>
        ))}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <textarea
          aria-label="Mensagem"
          disabled={sending}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Converse com o CSNF..."
          rows={2}
          value={message}
        />
        <button disabled={sending || !message.trim()} onClick={() => void submit()} type="button">
          {sending ? "Enviando" : "Enviar"}
        </button>
      </div>
    </section>
  );
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}
