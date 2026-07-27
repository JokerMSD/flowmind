import { spawn } from "node:child_process";

import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const command = process.platform === "win32" ? "corepack.cmd" : "corepack";
const child = spawn(
  command,
  [
    "pnpm",
    "--parallel",
    "--filter",
    "@flowmind/api",
    "--filter",
    "@flowmind/editor",
    "--filter",
    "@flowmind/agents",
    "dev",
  ],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      NODE_ENV: "development",
      FLOWMIND_ADMIN_ALLOW_LOCAL_DEV:
        process.env.FLOWMIND_ADMIN_ALLOW_LOCAL_DEV ??
        (process.env.FLOWMIND_ADMIN_TOKEN ? "false" : "true"),
      WHATSAPP_WEB_ENABLED: process.env.WHATSAPP_WEB_ENABLED ?? "false",
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
