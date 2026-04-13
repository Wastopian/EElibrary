/**
 * File header: Resolves catalog data sources without silently masking database failures.
 */

import { CatalogStoreError } from "./catalog-store";
import type { CatalogReadResult } from "./catalog-store";
import type { ApiErrorEnvelope, CatalogDataSource, PartSearchRecord } from "@ee-library/shared/types";

/** CatalogDatabaseRead reads records from one database-backed catalog path. */
export type CatalogDatabaseRead = () => Promise<CatalogReadResult>;

/** CatalogSeedRead reads seed fallback records only when fallback is explicitly allowed. */
export type CatalogSeedRead = () => Promise<PartSearchRecord[]>;

/** CatalogResolution is the route-ready result of a catalog source decision. */
export type CatalogResolution =
  | {
      /** True when records are available from database or explicit seed fallback. */
      ok: true;
      /** Joined records for the caller to filter or render. */
      records: PartSearchRecord[];
      /** Backing source for the response envelope. */
      source: CatalogDataSource;
      /** Explicit degraded-state warnings when seed fallback was used. */
      warnings?: string[];
    }
  | {
      /** False when no trusted catalog source can be used. */
      ok: false;
      /** HTTP status the route should return. */
      statusCode: number;
      /** Explicit error envelope for the client. */
      body: ApiErrorEnvelope;
    };

/**
 * Resolves records from the database or an explicitly enabled local seed fallback.
 */
export async function resolveCatalogRecords(databaseRead: CatalogDatabaseRead, seedRead: CatalogSeedRead, env: NodeJS.ProcessEnv = process.env): Promise<CatalogResolution> {
  try {
    const databaseResult = await databaseRead();

    if (databaseResult.status === "available") {
      return {
        ok: true,
        records: databaseResult.records,
        source: "database"
      };
    }

    return maybeUseSeedFallback("Catalog database is not configured.", 503, "DB_NOT_CONFIGURED", seedRead, env);
  } catch (error) {
    if (error instanceof CatalogStoreError) {
      const statusCode = error.kind === "database_unavailable" ? 503 : 500;
      const code = error.kind.toUpperCase();

      return maybeUseSeedFallback(error.message, statusCode, code, seedRead, env);
    }

    return maybeUseSeedFallback("Catalog database query failed with an unknown error.", 500, "QUERY_FAILED", seedRead, env);
  }
}

/**
 * Returns true only when the developer has explicitly opted into seed fallback.
 */
export function isSeedFallbackAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EE_LIBRARY_ALLOW_SEED_FALLBACK === "true";
}

/**
 * Resolves a seed fallback or an explicit error response.
 */
async function maybeUseSeedFallback(
  message: string,
  statusCode: number,
  code: string,
  seedRead: CatalogSeedRead,
  env: NodeJS.ProcessEnv
): Promise<CatalogResolution> {
  if (isSeedFallbackAllowed(env)) {
    return {
      ok: true,
      records: await seedRead(),
      source: "seed_fallback",
      warnings: [`${message} Seed fallback is explicitly enabled for local development.`]
    };
  }

  return {
    body: {
      error: {
        code,
        message: `${message} Set EE_LIBRARY_ALLOW_SEED_FALLBACK=true only for local development seed data.`
      }
    },
    ok: false,
    statusCode
  };
}
