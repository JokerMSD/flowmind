"use client";

import {
  Bug,
  Command,
  Focus,
  PanelLeft,
  PanelRight,
  Play,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import type React from "react";

export function Toolbar({
  canRedo,
  canUndo,
  isRunning,
  onCommandPalette,
  onExecute,
  onFitView,
  onRedo,
  onSave,
  onToggleDebug,
  onToggleInspector,
  onToggleSidebar,
  onUndo,
}: {
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly isRunning: boolean;
  readonly onCommandPalette: () => void;
  readonly onExecute: () => void;
  readonly onFitView: () => void;
  readonly onRedo: () => void;
  readonly onSave: () => void;
  readonly onToggleDebug: () => void;
  readonly onToggleInspector: () => void;
  readonly onToggleSidebar: () => void;
  readonly onUndo: () => void;
}): React.ReactElement {
  return (
    <header className="toolbar">
      <div className="panel-actions">
        <IconButton label="Alternar biblioteca de nodes" onClick={onToggleSidebar}>
          <PanelLeft />
        </IconButton>
        <IconButton label="Alternar Inspector" onClick={onToggleInspector}>
          <PanelRight />
        </IconButton>
      </div>
      <div className="workflow-title">
        <strong>Primeiro workflow</strong>
        <span>{"Start -> Text -> Console"}</span>
      </div>
      <div className="toolbar-actions">
        <IconButton label="Comandos (Ctrl+K)" onClick={onCommandPalette}><Command /></IconButton>
        <IconButton disabled={!canUndo} label="Desfazer (Ctrl+Z)" onClick={onUndo}><Undo2 /></IconButton>
        <IconButton disabled={!canRedo} label="Refazer (Ctrl+Y)" onClick={onRedo}><Redo2 /></IconButton>
        <IconButton label="Centralizar workflow" onClick={onFitView}><Focus /></IconButton>
        <IconButton label="Alternar debug" onClick={onToggleDebug}><Bug /></IconButton>
        <IconButton label="Salvar (Ctrl+S)" onClick={onSave}><Save /></IconButton>
        <button className="primary-action" disabled={isRunning} onClick={onExecute} type="button">
          <Play aria-hidden="true" />
          <span>{isRunning ? "Executando..." : "Executar"}</span>
        </button>
      </div>
    </header>
  );
}

function IconButton({
  children,
  disabled = false,
  label,
  onClick,
}: {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): React.ReactElement {
  return (
    <button aria-label={label} className="icon-button" disabled={disabled} onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}
