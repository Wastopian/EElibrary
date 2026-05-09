#!/usr/bin/env node
/**
 * File header: Ensures local Postgres is ready before dev API/web startup.
 *
 * Behavior:
 *  - Fast no-op when DATABASE_URL is reachable.
 *  - Only auto-starts Docker services when DATABASE_URL points to localhost.
 *  - Starts postgres via docker compose and runs migrations after auto-start.
 */

import { spawn } from "node:child_process";
import { loadEnvFile } from "./lib/dotenv.mjs";
import { waitForPostgres } from "./lib/db.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";

async function main() {
  await loadEnvFile(fromRepoRoot(".env"));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[infra] DATABASE_URL missing; skipping automatic Postgres startup.");
    return;
  }

  if (!isLocalDatabaseUrl(databaseUrl)) {
    console.log("[infra] DATABASE_URL is not localhost; skipping local Docker startup.");
    return;
  }

  if (await isPostgresReachable()) {
    console.log("[infra] Postgres is already reachable.");
    return;
  }

  console.log("[infra] Postgres not reachable. Starting local Docker Postgres...");
  await runCommand("docker", ["compose", "up", "-d", "postgres"]);

  console.log("[infra] Waiting for Postgres...");
  await waitForPostgres({ intervalMs: 750, timeoutMs: 60_000 });

  console.log("[infra] Applying migrations...");
  await runCommand("node", ["scripts/db-migrate.mjs"]);
  console.log("[infra] Local database is ready.");
}

async function isPostgresReachable() {
  try {
    await waitForPostgres({ intervalMs: 200, timeoutMs: 1_200 });
    return true;
  } catch {
    return false;
  }
}

function isLocalDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" || parsed.hostname === "[::1]";
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: fromRepoRoot(),
      shell: process.platform === "win32",
      stdio: "inherit"
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} was terminated by ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}.`));
        return;
      }

      resolve();
    });
  });
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[infra] Automatic Postgres startup failed: ${detail}`);
  if (looksLikeDockerDaemonDown(detail)) {
    console.error("[infra] Docker daemon is not running. Start Docker Desktop, then re-run `npm run dev`.");
    process.exit(1);
  }
  console.error("[infra] Run `npm run setup:dev` to repair local Docker + env configuration.");
  process.exit(1);
});

function looksLikeDockerDaemonDown(message) {
  const lower = message.toLowerCase();
  return lower.includes("docker daemon is not running") || lower.includes("pipe/docker_engine") || lower.includes("cannot find the file specified");
}
