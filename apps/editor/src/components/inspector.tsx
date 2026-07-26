"use client";

import type React from "react";
import { useState } from "react";
import { Braces, Settings2, X } from "lucide-react";

import type { FlowNode, ValidationIssue } from "../types";

export function Inspector({
  issues,
  selectedNode,
  workflowJson,
  onJsonChange,
  onClose,
  onLoadJson,
  onUpdateMessage,
}: {
  readonly issues: readonly ValidationIssue[];
  readonly selectedNode: FlowNode | null;
  readonly workflowJson: string;
  readonly onJsonChange: (json: string) => void;
  readonly onClose: () => void;
  readonly onLoadJson: () => void;
  readonly onUpdateMessage: (message: string) => void;
}): React.ReactElement {
  const [activeTab, setActiveTab] = useState<"settings" | "json">("settings");

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <div>
          <div className="section-title">Inspector</div>
          <strong>{selectedNode?.data.label ?? "Workflow"}</strong>
        </div>
        <button aria-label="Fechar Inspector" className="panel-close" onClick={onClose} title="Fechar Inspector" type="button">
          <X />
        </button>
      </div>
      <div className="inspector-tabs" role="tablist">
        <button
          aria-selected={activeTab === "settings"}
          className={activeTab === "settings" ? "active" : ""}
          onClick={() => setActiveTab("settings")}
          role="tab"
          type="button"
        >
          <Settings2 /> Configuracao
        </button>
        <button
          aria-selected={activeTab === "json"}
          className={activeTab === "json" ? "active" : ""}
          onClick={() => setActiveTab("json")}
          role="tab"
          type="button"
        >
          <Braces /> JSON
        </button>
      </div>

      {activeTab === "settings" ? (
        <div className="inspector-body">
          {selectedNode ? (
            <div className="inspector-content">
              <label>
                Tipo
                <input readOnly value={selectedNode.data.label} />
              </label>
              {selectedNode.data.label === "Text" ? (
                <label>
                  Mensagem
                  <input
                    onChange={(event) => onUpdateMessage(event.target.value)}
                    value={selectedNode.data.message ?? ""}
                  />
                </label>
              ) : (
                <p className="muted">Este node nao possui configuracao nesta etapa.</p>
              )}
              {selectedNode.data.warning ? <p className="warning-copy">{selectedNode.data.warning}</p> : null}
            </div>
          ) : (
            <p className="muted">Selecione um node para editar suas propriedades.</p>
          )}

          <div className="inspector-section">
            <div className="section-title">Validacao</div>
            <div className="issue-list">
              {issues.length === 0 ? <p className="muted">Workflow valido. Sem avisos.</p> : null}
              {issues.map((issue) => (
                <div className={`issue ${issue.severity}`} key={issue.id}>{issue.message}</div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="json-panel">
          <p className="muted">Representacao portavel do workflow.</p>
          <textarea className="json-editor" onChange={(event) => onJsonChange(event.target.value)} value={workflowJson} />
          <button className="load-json" onClick={onLoadJson} type="button">Carregar JSON</button>
        </div>
      )}
    </aside>
  );
}
