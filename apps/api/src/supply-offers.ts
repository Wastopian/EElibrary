/**
 * File header: Reads provider-neutral supply offering snapshots for part detail pages.
 */

import { Pool } from "pg";
import { CatalogStoreError } from "./catalog-store";
import { SUPPLY_OFFER_STALE_AFTER_DAYS } from "@ee-library/shared/supply-offers";
import type {
  InventoryStatus,
  LowestSupplyPriceSummary,
  PartSupplyOffersResponse,
  PriceBreak,
  SupplyOffering
} from "@ee-library/shared/types";

/** SUPPLY_OFFER_BOUNDARY_COPY explains that these rows are not live distributor authority. */
export const SUPPLY_OFFER_BOUNDARY_COPY =
  "Supply offers are source-linked commercial snapshots. They are not live distributor availability, procurement approval, or an engineering-use decision; refresh provider imports before buying parts.";

/** SupplyOfferReadResult reports whether source-linked commercial snapshots can be read. */
export type SupplyOfferReadResult =
  | { status: "available"; response: PartSupplyOffersResponse }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** DatabaseSupplyOfferingRow is one persisted commercial snapshot joined to source provenance. */
interface DatabaseSupplyOfferingRow {
  id: string;
  part_id: string;
  provider_id: string;
  source_record_id: string;
  provider_part_key: string;
  supplier_name: string | null;
  provider_sku: string | null;
  inventory_status: InventoryStatus;
  inventory_quantity: number | string | null;
  moq: number | string | null;
  lead_time_days: number | string | null;
  packaging: string | null;
  currency_code: string;
  preferred_rank: number | string | null;
  last_seen_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  source_url: string | null;
}

/** DatabasePriceBreakRow is one persisted price tier for a commercial snapshot. */
interface DatabasePriceBreakRow {
  id: string;
  supply_offering_id: string;
  min_quantity: number | string;
  unit_price: number | string;
  currency_code: string;
  captured_at: Date | string;
}

/** pool is initialized lazily so tests and local seed fallback do not require a database. */
let pool: Pool | null = null;

/** supplyOfferPoolOverride lets focused tests use pg-mem without DATABASE_URL. */
let supplyOfferPoolOverride: Pool | null | undefined;

/**
 * Overrides the supply-offer pool for tests.
 */
export function setSupplyOfferPoolForTests(databasePool: Pool | null): void {
  supplyOfferPoolOverride = databasePool;
}

/**
 * Reads source-linked supply offer snapshots for one internal part.
 */
export async function readPartSupplyOffersFromDatabase(partId: string): Promise<SupplyOfferReadResult> {
  const databasePool = getSupplyOfferDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await partExists(databasePool, partId))) {
      return {
        code: "PART_NOT_FOUND",
        message: "Part not found.",
        status: "not_found"
      };
    }

    const offerRows = await readSupplyOfferRows(databasePool, partId);
    const priceRows = offerRows.length > 0 ? await readPriceBreakRows(databasePool, offerRows.map((row) => row.id)) : [];
    const offers = offerRows.map((row) => mapSupplyOffering(row, priceRows.filter((priceRow) => priceRow.supply_offering_id === row.id)));

    return {
      response: buildPartSupplyOffersResponse(partId, offers),
      status: "available"
    };
  } catch (error) {
    throw toSupplyOfferStoreError(error);
  }
}

/**
 * Builds the API response with summary counts and stale-snapshot context.
 */
function buildPartSupplyOffersResponse(partId: string, offers: SupplyOffering[]): PartSupplyOffersResponse {
  return {
    boundary: SUPPLY_OFFER_BOUNDARY_COPY,
    offers,
    partId,
    staleAfterDays: SUPPLY_OFFER_STALE_AFTER_DAYS,
    state: offers.length > 0 ? "available" : "empty",
    summary: buildSupplyOfferSummary(offers)
  };
}

/**
 * Computes compact sourcing signals without converting supply data into approval truth.
 */
function buildSupplyOfferSummary(offers: SupplyOffering[]): PartSupplyOffersResponse["summary"] {
  const latestSeenAt = getLatestSeenAt(offers);
  const lowestUnitPrice = getLowestUnitPrice(offers);

  return {
    inStockOfferCount: offers.filter((offer) => offer.inventoryStatus === "in_stock" && offer.inventoryQuantity !== 0).length,
    lastSeenAt: latestSeenAt,
    lowestUnitPrice,
    offerCount: offers.length,
    staleOfferCount: offers.filter((offer) => isStaleTimestamp(offer.lastSeenAt)).length
  };
}

/**
 * Reads the newest source-linked commercial rows for one part.
 */
async function readSupplyOfferRows(databasePool: Pool, partId: string): Promise<DatabaseSupplyOfferingRow[]> {
  const result = await databasePool.query<DatabaseSupplyOfferingRow>(
    `
      SELECT
        so.id,
        so.part_id,
        so.provider_id,
        so.source_record_id,
        so.provider_part_key,
        so.supplier_name,
        so.provider_sku,
        so.inventory_status,
        so.inventory_quantity,
        so.moq,
        so.lead_time_days,
        so.packaging,
        so.currency_code,
        so.preferred_rank,
        so.last_seen_at,
        so.created_at,
        so.updated_at,
        sr.source_url
      FROM supply_offerings so
      JOIN source_records sr ON sr.id = so.source_record_id
      WHERE so.part_id = $1
        AND so.retired_at IS NULL
      ORDER BY
        CASE so.inventory_status
          WHEN 'in_stock' THEN 1
          WHEN 'backorder' THEN 2
          WHEN 'out_of_stock' THEN 3
          ELSE 4
        END ASC,
        so.preferred_rank ASC NULLS LAST,
        so.last_seen_at DESC,
        so.provider_id ASC,
        so.provider_part_key ASC
    `,
    [partId]
  );

  return result.rows;
}

/**
 * Reads price tiers for the selected commercial snapshots.
 */
async function readPriceBreakRows(databasePool: Pool, supplyOfferingIds: string[]): Promise<DatabasePriceBreakRow[]> {
  const result = await databasePool.query<DatabasePriceBreakRow>(
    `
      SELECT id, supply_offering_id, min_quantity, unit_price, currency_code, captured_at
      FROM price_breaks
      WHERE supply_offering_id = ANY($1::text[])
      ORDER BY supply_offering_id ASC, min_quantity ASC, captured_at DESC
    `,
    [supplyOfferingIds]
  );

  return result.rows;
}

/**
 * Checks the canonical part table before returning scoped commercial context.
 */
async function partExists(databasePool: Pool, partId: string): Promise<boolean> {
  const result = await databasePool.query<{ id: string }>("SELECT id FROM parts WHERE id = $1 LIMIT 1", [partId]);

  return result.rows.length > 0;
}

/**
 * Maps one SQL row into the shared provider-neutral supply offering contract.
 */
function mapSupplyOffering(row: DatabaseSupplyOfferingRow, priceRows: DatabasePriceBreakRow[]): SupplyOffering {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    currencyCode: row.currency_code,
    id: row.id,
    inventoryQuantity: toNullableInteger(row.inventory_quantity),
    inventoryStatus: row.inventory_status,
    lastSeenAt: toIsoTimestamp(row.last_seen_at),
    leadTimeDays: toNullableInteger(row.lead_time_days),
    moq: toNullableInteger(row.moq),
    packaging: row.packaging,
    partId: row.part_id,
    preferredRank: toNullableInteger(row.preferred_rank),
    priceBreaks: priceRows.map(mapPriceBreak),
    providerId: row.provider_id,
    providerPartKey: row.provider_part_key,
    providerSku: row.provider_sku,
    sourceRecordId: row.source_record_id,
    sourceUrl: row.source_url,
    supplierName: row.supplier_name,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps one SQL price tier into the shared API contract.
 */
function mapPriceBreak(row: DatabasePriceBreakRow): PriceBreak {
  return {
    capturedAt: toIsoTimestamp(row.captured_at),
    currencyCode: row.currency_code,
    id: row.id,
    minQuantity: toInteger(row.min_quantity),
    supplyOfferingId: row.supply_offering_id,
    unitPrice: toNumber(row.unit_price)
  };
}

/**
 * Finds the newest last-seen timestamp across commercial snapshots.
 */
function getLatestSeenAt(offers: SupplyOffering[]): string | null {
  const timestamps = offers.map((offer) => Date.parse(offer.lastSeenAt)).filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

/**
 * Finds the lowest recorded unit price while preserving its provider and MOQ context.
 */
function getLowestUnitPrice(offers: SupplyOffering[]): LowestSupplyPriceSummary | null {
  const candidates = offers.flatMap((offer) =>
    offer.priceBreaks.map((priceBreak) => ({
      currencyCode: priceBreak.currencyCode,
      minQuantity: priceBreak.minQuantity,
      offeringId: offer.id,
      providerId: offer.providerId,
      supplierName: offer.supplierName,
      unitPrice: priceBreak.unitPrice
    }))
  );

  candidates.sort((left, right) => left.unitPrice - right.unitPrice || left.minQuantity - right.minQuantity || left.providerId.localeCompare(right.providerId));

  return candidates[0] ?? null;
}

/**
 * Reports whether a timestamp is older than the configured supply freshness window.
 */
function isStaleTimestamp(timestamp: string): boolean {
  const parsed = Date.parse(timestamp);

  if (!Number.isFinite(parsed)) {
    return true;
  }

  return Date.now() - parsed > SUPPLY_OFFER_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Converts Postgres timestamps to ISO strings for API stability.
 */
function toIsoTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

/**
 * Converts nullable integer-like database values to API numbers.
 */
function toNullableInteger(value: number | string | null): number | null {
  return value === null ? null : toInteger(value);
}

/**
 * Converts integer-like database values to API numbers.
 */
function toInteger(value: number | string): number {
  return Math.trunc(toNumber(value));
}

/**
 * Converts numeric database values to finite API numbers.
 */
function toNumber(value: number | string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric supply value, received ${String(value)}`);
  }

  return parsed;
}

/**
 * Lazily creates the Postgres pool when DATABASE_URL exists.
 */
function getSupplyOfferDatabasePool(): Pool | null {
  if (supplyOfferPoolOverride !== undefined) {
    return supplyOfferPoolOverride;
  }

  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  return pool;
}

/**
 * Converts unknown Postgres/network failures into explicit catalog-store failures.
 */
function toSupplyOfferStoreError(error: unknown): CatalogStoreError {
  if (isSchemaMismatchError(error)) {
    return new CatalogStoreError("schema_mismatch", "Supply offering tables do not match the API query contract.", error);
  }

  if (isDatabaseUnavailableError(error)) {
    return new CatalogStoreError("database_unavailable", "Catalog database is configured but unavailable.", error);
  }

  return new CatalogStoreError("query_failed", "Supply offering query failed.", error);
}

/**
 * Checks common Postgres SQLSTATE codes for missing tables, columns, or functions.
 */
function isSchemaMismatchError(error: unknown): boolean {
  const code = getErrorCode(error);

  return code === "42P01" || code === "42703" || code === "42883";
}

/**
 * Checks common network and server SQLSTATE codes for unavailable databases.
 */
function isDatabaseUnavailableError(error: unknown): boolean {
  const code = getErrorCode(error);

  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "57P01" || code === "57P03";
}

/**
 * Reads a Postgres or Node error code without depending on one concrete error class.
 */
function getErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
