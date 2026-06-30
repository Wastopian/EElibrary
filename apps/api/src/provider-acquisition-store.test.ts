/**
 * File header: Tests provider acquisition job persistence, including concurrent duplicate recovery backed by the active-job unique index.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import {
  createProviderAcquisitionJobInDatabase,
  setCatalogStorePoolForTests,
  setProviderAcquisitionJobBeforeInsertHookForTests
} from "./catalog-store";
import { enterRequestContextForTests } from "./request-context";
import type { Pool } from "pg";
import type { ProviderAcquisitionJobCreateInput } from "@ee-library/shared/types";

/** TestPool is the pg-mem pool shape used by provider acquisition store tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the store test releases it. */
  end: () => Promise<void>;
};

test("createProviderAcquisitionJobInDatabase returns one active job when a concurrent insert wins the race", async () => {
  const pool = createProviderAcquisitionPool();
  setCatalogStorePoolForTests(pool);
  setProviderAcquisitionJobBeforeInsertHookForTests(async () => {
    await pool.query(
      `
        INSERT INTO provider_acquisition_jobs (
          id,
          provider_id,
          provider_part_key,
          requested_lookup,
          manufacturer_name,
          mpn,
          package_name,
          source_url,
          match_type,
          match_confidence,
          job_status,
          requested_by,
          requested_at,
          part_id,
          import_outcome,
          previous_import_status,
          error_code,
          error_message,
          started_at,
          completed_at,
          last_updated_at
        )
        VALUES (
          'acqjob-jlcparts-c1091-race-winner',
          'jlcparts',
          'C1091',
          'RC-02W300JT',
          'Guangdong Fenghua Advanced Tech',
          'RC-02W300JT',
          '0402',
          'https://lcsc.com/product-detail/example',
          'exact_provider_part_id',
          1,
          'queued',
          'race-winner',
          '2026-04-24T12:00:00.001Z',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-04-24T12:00:00.001Z'
        )
      `
    );
    await pool.query(
      `
        INSERT INTO provider_acquisition_job_events (id, job_id, event_type, message, detail, created_at)
        VALUES (
          'acqevent-jlcparts-c1091-race-winner',
          'acqjob-jlcparts-c1091-race-winner',
          'queued',
          'Acquisition job queued.',
          '{"providerPartKey":"C1091"}'::jsonb,
          '2026-04-24T12:00:00.001Z'
        )
      `
    );
    setProviderAcquisitionJobBeforeInsertHookForTests(null);
  });

  try {
    const result = await createProviderAcquisitionJobInDatabase(
      buildProviderAcquisitionInput(),
      "admin-user",
      "2026-04-24T12:00:00.000Z"
    );
    const jobRows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM provider_acquisition_jobs");
    const eventRows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM provider_acquisition_job_events");

    assert.equal(result.status, "created");
    assert.equal(result.response.job.id, "acqjob-jlcparts-c1091-race-winner");
    assert.equal(result.response.job.jobStatus, "queued");
    assert.equal(result.response.job.providerPartKey, "C1091");
    assert.equal(result.response.events.length, 1);
    assert.equal(result.response.events[0]?.eventType, "queued");
    assert.equal(jobRows.rows[0]?.count, "1");
    assert.equal(eventRows.rows[0]?.count, "1");
  } finally {
    setProviderAcquisitionJobBeforeInsertHookForTests(null);
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Builds one exact-match provider candidate input for provider acquisition store tests.
 */
function buildProviderAcquisitionInput(): ProviderAcquisitionJobCreateInput {
  return {
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    matchConfidence: 1,
    matchType: "exact_provider_part_id",
    mpn: "RC-02W300JT",
    package: "0402",
    providerId: "jlcparts",
    providerPartKey: "C1091",
    requestedLookup: "RC-02W300JT",
    sourceUrl: "https://lcsc.com/product-detail/example"
  };
}

/**
 * Creates a minimal in-memory schema for provider acquisition store persistence tests.
 */
function createProviderAcquisitionPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE parts (id TEXT PRIMARY KEY, org_id TEXT DEFAULT 'org-default');
    CREATE TABLE provider_acquisition_jobs (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_part_key TEXT NOT NULL,
      requested_lookup TEXT NOT NULL,
      manufacturer_name TEXT,
      mpn TEXT,
      package_name TEXT,
      source_url TEXT,
      match_type TEXT NOT NULL,
      match_confidence NUMERIC NOT NULL,
      job_status TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL,
      part_id TEXT REFERENCES parts(id),
      import_outcome TEXT,
      previous_import_status TEXT,
      error_code TEXT,
      error_message TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      org_id TEXT DEFAULT 'org-default',
      last_updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE UNIQUE INDEX uq_provider_acquisition_jobs_active_provider_part
      ON provider_acquisition_jobs (provider_id, provider_part_key)
      WHERE job_status IN ('queued', 'running');
    CREATE TABLE provider_acquisition_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES provider_acquisition_jobs(id),
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      detail JSONB,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  // createProviderAcquisitionJobInDatabase stamps the acting org on the job; run as org-default.
  enterRequestContextForTests("org-default");

  return new MemoryPool() as TestPool;
}
