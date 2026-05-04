#!/usr/bin/env node
/**
 * File header: Prints applied and pending SQL migrations for the configured DATABASE_URL.
 */

import { loadEnvFile } from "./lib/dotenv.mjs";
import { connectClient } from "./lib/db.mjs";
import { discoverMigrations, readAppliedMigrations } from "./lib/migrations.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";

async function main() {
  await loadEnvFile(fromRepoRoot(".env"));

  const client = await connectClient();
  try {
    const all = await discoverMigrations();
    const applied = await readAppliedMigrations(client);

    console.log(`db:status: ${applied.size}/${all.length} applied`);
    for (const filename of all) {
      const marker = applied.has(filename) ? "[x]" : "[ ]";
      console.log(`  ${marker} ${filename}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("db:status failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
