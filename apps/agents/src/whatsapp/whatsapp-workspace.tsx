"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { whatsAppApi } from "./whatsapp-api";
import { toQrDataUrl } from "./qrcode";
import type {
  ConnectionStatus,
  Conversation,
  ConversationMessage,
  ConversationMode,
  WhatsAppConnection,
} from "./types";

const emptyConnection: WhatsAppConnection = {
  id: "whatsapp-personal",
  name: "WhatsApp",
  channel: "WhatsApp Web",
  method: "QR code",
  status: "disconnected",
  globalEnabled: false,
  paused: false,
};
const modes: ConversationMode[] = ["enabled", "manual", "paused", "disabled", "blocked"];
const modeLabel: Record<ConversationMode, string> = {
  enabled: "Automacao ativa",
  manual: "Manual",
  paused: "Pausada",
  disabled: "Desativada",
  blocked: "Bloqueada",
};
const statusLabel: Record<ConnectionStatus, string> = {
  connected: "Conectado",
  connecting: "Conectando",
  reconnecting: "Reconectando",
  waiting_for_qr: "Aguardando QR",
  authenticated: "Autenticado",
  disconnected: "Desconectado",
  logged_out: "Sessao encerrada",
  error: "Erro de conexao",
};

function readableTime(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function WhatsAppWorkspace(): React.ReactElement {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [connection, setConnection] = useState(emptyConnection);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const selectedId = useRef<string | null>(null);

  useEffect(() => {
    selectedId.current = selected?.id ?? null;
  }, [selected]);

  const refresh = useCallback(
    async (includeMessages = true) => {
      const [nextConnection, nextConversations] = await Promise.all([
        whatsAppApi.connection(),
        whatsAppApi.conversations(search, filter),
      ]);
      setConnection(nextConnection);
      setConversations(nextConversations);
      const currentId = selectedId.current;
      const nextSelected = currentId
        ? (nextConversations.find((item) => item.id === currentId) ?? null)
        : (nextConversations[0] ?? null);
      setSelected(nextSelected);
      if (includeMessages && nextSelected) setMessages(await whatsAppApi.messages(nextSelected.id));
      if (!nextSelected) setMessages([]);
    },
    [filter, search],
  );

  useEffect(() => {
    let active = true;
    whatsAppApi
      .session()
      .then((session) => {
        if (active) setAuthenticated(session.authenticated);
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;
    const poll = async () => {
      try {
        await refresh();
        failures = 0;
        if (!cancelled)
          setNotice((current) =>
            current?.startsWith("Nao foi possivel atualizar") ? null : current,
          );
      } catch {
        failures += 1;
        if (!cancelled && failures === 1)
          setNotice("Nao foi possivel atualizar agora. Tentaremos novamente.");
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, Math.min(30000, 5000 * 2 ** failures));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [authenticated, refresh]);

  useEffect(() => {
    void toQrDataUrl(connection.qr).then(setQrImage);
  }, [connection.qr]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nao foi possivel concluir a acao.");
    } finally {
      setBusy(false);
    }
  };
  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const session = await whatsAppApi.login(email, password);
      setPassword("");
      setAuthenticated(session.authenticated);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nao foi possivel entrar.");
    } finally {
      setBusy(false);
    }
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    await run(async () => {
      await whatsAppApi.send(selected.id, draft.trim());
      setDraft("");
    }, "Mensagem enviada.");
  };
  const filterLabel = useMemo(
    () => (filter === "all" ? "Todos os modos" : modeLabel[filter as ConversationMode]),
    [filter],
  );
  const canSend = Boolean(
    selected &&
    connection.globalEnabled &&
    connection.status === "connected" &&
    selected.mode !== "blocked",
  );

  if (authenticated === null)
    return <main className="wa-loading">Carregando canal WhatsApp...</main>;
  if (!authenticated)
    return (
      <main className="wa-login">
        <form onSubmit={login}>
          <span className="wa-kicker">FLOWMIND AGENTS</span>
          <h1>WhatsApp</h1>
          <p>Entre com suas credenciais administrativas para acessar este canal.</p>
          <label>
            Email
            <input
              required
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Senha
            <input
              required
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {notice ? <small role="status">{notice}</small> : null}
          <button className="wa-primary" disabled={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </main>
    );

  return (
    <main className="wa-shell">
      <header className="wa-header">
        <div>
          <span className="wa-kicker">CANAL WHATSAPP</span>
          <h1>Atendimento e automacao</h1>
        </div>
        <button
          className="wa-link"
          onClick={() =>
            void run(async () => {
              await whatsAppApi.logoutAdmin();
              setAuthenticated(false);
            }, "")
          }
        >
          Sair
        </button>
      </header>
      {notice ? (
        <p className="wa-notice" role="status">
          {notice}
        </p>
      ) : null}
      <section className="wa-connection" aria-label="Conexao WhatsApp">
        <div>
          <span className={`wa-status ${connection.status}`}>{statusLabel[connection.status]}</span>
          <h2>{connection.name}</h2>
          <p>
            {connection.channel} | {connection.method}
          </p>
        </div>
        <div className="wa-controls">
          <button
            className="wa-primary"
            disabled={busy || connection.status === "connected"}
            onClick={() => void run(() => whatsAppApi.connect(connection.id), "Conexao iniciada.")}
          >
            Conectar
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(() => whatsAppApi.reconnect(connection.id), "Reconexao solicitada.")
            }
          >
            Reconectar
          </button>
          <button
            className="wa-danger"
            disabled={busy || connection.status === "logged_out"}
            onClick={() => {
              if (window.confirm("Encerrar esta sessao do WhatsApp Web?"))
                void run(() => whatsAppApi.logoutConnection(connection.id), "Sessao encerrada.");
            }}
          >
            Encerrar sessao
          </button>
        </div>
        <div className="wa-toggles">
          <label className="wa-switch">
            Canal ativo
            <input
              type="checkbox"
              checked={connection.globalEnabled}
              disabled={busy}
              onChange={(event) =>
                void run(
                  () => whatsAppApi.settings(event.target.checked),
                  event.target.checked ? "Canal ativado." : "Canal desativado.",
                )
              }
            />
            <i />
          </label>
          <label className="wa-switch">
            Pausar automacao
            <input
              type="checkbox"
              checked={connection.paused}
              disabled={busy || !connection.globalEnabled}
              onChange={(event) =>
                void run(
                  () => whatsAppApi.pause(event.target.checked),
                  event.target.checked ? "Automacao pausada." : "Automacao retomada.",
                )
              }
            />
            <i />
          </label>
        </div>
        {qrImage ? (
          <div className="wa-qr-wrap">
            <img className="wa-qr" src={qrImage} alt="QR code para conectar o WhatsApp" />
            <small>
              {connection.qrExpiresAt
                ? `Expira ${readableTime(connection.qrExpiresAt) ?? "em breve"}`
                : "Leia o QR code no WhatsApp"}
            </small>
          </div>
        ) : connection.status === "waiting_for_qr" ? (
          <p className="wa-qr-note">
            Aguardando um novo QR code. A tela sera atualizada automaticamente.
          </p>
        ) : null}
        {connection.status === "error" && connection.error ? (
          <p className="wa-connection-error" role="alert">
            {connection.error}
          </p>
        ) : null}
      </section>
      <section className="wa-workspace">
        <aside className="wa-conversations">
          <div className="wa-panel-title">
            <h2>Conversas</h2>
            <span>{conversations.length}</span>
          </div>
          <input
            aria-label="Buscar conversas"
            placeholder="Buscar nome ou numero"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="Filtrar por modo"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">Todos os modos</option>
            {modes.map((mode) => (
              <option key={mode} value={mode}>
                {modeLabel[mode]}
              </option>
            ))}
          </select>
          <p className="wa-filter-label">{filterLabel}</p>
          <div className="wa-list">
            {conversations.map((item) => (
              <button
                className={selected?.id === item.id ? "selected" : ""}
                key={item.id}
                onClick={() => setSelected(item)}
              >
                <strong>{item.name}</strong>
                <small>{item.preview ?? item.phone ?? "Sem mensagens"}</small>
                <em className={`wa-mode ${item.mode}`}>{modeLabel[item.mode]}</em>
                {item.unread ? <b>{item.unread}</b> : null}
              </button>
            ))}
            {!conversations.length ? (
              <p className="wa-empty">Nenhuma conversa encontrada.</p>
            ) : null}
          </div>
        </aside>
        <article className="wa-chat">
          {selected ? (
            <>
              <header>
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.phone ?? "Conversa WhatsApp"}</p>
                </div>
                <div className="wa-actions">
                  <select
                    aria-label="Modo da conversa"
                    value={selected.mode}
                    disabled={busy}
                    onChange={(event) =>
                      void run(
                        () =>
                          whatsAppApi.setMode(selected.id, event.target.value as ConversationMode),
                        "Modo atualizado.",
                      )
                    }
                  >
                    {modes.map((mode) => (
                      <option key={mode} value={mode}>
                        {modeLabel[mode]}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Resetar o contexto desta conversa?"))
                        void run(() => whatsAppApi.reset(selected.id), "Contexto resetado.");
                    }}
                  >
                    Resetar contexto
                  </button>
                </div>
              </header>
              <div className="wa-messages">
                {messages.map((message) => (
                  <div key={message.id} className={`wa-message ${message.direction}`}>
                    <p>{message.body}</p>
                    <small>
                      {message.sender ??
                        (message.direction === "outgoing" ? "Voce" : selected.name)}
                      {readableTime(message.sentAt) ? ` - ${readableTime(message.sentAt)}` : ""}
                    </small>
                  </div>
                ))}
                {!messages.length ? (
                  <p className="wa-empty">Sem mensagens nesta conversa.</p>
                ) : null}
              </div>
              <form className="wa-compose" onSubmit={send}>
                <textarea
                  value={draft}
                  disabled={!canSend || busy}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    canSend ? "Enviar mensagem manual" : "Envio indisponivel para esta conversa"
                  }
                  rows={2}
                />
                <button className="wa-primary" disabled={busy || !canSend || !draft.trim()}>
                  Enviar
                </button>
              </form>
            </>
          ) : (
            <div className="wa-empty">Selecione uma conversa para ver os detalhes.</div>
          )}
        </article>
      </section>
    </main>
  );
}
