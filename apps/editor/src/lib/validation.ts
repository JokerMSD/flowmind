import type { FlowEdge, FlowNode, ValidationIssue } from "../types";

export function validateGraph(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const startNodes = nodes.filter((node) => node.data.label === "Start");

  if (startNodes.length === 0) {
    issues.push(createIssue("missing-start", "error", "Workflow sem Start."));
  }

  if (startNodes.length > 1) {
    issues.push(createIssue("multiple-start", "warning", "Mais de um Start encontrado."));
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push(createIssue(`invalid-edge-${edge.id}`, "error", "Conexao invalida."));
    }
  }

  const reachable = collectReachable(startNodes[0]?.id, edges);

  for (const node of nodes) {
    const hasConnection = edges.some((edge) => edge.source === node.id || edge.target === node.id);

    if (!hasConnection && nodes.length > 1) {
      issues.push(createIssue(`isolated-${node.id}`, "warning", "Node sem conexao.", node.id));
    }

    if (startNodes.length > 0 && !reachable.has(node.id)) {
      issues.push(createIssue(`unreachable-${node.id}`, "warning", "Node inalcançavel.", node.id));
    }
  }

  return issues;
}

export function applyValidationWarnings(nodes: readonly FlowNode[], issues: readonly ValidationIssue[]): FlowNode[] {
  return nodes.map((node) => {
    const nodeIssue = issues.find((issue) => issue.nodeId === node.id);

    return {
      ...node,
      data: {
        ...node.data,
        ...(nodeIssue ? { warning: nodeIssue.message } : { warning: undefined }),
      },
    };
  });
}

function collectReachable(startNodeId: string | undefined, edges: readonly FlowEdge[]): Set<string> {
  const reachable = new Set<string>();

  if (!startNodeId) {
    return reachable;
  }

  let currentNodeId: string | undefined = startNodeId;

  while (currentNodeId && !reachable.has(currentNodeId)) {
    reachable.add(currentNodeId);
    currentNodeId = edges.find((edge) => edge.source === currentNodeId)?.target;
  }

  return reachable;
}

function createIssue(
  id: string,
  severity: ValidationIssue["severity"],
  message: string,
  nodeId?: string,
): ValidationIssue {
  return {
    id,
    severity,
    message,
    ...(nodeId ? { nodeId } : {}),
  };
}
