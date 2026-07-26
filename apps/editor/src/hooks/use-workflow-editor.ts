"use client";

import { defaultWorkflow } from "@flowmind/editor-core";
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FlowEdge, FlowNode, GraphSnapshot } from "../types";
import {
  copySelection as createSelectionSnapshot,
  deleteSelection as removeSelection,
  duplicateSelection as duplicateSelectedGraph,
  pasteSnapshot,
  selectAll as selectAllGraph,
} from "../lib/selection";
import { createFlowNode, toFlowEdges, toFlowNodes, toWorkflow } from "../lib/workflow";

const storageKey = "flowmind.workflow";
const historyLimit = 60;

export function useWorkflowEditor() {
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(defaultWorkflow.nodes));
  const [edges, setEdges] = useState<FlowEdge[]>(() => toFlowEdges(defaultWorkflow.edges));
  const [workflowJson, setWorkflowJson] = useState(() => JSON.stringify(defaultWorkflow, null, 2));
  const [past, setPast] = useState<GraphSnapshot[]>([]);
  const [future, setFuture] = useState<GraphSnapshot[]>([]);
  const [clipboard, setClipboard] = useState<GraphSnapshot | null>(null);

  const selectedNode = useMemo(() => nodes.find((node) => node.selected) ?? nodes[1] ?? null, [nodes]);
  const workflow = useMemo(() => toWorkflow(nodes, edges), [nodes, edges]);

  const commit = useCallback((nextNodes: FlowNode[], nextEdges: FlowEdge[]) => {
    setPast((currentPast) => [...currentPast.slice(-historyLimit + 1), { nodes, edges }]);
    setFuture([]);
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [edges, nodes]);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);

    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as typeof defaultWorkflow;
      setNodes(toFlowNodes(parsed.nodes));
      setEdges(toFlowEdges(parsed.edges));
      setWorkflowJson(stored);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    const json = JSON.stringify(workflow, null, 2);
    window.localStorage.setItem(storageKey, json);
    setWorkflowJson(json);
  }, [workflow]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    commit(applyNodeChanges(changes, nodes), edges);
  }, [commit, edges, nodes]);

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    commit(nodes, applyEdgeChanges(changes, edges));
  }, [commit, edges, nodes]);

  const onConnect = useCallback((connection: Connection) => {
    const nextEdges = addEdge(
      {
        ...connection,
        id: `edge_${connection.source}_${connection.target}_${Date.now().toString(36)}`,
      },
      edges,
    );

    commit(nodes, nextEdges);
  }, [commit, edges, nodes]);

  const addNode = useCallback((type: string, position = { x: 220 + nodes.length * 34, y: 260 }) => {
    commit([...nodes, createFlowNode(type, position)], edges);
  }, [commit, edges, nodes]);

  const updateSelectedMessage = useCallback((message: string) => {
    commit(
      nodes.map((node) =>
        node.id === selectedNode?.id ? { ...node, data: { ...node.data, message } } : node,
      ),
      edges,
    );
  }, [commit, edges, nodes, selectedNode?.id]);

  const saveWorkflow = useCallback(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(workflow, null, 2));
  }, [workflow]);

  const loadWorkflowJson = useCallback((): boolean => {
    try {
      const parsed = JSON.parse(workflowJson) as typeof defaultWorkflow;
      commit(toFlowNodes(parsed.nodes), toFlowEdges(parsed.edges));
      return true;
    } catch {
      return false;
    }
  }, [commit, workflowJson]);

  const loadStoredWorkflow = useCallback((): boolean => {
    const stored = window.localStorage.getItem(storageKey);

    if (!stored) {
      return false;
    }

    setWorkflowJson(stored);
    try {
      const parsed = JSON.parse(stored) as typeof defaultWorkflow;
      commit(toFlowNodes(parsed.nodes), toFlowEdges(parsed.edges));
      return true;
    } catch {
      return false;
    }
  }, [commit]);

  const clearCanvas = useCallback(() => commit([], []), [commit]);

  const undo = useCallback(() => {
    const previous = past.at(-1);

    if (!previous) {
      return;
    }

    setFuture((currentFuture) => [{ nodes, edges }, ...currentFuture]);
    setPast((currentPast) => currentPast.slice(0, -1));
    setNodes([...previous.nodes]);
    setEdges([...previous.edges]);
  }, [edges, nodes, past]);

  const redo = useCallback(() => {
    const next = future[0];

    if (!next) {
      return;
    }

    setPast((currentPast) => [...currentPast, { nodes, edges }]);
    setFuture((currentFuture) => currentFuture.slice(1));
    setNodes([...next.nodes]);
    setEdges([...next.edges]);
  }, [edges, future, nodes]);

  const deleteSelection = useCallback(() => {
    const next = removeSelection(nodes, edges);
    commit([...next.nodes], [...next.edges]);
  }, [commit, edges, nodes]);

  const copySelection = useCallback(() => {
    setClipboard(createSelectionSnapshot(nodes, edges));
  }, [edges, nodes]);

  const pasteClipboard = useCallback(() => {
    if (!clipboard || clipboard.nodes.length === 0) {
      return;
    }

    const next = pasteSnapshot(nodes, edges, clipboard);
    commit([...next.nodes], [...next.edges]);
  }, [clipboard, commit, edges, nodes]);

  const duplicateSelection = useCallback(() => {
    if (!nodes.some((node) => node.selected)) {
      return;
    }

    const next = duplicateSelectedGraph(nodes, edges);
    commit([...next.nodes], [...next.edges]);
  }, [commit, edges, nodes]);

  const selectAll = useCallback(() => {
    const next = selectAllGraph(nodes, edges);
    commit([...next.nodes], [...next.edges]);
  }, [commit, edges, nodes]);

  const setExecutionVisualState = useCallback((
    activeNodeId: string | null,
    completedNodeIds: readonly string[],
    durations: ReadonlyMap<string, number>,
  ) => {
    const completed = new Set(completedNodeIds);
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          status: node.id === activeNodeId ? "running" : completed.has(node.id) ? "success" : "idle",
          ...(durations.has(node.id) ? { durationMs: durations.get(node.id) } : {}),
        },
      })),
    );
  }, []);

  return {
    nodes,
    edges,
    workflowJson,
    selectedNode,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    setWorkflowJson,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    updateSelectedMessage,
    saveWorkflow,
    loadWorkflowJson,
    loadStoredWorkflow,
    clearCanvas,
    undo,
    redo,
    deleteSelection,
    duplicateSelection,
    copySelection,
    pasteClipboard,
    selectAll,
    setExecutionVisualState,
  };
}
