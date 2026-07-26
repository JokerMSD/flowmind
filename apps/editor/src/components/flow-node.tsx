"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type React from "react";

import type { FlowNode } from "../types";

export function FlowMindNode(props: NodeProps<FlowNode>): React.ReactElement {
  const isStart = props.data.label === "Start";
  const isConsole = props.data.label === "Console";
  const status = props.data.status ?? "idle";

  return (
    <div className={`flow-node ${props.selected ? "selected" : ""} ${status}`}>
      {!isStart ? <Handle className="target-handle" id="input" position={Position.Left} type="target" /> : null}
      <div className="node-header">
        <strong>{props.data.label}</strong>
        {props.data.warning ? <span className="node-warning">!</span> : null}
      </div>
      <span>{props.data.message ?? nodeDescription(props.data.label)}</span>
      {typeof props.data.durationMs === "number" ? (
        <small className="node-duration">{props.data.durationMs}ms</small>
      ) : null}
      {!isConsole ? <Handle className="source-handle" id="output" position={Position.Right} type="source" /> : null}
    </div>
  );
}

function nodeDescription(label: string): string {
  if (label === "Start") {
    return "Inicio";
  }

  if (label === "Console") {
    return "Saida visual";
  }

  return "";
}
