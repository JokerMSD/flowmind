import type { NodeRegistry } from "@flowmind/schema";

import { CONSOLE_NODE_TYPE, START_NODE_TYPE, TEXT_NODE_TYPE } from "./constants.js";
import { ConsoleNodeExecutor } from "./console-node.js";
import { StartNodeExecutor } from "./start-node.js";
import { TextNodeExecutor } from "./text-node.js";

export function registerCoreNodes(registry: NodeRegistry): void {
  registry.register({
    type: START_NODE_TYPE,
    executor: new StartNodeExecutor(),
    metadata: {
      label: "Start",
      category: "Core",
    },
  });

  registry.register({
    type: TEXT_NODE_TYPE,
    executor: new TextNodeExecutor(),
    metadata: {
      label: "Text",
      category: "Core",
    },
  });

  registry.register({
    type: CONSOLE_NODE_TYPE,
    executor: new ConsoleNodeExecutor(),
    metadata: {
      label: "Console",
      category: "Core",
    },
  });
}
