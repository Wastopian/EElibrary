/**
 * File header: Tests BOM backfill queue creation, dedupe/re-queue rules, tenant scoping, and status reads.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import {
  readBomBackfillStatusForBomImport,
  setBomBackfillStorePoolForTests,
  startBomBackfillForBomImport
} from "./bom-backfill-store";
import { enterRequestContextForTests, runWithRequestContext } from "./request-context";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by BOM backfill store tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the test releases it. */
  end: () => Promise<void>;
};

test("backfill start queues one deduplicated request per unmatched exact-MPN row", async () => {
  const pool = createBomBackfillStorePool();
  setBomBackfillStorePoolForTests(pool);
  enterRequestContextForTests("org-default");
  await seedBomImport(pool, "bomimp-1", "proj-1");
  // Two rows share an identity module case/spacing; one is matched; one has no MPN at all.
  await seedBomLine(pool, "line-1", "bomimp-1", 1, "RC0402FR-0710KL", "YAGEO Corp", "unmatched");
  await seedBomLine(pool, "line-2", "bomimp-1", 2, "rc0402fr-0710kl", "yageo corp", "unmatched");
  await seedBomLine(pool, "line-3", "bomimp-1", 3, "GRM155R71C104KA88D", null, "unmatched");
  await seedBomLine(pool, "line-4", "bomimp-1", 4, "CL05B104KO5NNNC", "Samsung", "matched");
  await seedBomLine(pool, "line-5", "bomimp-1", 5, null, "Mystery Maker", "unmatched");

  try {
    const result = await startBomBackfillForBomImport("bomimp-1", "admin-user");

    assert.equal(result.status, "created");

    if (result.status !== "created") {
      return;
    }

    assert.equal(result.response.createdCount, 2, "case/space variants dedupe to one request");
    assert.equal(result.response.summary.totalCount, 2);
    assert.equal(result.response.summary.pendingCount, 2);
    assert.equal(result.response.summary.settled, false);
    assert.deepEqual(
      result.response.requests.map((row) => [row.mpn, row.manufacturerName, row.requestStatus]),
      [
        ["GRM155R71C104KA88D", null, "queued"],
        ["RC0402FR-0710KL", "YAGEO Corp", "queued"]
      ]
    );
  } finally {
    setBomBackfillStorePoolForTests(null);
    await pool.end();
  }
});

test("backfill start skips active and imported rows but re-queues terminal retryable rows", async () => {
  const pool = createBomBackfillStorePool();
  setBomBackfillStorePoolForTests(pool);
  enterRequestContextForTests("org-default");
  await seedBomImport(pool, "bomimp-1", "proj-1");
  await seedBomLine(pool, "line-1", "bomimp-1", 1, "MPN-QUEUED", null, "unmatched");
  await seedBomLine(pool, "line-2", "bomimp-1", 2, "MPN-IMPORTED", null, "unmatched");
  await seedBomLine(pool, "line-3", "bomimp-1", 3, "MPN-NOMATCH", null, "unmatched");
  await seedBackfillRequest(pool, "req-queued", "bomimp-1", "MPN-QUEUED", "queued");
  await seedBackfillRequest(pool, "req-imported", "bomimp-1", "MPN-IMPORTED", "imported");
  await seedBackfillRequest(pool, "req-nomatch", "bomimp-1", "MPN-NOMATCH", "no_match");

  try {
    const result = await startBomBackfillForBomImport("bomimp-1", "admin-user");

    assert.equal(result.status, "created");

    if (result.status !== "created") {
      return;
    }

    // Only the no_match row re-queues; queued and imported rows are skipped in place.
    assert.equal(result.response.createdCount, 1);
    assert.equal(result.response.skippedCount, 2);
    const byId = new Map(result.response.requests.map((row) => [row.id, row.requestStatus]));
    assert.equal(byId.get("req-queued"), "queued");
    assert.equal(byId.get("req-imported"), "imported");
    assert.equal(byId.get("req-nomatch"), "queued", "terminal retryable rows re-queue on a fresh start");
    assert.equal(result.response.summary.totalCount, 3);
  } finally {
    setBomBackfillStorePoolForTests(null);
    await pool.end();
  }
});

test("backfill status read buckets terminal rows and reports settled honestly", async () => {
  const pool = createBomBackfillStorePool();
  setBomBackfillStorePoolForTests(pool);
  enterRequestContextForTests("org-default");
  await seedBomImport(pool, "bomimp-1", "proj-1");
  await seedBackfillRequest(pool, "req-imported", "bomimp-1", "MPN-A", "imported");
  await seedBackfillRequest(pool, "req-choice", "bomimp-1", "MPN-B", "needs_choice");
  await seedBackfillRequest(pool, "req-nomatch", "bomimp-1", "MPN-C", "no_match");
  await seedBackfillRequest(pool, "req-failed", "bomimp-1", "MPN-D", "failed");

  try {
    const result = await readBomBackfillStatusForBomImport("bomimp-1");

    assert.equal(result.status, "available");

    if (result.status !== "available") {
      return;
    }

    assert.deepEqual(result.response.summary, {
      failedCount: 1,
      importedCount: 1,
      needsChoiceCount: 1,
      noMatchCount: 1,
      pendingCount: 0,
      settled: true,
      totalCount: 4
    });
  } finally {
    setBomBackfillStorePoolForTests(null);
    await pool.end();
  }
});

test("backfill routes are tenant-scoped: a foreign org reads not_found and a null tenant fails closed", async () => {
  const pool = createBomBackfillStorePool();
  setBomBackfillStorePoolForTests(pool);
  enterRequestContextForTests("org-default");
  await seedBomImport(pool, "bomimp-1", "proj-1");

  try {
    await runWithRequestContext("org-other", async () => {
      const foreignRead = await readBomBackfillStatusForBomImport("bomimp-1");
      assert.equal(foreignRead.status, "not_found");

      const foreignStart = await startBomBackfillForBomImport("bomimp-1", "admin-user");
      assert.equal(foreignStart.status, "not_found");
    });

    await runWithRequestContext(null, async () => {
      const nullRead = await readBomBackfillStatusForBomImport("bomimp-1");
      assert.equal(nullRead.status, "not_found");

      await assert.rejects(
        () => startBomBackfillForBomImport("bomimp-1", "admin-user"),
        /tenant|org/iu,
        "writes without a tenant must throw, never default"
      );
    });
  } finally {
    setBomBackfillStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Creates the minimal pg-mem schema the backfill store touches.
 */
function createBomBackfillStorePool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE bom_imports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      org_id TEXT DEFAULT 'org-default'
    );
    CREATE TABLE bom_lines (
      id TEXT PRIMARY KEY,
      bom_import_id TEXT NOT NULL,
      row_number INTEGER NOT NULL,
      raw_mpn TEXT,
      raw_manufacturer TEXT,
      match_status TEXT NOT NULL,
      org_id TEXT DEFAULT 'org-default'
    );
    CREATE TABLE bom_backfill_requests (
      id TEXT PRIMARY KEY,
      bom_import_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      mpn TEXT NOT NULL,
      manufacturer_name TEXT,
      request_status TEXT NOT NULL DEFAULT 'queued',
      candidates JSONB NOT NULL DEFAULT '[]',
      part_id TEXT,
      error_code TEXT,
      error_message TEXT,
      requested_by TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_updated_at TIMESTAMPTZ NOT NULL,
      org_id TEXT
    );
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Inserts one org-default BOM import header row.
 */
async function seedBomImport(pool: TestPool, bomImportId: string, projectId: string): Promise<void> {
  await pool.query("INSERT INTO bom_imports (id, project_id, org_id) VALUES ($1, $2, 'org-default')", [bomImportId, projectId]);
}

/**
 * Inserts one BOM line row with the given match state.
 */
async function seedBomLine(
  pool: TestPool,
  lineId: string,
  bomImportId: string,
  rowNumber: number,
  rawMpn: string | null,
  rawManufacturer: string | null,
  matchStatus: string
): Promise<void> {
  await pool.query(
    "INSERT INTO bom_lines (id, bom_import_id, row_number, raw_mpn, raw_manufacturer, match_status) VALUES ($1, $2, $3, $4, $5, $6)",
    [lineId, bomImportId, rowNumber, rawMpn, rawManufacturer, matchStatus]
  );
}

/**
 * Inserts one pre-existing backfill request in the given state.
 */
async function seedBackfillRequest(pool: TestPool, requestId: string, bomImportId: string, mpn: string, requestStatus: string): Promise<void> {
  await pool.query(
    `
      INSERT INTO bom_backfill_requests (
        id, bom_import_id, project_id, mpn, manufacturer_name, request_status,
        requested_by, requested_at, last_updated_at, org_id
      )
      VALUES ($1, $2, 'proj-1', $3, NULL, $4, 'admin-user', '2026-07-16T11:00:00.000Z', '2026-07-16T11:00:00.000Z', 'org-default')
    `,
    [requestId, bomImportId, mpn, requestStatus]
  );
}
