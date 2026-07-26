import { createWorkflowEdge, createWorkflowNode, getNodeLabel } from "@flowmind/editor-core";
import type { Workflow, WorkflowNode } from "@flowmind/schema";
import { Position } from "@xyflow/react";

import type { FlowEdge, FlowNode } from "../types";

export function toFlowNodes(workflowNodes: readonly WorkflowNode[]): FlowNode[] {
  return workflowNodes.map((node) => ({
    id: node.id,
    type: "flowmind",
    position: node.position,
    data: {
      label: getNodeLabel(node.type),
      ...(typeof node.data.message === "string" ? { message: node.data.message } : {}),
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));
}

export function toFlowEdges(workflowEdges: Workflow["edges"]): FlowEdge[] {
  return workflowEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
  }));
}

export function toWorkflow(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Workflow {
  return {
    id: "workflow_current",
    name: "Primeiro workflow",
    version: "0.1.0",
    nodes: nodes.map((node) =>
      createWorkflowNode(
        node.id,
        nodeTypeFromLabel(node.data.label),
        node.position,
        node.data.message ? { message: node.data.message } : {},
      ),
    ),
    edges: edges.map((edge) => createWorkflowEdge(edge.id, edge.source, edge.target)),
    metadata: {},
  };
}

export function createFlowNode(type: string, position: { readonly x: number; readonly y: number }): FlowNode {
  const label = getNodeLabel(type);

  return {
    id: `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    type: "flowmind",
    position,
    data: {
      label,
      ...(type === "core.text" ? { message: "Ol\u00e1 FlowMind" } : {}),
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  };
}

export function nodeTypeFromLabel(label: string): string {
  if (label === "Start") {
    return "core.start";
  }

  if (label === "Text") {
    return "core.text";
  }

  if (label === "Console") {
    return "core.console";
  }

  return label;
}
