import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv() {
  const path = resolve(process.cwd(), ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}
