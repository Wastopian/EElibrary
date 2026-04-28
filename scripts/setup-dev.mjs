#!/usr/bin/env node
/**
 * File header: One-shot local bootstrap. Idempotent. Wires .env, Docker, migrations,
 * and validates the local environment so a fresh clone is usable immediately.
 *
 * Steps:
 *   1. Copy .env.example -> .env if .env is missing.
 *   2. Generate AUTH_SECRET if missing (>=32 bytes).
 *   3. docker compose up -d
 *   4. Wait for Postgres to accept connections.
 *   5. Run db:migrate (applies every migration via the schema_migrations table,
 *      not only on a fresh Docker volume).
 *   6. Validate the resolved env. Fail loudly with actionable copy if anything is missing.
 *   7. Print web/API/admin info and the recommended next commands.
 *
 * Demo parts and admin seeding are handled by the existing parent flows
 * (`npm run ingest:local` for catalog data, `apps/api/src/auth.ts` for AUTH_SECRET
 * enforcement). This script does not touch those paths.
 */

import { spawn } from "node:child_process";
import { copyIfMissing, ensureEnvKey, pathExists } from "./lib/env-file.mjs";
import { loadEnvFile } from "./lib/dotenv.mjs";
import { generateAuthSecret } from "./lib/auth.mjs";
import { waitForPostgres } from "./lib/db.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";
import { formatIssuesForStderr, validateLocalEnv } from "./lib/env-validate.mjs";

const ENV_PATH = fromRepoRoot(".env");
const ENV_EXAMPLE_PATH = fromRepoRoot(".env.example");

async function main() {
  await step1CopyEnv();
  await step2EnsureAuthSecret();
  await loadEnvFile(ENV_PATH);
  validateEnvOrFail();
  await step3DockerCompose();
  await step4WaitForPostgres();
  await step5RunMigrations();
  step6PrintReady();
}

async function step1CopyEnv() {
  console.log("→ [1/6] ensure .env file");

  if (!(await pathExists(ENV_EXAMPLE_PATH))) {
    throw new Error(".env.example not found; cannot bootstrap local environment.");
  }

  const result = await copyIfMissing(ENV_EXAMPLE_PATH, ENV_PATH);
  if (result === "copied") {
    console.log("   copied .env.example → .env");
  } else {
    console.log("   .env already exists; left untouched");
  }
}

async function step2EnsureAuthSecret() {
  console.log("→ [2/6] ensure AUTH_SECRET (>=32 bytes)");

  const result = await ensureEnvKey(ENV_PATH, "AUTH_SECRET", () => generateAuthSecret());
  if (result.status === "added") {
    console.log("   generated AUTH_SECRET");
  } else {
    console.log("   AUTH_SECRET already set; left untouched");
  }
}

function validateEnvOrFail() {
  const issues = validateLocalEnv(process.env);
  if (issues.length === 0) {
    return;
  }
  process.stderr.write(formatIssuesForStderr(issues));
  throw new Error("Local environment is incomplete after .env load. Fix the issues above and re-run setup:dev.");
}

async function step3DockerCompose() {
  console.log("→ [3/6] docker compose up -d");

  try {
    await runCommand("docker", ["compose", "up", "-d"], { cwd: fromRepoRoot() });
  } catch (error) {
    throw new Error(
      `docker compose failed: ${error instanceof Error ? error.message : String(error)}\n` +
        "Ensure Docker Desktop (or a docker daemon) is running, then re-run npm run setup:dev."
    );
  }
}

async function step4WaitForPostgres() {
  console.log("→ [4/6] waiting for Postgres");
  await waitForPostgres({ timeoutMs: 90_000, intervalMs: 1_000 });
  console.log("   Postgres is reachable");
}

async function step5RunMigrations() {
  console.log("→ [5/6] applying migrations");
  await runNodeScript("scripts/db-migrate.mjs");
}

function step6PrintReady() {
  const apiPort = process.env.API_PORT ?? "4000";
  const apiBase = process.env.EE_LIBRARY_API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
  const webPort = process.env.WEB_PORT ?? "3000";

  console.log("");
  console.log("→ [6/6] ready");
  console.log("");
  console.log("EE Library local environment");
  console.log("─────────────────────────────");
  console.log(`  Web:   http://localhost:${webPort}     (npm run dev:web)`);
  console.log(`  API:   ${apiBase}                      (npm run dev:api)`);
  console.log(`  Both:  npm run dev`);
  console.log("");
  console.log("  Recommended next steps:");
  console.log("    npm run ingest:local    # seed demo parts via the local-catalog provider");
  console.log("    npm run dev             # start api + web together");
  console.log("    npm run dev:worker      # run the worker daemon (heartbeats every ~10s)");
  console.log("    npm run smoke:local     # probe the running stack end-to-end");
  console.log("");
  console.log("  Useful follow-ups:");
  console.log("    npm run db:status       # show applied/pending migrations");
  console.log("    npm run db:migrate      # apply new migrations");
  console.log("    npm run db:reset        # drop + re-apply schema (local only)");
  console.log("");
  console.log("  Tip: this script does NOT start `npm run dev`. Run it next, then `npm run smoke:local`.");
  console.log("");
}

/**
 * Runs a child process and rejects on non-zero exit.
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

/**
 * Runs a Node script from the repo root with inherited stdio.
 */
function runNodeScript(relativePath) {
  return runCommand(process.execPath, [fromRepoRoot(relativePath)], { cwd: fromRepoRoot() });
}

main().catch((error) => {
  console.error("");
  console.error("setup:dev failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
