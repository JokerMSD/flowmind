import { resolve } from "node:path";

export function resolveStoragePath(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): string {
  return resolve(workingDirectory, environment.FLOWMIND_STORAGE_PATH ?? "storage");
}
