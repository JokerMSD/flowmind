export interface EditorNodeDefinition {
  readonly type: string;
  readonly label: string;
  readonly category: "Core";
  readonly description: string;
}

export const coreNodeDefinitions: readonly EditorNodeDefinition[] = [
  {
    type: "core.start",
    label: "Start",
    category: "Core",
    description: "Inicio do workflow.",
  },
  {
    type: "core.text",
    label: "Text",
    category: "Core",
    description: "Gera uma mensagem de texto.",
  },
  {
    type: "core.console",
    label: "Console",
    category: "Core",
    description: "Mostra a entrada no console visual.",
  },
];

export function getNodeLabel(type: string): string {
  return coreNodeDefinitions.find((node) => node.type === type)?.label ?? type;
}
