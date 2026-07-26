"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowExecutionResult } from "@flowmind/schema";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CommandPalette } from "./components/command-palette";
import { DebugPanel } from "./components/debug-panel";
import { FlowMindNode } from "./components/flow-node";
import { Inspector } from "./components/inspector";
import { QuickNodeSearch } from "./components/quick-node-search";
import { Sidebar } from "./components/sidebar";
import { Toolbar } from "./components/toolbar";
import { useEditorShortcuts } from "./hooks/use-editor-shortcuts";
import { useWorkflowEditor } from "./hooks/use-workflow-editor";
import { applyValidationWarnings, validateGraph } from "./lib/validation";
import { toWorkflow } from "./lib/workflow";
import type { EditorCommand, EditorExecution } from "./types";

const apiUrl = process.env.NEXT_PUBLIC_FLOWMIND_API_URL ?? "http://localhost:3001";
const nodeTypes: NodeTypes = { flowmind: FlowMindNode };

export function FlowEditor(): React.ReactElement {
  return (
    <ReactFlowProvider>
      <FlowEditorInner />
    </ReactFlowProvider>
  );
}

function FlowEditorInner(): React.ReactElement {
  const editor = useWorkflowEditor();
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [quickSearch, setQuickSearch] = useState<{ open: boolean; x: number; y: number; flowX: number; flowY: number }>({
    open: false,
    x: 0,
    y: 0,
    flowX: 0,
    flowY: 0,
  });
  const [execution, setExecution] = useState<EditorExecution>({
    result: null,
    activeNodeId: null,
    completedNodeIds: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const hasRoomForPanels = window.innerWidth > 1100;
    setSidebarOpen(hasRoomForPanels);
    setInspectorOpen(hasRoomForPanels);
  }, []);

  useEffect(() => {
    if (!nodesInitialized || editor.nodes.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void reactFlow.fitView({ duration: 180, maxZoom: 1, padding: 0.18 });
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editor.nodes.length, inspectorOpen, nodesInitialized, reactFlow, sidebarOpen]);

  const workflow = useMemo(() => toWorkflow(editor.nodes, editor.edges), [editor.edges, editor.nodes]);
  const issues = useMemo(() => validateGraph(editor.nodes, editor.edges), [editor.edges, editor.nodes]);
  const displayNodes = useMemo(() => applyValidationWarnings(editor.nodes, issues), [editor.nodes, issues]);
  const displayEdges = useMemo(
    () => editor.edges.map((edge) => ({ ...edge, animated: isRunning || isExecutedEdge(edge, execution.completedNodeIds) })),
    [editor.edges, execution.completedNodeIds, isRunning],
  );

  const runWorkflow = useCallback(async () => {
    setDebugExpanded(true);
    setIsRunning(true);
    setError(null);
    editor.setExecutionVisualState(null, [], new Map());

    try {
      const response = await fetch(`${apiUrl}/api/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflow),
      });

      if (!response.ok) {
        throw new Error(`Falha ao executar: ${response.status}`);
      }

      const result = (await response.json()) as WorkflowExecutionResult;
      await replayExecution(result, setExecution, editor.setExecutionVisualState);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Falha ao executar workflow.");
    } finally {
      setIsRunning(false);
    }
  }, [editor, workflow]);

  const runCommand = useCallback((command: EditorCommand) => {
    if (command === "execute") {
      void runWorkflow();
      return;
    }

    if (command === "save") {
      editor.saveWorkflow();
      return;
    }

    if (command === "open") {
      setError(editor.loadStoredWorkflow() ? null : "Nenhum workflow salvo localmente.");
      return;
    }

    if (command === "clear") {
      editor.clearCanvas();
      return;
    }

    editor.addNode(command.replace("add:", ""));
  }, [editor, runWorkflow]);

  useEditorShortcuts({
    onCommandPalette: () => setPaletteOpen(true),
    onCopy: editor.copySelection,
    onDelete: editor.deleteSelection,
    onDuplicate: editor.duplicateSelection,
    onPaste: editor.pasteClipboard,
    onRedo: editor.redo,
    onSave: editor.saveWorkflow,
    onSelectAll: editor.selectAll,
    onUndo: editor.undo,
  });

  return (
    <main className={`app-shell ${sidebarOpen ? "sidebar-open" : ""} ${inspectorOpen ? "inspector-open" : ""}`}>
      {sidebarOpen ? <Sidebar onAddNode={editor.addNode} onClose={() => setSidebarOpen(false)} /> : null}
      <section className="workspace">
        <Toolbar
          canRedo={editor.canRedo}
          canUndo={editor.canUndo}
          isRunning={isRunning}
          onCommandPalette={() => setPaletteOpen(true)}
          onExecute={runWorkflow}
          onFitView={() => reactFlow.fitView({ duration: 400, padding: 0.2 })}
          onRedo={editor.redo}
          onSave={editor.saveWorkflow}
          onToggleDebug={() => setDebugExpanded((open) => !open)}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onUndo={editor.undo}
        />
        <div
          className="canvas"
          onDoubleClick={(event) => {
            const target = event.target;

            if (!(target instanceof HTMLElement) || !target.classList.contains("react-flow__pane")) {
              return;
            }

            const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            setQuickSearch({ open: true, x: event.clientX, y: event.clientY, flowX: position.x, flowY: position.y });
          }}
        >
          <ReactFlow
            deleteKeyCode={null}
            edges={displayEdges}
            maxZoom={1.4}
            minZoom={0.25}
            nodeTypes={nodeTypes}
            nodes={displayNodes}
            onConnect={editor.onConnect}
            onEdgesChange={editor.onEdgesChange}
            onNodesChange={editor.onNodesChange}
            snapGrid={[16, 16]}
            snapToGrid
          >
            <Background gap={16} />
            <MiniMap bgColor="#11151c" maskColor="rgb(8 10 14 / 72%)" nodeColor="#3a4554" pannable zoomable />
            <Controls />
          </ReactFlow>
          <QuickNodeSearch
            onClose={() => setQuickSearch((state) => ({ ...state, open: false }))}
            onSelect={(type) => editor.addNode(type, { x: quickSearch.flowX, y: quickSearch.flowY })}
            open={quickSearch.open}
            position={{ x: quickSearch.x, y: quickSearch.y }}
          />
        </div>
        <DebugPanel
          error={error}
          execution={execution}
          expanded={debugExpanded}
          onToggle={() => setDebugExpanded((open) => !open)}
        />
      </section>
      {inspectorOpen ? <Inspector
        issues={issues}
        onClose={() => setInspectorOpen(false)}
        onJsonChange={editor.setWorkflowJson}
        onLoadJson={() => setError(editor.loadWorkflowJson() ? null : "JSON invalido.")}
        onUpdateMessage={editor.updateSelectedMessage}
        selectedNode={editor.selectedNode}
        workflowJson={editor.workflowJson}
      /> : null}
      <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} open={paletteOpen} />
    </main>
  );
}

async function replayExecution(
  result: WorkflowExecutionResult,
  setExecution: (execution: EditorExecution) => void,
  setVisualState: (activeNodeId: string | null, completedNodeIds: readonly string[], durations: ReadonlyMap<string, number>) => void,
): Promise<void> {
  const completed: string[] = [];
  const durations = new Map<string, number>();

  for (const record of result.nodeResults) {
    setExecution({ result, activeNodeId: record.nodeId, completedNodeIds: completed });
    setVisualState(record.nodeId, completed, durations);
    await delay(160);
    completed.push(record.nodeId);
    durations.set(record.nodeId, record.durationMs);
  }

  setExecution({ result, activeNodeId: null, completedNodeIds: completed });
  setVisualState(null, completed, durations);
}

function isExecutedEdge(edge: Edge, completedNodeIds: readonly string[]): boolean {
  return completedNodeIds.includes(edge.source) && completedNodeIds.includes(edge.target);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
