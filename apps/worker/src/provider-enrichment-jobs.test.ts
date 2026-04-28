/**
 * File header: Tests provider enrichment queue dedupe, claim order, and datasheet-capture outcomes.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { newDb } from "pg-mem";
import { setWorkerRepositoryPoolForTests } from "./catalog-repository";
import {
  enqueueProviderEnrichmentJobsForPart,
  processNextProviderEnrichmentJob,
  processProviderEnrichmentJobs,
  setDatasheetFetcherForTests,
  setProviderEnrichmentDatasheetCaptureHandlerForTests,
  setProviderEnrichmentJobBeforeInsertHookForTests
} from "./provider-enrichment-jobs";
import { setWorkerStorageClientForTests } from "./file-storage";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by provider enrichment worker tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the test releases it. */
  end: () => Promise<void>;
};

test("enqueueProviderEnrichmentJobsForPart only queues datasheet capture when datasheet evidence is missing", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartAndAcquisition(pool, "part-missing", "acqjob-missing");
  await seedPartAndAcquisition(pool, "part-has-datasheet", "acqjob-has-datasheet");
  await pool.query(
    `
      INSERT INTO assets (
        id, part_id, asset_type, file_format,
        storage_key, file_hash,
        provider_id, license_mode, provenance,
        availability_status, review_status, export_status,
        asset_status, generation_method, generation_source_asset_id,
        validation_status, preview_status, asset_state,
        source_url, source_record_id, last_updated_at
      )
      VALUES (
        'asset-existing-datasheet', 'part-has-datasheet', 'datasheet', 'pdf',
        'datasheets/part-has-datasheet.pdf', 'abc123hashvalue',
        'jlcparts', 'metadata_only', 'trusted_external',
        'downloaded', 'not_reviewed', 'not_exportable',
        'downloaded', NULL, NULL,
        'not_validated', 'not_available', 'downloaded',
        'https://example.test/datasheet.pdf', NULL, '2026-04-24T12:00:00.000Z'
      )
    `
  );

  try {
    const missingResult = await enqueueProviderEnrichmentJobsForPart({
      partId: "part-missing",
      requestedAt: "2026-04-24T12:00:00.000Z",
      requestedBy: "admin-user",
      sourceAcquisitionJobId: "acqjob-missing"
    });
    const existingResult = await enqueueProviderEnrichmentJobsForPart({
      partId: "part-has-datasheet",
      requestedAt: "2026-04-24T12:01:00.000Z",
      requestedBy: "admin-user",
      sourceAcquisitionJobId: "acqjob-has-datasheet"
    });
    const jobRows = await pool.query<{ part_id: string; job_type: string }>(
      "SELECT part_id, job_type FROM provider_enrichment_jobs ORDER BY part_id ASC"
    );

    assert.equal(missingResult.createdJobs.length, 1);
    assert.equal(missingResult.createdJobs[0]?.jobType, "datasheet_capture");
    assert.equal(existingResult.createdJobs.length, 0);
    assert.equal(existingResult.reusedJobs.length, 0);
    assert.deepEqual(jobRows.rows, [
      {
        job_type: "datasheet_capture",
        part_id: "part-missing"
      }
    ]);
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("enqueueProviderEnrichmentJobsForPart returns one active job when a concurrent insert wins the race", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartAndAcquisition(pool, "part-race", "acqjob-race");
  setProviderEnrichmentJobBeforeInsertHookForTests(async () => {
    await pool.query(
      `
        INSERT INTO provider_enrichment_jobs (
          id,
          part_id,
          source_acquisition_job_id,
          job_type,
          job_status,
          requested_by,
          requested_at,
          started_at,
          completed_at,
          error_code,
          error_message,
          last_updated_at
        )
        VALUES (
          'enrichjob-race-winner',
          'part-race',
          'acqjob-race',
          'datasheet_capture',
          'queued',
          'race-winner',
          '2026-04-24T12:00:00.001Z',
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
        INSERT INTO provider_enrichment_job_events (id, job_id, event_type, message, detail, created_at)
        VALUES (
          'enrichevent-race-winner',
          'enrichjob-race-winner',
          'queued',
          'Enrichment job queued.',
          '{"jobType":"datasheet_capture"}'::jsonb,
          '2026-04-24T12:00:00.001Z'
        )
      `
    );
    setProviderEnrichmentJobBeforeInsertHookForTests(null);
  });

  try {
    const result = await enqueueProviderEnrichmentJobsForPart({
      partId: "part-race",
      requestedAt: "2026-04-24T12:00:00.000Z",
      requestedBy: "admin-user",
      sourceAcquisitionJobId: "acqjob-race"
    });
    const jobRows = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM provider_enrichment_jobs"
    );
    const eventRows = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM provider_enrichment_job_events"
    );

    assert.equal(result.createdJobs.length, 0);
    assert.equal(result.reusedJobs.length, 1);
    assert.equal(result.reusedJobs[0]?.id, "enrichjob-race-winner");
    assert.equal(jobRows.rows[0]?.count, "1");
    assert.equal(eventRows.rows[0]?.count, "1");
  } finally {
    setProviderEnrichmentJobBeforeInsertHookForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider enrichment worker claims the oldest queued job, marks running before handler execution, and succeeds", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartAndAcquisition(pool, "part-older", "acqjob-older");
  await seedPartAndAcquisition(pool, "part-newer", "acqjob-newer");
  await seedQueuedEnrichmentJob(
    pool,
    "enrichjob-older",
    "part-older",
    "acqjob-older",
    "2026-04-24T12:00:00.000Z"
  );
  await seedQueuedEnrichmentJob(
    pool,
    "enrichjob-newer",
    "part-newer",
    "acqjob-newer",
    "2026-04-24T12:05:00.000Z"
  );

  setProviderEnrichmentDatasheetCaptureHandlerForTests(async (job) => {
    const runningRow = await pool.query<{ job_status: string; started_at: Date | null }>(
      "SELECT job_status, started_at FROM provider_enrichment_jobs WHERE id = 'enrichjob-older'"
    );

    assert.equal(job.id, "enrichjob-older");
    assert.equal(runningRow.rows[0]?.job_status, "running");
    assert.ok(runningRow.rows[0]?.started_at);

    return {
      detail: {
        result: "captured"
      },
      message: "Referenced datasheet evidence was captured from provider source data."
    };
  });

  try {
    const result = await processNextProviderEnrichmentJob();
    const succeededJob = await pool.query<{ job_status: string }>(
      "SELECT job_status FROM provider_enrichment_jobs WHERE id = 'enrichjob-older'"
    );
    const newerJob = await pool.query<{ job_status: string }>(
      "SELECT job_status FROM provider_enrichment_jobs WHERE id = 'enrichjob-newer'"
    );
    const events = await pool.query<{ event_type: string }>(
      "SELECT event_type FROM provider_enrichment_job_events WHERE job_id = 'enrichjob-older' ORDER BY created_at ASC"
    );

    assert.deepEqual(result, {
      errorCode: null,
      jobId: "enrichjob-older",
      jobType: "datasheet_capture",
      partId: "part-older",
      status: "succeeded"
    });
    assert.equal(succeededJob.rows[0]?.job_status, "succeeded");
    assert.equal(newerJob.rows[0]?.job_status, "queued");
    assert.deepEqual(events.rows.map((row) => row.event_type), ["queued", "running", "succeeded"]);
  } finally {
    setProviderEnrichmentDatasheetCaptureHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider enrichment worker succeeds as a no-op when datasheet evidence already exists", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartAndAcquisition(pool, "part-noop", "acqjob-noop");
  await seedQueuedEnrichmentJob(
    pool,
    "enrichjob-noop",
    "part-noop",
    "acqjob-noop",
    "2026-04-24T12:00:00.000Z"
  );
  await pool.query(
    `
      INSERT INTO assets (
        id, part_id, asset_type, file_format,
        storage_key, file_hash,
        provider_id, license_mode, provenance,
        availability_status, review_status, export_status,
        asset_status, generation_method, generation_source_asset_id,
        validation_status, preview_status, asset_state,
        source_url, source_record_id, last_updated_at
      )
      VALUES (
        'asset-noop-datasheet', 'part-noop', 'datasheet', 'pdf',
        'datasheets/part-noop.pdf', 'alreadyhashednoop',
        'jlcparts', 'metadata_only', 'trusted_external',
        'downloaded', 'not_reviewed', 'not_exportable',
        'downloaded', NULL, NULL,
        'not_validated', 'not_available', 'downloaded',
        'https://example.test/datasheet.pdf', NULL, '2026-04-24T12:00:00.000Z'
      )
    `
  );

  try {
    const result = await processNextProviderEnrichmentJob();
    const succeededJob = await pool.query<{ job_status: string; error_code: string | null }>(
      "SELECT job_status, error_code FROM provider_enrichment_jobs WHERE id = 'enrichjob-noop'"
    );
    const succeededEvent = await pool.query<{ message: string }>(
      "SELECT message FROM provider_enrichment_job_events WHERE job_id = 'enrichjob-noop' AND event_type = 'succeeded'"
    );

    assert.deepEqual(result, {
      errorCode: null,
      jobId: "enrichjob-noop",
      jobType: "datasheet_capture",
      partId: "part-noop",
      status: "succeeded"
    });
    assert.equal(succeededJob.rows[0]?.job_status, "succeeded");
    assert.equal(succeededJob.rows[0]?.error_code, null);
    assert.match(
      succeededEvent.rows[0]?.message ?? "",
      /already downloaded/i
    );
  } finally {
    setProviderEnrichmentDatasheetCaptureHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider enrichment worker writes a clear failed state when no official datasheet source exists", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartAndAcquisition(pool, "part-no-source", "acqjob-no-source");
  await seedQueuedEnrichmentJob(
    pool,
    "enrichjob-no-source",
    "part-no-source",
    "acqjob-no-source",
    "2026-04-24T12:00:00.000Z"
  );
  await pool.query(
    `
      INSERT INTO source_records (
        id,
        provider_id,
        provider_part_key,
        part_id,
        source_url,
        fetched_at,
        raw_payload,
        normalized_at,
        source_last_seen_at,
        source_last_imported_at,
        import_status,
        import_error_details,
        last_updated_at
      )
      VALUES (
        'source-no-source',
        'jlcparts',
        'C4040',
        'part-no-source',
        'https://lcsc.com/product-detail/example',
        '2026-04-24T12:00:00.000Z',
        '{"component":{"lcsc":"C4040","mfr":"MISSING"}}'::jsonb,
        '2026-04-24T12:00:00.000Z',
        '2026-04-24T12:00:00.000Z',
        '2026-04-24T12:00:00.000Z',
        'imported',
        NULL,
        '2026-04-24T12:00:00.000Z'
      )
    `
  );

  try {
    const result = await processNextProviderEnrichmentJob();
    const failedJob = await pool.query<{ job_status: string; error_code: string | null; error_message: string | null }>(
      "SELECT job_status, error_code, error_message FROM provider_enrichment_jobs WHERE id = 'enrichjob-no-source'"
    );
    const events = await pool.query<{ event_type: string }>(
      "SELECT event_type FROM provider_enrichment_job_events WHERE job_id = 'enrichjob-no-source' ORDER BY created_at ASC"
    );

    assert.deepEqual(result, {
      errorCode: "NO_DATASHEET_SOURCE",
      jobId: "enrichjob-no-source",
      jobType: "datasheet_capture",
      partId: "part-no-source",
      status: "failed"
    });
    assert.equal(failedJob.rows[0]?.job_status, "failed");
    assert.equal(failedJob.rows[0]?.error_code, "NO_DATASHEET_SOURCE");
    assert.match(failedJob.rows[0]?.error_message ?? "", /official provider datasheet source/i);
    assert.deepEqual(events.rows.map((row) => row.event_type), ["queued", "running", "failed"]);
  } finally {
    setProviderEnrichmentDatasheetCaptureHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider enrichment worker no-ops cleanly when no queued jobs exist", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);

  try {
    const nextJob = await processNextProviderEnrichmentJob();
    const summary = await processProviderEnrichmentJobs(5);

    assert.equal(nextJob, null);
    assert.deepEqual(summary.processed, []);
  } finally {
    setProviderEnrichmentDatasheetCaptureHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider enrichment worker downloads datasheet and advances asset to downloaded state", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartAndAcquisition(pool, "part-dl", "acqjob-dl");
  await seedQueuedEnrichmentJob(pool, "enrichjob-dl", "part-dl", "acqjob-dl", "2026-04-24T12:00:00.000Z");

  await pool.query(
    `INSERT INTO source_records (
       id, provider_id, provider_part_key, part_id, source_url, fetched_at,
       raw_payload, normalized_at, source_last_seen_at, source_last_imported_at,
       import_status, import_error_details, last_updated_at
     ) VALUES (
       'source-dl', 'jlcparts', 'C9999', 'part-dl',
       'https://lcsc.com/product-detail/example', '2026-04-24T12:00:00.000Z',
       $1::jsonb,
       '2026-04-24T12:00:00.000Z', '2026-04-24T12:00:00.000Z', '2026-04-24T12:00:00.000Z',
       'imported', NULL, '2026-04-24T12:00:00.000Z'
     )`,
    [JSON.stringify({ component: { lcsc: "C9999", datasheet: "https://example.test/C9999.pdf" } })]
  );

  await pool.query(
    `INSERT INTO assets (
       id, part_id, asset_type, file_format,
       storage_key, file_hash,
       provider_id, license_mode, provenance,
       availability_status, review_status, export_status,
       asset_status, generation_method, generation_source_asset_id,
       validation_status, preview_status, asset_state,
       source_url, source_record_id, last_updated_at
     ) VALUES (
       'asset-dl', 'part-dl', 'datasheet', 'pdf',
       NULL, NULL,
       'jlcparts', 'metadata_only', 'trusted_external',
       'referenced', 'not_reviewed', 'not_exportable',
       'referenced', NULL, NULL,
       'not_validated', 'not_available', 'referenced',
       'https://example.test/C9999.pdf', 'source-dl', '2026-04-24T12:00:00.000Z'
     )`
  );

  const pdfBytes = Buffer.from("%PDF-1.4 test datasheet content for C9999");
  const expectedHash = createHash("sha256").update(pdfBytes).digest("hex");
  const writtenFiles: Array<{ key: string; bytes: Buffer }> = [];

  setDatasheetFetcherForTests(async () => new Response(pdfBytes));
  setWorkerStorageClientForTests({
    backend: "local",
    getDownloadUrl: async () => null,
    write: async (key, bytes) => { writtenFiles.push({ bytes, key }); }
  } as FileStorageClient);

  try {
    const result = await processNextProviderEnrichmentJob();
    const assetRow = await pool.query<{
      availability_status: string;
      storage_key: string | null;
      file_hash: string | null;
    }>("SELECT availability_status, storage_key, file_hash FROM assets WHERE id = 'asset-dl'");

    assert.deepEqual(result, {
      errorCode: null,
      jobId: "enrichjob-dl",
      jobType: "datasheet_capture",
      partId: "part-dl",
      status: "succeeded"
    });
    assert.equal(assetRow.rows[0]?.availability_status, "downloaded");
    assert.equal(assetRow.rows[0]?.storage_key, "datasheets/part-dl.pdf");
    assert.equal(assetRow.rows[0]?.file_hash, expectedHash);
    assert.equal(writtenFiles.length, 1);
    assert.equal(writtenFiles[0]?.key, "datasheets/part-dl.pdf");
  } finally {
    setDatasheetFetcherForTests(null);
    setWorkerStorageClientForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider enrichment worker fails job with DATASHEET_FETCH_FAILED when HTTP fetch throws", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartAndAcquisition(pool, "part-fetchfail", "acqjob-fetchfail");
  await seedQueuedEnrichmentJob(
    pool, "enrichjob-fetchfail", "part-fetchfail", "acqjob-fetchfail", "2026-04-24T12:00:00.000Z"
  );

  await pool.query(
    `INSERT INTO source_records (
       id, provider_id, provider_part_key, part_id, source_url, fetched_at,
       raw_payload, normalized_at, source_last_seen_at, source_last_imported_at,
       import_status, import_error_details, last_updated_at
     ) VALUES (
       'source-fetchfail', 'jlcparts', 'C8888', 'part-fetchfail',
       'https://lcsc.com/product-detail/example', '2026-04-24T12:00:00.000Z',
       $1::jsonb,
       '2026-04-24T12:00:00.000Z', '2026-04-24T12:00:00.000Z', '2026-04-24T12:00:00.000Z',
       'imported', NULL, '2026-04-24T12:00:00.000Z'
     )`,
    [JSON.stringify({ component: { lcsc: "C8888", datasheet: "https://example.test/C8888.pdf" } })]
  );

  await pool.query(
    `INSERT INTO assets (
       id, part_id, asset_type, file_format,
       storage_key, file_hash,
       provider_id, license_mode, provenance,
       availability_status, review_status, export_status,
       asset_status, generation_method, generation_source_asset_id,
       validation_status, preview_status, asset_state,
       source_url, source_record_id, last_updated_at
     ) VALUES (
       'asset-fetchfail', 'part-fetchfail', 'datasheet', 'pdf',
       NULL, NULL,
       'jlcparts', 'metadata_only', 'trusted_external',
       'referenced', 'not_reviewed', 'not_exportable',
       'referenced', NULL, NULL,
       'not_validated', 'not_available', 'referenced',
       'https://example.test/C8888.pdf', 'source-fetchfail', '2026-04-24T12:00:00.000Z'
     )`
  );

  setDatasheetFetcherForTests(async () => { throw new Error("Connection refused"); });

  try {
    const result = await processNextProviderEnrichmentJob();
    const assetRow = await pool.query<{ availability_status: string }>(
      "SELECT availability_status FROM assets WHERE id = 'asset-fetchfail'"
    );

    assert.deepEqual(result, {
      errorCode: "DATASHEET_FETCH_FAILED",
      jobId: "enrichjob-fetchfail",
      jobType: "datasheet_capture",
      partId: "part-fetchfail",
      status: "failed"
    });
    assert.equal(assetRow.rows[0]?.availability_status, "referenced");
  } finally {
    setDatasheetFetcherForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Creates a minimal in-memory schema for provider enrichment queue tests.
 */
function createProviderEnrichmentPool(): TestPool {
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
    CREATE TABLE provider_enrichment_jobs (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL REFERENCES parts(id),
      source_acquisition_job_id TEXT NOT NULL REFERENCES provider_acquisition_jobs(id),
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
    CREATE UNIQUE INDEX uq_provider_enrichment_jobs_active_part_job_type
      ON provider_enrichment_jobs (part_id, job_type)
      WHERE job_status IN ('queued', 'running');
    CREATE TABLE provider_enrichment_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES provider_enrichment_jobs(id),
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
    CREATE TABLE source_records (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_part_key TEXT NOT NULL,
      part_id TEXT,
      source_url TEXT,
      fetched_at TIMESTAMPTZ NOT NULL,
      raw_payload JSONB NOT NULL,
      normalized_at TIMESTAMPTZ,
      source_last_seen_at TIMESTAMPTZ NOT NULL,
      source_last_imported_at TIMESTAMPTZ,
      import_status TEXT NOT NULL,
      import_error_details TEXT,
      last_updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Inserts one canonical part row plus the succeeded acquisition row that enrichment jobs reference.
 */
async function seedPartAndAcquisition(
  pool: TestPool,
  partId: string,
  acquisitionJobId: string
): Promise<void> {
  await pool.query(`INSERT INTO parts (id) VALUES ($1)`, [partId]);
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
        $1,
        'jlcparts',
        'C1091',
        'RC-02W300JT',
        'Guangdong Fenghua Advanced Tech',
        'RC-02W300JT',
        '0402',
        'https://lcsc.com/product-detail/example',
        'exact_provider_part_id',
        1,
        'succeeded',
        'admin-user',
        '2026-04-24T11:59:00.000Z',
        $2,
        'new_import',
        NULL,
        NULL,
        NULL,
        '2026-04-24T11:59:05.000Z',
        '2026-04-24T11:59:10.000Z',
        '2026-04-24T11:59:10.000Z'
      )
    `,
    [acquisitionJobId, partId]
  );
}

/**
 * Inserts one queued enrichment job plus its initial queued event.
 */
async function seedQueuedEnrichmentJob(
  pool: TestPool,
  jobId: string,
  partId: string,
  acquisitionJobId: string,
  requestedAt: string
): Promise<void> {
  await pool.query(
    `
      INSERT INTO provider_enrichment_jobs (
        id,
        part_id,
        source_acquisition_job_id,
        job_type,
        job_status,
        requested_by,
        requested_at,
        started_at,
        completed_at,
        error_code,
        error_message,
        last_updated_at
      )
      VALUES ($1, $2, $3, 'datasheet_capture', 'queued', 'admin-user', $4, NULL, NULL, NULL, NULL, $4)
    `,
    [jobId, partId, acquisitionJobId, requestedAt]
  );
  await pool.query(
    `
      INSERT INTO provider_enrichment_job_events (id, job_id, event_type, message, detail, created_at)
      VALUES ($1, $2, 'queued', 'Enrichment job queued.', NULL, $3)
    `,
    [`event-${jobId}-queued`, jobId, requestedAt]
  );
}
