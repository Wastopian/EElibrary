/**
 * File header: Persists provider-neutral normalized records into Postgres.
 */

import { Pool, type PoolClient } from "pg";
import type { Asset, DatasheetRevision, Manufacturer, Package, Part, PartMetric, SourceRecord } from "@ee-library/shared";
import type { NormalizedProviderPart } from "./provider-adapters";

/** pool is lazy so worker status can run without requiring a database. */
let pool: Pool | null = null;

/**
 * Persists a normalized provider part into canonical Postgres tables.
 * The optional pool argument allows tests and direct-import callers to share a connection.
 */
export async function persistNormalizedPart(normalizedPart: NormalizedProviderPart, pool?: Pool): Promise<void> {
  const databasePool = pool ?? getDatabasePool();
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    await persistManufacturer(client, normalizedPart.manufacturer);
    await persistPackage(client, normalizedPart.package);
    await persistPart(client, normalizedPart.part);
    await persistSourceRecord(client, normalizedPart.sourceRecord);

    for (const asset of normalizedPart.assets) {
      await persistAsset(client, asset);
    }

    for (const datasheetRevision of normalizedPart.datasheetRevisions) {
      await persistDatasheetRevision(client, datasheetRevision);
    }

    for (const metric of normalizedPart.metrics) {
      await persistMetric(client, metric);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Checks that Postgres is reachable for ingestion.
 */
export async function assertDatabaseReady(): Promise<void> {
  await getDatabasePool().query("SELECT 1");
}

/**
 * Creates a Postgres pool from DATABASE_URL.
 */
function getDatabasePool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for worker ingestion.");
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL
  });

  return pool;
}

/**
 * Upserts one manufacturer row.
 */
async function persistManufacturer(client: PoolClient, manufacturer: Manufacturer): Promise<void> {
  await client.query(
    `
      INSERT INTO manufacturers (id, name, aliases, website)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        aliases = EXCLUDED.aliases,
        website = EXCLUDED.website
    `,
    [manufacturer.id, manufacturer.name, manufacturer.aliases, manufacturer.website]
  );
}

/**
 * Upserts one normalized package row.
 */
async function persistPackage(client: PoolClient, partPackage: Package): Promise<void> {
  await client.query(
    `
      INSERT INTO packages (
        id,
        package_name,
        pin_count,
        pitch_mm,
        body_length_mm,
        body_width_mm,
        body_height_mm
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        package_name = EXCLUDED.package_name,
        pin_count = EXCLUDED.pin_count,
        pitch_mm = EXCLUDED.pitch_mm,
        body_length_mm = EXCLUDED.body_length_mm,
        body_width_mm = EXCLUDED.body_width_mm,
        body_height_mm = EXCLUDED.body_height_mm
    `,
    [
      partPackage.id,
      partPackage.packageName,
      partPackage.pinCount,
      partPackage.pitchMm,
      partPackage.bodyLengthMm,
      partPackage.bodyWidthMm,
      partPackage.bodyHeightMm
    ]
  );
}

/**
 * Upserts one canonical part row.
 */
async function persistPart(client: PoolClient, part: Part): Promise<void> {
  await client.query(
    `
      INSERT INTO parts (
        id,
        mpn,
        manufacturer_id,
        category,
        lifecycle_status,
        package_id,
        trust_score,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        mpn = EXCLUDED.mpn,
        manufacturer_id = EXCLUDED.manufacturer_id,
        category = EXCLUDED.category,
        lifecycle_status = EXCLUDED.lifecycle_status,
        package_id = EXCLUDED.package_id,
        trust_score = EXCLUDED.trust_score,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [part.id, part.mpn, part.manufacturerId, part.category, part.lifecycleStatus, part.packageId, part.trustScore, part.lastUpdatedAt]
  );
}

/**
 * Upserts one raw provider source record.
 */
async function persistSourceRecord(client: PoolClient, sourceRecord: SourceRecord): Promise<void> {
  await client.query(
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
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        provider_part_key = EXCLUDED.provider_part_key,
        part_id = EXCLUDED.part_id,
        source_url = EXCLUDED.source_url,
        fetched_at = EXCLUDED.fetched_at,
        raw_payload = EXCLUDED.raw_payload,
        normalized_at = EXCLUDED.normalized_at,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      sourceRecord.id,
      sourceRecord.providerId,
      sourceRecord.providerPartKey,
      sourceRecord.partId,
      sourceRecord.sourceUrl,
      sourceRecord.fetchedAt,
      JSON.stringify(sourceRecord.rawPayload),
      sourceRecord.normalizedAt,
      sourceRecord.lastUpdatedAt
    ]
  );
}

/**
 * Upserts one asset registry row.
 */
async function persistAsset(client: PoolClient, asset: Asset): Promise<void> {
  await client.query(
    `
      INSERT INTO assets (
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
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        asset_type = EXCLUDED.asset_type,
        file_format = EXCLUDED.file_format,
        storage_key = EXCLUDED.storage_key,
        file_hash = EXCLUDED.file_hash,
        provider_id = EXCLUDED.provider_id,
        license_mode = EXCLUDED.license_mode,
        validation_status = EXCLUDED.validation_status,
        preview_status = EXCLUDED.preview_status,
        asset_state = EXCLUDED.asset_state,
        source_url = EXCLUDED.source_url,
        source_record_id = EXCLUDED.source_record_id,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      asset.id,
      asset.partId,
      asset.assetType,
      asset.fileFormat,
      asset.storageKey,
      asset.fileHash,
      asset.providerId,
      asset.licenseMode,
      asset.validationStatus,
      asset.previewStatus,
      asset.assetState,
      asset.sourceUrl,
      asset.sourceRecordId,
      asset.lastUpdatedAt
    ]
  );
}

/**
 * Upserts one datasheet revision row.
 */
async function persistDatasheetRevision(client: PoolClient, datasheetRevision: DatasheetRevision): Promise<void> {
  await client.query(
    `
      INSERT INTO datasheet_revisions (
        id,
        part_id,
        revision_label,
        revision_date,
        page_count,
        file_asset_id,
        parse_confidence,
        source_record_id,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        revision_label = EXCLUDED.revision_label,
        revision_date = EXCLUDED.revision_date,
        page_count = EXCLUDED.page_count,
        file_asset_id = EXCLUDED.file_asset_id,
        parse_confidence = EXCLUDED.parse_confidence,
        source_record_id = EXCLUDED.source_record_id,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      datasheetRevision.id,
      datasheetRevision.partId,
      datasheetRevision.revisionLabel,
      datasheetRevision.revisionDate,
      datasheetRevision.pageCount,
      datasheetRevision.fileAssetId,
      datasheetRevision.parseConfidence,
      datasheetRevision.sourceRecordId,
      datasheetRevision.lastUpdatedAt
    ]
  );
}

/**
 * Upserts one normalized metric row.
 */
async function persistMetric(client: PoolClient, metric: PartMetric): Promise<void> {
  await client.query(
    `
      INSERT INTO part_metrics (
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
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        metric_key = EXCLUDED.metric_key,
        metric_value = EXCLUDED.metric_value,
        unit = EXCLUDED.unit,
        min_value = EXCLUDED.min_value,
        max_value = EXCLUDED.max_value,
        confidence_score = EXCLUDED.confidence_score,
        source_revision_id = EXCLUDED.source_revision_id,
        source_record_id = EXCLUDED.source_record_id,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      metric.id,
      metric.partId,
      metric.metricKey,
      metric.metricValue,
      metric.unit,
      metric.minValue,
      metric.maxValue,
      metric.confidenceScore,
      metric.sourceRevisionId,
      metric.sourceRecordId,
      metric.lastUpdatedAt
    ]
  );
}
