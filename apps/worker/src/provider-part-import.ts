/**
 * File header: Runs single-part provider imports shared by the worker CLI and API façade.
 */

import { performance } from "node:perf_hooks";
import { providerAdapters } from "./provider-adapters";
import { assertDatabaseReady, persistNormalizedPart, readSourceRecordImportStatus, recordProviderImportFailure } from "./catalog-repository";
import type { ProviderAdapter, ProviderPartRequest } from "./provider-adapters";

export type { ProviderPartRequest } from "./provider-adapters";
import type { ProviderImportOutcome, SourceImportStatus } from "@ee-library/shared/types";

/** ImportResultSummary is the concise operational result for one provider request. */
export interface ImportResultSummary {
  /** Provider adapter identifier. */
  providerId: string;
  /** Requested exact lookup string, which may be an MPN or a provider-specific id. */
  requestedLookup: string;
  /** Provider source key that was persisted. */
  providerPartKey: string;
  /** Canonical part id that was updated. */
  partId: string;
  /** Import outcome persisted to source_records. */
  importStatus: SourceImportStatus;
  /** Whether this import created a new source row or refreshed an existing one. */
  outcome: ProviderImportOutcome;
  /** Prior source row import status, or null when no prior row existed. */
  previousImportStatus: SourceImportStatus | null;
  /** Source observation timestamp. */
  sourceLastSeenAt: string;
  /** Successful canonical import timestamp. */
  sourceLastImportedAt: string | null;
  /** Total provider import duration in milliseconds. */
  durationMs: number;
  /** Per-stage timings for local operational diagnosis. */
  timings: WorkerTiming[];
}

/** WorkerTiming captures one measured worker stage without exposing provider internals. */
export interface WorkerTiming {
  /** Stable stage name. */
  name: string;
  /** Stage duration in milliseconds. */
  durationMs: number;
  /** Optional short result detail for local logs. */
  detail?: string;
}

/** Registered provider ids that accept single-part import through this runner. */
export const REGISTERED_PROVIDER_IMPORT_IDS: readonly string[] = providerAdapters.map((adapter) => adapter.id);

/**
 * Returns whether a provider id is registered for import.
 */
export function isRegisteredProviderImportId(providerId: string): boolean {
  return providerAdapters.some((adapter) => adapter.id === providerId);
}

/**
 * Fetches, normalizes, and persists one provider part request.
 */
export async function runProviderPartImport(adapterId: string, request: ProviderPartRequest, orgId: string = "org-default"): Promise<ImportResultSummary> {
  const adapter = getProviderAdapter(adapterId);
  const startedAt = performance.now();
  const timings: WorkerTiming[] = [];
  let diagnosticProviderPartKey = readRequestedLookup(request);

  try {
    await timeWorkerOperation("worker.database_ready", () => assertDatabaseReady(), timings);

    const rawPayload = await timeWorkerOperation("provider.fetch_raw_source_payload", () => adapter.fetchRawPart(request), timings);
    const normalizedPart = timeWorkerSyncOperation("provider.normalize_adapter_contract", () => adapter.normalizeRawPart(rawPayload), timings, (part) => part.part.id);
    diagnosticProviderPartKey = normalizedPart.sourceRecord.providerPartKey;

    const previousImportStatus = await timeWorkerOperation(
      "repository.read_prior_source_status",
      () => readSourceRecordImportStatus(adapter.id, normalizedPart.sourceRecord.providerPartKey),
      timings,
      (status) => status ?? "none"
    );

    await timeWorkerOperation("repository.persist_normalized_part", () => persistNormalizedPart(normalizedPart, orgId), timings, () => normalizedPart.part.id);

    return {
      durationMs: roundDuration(performance.now() - startedAt),
      importStatus: normalizedPart.sourceRecord.importStatus,
      outcome: previousImportStatus ? "refreshed_existing" : "new_import",
      partId: normalizedPart.part.id,
      previousImportStatus,
      providerId: adapter.id,
      providerPartKey: normalizedPart.sourceRecord.providerPartKey,
      requestedLookup: readRequestedLookup(request),
      sourceLastImportedAt: normalizedPart.sourceRecord.sourceLastImportedAt,
      sourceLastSeenAt: normalizedPart.sourceRecord.sourceLastSeenAt,
      timings
    };
  } catch (error) {
    try {
      await timeWorkerOperation(
        "repository.record_provider_import_failure",
        () =>
          recordProviderImportFailure({
            error,
            failedAt: new Date().toISOString(),
            providerId: adapter.id,
            providerPartKey: diagnosticProviderPartKey
          }),
        timings
      );
    } catch (diagnosticError) {
      console.error(
        JSON.stringify({
          diagnosticError: formatUnknownError(diagnosticError),
          message: "Provider import failed and diagnostic persistence also failed.",
          timings
        },
        null,
        2)
      );
    }

    throw error;
  }
}

/**
 * Finds one registered provider adapter by identifier.
 */
function getProviderAdapter(adapterId: string): ProviderAdapter {
  const adapter = providerAdapters.find((candidate) => candidate.id === adapterId);

  if (!adapter) {
    throw new Error(`Provider adapter not registered: ${adapterId}`);
  }

  return adapter;
}

/**
 * Reads the exact import lookup string without overloading provider ids as manufacturer part numbers.
 */
function readRequestedLookup(request: ProviderPartRequest): string {
  return request.providerPartId?.trim() || request.mpn?.trim() || request.providerUrl?.trim() || "unknown";
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function timeWorkerOperation<TValue>(name: string, operation: () => Promise<TValue>, timings: WorkerTiming[], describe?: (value: TValue) => string): Promise<TValue> {
  const startedAt = performance.now();

  try {
    const value = await operation();

    const detail = describe?.(value);

    timings.push({ durationMs: roundDuration(performance.now() - startedAt), name, ...(detail !== undefined ? { detail } : {}) });

    return value;
  } catch (error) {
    timings.push({ detail: "failed", durationMs: roundDuration(performance.now() - startedAt), name });
    throw error;
  }
}

function timeWorkerSyncOperation<TValue>(name: string, operation: () => TValue, timings: WorkerTiming[], describe?: (value: TValue) => string): TValue {
  const startedAt = performance.now();

  try {
    const value = operation();

    const detail = describe?.(value);

    timings.push({ durationMs: roundDuration(performance.now() - startedAt), name, ...(detail !== undefined ? { detail } : {}) });

    return value;
  } catch (error) {
    timings.push({ detail: "failed", durationMs: roundDuration(performance.now() - startedAt), name });
    throw error;
  }
}

function roundDuration(value: number): number {
  return Number(value.toFixed(1));
}
