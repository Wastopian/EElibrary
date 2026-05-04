#!/usr/bin/env node
/**
 * File header: Loads the repo-root .env into process.env, validates the local-dev variables,
 * and spawns the wrapped command inheriting the resulting environment. Used by the dev/db/seed
 * scripts so a fresh checkout never starts services with a half-loaded env.
 *
 * Usage:
 *   node scripts/with-local-env.mjs <command> [...args]
 *
 * Flags (must precede the wrapped command):
 *   --warn-only   Print issues but do not exit; useful for db:status / seed:* where partial env
 *                 should still be allowed to attempt connection.
 */

import { spawn } from "node:child_process";
import { loadEnvFile } from "./lib/dotenv.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";
import { formatIssuesForStderr, validateLocalEnv } from "./lib/env-validate.mjs";

async function main() {
  const argv = process.argv.slice(2);
  let warnOnly = false;

  while (argv[0] === "--warn-only") {
    warnOnly = true;
    argv.shift();
  }

  if (argv.length === 0) {
    console.error("with-local-env.mjs: missing wrapped command");
    process.exit(2);
  }

  await loadEnvFile(fromRepoRoot(".env"));

  const issues = validateLocalEnv(process.env);
  if (issues.length > 0) {
    process.stderr.write(formatIssuesForStderr(issues));
    if (!warnOnly) {
      console.error("Refusing to start. Run `npm run setup:dev` to fix the local environment.");
      process.exit(1);
    }
    console.error("Continuing in --warn-only mode; downstream commands may misbehave.");
  }

  const [command, ...rest] = argv;
  const child = spawn(command, rest, {
    cwd: fromRepoRoot(),
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  child.on("error", (error) => {
    console.error(`Failed to spawn ${command}:`, error instanceof Error ? error.message : error);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  // Forward signals so Ctrl+C tears down the wrapped command cleanly.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }
}

main().catch((error) => {
  console.error("with-local-env failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
