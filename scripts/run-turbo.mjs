import { spawnSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptsDirectory);
const turboPath = join(repositoryRoot, "node_modules", "turbo", "bin", "turbo");
const shimDirectory = join(scriptsDirectory, "shims");
const args = process.argv.slice(2);

const result = spawnSync(process.execPath, [turboPath, ...args], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    PATH: `${shimDirectory}${delimiter}${process.env.PATH ?? ""}`,
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
