const workflow = {
  id: "workflow_default",
  name: "Primeiro workflow",
  version: "0.1.0",
  nodes: [
    node("node_start", "core.start", 80, 140),
    node("node_text", "core.text", 340, 140, { message: "Ol\u00e1 FlowMind" }),
    node("node_console", "core.console", 620, 140),
  ],
  edges: [
    edge("edge_start_text", "node_start", "node_text"),
    edge("edge_text_console", "node_text", "node_console"),
  ],
  metadata: {},
};

const response = await fetch("http://127.0.0.1:3001/api/execute", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(workflow),
});

if (!response.ok) {
  throw new Error(`Smoke test failed: ${response.status}`);
}

const result = await response.json();

if (result.output?.text !== "Ol\u00e1 FlowMind") {
  throw new Error(`Unexpected output: ${JSON.stringify(result.output)}`);
}

console.log(result.output.text);

function node(id, type, x, y, data = {}) {
  return {
    id,
    type,
    position: { x, y },
    inputs: type === "core.start" ? [] : [{ id: "input", label: "In", metadata: {} }],
    outputs: type === "core.console" ? [] : [{ id: "output", label: "Out", metadata: {} }],
    data,
    metadata: {},
  };
}

function edge(id, source, target) {
  return {
    id,
    source,
    target,
    sourceHandle: "output",
    targetHandle: "input",
    metadata: {},
  };
}
