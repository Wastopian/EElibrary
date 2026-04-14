/**
 * File header: Persists provider-neutral normalized records into Postgres.
 */

import { Pool, type PoolClient } from "pg";
import type {
  AccessoryRequirement,
  Asset,
  CableCompatibility,
  CompanionRecommendation,
  ConnectorFamily,
  DatasheetRevision,
  GenerationWorkflow,
  Manufacturer,
  MateRelation,
  Package,
  Part,
  PartMetric,
  SimilarPartRelation,
  SourceRecord
} from "@ee-library/shared/types";
import type { NormalizedProviderPart } from "./provider-adapters";

/** pool is lazy so worker status can run without requiring a database. */
let pool: Pool | null = null;

/**
 * Persists a normalized provider part into canonical Postgres tables.
 */
export async function persistNormalizedPart(normalizedPart: NormalizedProviderPart): Promise<void> {
  const databasePool = getDatabasePool();
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    await persistNormalizedPartRows(client, normalizedPart);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Persists normalized rows using an existing transaction-capable client.
 */
export async function persistNormalizedPartRows(client: PoolClient, normalizedPart: NormalizedProviderPart): Promise<void> {
  await persistManufacturer(client, normalizedPart.manufacturer);
  await persistPackage(client, normalizedPart.package);

  if (normalizedPart.connectorFamily) {
    await persistConnectorFamily(client, normalizedPart.connectorFamily);
  }

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

  for (const relation of normalizedPart.mateRelations) {
    await persistMateRelation(client, relation);
  }

  for (const requirement of normalizedPart.accessoryRequirements) {
    await persistAccessoryRequirement(client, requirement);
  }

  for (const compatibility of normalizedPart.cableCompatibilities) {
    await persistCableCompatibility(client, compatibility);
  }

  for (const relation of normalizedPart.similarPartRelations) {
    await persistSimilarPartRelation(client, relation);
  }

  for (const recommendation of normalizedPart.companionRecommendations) {
    await persistCompanionRecommendation(client, recommendation);
  }

  for (const workflow of normalizedPart.generationWorkflows) {
    await persistGenerationWorkflow(client, workflow);
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
 * Upserts one connector family row.
 */
async function persistConnectorFamily(client: PoolClient, connectorFamily: ConnectorFamily): Promise<void> {
  await client.query(
    `
      INSERT INTO connector_families (id, name, series, description)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        series = EXCLUDED.series,
        description = EXCLUDED.description
    `,
    [connectorFamily.id, connectorFamily.name, connectorFamily.series, connectorFamily.description]
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
        connector_family_id,
        trust_score,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        mpn = EXCLUDED.mpn,
        manufacturer_id = EXCLUDED.manufacturer_id,
        category = EXCLUDED.category,
        lifecycle_status = EXCLUDED.lifecycle_status,
        package_id = EXCLUDED.package_id,
        connector_family_id = EXCLUDED.connector_family_id,
        trust_score = EXCLUDED.trust_score,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [part.id, part.mpn, part.manufacturerId, part.category, part.lifecycleStatus, part.packageId, part.connectorFamilyId, part.trustScore, part.lastUpdatedAt]
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
        provenance,
        asset_status,
        generation_method,
        generation_source_asset_id,
        validation_status,
        preview_status,
        asset_state,
        source_url,
        source_record_id,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        asset_type = EXCLUDED.asset_type,
        file_format = EXCLUDED.file_format,
        storage_key = EXCLUDED.storage_key,
        file_hash = EXCLUDED.file_hash,
        provider_id = EXCLUDED.provider_id,
        license_mode = EXCLUDED.license_mode,
        provenance = EXCLUDED.provenance,
        asset_status = EXCLUDED.asset_status,
        generation_method = EXCLUDED.generation_method,
        generation_source_asset_id = EXCLUDED.generation_source_asset_id,
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
      asset.provenance,
      asset.assetStatus,
      asset.generationMethod,
      asset.generationSourceAssetId,
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
        pin_table_status,
        source_record_id,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        revision_label = EXCLUDED.revision_label,
        revision_date = EXCLUDED.revision_date,
        page_count = EXCLUDED.page_count,
        file_asset_id = EXCLUDED.file_asset_id,
        parse_confidence = EXCLUDED.parse_confidence,
        pin_table_status = EXCLUDED.pin_table_status,
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
      datasheetRevision.pinTableStatus,
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

/**
 * Upserts one connector mate relationship row.
 */
async function persistMateRelation(client: PoolClient, relation: MateRelation): Promise<void> {
  await client.query(
    `
      INSERT INTO mate_relations (
        id,
        part_id,
        mate_part_id,
        relationship_type,
        confidence_score,
        source_revision_id,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        mate_part_id = EXCLUDED.mate_part_id,
        relationship_type = EXCLUDED.relationship_type,
        confidence_score = EXCLUDED.confidence_score,
        source_revision_id = EXCLUDED.source_revision_id,
        notes = EXCLUDED.notes
    `,
    [relation.id, relation.partId, relation.matePartId, relation.relationshipType, relation.confidenceScore, relation.sourceRevisionId, relation.notes]
  );
}

/**
 * Upserts one connector accessory requirement row.
 */
async function persistAccessoryRequirement(client: PoolClient, requirement: AccessoryRequirement): Promise<void> {
  await client.query(
    `
      INSERT INTO accessory_requirements (
        id,
        part_id,
        accessory_part_id,
        relationship_type,
        confidence_score,
        source_revision_id,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        accessory_part_id = EXCLUDED.accessory_part_id,
        relationship_type = EXCLUDED.relationship_type,
        confidence_score = EXCLUDED.confidence_score,
        source_revision_id = EXCLUDED.source_revision_id,
        notes = EXCLUDED.notes
    `,
    [requirement.id, requirement.partId, requirement.accessoryPartId, requirement.relationshipType, requirement.confidenceScore, requirement.sourceRevisionId, requirement.notes]
  );
}

/**
 * Upserts one connector cable compatibility row.
 */
async function persistCableCompatibility(client: PoolClient, compatibility: CableCompatibility): Promise<void> {
  await client.query(
    `
      INSERT INTO cable_compatibilities (
        id,
        part_id,
        cable_part_id,
        relationship_type,
        confidence_score,
        source_revision_id,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        cable_part_id = EXCLUDED.cable_part_id,
        relationship_type = EXCLUDED.relationship_type,
        confidence_score = EXCLUDED.confidence_score,
        source_revision_id = EXCLUDED.source_revision_id,
        notes = EXCLUDED.notes
    `,
    [compatibility.id, compatibility.partId, compatibility.cablePartId, compatibility.relationshipType, compatibility.confidenceScore, compatibility.sourceRevisionId, compatibility.notes]
  );
}

/**
 * Upserts one similar-part relationship row.
 */
async function persistSimilarPartRelation(client: PoolClient, relation: SimilarPartRelation): Promise<void> {
  await client.query(
    `
      INSERT INTO similar_part_relations (
        id,
        part_id,
        similar_part_id,
        confidence_score,
        reason
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        similar_part_id = EXCLUDED.similar_part_id,
        confidence_score = EXCLUDED.confidence_score,
        reason = EXCLUDED.reason
    `,
    [relation.id, relation.partId, relation.similarPartId, relation.confidenceScore, relation.reason]
  );
}

/**
 * Upserts one companion recommendation row.
 */
async function persistCompanionRecommendation(client: PoolClient, recommendation: CompanionRecommendation): Promise<void> {
  await client.query(
    `
      INSERT INTO companion_recommendations (
        id,
        part_id,
        companion_part_id,
        confidence_score,
        usage_context
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        companion_part_id = EXCLUDED.companion_part_id,
        confidence_score = EXCLUDED.confidence_score,
        usage_context = EXCLUDED.usage_context
    `,
    [recommendation.id, recommendation.partId, recommendation.companionPartId, recommendation.confidenceScore, recommendation.usageContext]
  );
}

/**
 * Upserts one generation workflow row.
 */
async function persistGenerationWorkflow(client: PoolClient, workflow: GenerationWorkflow): Promise<void> {
  await client.query(
    `
      INSERT INTO generation_workflows (
        id,
        part_id,
        target_asset_type,
        source_datasheet_revision_id,
        source_asset_id,
        generation_status,
        confidence_score,
        output_asset_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        target_asset_type = EXCLUDED.target_asset_type,
        source_datasheet_revision_id = EXCLUDED.source_datasheet_revision_id,
        source_asset_id = EXCLUDED.source_asset_id,
        generation_status = EXCLUDED.generation_status,
        confidence_score = EXCLUDED.confidence_score,
        output_asset_id = EXCLUDED.output_asset_id
    `,
    [workflow.id, workflow.partId, workflow.targetAssetType, workflow.sourceDatasheetRevisionId, workflow.sourceAssetId, workflow.generationStatus, workflow.confidenceScore, workflow.outputAssetId]
  );
}
