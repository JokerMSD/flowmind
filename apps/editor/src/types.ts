import type { Edge, Node } from "@xyflow/react";
import type { WorkflowExecutionResult } from "@flowmind/schema";

export type FlowNodeData = {
  [key: string]: unknown;
  label: string;
  message?: string | undefined;
  status?: "idle" | "running" | "success" | "error";
  durationMs?: number | undefined;
  warning?: string | undefined;
};

export type FlowNode = Node<FlowNodeData>;
export type FlowEdge = Edge;

export type GraphSnapshot = {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
};

export type EditorCommand =
  | "execute"
  | "save"
  | "open"
  | "clear"
  | "add:core.start"
  | "add:core.text"
  | "add:core.console";

export type ValidationIssue = {
  readonly id: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly nodeId?: string;
};

export type EditorExecution = {
  readonly result: WorkflowExecutionResult | null;
  readonly activeNodeId: string | null;
  readonly completedNodeIds: readonly string[];
};
