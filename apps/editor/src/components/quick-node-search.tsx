"use client";

import { coreNodeDefinitions } from "@flowmind/editor-core";
import type React from "react";
import { useMemo, useState } from "react";

export function QuickNodeSearch({
  open,
  position,
  onClose,
  onSelect,
}: {
  readonly open: boolean;
  readonly position: { readonly x: number; readonly y: number };
  readonly onClose: () => void;
  readonly onSelect: (type: string) => void;
}): React.ReactElement | null {
  const [query, setQuery] = useState("");
  const nodes = useMemo(
    () => coreNodeDefinitions.filter((node) => node.label.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  if (!open) {
    return null;
  }

  return (
    <div className="quick-node" style={{ left: position.x, top: position.y }}>
      <input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar Node..." value={query} />
      <div className="quick-node-list">
        {nodes.map((node) => (
          <button
            key={node.type}
            onClick={() => {
              onSelect(node.type);
              onClose();
            }}
            type="button"
          >
            <span>{node.label}</span>
            <small>{node.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
