#!/usr/bin/env node
/**
 * File header: Drops the local public schema and re-applies migrations. Refuses non-local URLs unless --force is passed.
 */

import { loadEnvFile } from "./lib/dotenv.mjs";
import { connectClient, isLocalDatabase, requireDatabaseUrl } from "./lib/db.mjs";
import { applyPendingMigrations } from "./lib/migrations.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";

async function main() {
  await loadEnvFile(fromRepoRoot(".env"));

  const args = new Set(process.argv.slice(2));
  const force = args.has("--force");
  const databaseUrl = requireDatabaseUrl();

  if (!isLocalDatabase(databaseUrl) && !force) {
    console.error(
      "db:reset refused: DATABASE_URL is not localhost. Re-run with `-- --force` if you really mean it."
    );
    process.exitCode = 1;
    return;
  }

  const client = await connectClient();
  try {
    console.log("db:reset: dropping public schema");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");

    console.log("db:reset: applying migrations");
    const applied = await applyPendingMigrations(client);
    console.log(`db:reset: applied ${applied.length} migration(s)`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("db:reset failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
