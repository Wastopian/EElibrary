/**
 * File header: Tests bulk readiness recompute paging, error recovery, and since-filter behaviour.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import {
  recomputeReadinessForAllParts,
  setPartRecomputeHandlerForTests,
  setWorkerRepositoryPoolForTests
} from "./catalog-repository";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by recompute tests. */
type TestPool = Pool & {
  end: () => Promise<void>;
};

test("recompute processes all parts and reports correct counts", async () => {
  const pool = createRecomputePool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPart(pool, "part-a", "2026-04-20T10:00:00.000Z");
  await seedPart(pool, "part-b", "2026-04-21T10:00:00.000Z");
  await seedPart(pool, "part-c", "2026-04-22T10:00:00.000Z");

  const recomputedIds: string[] = [];
  setPartRecomputeHandlerForTests(async (_client, partId) => {
    recomputedIds.push(partId);
  });

  try {
    const summary = await recomputeReadinessForAllParts(10);

    assert.equal(summary.processedCount, 3);
    assert.equal(summary.succeededCount, 3);
    assert.equal(summary.failedCount, 0);
    assert.deepEqual(summary.failedPartIds, []);
    assert.equal(summary.batchCount, 1);
    assert.deepEqual(recomputedIds.sort(), ["part-a", "part-b", "part-c"]);
  } finally {
    setPartRecomputeHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("recompute pages through parts when count exceeds batch size", async () => {
  const pool = createRecomputePool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPart(pool, "part-1", "2026-04-20T10:00:00.000Z");
  await seedPart(pool, "part-2", "2026-04-20T11:00:00.000Z");
  await seedPart(pool, "part-3", "2026-04-20T12:00:00.000Z");
  await seedPart(pool, "part-4", "2026-04-20T13:00:00.000Z");
  await seedPart(pool, "part-5", "2026-04-20T14:00:00.000Z");

  const recomputedIds: string[] = [];
  const batchProgressUpdates: number[] = [];
  setPartRecomputeHandlerForTests(async (_client, partId) => {
    recomputedIds.push(partId);
  });

  try {
    const summary = await recomputeReadinessForAllParts(2, undefined, (progress) => {
      batchProgressUpdates.push(progress.batchCount);
    });

    assert.equal(summary.processedCount, 5);
    assert.equal(summary.succeededCount, 5);
    assert.equal(summary.batchCount, 3);
    assert.equal(recomputedIds.length, 5);
    assert.deepEqual(batchProgressUpdates, [1, 2, 3]);
  } finally {
    setPartRecomputeHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("recompute continues after per-part errors and records failed part ids", async () => {
  const pool = createRecomputePool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPart(pool, "part-ok-1", "2026-04-20T10:00:00.000Z");
  await seedPart(pool, "part-fail", "2026-04-20T11:00:00.000Z");
  await seedPart(pool, "part-ok-2", "2026-04-20T12:00:00.000Z");

  setPartRecomputeHandlerForTests(async (_client, partId) => {
    if (partId === "part-fail") {
      throw new Error("simulated projection failure");
    }
  });

  try {
    const summary = await recomputeReadinessForAllParts(10);

    assert.equal(summary.processedCount, 3);
    assert.equal(summary.succeededCount, 2);
    assert.equal(summary.failedCount, 1);
    assert.deepEqual(summary.failedPartIds, ["part-fail"]);
  } finally {
    setPartRecomputeHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("recompute respects the since filter and skips older parts", async () => {
  const pool = createRecomputePool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPart(pool, "part-old", "2026-04-10T00:00:00.000Z");
  await seedPart(pool, "part-new-a", "2026-04-20T00:00:00.000Z");
  await seedPart(pool, "part-new-b", "2026-04-21T00:00:00.000Z");

  const recomputedIds: string[] = [];
  setPartRecomputeHandlerForTests(async (_client, partId) => {
    recomputedIds.push(partId);
  });

  try {
    const summary = await recomputeReadinessForAllParts(10, "2026-04-15T00:00:00.000Z");

    assert.equal(summary.processedCount, 2);
    assert.equal(summary.succeededCount, 2);
    assert.deepEqual(recomputedIds.sort(), ["part-new-a", "part-new-b"]);
    assert.ok(!recomputedIds.includes("part-old"), "old part should be skipped");
  } finally {
    setPartRecomputeHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("recompute returns empty summary when no parts match", async () => {
  const pool = createRecomputePool();
  setWorkerRepositoryPoolForTests(pool);

  const recomputedIds: string[] = [];
  setPartRecomputeHandlerForTests(async (_client, partId) => {
    recomputedIds.push(partId);
  });

  try {
    const summary = await recomputeReadinessForAllParts(10);

    assert.equal(summary.processedCount, 0);
    assert.equal(summary.succeededCount, 0);
    assert.equal(summary.failedCount, 0);
    assert.equal(summary.batchCount, 0);
    assert.deepEqual(recomputedIds, []);
  } finally {
    setPartRecomputeHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Builds a minimal in-memory schema for recompute paging tests.
 * Only the parts table is needed since the per-part handler is injected.
 */
function createRecomputePool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE parts (
      id TEXT PRIMARY KEY,
      last_updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Seeds one part row for recompute paging tests.
 */
async function seedPart(pool: TestPool, id: string, lastUpdatedAt: string): Promise<void> {
  await pool.query(
    `INSERT INTO parts (id, last_updated_at) VALUES ($1, $2)`,
    [id, lastUpdatedAt]
  );
}
