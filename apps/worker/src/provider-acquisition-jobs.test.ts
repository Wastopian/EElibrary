/**
 * File header: Tests provider acquisition job claiming, identifier handling, and coarse lifecycle persistence.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { setWorkerRepositoryPoolForTests } from "./catalog-repository";
import {
  processNextProviderAcquisitionJob,
  processProviderAcquisitionJobs,
  setProviderAcquisitionImportRunnerForTests
} from "./provider-acquisition-jobs";
import type { Pool } from "pg";
import type { ImportResultSummary, ProviderPartRequest } from "./provider-part-import";

/** TestPool is the pg-mem pool shape used by provider acquisition worker tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the test releases it. */
  end: () => Promise<void>;
};

test("provider acquisition worker claims the oldest queued job, marks running before import, and succeeds with part id", async () => {
  const pool = createProviderAcquisitionPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartRow(pool, "part-jlcparts-c1091");
  await seedQueuedJob(pool, "acqjob-older", "2026-04-24T12:00:00.000Z", "C1091", "RC-02W300JT");
  await seedQueuedJob(pool, "acqjob-newer", "2026-04-24T12:05:00.000Z", "C2040", "RC-03W100JT");
  const runnerCalls: ProviderPartRequest[] = [];

  setProviderAcquisitionImportRunnerForTests(async (_providerId, request) => {
    runnerCalls.push(request);
    const runningRow = await pool.query<{ job_status: string; started_at: Date | null }>(
      "SELECT job_status, started_at FROM provider_acquisition_jobs WHERE id = 'acqjob-older'"
    );

    assert.equal(runningRow.rows[0]?.job_status, "running");
    assert.ok(runningRow.rows[0]?.started_at);

    return buildImportSummary("part-jlcparts-c1091", "C1091");
  });

  try {
    const result = await processNextProviderAcquisitionJob();
    const succeededJob = await pool.query<{ job_status: string; part_id: string | null; import_outcome: string | null }>(
      "SELECT job_status, part_id, import_outcome FROM provider_acquisition_jobs WHERE id = 'acqjob-older'"
    );
    const newerJob = await pool.query<{ job_status: string }>(
      "SELECT job_status FROM provider_acquisition_jobs WHERE id = 'acqjob-newer'"
    );
    const events = await pool.query<{ event_type: string; message: string }>(
      "SELECT event_type, message FROM provider_acquisition_job_events WHERE job_id = 'acqjob-older' ORDER BY created_at ASC"
    );
    const enrichmentJobs = await pool.query<{ part_id: string; job_type: string }>(
      "SELECT part_id, job_type FROM provider_enrichment_jobs ORDER BY requested_at ASC"
    );

    assert.deepEqual(result, {
      errorCode: null,
      jobId: "acqjob-older",
      partId: "part-jlcparts-c1091",
      providerId: "jlcparts",
      providerPartKey: "C1091",
      status: "succeeded"
    });
    assert.equal(runnerCalls[0]?.providerPartId, "C1091");
    assert.equal(runnerCalls[0]?.mpn, "RC-02W300JT");
    assert.equal(succeededJob.rows[0]?.job_status, "succeeded");
    assert.equal(succeededJob.rows[0]?.part_id, "part-jlcparts-c1091");
    assert.equal(succeededJob.rows[0]?.import_outcome, "new_import");
    assert.equal(newerJob.rows[0]?.job_status, "queued");
    assert.deepEqual(events.rows.map((row) => row.event_type), ["queued", "running", "succeeded"]);
    assert.deepEqual(enrichmentJobs.rows, [
      {
        job_type: "datasheet_capture",
        part_id: "part-jlcparts-c1091"
      }
    ]);
  } finally {
    setProviderAcquisitionImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider acquisition worker enqueues datasheet capture only when datasheet evidence is missing", async () => {
  const pool = createProviderAcquisitionPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartRow(pool, "part-needs-datasheet");
  await seedPartRow(pool, "part-has-datasheet");
  await seedQueuedJob(pool, "acqjob-needs-datasheet", "2026-04-24T12:00:00.000Z", "C1091", "RC-02W300JT");
  await seedQueuedJob(pool, "acqjob-has-datasheet", "2026-04-24T12:05:00.000Z", "C2040", "RC-03W100JT");
  await pool.query(
    `
      INSERT INTO assets (
        id,
        part_id,
        asset_type,
        file_format,
        storage_key,
        file_hash,
        provider_id,
        license_mode,
        provenance,
        availability_status,
        review_status,
        export_status,
        asset_status,
        generation_method,
        generation_source_asset_id,
        validation_status,
        preview_status,
        asset_state,
        source_url,
        source_record_id,
        last_updated_at
      )
      VALUES (
        'asset-existing-datasheet',
        'part-has-datasheet',
        'datasheet',
        'pdf',
        'datasheets/part-has-datasheet.pdf',
        'deadbeefhashvalue',
        'jlcparts',
        'metadata_only',
        'trusted_external',
        'downloaded',
        'not_reviewed',
        'not_exportable',
        'downloaded',
        NULL,
        NULL,
        'not_validated',
        'not_available',
        'downloaded',
        'https://example.test/datasheet.pdf',
        NULL,
        '2026-04-24T12:00:00.000Z'
      )
    `
  );
  const partIdsByJobId = new Map<string, string>([
    ["acqjob-needs-datasheet", "part-needs-datasheet"],
    ["acqjob-has-datasheet", "part-has-datasheet"]
  ]);

  setProviderAcquisitionImportRunnerForTests(async (_providerId, request) => {
    const partId = partIdsByJobId.get(
      request.providerPartId === "C1091" ? "acqjob-needs-datasheet" : "acqjob-has-datasheet"
    );

    if (!partId) {
      throw new Error("Expected mapped part id for test import summary.");
    }

    return buildImportSummary(partId, request.providerPartId ?? "unknown");
  });

  try {
    await processNextProviderAcquisitionJob();
    await processNextProviderAcquisitionJob();

    const enrichmentJobs = await pool.query<{ part_id: string }>(
      "SELECT part_id FROM provider_enrichment_jobs ORDER BY part_id ASC"
    );

    assert.deepEqual(enrichmentJobs.rows, [{ part_id: "part-needs-datasheet" }]);
  } finally {
    setProviderAcquisitionImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider acquisition worker marks failed jobs and records a failed event", async () => {
  const pool = createProviderAcquisitionPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedQueuedJob(pool, "acqjob-fail", "2026-04-24T12:00:00.000Z", "C9999", "MISSING");
  setProviderAcquisitionImportRunnerForTests(async () => {
    throw new Error("jlcparts metadata record not found for MISSING");
  });

  try {
    const result = await processNextProviderAcquisitionJob();
    const failedJob = await pool.query<{ job_status: string; error_code: string | null; error_message: string | null }>(
      "SELECT job_status, error_code, error_message FROM provider_acquisition_jobs WHERE id = 'acqjob-fail'"
    );
    const events = await pool.query<{ event_type: string; detail: { errorCode?: string } | null }>(
      "SELECT event_type, detail FROM provider_acquisition_job_events WHERE job_id = 'acqjob-fail' ORDER BY created_at ASC"
    );

    assert.deepEqual(result, {
      errorCode: "PROVIDER_IMPORT_FAILED",
      jobId: "acqjob-fail",
      partId: null,
      providerId: "jlcparts",
      providerPartKey: "C9999",
      status: "failed"
    });
    assert.equal(failedJob.rows[0]?.job_status, "failed");
    assert.equal(failedJob.rows[0]?.error_code, "PROVIDER_IMPORT_FAILED");
    assert.match(failedJob.rows[0]?.error_message ?? "", /No matching catalog entry/u);
    assert.deepEqual(events.rows.map((row) => row.event_type), ["queued", "running", "failed"]);
  } finally {
    setProviderAcquisitionImportRunnerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider acquisition worker no-ops cleanly when no queued jobs exist", async () => {
  const pool = createProviderAcquisitionPool();
  setWorkerRepositoryPoolForTests(pool);

  try {
    const nextJob = await processNextProviderAcquisitionJob();
    const summary = await processProviderAcquisitionJobs(5);

    assert.equal(nextJob, null);
    assert.deepEqual(summary.processed, []);
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Builds a minimal in-memory schema for acquisition queue worker tests.
 */
function createProviderAcquisitionPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE parts (
      id TEXT PRIMARY KEY
    );
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
      part_id TEXT,
      import_outcome TEXT,
      previous_import_status TEXT,
      error_code TEXT,
      error_message TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE provider_acquisition_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      detail JSONB,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE provider_enrichment_jobs (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      source_acquisition_job_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      job_status TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error_code TEXT,
      error_message TEXT,
      last_updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE provider_enrichment_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      detail JSONB,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      file_format TEXT NOT NULL,
      storage_key TEXT,
      file_hash TEXT,
      provider_id TEXT,
      license_mode TEXT NOT NULL,
      provenance TEXT NOT NULL,
      availability_status TEXT NOT NULL,
      review_status TEXT NOT NULL,
      export_status TEXT NOT NULL,
      asset_status TEXT NOT NULL,
      generation_method TEXT,
      generation_source_asset_id TEXT,
      validation_status TEXT NOT NULL,
      preview_status TEXT NOT NULL,
      asset_state TEXT NOT NULL,
      source_url TEXT,
      source_record_id TEXT,
      last_updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Inserts one canonical part row so acquisition-success enrichment can reference it safely.
 */
async function seedPartRow(pool: TestPool, partId: string): Promise<void> {
  await pool.query(`INSERT INTO parts (id) VALUES ($1)`, [partId]);
}

/**
 * Inserts one queued provider acquisition job plus its initial queued event.
 */
async function seedQueuedJob(pool: TestPool, jobId: string, requestedAt: string, providerPartKey: string, mpn: string): Promise<void> {
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
      VALUES ($1, 'jlcparts', $2, $3, 'Guangdong Fenghua Advanced Tech', $3, '0402', 'https://lcsc.com/product-detail/example', 'exact_provider_part_id', 1, 'queued', 'admin-user', $4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, $4)
    `,
    [jobId, providerPartKey, mpn, requestedAt]
  );
  await pool.query(
    `
      INSERT INTO provider_acquisition_job_events (id, job_id, event_type, message, detail, created_at)
      VALUES ($1, $2, 'queued', 'Acquisition job queued.', NULL, $3)
    `,
    [`event-${jobId}-queued`, jobId, requestedAt]
  );
}

/**
 * Builds a concise successful import summary for acquisition queue tests.
 */
function buildImportSummary(partId: string, providerPartKey: string): ImportResultSummary {
  return {
    durationMs: 1,
    importStatus: "imported",
    outcome: "new_import",
    partId,
    previousImportStatus: null,
    providerId: "jlcparts",
    providerPartKey,
    requestedLookup: providerPartKey,
    sourceLastImportedAt: "2026-04-24T12:00:05.000Z",
    sourceLastSeenAt: "2026-04-24T12:00:05.000Z",
    timings: []
  };
}
