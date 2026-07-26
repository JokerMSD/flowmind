import type { NodeExecutionContext, NodeExecutor, NodeResult } from "@flowmind/schema";

export class TextNodeExecutor implements NodeExecutor {
  async execute(context: NodeExecutionContext): Promise<NodeResult> {
    const message = readMessage(context.node.data);
    context.logs.info("Text generated", { message });

    return {
      output: {
        text: message,
      },
      metadata: {},
    };
  }
}

function readMessage(data: Record<string, unknown>): string {
  const value = data.message;
  return typeof value === "string" ? value : "";
}
