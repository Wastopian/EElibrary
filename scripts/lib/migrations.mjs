/**
 * File header: Discovers SQL migrations in infra/postgres and applies them with provenance tracking.
 */

import { readdir, readFile } from "node:fs/promises";
import { fromRepoRoot } from "./paths.mjs";

/** MIGRATIONS_DIR is the canonical location for ordered SQL migrations. */
export const MIGRATIONS_DIR = fromRepoRoot("infra", "postgres");

/** SCHEMA_MIGRATIONS_TABLE_SQL creates the bookkeeping table used to track applied migrations. */
const SCHEMA_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

/**
 * Returns the ordered list of migration filenames in infra/postgres.
 * Only .sql files are returned; the bookkeeping table is created on demand by ensureMigrationsTable.
 */
export async function discoverMigrations() {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort((first, second) => first.localeCompare(second));
}

/**
 * Ensures the schema_migrations bookkeeping table exists.
 */
export async function ensureMigrationsTable(client) {
  await client.query(SCHEMA_MIGRATIONS_TABLE_SQL);
}

/**
 * Returns the set of already-applied migration filenames.
 */
export async function readAppliedMigrations(client) {
  await ensureMigrationsTable(client);
  const result = await client.query("SELECT filename FROM schema_migrations");
  return new Set(result.rows.map((row) => row.filename));
}

/**
 * Computes pending migrations from disk against the applied set.
 */
export async function computePendingMigrations(client) {
  const applied = await readAppliedMigrations(client);
  const all = await discoverMigrations();
  return all.filter((name) => !applied.has(name));
}

/**
 * Applies a single migration file inside its own transaction and records it in schema_migrations.
 * Existing migration SQL files are expected to use IF NOT EXISTS so re-running is safe in practice;
 * the bookkeeping table is the authoritative idempotency mechanism.
 */
export async function applyMigration(client, filename) {
  const sql = await readFile(`${MIGRATIONS_DIR}/${filename}`, "utf8");

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", [filename]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * Applies every pending migration in order. Returns the list of applied filenames.
 */
export async function applyPendingMigrations(client) {
  const pending = await computePendingMigrations(client);

  for (const filename of pending) {
    await applyMigration(client, filename);
  }

  return pending;
}
