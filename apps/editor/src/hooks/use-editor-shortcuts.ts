"use client";

import { useEffect } from "react";

export interface EditorShortcutHandlers {
  readonly onCommandPalette: () => void;
  readonly onCopy: () => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onPaste: () => void;
  readonly onRedo: () => void;
  readonly onSave: () => void;
  readonly onSelectAll: () => void;
  readonly onUndo: () => void;
}

export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if (event.key === "Delete" && !isTyping) {
        event.preventDefault();
        handlers.onDelete();
        return;
      }

      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "k") {
        event.preventDefault();
        handlers.onCommandPalette();
        return;
      }

      if (isTyping && key !== "s") {
        return;
      }

      const command = shortcuts[key];

      if (!command) {
        return;
      }

      event.preventDefault();
      command(handlers);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}

const shortcuts: Record<string, (handlers: EditorShortcutHandlers) => void> = {
  a: (handlers) => handlers.onSelectAll(),
  c: (handlers) => handlers.onCopy(),
  d: (handlers) => handlers.onDuplicate(),
  s: (handlers) => handlers.onSave(),
  v: (handlers) => handlers.onPaste(),
  y: (handlers) => handlers.onRedo(),
  z: (handlers) => handlers.onUndo(),
};
