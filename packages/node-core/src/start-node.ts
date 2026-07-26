import type { NodeExecutor, NodeResult } from "@flowmind/schema";

export class StartNodeExecutor implements NodeExecutor {
  async execute(): Promise<NodeResult> {
    return {
      output: {},
      metadata: {},
    };
  }
}
