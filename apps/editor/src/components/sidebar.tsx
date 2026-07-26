"use client";

import { coreNodeDefinitions } from "@flowmind/editor-core";
import { X } from "lucide-react";
import type React from "react";

export function Sidebar({
  onClose,
  onAddNode,
}: {
  readonly onClose: () => void;
  readonly onAddNode: (type: string) => void;
}): React.ReactElement {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <span>FlowMind</span>
          <small>Alpha</small>
        </div>
        <button aria-label="Fechar biblioteca" className="panel-close" onClick={onClose} title="Fechar biblioteca" type="button">
          <X />
        </button>
      </div>
      <div className="section-title">Core</div>
      <div className="node-list">
        {coreNodeDefinitions.map((nodeDefinition) => (
          <button
            className="node-button"
            key={nodeDefinition.type}
            onClick={() => onAddNode(nodeDefinition.type)}
            type="button"
          >
            <span>{nodeDefinition.label}</span>
            <small>{nodeDefinition.description}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}
