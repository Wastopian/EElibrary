#!/usr/bin/env node
/**
 * File header: One-time bootstrap for a shared EE Library team server. Copies
 * .env.team.example to .env.team with freshly generated secrets, creates the host folders
 * the stack bind-mounts, and prints the exact commands the server admin runs next.
 *
 * Safe to re-run: an existing .env.team is never overwritten.
 *
 * Usage:
 *   node scripts/setup-team-server.mjs
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { generateAuthSecret } from "./lib/auth.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";

/** TEMPLATE_PATH is the committed template every team server starts from. */
const TEMPLATE_PATH = fromRepoRoot(".env.team.example");

/** ENV_TEAM_PATH is the live, never-committed team server environment file. */
const ENV_TEAM_PATH = fromRepoRoot(".env.team");

/** HOST_DATA_DIRS are bind-mount targets compose.team.yaml expects to exist on the host. */
const HOST_DATA_DIRS = ["team-data/project-files", "team-data/vendor-notes", "backups"];

/**
 * Generates a password/invite value that is safe inside a connection URL without escaping.
 */
function generateUrlSafeSecret(byteLength) {
  return randomBytes(byteLength).toString("base64url");
}

async function main() {
  console.log("EE Library team server setup");
  console.log("");

  for (const dir of HOST_DATA_DIRS) {
    await mkdir(fromRepoRoot(dir), { recursive: true });
  }
  console.log(`-> [1/2] host folders ready: ${HOST_DATA_DIRS.join(", ")}`);

  let inviteCode = null;

  if (existsSync(ENV_TEAM_PATH)) {
    console.log("-> [2/2] .env.team already exists; left untouched");
  } else {
    const template = await readFile(TEMPLATE_PATH, "utf8");
    const dbPassword = generateUrlSafeSecret(24);
    inviteCode = generateUrlSafeSecret(9);

    const rendered = template
      .replaceAll("CHANGE_ME_DB_PASSWORD", dbPassword)
      .replaceAll("CHANGE_ME_AUTH_SECRET", generateAuthSecret())
      .replaceAll("CHANGE_ME_INVITE_CODE", inviteCode);

    await writeFile(ENV_TEAM_PATH, rendered, { encoding: "utf8", flag: "wx" });
    console.log("-> [2/2] wrote .env.team with generated database password, session secret, and team invite code");
  }

  console.log("");
  console.log("Next steps (full walkthrough: docs/TEAM_SERVER_SETUP.md):");
  console.log("");
  console.log("  1. Start the stack:");
  console.log("       docker compose -f compose.team.yaml up -d --build");
  console.log("");
  console.log("  2. Create the first admin account (pick your own email and password):");
  console.log('       docker compose -f compose.team.yaml run --rm migrate node scripts/seed-admin.mjs --force --email you@company.com --password "choose-a-strong-password"');
  console.log("");
  console.log("  3. Open http://<this-server-address>:8080 from any machine on your network and sign in.");
  if (inviteCode) {
    console.log("");
    console.log(`  Team invite code (engineers need this once, on the sign-up page): ${inviteCode}`);
    console.log("  It is saved in .env.team as EE_LIBRARY_SIGNUP_INVITE_CODE.");
  }
}

main().catch((error) => {
  console.error("setup-team-server failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
