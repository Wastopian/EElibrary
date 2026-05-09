#!/usr/bin/env node
/**
 * File header: One-shot local bootstrap. Idempotent. Wires .env, Docker, migrations,
 * admin login, sample imports, and validation so a fresh clone is usable immediately.
 *
 * Steps:
 *   1. Copy .env.example -> .env if .env is missing.
 *   2. Generate AUTH_SECRET if missing (>=32 bytes).
 *   3. docker compose up -d
 *   4. Wait for Postgres to accept connections.
 *   5. Run db:migrate (applies every migration via the schema_migrations table,
 *      not only on a fresh Docker volume).
 *   6. Seed or preserve the local admin user.
 *   7. Import deterministic local-catalog sample parts.
 *   8. Print web/API/admin info and the recommended next commands.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { copyIfMissing, ensureEnvKey, pathExists, readEnvFile, writeEnvFile } from "./lib/env-file.mjs";
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
  await step6SeedAdmin();
  await step7ImportSampleParts();
  step8PrintReady();
}

async function step1CopyEnv() {
  console.log("-> [1/8] ensure .env file");

  if (!(await pathExists(ENV_EXAMPLE_PATH))) {
    throw new Error(".env.example not found; cannot bootstrap local environment.");
  }

  const result = await copyIfMissing(ENV_EXAMPLE_PATH, ENV_PATH);
  if (result === "copied") {
    console.log("   copied .env.example -> .env");
  } else {
    console.log("   .env already exists; left untouched");
  }
}

async function step2EnsureAuthSecret() {
  console.log("-> [2/8] ensure AUTH_SECRET (>=32 bytes)");

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
  console.log("-> [3/8] docker compose up -d");

  await ensureDockerAvailable();

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await runCommandWithOutput("docker", ["compose", "up", "-d"], { cwd: fromRepoRoot() });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const output = extractCommandOutput(error);

      if (output.includes("port is already allocated")) {
        const changed = await reassignComposeCollisionPort(output);
        if (changed && attempt < 6) {
          console.log("   retrying docker compose with auto-adjusted host ports...");
          continue;
        }

        throw new Error(
          "docker compose could not bind one or more host ports because they are already in use.\n" +
            "Either stop the conflicting service/container or change POSTGRES_PORT / REDIS_PORT / " +
            "OBJECT_STORAGE_PORT / OBJECT_STORAGE_CONSOLE_PORT in .env, then re-run npm run setup:dev."
        );
      }

      throw new Error(
        `docker compose failed: ${message}\n` +
          "Open Docker Desktop (or start your local docker daemon), wait until it reports running, " +
          "then re-run npm run setup:dev."
      );
    }
  }
}

/**
 * Pre-flight checks for Docker so the operator gets actionable copy when the binary is missing
 * or the daemon is not running, instead of an opaque ENOENT or socket error from `docker compose`.
 */
async function ensureDockerAvailable() {
  try {
    await runSilent("docker", ["--version"]);
  } catch (error) {
    throw new Error(
      "Docker is not installed or not on PATH.\n" +
        "EE Library uses Docker Desktop (or a Linux docker daemon) to run the local Postgres + storage stack.\n" +
        "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and re-run npm run setup:dev.\n" +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    await runSilent("docker", ["info"]);
  } catch (error) {
    throw new Error(
      "Docker is installed but the daemon is not responding.\n" +
        "Start Docker Desktop (or your docker service), wait until it reports running, " +
        "then re-run npm run setup:dev.\n" +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function step4WaitForPostgres() {
  console.log("-> [4/8] waiting for Postgres");
  await waitForPostgres({ timeoutMs: 90_000, intervalMs: 1_000 });
  console.log("   Postgres is reachable");
}

async function step5RunMigrations() {
  console.log("-> [5/8] applying migrations");
  await runNodeScript("scripts/db-migrate.mjs");
}

async function step6SeedAdmin() {
  console.log("-> [6/8] seeding local admin");
  await runNodeScript("scripts/seed-admin.mjs");
}

async function step7ImportSampleParts() {
  console.log("-> [7/8] importing local-catalog sample parts");
  await runNpmScript("ingest:local");
}

function step8PrintReady() {
  const apiPort = process.env.API_PORT ?? "4000";
  const apiBase = process.env.EE_LIBRARY_API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
  const webPort = process.env.WEB_PORT ?? "3000";

  console.log("");
  console.log("-> [8/8] ready");
  console.log("");
  console.log("EE Library local environment");
  console.log("-----------------------------");
  console.log(`  Web:   http://localhost:${webPort}     (npm run dev:web)`);
  console.log(`  API:   ${apiBase}                      (npm run dev:api)`);
  console.log(`  Both:  npm run dev`);
  console.log("");
  console.log("  Admin login (local dev):");
  console.log("    email:    admin@ee-library.local");
  console.log("    password: localdev-admin");
  console.log("    rotate:   npm run seed:admin -- --reset-password");
  console.log("");
  console.log("  Recommended next steps:");
  console.log("    npm run dev             # start api + web together");
  console.log("    npm run dev:worker      # run the worker daemon (heartbeats every ~10s)");
  console.log("    npm run smoke:local     # probe the running stack end-to-end");
  console.log("");
  console.log("  Useful follow-ups:");
  console.log("    npm run db:status       # show applied/pending migrations");
  console.log("    npm run db:migrate      # apply new migrations");
  console.log("    npm run db:reset        # drop + re-apply schema (local only)");
  console.log("    npm run ingest:local    # re-import local-catalog sample parts");
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
 * Runs a child process while mirroring output and returns captured stdout/stderr on failure.
 */
function runCommandWithOutput(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      ...options
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const failure = new Error(`${command} ${args.join(" ")} exited with code ${code}`);
        failure.commandOutput = `${stdout}\n${stderr}`.trim();
        reject(failure);
      }
    });
  });
}

/**
 * Runs a child process and rejects on non-zero exit, suppressing stdout/stderr.
 * Used by the pre-flight checks where the operator only needs the success/fail signal.
 */
function runSilent(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      stdio: "ignore"
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

/**
 * Runs a package.json script from the repo root with inherited stdio.
 */
function runNpmScript(scriptName) {
  return runCommand("npm", ["run", scriptName], { cwd: fromRepoRoot() });
}

function extractCommandOutput(error) {
  if (!error || typeof error !== "object") {
    return "";
  }

  if (!("commandOutput" in error)) {
    return "";
  }

  const output = error.commandOutput;
  return typeof output === "string" ? output : "";
}

function readPortFromEnv(value, fallbackPort) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallbackPort;
  }
  return parsed;
}

async function findAvailablePort(startPort, reservedPorts = new Set(), maxAttempts = 200) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = startPort + offset;
    if (candidate > 65535) {
      break;
    }

    if (reservedPorts.has(candidate)) {
      continue;
    }

    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }

  throw new Error(`No available host port found after checking ${maxAttempts} candidates starting at ${startPort}.`);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen({ host: "0.0.0.0", port });
  });
}

function rewriteLocalUrlPort({ envEntries, envKey, expectedPort, nextPort }) {
  const value = process.env[envKey];
  if (!value) {
    return [];
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return [];
  }

  if (!isLoopbackHost(url.hostname)) {
    return [];
  }

  const resolvedPort = url.port === "" ? defaultPortForProtocol(url.protocol) : Number.parseInt(url.port, 10);
  if (resolvedPort !== expectedPort) {
    return [];
  }

  url.port = String(nextPort);
  const updated = url.toString();
  process.env[envKey] = updated;
  envEntries.set(envKey, updated);

  return [`${envKey}: port ${expectedPort} -> ${nextPort}`];
}

function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function defaultPortForProtocol(protocol) {
  if (protocol === "postgres:" || protocol === "postgresql:") {
    return 5432;
  }
  if (protocol === "redis:") {
    return 6379;
  }
  if (protocol === "http:") {
    return 80;
  }
  if (protocol === "https:") {
    return 443;
  }
  return null;
}

async function reassignComposeCollisionPort(composeOutput) {
  const occupiedPort = parseAllocatedPortFromComposeOutput(composeOutput);
  if (occupiedPort === null) {
    return false;
  }

  const envEntries = await readEnvFile(ENV_PATH);
  const candidates = [
    { envKey: "POSTGRES_PORT", dependentUrlEnvKey: "DATABASE_URL" },
    { envKey: "REDIS_PORT", dependentUrlEnvKey: "REDIS_URL" },
    { envKey: "OBJECT_STORAGE_PORT", dependentUrlEnvKey: "OBJECT_STORAGE_ENDPOINT" },
    { envKey: "OBJECT_STORAGE_CONSOLE_PORT", dependentUrlEnvKey: null }
  ];

  const matching = candidates.filter((candidate) => readPortFromEnv(process.env[candidate.envKey], NaN) === occupiedPort);
  if (matching.length === 0) {
    return false;
  }

  const reservedPorts = new Set(
    candidates
      .map((candidate) => readPortFromEnv(process.env[candidate.envKey], NaN))
      .filter((value) => Number.isFinite(value) && value !== occupiedPort)
  );

  const adjustments = [];
  for (const candidate of matching) {
    const nextPort = await findAvailablePort(occupiedPort + 1, reservedPorts);
    reservedPorts.add(nextPort);
    process.env[candidate.envKey] = String(nextPort);
    envEntries.set(candidate.envKey, String(nextPort));
    adjustments.push(`${candidate.envKey}: ${occupiedPort} -> ${nextPort}`);

    if (candidate.dependentUrlEnvKey) {
      adjustments.push(
        ...rewriteLocalUrlPort({
          envEntries,
          envKey: candidate.dependentUrlEnvKey,
          expectedPort: occupiedPort,
          nextPort
        })
      );
    }
  }

  await writeEnvFile(ENV_PATH, envEntries);
  console.log("   auto-resolved Docker bind conflict:");
  for (const line of adjustments) {
    console.log(`     - ${line}`);
  }

  return true;
}

function parseAllocatedPortFromComposeOutput(output) {
  const match = output.match(/:(\d+)\sfailed:\sport is already allocated/u);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) ? value : null;
}

main().catch((error) => {
  console.error("");
  console.error("setup:dev failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
