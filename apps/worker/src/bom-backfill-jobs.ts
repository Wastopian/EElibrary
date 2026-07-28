/**
 * File header: Drains queued BOM backfill requests: exact provider lookup, then import or an honest park.
 *
 * Each request is one missing MPN (+ optional manufacturer) from a BOM import. The pipeline is
 * deliberately conservative: it imports only when every exact candidate agrees on one part identity;
 * disagreement parks the row as needs_choice with the candidates preserved for a human pick, and zero
 * candidates is an honest no_match. Imports run through the same runProviderPartImport flow as the
 * one-at-a-time UI path (with enrichment enqueued the same way), so backfilled parts arrive exactly
 * as unreviewed imports — backfill never approves, validates, or export-promotes anything.
 */

import { getWorkerDatabasePool } from "./catalog-repository";
import { mapProviderAcquisitionFailure } from "./provider-acquisition-jobs";
import { enqueueProviderEnrichmentJobsForPart } from "./provider-enrichment-jobs";
import { runProviderPartImport as defaultRunProviderPartImport } from "./provider-part-import";
import { runProviderPartLookupSettled as defaultRunProviderPartLookupSettled } from "./provider-part-lookup";
import type { PoolClient } from "pg";
import { DEFAULT_ORG_ID } from "@ee-library/shared/tenant";
import type { BomBackfillCandidate, BomBackfillRequestStatus, ProviderLookupCandidateBase } from "@ee-library/shared/types";

/** RunProviderPartLookupSettled keeps the real lookup runner replaceable in focused queue tests. */
type RunProviderPartLookupSettled = typeof defaultRunProviderPartLookupSettled;

/** RunProviderPartImport keeps the real import runner replaceable in focused queue tests. */
type RunProviderPartImport = typeof defaultRunProviderPartImport;

/** ClaimedBomBackfillRequest is the narrow row shape the processor works on. */
interface ClaimedBomBackfillRequest {
  id: string;
  bomImportId: string;
  mpn: string;
  manufacturerName: string | null;
  requestedBy: string;
  orgId: string | null;
}

/** BomBackfillLookupOutcome is the pure decision over one request's exact provider candidates. */
export type BomBackfillLookupOutcome =
  | { kind: "no_match" }
  | { kind: "needs_choice"; candidates: BomBackfillCandidate[] }
  | { kind: "acquire"; candidate: BomBackfillCandidate };

/** BomBackfillProcessingResult is one compact operational result for a claimed request. */
export interface BomBackfillProcessingResult {
  requestId: string;
  mpn: string;
  status: BomBackfillRequestStatus;
}

/** BomBackfillProcessingSummary groups one drain pass for CLI and daemon logging. */
export interface BomBackfillProcessingSummary {
  processed: BomBackfillProcessingResult[];
}

/** runProviderPartLookupImpl keeps the real lookup runner replaceable in queue tests. */
let runProviderPartLookupImpl: RunProviderPartLookupSettled = defaultRunProviderPartLookupSettled;

/** runProviderPartImportImpl keeps the real import runner replaceable in queue tests. */
let runProviderPartImportImpl: RunProviderPartImport = defaultRunProviderPartImport;

/**
 * Overrides the provider lookup runner for queue tests; pass null to restore the real worker lookup.
 */
export function setBomBackfillLookupRunnerForTests(next: RunProviderPartLookupSettled | null): void {
  runProviderPartLookupImpl = next ?? defaultRunProviderPartLookupSettled;
}

/**
 * Overrides the provider import runner for queue tests; pass null to restore the real worker import.
 */
export function setBomBackfillImportRunnerForTests(next: RunProviderPartImport | null): void {
  runProviderPartImportImpl = next ?? defaultRunProviderPartImport;
}

/**
 * Decides one request's outcome from its exact provider candidates without touching the database.
 *
 * Conservative by design: only candidates with confidence 1 count; when the BOM row names a
 * manufacturer, candidates must match it (a mismatch is a human decision, not an auto-import);
 * and every remaining candidate must agree on one normalized manufacturer+MPN identity. The
 * winning candidate is the first in provider registry order, which runProviderPartLookup preserves.
 */
export function decideBomBackfillLookupOutcome(
  candidates: ProviderLookupCandidateBase[],
  requestedManufacturer: string | null
): BomBackfillLookupOutcome {
  const exactCandidates = candidates.filter((candidate) => candidate.matchConfidence === 1);

  if (exactCandidates.length === 0) {
    return { kind: "no_match" };
  }

  let consideredCandidates = exactCandidates;

  if (requestedManufacturer) {
    const normalizedRequested = normalizeIdentityText(requestedManufacturer);
    const manufacturerMatches = exactCandidates.filter(
      (candidate) => normalizeIdentityText(candidate.manufacturerName) === normalizedRequested
    );

    if (manufacturerMatches.length === 0) {
      return { candidates: exactCandidates.map(toBomBackfillCandidate), kind: "needs_choice" };
    }

    consideredCandidates = manufacturerMatches;
  }

  const identities = new Set(
    consideredCandidates.map(
      (candidate) => `${normalizeIdentityText(candidate.manufacturerName)} ${normalizeIdentityText(candidate.mpn)}`
    )
  );

  if (identities.size > 1) {
    return { candidates: consideredCandidates.map(toBomBackfillCandidate), kind: "needs_choice" };
  }

  const winner = consideredCandidates[0];

  if (!winner) {
    return { kind: "no_match" };
  }

  return { candidate: toBomBackfillCandidate(winner), kind: "acquire" };
}

/**
 * Processes up to limit queued backfill requests. Concurrency stays low by default: each request
 * fans an exact lookup out to every configured provider and may then run a full provider import,
 * and free-tier distributor APIs rate-limit long before Postgres does.
 */
export async function processBomBackfillRequests(limit = 10, concurrency = 2): Promise<BomBackfillProcessingSummary> {
  const processed: BomBackfillProcessingResult[] = [];
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const boundedConcurrency = Math.max(1, Math.min(concurrency, 5));
  let exhausted = false;

  while (!exhausted && processed.length < boundedLimit) {
    const batchSize = Math.min(boundedConcurrency, boundedLimit - processed.length);
    const batchResults = await Promise.all(Array.from({ length: batchSize }, () => processNextBomBackfillRequest()));

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
 * Claims one queued backfill request and resolves it, or returns null when the queue is empty.
 */
export async function processNextBomBackfillRequest(): Promise<BomBackfillProcessingResult | null> {
  const claimed = await claimNextBomBackfillRequest();

  if (!claimed) {
    return null;
  }

  try {
    const lookupRequest = {
      query: claimed.mpn,
      ...(claimed.manufacturerName ? { manufacturerName: claimed.manufacturerName } : {})
    };
    const lookup = await runProviderPartLookupImpl(lookupRequest);
    const outcome = decideBomBackfillLookupOutcome(lookup.candidates, claimed.manufacturerName);

    if (outcome.kind === "no_match") {
      // Honesty rule: no_match means every configured provider answered and none had the part.
      // When a provider errored instead of answering (outage, expired credentials), the row fails
      // as retryable rather than pretending the part does not exist anywhere.
      if (lookup.failures.length > 0) {
        const failedProviders = lookup.failures.map((failure) => failure.providerId).join(", ");
        await settleBomBackfillRequest(claimed.id, {
          errorCode: "PROVIDER_UNAVAILABLE",
          errorMessage: `Could not check every supplier (${failedProviders} did not answer). Fix credentials or network access, then search again.`,
          requestStatus: "failed"
        });

        return { mpn: claimed.mpn, requestId: claimed.id, status: "failed" };
      }

      await settleBomBackfillRequest(claimed.id, { requestStatus: "no_match" });
      return { mpn: claimed.mpn, requestId: claimed.id, status: "no_match" };
    }

    if (outcome.kind === "needs_choice") {
      await settleBomBackfillRequest(claimed.id, { candidates: outcome.candidates, requestStatus: "needs_choice" });
      return { mpn: claimed.mpn, requestId: claimed.id, status: "needs_choice" };
    }

    const partId = await importWinningCandidate(claimed, outcome.candidate);
    await settleBomBackfillRequest(claimed.id, { partId, requestStatus: "imported" });
    return { mpn: claimed.mpn, requestId: claimed.id, status: "imported" };
  } catch (error) {
    const failure = mapProviderAcquisitionFailure(error);
    await settleBomBackfillRequest(claimed.id, {
      errorCode: failure.code,
      errorMessage: failure.message,
      requestStatus: "failed"
    });

    return { mpn: claimed.mpn, requestId: claimed.id, status: "failed" };
  }
}

/**
 * Imports the agreed candidate through the shared provider import flow, reusing an existing catalog
 * part when the provider key already landed (the part may have entered the catalog between BOM
 * matching and this lookup). Enrichment is enqueued best-effort exactly like the CLI ingest path so
 * datasheet capture runs on the daemon's next enrichment tick.
 */
async function importWinningCandidate(claimed: ClaimedBomBackfillRequest, candidate: BomBackfillCandidate): Promise<string> {
  const databasePool = getWorkerDatabasePool();
  const existingSource = await databasePool.query<{ part_id: string | null }>(
    `
      SELECT part_id FROM source_records
      WHERE provider_id = $1 AND provider_part_key = $2 AND org_id = $3 AND part_id IS NOT NULL
      ORDER BY fetched_at DESC
      LIMIT 1
    `,
    [candidate.providerId, candidate.providerPartKey, claimed.orgId ?? DEFAULT_ORG_ID]
  );
  const existingPartId = existingSource.rows[0]?.part_id ?? null;

  if (existingPartId) {
    return existingPartId;
  }

  const summary = await runProviderPartImportImpl(
    candidate.providerId,
    {
      ...(candidate.manufacturerName ? { manufacturerName: candidate.manufacturerName } : {}),
      ...(candidate.mpn ? { mpn: candidate.mpn } : {}),
      ...(candidate.sourceUrl ? { providerUrl: candidate.sourceUrl } : {}),
      providerPartId: candidate.providerPartKey
    },
    claimed.orgId ?? undefined
  );

  if (summary.importStatus !== "imported") {
    throw new Error(`Unexpected import status: ${summary.importStatus}`);
  }

  try {
    await enqueueProviderEnrichmentJobsForPart({
      partId: summary.partId,
      requestedAt: new Date().toISOString(),
      requestedBy: claimed.requestedBy,
      sourceAcquisitionJobId: null
    });
  } catch (enqueueError) {
    console.error(`bom-backfill: enrichment enqueue failed (import still succeeded): ${String(enqueueError)}`);
  }

  return summary.partId;
}

/**
 * Claims the oldest queued backfill request and marks it searching inside one transaction.
 */
async function claimNextBomBackfillRequest(): Promise<ClaimedBomBackfillRequest | null> {
  const databasePool = getWorkerDatabasePool();
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");

    const queuedResult = await selectNextQueuedBomBackfillRequest(client);
    const queuedRow = queuedResult.rows[0];

    if (!queuedRow) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `
        UPDATE bom_backfill_requests
        SET request_status = 'searching', started_at = COALESCE(started_at, now()), last_updated_at = now()
        WHERE id = $1
      `,
      [queuedRow.id]
    );
    await client.query("COMMIT");

    return {
      bomImportId: queuedRow.bom_import_id,
      id: queuedRow.id,
      manufacturerName: queuedRow.manufacturer_name,
      mpn: queuedRow.mpn,
      orgId: queuedRow.org_id,
      requestedBy: queuedRow.requested_by
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** QueuedBomBackfillRow is the claim query's raw row shape. */
interface QueuedBomBackfillRow {
  id: string;
  bom_import_id: string;
  mpn: string;
  manufacturer_name: string | null;
  requested_by: string;
  org_id: string | null;
}

/**
 * Selects the oldest queued backfill request using SKIP LOCKED with the narrow pg-mem fallback.
 */
async function selectNextQueuedBomBackfillRequest(client: PoolClient): Promise<{ rows: QueuedBomBackfillRow[] }> {
  try {
    return await client.query<QueuedBomBackfillRow>(buildQueuedBomBackfillSelect(true), []);
  } catch (error) {
    if (!(error instanceof Error && /skip locked/u.test(error.message))) {
      throw error;
    }

    return client.query<QueuedBomBackfillRow>(buildQueuedBomBackfillSelect(false), []);
  }
}

/**
 * Builds the oldest-request claim query, isolating the SKIP LOCKED clause from the pg-mem fallback.
 */
function buildQueuedBomBackfillSelect(includeSkipLocked: boolean): string {
  return `
    SELECT id, bom_import_id, mpn, manufacturer_name, requested_by, org_id
    FROM bom_backfill_requests
    WHERE request_status = 'queued'
    ORDER BY requested_at ASC, id ASC
    LIMIT 1
    FOR UPDATE${includeSkipLocked ? " SKIP LOCKED" : ""}
  `;
}

/** BomBackfillSettleUpdate names the fields one terminal settle write may touch. */
interface BomBackfillSettleUpdate {
  requestStatus: BomBackfillRequestStatus;
  candidates?: BomBackfillCandidate[];
  partId?: string | null;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Writes one terminal backfill request state (imported / needs_choice / no_match / failed).
 */
async function settleBomBackfillRequest(requestId: string, update: BomBackfillSettleUpdate): Promise<void> {
  const databasePool = getWorkerDatabasePool();

  await databasePool.query(
    `
      UPDATE bom_backfill_requests
      SET
        request_status = $2,
        candidates = COALESCE($3::jsonb, candidates),
        part_id = COALESCE($4, part_id),
        error_code = $5,
        error_message = $6,
        completed_at = now(),
        last_updated_at = now()
      WHERE id = $1
    `,
    [
      requestId,
      update.requestStatus,
      update.candidates ? JSON.stringify(update.candidates) : null,
      update.partId ?? null,
      update.errorCode ?? null,
      update.errorMessage ?? null
    ]
  );
}

/**
 * Maps one provider lookup candidate into the preserved backfill candidate shape.
 */
function toBomBackfillCandidate(candidate: ProviderLookupCandidateBase): BomBackfillCandidate {
  return {
    manufacturerName: candidate.manufacturerName,
    matchType: candidate.matchType,
    mpn: candidate.mpn,
    package: candidate.package,
    providerId: candidate.providerId,
    providerPartKey: candidate.providerPartKey,
    sourceUrl: candidate.sourceUrl
  };
}

/**
 * Normalizes manufacturer and MPN text for identity comparison: case, whitespace, and punctuation
 * variants ("TE Connectivity" vs "TE-Connectivity") collapse; distinct part numbers never do.
 */
function normalizeIdentityText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}
