import type { WorkflowExecutionResult } from "@flowmind/schema";

export function readExecutionText(execution: WorkflowExecutionResult | null): string {
  if (!execution) {
    return "-";
  }

  const text = execution.output.text;
  return typeof text === "string" ? text : JSON.stringify(execution.output);
}
