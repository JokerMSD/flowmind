import { spawn } from "node:child_process";

if (!process.env.FLOWMIND_ADMIN_TOKEN) {
  console.error("Defina FLOWMIND_ADMIN_TOKEN antes de iniciar o painel administrativo.");
  process.exit(1);
}

const command = process.platform === "win32" ? "corepack.cmd" : "corepack";
const child = spawn(
  command,
  ["pnpm", "--parallel", "--filter", "@flowmind/api", "--filter", "@flowmind/agents", "dev"],
  {
    stdio: "inherit",
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
