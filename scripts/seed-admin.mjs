#!/usr/bin/env node
/**
 * File header: Creates or refreshes a local admin user. Idempotent. Safe for dev only.
 *
 * Usage:
 *   npm run seed:admin
 *   npm run seed:admin -- --email admin@example.com --password localdev
 *   npm run seed:admin -- --reset-password
 */

import { loadEnvFile } from "./lib/dotenv.mjs";
import { connectClient } from "./lib/db.mjs";
import { hashPassword } from "./lib/auth.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";

/** Defaults used when no flags are passed. Dev-only fixture. */
const DEFAULT_EMAIL = "admin@ee-library.local";
const DEFAULT_PASSWORD = "localdev-admin";
const DEFAULT_ID = "admin-local";

async function main() {
  await loadEnvFile(fromRepoRoot(".env"));

  const args = parseArgs(process.argv.slice(2));
  const email = (args.email ?? DEFAULT_EMAIL).trim().toLowerCase();
  const password = args.password ?? DEFAULT_PASSWORD;
  const resetPassword = args.resetPassword === true;

  if (!email.includes("@")) {
    throw new Error(`--email must be a valid address, got: ${email}`);
  }

  const client = await connectClient();
  try {
    const existing = await client.query("SELECT id, email FROM admin_users WHERE LOWER(email) = $1", [email]);

    if (existing.rows.length > 0 && !resetPassword) {
      console.log(`seed:admin: user already exists for ${email} (id=${existing.rows[0].id}); leaving password untouched`);
      printLoginInfo(email, null);
      return;
    }

    const passwordHash = await hashPassword(password);

    if (existing.rows.length === 0) {
      const id = args.id ?? DEFAULT_ID;
      await client.query(
        `INSERT INTO admin_users (id, email, password_hash, is_admin)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               last_updated_at = now()`,
        [id, email, passwordHash]
      );
      console.log(`seed:admin: created admin user ${email}`);
    } else {
      await client.query(
        `UPDATE admin_users
            SET password_hash = $2,
                last_updated_at = now()
          WHERE LOWER(email) = $1`,
        [email, passwordHash]
      );
      console.log(`seed:admin: reset password for ${email}`);
    }

    printLoginInfo(email, password);
  } finally {
    await client.end();
  }
}

/**
 * Prints login info to stdout. Hides the password unless we just created/reset it.
 */
function printLoginInfo(email, password) {
  console.log("");
  console.log("Local admin login:");
  console.log(`  email:    ${email}`);
  if (password === null) {
    console.log("  password: (unchanged — re-run with --reset-password to rotate)");
  } else {
    console.log(`  password: ${password}`);
  }
  console.log("");
}

/**
 * Parses --flag value pairs from argv with no external dependency.
 */
function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--reset-password") {
      result.resetPassword = true;
      continue;
    }

    if (arg === "--email" || arg === "--password" || arg === "--id") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Flag ${arg} requires a value`);
      }
      const key = arg === "--email" ? "email" : arg === "--password" ? "password" : "id";
      result[key] = value;
      index += 1;
      continue;
    }
  }

  return result;
}

main().catch((error) => {
  console.error("seed:admin failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
