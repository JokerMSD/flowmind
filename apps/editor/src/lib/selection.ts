import type { FlowEdge, FlowNode, GraphSnapshot } from "../types";

export function deleteSelection(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): GraphSnapshot {
  const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));

  return {
    nodes: nodes.filter((node) => !selectedNodeIds.has(node.id)),
    edges: edges.filter(
      (edge) => !edge.selected && !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target),
    ),
  };
}

export function copySelection(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): GraphSnapshot {
  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedIds = new Set(selectedNodes.map((node) => node.id));

  return {
    nodes: selectedNodes,
    edges: edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)),
  };
}

export function pasteSnapshot(nodes: readonly FlowNode[], edges: readonly FlowEdge[], snapshot: GraphSnapshot): GraphSnapshot {
  const idMap = new Map<string, string>();
  const pastedNodes = snapshot.nodes.map((node) => {
    const id = createNodeId();
    idMap.set(node.id, id);

    return {
      ...node,
      id,
      selected: true,
      position: { x: node.position.x + 36, y: node.position.y + 36 },
    };
  });
  const pastedEdges = snapshot.edges.flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);

    return source && target ? [{ ...edge, id: `edge_${source}_${target}`, source, target }] : [];
  });

  return {
    nodes: nodes.map((node) => ({ ...node, selected: false })).concat(pastedNodes),
    edges: edges.concat(pastedEdges),
  };
}

export function duplicateSelection(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): GraphSnapshot {
  return pasteSnapshot(nodes, edges, copySelection(nodes, edges));
}

export function selectAll(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): GraphSnapshot {
  return {
    nodes: nodes.map((node) => ({ ...node, selected: true })),
    edges: edges.map((edge) => ({ ...edge, selected: true })),
  };
}

function createNodeId(): string {
  return `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
}
