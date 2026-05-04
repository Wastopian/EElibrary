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

test("discoverMigrations includes the worker heartbeats migration", async () => {
  const files = await discoverMigrations();
  assert.ok(
    files.some((name) => name.endsWith("worker_heartbeats.sql")),
    `expected a *_worker_heartbeats.sql migration in ${files.join(", ")}`
  );
  assert.ok(MIGRATIONS_DIR.endsWith("postgres"));
});

test("discoverMigrations includes the auth users migration", async () => {
  const files = await discoverMigrations();

  assert.ok(
    files.some((name) => name.endsWith("auth_users.sql")),
    `expected a *_auth_users.sql migration in ${files.join(", ")}`
  );
});

test("discoverMigrations includes the project and BOM memory migration", async () => {
  const files = await discoverMigrations();

  assert.ok(
    files.some((name) => name.endsWith("project_bom_memory.sql")),
    `expected a *_project_bom_memory.sql migration in ${files.join(", ")}`
  );
});

test("discoverMigrations includes the project health evidence migration", async () => {
  const files = await discoverMigrations();

  assert.ok(
    files.some((name) => name.endsWith("project_health_evidence.sql")),
    `expected a *_project_health_evidence.sql migration in ${files.join(", ")}`
  );
});

test("discoverMigrations includes the circuit blocks migration", async () => {
  const files = await discoverMigrations();

  assert.ok(
    files.some((name) => name.endsWith("circuit_blocks.sql")),
    `expected a *_circuit_blocks.sql migration in ${files.join(", ")}`
  );
});

test("discoverMigrations includes the follow-up records migration", async () => {
  const files = await discoverMigrations();

  assert.ok(
    files.some((name) => name.endsWith("follow_up_records.sql")),
    `expected a *_follow_up_records.sql migration in ${files.join(", ")}`
  );
});

test("discoverMigrations includes the circuit block instantiation migration", async () => {
  const files = await discoverMigrations();

  assert.ok(
    files.some((name) => name.endsWith("circuit_block_instantiation.sql")),
    `expected a *_circuit_block_instantiation.sql migration in ${files.join(", ")}`
  );
});

test("discoverMigrations includes the part substitutions migration", async () => {
  const files = await discoverMigrations();

  assert.ok(
    files.some((name) => name.endsWith("part_substitutions.sql")),
    `expected a *_part_substitutions.sql migration in ${files.join(", ")}`
  );
});
