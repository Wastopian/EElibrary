#!/usr/bin/env node
/**
 * File header: Takes one complete backup of a running EE Library team server: a full
 * `pg_dump` of the database plus a tar.gz of every stored file (CAD assets, datasheets,
 * export bundles, project files, vendor notes). Writes a dated folder under ./backups and
 * prunes old backups beyond the retention count.
 *
 * Runs on the server host next to compose.team.yaml. The stack must be up.
 *
 * Usage:
 *   node scripts/team-backup.mjs [--retain <count>]   (default: keep the newest 14)
 *
 * Restore counterpart: scripts/team-restore.mjs (see docs/TEAM_SERVER_SETUP.md).
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { fromRepoRoot } from "./lib/paths.mjs";
import { readEnvFile } from "./lib/env-file.mjs";

/** COMPOSE_FILE is the production stack this script backs up. */
const COMPOSE_FILE = "compose.team.yaml";

/** BACKUPS_DIR collects one dated subfolder per backup run. */
const BACKUPS_DIR = fromRepoRoot("backups");

/** BACKUP_NAME_PATTERN matches folders this script created, so pruning never touches anything else. */
const BACKUP_NAME_PATTERN = /^ee-library-backup-\d{4}-\d{2}-\d{2}-\d{6}$/u;

/** DEFAULT_RETAIN_COUNT keeps two weeks of daily backups by default. */
const DEFAULT_RETAIN_COUNT = 14;

/**
 * Parses the optional --retain flag.
 */
function parseArgs(argv) {
  const retainIndex = argv.indexOf("--retain");

  if (retainIndex === -1) {
    return { retain: DEFAULT_RETAIN_COUNT };
  }

  const retain = Number(argv[retainIndex + 1]);

  if (!Number.isInteger(retain) || retain < 1) {
    throw new Error("--retain requires a whole number of backups to keep (at least 1).");
  }

  return { retain };
}

/**
 * Runs a docker compose command, streaming its stdout into outputPath when provided.
 * Rejects when the command exits non-zero so a failed dump never looks like a good backup.
 */
function runCompose(args, outputPath = null) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
      cwd: fromRepoRoot(),
      shell: process.platform === "win32",
      stdio: ["ignore", outputPath ? "pipe" : "inherit", "inherit"]
    });

    if (outputPath) {
      child.stdout.pipe(createWriteStream(outputPath));
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

/**
 * Builds the dated backup folder name from the current local time.
 */
function buildBackupName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `ee-library-backup-${date}-${time}`;
}

/**
 * Deletes the oldest backup folders beyond the retention count.
 */
async function pruneOldBackups(retain) {
  const entries = await readdir(BACKUPS_DIR);
  const backups = entries.filter((name) => BACKUP_NAME_PATTERN.test(name)).sort();
  const expired = backups.slice(0, Math.max(0, backups.length - retain));

  for (const name of expired) {
    await rm(fromRepoRoot("backups", name), { force: true, recursive: true });
    console.log(`   pruned old backup ${name}`);
  }
}

async function main() {
  const { retain } = parseArgs(process.argv.slice(2));
  const env = await readEnvFile(fromRepoRoot(".env.team"));
  const dbUser = env.get("POSTGRES_USER") ?? "ee_library";
  const dbName = env.get("POSTGRES_DB") ?? "ee_library";

  const backupName = buildBackupName();
  const backupDir = fromRepoRoot("backups", backupName);
  await mkdir(backupDir, { recursive: true });

  console.log(`team-backup: writing ${backupName}`);

  console.log("-> [1/3] database (pg_dump)");
  await runCompose(
    ["exec", "-T", "postgres", "pg_dump", "--username", dbUser, "--dbname", dbName, "--clean", "--if-exists"],
    fromRepoRoot("backups", backupName, "database.sql")
  );

  console.log("-> [2/3] stored files (CAD assets, datasheets, bundles, project files, vendor notes)");
  // The api container mounts all three data roots under /data, so one tar covers them.
  // --ignore-failed-read keeps an empty optional folder from failing the whole backup.
  await runCompose(
    ["exec", "-T", "api", "tar", "czf", "-", "--ignore-failed-read", "-C", "/data", "storage", "project-files", "vendor-notes"],
    fromRepoRoot("backups", backupName, "files.tar.gz")
  );

  console.log(`-> [3/3] keep the newest ${retain} backups`);
  await pruneOldBackups(retain);

  const databaseSize = (await stat(fromRepoRoot("backups", backupName, "database.sql"))).size;
  const filesSize = (await stat(fromRepoRoot("backups", backupName, "files.tar.gz"))).size;

  if (databaseSize === 0) {
    throw new Error("database.sql is empty — the dump did not run. Is the stack up (docker compose -f compose.team.yaml up -d)?");
  }

  console.log("");
  console.log(`Backup complete: backups/${backupName}`);
  console.log(`  database.sql  ${(databaseSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  files.tar.gz  ${(filesSize / 1024 / 1024).toFixed(1)} MB`);
  console.log("");
  console.log("Copy the backups folder somewhere off this machine (second disk, NAS, or cloud drive).");
}

main().catch((error) => {
  console.error("team-backup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
