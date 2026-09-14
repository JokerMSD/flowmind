"use client";

import type React from "react";
import { useState } from "react";

import { ChatPanel } from "./components/chat-panel";
import { OccurrenceList } from "./components/occurrence-list";
import { ReminderPanel } from "./components/reminder-panel";
import { useAgentsWorkspace } from "./hooks/use-agents-workspace";

export function AgentsWorkspace(): React.ReactElement {
  const workspace = useAgentsWorkspace();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const agent = workspace.agents.find((item) => item.id === workspace.selectedAgentId);

  if (workspace.loading) {
    return (
      <main className="loading-screen">
        <span className="loader" />
        <p>Carregando agentes...</p>
      </main>
    );
  }

  if (workspace.authenticated === false) {
    const submit = async (event: React.FormEvent) => {
      event.preventDefault();
      setSigningIn(true);
      await workspace.login(email, password);
      setSigningIn(false);
    };
    return (
      <main className="account-login">
        <form onSubmit={submit}>
          <span className="eyebrow">FlowMind</span>
          <h1>Entrar na sua conta</h1>
          <p>Acesse o CSNF, lembretes e configurações do agente.</p>
          <label>
            E-mail
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Senha
            <input
              autoComplete="current-password"
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {workspace.feedback ? (
            <div className="login-error" role="alert">
              {workspace.feedback.message}
            </div>
          ) : null}
          <button disabled={signingIn} type="submit">
            {signingIn ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </main>
    );
  }

  if (!agent) {
    return (
      <main className="loading-screen">
        <strong>CSNF indisponivel</strong>
        <p>{workspace.feedback?.message}</p>
      </main>
    );
  }

  return (
    <main className="agents-shell">
      <aside className="agent-sidebar">
        <a className="brand" href="http://localhost:3000">
          FlowMind <span>Alpha 0.2</span>
        </a>
        <div className="agent-profile">
          <div className="agent-mark">C</div>
          <div>
            <span>Agente ativo</span>
            <h1>{agent.name}</h1>
            <p>{agent.description}</p>
          </div>
        </div>
        <div className="capabilities">
          {agent.capabilities.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
        </div>
        <nav>
          <a className="active" href="#conversation">
            Conversa
          </a>
          <a href="#reminders">Lembretes</a>
          <a href="http://localhost:3000">Editor de workflows</a>
        </nav>
        <div className="local-note">
          <strong>IA local</strong>
          <span>
            {providerLabel(agent.conversationProvider, agent.aiModel.model)} · Persistencia JSON
          </span>
        </div>
      </aside>
      <div className="agents-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">Primeiro agente nativo</span>
            <strong>{agent.name}</strong>
          </div>
          <span className={`api-status ${workspace.apiConnected ? "online" : "offline"}`}>
            {workspace.apiConnected ? "API conectada" : "API indisponivel"}
          </span>
        </header>
        {workspace.feedback ? (
          <div className={`feedback ${workspace.feedback.kind}`}>{workspace.feedback.message}</div>
        ) : null}
        {workspace.occurrencePollingError ? (
          <p className="polling-error" role="status">
            Ocorrencias nao atualizadas. Nova tentativa no proximo ciclo.
          </p>
        ) : null}
        <div className="agents-grid">
          <div id="conversation">
            <ChatPanel
              agentName={agent.name}
              providerLabel={providerLabel(agent.conversationProvider, agent.aiModel.model)}
              connected={workspace.apiConnected && agent.enabled}
              messages={workspace.messages}
              onSend={workspace.sendMessage}
              sending={workspace.sending}
            />
          </div>
          <div className="automation-column" id="reminders">
            <ReminderPanel
              agentId={agent.id}
              onDelete={workspace.deleteReminder}
              onSave={workspace.saveReminder}
              onToggle={workspace.toggleReminder}
              reminders={workspace.reminders}
            />
            <OccurrenceList occurrences={workspace.occurrences} />
          </div>
        </div>
      </div>
    </main>
  );
}

function providerLabel(provider: string, model: string): string {
  if (provider !== "ollama") return "Provider de contingencia";
  return model.startsWith("gemma4") ? "Gemma 4 via Ollama" : `${model} via Ollama`;
}
