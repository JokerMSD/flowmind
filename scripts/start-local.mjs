import { spawn } from "node:child_process";
import { createServer } from "node:net";

import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const applications = [
  { name: "Editor", port: 3000 },
  { name: "API", port: Number.parseInt(process.env.PORT ?? "3001", 10) },
  { name: "Agents", port: 3002 },
];

const isPortAvailable = (port) =>
  new Promise((resolve) => {
    const server = createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });

const unavailable = [];

for (const application of applications) {
  if (!(await isPortAvailable(application.port))) {
    unavailable.push(application);
  }
}

if (unavailable.length > 0) {
  console.error("Nao foi possivel iniciar o FlowMind. Portas em uso:");
  for (const application of unavailable) {
    console.error(`- ${application.name}: porta ${application.port}`);
  }
  console.error("Encerre os processos anteriores e execute npm run start novamente.");
  process.exit(1);
}

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
      WHATSAPP_WEB_ENABLED: process.env.WHATSAPP_WEB_ENABLED ?? "false",
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
