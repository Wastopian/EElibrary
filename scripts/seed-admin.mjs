#!/usr/bin/env node
/**
 * File header: Creates or refreshes one local admin user for NextAuth credentials login.
 * The script targets the current `users` table, stores bcrypt-compatible password hashes,
 * and refuses non-local DATABASE_URL values unless --force is explicit.
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashSync } from "bcryptjs";
import { loadEnvFile } from "./lib/dotenv.mjs";
import { connectClient, isLocalDatabase, requireDatabaseUrl } from "./lib/db.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";

/** DEFAULT_ADMIN_EMAIL is the local developer login created when no email flag is provided. */
export const DEFAULT_ADMIN_EMAIL = "admin@ee-library.local";

/** DEFAULT_ADMIN_PASSWORD is a local-only password printed only for localhost databases. */
export const DEFAULT_ADMIN_PASSWORD = "localdev-admin";

/** BCRYPT_COST keeps local bootstrap reasonably fast while matching the web auth verifier. */
const BCRYPT_COST = 12;

/**
 * Parses seed-admin CLI flags without adding another dependency to the bootstrap path.
 */
export function parseSeedAdminArgs(argv) {
  const parsed = {
    email: DEFAULT_ADMIN_EMAIL,
    force: false,
    id: undefined,
    password: DEFAULT_ADMIN_PASSWORD,
    resetPassword: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--force") {
      parsed.force = true;
      continue;
    }

    if (arg === "--reset-password") {
      parsed.resetPassword = true;
      continue;
    }

    if (arg === "--email" || arg === "--password" || arg === "--id") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Flag ${arg} requires a value.`);
      }

      if (arg === "--email") {
        parsed.email = value;
      } else if (arg === "--password") {
        parsed.password = value;
      } else {
        parsed.id = value;
      }

      index += 1;
    }
  }

  return parsed;
}

/**
 * Creates or updates the requested admin user using an already-connected pg client.
 */
export async function seedAdminUser(client, options) {
  const email = normalizeEmail(options.email);
  const password = normalizePassword(options.password);
  const existing = await client.query("SELECT id, email, role FROM users WHERE lower(email) = lower($1) LIMIT 1", [email]);
  const existingUser = existing.rows[0] ?? null;

  if (existingUser && !options.resetPassword && existingUser.role === "admin") {
    return {
      email: existingUser.email ?? email,
      id: existingUser.id,
      passwordChanged: false,
      roleChanged: false,
      status: "exists"
    };
  }

  const shouldWritePassword = options.resetPassword || !existingUser || existingUser.role !== "admin";
  const passwordHash = shouldWritePassword ? hashSync(password, BCRYPT_COST) : null;

  if (existingUser) {
    if (passwordHash) {
      await client.query(
        `
          UPDATE users
             SET password_hash = $2,
                 role = 'admin'
           WHERE lower(email) = lower($1)
        `,
        [email, passwordHash]
      );
    } else {
      await client.query(
        `
          UPDATE users
             SET role = 'admin'
           WHERE lower(email) = lower($1)
        `,
        [email]
      );
    }

    return {
      email,
      id: existingUser.id,
      passwordChanged: Boolean(passwordHash),
      roleChanged: existingUser.role !== "admin",
      status: "updated"
    };
  }

  const id = options.id ?? randomUUID();
  await client.query(
    `
      INSERT INTO users (id, email, password_hash, role, org_id)
      VALUES ($1, $2, $3, 'admin', 'org-default')
    `,
    [id, email, passwordHash]
  );

  return {
    email,
    id,
    passwordChanged: true,
    roleChanged: true,
    status: "created"
  };
}

/**
 * Runs the seed command from the local CLI.
 */
async function main() {
  await loadEnvFile(fromRepoRoot(".env"));

  const args = parseSeedAdminArgs(process.argv.slice(2));
  const databaseUrl = requireDatabaseUrl();
  const localDatabase = isLocalDatabase(databaseUrl);

  if (!localDatabase && !args.force) {
    throw new Error("seed:admin refused: DATABASE_URL is not localhost. Re-run with -- --force if this is intentional.");
  }

  const client = await connectClient();

  try {
    const result = await seedAdminUser(client, args);

    printSeedResult(result, {
      localDatabase,
      password: args.password
    });
  } catch (error) {
    throw mapSchemaError(error);
  } finally {
    await client.end();
  }
}

/**
 * Normalizes and validates an email address for lookup and insert.
 */
function normalizeEmail(email) {
  const normalized = String(email ?? "").trim().toLowerCase();

  if (!normalized.includes("@")) {
    throw new Error(`--email must be a valid address, got: ${normalized || "(empty)"}`);
  }

  return normalized;
}

/**
 * Normalizes and validates a local admin password.
 */
function normalizePassword(password) {
  const normalized = String(password ?? "");

  if (normalized.length < 8) {
    throw new Error("--password must be at least 8 characters.");
  }

  return normalized;
}

/**
 * Converts missing-table failures into setup guidance.
 */
function mapSchemaError(error) {
  if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
    return new Error("users table is missing. Run `npm run db:migrate` before `npm run seed:admin`.");
  }

  return error;
}

/**
 * Prints local-only login guidance without leaking passwords for forced remote runs.
 */
function printSeedResult(result, options) {
  const action = result.status === "created" ? "created" : result.status === "updated" ? "updated" : "already exists";

  console.log(`seed:admin: ${action} (${result.email})`);
  console.log("");
  console.log("Local admin login:");
  console.log(`  email:    ${result.email}`);

  if (options.localDatabase && result.passwordChanged) {
    console.log(`  password: ${options.password}`);
  } else if (options.localDatabase) {
    console.log("  password: (unchanged; re-run with --reset-password to rotate)");
  } else {
    console.log("  password: (not printed for non-local database)");
  }

  console.log("");
}

/**
 * Returns true when this module is being executed as the CLI entrypoint.
 */
function isDirectRun(moduleUrl, argvPath) {
  return Boolean(argvPath) && fileURLToPath(moduleUrl) === resolve(argvPath);
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error("seed:admin failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
