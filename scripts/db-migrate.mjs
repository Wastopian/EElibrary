#!/usr/bin/env node
/**
 * File header: Applies any pending SQL migrations from infra/postgres against DATABASE_URL.
 */

import { loadEnvFile } from "./lib/dotenv.mjs";
import { connectClient } from "./lib/db.mjs";
import { applyPendingMigrations, computePendingMigrations } from "./lib/migrations.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";

async function main() {
  await loadEnvFile(fromRepoRoot(".env"));

  const client = await connectClient();
  try {
    const pending = await computePendingMigrations(client);

    if (pending.length === 0) {
      console.log("db:migrate: no pending migrations");
      return;
    }

    console.log(`db:migrate: applying ${pending.length} migration(s)`);
    for (const filename of pending) {
      console.log(`  - ${filename}`);
    }

    const applied = await applyPendingMigrations(client);
    console.log(`db:migrate: applied ${applied.length} migration(s)`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("db:migrate failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
