import type { AgentId, JsonObject, Metadata, Workflow } from "@flowmind/schema";

export interface Assistant {
  readonly id: string;
  readonly agentId?: AgentId;
  readonly name: string;
  readonly description: string;
  readonly panel: AssistantPanel;
  readonly provider: AssistantProvider;
  readonly metadata: Metadata;
}

export interface AssistantEvent {
  readonly id: string;
  readonly type: string;
  readonly context: AssistantContext;
  readonly payload: JsonObject;
  readonly metadata: Metadata;
}

export interface AssistantPanel {
  readonly id: string;
  readonly title: string;
  readonly placement: "left" | "right" | "bottom" | "floating";
  readonly visible: boolean;
  readonly metadata: Metadata;
}

export interface AssistantSuggestion {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly action: AssistantAction;
  readonly confidence: number;
  readonly metadata: Metadata;
}

export interface AssistantAction {
  readonly id: string;
  readonly label: string;
  readonly kind: "command" | "workflow-change" | "navigation" | "message";
  readonly payload: JsonObject;
  readonly metadata: Metadata;
}

export interface AssistantContext {
  readonly workflow?: Workflow;
  readonly selectedNodeIds: readonly string[];
  readonly selectedEdgeIds: readonly string[];
  readonly viewport: JsonObject;
  readonly metadata: Metadata;
}

export interface AssistantProvider {
  getSuggestions(context: AssistantContext): Promise<readonly AssistantSuggestion[]>;
  handleEvent(event: AssistantEvent): Promise<readonly AssistantAction[]>;
}
