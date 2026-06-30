/**
 * File header: Claims provider acquisition jobs, runs the existing provider import flow, and writes coarse lifecycle events.
 */

import { randomUUID } from "node:crypto";
import { getWorkerDatabasePool } from "./catalog-repository";
import { enqueueProviderEnrichmentJobsForPart } from "./provider-enrichment-jobs";
import { runProviderPartImport as defaultRunProviderPartImport } from "./provider-part-import";
import type { Pool, PoolClient } from "pg";
import type {
  ProviderAcquisitionJob,
  ProviderAcquisitionJobEvent,
  ProviderAcquisitionJobStatus,
  ProviderImportOutcome,
  SourceImportStatus
} from "@ee-library/shared/types";
import type { ImportResultSummary, ProviderPartRequest } from "./provider-part-import";

/** RunProviderPartImport captures the shared import runner signature so tests can stub it cleanly. */
type RunProviderPartImport = typeof defaultRunProviderPartImport;

/** BulkEnqueueSummary reports the outcome of a full bulk catalog enqueue run. */
export interface BulkEnqueueSummary {
  /** Total acquisition jobs inserted during the run. */
  totalEnqueued: number;
  /** Total requests skipped because a source record or active job already existed. */
  totalSkipped: number;
  /** Number of category batches yielded by the generator. */
  categoryBatches: number;
}

/** BulkEnqueueProgressEvent is emitted after each category batch is inserted. */
export interface BulkEnqueueProgressEvent {
  /** Category batches processed so far. */
  categoryBatch: number;
  /** Jobs inserted from this batch. */
  batchEnqueued: number;
  /** Requests skipped from this batch. */
  batchSkipped: number;
  /** Running total inserted. */
  totalEnqueued: number;
  /** Running total skipped. */
  totalSkipped: number;
}

/** DatabaseProviderAcquisitionJobRow is the SQL row shape used while claiming and updating jobs. */
interface DatabaseProviderAcquisitionJobRow {
  id: string;
  provider_id: string;
  provider_part_key: string;
  requested_lookup: string;
  manufacturer_name: string | null;
  mpn: string | null;
  package_name: string | null;
  source_url: string | null;
  match_type: ProviderAcquisitionJob["matchType"];
  match_confidence: string;
  job_status: ProviderAcquisitionJobStatus;
  requested_by: string;
  org_id: string | null;
  requested_at: Date | string;
  part_id: string | null;
  import_outcome: ProviderImportOutcome | null;
  previous_import_status: SourceImportStatus | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  last_updated_at: Date | string;
}

/** ProviderAcquisitionJobProcessingResult is one compact operational result for a claimed job. */
export interface ProviderAcquisitionJobProcessingResult {
  /** Persisted job id. */
  jobId: string;
  /** Provider adapter id used by the import runner. */
  providerId: string;
  /** Exact provider key selected during candidate lookup. */
  providerPartKey: string;
  /** Terminal processing status for the claimed job. */
  status: "succeeded" | "failed";
  /** Canonical part id when the import created or refreshed a catalog record. */
  partId: string | null;
  /** Stable failure code when the job did not succeed. */
  errorCode: string | null;
}

/** ProviderAcquisitionProcessingSummary groups a batch of processed jobs for CLI output. */
export interface ProviderAcquisitionProcessingSummary {
  /** One result per claimed job in processing order. */
  processed: ProviderAcquisitionJobProcessingResult[];
}

/** SUB_BATCH_SIZE is the maximum rows per parameterized INSERT to stay well within pg limits. */
const SUB_BATCH_SIZE = 100;

/**
 * Bulk-inserts provider acquisition jobs for every request yielded by the generator.
 * Requests are skipped when a source record already exists for the provider key (part is
 * already in the catalog) or when an active or succeeded acquisition job already exists.
 */
export async function bulkEnqueueProviderAcquisitionJobs(
  providerId: string,
  requestBatches: AsyncGenerator<ProviderPartRequest[]>,
  requestedBy: string,
  onCategoryProgress?: (progress: BulkEnqueueProgressEvent) => void
): Promise<BulkEnqueueSummary> {
  const databasePool = getWorkerDatabasePool();
  let totalEnqueued = 0;
  let totalSkipped = 0;
  let categoryBatches = 0;

  for await (const requests of requestBatches) {
    categoryBatches += 1;
    const { enqueued, skipped } = await insertBulkAcquisitionJobBatch(databasePool, providerId, requests, requestedBy);
    totalEnqueued += enqueued;
    totalSkipped += skipped;
    onCategoryProgress?.({ batchEnqueued: enqueued, batchSkipped: skipped, categoryBatch: categoryBatches, totalEnqueued, totalSkipped });
  }

  return { categoryBatches, totalEnqueued, totalSkipped };
}

/**
 * Splits one category's requests into sub-batches and inserts them, returning enqueued vs skipped counts.
 */
async function insertBulkAcquisitionJobBatch(
  pool: Pool,
  providerId: string,
  requests: ProviderPartRequest[],
  requestedBy: string
): Promise<{ enqueued: number; skipped: number }> {
  if (requests.length === 0) {
    return { enqueued: 0, skipped: 0 };
  }

  let totalEnqueued = 0;

  for (let offset = 0; offset < requests.length; offset += SUB_BATCH_SIZE) {
    const subBatch = requests.slice(offset, offset + SUB_BATCH_SIZE);
    const rows = subBatch
      .map((request) => ({
        id: `acq-${randomUUID()}`,
        manufacturerName: request.manufacturerName ?? null,
        mpn: request.mpn ?? null,
        providerPartKey: request.providerPartId ?? request.mpn ?? ""
      }))
      .filter((row) => row.providerPartKey.length > 0);

    if (rows.length === 0) {
      continue;
    }

    const query = buildBulkInsertQuery(providerId, rows, requestedBy);
    const result = await pool.query(query);
    totalEnqueued += result.rowCount ?? 0;
  }

  return { enqueued: totalEnqueued, skipped: requests.length - totalEnqueued };
}

/**
 * Builds a parameterized batch INSERT that skips provider keys already present in
 * source_records or with a queued/running/succeeded acquisition job.
 */
function buildBulkInsertQuery(
  providerId: string,
  rows: Array<{ id: string; providerPartKey: string; manufacturerName: string | null; mpn: string | null }>,
  requestedBy: string
): { text: string; values: Array<string | null> } {
  const values: Array<string | null> = [providerId, requestedBy];
  const valueClauses: string[] = [];

  for (const row of rows) {
    const base = values.length + 1;
    values.push(row.id, row.providerPartKey, row.manufacturerName, row.mpn);
    valueClauses.push(`($${base}::text, $${base + 1}::text, $${base + 2}::text, $${base + 3}::text)`);
  }

  return {
    text: `
      WITH candidates(id, provider_part_key, manufacturer_name, mpn) AS (
        VALUES ${valueClauses.join(", ")}
      )
      INSERT INTO provider_acquisition_jobs (
        id, provider_id, provider_part_key, requested_lookup, manufacturer_name, mpn,
        match_type, match_confidence, job_status, requested_by, org_id, requested_at, last_updated_at
      )
      SELECT
        c.id, $1, c.provider_part_key, c.provider_part_key, c.manufacturer_name, c.mpn,
        'exact_provider_part_id', 1.0, 'queued', $2, 'org-default', now(), now()
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1 FROM source_records sr
        WHERE sr.provider_id = $1 AND sr.provider_part_key = c.provider_part_key
      ) AND NOT EXISTS (
        SELECT 1 FROM provider_acquisition_jobs paj
        WHERE paj.provider_id = $1
          AND paj.provider_part_key = c.provider_part_key
          AND paj.job_status IN ('queued', 'running', 'succeeded')
      )
    `,
    values
  };
}

/** runProviderPartImportImpl keeps the real import runner replaceable in focused queue tests. */
let runProviderPartImportImpl: RunProviderPartImport = defaultRunProviderPartImport;

/**
 * Overrides the provider import runner for queue tests; pass null to restore the real worker import flow.
 */
export function setProviderAcquisitionImportRunnerForTests(next: RunProviderPartImport | null): void {
  runProviderPartImportImpl = next ?? defaultRunProviderPartImport;
}

/**
 * Processes up to limit queued provider acquisition jobs with up to concurrency jobs running
 * simultaneously. FOR UPDATE SKIP LOCKED ensures each concurrent claim grabs a distinct row
 * so there is no double-processing. Concurrency defaults to 5 — enough to saturate network
 * I/O without overwhelming the provider or the database pool.
 */
export async function processProviderAcquisitionJobs(limit = 20, concurrency = 5): Promise<ProviderAcquisitionProcessingSummary> {
  const processed: ProviderAcquisitionJobProcessingResult[] = [];
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const boundedConcurrency = Math.max(1, Math.min(concurrency, 20));
  let exhausted = false;

  while (!exhausted && processed.length < boundedLimit) {
    const batchSize = Math.min(boundedConcurrency, boundedLimit - processed.length);
    const batchResults = await Promise.all(
      Array.from({ length: batchSize }, () => processNextProviderAcquisitionJob())
    );

    for (const result of batchResults) {
      if (result === null) {
        exhausted = true;
        break;
      }

      processed.push(result);
    }
  }

  return { processed };
}

/**
 * Claims one queued provider acquisition job and processes it, or returns null when the queue is empty.
 */
export async function processNextProviderAcquisitionJob(): Promise<ProviderAcquisitionJobProcessingResult | null> {
  const claimedJob = await claimNextProviderAcquisitionJob();

  if (!claimedJob) {
    return null;
  }

  try {
    const summary = await runProviderPartImportImpl(
      claimedJob.providerId,
      buildProviderAcquisitionImportRequest(claimedJob),
      claimedJob.orgId
    );

    if (summary.importStatus !== "imported") {
      const incompleteFailure = {
        code: "PROVIDER_IMPORT_INCOMPLETE",
        message: "Import did not complete.",
        rawError: `Unexpected import status: ${summary.importStatus}`
      };
      await markProviderAcquisitionJobFailed(claimedJob.id, incompleteFailure);

      return {
        errorCode: incompleteFailure.code,
        jobId: claimedJob.id,
        partId: null,
        providerId: claimedJob.providerId,
        providerPartKey: claimedJob.providerPartKey,
        status: "failed"
      };
    }

    await markProviderAcquisitionJobSucceeded(claimedJob.id, summary);

    return {
      errorCode: null,
      jobId: claimedJob.id,
      partId: summary.partId,
      providerId: claimedJob.providerId,
      providerPartKey: claimedJob.providerPartKey,
      status: "succeeded"
    };
  } catch (error) {
    const failure = mapProviderAcquisitionFailure(error);
    await markProviderAcquisitionJobFailed(claimedJob.id, failure);

    return {
      errorCode: failure.code,
      jobId: claimedJob.id,
      partId: null,
      providerId: claimedJob.providerId,
      providerPartKey: claimedJob.providerPartKey,
      status: "failed"
    };
  }
}

/**
 * Claims the oldest queued job and immediately records a running event inside one transaction.
 */
async function claimNextProviderAcquisitionJob(): Promise<ProviderAcquisitionJob | null> {
  const databasePool = getWorkerDatabasePool();
  const client = await databasePool.connect();
  const runningAt = new Date().toISOString();

  try {
    await client.query("BEGIN");

    const queuedResult = await selectNextQueuedProviderAcquisitionJob(client);
    const queuedRow = queuedResult.rows[0];

    if (!queuedRow) {
      await client.query("COMMIT");
      return null;
    }

    const updateResult = await client.query<DatabaseProviderAcquisitionJobRow>(
      `
        UPDATE provider_acquisition_jobs
        SET
          job_status = 'running',
          started_at = COALESCE(started_at, $1),
          error_code = NULL,
          error_message = NULL,
          last_updated_at = $1
        WHERE id = $2
        RETURNING
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
          org_id,
          requested_at,
          part_id,
          import_outcome,
          previous_import_status,
          error_code,
          error_message,
          started_at,
          completed_at,
          last_updated_at
      `,
      [runningAt, queuedRow.id]
    );
    const claimedRow = updateResult.rows[0];

    if (!claimedRow) {
      await client.query("ROLLBACK");
      throw new Error(`Queued provider acquisition job ${queuedRow.id} disappeared before it could be marked running.`);
    }

    await insertProviderAcquisitionJobEvent(
      client,
      buildProviderAcquisitionJobEvent(
        claimedRow.id,
        "running",
        "Acquisition job started.",
        runningAt,
        {
          providerId: claimedRow.provider_id,
          providerPartKey: claimedRow.provider_part_key
        }
      )
    );
    await client.query("COMMIT");

    return mapProviderAcquisitionJobRow(claimedRow);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Selects the oldest queued acquisition job using SKIP LOCKED in PostgreSQL and a narrow fallback in pg-mem tests.
 */
async function selectNextQueuedProviderAcquisitionJob(
  client: PoolClient
): Promise<{ rows: DatabaseProviderAcquisitionJobRow[] }> {
  try {
    return await client.query<DatabaseProviderAcquisitionJobRow>(buildQueuedProviderAcquisitionSelect(true), []);
  } catch (error) {
    if (!isSkippLockedUnsupportedError(error)) {
      throw error;
    }

    return client.query<DatabaseProviderAcquisitionJobRow>(buildQueuedProviderAcquisitionSelect(false), []);
  }
}

/**
 * Builds the oldest-job claim query, keeping the production SKIP LOCKED clause isolated from the pg-mem fallback path.
 */
function buildQueuedProviderAcquisitionSelect(includeSkipLocked: boolean): string {
  return `
    SELECT
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
    FROM provider_acquisition_jobs
    WHERE job_status = 'queued'
    ORDER BY requested_at ASC, id ASC
    LIMIT 1
    FOR UPDATE${includeSkipLocked ? " SKIP LOCKED" : ""}
  `;
}

/**
 * Detects the pg-mem planner limitation around SKIP LOCKED so the fallback stays narrow and explicit.
 */
function isSkippLockedUnsupportedError(error: unknown): boolean {
  return error instanceof Error && /skip locked/u.test(error.message);
}

/**
 * Marks one acquisition job successful and records the terminal succeeded event.
 */
async function markProviderAcquisitionJobSucceeded(jobId: string, summary: ImportResultSummary): Promise<void> {
  const databasePool = getWorkerDatabasePool();
  const client = await databasePool.connect();
  const completedAt = new Date().toISOString();

  try {
    await client.query("BEGIN");
    const updateResult = await client.query<{ requested_by: string }>(
      `
        UPDATE provider_acquisition_jobs
        SET
          job_status = 'succeeded',
          part_id = $2,
          import_outcome = $3,
          previous_import_status = $4,
          error_code = NULL,
          error_message = NULL,
          completed_at = $5,
          last_updated_at = $5
        WHERE id = $1
        RETURNING requested_by
      `,
      [jobId, summary.partId, summary.outcome, summary.previousImportStatus, completedAt]
    );
    const requestedBy = updateResult.rows[0]?.requested_by ?? "system";
    await insertProviderAcquisitionJobEvent(
      client,
      buildProviderAcquisitionJobEvent(jobId, "succeeded", "Acquisition job succeeded.", completedAt, {
        importOutcome: summary.outcome,
        partId: summary.partId,
        previousImportStatus: summary.previousImportStatus,
        providerPartKey: summary.providerPartKey
      })
    );
    await enqueueProviderEnrichmentJobsForPart(
      {
        partId: summary.partId,
        requestedAt: completedAt,
        requestedBy,
        sourceAcquisitionJobId: jobId
      },
      { client }
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
 * Marks one acquisition job failed and records the terminal failed event with bounded error details.
 */
async function markProviderAcquisitionJobFailed(
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
        UPDATE provider_acquisition_jobs
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
    await insertProviderAcquisitionJobEvent(
      client,
      buildProviderAcquisitionJobEvent(jobId, "failed", "Acquisition job failed.", failedAt, {
        errorCode: failure.code,
        rawError: failure.rawError
      })
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
 * Builds the corrected exact import request so provider keys never get mislabeled as MPNs.
 */
function buildProviderAcquisitionImportRequest(job: ProviderAcquisitionJob): ProviderPartRequest {
  return {
    ...(job.manufacturerName ? { manufacturerName: job.manufacturerName } : {}),
    ...(job.mpn ? { mpn: job.mpn } : {}),
    ...(job.sourceUrl ? { providerUrl: job.sourceUrl } : {}),
    providerPartId: job.providerPartKey
  };
}

/**
 * Builds one coarse provider acquisition job event row for database persistence.
 */
function buildProviderAcquisitionJobEvent(
  jobId: string,
  eventType: ProviderAcquisitionJobEvent["eventType"],
  message: string,
  createdAt: string,
  detail: Record<string, unknown> | null
): ProviderAcquisitionJobEvent {
  return {
    createdAt,
    detail,
    eventType,
    id: `acqevent-${randomUUID()}`,
    jobId,
    message
  };
}

/**
 * Persists one provider acquisition lifecycle event inside an existing transaction.
 */
async function insertProviderAcquisitionJobEvent(client: PoolClient, event: ProviderAcquisitionJobEvent): Promise<void> {
  await client.query(
    `
      INSERT INTO provider_acquisition_job_events (
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
 * Maps one raw acquisition job row into the shared queue contract used by the UI and tests.
 */
function mapProviderAcquisitionJobRow(row: DatabaseProviderAcquisitionJobRow): ProviderAcquisitionJob {
  return {
    completedAt: row.completed_at ? toIsoTimestamp(row.completed_at) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    id: row.id,
    importOutcome: row.import_outcome,
    jobStatus: row.job_status,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    manufacturerName: row.manufacturer_name,
    orgId: row.org_id ?? "org-default",
    matchConfidence: Number(row.match_confidence),
    matchType: row.match_type,
    mpn: row.mpn,
    package: row.package_name,
    partId: row.part_id,
    previousImportStatus: row.previous_import_status,
    providerId: row.provider_id,
    providerPartKey: row.provider_part_key,
    requestedAt: toIsoTimestamp(row.requested_at),
    requestedBy: row.requested_by,
    requestedLookup: row.requested_lookup,
    sourceUrl: row.source_url,
    startedAt: row.started_at ? toIsoTimestamp(row.started_at) : null
  };
}

/**
 * Converts worker/import failures into stable queue codes plus calm user-facing failure copy.
 */
function mapProviderAcquisitionFailure(error: unknown): { code: string; message: string; rawError: string } {
  const rawError = formatUnknownError(error);

  if (error instanceof Error) {
    if (/DATABASE_URL is required/u.test(error.message)) {
      return {
        code: "DB_NOT_CONFIGURED",
        message: "Catalog acquisition requires a configured catalog database.",
        rawError
      };
    }

    if (/Provider adapter not registered/u.test(error.message)) {
      return {
        code: "UNKNOWN_PROVIDER",
        message: "That provider is not available for import here.",
        rawError
      };
    }

    if (/Unable to fetch jlcparts/u.test(error.message)) {
      return {
        code: "PROVIDER_IMPORT_FAILED",
        message: "Could not reach the provider catalog. Check your network connection and try again.",
        rawError
      };
    }

    if (/DigiKey credentials are not configured/u.test(error.message)) {
      return {
        code: "PROVIDER_CREDENTIALS_MISSING",
        message: "DigiKey acquisition requires DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET.",
        rawError
      };
    }

    if (/Mouser credentials are not configured/u.test(error.message)) {
      return {
        code: "PROVIDER_CREDENTIALS_MISSING",
        message: "Mouser acquisition requires MOUSER_API_KEY.",
        rawError
      };
    }

    if (/Octopart\/Nexar credentials are not configured/u.test(error.message)) {
      return {
        code: "PROVIDER_CREDENTIALS_MISSING",
        message: "Octopart/Nexar is an optional paid aggregator and requires configured Nexar credentials.",
        rawError
      };
    }

    if (/Unable to fetch DigiKey/u.test(error.message) || /Unable to fetch Mouser/u.test(error.message) || /Mouser API returned errors/u.test(error.message)) {
      return {
        code: "PROVIDER_UNAVAILABLE",
        message: "Could not reach the distributor provider. Check credentials and network access and try again.",
        rawError
      };
    }

    if (/Unable to fetch Octopart\/Nexar/u.test(error.message) || /Octopart\/Nexar GraphQL returned errors/u.test(error.message)) {
      return {
        code: "PROVIDER_UNAVAILABLE",
        message: "Could not reach the Octopart/Nexar provider. Check credentials, network access, and provider plan permissions.",
        rawError
      };
    }

    if (/not found for/u.test(error.message) || /metadata record not found/u.test(error.message)) {
      return {
        code: "PROVIDER_IMPORT_FAILED",
        message: "No matching catalog entry was found for that lookup. Try another MPN or provider part id.",
        rawError
      };
    }
  }

  return {
    code: "PROVIDER_IMPORT_FAILED",
    message: "Import did not complete.",
    rawError
  };
}

/**
 * Formats unknown errors into bounded event-detail strings.
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
