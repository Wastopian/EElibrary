/**
 * File header: Refreshes stale provider-backed commercial snapshots from source-record provenance.
 */

import { SUPPLY_OFFER_STALE_AFTER_DAYS } from "@ee-library/shared/supply-offers";
import { getWorkerDatabasePool } from "./catalog-repository";
import { isRegisteredProviderImportId, runProviderPartImport as defaultRunProviderPartImport } from "./provider-part-import";
import type { Pool } from "pg";
import type { ProviderPartRequest } from "./provider-part-import";

/** DAY_IN_MS converts day-based freshness policy into timestamp cutoffs. */
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** RunProviderPartImport captures the import runner so refresh tests can stub network work. */
type RunProviderPartImport = typeof defaultRunProviderPartImport;

/** StaleSupplyOfferSourceRow is one source record whose active offers need a provider refresh. */
interface StaleSupplyOfferSourceRow {
  /** Provider adapter that originally produced the source row. */
  provider_id: string;
  /** Provider part key suitable for a direct exact provider refresh. */
  provider_part_key: string;
  /** Canonical part id attached to the source row. */
  part_id: string;
  /** Provider URL retained as optional context for the refresh runner. */
  source_url: string | null;
  /** Latest active offer timestamp for ordering and diagnostics. */
  last_supply_seen_at: Date | string;
}

/** SupplyOfferRefreshOptions controls one stale-offer refresh pass. */
export interface SupplyOfferRefreshOptions {
  /** Maximum source records to refresh in one pass. */
  limit?: number;
  /** Age threshold for active offers before the source record is refreshed. */
  staleAfterDays?: number;
  /** Clock override used by deterministic tests. */
  now?: Date;
}

/** SupplyOfferRefreshResult reports one source-record refresh outcome. */
export interface SupplyOfferRefreshResult {
  /** Provider adapter that owned the source row. */
  providerId: string;
  /** Provider part key refreshed or skipped. */
  providerPartKey: string;
  /** Canonical part id attached to the source row. */
  partId: string;
  /** Outcome for this source row. */
  status: "refreshed" | "failed" | "skipped_unsupported_provider";
  /** Error detail for failed refreshes, bounded for logs. */
  errorMessage: string | null;
}

/** SupplyOfferRefreshSummary is the daemon/CLI payload for one stale-offer refresh pass. */
export interface SupplyOfferRefreshSummary {
  /** Number of stale source records selected for this pass. */
  checkedCount: number;
  /** Number of source records successfully refreshed. */
  refreshedCount: number;
  /** Number of source records whose import failed. */
  failedCount: number;
  /** Number of stale sources skipped because no adapter is registered. */
  skippedCount: number;
  /** Freshness threshold used by this pass. */
  staleAfterDays: number;
  /** Cutoff timestamp used to select stale active offers. */
  cutoffAt: string;
  /** Per-source outcomes for operator diagnostics. */
  results: SupplyOfferRefreshResult[];
}

/** runProviderPartImportImpl is replaceable so tests do not need live provider credentials. */
let runProviderPartImportImpl: RunProviderPartImport = defaultRunProviderPartImport;

/**
 * Overrides the import runner for focused refresh tests; pass null to restore the real provider flow.
 */
export function setSupplyOfferRefreshImportRunnerForTests(next: RunProviderPartImport | null): void {
  runProviderPartImportImpl = next ?? defaultRunProviderPartImport;
}

/**
 * Refreshes active supply-offer source rows that have aged beyond the freshness threshold.
 */
export async function refreshStaleSupplyOfferSnapshots(options: SupplyOfferRefreshOptions = {}): Promise<SupplyOfferRefreshSummary> {
  const databasePool = getWorkerDatabasePool();
  const limit = clampInteger(options.limit ?? 20, 1, 100);
  const staleAfterDays = clampInteger(options.staleAfterDays ?? SUPPLY_OFFER_STALE_AFTER_DAYS, 1, 365);
  const now = options.now ?? new Date();
  const cutoffAt = new Date(now.getTime() - staleAfterDays * DAY_IN_MS).toISOString();
  const staleSources = await readStaleSupplyOfferSources(databasePool, cutoffAt, limit);
  const results: SupplyOfferRefreshResult[] = [];

  for (const source of staleSources) {
    if (!isRegisteredProviderImportId(source.provider_id)) {
      results.push({
        errorMessage: "Provider adapter is not registered for direct refresh.",
        partId: source.part_id,
        providerId: source.provider_id,
        providerPartKey: source.provider_part_key,
        status: "skipped_unsupported_provider"
      });
      continue;
    }

    try {
      await runProviderPartImportImpl(source.provider_id, buildProviderRefreshRequest(source));
      results.push({
        errorMessage: null,
        partId: source.part_id,
        providerId: source.provider_id,
        providerPartKey: source.provider_part_key,
        status: "refreshed"
      });
    } catch (error) {
      results.push({
        errorMessage: formatRefreshError(error),
        partId: source.part_id,
        providerId: source.provider_id,
        providerPartKey: source.provider_part_key,
        status: "failed"
      });
    }
  }

  return {
    checkedCount: staleSources.length,
    cutoffAt,
    failedCount: results.filter((result) => result.status === "failed").length,
    refreshedCount: results.filter((result) => result.status === "refreshed").length,
    results,
    skippedCount: results.filter((result) => result.status === "skipped_unsupported_provider").length,
    staleAfterDays
  };
}

/**
 * Reads source records whose active supply rows are all older than the refresh cutoff.
 */
async function readStaleSupplyOfferSources(databasePool: Pool, cutoffAt: string, limit: number): Promise<StaleSupplyOfferSourceRow[]> {
  const result = await databasePool.query<StaleSupplyOfferSourceRow>(
    `
      WITH source_freshness AS (
        SELECT
          sr.provider_id,
          sr.provider_part_key,
          sr.part_id,
          sr.source_url,
          MAX(so.last_seen_at) AS last_supply_seen_at
        FROM source_records sr
        JOIN supply_offerings so ON so.source_record_id = sr.id
        WHERE sr.import_status = 'imported'
          AND sr.part_id IS NOT NULL
          AND so.retired_at IS NULL
        GROUP BY sr.provider_id, sr.provider_part_key, sr.part_id, sr.source_url
      )
      SELECT
        provider_id,
        provider_part_key,
        part_id,
        source_url,
        last_supply_seen_at
      FROM source_freshness
      WHERE last_supply_seen_at < $1::timestamptz
      ORDER BY last_supply_seen_at ASC, provider_id ASC, provider_part_key ASC
      LIMIT $2
    `,
    [cutoffAt, limit]
  );

  return result.rows;
}

/**
 * Builds the exact provider refresh request from stored source provenance.
 */
function buildProviderRefreshRequest(source: StaleSupplyOfferSourceRow): ProviderPartRequest {
  return {
    providerPartId: source.provider_part_key,
    ...(source.source_url ? { providerUrl: source.source_url } : {})
  };
}

/**
 * Clamps integer options so daemon ticks cannot accidentally process an unbounded queue.
 */
function clampInteger(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min;
}

/**
 * Converts unknown refresh failures into bounded operator text.
 */
function formatRefreshError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return message.slice(0, 1000);
}
