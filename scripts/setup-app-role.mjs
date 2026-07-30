#!/usr/bin/env node
/**
 * File header: Provisions the least-privilege Postgres role the API connects as on a team server.
 *
 * Defense-in-depth for multi-tenancy. Migrations, seeds, and the worker legitimately run
 * cross-tenant as the owner (they set the `app.rls_bypass` GUC). The API request path, by contrast,
 * only ever needs scoped DML under `app.current_org`. Giving it a dedicated NON-owner role means a
 * request-path bug or injection cannot DROP tables, cannot bypass RLS through table ownership (the
 * owner is exempt from RLS unless FORCE is set — it is, migration 055 — but a non-owner removes the
 * reliance), and holds only SELECT/INSERT/UPDATE/DELETE. It does NOT by itself close the bypass-GUC
 * path (a later increment can role-gate that); it is the "connect as a dedicated non-owner role"
 * hardening from the multi-tenancy backlog.
 *
 * Deliberately an ops script, NOT a migration: CREATE ROLE needs CREATEROLE/superuser and would
 * break the portable migration path (local dev, CI) if bundled there. This runs once at team-server
 * setup, as the owner, and is idempotent (safe to re-run — it re-syncs grants after new migrations).
 *
 * Usage: EE_LIBRARY_APP_DB_PASSWORD=... node scripts/setup-app-role.mjs
 *   Optional EE_LIBRARY_APP_DB_ROLE (default "ee_library_app").
 * Run it as the DB owner via `node scripts/with-local-env.mjs node scripts/setup-app-role.mjs`.
 */

import { connectClient } from "./lib/db.mjs";

const ROLE = (process.env.EE_LIBRARY_APP_DB_ROLE ?? "ee_library_app").trim();
const PASSWORD = process.env.EE_LIBRARY_APP_DB_PASSWORD;

/** Rejects a role name that is not a plain identifier, so it can be safely interpolated into DDL. */
function assertSafeRoleName(role) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(role)) {
    throw new Error(`Unsafe role name ${JSON.stringify(role)}; use lowercase letters, digits, and underscores.`);
  }
}

async function main() {
  if (!PASSWORD || PASSWORD.length < 12) {
    throw new Error("EE_LIBRARY_APP_DB_PASSWORD is required and must be at least 12 characters.");
  }

  assertSafeRoleName(ROLE);

  // connectClient() connects as the owner with the rls_bypass GUC — the privileged path that can
  // create roles and grant. The role we provision here does NOT inherit that GUC intent.
  const client = await connectClient();

  try {
    const dbNameResult = await client.query("SELECT current_database() AS db");
    const dbName = dbNameResult.rows[0].db;

    // Create-or-update the login role. Quote the password as a literal to avoid injection; the role
    // name is validated as a bare identifier above.
    const escapedPassword = PASSWORD.replaceAll("'", "''");
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          CREATE ROLE ${ROLE} LOGIN PASSWORD '${escapedPassword}';
        ELSE
          ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${escapedPassword}';
        END IF;
      END
      $$;
    `);

    // Least privilege: connect + read the schema, DML on every existing table, use every sequence.
    // No CREATE/DROP, no ownership, no superuser.
    await client.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${ROLE};`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${ROLE};`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE};`);
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${ROLE};`);

    // Future tables/sequences created by the owner (later migrations) inherit the same grants, so a
    // deploy that adds a migration does not silently leave the API without access to the new table.
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE};`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${ROLE};`);

    console.log(`setup-app-role: ${ROLE} provisioned on ${dbName} (least-privilege DML, non-owner).`);
    console.log(`setup-app-role: point the API at it via EE_LIBRARY_APP_DATABASE_URL; keep DATABASE_URL (owner) for migrate/worker.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`setup-app-role failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
