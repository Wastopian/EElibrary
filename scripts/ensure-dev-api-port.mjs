#!/usr/bin/env node
/**
 * File header: Frees the local API port before `npm run dev` so a stale API process
 * cannot block startup (EADDRINUSE) or serve outdated routes (HTTP 405 on folder sync).
 */

import { execSync } from "node:child_process";
import { loadEnvFile } from "./lib/dotenv.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";

const DEFAULT_API_BASE = "http://127.0.0.1:4000";

async function main() {
  await loadEnvFile(fromRepoRoot(".env"));

  const apiBase = (process.env.EE_LIBRARY_API_BASE_URL ?? DEFAULT_API_BASE).replace(/\/$/u, "");
  const port = parseApiPort(apiBase);
  const pid = findListeningPid(port);

  if (!pid) {
    return;
  }

  const probe = await probeFolderSync(port);

  if (probe.status === 405) {
    console.log(
      `[dev] Port ${port} is held by PID ${pid}, but that API build does not expose POST /projects/sync-from-folder (stale process).`
    );
  } else {
    console.log(`[dev] Port ${port} is already in use (PID ${pid}). Stopping it so a fresh API can start.`);
  }

  try {
    killPid(pid);
  } catch (error) {
    console.error(`[dev] Could not stop PID ${pid} on port ${port}. Close it manually, then run npm run dev again.`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  await waitUntilPortFree(port, 5000);
}

/**
 * Parses the TCP port from a catalog API base URL.
 */
function parseApiPort(apiBase) {
  const parsed = new URL(apiBase);

  if (parsed.port) {
    return Number(parsed.port);
  }

  return parsed.protocol === "https:" ? 443 : 80;
}

/**
 * Returns the PID listening on a TCP port, or null when the port is free.
 */
function findListeningPid(port) {
  if (process.platform === "win32") {
    const output = execSync("netstat -ano -p tcp", { encoding: "utf8" });
    const suffix = `:${port}`;

    for (const line of output.split(/\r?\n/u)) {
      if (!line.includes("LISTENING") || !line.includes(suffix)) {
        continue;
      }

      const parts = line.trim().split(/\s+/u);
      const pid = Number(parts.at(-1));

      if (Number.isInteger(pid) && pid > 0) {
        return pid;
      }
    }

    return null;
  }

  try {
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
    const pid = Number(output.split(/\s+/u)[0]);

    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Probes whether the process on the API port exposes folder sync.
 */
async function probeFolderSync(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/projects/sync-from-folder`, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(2500)
    });

    return { status: response.status };
  } catch {
    return { status: null };
  }
}

/**
 * Stops one process by PID on the current platform.
 */
function killPid(pid) {
  if (process.platform === "win32") {
    execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    return;
  }

  execSync(`kill -9 ${pid}`, { stdio: "ignore" });
}

/**
 * Waits until nothing is listening on the API port.
 */
async function waitUntilPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!findListeningPid(port)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.error(`[dev] Port ${port} is still in use after stopping PID. Close the process manually, then run npm run dev again.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
