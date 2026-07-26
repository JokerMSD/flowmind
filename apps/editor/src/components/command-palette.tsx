"use client";

import { coreNodeDefinitions } from "@flowmind/editor-core";
import type React from "react";
import { useMemo, useState } from "react";

import type { EditorCommand } from "../types";

export function CommandPalette({
  open,
  onClose,
  onRun,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onRun: (command: EditorCommand) => void;
}): React.ReactElement | null {
  const [query, setQuery] = useState("");
  const commands = useMemo(() => buildCommands().filter((command) => command.label.toLowerCase().includes(query.toLowerCase())), [query]);

  if (!open) {
    return null;
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar comando..." value={query} />
        <div className="palette-list">
          {commands.map((command) => (
            <button
              key={command.id}
              onClick={() => {
                onRun(command.id);
                onClose();
              }}
              type="button"
            >
              <span>{command.label}</span>
              <small>{command.group}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildCommands(): readonly { readonly id: EditorCommand; readonly label: string; readonly group: string }[] {
  return [
    { id: "execute", label: "Executar Workflow", group: "Workflow" },
    { id: "save", label: "Salvar Workflow", group: "Workflow" },
    { id: "open", label: "Abrir Workflow", group: "Workflow" },
    { id: "clear", label: "Limpar Canvas", group: "Canvas" },
    ...coreNodeDefinitions.map((node) => ({
      id: `add:${node.type}` as EditorCommand,
      label: `Criar ${node.label}`,
      group: node.category,
    })),
  ];
}
