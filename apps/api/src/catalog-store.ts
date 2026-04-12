/**
 * File header: Reads provider-neutral catalog records from Postgres for the API service.
 */

import { Pool } from "pg";
import type {
  Asset,
  DatasheetRevision,
  Manufacturer,
  Package,
  Part,
  PartMetric,
  PartSearchRecord,
  SourceRecord
} from "@ee-library/shared";

/** CatalogStoreStatus describes whether the API can currently use Postgres. */
export interface CatalogStoreStatus {
  /** True when DATABASE_URL is configured and a simple query succeeds. */
  connected: boolean;
  /** User-facing service status for the health endpoint. */
  label: "connected" | "not_configured" | "unavailable";
}

/** DatabasePartRow is the joined canonical part row shape read from Postgres. */
interface DatabasePartRow {
  /** Canonical part fields from parts. */
  part_id: string;
  mpn: string;
  manufacturer_id: string;
  category: string;
  lifecycle_status: Part["lifecycleStatus"];
  package_id: string;
  trust_score: string;
  part_last_updated_at: Date | string;
  /** Manufacturer fields from manufacturers. */
  manufacturer_name: string;
  manufacturer_aliases: string[];
  manufacturer_website: string | null;
  /** Package fields from packages. */
  package_name: string;
  pin_count: number | null;
  pitch_mm: string | null;
  body_length_mm: string | null;
  body_width_mm: string | null;
  body_height_mm: string | null;
}

/** DatabaseMetricRow is the part metric row shape read from Postgres. */
interface DatabaseMetricRow {
  /** PartMetric fields from part_metrics. */
  id: string;
  part_id: string;
  metric_key: string;
  metric_value: string | null;
  unit: PartMetric["unit"];
  min_value: string | null;
  max_value: string | null;
  confidence_score: string;
  source_revision_id: string;
  source_record_id: string | null;
  last_updated_at: Date | string;
}

/** DatabaseAssetRow is the asset row shape read from Postgres. */
interface DatabaseAssetRow {
  /** Asset fields from assets. */
  id: string;
  part_id: string;
  asset_type: Asset["assetType"];
  file_format: Asset["fileFormat"];
  storage_key: string | null;
  file_hash: string | null;
  provider_id: string | null;
  license_mode: Asset["licenseMode"];
  validation_status: Asset["validationStatus"];
  preview_status: Asset["previewStatus"];
  asset_state: Asset["assetState"];
  source_url: string | null;
  source_record_id: string | null;
  last_updated_at: Date | string;
}

/** DatabaseDatasheetRow is the datasheet row shape read from Postgres. */
interface DatabaseDatasheetRow {
  /** DatasheetRevision fields from datasheet_revisions. */
  id: string;
  part_id: string;
  revision_label: string;
  revision_date: Date | string | null;
  page_count: number | null;
  file_asset_id: string | null;
  parse_confidence: string;
  source_record_id: string | null;
  last_updated_at: Date | string;
}

/** DatabaseSourceRow is the source record row shape read from Postgres. */
interface DatabaseSourceRow {
  /** SourceRecord fields from source_records. */
  id: string;
  provider_id: string;
  provider_part_key: string;
  part_id: string | null;
  source_url: string | null;
  fetched_at: Date | string;
  raw_payload: unknown;
  normalized_at: Date | string | null;
  last_updated_at: Date | string;
}

/** pool is initialized lazily so tests and seed fallback do not require DATABASE_URL. */
let pool: Pool | null = null;

/**
 * Returns every canonical part record from Postgres, or null when the database is not configured.
 */
export async function readCatalogRecordsFromDatabase(): Promise<PartSearchRecord[] | null> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return null;
  }

  const [partRows, metricRows, assetRows, datasheetRows, sourceRows] = await Promise.all([
    databasePool.query<DatabasePartRow>(PART_ROWS_SQL),
    databasePool.query<DatabaseMetricRow>(METRIC_ROWS_SQL),
    databasePool.query<DatabaseAssetRow>(ASSET_ROWS_SQL),
    databasePool.query<DatabaseDatasheetRow>(DATASHEET_ROWS_SQL),
    databasePool.query<DatabaseSourceRow>(SOURCE_ROWS_SQL)
  ]);

  return buildPartRecords(partRows.rows, metricRows.rows, assetRows.rows, datasheetRows.rows, sourceRows.rows);
}

/**
 * Reports whether Postgres is configured and reachable.
 */
export async function getCatalogStoreStatus(): Promise<CatalogStoreStatus> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return {
      connected: false,
      label: "not_configured"
    };
  }

  try {
    await databasePool.query("SELECT 1");
    return {
      connected: true,
      label: "connected"
    };
  } catch {
    return {
      connected: false,
      label: "unavailable"
    };
  }
}

/**
 * Lazily creates the Postgres pool when DATABASE_URL exists.
 */
function getDatabasePool(): Pool | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL
  });

  return pool;
}

/**
 * Builds joined API records from flat database row sets.
 */
function buildPartRecords(
  partRows: DatabasePartRow[],
  metricRows: DatabaseMetricRow[],
  assetRows: DatabaseAssetRow[],
  datasheetRows: DatabaseDatasheetRow[],
  sourceRows: DatabaseSourceRow[]
): PartSearchRecord[] {
  const metricsByPartId = groupBy(metricRows.map(mapMetricRow), (metric) => metric.partId);
  const assetsByPartId = groupBy(assetRows.map(mapAssetRow), (asset) => asset.partId);
  const datasheetsByPartId = groupBy(datasheetRows.map(mapDatasheetRow), (datasheet) => datasheet.partId);
  const sourcesByPartId = groupBy(sourceRows.map(mapSourceRow), (source) => source.partId ?? "");

  return partRows.map((row) => {
    const part = mapPartRow(row);
    const metrics = metricsByPartId.get(part.id) ?? [];
    const assets = assetsByPartId.get(part.id) ?? [];
    const datasheets = datasheetsByPartId.get(part.id) ?? [];
    const sources = sourcesByPartId.get(part.id) ?? [];
    const lastUpdatedAt = latestTimestamp([part.lastUpdatedAt, ...metrics.map((metric) => metric.lastUpdatedAt), ...assets.map((asset) => asset.lastUpdatedAt), ...datasheets.map((datasheet) => datasheet.lastUpdatedAt), ...sources.map((source) => source.lastUpdatedAt)]);

    return {
      assets,
      datasheetRevision: selectLatestDatasheet(datasheets),
      lastUpdatedAt,
      manufacturer: mapManufacturerRow(row),
      metrics,
      package: mapPackageRow(row),
      part,
      sources
    };
  });
}

/**
 * Maps a database row into the shared Part type.
 */
function mapPartRow(row: DatabasePartRow): Part {
  return {
    category: row.category,
    id: row.part_id,
    lastUpdatedAt: toIsoTimestamp(row.part_last_updated_at),
    lifecycleStatus: row.lifecycle_status,
    manufacturerId: row.manufacturer_id,
    mpn: row.mpn,
    packageId: row.package_id,
    trustScore: toNumber(row.trust_score)
  };
}

/**
 * Maps a database row into the shared Manufacturer type.
 */
function mapManufacturerRow(row: DatabasePartRow): Manufacturer {
  return {
    aliases: row.manufacturer_aliases,
    id: row.manufacturer_id,
    name: row.manufacturer_name,
    website: row.manufacturer_website
  };
}

/**
 * Maps a database row into the shared Package type.
 */
function mapPackageRow(row: DatabasePartRow): Package {
  return {
    bodyHeightMm: toNullableNumber(row.body_height_mm),
    bodyLengthMm: toNullableNumber(row.body_length_mm),
    bodyWidthMm: toNullableNumber(row.body_width_mm),
    id: row.package_id,
    packageName: row.package_name,
    pinCount: row.pin_count,
    pitchMm: toNullableNumber(row.pitch_mm)
  };
}

/**
 * Maps a database row into the shared PartMetric type.
 */
function mapMetricRow(row: DatabaseMetricRow): PartMetric {
  return {
    confidenceScore: toNumber(row.confidence_score),
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    maxValue: toNullableNumber(row.max_value),
    metricKey: row.metric_key,
    metricValue: toNullableNumber(row.metric_value),
    minValue: toNullableNumber(row.min_value),
    partId: row.part_id,
    sourceRecordId: row.source_record_id,
    sourceRevisionId: row.source_revision_id,
    unit: row.unit
  };
}

/**
 * Maps a database row into the shared Asset type.
 */
function mapAssetRow(row: DatabaseAssetRow): Asset {
  return {
    assetState: row.asset_state,
    assetType: row.asset_type,
    fileFormat: row.file_format,
    fileHash: row.file_hash,
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    licenseMode: row.license_mode,
    partId: row.part_id,
    previewStatus: row.preview_status,
    providerId: row.provider_id,
    sourceRecordId: row.source_record_id,
    sourceUrl: row.source_url,
    storageKey: row.storage_key,
    validationStatus: row.validation_status
  };
}

/**
 * Maps a database row into the shared DatasheetRevision type.
 */
function mapDatasheetRow(row: DatabaseDatasheetRow): DatasheetRevision {
  return {
    fileAssetId: row.file_asset_id,
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    pageCount: row.page_count,
    parseConfidence: toNumber(row.parse_confidence),
    partId: row.part_id,
    revisionDate: row.revision_date ? toIsoDate(row.revision_date) : null,
    revisionLabel: row.revision_label,
    sourceRecordId: row.source_record_id
  };
}

/**
 * Maps a database row into the shared SourceRecord type.
 */
function mapSourceRow(row: DatabaseSourceRow): SourceRecord {
  return {
    fetchedAt: toIsoTimestamp(row.fetched_at),
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    normalizedAt: row.normalized_at ? toIsoTimestamp(row.normalized_at) : null,
    partId: row.part_id,
    providerId: row.provider_id,
    providerPartKey: row.provider_part_key,
    rawPayload: row.raw_payload,
    sourceUrl: row.source_url
  };
}

/**
 * Picks the newest datasheet revision by revision date and update time.
 */
function selectLatestDatasheet(datasheets: DatasheetRevision[]): DatasheetRevision | null {
  return datasheets.sort((first, second) => Date.parse(second.revisionDate ?? second.lastUpdatedAt) - Date.parse(first.revisionDate ?? first.lastUpdatedAt))[0] ?? null;
}

/**
 * Groups values by a stable string key.
 */
function groupBy<TValue>(values: TValue[], getKey: (value: TValue) => string): Map<string, TValue[]> {
  const groups = new Map<string, TValue[]>();

  for (const value of values) {
    const key = getKey(value);
    const group = groups.get(key) ?? [];

    group.push(value);
    groups.set(key, group);
  }

  return groups;
}

/**
 * Returns the newest ISO timestamp in a set of timestamp strings.
 */
function latestTimestamp(timestamps: string[]): string {
  return timestamps.sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? new Date(0).toISOString();
}

/**
 * Converts a Postgres numeric value into a JavaScript number.
 */
function toNumber(value: string): number {
  return Number(value);
}

/**
 * Converts a nullable Postgres numeric value into a JavaScript number or null.
 */
function toNullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Converts a database timestamp value into an ISO timestamp.
 */
function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Converts a database date value into an ISO date string.
 */
function toIsoDate(value: Date | string): string {
  return toIsoTimestamp(value).slice(0, 10);
}

/** PART_ROWS_SQL reads canonical parts with manufacturer and package joins. */
const PART_ROWS_SQL = `
  SELECT
    p.id AS part_id,
    p.mpn,
    p.manufacturer_id,
    p.category,
    p.lifecycle_status,
    p.package_id,
    p.trust_score,
    p.last_updated_at AS part_last_updated_at,
    m.name AS manufacturer_name,
    m.aliases AS manufacturer_aliases,
    m.website AS manufacturer_website,
    pk.package_name,
    pk.pin_count,
    pk.pitch_mm,
    pk.body_length_mm,
    pk.body_width_mm,
    pk.body_height_mm
  FROM parts p
  JOIN manufacturers m ON m.id = p.manufacturer_id
  JOIN packages pk ON pk.id = p.package_id
  ORDER BY p.mpn ASC
`;

/** METRIC_ROWS_SQL reads normalized metric records. */
const METRIC_ROWS_SQL = `
  SELECT
    id,
    part_id,
    metric_key,
    metric_value,
    unit,
    min_value,
    max_value,
    confidence_score,
    source_revision_id,
    source_record_id,
    last_updated_at
  FROM part_metrics
  ORDER BY metric_key ASC
`;

/** ASSET_ROWS_SQL reads asset registry records. */
const ASSET_ROWS_SQL = `
  SELECT
    id,
    part_id,
    asset_type,
    file_format,
    storage_key,
    file_hash,
    provider_id,
    license_mode,
    validation_status,
    preview_status,
    asset_state,
    source_url,
    source_record_id,
    last_updated_at
  FROM assets
  ORDER BY asset_type ASC
`;

/** DATASHEET_ROWS_SQL reads datasheet revision records. */
const DATASHEET_ROWS_SQL = `
  SELECT
    id,
    part_id,
    revision_label,
    revision_date,
    page_count,
    file_asset_id,
    parse_confidence,
    source_record_id,
    last_updated_at
  FROM datasheet_revisions
  ORDER BY revision_date DESC NULLS LAST, last_updated_at DESC
`;

/** SOURCE_ROWS_SQL reads raw provider source records. */
const SOURCE_ROWS_SQL = `
  SELECT
    id,
    provider_id,
    provider_part_key,
    part_id,
    source_url,
    fetched_at,
    raw_payload,
    normalized_at,
    last_updated_at
  FROM source_records
  ORDER BY fetched_at DESC
`;
