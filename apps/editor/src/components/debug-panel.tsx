"use client";

import type React from "react";
import { ChevronDown, ChevronUp, Terminal } from "lucide-react";

import { readExecutionText } from "../lib/execution";
import type { EditorExecution } from "../types";

export function DebugPanel({
  error,
  execution,
  expanded,
  onToggle,
}: {
  readonly error: string | null;
  readonly execution: EditorExecution;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}): React.ReactElement {
  const result = execution.result;

  return (
    <section className={`debug-panel ${expanded ? "expanded" : "collapsed"}`}>
      <button aria-expanded={expanded} className="debug-toggle" onClick={onToggle} type="button">
        <span><Terminal /> Console</span>
        <span className="debug-toggle-summary">
          <strong>{result?.status ?? "idle"}</strong>
          <span>{readExecutionText(result)}</span>
          {expanded ? <ChevronDown /> : <ChevronUp />}
        </span>
      </button>
      {expanded ? (
        <div className="debug-content">
      <div className="debug-summary">
        <Metric label="Status" value={result?.status ?? "idle"} />
        <Metric label="Node atual" value={execution.activeNodeId ?? result?.nodeResults.at(-1)?.nodeId ?? "-"} />
        <Metric label="Tempo" value={result ? `${result.durationMs}ms` : "-"} />
        <Metric label="Resultado" value={readExecutionText(result)} />
      </div>
      <div className="debug-table">
        <div className="debug-row head">
          <span>Node</span>
          <span>Status</span>
          <span>Tempo</span>
          <span>Entrada</span>
          <span>Saida</span>
        </div>
        {result?.nodeResults.map((record) => (
          <div className="debug-row" key={`${result.executionId}_${record.nodeId}`}>
            <span>{record.nodeId}</span>
            <span>ok</span>
            <span>{record.durationMs}ms</span>
            <code>{JSON.stringify(record.input)}</code>
            <code>{JSON.stringify(record.result.output)}</code>
          </div>
        )) ?? <div className="empty-log">Execute o workflow para ver o debug.</div>}
        {error ? <div className="error-line">{error}</div> : null}
      </div>
      <div className="log-list">
        {result?.logs.map((log) => (
          <div className="log-line" key={`${log.timestamp}_${log.nodeId}_${log.message}`}>
            <span>{log.nodeId ?? "workflow"}</span>
            <p>{log.message}</p>
          </div>
        ))}
      </div>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): React.ReactElement {
  return (
    <div className="debug-column">
      <span className="label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
