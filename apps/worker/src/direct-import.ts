/**
 * File header: Synchronous in-process provider import for MVP. Wraps the existing local-catalog
 * provider adapter and the canonical persist helpers so the api can run a direct import without
 * relying on the queued acquisition path. Bulk and scheduled imports continue to use the
 * worker's existing CLI-driven flow.
 */

import { Pool } from "pg";
import { providerAdapters, type ProviderAdapter } from "./provider-adapters";
import { persistNormalizedPart } from "./catalog-repository";

/** DirectImportRequest names the minimum input expected by the api endpoint. */
export interface DirectImportRequest {
  /** Manufacturer part number to import. Already validated to look like an exact MPN. */
  mpn: string;
  /** Optional provider id to scope the lookup. Defaults to the first registered adapter. */
  providerId?: string;
}

/** DirectImportSuccess summarizes a successful synchronous import for routing. */
export interface DirectImportSuccess {
  status: "imported";
  partId: string;
  mpn: string;
  providerId: string;
  alreadyExisted: boolean;
}

/** DirectImportFailure preserves a structured reason without exposing internal traces. */
export interface DirectImportFailure {
  status: "failed";
  reason: DirectImportFailureReason;
  message: string;
  providerId: string;
  mpn: string;
}

/** DirectImportFailureReason is the closed set of provider-facing failure codes. */
export type DirectImportFailureReason =
  | "provider_not_registered"
  | "provider_part_not_found"
  | "provider_fetch_failed"
  | "persist_failed";

export type DirectImportResult = DirectImportSuccess | DirectImportFailure;

/**
 * Runs a direct provider import in-process.
 * Idempotent: re-importing the same MPN updates the canonical row but keeps the same partId.
 */
export async function runDirectImport(request: DirectImportRequest, options?: { pool?: Pool }): Promise<DirectImportResult> {
  const providerId = request.providerId ?? providerAdapters[0]?.id ?? "local-catalog";
  const adapter = providerAdapters.find((candidate) => candidate.id === providerId);

  if (!adapter) {
    return {
      message: `Provider adapter not registered: ${providerId}`,
      mpn: request.mpn,
      providerId,
      reason: "provider_not_registered",
      status: "failed"
    };
  }

  let rawPayload;
  try {
    rawPayload = await adapter.fetchRawPart({ mpn: request.mpn });
  } catch (error) {
    return classifyFetchError(adapter, request.mpn, error);
  }

  const normalized = adapter.normalizeRawPart(rawPayload);

  let alreadyExisted = false;
  try {
    alreadyExisted = await checkPartExists(normalized.part.id, options?.pool);
    await persistNormalizedPart(normalized, options?.pool);
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      mpn: request.mpn,
      providerId: adapter.id,
      reason: "persist_failed",
      status: "failed"
    };
  }

  return {
    alreadyExisted,
    mpn: normalized.part.mpn,
    partId: normalized.part.id,
    providerId: adapter.id,
    status: "imported"
  };
}

/**
 * Detects whether a part with the given canonical id already exists in the database.
 * Returns false on errors so a missing table never short-circuits the import.
 */
async function checkPartExists(partId: string, pool?: Pool): Promise<boolean> {
  const databasePool = pool ?? getDefaultPool();
  if (!databasePool) {
    return false;
  }

  try {
    const result = await databasePool.query<{ id: string }>("SELECT id FROM parts WHERE id = $1", [partId]);
    return result.rowCount === 1;
  } catch {
    return false;
  }
}

/** defaultPool is shared across importers when the caller does not pass its own pool. */
let defaultPool: Pool | null = null;

/**
 * Lazily creates a shared Pool when DATABASE_URL is configured.
 */
function getDefaultPool(): Pool | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  defaultPool ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return defaultPool;
}

/**
 * Maps provider fetch errors into the closed failure-reason set.
 */
function classifyFetchError(adapter: ProviderAdapter, mpn: string, error: unknown): DirectImportFailure {
  const message = error instanceof Error ? error.message : String(error);
  const reason: DirectImportFailureReason = /not\s+found/iu.test(message) ? "provider_part_not_found" : "provider_fetch_failed";

  return {
    message,
    mpn,
    providerId: adapter.id,
    reason,
    status: "failed"
  };
}
