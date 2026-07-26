import { InvalidPayloadError } from "@flowmind/agent-core";
import type { Metadata, NodePort, Workflow, WorkflowEdge, WorkflowNode } from "@flowmind/schema";

export function parseWorkflow(value: unknown): Workflow {
  const workflow = record(value, "workflow");
  const nodes = array(workflow.nodes, "nodes").map(parseNode);
  const edges = array(workflow.edges, "edges").map(parseEdge);
  const nodeIds = new Set(nodes.map((node) => node.id));

  if (nodeIds.size !== nodes.length) invalid("node ids must be unique");
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      invalid(`edge ${edge.id} must reference existing nodes`);
    }
  }

  return {
    id: text(workflow.id, "id"),
    name: text(workflow.name, "name"),
    version: text(workflow.version, "version"),
    nodes,
    edges,
    metadata: metadata(workflow.metadata, "metadata"),
  };
}

function parseNode(value: unknown, index: number): WorkflowNode {
  const node = record(value, `nodes[${index}]`);
  const position = record(node.position, `nodes[${index}].position`);
  return {
    id: text(node.id, `nodes[${index}].id`),
    type: text(node.type, `nodes[${index}].type`),
    position: {
      x: number(position.x, `nodes[${index}].position.x`),
      y: number(position.y, `nodes[${index}].position.y`),
    },
    inputs: array(node.inputs, `nodes[${index}].inputs`).map(parsePort),
    outputs: array(node.outputs, `nodes[${index}].outputs`).map(parsePort),
    data: metadata(node.data, `nodes[${index}].data`),
    metadata: metadata(node.metadata, `nodes[${index}].metadata`),
  };
}

function parsePort(value: unknown, index: number): NodePort {
  const port = record(value, `port[${index}]`);
  return {
    id: text(port.id, `port[${index}].id`),
    label: text(port.label, `port[${index}].label`),
    metadata: metadata(port.metadata, `port[${index}].metadata`),
  };
}

function parseEdge(value: unknown, index: number): WorkflowEdge {
  const edge = record(value, `edges[${index}]`);
  return {
    id: text(edge.id, `edges[${index}].id`),
    source: text(edge.source, `edges[${index}].source`),
    target: text(edge.target, `edges[${index}].target`),
    ...(edge.sourceHandle === undefined ? {} : { sourceHandle: text(edge.sourceHandle, "sourceHandle") }),
    ...(edge.targetHandle === undefined ? {} : { targetHandle: text(edge.targetHandle, "targetHandle") }),
    metadata: metadata(edge.metadata, `edges[${index}].metadata`),
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function metadata(value: unknown, field: string): Metadata {
  return record(value, field);
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${field} must be an array`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${field} must be a non-empty string`);
  return value.trim();
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${field} must be a finite number`);
  return value;
}

function invalid(message: string): never {
  throw new InvalidPayloadError(message);
}
