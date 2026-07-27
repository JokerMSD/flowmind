import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const pidPath = resolve(process.cwd(), ".flowmind", "dev.pid");

function readPid() {
  if (!existsSync(pidPath)) return undefined;
  const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopPreviousLocalInstance() {
  const pid = readPid();
  if (!pid) {
    rmSync(pidPath, { force: true });
    return false;
  }

  if (isRunning(pid)) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  }

  rmSync(pidPath, { force: true });
  return true;
}

export function saveLocalInstance(pid) {
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, String(pid), { encoding: "utf8", mode: 0o600 });
}

export function clearLocalInstance(pid) {
  if (readPid() === pid) rmSync(pidPath, { force: true });
}
