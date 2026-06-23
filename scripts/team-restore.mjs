#!/usr/bin/env node
/**
 * File header: Restores an EE Library team server from a backup folder created by
 * scripts/team-backup.mjs — the database dump plus every stored file. Replaces current
 * data with the backup contents, then restarts the stack (pending migrations re-apply).
 *
 * Runs on the server host next to compose.team.yaml.
 *
 * Usage:
 *   node scripts/team-restore.mjs --latest --yes
 *   node scripts/team-restore.mjs ee-library-backup-2026-06-12-090000 --yes
 *
 * Without --yes the script only prints what it would replace and exits, so it is safe
 * to run while deciding.
 */

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { fromRepoRoot } from "./lib/paths.mjs";
import { pathExists, readEnvFile } from "./lib/env-file.mjs";

/** COMPOSE_FILE is the production stack this script restores into. */
const COMPOSE_FILE = "compose.team.yaml";

/** BACKUP_NAME_PATTERN matches folders created by scripts/team-backup.mjs. */
const BACKUP_NAME_PATTERN = /^ee-library-backup-\d{4}-\d{2}-\d{2}-\d{6}$/u;

/**
 * Parses the backup selector and the --yes confirmation flag.
 */
function parseArgs(argv) {
  const parsed = { backupName: null, latest: false, yes: false };

  for (const arg of argv) {
    if (arg === "--yes") {
      parsed.yes = true;
    } else if (arg === "--latest") {
      parsed.latest = true;
    } else if (!arg.startsWith("--")) {
      parsed.backupName = arg;
    } else {
      throw new Error(`Unknown flag ${arg}. Use --latest, --yes, or a backup folder name.`);
    }
  }

  return parsed;
}

/**
 * Resolves which backup folder to restore from.
 */
async function resolveBackupName({ backupName, latest }) {
  if (backupName) {
    if (!BACKUP_NAME_PATTERN.test(backupName)) {
      throw new Error(`"${backupName}" is not a backup folder name like ee-library-backup-2026-06-12-090000.`);
    }
    return backupName;
  }

  if (!latest) {
    throw new Error("Pick a backup: pass --latest or a folder name from ./backups.");
  }

  const entries = await readdir(fromRepoRoot("backups"));
  const backups = entries.filter((name) => BACKUP_NAME_PATTERN.test(name)).sort();

  if (backups.length === 0) {
    throw new Error("No backups found in ./backups. Run `node scripts/team-backup.mjs` first.");
  }

  return backups[backups.length - 1];
}

/**
 * Runs a docker compose command, optionally streaming inputPath into its stdin.
 * Rejects on a non-zero exit so a partial restore never reports success.
 */
function runCompose(args, inputPath = null) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
      cwd: fromRepoRoot(),
      shell: process.platform === "win32",
      stdio: [inputPath ? "pipe" : "ignore", "inherit", "inherit"]
    });

    if (inputPath) {
      createReadStream(inputPath).pipe(child.stdin);
    }

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`docker compose ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backupName = await resolveBackupName(args);
  const databaseDump = fromRepoRoot("backups", backupName, "database.sql");
  const filesArchive = fromRepoRoot("backups", backupName, "files.tar.gz");

  if (!(await pathExists(databaseDump)) || !(await pathExists(filesArchive))) {
    throw new Error(`backups/${backupName} is missing database.sql or files.tar.gz — it is not a complete backup.`);
  }

  if (!args.yes) {
    console.log(`Would restore backups/${backupName} and REPLACE the current database and stored files.`);
    console.log("Nothing was changed. Re-run with --yes to restore for real.");
    return;
  }

  const env = await readEnvFile(fromRepoRoot(".env.team"));
  const dbUser = env.get("POSTGRES_USER") ?? "ee_library";
  const dbName = env.get("POSTGRES_DB") ?? "ee_library";

  console.log(`team-restore: restoring backups/${backupName}`);

  console.log("-> [1/5] verify stored-file archive");
  await runCompose(["run", "--rm", "--no-deps", "-T", "api", "tar", "tzf", "-"], filesArchive);

  console.log("-> [2/5] stop app services (database stays up)");
  await runCompose(["stop", "web", "api", "worker"]);
  await runCompose(["up", "-d", "postgres"]);

  console.log("-> [3/5] restore database");
  // The dump was taken with --clean --if-exists, so psql drops and recreates each object.
  await runCompose(
    ["exec", "-T", "postgres", "psql", "--username", dbUser, "--dbname", dbName, "--set", "ON_ERROR_STOP=1", "--quiet"],
    databaseDump
  );

  console.log("-> [4/5] restore stored files");
  // The archive is verified before the database is touched, then unpacked over the live
  // data roots without a pre-delete. Files no longer referenced by the restored database
  // may remain on disk, but a corrupt archive can no longer erase all stored files.
  await runCompose(["run", "--rm", "--no-deps", "-T", "api", "tar", "xzf", "-", "-C", "/data"], filesArchive);

  console.log("-> [5/5] start the stack (any newer migrations re-apply)");
  await runCompose(["up", "-d"]);

  console.log("");
  console.log(`Restore complete from backups/${backupName}.`);
  console.log("Open the team address in a browser and spot-check a project and a part detail page.");
}

main().catch((error) => {
  console.error("team-restore failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
