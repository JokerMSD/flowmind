export type Version = string;
export type Metadata = Record<string, unknown>;
export type VariableName = string;
export type SecretName = string;
export type JsonObject = Record<string, unknown>;

export interface Variable {
  readonly name: VariableName;
  readonly value: unknown;
  readonly metadata: Metadata;
}

export interface Secret {
  readonly name: SecretName;
  readonly provider: string;
  readonly metadata: Metadata;
}

export type WorkflowId = string;
export type WorkflowNodeId = string;
export type WorkflowEdgeId = string;
export type NodeType = string;
export type NodePortId = string;

export interface Workflow {
  readonly id: WorkflowId;
  readonly name: string;
  readonly version: Version;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly metadata: Metadata;
}

export interface WorkflowNode {
  readonly id: WorkflowNodeId;
  readonly type: NodeType;
  readonly position: NodePosition;
  readonly inputs: readonly NodePort[];
  readonly outputs: readonly NodePort[];
  readonly data: JsonObject;
  readonly metadata: Metadata;
}

export interface WorkflowEdge {
  readonly id: WorkflowEdgeId;
  readonly source: WorkflowNodeId;
  readonly target: WorkflowNodeId;
  readonly sourceHandle?: NodePortId;
  readonly targetHandle?: NodePortId;
  readonly metadata: Metadata;
}

export interface NodePosition {
  readonly x: number;
  readonly y: number;
}

export interface NodePort {
  readonly id: NodePortId;
  readonly label: string;
  readonly metadata: Metadata;
}

export interface Tool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly metadata: Metadata;
}

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: Version;
  readonly tools: readonly Tool[];
  readonly metadata: Metadata;
}

export interface Execution {
  readonly id: string;
  readonly workflowId?: WorkflowId;
  readonly agentId?: AgentId;
  readonly status: ExecutionStatus;
  readonly metadata: Metadata;
}

export type ExecutionStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export interface EngineContext {
  readonly workflow: Workflow;
  readonly execution: ExecutionContext;
}

export interface ExecutionContext {
  readonly id: string;
  readonly input: JsonObject;
  readonly metadata: Metadata;
}

export interface NodeExecutionContext {
  readonly workflow: Workflow;
  readonly execution: ExecutionContext;
  readonly node: WorkflowNode;
  readonly input: JsonObject;
  readonly logs: ExecutionLogWriter;
}

export interface NodeResult {
  readonly output: JsonObject;
  readonly metadata: Metadata;
}

export interface WorkflowExecutionResult {
  readonly executionId: string;
  readonly status: ExecutionStatus;
  readonly output: JsonObject;
  readonly logs: readonly ExecutionLog[];
  readonly nodeResults: readonly NodeExecutionRecord[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
}

export interface NodeExecutionRecord {
  readonly nodeId: WorkflowNodeId;
  readonly nodeType: NodeType;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly input: JsonObject;
  readonly result: NodeResult;
}

export interface ExecutionLog {
  readonly nodeId?: WorkflowNodeId;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly data: JsonObject;
  readonly timestamp: string;
}

export interface ExecutionLogWriter {
  debug(message: string, data?: JsonObject): void;
  info(message: string, data?: JsonObject): void;
  warn(message: string, data?: JsonObject): void;
  error(message: string, data?: JsonObject): void;
}

export interface NodeExecutor {
  execute(context: NodeExecutionContext): Promise<NodeResult>;
}

export interface RegisteredNode {
  readonly type: NodeType;
  readonly executor: NodeExecutor;
  readonly metadata: Metadata;
}

export interface NodeRegistry {
  register(node: RegisteredNode): void;
  get(type: NodeType): RegisteredNode | undefined;
}

export type AgentId = string;

export interface Agent {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string;
  readonly personality: AgentPersonality;
  readonly memory: AgentMemory;
  readonly goals: readonly AgentGoal[];
  readonly tools: readonly Tool[];
  readonly defaultWorkflow?: WorkflowId;
  readonly triggers: readonly Trigger[];
  readonly aiModel: AgentModel;
  readonly settings: AgentSettings;
  readonly voice?: AgentVoice;
  readonly avatar?: Avatar;
  readonly emotionalState: EmotionalState;
  readonly metadata: Metadata;
}

export interface AgentGoal {
  readonly id: string;
  readonly description: string;
  readonly priority: number;
  readonly metadata: Metadata;
}

export interface AgentModel {
  readonly provider: string;
  readonly model: string;
  readonly settings: Metadata;
}

export interface AgentSettings {
  readonly enabled: boolean;
  readonly metadata: Metadata;
}

export interface AgentVoice {
  readonly id: string;
  readonly name: string;
  readonly style: string;
  readonly metadata: Metadata;
}

export interface AgentPersonality {
  readonly name: string;
  readonly traits: readonly string[];
  readonly humor: string;
  readonly energyLevel: EnergyLevel;
  readonly speechStyle: string;
  readonly likes: readonly string[];
  readonly dislikes: readonly string[];
  readonly routine: readonly string[];
  readonly preferences: Metadata;
}

export type EnergyLevel = "low" | "medium" | "high";

export interface AgentMemory {
  readonly id: string;
  readonly scope: "agent";
  readonly ownerAgentId: AgentId;
  readonly strategy: MemoryStrategy;
  readonly metadata: Metadata;
}

export type MemoryStrategy = "none" | "ephemeral" | "persistent";

export type Emotion =
  | "feliz"
  | "animado"
  | "cansado"
  | "curioso"
  | "preocupado"
  | "dormindo"
  | "concentrado";

export interface EmotionalState {
  readonly emotion: Emotion;
  readonly intensity: number;
  readonly metadata: Metadata;
}

export interface Avatar {
  readonly id: string;
  readonly sprite?: Sprite;
  readonly animations: readonly Animation[];
  readonly expressions: readonly Expression[];
  readonly outfit?: Outfit;
  readonly accessories: readonly Accessory[];
  readonly state: AvatarState;
  readonly position: AvatarPosition;
  readonly metadata: Metadata;
}

export interface Sprite {
  readonly id: string;
  readonly source: string;
  readonly metadata: Metadata;
}

export interface Animation {
  readonly id: string;
  readonly name: string;
  readonly metadata: Metadata;
}

export interface Expression {
  readonly id: string;
  readonly name: string;
  readonly emotion: Emotion;
  readonly metadata: Metadata;
}

export interface Outfit {
  readonly id: string;
  readonly name: string;
  readonly metadata: Metadata;
}

export interface Accessory {
  readonly id: string;
  readonly name: string;
  readonly metadata: Metadata;
}

export interface AvatarState {
  readonly value: string;
  readonly metadata: Metadata;
}

export interface AvatarPosition {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

export type TriggerType =
  | "message"
  | "event"
  | "schedule"
  | "webhook"
  | "keyword"
  | "context"
  | "mention";

export interface Trigger {
  readonly id: string;
  readonly type: TriggerType;
  readonly name: string;
  readonly enabled: boolean;
  readonly metadata: Metadata;
}

export interface MentionTrigger extends Trigger {
  readonly type: "mention";
  readonly mentions: readonly string[];
  readonly useIntentClassifier: boolean;
}

export interface Conversation {
  readonly id: string;
  readonly agentId: AgentId;
  readonly messages: readonly ConversationMessage[];
  readonly metadata: Metadata;
}

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "agent" | "system" | "tool";
  readonly content: string;
  readonly metadata: Metadata;
}

export interface IdleBehavior {
  readonly id: string;
  readonly name: string;
  readonly interactions: readonly SpontaneousInteraction[];
  readonly metadata: Metadata;
}

export type SpontaneousInteraction =
  | RandomInteraction
  | ScheduledInteraction
  | ContextualInteraction;

export interface RandomInteraction {
  readonly type: "random";
  readonly weight: number;
  readonly metadata: Metadata;
}

export interface ScheduledInteraction {
  readonly type: "scheduled";
  readonly schedule: string;
  readonly metadata: Metadata;
}

export interface ContextualInteraction {
  readonly type: "contextual";
  readonly contextKey: string;
  readonly metadata: Metadata;
}
