import type { JsonObject, NodeExecutionContext, NodeExecutor, NodeResult } from "@flowmind/schema";

export class ConsoleNodeExecutor implements NodeExecutor {
  async execute(context: NodeExecutionContext): Promise<NodeResult> {
    const text = readText(context.input);
    context.logs.info(text, { text });

    return {
      output: {
        text,
      },
      metadata: {},
    };
  }
}

function readText(input: JsonObject): string {
  const value = input.text;
  return typeof value === "string" ? value : JSON.stringify(input);
}
