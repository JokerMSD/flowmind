import type { Workflow, WorkflowEdge, WorkflowNode } from "@flowmind/schema";

export const defaultWorkflow: Workflow = {
  id: "workflow_default",
  name: "Primeiro workflow",
  version: "0.1.0",
  nodes: [
    createWorkflowNode("node_start", "core.start", { x: 80, y: 140 }),
    createWorkflowNode("node_text", "core.text", { x: 340, y: 140 }, { message: "Olá FlowMind" }),
    createWorkflowNode("node_console", "core.console", { x: 620, y: 140 }),
  ],
  edges: [
    createWorkflowEdge("edge_start_text", "node_start", "node_text"),
    createWorkflowEdge("edge_text_console", "node_text", "node_console"),
  ],
  metadata: {},
};

export function createWorkflowNode(
  id: string,
  type: string,
  position: { readonly x: number; readonly y: number },
  data: Record<string, unknown> = {},
): WorkflowNode {
  return {
    id,
    type,
    position,
    inputs: type === "core.start" ? [] : [{ id: "input", label: "In", metadata: {} }],
    outputs: type === "core.console" ? [] : [{ id: "output", label: "Out", metadata: {} }],
    data,
    metadata: {},
  };
}

export function createWorkflowEdge(id: string, source: string, target: string): WorkflowEdge {
  return {
    id,
    source,
    target,
    sourceHandle: "output",
    targetHandle: "input",
    metadata: {},
  };
}
