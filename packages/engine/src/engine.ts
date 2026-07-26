import type {
  EngineContext,
  ExecutionContext,
  ExecutionLog,
  ExecutionLogWriter,
  JsonObject,
  NodeExecutionRecord,
  NodeRegistry,
  Workflow,
  WorkflowEdge,
  WorkflowExecutionResult,
  WorkflowNode,
  WorkflowNodeId,
} from "@flowmind/schema";

export interface EngineOptions {
  readonly registry: NodeRegistry;
}

export class Engine {
  private readonly registry: NodeRegistry;

  constructor(options: EngineOptions) {
    this.registry = options.registry;
  }

  getRegistry(): NodeRegistry {
    return this.registry;
  }

  createContext(context: EngineContext): EngineContext {
    return context;
  }

  async execute(workflow: Workflow, input: JsonObject = {}): Promise<WorkflowExecutionResult> {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const execution: ExecutionContext = {
      id: createExecutionId(),
      input,
      metadata: {},
    };
    const logs: ExecutionLog[] = [];
    const nodeResults: NodeExecutionRecord[] = [];
    const orderedNodes = resolveSequentialNodes(workflow);
    let currentInput: JsonObject = input;

    for (const node of orderedNodes) {
      const registeredNode = this.registry.get(node.type);

      if (!registeredNode) {
        throw new Error(`Node executor not registered: ${node.type}`);
      }

      const nodeStartedAtDate = new Date();
      const nodeLogs = createNodeLogWriter(logs, node.id);
      const result = await registeredNode.executor.execute({
        workflow,
        execution,
        node,
        input: currentInput,
        logs: nodeLogs,
      });
      const nodeFinishedAtDate = new Date();

      nodeResults.push({
        nodeId: node.id,
        nodeType: node.type,
        startedAt: nodeStartedAtDate.toISOString(),
        finishedAt: nodeFinishedAtDate.toISOString(),
        durationMs: nodeFinishedAtDate.getTime() - nodeStartedAtDate.getTime(),
        input: currentInput,
        result,
      });

      currentInput = result.output;
    }

    const finishedAtDate = new Date();

    return {
      executionId: execution.id,
      status: "completed",
      output: currentInput,
      logs,
      nodeResults,
      startedAt,
      finishedAt: finishedAtDate.toISOString(),
      durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
    };
  }
}

function resolveSequentialNodes(workflow: Workflow): WorkflowNode[] {
  const nodesById = new Map<WorkflowNodeId, WorkflowNode>();

  for (const node of workflow.nodes) {
    nodesById.set(node.id, node);
  }

  const startNode = workflow.nodes.find((node) => node.type === "core.start") ?? findSourceNode(workflow);

  if (!startNode) {
    throw new Error("Workflow must contain at least one node.");
  }

  const orderedNodes: WorkflowNode[] = [];
  const visited = new Set<WorkflowNodeId>();
  let currentNode: WorkflowNode | undefined = startNode;

  while (currentNode) {
    if (visited.has(currentNode.id)) {
      throw new Error(`Loops are not supported yet. Repeated node: ${currentNode.id}`);
    }

    visited.add(currentNode.id);
    orderedNodes.push(currentNode);

    const nextEdge = workflow.edges.find((edge) => edge.source === currentNode?.id);
    currentNode = nextEdge ? nodesById.get(nextEdge.target) : undefined;
  }

  return orderedNodes;
}

function findSourceNode(workflow: Workflow): WorkflowNode | undefined {
  const targetedNodeIds = new Set(workflow.edges.map((edge: WorkflowEdge) => edge.target));
  return workflow.nodes.find((node) => !targetedNodeIds.has(node.id));
}

function createNodeLogWriter(logs: ExecutionLog[], nodeId: WorkflowNodeId): ExecutionLogWriter {
  const write = (level: ExecutionLog["level"], message: string, data: JsonObject = {}): void => {
    logs.push({
      nodeId,
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  };

  return {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
  };
}

function createExecutionId(): string {
  return `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
