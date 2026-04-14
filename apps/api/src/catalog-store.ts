/**
 * File header: Reads provider-neutral catalog records from Postgres for the API service.
 */

import { Pool } from "pg";
import { getGenerationOptions } from "@ee-library/shared/asset-resolution";
import { buildBuildableMatingSet } from "@ee-library/shared/connector-intelligence";
import { applyAssetReviewOutcome, applyWorkflowReviewOutcome } from "@ee-library/shared/review-workflow";
import type {
  AccessoryRequirement,
  Asset,
  CableCompatibility,
  CompanionRecommendation,
  ConnectorFamily,
  DatasheetRevision,
  GenerationRequest,
  GenerationRequestCreateResponse,
  GenerationTargetAssetType,
  GenerationWorkflow,
  Manufacturer,
  MateRelation,
  Package,
  Part,
  PartMetric,
  PartSearchRecord,
  ReviewActionInput,
  ReviewActionResponse,
  ReviewRecord,
  SimilarPartRelation,
  SourceRecord
} from "@ee-library/shared/types";

/** CatalogStoreStatus describes whether the API can currently use Postgres. */
export interface CatalogStoreStatus {
  /** True when DATABASE_URL is configured and a simple query succeeds. */
  connected: boolean;
  /** User-facing service status for the health endpoint. */
  label: "connected" | "not_configured" | "unavailable";
}

/** CatalogReadResult makes the configured-vs-readable database state explicit. */
export type CatalogReadResult = { status: "available"; records: PartSearchRecord[] } | { status: "not_configured" };

/** GenerationRequestCreateResult reports creation or explicit requestability failure. */
export type GenerationRequestCreateResult =
  | { status: "created"; records: PartSearchRecord[]; response: GenerationRequestCreateResponse }
  | { status: "not_configured" }
  | { status: "not_found" }
  | { status: "not_requestable"; reason: string };

/** ReviewActionResult reports review persistence or explicit target failure. */
export type ReviewActionResult =
  | { status: "created"; records: PartSearchRecord[]; response: ReviewActionResponse }
  | { status: "not_configured" }
  | { status: "not_found"; reason: string };

/** CatalogStoreFailureKind distinguishes operational outages from schema/data shape problems. */
export type CatalogStoreFailureKind = "database_unavailable" | "schema_mismatch" | "query_failed";

/** CatalogStoreError wraps Postgres read errors so routes do not silently fall back to seed data. */
export class CatalogStoreError extends Error {
  /** Stable error kind for route status and test assertions. */
  readonly kind: CatalogStoreFailureKind;
  /** Original Postgres or network error. */
  override readonly cause: unknown;

  /**
   * Creates an explicit catalog-store failure.
   */
  constructor(kind: CatalogStoreFailureKind, message: string, cause: unknown) {
    super(message);
    this.name = "CatalogStoreError";
    this.kind = kind;
    this.cause = cause;
  }
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
  connector_family_id: string | null;
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
  /** Connector family fields from connector_families when the part is a connector. */
  connector_family_name: string | null;
  connector_family_series: string | null;
  connector_family_description: string | null;
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
  provenance: Asset["provenance"];
  availability_status: Asset["availabilityStatus"];
  review_status: Asset["reviewStatus"];
  export_status: Asset["exportStatus"];
  asset_status: Asset["assetStatus"];
  generation_method: string | null;
  generation_source_asset_id: string | null;
  validation_status: Asset["validationStatus"];
  preview_status: Asset["previewStatus"];
  asset_state: Asset["assetState"];
  source_url: string | null;
  source_record_id: string | null;
  last_updated_at: Date | string;
}

/** DatabaseMateRow is the connector mating relationship shape read from Postgres. */
interface DatabaseMateRow {
  /** MateRelation fields from mate_relations. */
  id: string;
  part_id: string;
  mate_part_id: string;
  relationship_type: MateRelation["relationshipType"];
  confidence_score: string;
  source_revision_id: string;
  notes: string | null;
}

/** DatabaseAccessoryRow is the accessory/tooling relationship shape read from Postgres. */
interface DatabaseAccessoryRow {
  /** AccessoryRequirement fields from accessory_requirements. */
  id: string;
  part_id: string;
  accessory_part_id: string;
  relationship_type: AccessoryRequirement["relationshipType"];
  confidence_score: string;
  source_revision_id: string;
  notes: string | null;
}

/** DatabaseCableRow is the cable compatibility relationship shape read from Postgres. */
interface DatabaseCableRow {
  /** CableCompatibility fields from cable_compatibilities. */
  id: string;
  part_id: string;
  cable_part_id: string;
  relationship_type: CableCompatibility["relationshipType"];
  confidence_score: string;
  source_revision_id: string;
  notes: string | null;
}

/** DatabaseSimilarPartRow is the similar-part relationship shape read from Postgres. */
interface DatabaseSimilarPartRow {
  /** SimilarPartRelation fields from similar_part_relations. */
  id: string;
  part_id: string;
  similar_part_id: string;
  confidence_score: string;
  reason: string;
}

/** DatabaseCompanionRow is the companion recommendation shape read from Postgres. */
interface DatabaseCompanionRow {
  /** CompanionRecommendation fields from companion_recommendations. */
  id: string;
  part_id: string;
  companion_part_id: string;
  confidence_score: string;
  usage_context: string;
}

/** DatabaseGenerationWorkflowRow is the generation workflow shape read from Postgres. */
interface DatabaseGenerationWorkflowRow {
  /** GenerationWorkflow fields from generation_workflows. */
  id: string;
  part_id: string;
  target_asset_type: GenerationWorkflow["targetAssetType"];
  source_datasheet_revision_id: string | null;
  source_asset_id: string | null;
  generation_status: GenerationWorkflow["generationStatus"];
  confidence_score: string;
  output_asset_id: string | null;
}

/** DatabaseGenerationRequestRow is the generation request shape read from Postgres. */
interface DatabaseGenerationRequestRow {
  /** GenerationRequest fields from generation_requests. */
  id: string;
  part_id: string;
  target_asset_type: GenerationRequest["targetAssetType"];
  source_datasheet_revision_id: string | null;
  source_asset_id: string | null;
  request_status: GenerationRequest["requestStatus"];
  requested_at: Date | string;
  requested_by: string;
  workflow_id: string | null;
  last_updated_at: Date | string;
}

/** DatabaseReviewRow is the review record shape read from Postgres. */
interface DatabaseReviewRow {
  /** ReviewRecord fields from review_records. */
  id: string;
  part_id: string;
  target_type: ReviewRecord["targetType"];
  asset_id: string | null;
  generation_workflow_id: string | null;
  outcome: ReviewRecord["outcome"];
  reviewer: string;
  notes: string | null;
  reviewed_at: Date | string;
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
  pin_table_status: DatasheetRevision["pinTableStatus"];
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
 * Replaces the database pool for tests that use an in-memory Postgres adapter.
 */
export function setCatalogStorePoolForTests(databasePool: Pool | null): void {
  pool = databasePool;
}

/**
 * Returns every canonical part record from Postgres, or an explicit not-configured status.
 */
export async function readCatalogRecordsFromDatabase(): Promise<CatalogReadResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  return { records: await readCatalogRecords(databasePool, null), status: "available" };
}

/**
 * Returns the requested part plus relationship targets from Postgres without loading the full catalog.
 */
export async function readPartDetailRecordsFromDatabase(partId: string): Promise<CatalogReadResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const primaryRecords = await readCatalogRecords(databasePool, [partId]);
  const primaryRecord = primaryRecords.find((record) => record.part.id === partId);

  if (!primaryRecord) {
    return { records: [], status: "available" };
  }

  const relatedIds = collectRelatedPartIds(primaryRecord);
  const detailPartIds = Array.from(new Set([partId, ...relatedIds])).sort();

  return { records: await readCatalogRecords(databasePool, detailPartIds), status: "available" };
}

/**
 * Creates a generation request when the database record has enough normalized source material.
 */
export async function createGenerationRequestInDatabase(partId: string, targetAssetType: GenerationTargetAssetType, requestedBy = "local-dev", requestedAt = new Date().toISOString()): Promise<GenerationRequestCreateResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const primaryRecords = await readCatalogRecords(databasePool, [partId]);
  const primaryRecord = primaryRecords.find((record) => record.part.id === partId);

  if (!primaryRecord) {
    return { status: "not_found" };
  }

  const generationOption = getGenerationOptions(primaryRecord).find((option) => option.targetAssetType === targetAssetType);

  if (!generationOption || !generationOption.canRequest || (!generationOption.sourceDatasheetRevisionId && !generationOption.sourceAssetId)) {
    return {
      reason: generationOption?.reason ?? "The requested asset class is not missing or is not requestable.",
      status: "not_requestable"
    };
  }

  const workflowId = generationOption.workflowId ?? buildWorkflowId(partId, targetAssetType);
  const requestId = buildGenerationRequestId(partId, targetAssetType, requestedAt);
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
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
        VALUES ($1, $2, $3, $4, $5, 'requested', $6, NULL)
        ON CONFLICT (id) DO UPDATE SET
          source_datasheet_revision_id = EXCLUDED.source_datasheet_revision_id,
          source_asset_id = EXCLUDED.source_asset_id,
          generation_status = 'requested',
          confidence_score = EXCLUDED.confidence_score
      `,
      [workflowId, partId, targetAssetType, generationOption.sourceDatasheetRevisionId, generationOption.sourceAssetId, generationOption.confidenceScore]
    );
    await client.query(
      `
        INSERT INTO generation_requests (
          id,
          part_id,
          target_asset_type,
          source_datasheet_revision_id,
          source_asset_id,
          request_status,
          requested_at,
          requested_by,
          workflow_id,
          last_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'requested', $6, $7, $8, $6)
        ON CONFLICT (id) DO UPDATE SET
          request_status = generation_requests.request_status,
          last_updated_at = generation_requests.last_updated_at
      `,
      [requestId, partId, targetAssetType, generationOption.sourceDatasheetRevisionId, generationOption.sourceAssetId, requestedAt, requestedBy, workflowId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }

  const detailResult = await readPartDetailRecordsFromDatabase(partId);

  if (detailResult.status !== "available") {
    return { status: "not_configured" };
  }

  const refreshedRecord = detailResult.records.find((record) => record.part.id === partId);
  const refreshedOption = refreshedRecord ? getGenerationOptions(refreshedRecord).find((option) => option.targetAssetType === targetAssetType) ?? generationOption : generationOption;
  const createdRequest = refreshedRecord?.generationRequests.find((request) => request.id === requestId) ?? {
    id: requestId,
    lastUpdatedAt: requestedAt,
    partId,
    requestedAt,
    requestedBy,
    requestStatus: "requested",
    sourceAssetId: generationOption.sourceAssetId,
    sourceDatasheetRevisionId: generationOption.sourceDatasheetRevisionId,
    targetAssetType,
    workflowId
  };

  return {
    records: detailResult.records,
    response: {
      generationOption: refreshedOption,
      request: createdRequest
    },
    status: "created"
  };
}

/**
 * Creates an explicit asset or workflow review and updates only the reviewed target state.
 */
export async function createReviewInDatabase(partId: string, input: ReviewActionInput, reviewer = "local-dev-review", reviewedAt = new Date().toISOString()): Promise<ReviewActionResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const primaryRecords = await readCatalogRecords(databasePool, [partId]);
  const primaryRecord = primaryRecords.find((record) => record.part.id === partId);

  if (!primaryRecord) {
    return { reason: "Part not found.", status: "not_found" };
  }

  const reviewId = buildReviewId(partId, input.targetType, input.targetId, input.outcome, reviewedAt);
  const reviewRecord = buildReviewRecord(reviewId, partId, input, reviewer, reviewedAt);
  const targetAsset = input.targetType === "asset" ? primaryRecord.assets.find((asset) => asset.id === input.targetId) ?? null : null;
  const targetWorkflow = input.targetType === "generation_workflow" ? primaryRecord.generationWorkflows.find((workflow) => workflow.id === input.targetId) ?? null : null;

  if (input.targetType === "asset" && !targetAsset) {
    return { reason: "Asset review target not found for this part.", status: "not_found" };
  }

  if (input.targetType === "generation_workflow" && !targetWorkflow) {
    return { reason: "Generation workflow review target not found for this part.", status: "not_found" };
  }

  const updatedAsset = targetAsset ? { ...applyAssetReviewOutcome(targetAsset, input.outcome), lastUpdatedAt: reviewedAt } : undefined;
  const updatedWorkflow = targetWorkflow ? applyWorkflowReviewOutcome(targetWorkflow, input.outcome) : undefined;
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        ON CONFLICT (id) DO UPDATE SET
          outcome = EXCLUDED.outcome,
          reviewer = EXCLUDED.reviewer,
          notes = EXCLUDED.notes,
          reviewed_at = EXCLUDED.reviewed_at,
          last_updated_at = EXCLUDED.last_updated_at
      `,
      [reviewRecord.id, reviewRecord.partId, reviewRecord.targetType, reviewRecord.assetId, reviewRecord.generationWorkflowId, reviewRecord.outcome, reviewRecord.reviewer, reviewRecord.notes, reviewRecord.reviewedAt]
    );

    if (updatedAsset) {
      await client.query(
        `
          UPDATE assets
          SET asset_state = $2,
              asset_status = $3,
              availability_status = $4,
              review_status = $5,
              export_status = $6,
              validation_status = $7,
              last_updated_at = $8
          WHERE id = $1 AND part_id = $9
        `,
        [updatedAsset.id, updatedAsset.assetState, updatedAsset.assetStatus, updatedAsset.availabilityStatus, updatedAsset.reviewStatus, updatedAsset.exportStatus, updatedAsset.validationStatus, reviewedAt, partId]
      );
    }

    if (updatedWorkflow) {
      await client.query(
        `
          UPDATE generation_workflows
          SET generation_status = $2
          WHERE id = $1 AND part_id = $3
        `,
        [updatedWorkflow.id, updatedWorkflow.generationStatus, partId]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }

  const detailResult = await readPartDetailRecordsFromDatabase(partId);

  if (detailResult.status !== "available") {
    return { status: "not_configured" };
  }

  const refreshedRecord = detailResult.records.find((record) => record.part.id === partId);
  const refreshedReview = refreshedRecord?.reviewRecords.find((review) => review.id === reviewId) ?? reviewRecord;
  const refreshedAsset = updatedAsset ? refreshedRecord?.assets.find((asset) => asset.id === updatedAsset.id) ?? updatedAsset : undefined;
  const refreshedWorkflow = updatedWorkflow ? refreshedRecord?.generationWorkflows.find((workflow) => workflow.id === updatedWorkflow.id) ?? updatedWorkflow : undefined;

  return {
    records: detailResult.records,
    response: {
      review: refreshedReview,
      ...(refreshedAsset ? { updatedAsset: refreshedAsset } : {}),
      ...(refreshedWorkflow ? { updatedWorkflow: refreshedWorkflow } : {})
    },
    status: "created"
  };
}

/**
 * Reads joined catalog records from Postgres with an optional part-id scope.
 */
async function readCatalogRecords(databasePool: Pool, partIds: string[] | null): Promise<PartSearchRecord[]> {
  try {
    const params = [partIds];
    const [partRows, metricRows, assetRows, datasheetRows, sourceRows, mateRows, accessoryRows, cableRows, similarRows, companionRows, workflowRows, requestRows, reviewRows] = await Promise.all([
      databasePool.query<DatabasePartRow>(PART_ROWS_SQL, params),
      databasePool.query<DatabaseMetricRow>(METRIC_ROWS_SQL, params),
      databasePool.query<DatabaseAssetRow>(ASSET_ROWS_SQL, params),
      databasePool.query<DatabaseDatasheetRow>(DATASHEET_ROWS_SQL, params),
      databasePool.query<DatabaseSourceRow>(SOURCE_ROWS_SQL, params),
      databasePool.query<DatabaseMateRow>(MATE_ROWS_SQL, params),
      databasePool.query<DatabaseAccessoryRow>(ACCESSORY_ROWS_SQL, params),
      databasePool.query<DatabaseCableRow>(CABLE_ROWS_SQL, params),
      databasePool.query<DatabaseSimilarPartRow>(SIMILAR_PART_ROWS_SQL, params),
      databasePool.query<DatabaseCompanionRow>(COMPANION_ROWS_SQL, params),
      databasePool.query<DatabaseGenerationWorkflowRow>(GENERATION_WORKFLOW_ROWS_SQL, params),
      databasePool.query<DatabaseGenerationRequestRow>(GENERATION_REQUEST_ROWS_SQL, params),
      databasePool.query<DatabaseReviewRow>(REVIEW_ROWS_SQL, params)
    ]);

    return buildPartRecords(partRows.rows, metricRows.rows, assetRows.rows, datasheetRows.rows, sourceRows.rows, mateRows.rows, accessoryRows.rows, cableRows.rows, similarRows.rows, companionRows.rows, workflowRows.rows, requestRows.rows, reviewRows.rows);
  } catch (error) {
    throw toCatalogStoreError(error);
  }
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
  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL
  });

  return pool;
}

/**
 * Collects relationship target identifiers needed for the detail related-part summaries.
 */
function collectRelatedPartIds(record: PartSearchRecord): string[] {
  return [
    ...record.mateRelations.map((relation) => relation.matePartId),
    ...record.accessoryRequirements.map((relation) => relation.accessoryPartId),
    ...record.cableCompatibilities.map((relation) => relation.cablePartId),
    ...record.similarParts.map((relation) => relation.similarPartId),
    ...record.companionRecommendations.map((relation) => relation.companionPartId)
  ];
}

/**
 * Converts unknown Postgres/network failures into explicit catalog-store failures.
 */
function toCatalogStoreError(error: unknown): CatalogStoreError {
  if (isSchemaMismatchError(error)) {
    return new CatalogStoreError("schema_mismatch", "Catalog database schema does not match the API query contract.", error);
  }

  if (isDatabaseUnavailableError(error)) {
    return new CatalogStoreError("database_unavailable", "Catalog database is configured but unavailable.", error);
  }

  return new CatalogStoreError("query_failed", "Catalog database query failed.", error);
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

/**
 * Builds a stable workflow id for a part and target asset class.
 */
function buildWorkflowId(partId: string, targetAssetType: GenerationTargetAssetType): string {
  return `gen-${partId}-${targetAssetType}`;
}

/**
 * Builds a deterministic request id from part, target, and request timestamp.
 */
function buildGenerationRequestId(partId: string, targetAssetType: GenerationTargetAssetType, requestedAt: string): string {
  return `genreq-${partId}-${targetAssetType}-${requestedAt.replace(/\D/gu, "")}`;
}

/**
 * Builds a deterministic review record id from target, outcome, and timestamp.
 */
function buildReviewId(partId: string, targetType: ReviewActionInput["targetType"], targetId: string, outcome: ReviewActionInput["outcome"], reviewedAt: string): string {
  return `review-${partId}-${targetType}-${targetId}-${outcome}-${reviewedAt.replace(/\D/gu, "")}`;
}

/**
 * Builds a review record with exactly one linked review target.
 */
function buildReviewRecord(id: string, partId: string, input: ReviewActionInput, reviewer: string, reviewedAt: string): ReviewRecord {
  return {
    assetId: input.targetType === "asset" ? input.targetId : null,
    generationWorkflowId: input.targetType === "generation_workflow" ? input.targetId : null,
    id,
    lastUpdatedAt: reviewedAt,
    notes: input.notes ?? null,
    outcome: input.outcome,
    partId,
    reviewedAt,
    reviewer,
    targetType: input.targetType
  };
}

/**
 * Builds joined API records from flat database row sets.
 */
function buildPartRecords(
  partRows: DatabasePartRow[],
  metricRows: DatabaseMetricRow[],
  assetRows: DatabaseAssetRow[],
  datasheetRows: DatabaseDatasheetRow[],
  sourceRows: DatabaseSourceRow[],
  mateRows: DatabaseMateRow[],
  accessoryRows: DatabaseAccessoryRow[],
  cableRows: DatabaseCableRow[],
  similarRows: DatabaseSimilarPartRow[],
  companionRows: DatabaseCompanionRow[],
  workflowRows: DatabaseGenerationWorkflowRow[],
  requestRows: DatabaseGenerationRequestRow[],
  reviewRows: DatabaseReviewRow[]
): PartSearchRecord[] {
  const metricsByPartId = groupBy(metricRows.map(mapMetricRow), (metric) => metric.partId);
  const assetsByPartId = groupBy(assetRows.map(mapAssetRow), (asset) => asset.partId);
  const datasheetsByPartId = groupBy(datasheetRows.map(mapDatasheetRow), (datasheet) => datasheet.partId);
  const sourcesByPartId = groupBy(sourceRows.map(mapSourceRow), (source) => source.partId ?? "");
  const matesByPartId = groupBy(mateRows.map(mapMateRow), (relation) => relation.partId);
  const accessoriesByPartId = groupBy(accessoryRows.map(mapAccessoryRow), (relation) => relation.partId);
  const cablesByPartId = groupBy(cableRows.map(mapCableRow), (relation) => relation.partId);
  const similarPartsByPartId = groupBy(similarRows.map(mapSimilarPartRow), (relation) => relation.partId);
  const companionsByPartId = groupBy(companionRows.map(mapCompanionRow), (relation) => relation.partId);
  const workflowsByPartId = groupBy(workflowRows.map(mapGenerationWorkflowRow), (workflow) => workflow.partId);
  const requestsByPartId = groupBy(requestRows.map(mapGenerationRequestRow), (request) => request.partId);
  const reviewsByPartId = groupBy(reviewRows.map(mapReviewRow), (review) => review.partId);

  return partRows.map((row) => {
    const part = mapPartRow(row);
    const metrics = metricsByPartId.get(part.id) ?? [];
    const assets = assetsByPartId.get(part.id) ?? [];
    const datasheets = datasheetsByPartId.get(part.id) ?? [];
    const sources = sourcesByPartId.get(part.id) ?? [];
    const mateRelations = matesByPartId.get(part.id) ?? [];
    const accessoryRequirements = accessoriesByPartId.get(part.id) ?? [];
    const cableCompatibilities = cablesByPartId.get(part.id) ?? [];
    const similarParts = similarPartsByPartId.get(part.id) ?? [];
    const companionRecommendations = companionsByPartId.get(part.id) ?? [];
    const generationWorkflows = workflowsByPartId.get(part.id) ?? [];
    const generationRequests = requestsByPartId.get(part.id) ?? [];
    const reviewRecords = reviewsByPartId.get(part.id) ?? [];
    const lastUpdatedAt = latestTimestamp([part.lastUpdatedAt, ...metrics.map((metric) => metric.lastUpdatedAt), ...assets.map((asset) => asset.lastUpdatedAt), ...datasheets.map((datasheet) => datasheet.lastUpdatedAt), ...sources.map((source) => source.lastUpdatedAt), ...generationRequests.map((request) => request.lastUpdatedAt), ...reviewRecords.map((review) => review.lastUpdatedAt)]);

    return {
      accessoryRequirements,
      assets,
      buildableMatingSet: buildBuildableMatingSet(mateRelations, accessoryRequirements, cableCompatibilities),
      cableCompatibilities,
      companionRecommendations,
      connectorFamily: mapConnectorFamilyRow(row),
      datasheetRevision: selectLatestDatasheet(datasheets),
      generationRequests,
      generationWorkflows,
      lastUpdatedAt,
      manufacturer: mapManufacturerRow(row),
      mateRelations,
      metrics,
      package: mapPackageRow(row),
      part,
      reviewRecords,
      similarParts,
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
    connectorFamilyId: row.connector_family_id,
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
 * Maps joined connector family fields into the shared ConnectorFamily type.
 */
function mapConnectorFamilyRow(row: DatabasePartRow): ConnectorFamily | null {
  if (!row.connector_family_id || !row.connector_family_name || !row.connector_family_series || !row.connector_family_description) {
    return null;
  }

  return {
    description: row.connector_family_description,
    id: row.connector_family_id,
    name: row.connector_family_name,
    series: row.connector_family_series
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
    availabilityStatus: row.availability_status,
    assetState: row.asset_state,
    assetStatus: row.asset_status,
    assetType: row.asset_type,
    fileFormat: row.file_format,
    fileHash: row.file_hash,
    id: row.id,
    generationMethod: row.generation_method,
    generationSourceAssetId: row.generation_source_asset_id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    licenseMode: row.license_mode,
    partId: row.part_id,
    previewStatus: row.preview_status,
    providerId: row.provider_id,
    provenance: row.provenance,
    reviewStatus: row.review_status,
    exportStatus: row.export_status,
    sourceRecordId: row.source_record_id,
    sourceUrl: row.source_url,
    storageKey: row.storage_key,
    validationStatus: row.validation_status
  };
}

/**
 * Maps a database row into the shared MateRelation type.
 */
function mapMateRow(row: DatabaseMateRow): MateRelation {
  return {
    confidenceScore: toNumber(row.confidence_score),
    id: row.id,
    matePartId: row.mate_part_id,
    notes: row.notes,
    partId: row.part_id,
    relationshipType: row.relationship_type,
    sourceRevisionId: row.source_revision_id
  };
}

/**
 * Maps a database row into the shared AccessoryRequirement type.
 */
function mapAccessoryRow(row: DatabaseAccessoryRow): AccessoryRequirement {
  return {
    accessoryPartId: row.accessory_part_id,
    confidenceScore: toNumber(row.confidence_score),
    id: row.id,
    notes: row.notes,
    partId: row.part_id,
    relationshipType: row.relationship_type,
    sourceRevisionId: row.source_revision_id
  };
}

/**
 * Maps a database row into the shared CableCompatibility type.
 */
function mapCableRow(row: DatabaseCableRow): CableCompatibility {
  return {
    cablePartId: row.cable_part_id,
    confidenceScore: toNumber(row.confidence_score),
    id: row.id,
    notes: row.notes,
    partId: row.part_id,
    relationshipType: row.relationship_type,
    sourceRevisionId: row.source_revision_id
  };
}

/**
 * Maps a database row into the shared SimilarPartRelation type.
 */
function mapSimilarPartRow(row: DatabaseSimilarPartRow): SimilarPartRelation {
  return {
    confidenceScore: toNumber(row.confidence_score),
    id: row.id,
    partId: row.part_id,
    reason: row.reason,
    similarPartId: row.similar_part_id
  };
}

/**
 * Maps a database row into the shared CompanionRecommendation type.
 */
function mapCompanionRow(row: DatabaseCompanionRow): CompanionRecommendation {
  return {
    companionPartId: row.companion_part_id,
    confidenceScore: toNumber(row.confidence_score),
    id: row.id,
    partId: row.part_id,
    usageContext: row.usage_context
  };
}

/**
 * Maps a database row into the shared GenerationWorkflow type.
 */
function mapGenerationWorkflowRow(row: DatabaseGenerationWorkflowRow): GenerationWorkflow {
  return {
    confidenceScore: toNumber(row.confidence_score),
    generationStatus: row.generation_status,
    id: row.id,
    outputAssetId: row.output_asset_id,
    partId: row.part_id,
    sourceAssetId: row.source_asset_id,
    sourceDatasheetRevisionId: row.source_datasheet_revision_id,
    targetAssetType: row.target_asset_type
  };
}

/**
 * Maps a database row into the shared GenerationRequest type.
 */
function mapGenerationRequestRow(row: DatabaseGenerationRequestRow): GenerationRequest {
  return {
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    partId: row.part_id,
    requestedAt: toIsoTimestamp(row.requested_at),
    requestedBy: row.requested_by,
    requestStatus: row.request_status,
    sourceAssetId: row.source_asset_id,
    sourceDatasheetRevisionId: row.source_datasheet_revision_id,
    targetAssetType: row.target_asset_type,
    workflowId: row.workflow_id
  };
}

/**
 * Maps a database row into the shared ReviewRecord type.
 */
function mapReviewRow(row: DatabaseReviewRow): ReviewRecord {
  return {
    assetId: row.asset_id,
    generationWorkflowId: row.generation_workflow_id,
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    notes: row.notes,
    outcome: row.outcome,
    partId: row.part_id,
    reviewedAt: toIsoTimestamp(row.reviewed_at),
    reviewer: row.reviewer,
    targetType: row.target_type
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
    pinTableStatus: row.pin_table_status,
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
  return [...datasheets].sort((first, second) => Date.parse(second.revisionDate ?? second.lastUpdatedAt) - Date.parse(first.revisionDate ?? first.lastUpdatedAt) || first.id.localeCompare(second.id))[0] ?? null;
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
    p.connector_family_id,
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
    pk.body_height_mm,
    cf.name AS connector_family_name,
    cf.series AS connector_family_series,
    cf.description AS connector_family_description
  FROM parts p
  JOIN manufacturers m ON m.id = p.manufacturer_id
  JOIN packages pk ON pk.id = p.package_id
  LEFT JOIN connector_families cf ON cf.id = p.connector_family_id
  WHERE ($1::text[] IS NULL OR p.id = ANY($1::text[]))
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
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
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
  FROM assets
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY asset_type ASC, last_updated_at DESC, id ASC
`;

/** MATE_ROWS_SQL reads connector mating relationships. */
const MATE_ROWS_SQL = `
  SELECT
    id,
    part_id,
    mate_part_id,
    relationship_type,
    confidence_score,
    source_revision_id,
    notes
  FROM mate_relations
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY confidence_score DESC, id ASC
`;

/** ACCESSORY_ROWS_SQL reads required, optional, and tooling relationships. */
const ACCESSORY_ROWS_SQL = `
  SELECT
    id,
    part_id,
    accessory_part_id,
    relationship_type,
    confidence_score,
    source_revision_id,
    notes
  FROM accessory_requirements
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY confidence_score DESC, id ASC
`;

/** CABLE_ROWS_SQL reads cable compatibility relationships. */
const CABLE_ROWS_SQL = `
  SELECT
    id,
    part_id,
    cable_part_id,
    relationship_type,
    confidence_score,
    source_revision_id,
    notes
  FROM cable_compatibilities
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY confidence_score DESC, id ASC
`;

/** SIMILAR_PART_ROWS_SQL reads similar-part recommendations. */
const SIMILAR_PART_ROWS_SQL = `
  SELECT
    id,
    part_id,
    similar_part_id,
    confidence_score,
    reason
  FROM similar_part_relations
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY confidence_score DESC, id ASC
`;

/** COMPANION_ROWS_SQL reads companion recommendations. */
const COMPANION_ROWS_SQL = `
  SELECT
    id,
    part_id,
    companion_part_id,
    confidence_score,
    usage_context
  FROM companion_recommendations
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY confidence_score DESC, id ASC
`;

/** GENERATION_WORKFLOW_ROWS_SQL reads asset generation workflow status. */
const GENERATION_WORKFLOW_ROWS_SQL = `
  SELECT
    id,
    part_id,
    target_asset_type,
    source_datasheet_revision_id,
    source_asset_id,
    generation_status,
    confidence_score,
    output_asset_id
  FROM generation_workflows
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY confidence_score DESC, id ASC
`;

/** GENERATION_REQUEST_ROWS_SQL reads explicit generation request state. */
const GENERATION_REQUEST_ROWS_SQL = `
  SELECT
    id,
    part_id,
    target_asset_type,
    source_datasheet_revision_id,
    source_asset_id,
    request_status,
    requested_at,
    requested_by,
    workflow_id,
    last_updated_at
  FROM generation_requests
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY requested_at DESC, id DESC
`;

/** REVIEW_ROWS_SQL reads explicit asset and workflow review decisions. */
const REVIEW_ROWS_SQL = `
  SELECT
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
  FROM review_records
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY reviewed_at DESC, id DESC
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
    pin_table_status,
    source_record_id,
    last_updated_at
  FROM datasheet_revisions
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
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
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY fetched_at DESC
`;
