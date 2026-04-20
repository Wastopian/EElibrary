/**
 * File header: Persists provider-neutral normalized records into Postgres.
 */

import { Pool, type PoolClient } from "pg";
import type {
  AccessoryRequirement,
  Asset,
  AssetPromotionAuditRecord,
  AssetValidationRecord,
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
  ProviderImportDiagnostic,
  ReviewRecord,
  SimilarPartRelation,
  SourceExtractionSignal,
  SourceImportStatus,
  SourceRecord
} from "@ee-library/shared/types";
import type { NormalizedProviderPart } from "./provider-adapters";

/** pool is lazy so worker status can run without requiring a database. */
let pool: Pool | null = null;

/**
 * Replaces the worker repository pool for tests that use an in-memory database.
 */
export function setWorkerRepositoryPoolForTests(databasePool: Pool | null): void {
  pool = databasePool;
}

/** ProviderImportFailureInput carries enough context to record failed import diagnostics. */
interface ProviderImportFailureInput {
  /** Provider adapter identifier. */
  providerId: string;
  /** Lookup key requested from the provider, such as MPN or source id. */
  providerPartKey: string;
  /** Optional provider source URL when the failure happened after a URL was known. */
  sourceUrl?: string | null;
  /** Failure time used for freshness and diagnostics timestamps. */
  failedAt: string;
  /** Original failure object from fetch, normalization, or persistence. */
  error: unknown;
}

/** GenerationRunDiagnostic is a compact local view of request/workflow progress. */
export interface GenerationRunDiagnostic {
  /** Generation request id. */
  requestId: string;
  /** Canonical part id. */
  partId: string;
  /** Manufacturer part number when the part still exists. */
  mpn: string | null;
  /** Requested asset class. */
  targetAssetType: string;
  /** Request state persisted by the API or worker. */
  requestStatus: string;
  /** Linked workflow id when a workflow exists. */
  workflowId: string | null;
  /** Linked workflow state when a workflow exists. */
  generationStatus: string | null;
  /** Output asset id when generation produced a draft. */
  outputAssetId: string | null;
  /** Request creation timestamp. */
  requestedAt: string;
  /** Latest request update timestamp. */
  lastUpdatedAt: string;
}

/** ReviewDiagnostic is a compact local view of recent review decisions. */
export interface ReviewDiagnostic {
  /** Review record id. */
  id: string;
  /** Part id reviewed. */
  partId: string;
  /** Reviewed asset or generation workflow target type. */
  targetType: string;
  /** Reviewed asset id, if the target was an asset. */
  assetId: string | null;
  /** Reviewed generation workflow id, if the target was a workflow. */
  generationWorkflowId: string | null;
  /** Explicit review outcome. */
  outcome: string;
  /** Reviewer identity/source. */
  reviewer: string;
  /** Review timestamp. */
  reviewedAt: string;
}

/** ValidationDiagnostic is a compact local view of asset validation evidence. */
export interface ValidationDiagnostic {
  /** Validation record id. */
  id: string;
  /** Part id validated. */
  partId: string;
  /** Asset id with validation evidence. */
  assetId: string;
  /** Validation status. */
  validationStatus: string;
  /** Validation evidence type. */
  validationType: string;
  /** Validator identity/source. */
  validator: string;
  /** Validation timestamp. */
  validatedAt: string;
}

/** PromotionDiagnostic is a compact local view of export-promotion attempts. */
export interface PromotionDiagnostic {
  /** Promotion audit id. */
  id: string;
  /** Part id promoted or denied. */
  partId: string;
  /** Asset id targeted by promotion. */
  assetId: string;
  /** Promotion result. */
  promotionOutcome: string;
  /** Previous export status. */
  priorExportStatus: string;
  /** Resulting export status. */
  newExportStatus: string;
  /** Blocker reasons when promotion was denied. */
  blockerReasons: string[];
  /** Validation evidence referenced by a successful promotion, when present. */
  validationRecordId: string | null;
  /** Actor identity/source. */
  actor: string;
  /** Audit timestamp. */
  createdAt: string;
}

/** WorkerOperationalDiagnostics groups recent local/debug summaries without provider-specific UI. */
export interface WorkerOperationalDiagnostics {
  /** Recent import attempts from source_records. */
  recentImports: ProviderImportDiagnostic[];
  /** Recent failed import attempts from source_records. */
  failedImports: ProviderImportDiagnostic[];
  /** Recent generation request/workflow states. */
  recentGenerationRuns: GenerationRunDiagnostic[];
  /** Recent review decisions. */
  recentReviews: ReviewDiagnostic[];
  /** Recent validation evidence records. */
  recentValidations: ValidationDiagnostic[];
  /** Recent export-promotion attempts and denials. */
  recentPromotions: PromotionDiagnostic[];
}

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
 * Records a failed provider import without pretending a canonical part was created.
 */
export async function recordProviderImportFailure(input: ProviderImportFailureInput): Promise<void> {
  const databasePool = getDatabasePool();
  const client = await databasePool.connect();

  try {
    await persistProviderImportFailureRows(client, input);
  } finally {
    client.release();
  }
}

/**
 * Persists a failed import source record using an existing transaction-capable client.
 */
export async function persistProviderImportFailureRows(client: PoolClient, input: ProviderImportFailureInput): Promise<void> {
  await persistSourceRecord(client, {
    fetchedAt: input.failedAt,
    id: buildSourceRecordId(input.providerId, input.providerPartKey),
    importErrorDetails: formatImportError(input.error),
    importStatus: "failed",
    lastUpdatedAt: input.failedAt,
    normalizedAt: null,
    partId: null,
    providerId: input.providerId,
    providerPartKey: input.providerPartKey,
    rawPayload: {
      error: formatImportError(input.error),
      providerPartKey: input.providerPartKey
    },
    sourceLastImportedAt: null,
    sourceLastSeenAt: input.failedAt,
    sourceUrl: input.sourceUrl ?? null
  });
}

/**
 * Lists recent provider import diagnostics for worker-admin visibility.
 */
export async function listProviderImportDiagnostics(limit = 20, status?: SourceImportStatus): Promise<ProviderImportDiagnostic[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const result = await getDatabasePool().query<{
    id: string;
    provider_id: string;
    provider_part_key: string;
    part_id: string | null;
    source_url: string | null;
    import_status: SourceImportStatus;
    import_error_details: string | null;
    source_last_seen_at: Date | string;
    source_last_imported_at: Date | string | null;
    last_updated_at: Date | string;
  }>(
    `
      SELECT
        id,
        provider_id,
        provider_part_key,
        part_id,
        source_url,
        import_status,
        import_error_details,
        source_last_seen_at,
        source_last_imported_at,
        last_updated_at
      FROM source_records
      WHERE ($1::text IS NULL OR import_status = $1)
      ORDER BY last_updated_at DESC, id ASC
      LIMIT $2
    `,
    [status ?? null, boundedLimit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    importErrorDetails: row.import_error_details,
    importStatus: row.import_status,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    partId: row.part_id,
    providerId: row.provider_id,
    providerPartKey: row.provider_part_key,
    sourceLastImportedAt: row.source_last_imported_at ? toIsoTimestamp(row.source_last_imported_at) : null,
    sourceLastSeenAt: toIsoTimestamp(row.source_last_seen_at),
    sourceUrl: row.source_url
  }));
}

/**
 * Reads a compact operational summary for local diagnostics and worker admin commands.
 */
export async function listWorkerOperationalDiagnostics(limit = 20): Promise<WorkerOperationalDiagnostics> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const [recentImports, failedImports, recentGenerationRuns, recentReviews, recentValidations, recentPromotions] = await Promise.all([
    listProviderImportDiagnostics(boundedLimit),
    listProviderImportDiagnostics(boundedLimit, "failed"),
    listGenerationRunDiagnostics(boundedLimit),
    listReviewDiagnostics(boundedLimit),
    listValidationDiagnostics(boundedLimit),
    listPromotionDiagnostics(boundedLimit)
  ]);

  return {
    failedImports,
    recentGenerationRuns,
    recentImports,
    recentPromotions,
    recentReviews,
    recentValidations
  };
}

/**
 * Lists recent generation requests with any linked workflow/output state.
 */
async function listGenerationRunDiagnostics(limit: number): Promise<GenerationRunDiagnostic[]> {
  const result = await getDatabasePool().query<{
    generation_status: string | null;
    last_updated_at: Date | string;
    mpn: string | null;
    output_asset_id: string | null;
    part_id: string;
    request_id: string;
    request_status: string;
    requested_at: Date | string;
    target_asset_type: string;
    workflow_id: string | null;
  }>(
    `
      SELECT
        generation_requests.id AS request_id,
        generation_requests.part_id,
        parts.mpn,
        generation_requests.target_asset_type,
        generation_requests.request_status,
        generation_requests.requested_at,
        generation_requests.last_updated_at,
        generation_requests.workflow_id,
        generation_workflows.generation_status,
        generation_workflows.output_asset_id
      FROM generation_requests
      LEFT JOIN generation_workflows ON generation_workflows.id = generation_requests.workflow_id
      LEFT JOIN parts ON parts.id = generation_requests.part_id
      ORDER BY generation_requests.last_updated_at DESC, generation_requests.id DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((row) => ({
    generationStatus: row.generation_status,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    mpn: row.mpn,
    outputAssetId: row.output_asset_id,
    partId: row.part_id,
    requestId: row.request_id,
    requestedAt: toIsoTimestamp(row.requested_at),
    requestStatus: row.request_status,
    targetAssetType: row.target_asset_type,
    workflowId: row.workflow_id
  }));
}

/**
 * Lists recent review decisions for assets and generation workflows.
 */
async function listReviewDiagnostics(limit: number): Promise<ReviewDiagnostic[]> {
  const result = await getDatabasePool().query<{
    asset_id: string | null;
    generation_workflow_id: string | null;
    id: string;
    outcome: string;
    part_id: string;
    reviewed_at: Date | string;
    reviewer: string;
    target_type: string;
  }>(
    `
      SELECT
        id,
        part_id,
        target_type,
        asset_id,
        generation_workflow_id,
        outcome,
        reviewer,
        reviewed_at
      FROM review_records
      ORDER BY reviewed_at DESC, id DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((row) => ({
    assetId: row.asset_id,
    generationWorkflowId: row.generation_workflow_id,
    id: row.id,
    outcome: row.outcome,
    partId: row.part_id,
    reviewedAt: toIsoTimestamp(row.reviewed_at),
    reviewer: row.reviewer,
    targetType: row.target_type
  }));
}

/**
 * Lists recent validation evidence records used by promotion decisions.
 */
async function listValidationDiagnostics(limit: number): Promise<ValidationDiagnostic[]> {
  const result = await getDatabasePool().query<{
    asset_id: string;
    id: string;
    part_id: string;
    validated_at: Date | string;
    validation_status: string;
    validation_type: string;
    validator: string;
  }>(
    `
      SELECT
        id,
        part_id,
        asset_id,
        validation_status,
        validation_type,
        validator,
        validated_at
      FROM asset_validation_records
      ORDER BY validated_at DESC, id DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((row) => ({
    assetId: row.asset_id,
    id: row.id,
    partId: row.part_id,
    validatedAt: toIsoTimestamp(row.validated_at),
    validationStatus: row.validation_status,
    validationType: row.validation_type,
    validator: row.validator
  }));
}

/**
 * Lists recent export-promotion attempts including denials and blockers.
 */
async function listPromotionDiagnostics(limit: number): Promise<PromotionDiagnostic[]> {
  const result = await getDatabasePool().query<{
    actor: string;
    asset_id: string;
    blocker_reasons: string[];
    created_at: Date | string;
    id: string;
    new_export_status: string;
    part_id: string;
    prior_export_status: string;
    promotion_outcome: string;
    validation_record_id: string | null;
  }>(
    `
      SELECT
        id,
        part_id,
        asset_id,
        prior_export_status,
        new_export_status,
        promotion_outcome,
        blocker_reasons,
        validation_record_id,
        actor,
        created_at
      FROM asset_promotion_audits
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((row) => ({
    actor: row.actor,
    assetId: row.asset_id,
    blockerReasons: row.blocker_reasons,
    createdAt: toIsoTimestamp(row.created_at),
    id: row.id,
    newExportStatus: row.new_export_status,
    partId: row.part_id,
    priorExportStatus: row.prior_export_status,
    promotionOutcome: row.promotion_outcome,
    validationRecordId: row.validation_record_id
  }));
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

  for (const signal of normalizedPart.extractionSignals) {
    await persistSourceExtractionSignal(client, signal);
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

  for (const reviewRecord of normalizedPart.reviewRecords) {
    await persistReviewRecord(client, reviewRecord);
  }

  for (const validationRecord of normalizedPart.validationRecords) {
    await persistAssetValidationRecord(client, validationRecord);
  }

  for (const promotionAudit of normalizedPart.promotionAudits) {
    await persistAssetPromotionAudit(client, promotionAudit);
  }
}

/**
 * Reads the current import status for a pending provider + part key, or null when no row exists.
 */
export async function readSourceRecordImportStatus(providerId: string, providerPartKey: string): Promise<SourceImportStatus | null> {
  const id = buildSourceRecordId(providerId, providerPartKey);
  const result = await getDatabasePool().query<{ import_status: SourceImportStatus }>(
    `SELECT import_status FROM source_records WHERE id = $1 LIMIT 1`,
    [id]
  );

  return result.rows[0]?.import_status ?? null;
}

/**
 * Checks that Postgres is reachable for ingestion.
 */
export async function assertDatabaseReady(): Promise<void> {
  await getDatabasePool().query("SELECT 1");
}

/**
 * Returns the shared worker Postgres pool for worker-only pipeline steps.
 */
export function getWorkerDatabasePool(): Pool {
  return getDatabasePool();
}

/**
 * Creates a Postgres pool from DATABASE_URL.
 */
function getDatabasePool(): Pool {
  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for worker ingestion.");
  }

  pool = new Pool({
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
        source_last_seen_at,
        source_last_imported_at,
        import_status,
        import_error_details,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        provider_part_key = EXCLUDED.provider_part_key,
        part_id = CASE WHEN EXCLUDED.import_status = 'failed' THEN COALESCE(EXCLUDED.part_id, source_records.part_id) ELSE EXCLUDED.part_id END,
        source_url = CASE WHEN EXCLUDED.import_status = 'failed' THEN COALESCE(EXCLUDED.source_url, source_records.source_url) ELSE EXCLUDED.source_url END,
        fetched_at = CASE WHEN EXCLUDED.import_status = 'failed' THEN COALESCE(source_records.fetched_at, EXCLUDED.fetched_at) ELSE EXCLUDED.fetched_at END,
        raw_payload = CASE WHEN EXCLUDED.import_status = 'failed' THEN COALESCE(source_records.raw_payload, EXCLUDED.raw_payload) ELSE EXCLUDED.raw_payload END,
        normalized_at = CASE WHEN EXCLUDED.import_status = 'failed' THEN COALESCE(EXCLUDED.normalized_at, source_records.normalized_at) ELSE EXCLUDED.normalized_at END,
        source_last_seen_at = EXCLUDED.source_last_seen_at,
        source_last_imported_at = CASE WHEN EXCLUDED.import_status = 'failed' THEN COALESCE(EXCLUDED.source_last_imported_at, source_records.source_last_imported_at) ELSE EXCLUDED.source_last_imported_at END,
        import_status = EXCLUDED.import_status,
        import_error_details = EXCLUDED.import_error_details,
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
      sourceRecord.sourceLastSeenAt,
      sourceRecord.sourceLastImportedAt,
      sourceRecord.importStatus,
      sourceRecord.importErrorDetails,
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
        availability_status,
        review_status,
        export_status,
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        asset_type = EXCLUDED.asset_type,
        file_format = EXCLUDED.file_format,
        storage_key = EXCLUDED.storage_key,
        file_hash = EXCLUDED.file_hash,
        provider_id = EXCLUDED.provider_id,
        license_mode = EXCLUDED.license_mode,
        provenance = EXCLUDED.provenance,
        availability_status = EXCLUDED.availability_status,
        review_status = EXCLUDED.review_status,
        export_status = EXCLUDED.export_status,
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
      asset.availabilityStatus,
      asset.reviewStatus,
      asset.exportStatus,
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
 * Upserts one source extraction signal used for missing-CAD requestability.
 */
async function persistSourceExtractionSignal(client: PoolClient, signal: SourceExtractionSignal): Promise<void> {
  await client.query(
    `
      INSERT INTO source_extraction_signals (
        id,
        part_id,
        source_record_id,
        datasheet_revision_id,
        asset_id,
        signal_type,
        extraction_status,
        confidence_score,
        extraction_source,
        notes,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        source_record_id = EXCLUDED.source_record_id,
        datasheet_revision_id = EXCLUDED.datasheet_revision_id,
        asset_id = EXCLUDED.asset_id,
        signal_type = EXCLUDED.signal_type,
        extraction_status = EXCLUDED.extraction_status,
        confidence_score = EXCLUDED.confidence_score,
        extraction_source = EXCLUDED.extraction_source,
        notes = EXCLUDED.notes,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      signal.id,
      signal.partId,
      signal.sourceRecordId,
      signal.datasheetRevisionId,
      signal.assetId,
      signal.signalType,
      signal.extractionStatus,
      signal.confidenceScore,
      signal.extractionSource,
      signal.notes,
      signal.lastUpdatedAt
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

/**
 * Upserts one explicit asset or workflow review record.
 */
async function persistReviewRecord(client: PoolClient, reviewRecord: ReviewRecord): Promise<void> {
  await client.query(
    `
      INSERT INTO review_records (
        id,
        part_id,
        target_type,
        asset_id,
        generation_workflow_id,
        outcome,
        reviewer,
        notes,
        reviewed_at,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        target_type = EXCLUDED.target_type,
        asset_id = EXCLUDED.asset_id,
        generation_workflow_id = EXCLUDED.generation_workflow_id,
        outcome = EXCLUDED.outcome,
        reviewer = EXCLUDED.reviewer,
        notes = EXCLUDED.notes,
        reviewed_at = EXCLUDED.reviewed_at,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      reviewRecord.id,
      reviewRecord.partId,
      reviewRecord.targetType,
      reviewRecord.assetId,
      reviewRecord.generationWorkflowId,
      reviewRecord.outcome,
      reviewRecord.reviewer,
      reviewRecord.notes,
      reviewRecord.reviewedAt,
      reviewRecord.lastUpdatedAt
    ]
  );
}

/**
 * Upserts one durable asset validation evidence record.
 */
async function persistAssetValidationRecord(client: PoolClient, validationRecord: AssetValidationRecord): Promise<void> {
  await client.query(
    `
      INSERT INTO asset_validation_records (
        id,
        part_id,
        asset_id,
        validation_status,
        validation_type,
        validation_notes,
        validated_at,
        validator,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        asset_id = EXCLUDED.asset_id,
        validation_status = EXCLUDED.validation_status,
        validation_type = EXCLUDED.validation_type,
        validation_notes = EXCLUDED.validation_notes,
        validated_at = EXCLUDED.validated_at,
        validator = EXCLUDED.validator,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      validationRecord.id,
      validationRecord.partId,
      validationRecord.assetId,
      validationRecord.validationStatus,
      validationRecord.validationType,
      validationRecord.validationNotes,
      validationRecord.validatedAt,
      validationRecord.validator,
      validationRecord.lastUpdatedAt
    ]
  );
}

/**
 * Upserts one export-promotion audit record when fixture data explicitly provides history.
 */
async function persistAssetPromotionAudit(client: PoolClient, promotionAudit: AssetPromotionAuditRecord): Promise<void> {
  await client.query(
    `
      INSERT INTO asset_promotion_audits (
        id,
        part_id,
        asset_id,
        prior_export_status,
        new_export_status,
        promotion_outcome,
        blocker_reasons,
        validation_record_id,
        actor,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        asset_id = EXCLUDED.asset_id,
        prior_export_status = EXCLUDED.prior_export_status,
        new_export_status = EXCLUDED.new_export_status,
        promotion_outcome = EXCLUDED.promotion_outcome,
        blocker_reasons = EXCLUDED.blocker_reasons,
        validation_record_id = EXCLUDED.validation_record_id,
        actor = EXCLUDED.actor,
        created_at = EXCLUDED.created_at
    `,
    [
      promotionAudit.id,
      promotionAudit.partId,
      promotionAudit.assetId,
      promotionAudit.priorExportStatus,
      promotionAudit.newExportStatus,
      promotionAudit.promotionOutcome,
      promotionAudit.blockerReasons,
      promotionAudit.validationRecordId,
      promotionAudit.actor,
      promotionAudit.createdAt
    ]
  );
}

/**
 * Builds the same deterministic source record id shape used by provider imports.
 */
function buildSourceRecordId(providerId: string, providerPartKey: string): string {
  return `source-${slugify(providerId)}-${slugify(providerPartKey)}`;
}

/**
 * Converts unknown failures into bounded operator-readable details.
 */
function formatImportError(error: unknown): string {
  const rawMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return rawMessage.slice(0, 2000);
}

/**
 * Converts database timestamps to ISO strings for worker diagnostics.
 */
function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Converts ids and lookup keys into deterministic lowercase key fragments.
 */
function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "unknown";
}
