"use client";

import type React from "react";

import { ChatPanel } from "./components/chat-panel";
import { OccurrenceList } from "./components/occurrence-list";
import { ReminderPanel } from "./components/reminder-panel";
import { useAgentsWorkspace } from "./hooks/use-agents-workspace";

export function AgentsWorkspace(): React.ReactElement {
  const workspace = useAgentsWorkspace();
  const agent = workspace.agents.find((item) => item.id === workspace.selectedAgentId);

  if (workspace.loading) {
    return <main className="loading-screen"><span className="loader" /><p>Carregando agentes...</p></main>;
  }

  if (!agent) {
    return <main className="loading-screen"><strong>CSNF indisponivel</strong><p>{workspace.feedback?.message}</p></main>;
  }

  return (
    <main className="agents-shell">
      <aside className="agent-sidebar">
        <a className="brand" href="http://localhost:3000">FlowMind <span>Alpha 0.2</span></a>
        <div className="agent-profile">
          <div className="agent-mark">C</div>
          <div><span>Agente ativo</span><h1>{agent.name}</h1><p>{agent.description}</p></div>
        </div>
        <div className="capabilities">
          {agent.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
        </div>
        <nav>
          <a className="active" href="#conversation">Conversa</a>
          <a href="#reminders">Lembretes</a>
          <a href="http://localhost:3000">Editor de workflows</a>
        </nav>
        <div className="local-note"><strong>Runtime local</strong><span>Provider fake · Persistencia JSON</span></div>
      </aside>
      <div className="agents-content">
        <header className="topbar">
          <div><span className="eyebrow">Primeiro agente nativo</span><strong>{agent.name}</strong></div>
          <span className="api-status">API conectada</span>
        </header>
        {workspace.feedback ? <div className={`feedback ${workspace.feedback.kind}`}>{workspace.feedback.message}</div> : null}
        <div className="agents-grid">
          <div id="conversation">
            <ChatPanel agentName={agent.name} messages={workspace.messages} onSend={workspace.sendMessage} sending={workspace.sending} />
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
