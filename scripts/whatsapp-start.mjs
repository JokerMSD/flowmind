import { spawn } from "node:child_process";

import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const command = process.platform === "win32" ? "corepack.cmd" : "corepack";
const child = spawn(
  command,
  ["pnpm", "--parallel", "--filter", "@flowmind/api", "--filter", "@flowmind/agents", "dev"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      WHATSAPP_WEB_ENABLED: "true",
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
