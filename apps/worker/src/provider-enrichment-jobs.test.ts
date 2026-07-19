/**
 * File header: Tests provider enrichment queue dedupe, claim order, and datasheet-capture outcomes.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { newDb } from "pg-mem";
import { PDFDocument, StandardFonts } from "pdf-lib";
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
    assert.equal(summary.recoveredStaleCount, 0);
  } finally {
    setProviderEnrichmentDatasheetCaptureHandlerForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("provider enrichment worker retries abandoned running work without stealing fresh work", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  await seedPartAndAcquisition(pool, "part-abandoned", "acqjob-abandoned");
  await seedPartAndAcquisition(pool, "part-active", "acqjob-active");
  await seedQueuedEnrichmentJob(
    pool,
    "enrichjob-abandoned",
    "part-abandoned",
    "acqjob-abandoned",
    "2026-04-24T12:00:00.000Z"
  );
  await seedQueuedEnrichmentJob(
    pool,
    "enrichjob-active",
    "part-active",
    "acqjob-active",
    "2026-04-24T12:01:00.000Z"
  );
  await pool.query(`
    UPDATE provider_enrichment_jobs
    SET
      job_status = 'running',
      started_at = now(),
      last_updated_at = now() - INTERVAL '20 minutes'
    WHERE id = 'enrichjob-abandoned';

    UPDATE provider_enrichment_jobs
    SET
      job_status = 'running',
      started_at = now(),
      last_updated_at = now()
    WHERE id = 'enrichjob-active';
  `);
  setProviderEnrichmentDatasheetCaptureHandlerForTests(async () => ({
    detail: { result: "captured" },
    message: "Referenced datasheet evidence was captured from provider source data."
  }));

  try {
    const summary = await processProviderEnrichmentJobs(1);
    const rows = await pool.query<{ id: string; job_status: string }>(
      "SELECT id, job_status FROM provider_enrichment_jobs ORDER BY id"
    );
    const events = await pool.query<{ event_type: string }>(
      "SELECT event_type FROM provider_enrichment_job_events WHERE job_id = 'enrichjob-abandoned' ORDER BY created_at ASC"
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row.job_status]));

    assert.equal(summary.recoveredStaleCount, 1);
    assert.equal(summary.processed.length, 1);
    assert.equal(summary.processed[0]?.jobId, "enrichjob-abandoned");
    assert.equal(summary.processed[0]?.status, "succeeded");
    assert.equal(byId.get("enrichjob-abandoned"), "succeeded");
    assert.equal(byId.get("enrichjob-active"), "running");
    assert.deepEqual(events.rows.map((row) => row.event_type), ["queued", "running", "succeeded"]);
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
    exists: async () => false,
    getDownloadUrl: async () => null,
    read: async () => Buffer.from(""),
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

test("provider enrichment worker confirms distributor values found in the datasheet", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  const partId = "part-extract";
  const timestamp = "2026-04-24T12:00:00.000Z";

  await seedPartAndAcquisition(pool, partId, "acqjob-extract", "Resistors / Chip Resistor - Surface Mount");
  // A downloaded datasheet asset so the job reads the stored PDF instead of re-capturing.
  await pool.query(
    `INSERT INTO assets (
       id, part_id, asset_type, file_format, storage_key, file_hash, provider_id, license_mode, provenance,
       availability_status, review_status, export_status, asset_status, generation_method, generation_source_asset_id,
       validation_status, preview_status, asset_state, source_url, source_record_id, last_updated_at
     ) VALUES (
       'asset-extract', $1, 'datasheet', 'pdf', 'datasheets/part-extract.pdf', 'hash', 'mouser', 'metadata_only', 'trusted_external',
       'downloaded', 'not_reviewed', 'not_exportable', 'downloaded', NULL, NULL,
       'not_validated', 'not_available', 'downloaded', 'https://example.test/rc0603.pdf', NULL, $2
     )`,
    [partId, timestamp]
  );
  await pool.query(
    `INSERT INTO datasheet_revisions (id, part_id, revision_label, parse_confidence, pin_table_status, last_updated_at)
     VALUES ('dsr-extract', $1, 'Provider datasheet reference', 0, 'not_available', $2)`,
    [partId, timestamp]
  );
  // The distributor specs recompute reconciles into part_parameters (resistance + tolerance stay the
  // distributor winners; the datasheet confirms them below).
  await pool.query(
    `INSERT INTO part_specifications (id, part_id, provider_id, source_record_id, spec_key, spec_value, spec_group, last_updated_at, org_id) VALUES
     ('spec-res', $1, 'mouser', NULL, 'Resistance', '10 kOhms', 'parametric', $2, 'org-default'),
     ('spec-tol', $1, 'mouser', NULL, 'Tolerance', '1%', 'parametric', $2, 'org-default')`,
    [partId, timestamp]
  );
  // The distributor's reconciled parameter values are the confirm-by-search candidates: resistance and
  // tolerance appear in the datasheet text below; capacitance is a candidate whose value does not.
  await pool.query(
    `INSERT INTO part_parameters (id, part_id, part_type, param_key, value_kind, value_numeric, value_text, unit, is_conflicted, confidence_score, winning_provider_id, sources, last_updated_at, org_id) VALUES
     ('pp-res', $1, 'resistor', 'resistance', 'numeric', 10000, NULL, 'ohm', FALSE, 0.6, 'mouser', '[{"providerId":"mouser","agreesWithWinner":true}]'::jsonb, $2, 'org-default'),
     ('pp-tol', $1, 'resistor', 'tolerance', 'numeric', 1, NULL, '%', FALSE, 0.6, 'mouser', '[{"providerId":"mouser","agreesWithWinner":true}]'::jsonb, $2, 'org-default'),
     ('pp-cap', $1, 'resistor', 'capacitance', 'numeric', 0.000001, NULL, 'F', FALSE, 0.6, 'mouser', '[{"providerId":"mouser","agreesWithWinner":true}]'::jsonb, $2, 'org-default')`,
    [partId, timestamp]
  );
  await seedQueuedEnrichmentJob(pool, "enrichjob-extract", partId, "acqjob-extract", timestamp, "datasheet_extraction");

  const document = await PDFDocument.create();
  const page = document.addPage();
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("General purpose chip resistor. Resistance 10 kOhm. Tolerance +/- 1%.", { font, size: 12, x: 40, y: 700 });
  const pdfBytes = Buffer.from(await document.save());

  setWorkerStorageClientForTests({
    backend: "local",
    exists: async () => true,
    getDownloadUrl: async () => null,
    read: async () => pdfBytes,
    write: async () => {}
  } as FileStorageClient);

  try {
    const result = await processNextProviderEnrichmentJob();

    assert.equal(result?.status, "succeeded");
    assert.equal(result?.jobType, "datasheet_extraction");

    // Only the values present in the datasheet are confirmed; capacitance (absent) is not.
    const datasheetParams = await pool.query<{ param_key: string; value_numeric: string | null }>(
      "SELECT param_key, value_numeric FROM part_datasheet_parameters WHERE part_id = $1 ORDER BY param_key",
      [partId]
    );
    assert.deepEqual(datasheetParams.rows.map((row) => row.param_key).sort(), ["resistance", "tolerance"]);
    const confirmed = new Map(datasheetParams.rows.map((row) => [row.param_key, Number(row.value_numeric)]));
    assert.equal(confirmed.get("resistance"), 10_000, "the confirmed value equals the distributor value");

    const revision = await pool.query<{ parse_confidence: string }>("SELECT parse_confidence FROM datasheet_revisions WHERE id = 'dsr-extract'");
    assert.ok(Number(revision.rows[0]?.parse_confidence) > 0, "parse_confidence moved off the 0 stub");

    // Reconciliation: the datasheet corroborates the distributor value (agrees), never overrides or conflicts.
    const resistance = await pool.query<{ winning_provider_id: string; is_conflicted: boolean; sources: unknown }>(
      "SELECT winning_provider_id, is_conflicted, sources FROM part_parameters WHERE part_id = $1 AND param_key = 'resistance'",
      [partId]
    );
    const sources = typeof resistance.rows[0]?.sources === "string" ? JSON.parse(resistance.rows[0].sources as string) : resistance.rows[0]?.sources;
    const datasheetSource = Array.isArray(sources) ? sources.find((entry: { providerId: string }) => entry.providerId === "datasheet") : undefined;

    assert.equal(resistance.rows[0]?.winning_provider_id, "mouser", "the distributor value stays the winner");
    assert.equal(resistance.rows[0]?.is_conflicted, false, "an agreeing datasheet confirmation never conflicts");
    assert.ok(datasheetSource && datasheetSource.agreesWithWinner === true, "datasheet corroboration is recorded and agrees");

    const orgStamps = await pool.query<{ org_id: string | null }>(
      "SELECT org_id FROM part_datasheet_parameters WHERE part_id = $1 UNION SELECT org_id FROM part_parameters WHERE part_id = $1",
      [partId]
    );
    assert.ok(orgStamps.rows.length > 0 && orgStamps.rows.every((row) => row.org_id === "org-default"), "datasheet and reconciled rows are org-stamped");
  } finally {
    setWorkerStorageClientForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("datasheet capture resolves the URL from the datasheet asset when raw payload has none", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  const partId = "part-asseturl";
  const timestamp = "2026-04-24T12:00:00.000Z";

  await seedPartAndAcquisition(pool, partId, "acqjob-asseturl");
  // Source record whose raw payload carries NO datasheet URL (the Mouser/DigiKey blind spot).
  await pool.query(
    `INSERT INTO source_records (id, provider_id, provider_part_key, part_id, source_url, fetched_at, raw_payload, source_last_seen_at, import_status, last_updated_at)
     VALUES ('src-asseturl', 'mouser', '603-RC0603', $1, NULL, $2, '{"part":{"ManufacturerPartNumber":"RC0603FR-0710KL"}}'::jsonb, $2, 'imported', $2)`,
    [partId, timestamp]
  );
  // Referenced datasheet asset (no storage_key yet) carrying the official URL on source_url.
  await pool.query(
    `INSERT INTO assets (
       id, part_id, asset_type, file_format, storage_key, file_hash, provider_id, license_mode, provenance,
       availability_status, review_status, export_status, asset_status, generation_method, generation_source_asset_id,
       validation_status, preview_status, asset_state, source_url, source_record_id, last_updated_at
     ) VALUES (
       'asset-asseturl', $1, 'datasheet', 'pdf', NULL, NULL, 'mouser', 'metadata_only', 'trusted_external',
       'referenced', 'not_reviewed', 'not_exportable', 'referenced', NULL, NULL,
       'not_validated', 'not_available', 'referenced', 'https://www.mouser.com/catalog/specsheets/yageo_rc0603.pdf', 'src-asseturl', $2
     )`,
    [partId, timestamp]
  );
  await seedQueuedEnrichmentJob(pool, "enrichjob-asseturl", partId, "acqjob-asseturl", timestamp, "datasheet_capture");

  const pdfBytes = Buffer.from("%PDF-1.4 asset-url datasheet");
  const fetched: string[] = [];
  setDatasheetFetcherForTests(async (url) => { fetched.push(String(url)); return new Response(pdfBytes); });
  const writtenFiles: string[] = [];
  setWorkerStorageClientForTests({
    backend: "local",
    exists: async () => false,
    getDownloadUrl: async () => null,
    read: async () => Buffer.from(""),
    write: async (key) => { writtenFiles.push(key); }
  } as FileStorageClient);

  try {
    const result = await processNextProviderEnrichmentJob();

    assert.equal(result?.status, "succeeded");
    assert.deepEqual(fetched, ["https://www.mouser.com/catalog/specsheets/yageo_rc0603.pdf"], "fetched via the asset source_url");
    assert.deepEqual(writtenFiles, ["datasheets/part-asseturl.pdf"]);

    const asset = await pool.query<{ availability_status: string; storage_key: string | null }>(
      "SELECT availability_status, storage_key FROM assets WHERE id = 'asset-asseturl'"
    );
    assert.equal(asset.rows[0]?.availability_status, "downloaded");
    assert.equal(asset.rows[0]?.storage_key, "datasheets/part-asseturl.pdf");
  } finally {
    setDatasheetFetcherForTests(null);
    setWorkerStorageClientForTests(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

test("enqueueProviderEnrichmentJobsForPart accepts a null acquisition source (CLI ingest path)", async () => {
  const pool = createProviderEnrichmentPool();
  setWorkerRepositoryPoolForTests(pool);
  await pool.query(`INSERT INTO parts (id, category) VALUES ('part-cli', 'Resistors / Chip Resistor')`);

  try {
    const result = await enqueueProviderEnrichmentJobsForPart({
      partId: "part-cli",
      requestedAt: "2026-04-24T12:00:00.000Z",
      requestedBy: "cli:ingest",
      sourceAcquisitionJobId: null
    });

    assert.deepEqual(result.createdJobs.map((job) => job.jobType).sort(), ["datasheet_capture", "datasheet_extraction"]);

    const rows = await pool.query<{ job_type: string; source_acquisition_job_id: string | null }>(
      "SELECT job_type, source_acquisition_job_id FROM provider_enrichment_jobs WHERE part_id = 'part-cli' ORDER BY job_type"
    );
    assert.equal(rows.rows.length, 2);
    assert.ok(rows.rows.every((row) => row.source_acquisition_job_id === null), "jobs enqueue with a null acquisition source");
  } finally {
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
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT '',
      connector_family_id TEXT,
      org_id TEXT DEFAULT 'org-default'
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
      source_acquisition_job_id TEXT REFERENCES provider_acquisition_jobs(id),
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
      preview_artifact_storage_key TEXT,
      preview_artifact_format TEXT,
      preview_artifact_generated_at TIMESTAMPTZ,
      preview_artifact_source TEXT,
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
    CREATE TABLE datasheet_revisions (id TEXT PRIMARY KEY, part_id TEXT, revision_label TEXT, revision_date DATE, page_count INTEGER, file_asset_id TEXT, parse_confidence NUMERIC, pin_table_status TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE part_specifications (id TEXT PRIMARY KEY, part_id TEXT, provider_id TEXT, source_record_id TEXT, spec_key TEXT, spec_value TEXT, spec_group TEXT, last_updated_at TIMESTAMPTZ, org_id TEXT);
    CREATE TABLE part_metrics (id TEXT PRIMARY KEY, part_id TEXT, metric_key TEXT, metric_value NUMERIC, unit TEXT, min_value NUMERIC, max_value NUMERIC, confidence_score NUMERIC, source_revision_id TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ, org_id TEXT);
    CREATE TABLE part_parameters (id TEXT PRIMARY KEY, part_id TEXT, part_type TEXT, param_key TEXT, value_kind TEXT, value_numeric NUMERIC, value_min NUMERIC, value_max NUMERIC, value_text TEXT, unit TEXT, is_conflicted BOOLEAN, confidence_score NUMERIC, winning_provider_id TEXT, winning_source_record_id TEXT, sources JSONB, last_updated_at TIMESTAMPTZ, org_id TEXT, UNIQUE (part_id, param_key));
    CREATE TABLE part_datasheet_parameters (id TEXT PRIMARY KEY, part_id TEXT, param_key TEXT, value_kind TEXT, value_numeric NUMERIC, value_min NUMERIC, value_max NUMERIC, value_text TEXT, unit TEXT, confidence_score NUMERIC, datasheet_revision_id TEXT, extracted_at TIMESTAMPTZ, org_id TEXT, UNIQUE (part_id, param_key));
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
  acquisitionJobId: string,
  category = ""
): Promise<void> {
  await pool.query(`INSERT INTO parts (id, category) VALUES ($1, $2)`, [partId, category]);
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
  requestedAt: string,
  jobType: "datasheet_capture" | "datasheet_extraction" = "datasheet_capture"
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
      VALUES ($1, $2, $3, $5, 'queued', 'admin-user', $4, NULL, NULL, NULL, NULL, $4)
    `,
    [jobId, partId, acquisitionJobId, requestedAt, jobType]
  );
  await pool.query(
    `
      INSERT INTO provider_enrichment_job_events (id, job_id, event_type, message, detail, created_at)
      VALUES ($1, $2, 'queued', 'Enrichment job queued.', NULL, $3)
    `,
    [`event-${jobId}-queued`, jobId, requestedAt]
  );
}
