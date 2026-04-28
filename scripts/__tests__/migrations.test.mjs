/**
 * File header: Tests that the migration discovery enumerates SQL files in a stable order.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { discoverMigrations, MIGRATIONS_DIR } from "../lib/migrations.mjs";

test("discoverMigrations returns SQL files sorted by filename", async () => {
  const files = await discoverMigrations();
  assert.ok(files.length >= 3, `expected at least 3 migrations, got ${files.length}: ${files.join(", ")}`);

  const sortedCopy = [...files].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(files, sortedCopy);

  for (const name of files) {
    assert.ok(name.toLowerCase().endsWith(".sql"), `non-SQL file in migrations: ${name}`);
  }
});

test("discoverMigrations includes the admin users migration", async () => {
  const files = await discoverMigrations();
  assert.ok(files.includes("003_admin_users.sql"), `expected 003_admin_users.sql in ${files.join(", ")}`);
  assert.ok(MIGRATIONS_DIR.endsWith("postgres"));
});
