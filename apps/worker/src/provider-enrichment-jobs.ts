/**
 * File header: Enqueues and processes provider enrichment jobs, starting with metadata-only datasheet capture.
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  getWorkerDatabasePool,
  markDatasheetAssetAsDownloaded
} from "./catalog-repository";
import { getWorkerStorageClient } from "./file-storage";
import type { PoolClient } from "pg";
import type {
  ProviderEnrichmentJob,
  ProviderEnrichmentJobEvent,
  ProviderEnrichmentJobStatus,
  ProviderEnrichmentJobType
} from "@ee-library/shared/types";

/** ProviderEnrichmentQueueResult captures one enqueue outcome for the caller. */
export interface ProviderEnrichmentQueueResult {
  /** Created jobs are newly queued during this call. */
  createdJobs: ProviderEnrichmentJob[];
  /** Reused jobs were already active and were returned instead of creating duplicates. */
  reusedJobs: ProviderEnrichmentJob[];
}

/** ProviderEnrichmentProcessingResult is one compact operational result for a processed job. */
export interface ProviderEnrichmentProcessingResult {
  /** Persisted enrichment job id. */
  jobId: string;
  /** Canonical part id the job targets. */
  partId: string;
  /** Stable enrichment job type. */
  jobType: ProviderEnrichmentJobType;
  /** Terminal processing status for the claimed job. */
  status: "succeeded" | "failed";
  /** Stable failure code when the job did not succeed. */
  errorCode: string | null;
}

/** ProviderEnrichmentProcessingSummary groups processed enrichment jobs for CLI output. */
export interface ProviderEnrichmentProcessingSummary {
  /** One result per claimed enrichment job in processing order. */
  processed: ProviderEnrichmentProcessingResult[];
}

/** ProviderEnrichmentEnqueueInput carries the caller context needed to queue gap-driven enrichment work. */
export interface ProviderEnrichmentEnqueueInput {
  /** Canonical part id that may need enrichment. */
  partId: string;
  /** Acquisition job that triggered the enrichment enqueue. */
  sourceAcquisitionJobId: string;
  /** Operator or system identity that requested the originating acquisition. */
  requestedBy: string;
  /** Timestamp shared with the originating acquisition success write when available. */
  requestedAt: string;
}

/** ProviderEnrichmentDatasheetCaptureResult reports the bounded datasheet-capture outcome detail. */
interface ProviderEnrichmentDatasheetCaptureResult {
  /** Event detail payload persisted on success. */
  detail: Record<string, unknown> | null;
  /** Event message persisted on success. */
  message: string;
}

/** DatabaseProviderEnrichmentJobRow is the SQL row shape used while claiming and updating jobs. */
interface DatabaseProviderEnrichmentJobRow {
  id: string;
  part_id: string;
  source_acquisition_job_id: string;
  job_type: ProviderEnrichmentJobType;
  job_status: ProviderEnrichmentJobStatus;
  requested_by: string;
  requested_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  error_code: string | null;
  error_message: string | null;
  last_updated_at: Date | string;
}

/** DatabaseSourceDatasheetRow is the minimum source-record row shape needed for datasheet capture. */
interface DatabaseSourceDatasheetRow {
  id: string;
  provider_id: string;
  provider_part_key: string;
  raw_payload: unknown;
}

/** ProviderEnrichmentJobError carries stable enrichment failure codes without widening the public API. */
class ProviderEnrichmentJobError extends Error {
  /** Stable internal failure code written to the persisted job row. */
  readonly code: string;

  /**
   * Creates one bounded enrichment-job failure.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProviderEnrichmentJobError";
    this.code = code;
  }
}

/** ProviderEnrichmentDatasheetCaptureHandler keeps the datasheet handler replaceable in focused queue tests. */
type ProviderEnrichmentDatasheetCaptureHandler = (
  job: ProviderEnrichmentJob
) => Promise<ProviderEnrichmentDatasheetCaptureResult>;

/** providerEnrichmentJobBeforeInsertHook lets focused tests force a unique-conflict race before insert. */
let providerEnrichmentJobBeforeInsertHook: (() => Promise<void>) | null = null;

/** datasheetCaptureHandlerImpl keeps the real datasheet handler replaceable in focused queue tests. */
let datasheetCaptureHandlerImpl: ProviderEnrichmentDatasheetCaptureHandler = runDatasheetCaptureJob;

/** datasheetFetcher is the HTTP client used to download PDFs; injectable for tests. */
let datasheetFetcher: typeof fetch = fetch;

/** Maximum bytes allowed for a single datasheet download (50 MB). */
const DATASHEET_MAX_BYTES = 50 * 1024 * 1024;

/** Timeout in milliseconds for a single datasheet fetch. */
const DATASHEET_FETCH_TIMEOUT_MS = 30_000;

/**
 * Overrides the datasheet capture handler for queue tests; pass null to restore the real handler.
 */
export function setProviderEnrichmentDatasheetCaptureHandlerForTests(
  next: ProviderEnrichmentDatasheetCaptureHandler | null
): void {
  datasheetCaptureHandlerImpl = next ?? runDatasheetCaptureJob;
}

/**
 * Overrides the HTTP fetcher used for datasheet downloads; pass null to restore the real fetch.
 */
export function setDatasheetFetcherForTests(next: typeof fetch | null): void {
  datasheetFetcher = next ?? fetch;
}

/**
 * Overrides the before-insert hook for queue tests; pass null to restore normal queue writes.
 */
export function setProviderEnrichmentJobBeforeInsertHookForTests(
  next: (() => Promise<void>) | null
): void {
  providerEnrichmentJobBeforeInsertHook = next;
}

/**
 * Enqueues gap-driven enrichment jobs for one part, reusing active jobs instead of creating duplicates.
 */
export async function enqueueProviderEnrichmentJobsForPart(
  input: ProviderEnrichmentEnqueueInput,
  options: { client?: PoolClient } = {}
): Promise<ProviderEnrichmentQueueResult> {
  if (options.client) {
    return enqueueProviderEnrichmentJobsWithClient(options.client, input);
  }

  const databasePool = getWorkerDatabasePool();
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    const result = await enqueueProviderEnrichmentJobsWithClient(client, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Processes up to limit queued provider enrichment jobs in oldest-first order.
 */
export async function processProviderEnrichmentJobs(
  limit = 20
): Promise<ProviderEnrichmentProcessingSummary> {
  const processed: ProviderEnrichmentProcessingResult[] = [];
  const boundedLimit = Math.max(1, Math.min(limit, 100));

  for (let index = 0; index < boundedLimit; index += 1) {
    const nextResult = await processNextProviderEnrichmentJob();

    if (!nextResult) {
      break;
    }

    processed.push(nextResult);
  }

  return { processed };
}

/**
 * Claims one queued provider enrichment job and processes it, or returns null when the queue is empty.
 */
export async function processNextProviderEnrichmentJob(): Promise<ProviderEnrichmentProcessingResult | null> {
  const claimedJob = await claimNextProviderEnrichmentJob();

  if (!claimedJob) {
    return null;
  }

  try {
    const result = await runProviderEnrichmentJob(claimedJob);
    await markProviderEnrichmentJobSucceeded(claimedJob.id, result);

    return {
      errorCode: null,
      jobId: claimedJob.id,
      jobType: claimedJob.jobType,
      partId: claimedJob.partId,
      status: "succeeded"
    };
  } catch (error) {
    const failure = mapProviderEnrichmentFailure(error);
    await markProviderEnrichmentJobFailed(claimedJob.id, failure);

    return {
      errorCode: failure.code,
      jobId: claimedJob.id,
      jobType: claimedJob.jobType,
      partId: claimedJob.partId,
      status: "failed"
    };
  }
}

/**
 * Enqueues the Phase 2C.1 datasheet-capture job only when datasheet evidence is still missing.
 */
async function enqueueProviderEnrichmentJobsWithClient(
  client: PoolClient,
  input: ProviderEnrichmentEnqueueInput
): Promise<ProviderEnrichmentQueueResult> {
  if (await partHasDatasheetEvidence(client, input.partId)) {
    return {
      createdJobs: [],
      reusedJobs: []
    };
  }

  const existingJob = await findActiveProviderEnrichmentJob(
    client,
    input.partId,
    "datasheet_capture"
  );

  if (existingJob) {
    return {
      createdJobs: [],
      reusedJobs: [existingJob]
    };
  }

  const createdJob = buildProviderEnrichmentJobRecord(input, "datasheet_capture");
  const createdEvent = buildProviderEnrichmentJobEvent(
    createdJob.id,
    "queued",
    "Enrichment job queued.",
    input.requestedAt,
    {
      jobType: createdJob.jobType,
      partId: createdJob.partId
    }
  );

  if (providerEnrichmentJobBeforeInsertHook) {
    await providerEnrichmentJobBeforeInsertHook();
  }

  try {
    await insertProviderEnrichmentJob(client, createdJob);
    await insertProviderEnrichmentJobEvent(client, createdEvent);

    return {
      createdJobs: [createdJob],
      reusedJobs: []
    };
  } catch (error) {
    if (!isUniqueViolationError(error)) {
      throw error;
    }

    const reusedJob = await findActiveProviderEnrichmentJob(
      client,
      input.partId,
      "datasheet_capture"
    );

    if (!reusedJob) {
      throw error;
    }

    return {
      createdJobs: [],
      reusedJobs: [reusedJob]
    };
  }
}

/**
 * Claims the oldest queued enrichment job and records a running event inside one transaction.
 */
async function claimNextProviderEnrichmentJob(): Promise<ProviderEnrichmentJob | null> {
  const databasePool = getWorkerDatabasePool();
  const client = await databasePool.connect();
  const runningAt = new Date().toISOString();

  try {
    await client.query("BEGIN");

    const queuedResult = await selectNextQueuedProviderEnrichmentJob(client);
    const queuedRow = queuedResult.rows[0];

    if (!queuedRow) {
      await client.query("COMMIT");
      return null;
    }

    const updateResult = await client.query<DatabaseProviderEnrichmentJobRow>(
      `
        UPDATE provider_enrichment_jobs
        SET
          job_status = 'running',
          started_at = COALESCE(started_at, $1),
          error_code = NULL,
          error_message = NULL,
          last_updated_at = $1
        WHERE id = $2
        RETURNING
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
      `,
      [runningAt, queuedRow.id]
    );
    const claimedRow = updateResult.rows[0];

    if (!claimedRow) {
      await client.query("ROLLBACK");
      throw new Error(
        `Queued provider enrichment job ${queuedRow.id} disappeared before it could be marked running.`
      );
    }

    await insertProviderEnrichmentJobEvent(
      client,
      buildProviderEnrichmentJobEvent(
        claimedRow.id,
        "running",
        "Enrichment job started.",
        runningAt,
        {
          jobType: claimedRow.job_type,
          partId: claimedRow.part_id
        }
      )
    );
    await client.query("COMMIT");

    return mapProviderEnrichmentJobRow(claimedRow);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Selects the oldest queued enrichment job using SKIP LOCKED in PostgreSQL and a narrow fallback in pg-mem tests.
 */
async function selectNextQueuedProviderEnrichmentJob(
  client: PoolClient
): Promise<{ rows: DatabaseProviderEnrichmentJobRow[] }> {
  try {
    return await client.query<DatabaseProviderEnrichmentJobRow>(
      buildQueuedProviderEnrichmentSelect(true),
      []
    );
  } catch (error) {
    if (!isSkipLockedUnsupportedError(error)) {
      throw error;
    }

    return client.query<DatabaseProviderEnrichmentJobRow>(
      buildQueuedProviderEnrichmentSelect(false),
      []
    );
  }
}

/**
 * Builds the oldest-job claim query, keeping the production SKIP LOCKED clause isolated from the pg-mem fallback path.
 */
function buildQueuedProviderEnrichmentSelect(includeSkipLocked: boolean): string {
  return `
    SELECT
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
    FROM provider_enrichment_jobs
    WHERE job_status = 'queued'
    ORDER BY requested_at ASC, id ASC
    LIMIT 1
    FOR UPDATE${includeSkipLocked ? " SKIP LOCKED" : ""}
  `;
}

/**
 * Dispatches one claimed enrichment job to its type-specific handler.
 */
async function runProviderEnrichmentJob(
  job: ProviderEnrichmentJob
): Promise<ProviderEnrichmentDatasheetCaptureResult> {
  switch (job.jobType) {
    case "datasheet_capture":
      return datasheetCaptureHandlerImpl(job);
  }
}

/**
 * Downloads a datasheet PDF from the official provider URL and advances the asset to downloaded state.
 */
async function runDatasheetCaptureJob(
  job: ProviderEnrichmentJob
): Promise<ProviderEnrichmentDatasheetCaptureResult> {
  const databasePool = getWorkerDatabasePool();

  // Phase 1: check already-downloaded and read source URL (short-lived read, no transaction).
  const readClient = await databasePool.connect();
  let datasheetSource: (DatabaseSourceDatasheetRow & { datasheetSourceUrl: string }) | null = null;

  try {
    if (await partHasDatasheetEvidence(readClient, job.partId)) {
      return {
        detail: { result: "noop_already_downloaded" },
        message: "Datasheet already downloaded; skipping re-download."
      };
    }

    datasheetSource = await readLatestOfficialDatasheetSourceRow(readClient, job.partId);
  } finally {
    readClient.release();
  }

  if (!datasheetSource) {
    throw new ProviderEnrichmentJobError(
      "NO_DATASHEET_SOURCE",
      "No official provider datasheet source is recorded for this part yet."
    );
  }

  // Phase 2: fetch file — no DB connection held during network I/O.
  let fileBytes: Buffer;

  try {
    fileBytes = await fetchDatasheetWithLimit(datasheetSource.datasheetSourceUrl);
  } catch (error) {
    throw new ProviderEnrichmentJobError(
      "DATASHEET_FETCH_FAILED",
      `Failed to fetch datasheet: ${formatUnknownError(error)}`
    );
  }

  // Phase 3: hash, derive storage key, write to storage.
  const fileHash = createHash("sha256").update(fileBytes).digest("hex");
  const storageKey = buildDatasheetStorageKey(job.partId);
  const storageClient = getWorkerStorageClient();

  if (storageClient.backend === "not_configured") {
    throw new ProviderEnrichmentJobError(
      "STORAGE_NOT_CONFIGURED",
      "Storage backend is not configured — cannot store downloaded datasheet."
    );
  }

  await storageClient.write(storageKey, fileBytes);

  // Phase 4: advance asset to downloaded state in a transaction.
  const completedAt = new Date().toISOString();
  const writeClient = await databasePool.connect();

  try {
    await writeClient.query("BEGIN");
    const { assetId } = await markDatasheetAssetAsDownloaded(writeClient, {
      fileHash,
      partId: job.partId,
      sourceUrl: datasheetSource.datasheetSourceUrl,
      storageKey,
      updatedAt: completedAt
    });
    await writeClient.query("COMMIT");

    return {
      detail: {
        assetId,
        fileHash,
        result: "downloaded",
        sourceUrl: datasheetSource.datasheetSourceUrl,
        storageKey
      },
      message: "Datasheet downloaded and stored successfully."
    };
  } catch (error) {
    await writeClient.query("ROLLBACK");
    throw error;
  } finally {
    writeClient.release();
  }
}

/**
 * Derives the storage key for a part's datasheet PDF.
 */
function buildDatasheetStorageKey(partId: string): string {
  return `datasheets/${partId}.pdf`;
}

/**
 * Fetches a URL and returns its body as a Buffer, enforcing timeout and size limits.
 */
async function fetchDatasheetWithLimit(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, DATASHEET_FETCH_TIMEOUT_MS);

  try {
    const response = await datasheetFetcher(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > DATASHEET_MAX_BYTES) {
        await reader.cancel();
        throw new Error(`Datasheet exceeds ${DATASHEET_MAX_BYTES / (1024 * 1024)}MB size limit`);
      }

      chunks.push(value);
    }

    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Marks one enrichment job successful and records the terminal succeeded event.
 */
async function markProviderEnrichmentJobSucceeded(
  jobId: string,
  result: ProviderEnrichmentDatasheetCaptureResult
): Promise<void> {
  const databasePool = getWorkerDatabasePool();
  const client = await databasePool.connect();
  const completedAt = new Date().toISOString();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE provider_enrichment_jobs
        SET
          job_status = 'succeeded',
          error_code = NULL,
          error_message = NULL,
          completed_at = $2,
          last_updated_at = $2
        WHERE id = $1
      `,
      [jobId, completedAt]
    );
    await insertProviderEnrichmentJobEvent(
      client,
      buildProviderEnrichmentJobEvent(
        jobId,
        "succeeded",
        result.message,
        completedAt,
        result.detail
      )
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Marks one enrichment job failed and records the terminal failed event with bounded error details.
 */
async function markProviderEnrichmentJobFailed(
  jobId: string,
  failure: { code: string; message: string; rawError: string }
): Promise<void> {
  const databasePool = getWorkerDatabasePool();
  const client = await databasePool.connect();
  const failedAt = new Date().toISOString();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE provider_enrichment_jobs
        SET
          job_status = 'failed',
          error_code = $2,
          error_message = $3,
          completed_at = $4,
          last_updated_at = $4
        WHERE id = $1
      `,
      [jobId, failure.code, failure.message, failedAt]
    );
    await insertProviderEnrichmentJobEvent(
      client,
      buildProviderEnrichmentJobEvent(
        jobId,
        "failed",
        "Enrichment job failed.",
        failedAt,
        {
          errorCode: failure.code,
          rawError: failure.rawError
        }
      )
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Checks whether referenced or stored datasheet evidence is already attached to the part.
 */
async function partHasDatasheetEvidence(
  client: PoolClient,
  partId: string
): Promise<boolean> {
  const result = await client.query<{ has_datasheet_evidence: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM assets
        WHERE part_id = $1
          AND asset_type = 'datasheet'
          AND storage_key IS NOT NULL
          AND file_hash IS NOT NULL
      ) AS has_datasheet_evidence
    `,
    [partId]
  );

  return Boolean(result.rows[0]?.has_datasheet_evidence);
}

/**
 * Finds one active enrichment job for a part and job type, or null when no queued/running job exists.
 */
async function findActiveProviderEnrichmentJob(
  client: PoolClient,
  partId: string,
  jobType: ProviderEnrichmentJobType
): Promise<ProviderEnrichmentJob | null> {
  const result = await client.query<DatabaseProviderEnrichmentJobRow>(
    `
      SELECT
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
      FROM provider_enrichment_jobs
      WHERE part_id = $1
        AND job_type = $2
        AND job_status IN ('queued', 'running')
      ORDER BY requested_at DESC, id DESC
      LIMIT 1
    `,
    [partId, jobType]
  );

  return result.rows[0] ? mapProviderEnrichmentJobRow(result.rows[0]) : null;
}

/**
 * Reads source rows in newest-first order and returns the first official datasheet URL available in raw provider data.
 */
async function readLatestOfficialDatasheetSourceRow(
  client: PoolClient,
  partId: string
): Promise<(DatabaseSourceDatasheetRow & { datasheetSourceUrl: string }) | null> {
  const result = await client.query<DatabaseSourceDatasheetRow>(
    `
      SELECT
        id,
        provider_id,
        provider_part_key,
        raw_payload
      FROM source_records
      WHERE part_id = $1
      ORDER BY CASE import_status WHEN 'imported' THEN 0 ELSE 1 END ASC,
        COALESCE(source_last_imported_at, normalized_at, fetched_at, last_updated_at) DESC,
        last_updated_at DESC,
        id DESC
    `,
    [partId]
  );

  for (const row of result.rows) {
    const datasheetSourceUrl = extractOfficialDatasheetSourceUrl(row.raw_payload);

    if (datasheetSourceUrl) {
      return {
        ...row,
        datasheetSourceUrl
      };
    }
  }

  return null;
}

/**
 * Extracts an official datasheet reference from known provider raw-payload shapes without scraping arbitrary pages.
 */
function extractOfficialDatasheetSourceUrl(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== "object") {
    return null;
  }

  const payload = rawPayload as Record<string, unknown>;
  const component = readRecord(payload.component);
  const componentDatasheetUrl = normalizeHttpUrl(component?.datasheet);

  if (componentDatasheetUrl) {
    return componentDatasheetUrl;
  }

  const topLevelDatasheetUrl = normalizeHttpUrl(payload.datasheetUrl);

  if (topLevelDatasheetUrl) {
    return topLevelDatasheetUrl;
  }

  const datasheetRecord = readRecord(payload.datasheet);
  const datasheetRecordUrl =
    normalizeHttpUrl(datasheetRecord?.sourceUrl) ??
    normalizeHttpUrl(datasheetRecord?.url) ??
    normalizeHttpUrl(datasheetRecord?.datasheetUrl);

  if (datasheetRecordUrl) {
    return datasheetRecordUrl;
  }

  const assets = Array.isArray(payload.assets) ? payload.assets : [];

  for (const asset of assets) {
    const assetRecord = readRecord(asset);

    if (!assetRecord) {
      continue;
    }

    if (assetRecord.assetType !== "datasheet") {
      continue;
    }

    const assetSourceUrl = normalizeHttpUrl(assetRecord.sourceUrl);

    if (assetSourceUrl) {
      return assetSourceUrl;
    }
  }

  return null;
}

/**
 * Builds one enrichment job row for the supported Phase 2C.1 job type.
 */
function buildProviderEnrichmentJobRecord(
  input: ProviderEnrichmentEnqueueInput,
  jobType: ProviderEnrichmentJobType
): ProviderEnrichmentJob {
  return {
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    id: `enrichjob-${randomUUID()}`,
    jobStatus: "queued",
    jobType,
    lastUpdatedAt: input.requestedAt,
    partId: input.partId,
    requestedAt: input.requestedAt,
    requestedBy: input.requestedBy,
    sourceAcquisitionJobId: input.sourceAcquisitionJobId,
    startedAt: null
  };
}

/**
 * Builds one coarse enrichment lifecycle event row for database persistence.
 */
function buildProviderEnrichmentJobEvent(
  jobId: string,
  eventType: ProviderEnrichmentJobEvent["eventType"],
  message: string,
  createdAt: string,
  detail: Record<string, unknown> | null
): ProviderEnrichmentJobEvent {
  return {
    createdAt,
    detail,
    eventType,
    id: `enrichevent-${randomUUID()}`,
    jobId,
    message
  };
}

/**
 * Persists one provider enrichment job inside an existing transaction.
 */
async function insertProviderEnrichmentJob(
  client: PoolClient,
  job: ProviderEnrichmentJob
): Promise<void> {
  await client.query(
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      job.id,
      job.partId,
      job.sourceAcquisitionJobId,
      job.jobType,
      job.jobStatus,
      job.requestedBy,
      job.requestedAt,
      job.startedAt,
      job.completedAt,
      job.errorCode,
      job.errorMessage,
      job.lastUpdatedAt
    ]
  );
}

/**
 * Persists one provider enrichment lifecycle event inside an existing transaction.
 */
async function insertProviderEnrichmentJobEvent(
  client: PoolClient,
  event: ProviderEnrichmentJobEvent
): Promise<void> {
  await client.query(
    `
      INSERT INTO provider_enrichment_job_events (
        id,
        job_id,
        event_type,
        message,
        detail,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [event.id, event.jobId, event.eventType, event.message, event.detail, event.createdAt]
  );
}

/**
 * Maps one raw enrichment job row into the shared queue contract used by the worker and detail API.
 */
function mapProviderEnrichmentJobRow(
  row: DatabaseProviderEnrichmentJobRow
): ProviderEnrichmentJob {
  return {
    completedAt: row.completed_at ? toIsoTimestamp(row.completed_at) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    id: row.id,
    jobStatus: row.job_status,
    jobType: row.job_type,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    partId: row.part_id,
    requestedAt: toIsoTimestamp(row.requested_at),
    requestedBy: row.requested_by,
    sourceAcquisitionJobId: row.source_acquisition_job_id,
    startedAt: row.started_at ? toIsoTimestamp(row.started_at) : null
  };
}

/**
 * Converts enrichment failures into stable queue codes plus bounded operator-readable detail.
 */
function mapProviderEnrichmentFailure(
  error: unknown
): { code: string; message: string; rawError: string } {
  const rawError = formatUnknownError(error);

  if (error instanceof ProviderEnrichmentJobError) {
    return {
      code: error.code,
      message: error.message,
      rawError
    };
  }

  if (error instanceof Error && /DATABASE_URL is required/u.test(error.message)) {
    return {
      code: "DB_NOT_CONFIGURED",
      message: "Background enrichment requires a configured catalog database.",
      rawError
    };
  }

  return {
    code: "ENRICHMENT_FAILED",
    message: "Background enrichment did not complete.",
    rawError
  };
}

/**
 * Detects the pg-mem planner limitation around SKIP LOCKED so the fallback stays narrow and explicit.
 */
function isSkipLockedUnsupportedError(error: unknown): boolean {
  return error instanceof Error && /skip locked/u.test(error.message);
}

/**
 * Detects PostgreSQL unique-violation errors without depending on one concrete error class.
 */
function isUniqueViolationError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "23505"
  );
}

/**
 * Converts a nullable unknown value into an object record when possible.
 */
function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Normalizes candidate URL values and accepts only concrete HTTP(S) datasheet references.
 */
function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^https?:\/\//iu.test(normalized) ? normalized : null;
}

/**
 * Formats unknown failures into bounded event-detail strings.
 */
function formatUnknownError(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 2000);
}

/**
 * Converts database timestamps to ISO strings for the shared job contract.
 */
function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
