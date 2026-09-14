"use client";

import type React from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { whatsAppApi, whatsAppMediaUrl } from "./whatsapp-api";
import { toQrDataUrl } from "./qrcode";
import { RemindersDialog } from "./reminders-dialog";
import type {
  ConnectionStatus,
  Conversation,
  ConversationMessage,
  ConversationMode,
  WhatsAppContact,
  WhatsAppConnection,
} from "./types";

const emptyConnection: WhatsAppConnection = {
  id: "whatsapp-personal",
  name: "WhatsApp",
  channel: "WhatsApp Web",
  method: "QR code",
  status: "disconnected",
  globalEnabled: false,
  groupsEnabled: false,
  paused: false,
};
const modes: ConversationMode[] = ["enabled", "manual", "paused", "disabled", "blocked"];
type InboxFilter = "all" | "unread" | "groups";
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

function conversationTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function messageDateKey(value?: string): string {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleDateString("en-CA");
}

function readableDate(value?: string): string {
  if (!value) return "Data desconhecida";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data desconhecida";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = date.toLocaleDateString("en-CA");
  if (key === today.toLocaleDateString("en-CA")) return "Hoje";
  if (key === yesterday.toLocaleDateString("en-CA")) return "Ontem";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function readablePhone(value?: string): string {
  if (!value) return "Numero indisponivel";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return digits.length >= 8 ? `+${digits}` : value;
}

function contactName(contact: WhatsAppContact): string {
  const normalizedName = contact.name.replace(/[\s()+.\-_*]/g, "");
  return /^\d+$/.test(normalizedName) ? readablePhone(contact.phone ?? contact.id) : contact.name;
}

function Avatar({
  identity,
  size = "medium",
}: {
  identity: Pick<Conversation | WhatsAppContact, "name" | "avatarUrl">;
  size?: "medium" | "large";
}) {
  const fallback = identity.name
    .split(/\s+/)
    .filter((part) => /[A-Za-z]/.test(part))
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={`wa-avatar ${size} ${identity.avatarUrl || fallback ? "" : "anonymous"}`}
    >
      {identity.avatarUrl ? (
        <img src={identity.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        fallback
      )}
    </span>
  );
}

export function WhatsAppWorkspace(): React.ReactElement {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [connection, setConnection] = useState(emptyConnection);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [activeList, setActiveList] = useState<"conversations" | "contacts">("conversations");
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [unavailableMedia, setUnavailableMedia] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const selectedId = useRef<string | null>(null);
  const messagesViewport = useRef<HTMLDivElement | null>(null);
  const followLatestMessage = useRef(true);

  useEffect(() => {
    selectedId.current = selected?.id ?? null;
  }, [selected]);

  const refresh = useCallback(
    async (includeMessages = true, includeContacts = true) => {
      const [nextConnection, nextConversations, nextContacts] = await Promise.all([
        whatsAppApi.connection(),
        whatsAppApi.conversations(
          activeList === "conversations" ? search : "",
          "all",
        ),
        includeContacts ? whatsAppApi.contacts(connection.id) : Promise.resolve(null),
      ]);
      setConnection(nextConnection);
      setConversations(nextConversations);
      if (nextContacts) setContacts(nextContacts);
      const currentId = selectedId.current;
      const nextSelected = currentId
        ? (nextConversations.find((item) => item.id === currentId) ?? null)
        : (nextConversations[0] ?? null);
      setSelected(nextSelected);
      if (includeMessages && nextSelected) setMessages(await whatsAppApi.messages(nextSelected.id));
      if (!nextSelected) setMessages([]);
    },
    [activeList, connection.id, search],
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
        await refresh(true, false);
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
        if (!cancelled) timer = window.setTimeout(poll, Math.min(30_000, 1_000 * 2 ** failures));
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

  useEffect(() => {
    const viewport = messagesViewport.current;
    if (viewport && followLatestMessage.current) viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

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
    followLatestMessage.current = true;
    await run(async () => {
      await whatsAppApi.send(selected.id, draft.trim());
      setDraft("");
    }, "Mensagem enviada.");
  };
  const allowedConversations = useMemo(
    () =>
      connection.groupsEnabled
        ? conversations
        : conversations.filter((item) => item.type !== "group"),
    [connection.groupsEnabled, conversations],
  );
  const visibleConversations = useMemo(() => {
    if (inboxFilter === "unread")
      return allowedConversations.filter((item) => (item.unread ?? 0) > 0);
    if (inboxFilter === "groups")
      return allowedConversations.filter((item) => item.type === "group");
    return allowedConversations;
  }, [allowedConversations, inboxFilter]);
  const unreadConversations = useMemo(
    () => allowedConversations.filter((item) => (item.unread ?? 0) > 0).length,
    [allowedConversations],
  );
  const groupConversations = useMemo(
    () => conversations.filter((item) => item.type === "group").length,
    [conversations],
  );
  const visibleContacts = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return contacts;
    return contacts.filter(
      (contact) =>
        contact.name.toLocaleLowerCase("pt-BR").includes(normalized) ||
        contact.phone?.includes(normalized),
    );
  }, [contacts, search]);
  const canSend = Boolean(
    selected &&
    connection.globalEnabled &&
    connection.status === "connected" &&
    selected.mode !== "blocked",
  );
  const canFetchHistory =
    connection.historySyncStatus === "complete" ||
    connection.historySyncStatus === "paused";

  useEffect(() => {
    if (connection.groupsEnabled) return;
    if (inboxFilter === "groups") setInboxFilter("all");
    if (selected?.type !== "group") return;
    const replacement = conversations.find((conversation) => conversation.type === "private");
    followLatestMessage.current = true;
    setSelected(replacement ?? null);
    if (!replacement) setMessages([]);
  }, [connection.groupsEnabled, conversations, inboxFilter, selected?.type]);

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
        <div className="wa-header-actions">
          <button className="wa-link" onClick={() => setRemindersOpen(true)}>
            Lembretes
          </button>
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
        </div>
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
            onClick={() => void run(() => Promise.resolve(), "Dados atualizados.")}
          >
            Atualizar dados
          </button>
          <button
            disabled={
              busy ||
              connection.status !== "connected" ||
              !canFetchHistory
            }
            title={
              canFetchHistory
                ? "Buscar mensagens anteriores"
                : "Disponivel apos a sincronizacao inicial"
            }
            onClick={() =>
              void run(
                () => whatsAppApi.fetchHistory(),
                "Historico geral solicitado. A sincronizacao continuara em segundo plano.",
              )
            }
          >
            Buscar historico
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
                  () => whatsAppApi.settings({ globalEnabled: event.target.checked }),
                  event.target.checked ? "Canal ativado." : "Canal desativado.",
                )
              }
            />
            <i />
          </label>
          <label className="wa-switch">
            Grupos
            <input
              type="checkbox"
              checked={connection.groupsEnabled}
              disabled={busy || !connection.globalEnabled}
              onChange={(event) =>
                void run(
                  () => whatsAppApi.settings({ allowGroups: event.target.checked }),
                  event.target.checked
                    ? "Automacao em grupos permitida."
                    : "Automacao em grupos desativada.",
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
        {connection.historySyncStatus === "syncing" ||
        connection.historySyncStatus === "paused" ? (
          <div
            className={`wa-sync-progress ${
              connection.historySyncStatus === "paused" ? "paused" : ""
            }`}
            role="status"
          >
            <div>
              <strong>
                {connection.historySyncStatus === "paused"
                  ? "Sincronizacao pausada"
                  : "Sincronizando conversas"}
              </strong>
              <span>
                {connection.historySyncProgress === undefined
                  ? `${allowedConversations.length} conversas recebidas`
                  : `${connection.historySyncProgress}%`}
              </span>
            </div>
            <progress
              max={100}
              value={connection.historySyncProgress}
              aria-label="Progresso da sincronizacao do WhatsApp"
            />
            <small>
              {connection.historySyncStatus === "paused"
                ? "O WhatsApp parou de enviar novos blocos. Buscar historico ja esta disponivel."
                : "Mantenha o FlowMind aberto. A busca de historico sera liberada ao concluir."}
            </small>
          </div>
        ) : null}
      </section>
      <section className="wa-workspace">
        <aside className="wa-conversations">
          <div className="wa-list-tabs" role="tablist" aria-label="Navegacao do WhatsApp">
            <button
              role="tab"
              aria-selected={activeList === "conversations"}
              className={activeList === "conversations" ? "active" : ""}
              onClick={() => setActiveList("conversations")}
            >
              Conversas <span>{allowedConversations.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={activeList === "contacts"}
              className={activeList === "contacts" ? "active" : ""}
              onClick={() => setActiveList("contacts")}
            >
              Contatos <span>{contacts.length}</span>
            </button>
          </div>
          <input
            aria-label={activeList === "conversations" ? "Buscar conversas" : "Buscar contatos"}
            placeholder="Buscar nome ou numero"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {activeList === "conversations" ? (
            <div className="wa-inbox-filters" aria-label="Filtros de conversa">
              <button
                className={inboxFilter === "all" ? "active" : ""}
                onClick={() => setInboxFilter("all")}
              >
                Tudo
              </button>
              <button
                className={inboxFilter === "unread" ? "active" : ""}
                onClick={() => setInboxFilter("unread")}
              >
                Não lidas {unreadConversations || ""}
              </button>
              {connection.groupsEnabled ? (
                <button
                  className={inboxFilter === "groups" ? "active" : ""}
                  onClick={() => setInboxFilter("groups")}
                >
                  Grupos {groupConversations || ""}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="wa-filter-label">{visibleContacts.length} contatos sincronizados</p>
          )}
          <div className="wa-list">
            {activeList === "conversations" ? (
              <>
                {visibleConversations.map((item) => (
                  <button
                    className={selected?.id === item.id ? "selected" : ""}
                    key={item.id}
                    onClick={() => {
                      followLatestMessage.current = true;
                      setSelected(item);
                    }}
                  >
                    <Avatar identity={item} />
                    <span className="wa-conversation-copy">
                      <span className="wa-conversation-heading">
                        <strong>{item.name}</strong>
                        <time className={item.unread ? "unread" : ""}>
                          {conversationTime(item.updatedAt)}
                        </time>
                      </span>
                      <small>{item.preview ?? item.phone ?? "Sem mensagens"}</small>
                    </span>
                    {item.pinned ? <span className="wa-pin" aria-label="Conversa fixada" /> : null}
                    {item.unread ? <b>{item.unread}</b> : null}
                  </button>
                ))}
                {!visibleConversations.length ? (
                  <p className="wa-empty">Nenhuma conversa encontrada.</p>
                ) : null}
              </>
            ) : (
              <>
                {visibleContacts.map((contact) => {
                  const conversation = conversations.find(
                    (item) => item.id === contact.conversationId,
                  );
                  return (
                    <button
                      className={conversation && selected?.id === conversation.id ? "selected" : ""}
                      disabled={!conversation}
                      key={contact.id}
                      onClick={() => {
                        if (!conversation) return;
                        followLatestMessage.current = true;
                        setSelected(conversation);
                      }}
                    >
                      <Avatar identity={contact} />
                      <span className="wa-conversation-copy">
                        <strong>{contactName(contact)}</strong>
                        <small>{readablePhone(contact.phone)}</small>
                        <em className="wa-contact-state">
                          {conversation ? "Abrir conversa" : "Sem conversa"}
                        </em>
                      </span>
                    </button>
                  );
                })}
                {!visibleContacts.length ? (
                  <p className="wa-empty">Nenhum contato sincronizado.</p>
                ) : null}
              </>
            )}
          </div>
        </aside>
        <article className="wa-chat">
          {selected ? (
            <>
              <header>
                <div className="wa-chat-identity">
                  <Avatar identity={selected} size="large" />
                  <div>
                    <h2>{selected.name}</h2>
                    <p>
                      {selected.type === "group"
                        ? "Grupo"
                        : (selected.phone ?? "Conversa WhatsApp")}
                    </p>
                  </div>
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
              <div
                className="wa-messages"
                ref={messagesViewport}
                onScroll={(event) => {
                  const viewport = event.currentTarget;
                  followLatestMessage.current =
                    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
                }}
              >
                {messages.map((message, index) => {
                  if (unavailableMedia.has(message.id) && !message.body.trim()) return null;
                  const previous = messages[index - 1];
                  const startsDay =
                    !previous || messageDateKey(previous.sentAt) !== messageDateKey(message.sentAt);
                  const showSender =
                    selected.type === "group" &&
                    message.direction === "incoming" &&
                    Boolean(message.sender);
                  return (
                    <Fragment key={message.id}>
                      {startsDay ? (
                        <div className="wa-day-separator">{readableDate(message.sentAt)}</div>
                      ) : null}
                      <div className={`wa-message ${message.direction}`}>
                        {showSender ? <strong>{message.sender}</strong> : null}
                        <div className="wa-message-content">
                          {message.media?.type === "image" ||
                          message.media?.type === "sticker" ? (
                            <img
                              className="wa-message-media"
                              src={whatsAppMediaUrl(message.media.url)}
                              alt={message.body.trim() || "Imagem do WhatsApp"}
                              onError={() =>
                                setUnavailableMedia((current) => new Set(current).add(message.id))
                              }
                            />
                          ) : null}
                          {message.media?.type === "video" ? (
                            <video
                              className="wa-message-media"
                              src={whatsAppMediaUrl(message.media.url)}
                              controls
                              preload="metadata"
                              onError={() =>
                                setUnavailableMedia((current) => new Set(current).add(message.id))
                              }
                            />
                          ) : null}
                          {message.media?.type === "audio" ? (
                            <audio
                              src={whatsAppMediaUrl(message.media.url)}
                              controls
                              preload="none"
                              onError={() =>
                                setUnavailableMedia((current) => new Set(current).add(message.id))
                              }
                            />
                          ) : null}
                          {message.media?.type === "document" ? (
                            <a
                              href={whatsAppMediaUrl(message.media.url)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {message.media.fileName ?? "Abrir documento"}
                            </a>
                          ) : null}
                          {message.body.trim() ? <p>{message.body.trim()}</p> : null}
                          <span className="wa-message-meta">
                            {readableTime(message.sentAt) ?? ""}
                            {message.direction === "outgoing" ? (
                              <i aria-label="Mensagem enviada" />
                            ) : null}
                          </span>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
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
      {remindersOpen ? (
        <RemindersDialog
          connectionId={connection.id}
          conversations={conversations}
          {...(selected?.type === "private" ? { initialConversationId: selected.id } : {})}
          onClose={() => setRemindersOpen(false)}
        />
      ) : null}
    </main>
  );
}
