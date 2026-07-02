/**
 * File header: Reads provider-neutral catalog records from Postgres for the API service.
 */

import { performance } from "node:perf_hooks";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { getGenerationOptions } from "@ee-library/shared/asset-resolution";
import { buildSearchPagination, buildSearchQueryTokens, buildSearchTokenAlternates } from "@ee-library/shared/catalog-runtime";
import { buildBuildableMatingSet } from "@ee-library/shared/connector-intelligence";
import { derivePartProjection } from "@ee-library/shared/part-readiness";
import { applyAssetReviewOutcome, applyWorkflowReviewOutcome, getAssetPromotionBlockers, getQualifyingValidationForAsset, promoteAssetToVerifiedForExport } from "@ee-library/shared/review-workflow";
import { getRequestOrgId, requireRequestOrgId } from "./request-context";
import { getRequestDb } from "./request-db";
import type {
  AccessoryRequirement,
  AssetPromotionAuditRecord,
  AssetPromotionResponse,
  Asset,
  AssetValidationRecord,
  CableCompatibility,
  CompanionRecommendation,
  ConnectorClass,
  ConnectorFamily,
  ConnectorFamilyConflict,
  DatasheetRevision,
  GenerationRequest,
  GenerationRequestCreateResponse,
  GenerationTargetAssetType,
  GenerationWorkflow,
  Manufacturer,
  MateRelation,
  Package,
  Part,
  PartAcquisitionSummary,
  PartApproval,
  PartApprovalStatus,
  PartDuplicateCandidate,
  PartEnrichmentJobSummary,
  PartEnrichmentSummary,
  PartIssueCode,
  PartIssueWorkflowUpdateInput,
  PartIssueWorkflowUpdateResponse,
  PartIssue,
  PartReadinessStatus,
  PartRiskFlag,
  PartEngineeringMemoryWarningPreview,
  PartEngineeringMemoryWarningSummary,
  PartEngineeringRecordKind,
  PartEngineeringRecordOutcome,
  PartEngineeringRecordSeverity,
  PartMetric,
  PartSearchFilters,
  PartSearchRecord,
  PartSearchSort,
  ProviderAcquisitionJob,
  ProviderAcquisitionJobCreateInput,
  ProviderAcquisitionJobDetailResponse,
  ProviderAcquisitionJobEvent,
  ProviderAcquisitionJobStatus,
  ProviderEnrichmentJobStatus,
  ProviderEnrichmentJobType,
  ProviderImportOutcome,
  ProviderLookupMatchType,
  ReviewActionInput,
  ReviewActionResponse,
  ReviewRecord,
  SearchFacets,
  SearchPagination,
  SimilarPartRelation,
  SourceExtractionSignal,
  SourceImportStatus,
  SourceReconciliationRecord,
  SourceReconciliationUpdateInput,
  SourceReconciliationUpdateResponse,
  SourceRecord
} from "@ee-library/shared/types";

/** CatalogStoreStatus describes whether the API can currently use Postgres. */
export interface CatalogStoreStatus {
  /** True when DATABASE_URL is configured and a simple query succeeds. */
  connected: boolean;
  /** User-facing service status for the health endpoint. */
  label: "connected" | "not_configured" | "unavailable";
}

/** CatalogQueryTiming reports one DB query duration without exposing SQL text or provider details. */
export interface CatalogQueryTiming {
  /** Stable query family name for logs and Server-Timing headers. */
  name: string;
  /** Query duration in milliseconds. */
  durationMs: number;
  /** Number of rows returned when the query completed. */
  rowCount: number | null;
  /** True when the query ran for a scoped detail subset instead of the full catalog. */
  scoped: boolean;
  /** Query status for failure-safe diagnostics. */
  status: "ok" | "failed";
}

/** CatalogReadOptions lets API routes collect DB timings without changing response data. */
export interface CatalogReadOptions {
  /** Optional sink for query timing records. */
  onQueryTiming?: (timing: CatalogQueryTiming) => void;
}

/** CatalogReadResult makes the configured-vs-readable database state explicit. */
export type CatalogReadResult = { status: "available"; records: PartSearchRecord[] } | { status: "not_configured" };

/** CatalogSearchReadResult adds pagination metadata for SQL-backed search reads. */
export type CatalogSearchReadResult = { status: "available"; records: PartSearchRecord[]; pagination: SearchPagination } | { status: "not_configured" };

/** CatalogSearchFacetsReadResult returns SQL-backed search facets without full catalog projection. */
export type CatalogSearchFacetsReadResult = { status: "available"; facets: SearchFacets } | { status: "not_configured" };

/** GenerationRequestCreateResult reports creation or explicit requestability failure. */
export type GenerationRequestCreateResult =
  | { status: "created"; records: PartSearchRecord[]; response: GenerationRequestCreateResponse }
  | { status: "not_configured" }
  | { status: "not_found" }
  | { status: "not_requestable"; reason: string };

/** ProviderAcquisitionJobCreateResult reports queue creation or an honest persistence boundary failure. */
export type ProviderAcquisitionJobCreateResult =
  | { status: "created"; response: ProviderAcquisitionJobDetailResponse }
  | { status: "not_configured" };

/** ProviderAcquisitionJobReadResult reports whether one persisted acquisition job could be read. */
export type ProviderAcquisitionJobReadResult =
  | { status: "available"; response: ProviderAcquisitionJobDetailResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ReviewActionResult reports review persistence or explicit target failure. */
export type ReviewActionResult =
  | { status: "created"; records: PartSearchRecord[]; response: ReviewActionResponse }
  | { status: "not_configured" }
  | { status: "not_found"; reason: string };

/** AssetPromotionResult reports explicit export-verification promotion status. */
export type AssetPromotionResult =
  | { status: "promoted"; records: PartSearchRecord[]; response: AssetPromotionResponse }
  | { status: "not_configured" }
  | { status: "not_found"; reason: string }
  | { status: "not_promotable"; reason: string };

/** IssueWorkflowUpdateResult reports part-issue workflow persistence state. */
export type IssueWorkflowUpdateResult =
  | { status: "updated"; records: PartSearchRecord[]; response: PartIssueWorkflowUpdateResponse }
  | { status: "not_configured" }
  | { status: "not_found"; reason: string };

/** SourceReconciliationUpdateResult reports source-conflict reconciliation persistence state. */
export type SourceReconciliationUpdateResult =
  | { status: "updated"; records: PartSearchRecord[]; response: SourceReconciliationUpdateResponse }
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
  description: string;
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
  preview_artifact_storage_key: string | null;
  preview_artifact_format: Asset["previewArtifactFormat"];
  preview_artifact_generated_at: Date | string | null;
  preview_artifact_source: Asset["previewArtifactSource"];
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
  compatibility_status: MateRelation["compatibilityStatus"] | null;
  evidence_kind: MateRelation["evidenceKind"] | null;
  confidence_score: string;
  source_revision_id: string;
  source_record_id: string | null;
  notes: string | null;
}

/** DatabaseAccessoryRow is the accessory/tooling relationship shape read from Postgres. */
interface DatabaseAccessoryRow {
  /** AccessoryRequirement fields from accessory_requirements. */
  id: string;
  part_id: string;
  accessory_part_id: string;
  relationship_type: AccessoryRequirement["relationshipType"];
  compatibility_status: AccessoryRequirement["compatibilityStatus"] | null;
  evidence_kind: AccessoryRequirement["evidenceKind"] | null;
  confidence_score: string;
  source_revision_id: string;
  source_record_id: string | null;
  notes: string | null;
}

/** DatabaseCableRow is the cable compatibility relationship shape read from Postgres. */
interface DatabaseCableRow {
  /** CableCompatibility fields from cable_compatibilities. */
  id: string;
  part_id: string;
  cable_part_id: string;
  relationship_type: CableCompatibility["relationshipType"];
  wire_gauge_min: number | null;
  wire_gauge_max: number | null;
  shielding_requirement: CableCompatibility["shieldingRequirement"] | null;
  termination_style: CableCompatibility["terminationStyle"] | null;
  compatibility_status: CableCompatibility["compatibilityStatus"] | null;
  confidence_score: string;
  source_revision_id: string;
  source_record_id: string | null;
  notes: string | null;
}

/** DatabaseConnectorFamilyConflictRow is one persisted connector-family ambiguity row. */
interface DatabaseConnectorFamilyConflictRow {
  /** ConnectorFamilyConflict fields from connector_family_conflicts. */
  id: string;
  part_id: string;
  candidate_part_id: string;
  candidate_connector_family_id: string | null;
  conflict_type: ConnectorFamilyConflict["conflictType"];
  confidence_score: string;
  summary: string;
  detail: string;
  source_record_id: string | null;
  last_updated_at: Date | string;
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

/** DatabaseAssetValidationRow is the durable validation evidence shape read from Postgres. */
interface DatabaseAssetValidationRow {
  /** AssetValidationRecord fields from asset_validation_records. */
  id: string;
  part_id: string;
  asset_id: string;
  validation_status: AssetValidationRecord["validationStatus"];
  validation_type: AssetValidationRecord["validationType"];
  validation_notes: string | null;
  validated_at: Date | string;
  validator: string;
  last_updated_at: Date | string;
}

/** DatabaseAssetPromotionAuditRow is the promotion audit shape read from Postgres. */
interface DatabaseAssetPromotionAuditRow {
  /** AssetPromotionAuditRecord fields from asset_promotion_audits. */
  id: string;
  part_id: string;
  asset_id: string;
  prior_export_status: AssetPromotionAuditRecord["priorExportStatus"];
  new_export_status: AssetPromotionAuditRecord["newExportStatus"];
  promotion_outcome: AssetPromotionAuditRecord["promotionOutcome"];
  blocker_reasons: string[];
  validation_record_id: string | null;
  actor: string;
  created_at: Date | string;
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
  source_last_seen_at: Date | string;
  source_last_imported_at: Date | string | null;
  import_status: SourceImportStatus;
  import_error_details: string | null;
  last_updated_at: Date | string;
}

/** DatabaseProviderAcquisitionJobRow is one persisted provider acquisition job row. */
interface DatabaseProviderAcquisitionJobRow {
  id: string;
  provider_id: string;
  provider_part_key: string;
  requested_lookup: string;
  manufacturer_name: string | null;
  mpn: string | null;
  package_name: string | null;
  source_url: string | null;
  match_type: ProviderLookupMatchType;
  match_confidence: string;
  job_status: ProviderAcquisitionJobStatus;
  requested_by: string;
  org_id: string | null;
  requested_at: Date | string;
  part_id: string | null;
  import_outcome: ProviderImportOutcome | null;
  previous_import_status: SourceImportStatus | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  last_updated_at: Date | string;
}

/** DatabaseProviderAcquisitionJobEventRow is one persisted lifecycle event row for a provider acquisition job. */
interface DatabaseProviderAcquisitionJobEventRow {
  id: string;
  job_id: string;
  event_type: ProviderAcquisitionJobEvent["eventType"];
  message: string;
  detail: Record<string, unknown> | null;
  created_at: Date | string;
}

/** DatabaseProviderEnrichmentJobRow is one persisted provider enrichment job row. */
interface DatabaseProviderEnrichmentJobRow {
  id: string;
  part_id: string;
  source_acquisition_job_id: string;
  job_type: ProviderEnrichmentJobType;
  job_status: ProviderEnrichmentJobStatus;
  requested_by: string;
  requested_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  error_code: string | null;
  error_message: string | null;
  last_updated_at: Date | string;
}

/** DatabaseSourceExtractionSignalRow is the source extraction signal shape read from Postgres. */
interface DatabaseSourceExtractionSignalRow {
  /** SourceExtractionSignal fields from source_extraction_signals. */
  id: string;
  part_id: string;
  source_record_id: string | null;
  datasheet_revision_id: string | null;
  asset_id: string | null;
  signal_type: SourceExtractionSignal["signalType"];
  extraction_status: SourceExtractionSignal["extractionStatus"];
  confidence_score: string;
  extraction_source: SourceExtractionSignal["extractionSource"];
  notes: string | null;
  last_updated_at: Date | string;
}

/** SearchSqlFilter is the parameterized WHERE clause for one SQL-backed search read. */
export interface SearchSqlFilter {
  /** SQL WHERE clause assembled from present filters only. */
  whereSql: string;
  /** Parameter values matching the assembled WHERE clause placeholders. */
  params: unknown[];
  /**
   * Raw lowercased query text when a free-text search is active, or null when no query was
   * provided. Kept separate from params so it can be appended after WHERE params and before
   * LIMIT/OFFSET without disturbing the WHERE clause placeholder indices.
   */
  queryText: string | null;
  /**
   * True when the WHERE clause references the prs alias (part_readiness_summaries). When false
   * the count and IDs queries omit that LEFT JOIN entirely, halving join overhead on searches
   * that don't filter by readiness status, connector class, or approval status.
   */
  needsReadinessJoin: boolean;
  /** True when the WHERE clause references the pa alias (part_approvals). */
  needsApprovalJoin: boolean;
}

/** DatabaseSearchFacetManufacturerRow is one grouped manufacturer facet row. */
interface DatabaseSearchFacetManufacturerRow {
  id: string;
  name: string;
  aliases: string[] | null;
  website: string | null;
  facet_count: string;
}

/** DatabaseSearchFacetCategoryRow is one grouped category facet row. */
interface DatabaseSearchFacetCategoryRow {
  category: string;
  facet_count: string;
}

/** DatabaseSearchFacetPackageRow is one grouped package facet row. */
interface DatabaseSearchFacetPackageRow {
  id: string;
  package_name: string;
  pin_count: number;
  pitch_mm: string | null;
  body_length_mm: string | null;
  body_width_mm: string | null;
  body_height_mm: string | null;
  facet_count: string;
}

/** DatabaseSearchFacetLifecycleRow is one grouped lifecycle facet row. */
interface DatabaseSearchFacetLifecycleRow {
  lifecycle_status: "active" | "not_recommended" | "obsolete" | "unknown";
  facet_count: string;
}

/** DatabaseSearchFacetCountRow is a single numeric count as text for pg-safe aggregation. */
interface DatabaseSearchFacetCountRow {
  total_count: string;
}

/** DatabaseCadAvailableFacetRow counts distinct parts with verified file-backed CAD. */
interface DatabaseCadAvailableFacetRow {
  available_count: string;
}

/** DatabasePartReadinessRow is the part-level readiness projection row read from Postgres. */
interface DatabasePartReadinessRow {
  part_id: string;
  readiness_status: PartReadinessStatus;
  identity_status: PartSearchRecord["readinessSummary"]["identityStatus"];
  connector_class: ConnectorClass;
  blocker_count: number;
  blocker_summary: string[];
  recommended_actions: string[];
  detail: string;
  last_evaluated_at: Date | string;
}

/** DatabasePartApprovalRow is the part-level approval projection row read from Postgres. */
interface DatabasePartApprovalRow {
  part_id: string;
  approval_status: PartApprovalStatus;
  summary: string;
  detail: string;
  evidence: string[];
  decided_by: string | null;
  decided_at: Date | string | null;
  last_updated_at: Date | string;
}

/** DatabasePartIssueRow is one persisted part issue row. */
interface DatabasePartIssueRow {
  id: string;
  part_id: string;
  issue_code: PartIssue["code"];
  severity: PartIssue["severity"];
  status: PartIssue["status"];
  assigned_to: string | null;
  resolution_notes: string | null;
  resolved_at: Date | string | null;
  summary: string;
  detail: string;
  source: string;
  last_updated_at: Date | string;
}

/** DatabasePartDuplicateCandidateRow is one DB-backed duplicate-candidate row. */
interface DatabasePartDuplicateCandidateRow {
  id: string;
  part_id: string;
  duplicate_part_id: string;
  duplicate_part_mpn: string;
  duplicate_manufacturer_name: string;
  detection_source: string;
  confidence_score: string;
  summary: string;
  detail: string;
  last_updated_at: Date | string;
}

/** DatabaseSourceReconciliationRow is one persisted source-conflict reconciliation row. */
interface DatabaseSourceReconciliationRow {
  part_id: string;
  preferred_source_record_id: string | null;
  resolution_status: SourceReconciliationRecord["resolutionStatus"];
  notes: string | null;
  updated_by: string | null;
  updated_at: Date | string;
}

/** DatabasePartRiskFlagRow is one persisted part risk flag row. */
interface DatabasePartRiskFlagRow {
  id: string;
  part_id: string;
  risk_code: PartRiskFlag["code"];
  label: string;
  detail: string;
  tone: PartRiskFlag["tone"];
  last_updated_at: Date | string;
}

/** DatabaseSearchFacetReadinessRow is one grouped readiness facet row. */
interface DatabaseSearchFacetReadinessRow {
  readiness_status: PartReadinessStatus;
  facet_count: string;
}

/** DatabaseSearchFacetApprovalRow is one grouped approval facet row. */
interface DatabaseSearchFacetApprovalRow {
  approval_status: PartApprovalStatus;
  facet_count: string;
}

/** DatabaseSearchFacetConnectorClassRow is one grouped connector-class facet row. */
interface DatabaseSearchFacetConnectorClassRow {
  connector_class: ConnectorClass;
  facet_count: string;
}

/** pool is initialized lazily so tests and seed fallback do not require DATABASE_URL. */
let pool: Pool | null = null;

/** providerAcquisitionJobBeforeInsertHook lets focused tests simulate a concurrent insert between dedupe read and insert. */
let providerAcquisitionJobBeforeInsertHook: (() => Promise<void>) | null = null;

/**
 * Replaces the database pool for tests that use an in-memory Postgres adapter.
 */
export function setCatalogStorePoolForTests(databasePool: Pool | null): void {
  pool = databasePool;
}

/**
 * Replaces the provider acquisition pre-insert hook for tests that simulate concurrent active-job creation.
 */
export function setProviderAcquisitionJobBeforeInsertHookForTests(next: (() => Promise<void>) | null): void {
  providerAcquisitionJobBeforeInsertHook = next;
}

/**
 * Returns every canonical part record from Postgres, or an explicit not-configured status.
 */
export async function readCatalogRecordsFromDatabase(options: CatalogReadOptions = {}): Promise<CatalogReadResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  return { records: await readCatalogRecords(databasePool, null, options), status: "available" };
}

/**
 * Bounds the connector-intent candidate fetch. The resolver only ever keeps connector-class
 * parts and returns the top 8 by score, so this cap is effectively complete for real libraries
 * while preventing the route from loading the entire catalog (and its parts×parts duplicate
 * self-join) on every call.
 */
const CONNECTOR_INTENT_CANDIDATE_CAP = 2000;

/**
 * Returns the bounded record set the connector-set intent resolver needs, instead of the whole
 * catalog. `resolveConnectorSetIntent` discards every non-connector record and then dereferences
 * only the specific mate/accessory/cable target parts of its connector candidates via a
 * `partById` map. So this fetches exactly that closure and nothing more:
 *
 *   Phase 1 — all connector-class parts (the resolver's exact candidate universe; pushed down to
 *             SQL as the `connectorClass` filter, capped), with their full search summary
 *             (buildableMatingSet included).
 *   Phase 2 — the relation target parts referenced by those candidates that are not themselves
 *             connector-class, fetched by id as lightweight summaries.
 *
 * Output is behavior-identical to the old full-catalog load except that connector candidates
 * beyond {@link CONNECTOR_INTENT_CANDIDATE_CAP} are not considered.
 */
export async function readConnectorIntentRecordsFromDatabase(options: CatalogReadOptions = {}): Promise<CatalogReadResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const filters: PartSearchFilters = { connectorClass: "connector" };
    const searchFilter = withOrgScopedSearchFilter(buildSearchSqlFilter(filters, "any"));
    const sort = buildSearchPagination(0, filters).sort;
    const candidateIds = await readSearchPartIds(databasePool, searchFilter, sort, CONNECTOR_INTENT_CANDIDATE_CAP, 0, options);

    if (candidateIds.length === 0) {
      return { records: [], status: "available" };
    }

    const candidateRecords = await readPartSearchSummaryRecords(databasePool, candidateIds, options);
    const presentIds = new Set(candidateRecords.map((record) => record.part.id));
    const relatedIds = new Set<string>();

    for (const record of candidateRecords) {
      const mating = record.buildableMatingSet;

      for (const relation of [mating.bestMate, ...mating.alternateMates]) {
        if (relation) {
          relatedIds.add(relation.matePartId);
        }
      }
      for (const accessory of [...mating.requiredAccessories, ...mating.optionalAccessories, ...mating.toolingRequirements]) {
        relatedIds.add(accessory.accessoryPartId);
      }
      for (const cable of mating.cableOptions) {
        relatedIds.add(cable.cablePartId);
      }
    }

    const missingRelatedIds = [...relatedIds].filter((id) => !presentIds.has(id)).sort();
    const relatedRecords = await readPartSummaryRecords(databasePool, missingRelatedIds, options);

    return { records: [...candidateRecords, ...relatedRecords], status: "available" };
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/**
 * Adds the per-request tenant filter to a built search filter. Appended as the last WHERE param so it
 * never disturbs the existing placeholder indices (queryText / limit / offset are computed from
 * params.length downstream). A null tenant filters on `p.org_id = NULL` and so matches no rows,
 * keeping anonymous catalog reads fail-closed. Kept out of the pure buildSearchSqlFilter so its unit
 * tests stay deterministic.
 */
function withOrgScopedSearchFilter(filter: SearchSqlFilter): SearchSqlFilter {
  const params = [...filter.params, getRequestOrgId()];
  const orgClause = `p.org_id = $${params.length}`;
  return {
    ...filter,
    params,
    whereSql: filter.whereSql ? `${filter.whereSql}\n    AND ${orgClause}` : `WHERE ${orgClause}`
  };
}

/**
 * Returns SQL-filtered and paginated search summary records without loading the full catalog.
 */
export async function readPartSearchRecordsFromDatabase(filters: PartSearchFilters = {}, options: CatalogReadOptions = {}): Promise<CatalogSearchReadResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const cadAvailability = filters.cadAvailability ?? "any";
  const searchFilter = withOrgScopedSearchFilter(buildSearchSqlFilter(filters, cadAvailability));
  const totalCount = await readSearchResultCount(databasePool, searchFilter, options);
  const pagination = buildSearchPagination(totalCount, filters);
  const offset = (pagination.page - 1) * pagination.pageSize;
  const partIds = await readSearchPartIds(databasePool, searchFilter, pagination.sort, pagination.pageSize, offset, options);

  if (partIds.length === 0) {
    return {
      pagination,
      records: [],
      status: "available"
    };
  }

  return {
    pagination,
    records: await readPartSearchSummaryRecords(databasePool, partIds, options),
    status: "available"
  };
}

/**
 * Returns SQL-backed facets for the currently active search filters.
 */
export async function readPartSearchFacetsFromDatabase(filters: PartSearchFilters = {}, options: CatalogReadOptions = {}): Promise<CatalogSearchFacetsReadResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const cadAvailability = filters.cadAvailability ?? "any";
  const searchFilter = withOrgScopedSearchFilter(buildSearchSqlFilter(filters, cadAvailability));
  const facets = await readSearchFacets(databasePool, searchFilter, options);

  return {
    facets,
    status: "available"
  };
}

/**
 * Returns the requested part plus relationship targets from Postgres without loading the full catalog.
 */
export async function readPartDetailRecordsFromDatabase(partId: string, options: CatalogReadOptions = {}): Promise<CatalogReadResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const primaryRecords = await readCatalogRecords(databasePool, [partId], options);
  const primaryRecord = primaryRecords.find((record) => record.part.id === partId);

  if (!primaryRecord) {
    return { records: [], status: "available" };
  }

  const relatedIds = collectRelatedPartIds(primaryRecord);
  const relatedSummaryIds = Array.from(new Set(relatedIds)).filter((relatedId) => relatedId !== partId).sort();

  if (relatedSummaryIds.length === 0) {
    return { records: primaryRecords, status: "available" };
  }

  return { records: [...primaryRecords, ...(await readPartSummaryRecords(databasePool, relatedSummaryIds, options))], status: "available" };
}

/**
 * Reads detail-safe acquisition history for one part without broadening search or exposing raw requester ids.
 */
export async function readPartAcquisitionSummaryFromDatabase(partId: string, options: CatalogReadOptions = {}): Promise<PartAcquisitionSummary> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return buildUnavailablePartAcquisitionSummary("Acquisition history is unavailable because the catalog database is not configured.");
  }

  try {
    const latestJobRow = await readLatestPartAcquisitionJobRow(databasePool, partId, options);

    if (latestJobRow) {
      return mapPartAcquisitionSummaryFromJobRow(latestJobRow);
    }

    const latestSourceRow = await readLatestPartAcquisitionSourceRow(databasePool, partId, options);

    if (latestSourceRow) {
      return buildLegacySourceOnlyPartAcquisitionSummary(latestSourceRow);
    }

    return buildNotRecordedPartAcquisitionSummary();
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/**
 * Reads detail-safe enrichment history for one part without changing readiness, approval, or export truth.
 */
export async function readPartEnrichmentSummaryFromDatabase(partId: string, options: CatalogReadOptions = {}): Promise<PartEnrichmentSummary> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return buildUnavailablePartEnrichmentSummary("Enrichment history is unavailable because the catalog database is not configured.");
  }

  try {
    const jobRows = await readPartEnrichmentJobRows(databasePool, partId, options);

    if (jobRows.length === 0) {
      return buildNotRecordedPartEnrichmentSummary();
    }

    return buildPartEnrichmentSummaryFromJobRows(jobRows);
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/** AssetDownloadTargetResult describes what the download route should do for one asset. */
export type AssetDownloadTargetResult =
  | { status: "not_configured" }
  | { status: "not_found" }
  | { status: "not_accessible"; reason: string }
  | { status: "redirect"; url: string; assetType: Asset["assetType"]; fileFormat: Asset["fileFormat"] }
  | { status: "file_only"; storageKey: string; assetType: Asset["assetType"]; fileFormat: Asset["fileFormat"] };

/**
 * AssetPreviewArtifactDownloadTargetResult describes what the preview-artifact download
 * route should do for one asset. The preview artifact is a derived browser-renderable
 * file (e.g. glb/gltf converted from a STEP) and is intentionally separate from the
 * source asset download path so the source bytes' availability/trust contract is never
 * confused with the preview artifact's existence.
 */
export type AssetPreviewArtifactDownloadTargetResult =
  | { status: "not_configured" }
  | { status: "not_found" }
  | { status: "not_available"; reason: string }
  | {
      status: "file_only";
      storageKey: string;
      assetType: Asset["assetType"];
      fileFormat: Asset["fileFormat"];
      previewArtifactFormat: NonNullable<Asset["previewArtifactFormat"]>;
    };

/** DatabaseAssetDownloadRow is the minimal shape needed to resolve one asset download target. */
interface DatabaseAssetDownloadRow {
  id: string;
  part_id: string;
  asset_type: Asset["assetType"];
  file_format: Asset["fileFormat"];
  availability_status: Asset["availabilityStatus"];
  source_url: string | null;
  storage_key: string | null;
}

/** DatabaseAssetPreviewArtifactDownloadRow is the minimal shape needed to resolve one preview-artifact download target. */
interface DatabaseAssetPreviewArtifactDownloadRow {
  id: string;
  part_id: string;
  asset_type: Asset["assetType"];
  file_format: Asset["fileFormat"];
  preview_status: Asset["previewStatus"];
  preview_artifact_storage_key: string | null;
  preview_artifact_format: Asset["previewArtifactFormat"];
}

/**
 * Reads the minimum asset fields needed to resolve a download redirect or file-serve path.
 */
export async function readAssetDownloadTargetFromDatabase(partId: string, assetId: string): Promise<AssetDownloadTargetResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const result = await databasePool.query<DatabaseAssetDownloadRow>(
      `
        SELECT id, part_id, asset_type, file_format, availability_status, source_url, storage_key
        FROM assets
        WHERE id = $1 AND part_id = $2
          AND EXISTS (SELECT 1 FROM parts p WHERE p.id = assets.part_id AND p.org_id = $3)
        LIMIT 1
      `,
      [assetId, partId, getRequestOrgId()]
    );

    const row = result.rows[0];

    if (!row) {
      return { status: "not_found" };
    }

    if (row.availability_status === "missing") {
      return { status: "not_accessible", reason: "This asset has no file or URL recorded." };
    }

    if (row.availability_status === "failed") {
      return { status: "not_accessible", reason: "This asset's last download or validation attempt failed." };
    }

    if (row.storage_key) {
      return { status: "file_only", storageKey: row.storage_key, assetType: row.asset_type, fileFormat: row.file_format };
    }

    if (row.source_url) {
      return { status: "redirect", url: row.source_url, assetType: row.asset_type, fileFormat: row.file_format };
    }

    return { status: "not_accessible", reason: "This asset has no accessible URL or stored file." };
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/**
 * Reads the minimum asset preview-artifact fields needed to resolve a derived-preview file path.
 *
 * Honesty rules enforced here:
 *  - Returns `not_found` only when the asset row itself does not exist.
 *  - Returns `not_available` for every other "no derived preview to serve" case (status not
 *    ready, missing storage key, or missing format) with a human-readable reason. This keeps
 *    the API contract honest: a 404 means the asset is unknown, while 409 means the asset is
 *    real but no derived preview artifact has been written yet.
 *  - Never reads `source_url` or the source `storage_key`: the preview-artifact download
 *    must never accidentally serve unconverted source bytes.
 */
export async function readAssetPreviewArtifactDownloadTargetFromDatabase(
  partId: string,
  assetId: string
): Promise<AssetPreviewArtifactDownloadTargetResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const result = await databasePool.query<DatabaseAssetPreviewArtifactDownloadRow>(
      `
        SELECT id, part_id, asset_type, file_format, preview_status,
               preview_artifact_storage_key, preview_artifact_format
        FROM assets
        WHERE id = $1 AND part_id = $2
          AND EXISTS (SELECT 1 FROM parts p WHERE p.id = assets.part_id AND p.org_id = $3)
        LIMIT 1
      `,
      [assetId, partId, getRequestOrgId()]
    );

    const row = result.rows[0];

    if (!row) {
      return { status: "not_found" };
    }

    if (row.preview_status !== "ready") {
      return {
        status: "not_available",
        reason: "No derived preview artifact has been generated for this asset yet."
      };
    }

    if (!row.preview_artifact_storage_key) {
      return {
        status: "not_available",
        reason: "Preview status is ready but no derived preview artifact storage key is recorded."
      };
    }

    if (!row.preview_artifact_format) {
      return {
        status: "not_available",
        reason: "Preview status is ready but no derived preview artifact format is recorded."
      };
    }

    return {
      status: "file_only",
      storageKey: row.preview_artifact_storage_key,
      assetType: row.asset_type,
      fileFormat: row.file_format,
      previewArtifactFormat: row.preview_artifact_format
    };
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/**
 * Creates or reuses one active provider acquisition job without broadening normal catalog search.
 */
export async function createProviderAcquisitionJobInDatabase(
  input: ProviderAcquisitionJobCreateInput,
  requestedBy = "local-dev-admin",
  requestedAt = new Date().toISOString()
): Promise<ProviderAcquisitionJobCreateResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");

    const existingJobId = await findActiveProviderAcquisitionJobId(client, input.providerId, input.providerPartKey);

    if (existingJobId) {
      const existingJobDetail = await readProviderAcquisitionJobDetail(databasePool, existingJobId);
      await client.query("COMMIT");

      if (!existingJobDetail) {
        throw new Error("Active provider acquisition job disappeared before it could be read.");
      }

      return {
        response: existingJobDetail,
        status: "created"
      };
    }

    const createdJob = buildProviderAcquisitionJobRecord(input, requestedBy, requestedAt);
    const createdEvent = buildProviderAcquisitionJobEventRecord(createdJob.id, "queued", "Acquisition job queued.", requestedAt, {
      providerId: input.providerId,
      providerPartKey: input.providerPartKey,
      requestedLookup: input.requestedLookup
    });

    if (providerAcquisitionJobBeforeInsertHook) {
      await providerAcquisitionJobBeforeInsertHook();
    }

    await persistProviderAcquisitionJobRow(client, createdJob);
    await persistProviderAcquisitionJobEventRow(client, createdEvent);
    await client.query("COMMIT");

    return {
      response: {
        events: [createdEvent],
        job: createdJob
      },
      status: "created"
    };
  } catch (error) {
    await client.query("ROLLBACK");

    if (isUniqueViolationError(error)) {
      const existingJobDetail = await readActiveProviderAcquisitionJobDetailByProviderKey(
        databasePool,
        input.providerId,
        input.providerPartKey
      );

      if (existingJobDetail) {
        return {
          response: existingJobDetail,
          status: "created"
        };
      }
    }

    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }
}

/**
 * Reads one provider acquisition job plus its coarse lifecycle events.
 */
export async function readProviderAcquisitionJobInDatabase(jobId: string): Promise<ProviderAcquisitionJobReadResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const response = await readProviderAcquisitionJobDetail(databasePool, jobId);

  return response ? { response, status: "available" } : { status: "not_found" };
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
          output_asset_id,
          org_id
        )
        VALUES ($1, $2, $3, $4, $5, 'requested', $6, NULL, $7)
        ON CONFLICT (id) DO UPDATE SET
          source_datasheet_revision_id = EXCLUDED.source_datasheet_revision_id,
          source_asset_id = EXCLUDED.source_asset_id,
          generation_status = 'requested',
          confidence_score = EXCLUDED.confidence_score
      `,
      [workflowId, partId, targetAssetType, generationOption.sourceDatasheetRevisionId, generationOption.sourceAssetId, generationOption.confidenceScore, requireRequestOrgId()]
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
          last_updated_at,
          org_id
        )
        VALUES ($1, $2, $3, $4, $5, 'requested', $6, $7, $8, $6, $9)
        ON CONFLICT (id) DO UPDATE SET
          request_status = generation_requests.request_status,
          last_updated_at = generation_requests.last_updated_at
      `,
      [requestId, partId, targetAssetType, generationOption.sourceDatasheetRevisionId, generationOption.sourceAssetId, requestedAt, requestedBy, workflowId, requireRequestOrgId()]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }

  await refreshPartProjectionInDatabase(databasePool, partId);

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
          last_updated_at,
          org_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          outcome = EXCLUDED.outcome,
          reviewer = EXCLUDED.reviewer,
          notes = EXCLUDED.notes,
          reviewed_at = EXCLUDED.reviewed_at,
          last_updated_at = EXCLUDED.last_updated_at
      `,
      [reviewRecord.id, reviewRecord.partId, reviewRecord.targetType, reviewRecord.assetId, reviewRecord.generationWorkflowId, reviewRecord.outcome, reviewRecord.reviewer, reviewRecord.notes, reviewRecord.reviewedAt, requireRequestOrgId()]
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

      const linkedRequestStatus = linkedRequestStatusForWorkflow(updatedWorkflow.generationStatus);

      if (linkedRequestStatus) {
        await client.query(
          `
            UPDATE generation_requests
            SET request_status = $2,
                last_updated_at = $4
            WHERE workflow_id = $1 AND part_id = $3
          `,
          [updatedWorkflow.id, linkedRequestStatus, partId, reviewedAt]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }

  await refreshPartProjectionInDatabase(databasePool, partId);

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
 * Promotes an approved file-backed CAD asset to verified_for_export through an explicit action.
 */
export async function promoteAssetForExportInDatabase(partId: string, assetId: string, promotedAt = new Date().toISOString()): Promise<AssetPromotionResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const primaryRecords = await readCatalogRecords(databasePool, [partId]);
  const primaryRecord = primaryRecords.find((record) => record.part.id === partId);

  if (!primaryRecord) {
    return { reason: "Part not found.", status: "not_found" };
  }

  const targetAsset = primaryRecord.assets.find((asset) => asset.id === assetId) ?? null;

  if (!targetAsset) {
    return { reason: "Asset promotion target not found for this part.", status: "not_found" };
  }

  const blockers = getAssetPromotionBlockers(targetAsset, primaryRecord.validationRecords);
  const deniedAudit = buildPromotionAuditRecord(partId, targetAsset, targetAsset.exportStatus, "denied", blockers, null, promotedAt);

  if (blockers.length > 0) {
    await persistPromotionAuditInDatabase(databasePool, deniedAudit);
    await refreshPartProjectionInDatabase(databasePool, partId);
    return { reason: blockers.join(" "), status: "not_promotable" };
  }

  const updatedAsset = { ...promoteAssetToVerifiedForExport(targetAsset, primaryRecord.validationRecords), lastUpdatedAt: promotedAt };
  const validationRecord = getQualifyingValidationForAsset(targetAsset, primaryRecord.validationRecords);
  const promotionAudit = buildPromotionAuditRecord(partId, targetAsset, updatedAsset.exportStatus, "promoted", [], validationRecord?.id ?? null, promotedAt);
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    await persistPromotionAuditRows(client, promotionAudit);
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
      [updatedAsset.id, updatedAsset.assetState, updatedAsset.assetStatus, updatedAsset.availabilityStatus, updatedAsset.reviewStatus, updatedAsset.exportStatus, updatedAsset.validationStatus, promotedAt, partId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }

  await refreshPartProjectionInDatabase(databasePool, partId);

  const detailResult = await readPartDetailRecordsFromDatabase(partId);

  if (detailResult.status !== "available") {
    return { status: "not_configured" };
  }

  const refreshedRecord = detailResult.records.find((record) => record.part.id === partId);
  const refreshedAsset = refreshedRecord?.assets.find((asset) => asset.id === updatedAsset.id) ?? updatedAsset;
  const refreshedAudit = refreshedRecord?.promotionAudits.find((audit) => audit.id === promotionAudit.id) ?? promotionAudit;

  return {
    records: detailResult.records,
    response: {
      promotionAudit: refreshedAudit,
      updatedAsset: refreshedAsset
    },
    status: "promoted"
  };
}

/**
 * Updates operator workflow state for one persisted part issue without changing derived evidence.
 */
export async function updatePartIssueWorkflowInDatabase(
  partId: string,
  issueCode: PartIssueCode,
  input: PartIssueWorkflowUpdateInput,
  updatedAt = new Date().toISOString()
): Promise<IssueWorkflowUpdateResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  await refreshPartProjectionInDatabase(databasePool, partId);

  const detailResult = await readPartDetailRecordsFromDatabase(partId);

  if (detailResult.status !== "available") {
    return { status: "not_configured" };
  }

  const primaryRecord = detailResult.records.find((record) => record.part.id === partId);
  const currentIssue = primaryRecord?.issues.find((issue) => issue.code === issueCode) ?? null;

  if (!primaryRecord || !currentIssue) {
    return { reason: "Part issue not found for this part.", status: "not_found" };
  }

  const assignedTo = input.assignedTo === undefined ? currentIssue.assignedTo : normalizeOptionalText(input.assignedTo);
  const resolutionNotes = input.resolutionNotes === undefined ? currentIssue.resolutionNotes : normalizeOptionalText(input.resolutionNotes);
  const resolvedAt = input.status === "resolved" || input.status === "ignored" ? updatedAt : null;
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    const updateResult = await client.query(
      `
        UPDATE part_issues
        SET
          status = $1,
          assigned_to = $2,
          resolution_notes = $3,
          resolved_at = $4
        WHERE part_id = $5 AND issue_code = $6
      `,
      [input.status, assignedTo, resolutionNotes, resolvedAt, partId, issueCode]
    );

    if (updateResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return { reason: "Part issue not found for this part.", status: "not_found" };
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }

  const refreshedRecords = await readCatalogRecords(databasePool, [partId]);
  const refreshedRecord = refreshedRecords.find((record) => record.part.id === partId);
  const refreshedIssue = refreshedRecord?.issues.find((issue) => issue.code === issueCode);

  if (!refreshedRecord || !refreshedIssue) {
    return { reason: "Part issue not found after workflow update.", status: "not_found" };
  }

  return {
    records: refreshedRecords,
    response: { issue: refreshedIssue },
    status: "updated"
  };
}

/**
 * Updates source-conflict reconciliation state and then refreshes the derived part projection.
 */
export async function updateSourceReconciliationInDatabase(
  partId: string,
  input: SourceReconciliationUpdateInput,
  updatedBy = "local-dev-admin",
  updatedAt = new Date().toISOString()
): Promise<SourceReconciliationUpdateResult> {
  const databasePool = getDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const detailResult = await readPartDetailRecordsFromDatabase(partId);

  if (detailResult.status !== "available") {
    return { status: "not_configured" };
  }

  const primaryRecord = detailResult.records.find((record) => record.part.id === partId);

  if (!primaryRecord) {
    return { reason: "Part not found.", status: "not_found" };
  }

  const currentReconciliation = primaryRecord.sourceReconciliation;
  const preferredSourceRecordId =
    input.preferredSourceRecordId === undefined ? currentReconciliation?.preferredSourceRecordId ?? null : normalizeOptionalText(input.preferredSourceRecordId);
  const notes = input.notes === undefined ? currentReconciliation?.notes ?? null : normalizeOptionalText(input.notes);

  if (preferredSourceRecordId && !primaryRecord.sources.some((source) => source.id === preferredSourceRecordId)) {
    return { reason: "Preferred source record was not found on this part.", status: "not_found" };
  }

  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO part_source_reconciliations (
          part_id,
          preferred_source_record_id,
          resolution_status,
          notes,
          updated_by,
          updated_at,
          org_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (part_id) DO UPDATE SET
          preferred_source_record_id = EXCLUDED.preferred_source_record_id,
          resolution_status = EXCLUDED.resolution_status,
          notes = EXCLUDED.notes,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at
      `,
      [partId, preferredSourceRecordId, input.resolutionStatus, notes, updatedBy, updatedAt, requireRequestOrgId()]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }

  await refreshPartProjectionInDatabase(databasePool, partId);

  const refreshedRecords = await readCatalogRecords(databasePool, [partId]);
  const refreshedRecord = refreshedRecords.find((record) => record.part.id === partId);

  if (!refreshedRecord?.sourceReconciliation) {
    return { reason: "Source reconciliation was not found after update.", status: "not_found" };
  }

  return {
    records: refreshedRecords,
    response: { reconciliation: refreshedRecord.sourceReconciliation },
    status: "updated"
  };
}

/**
 * Reads joined catalog records from Postgres with an optional part-id scope.
 */
async function readCatalogRecords(databasePool: Pool, partIds: string[] | null, options: CatalogReadOptions = {}): Promise<PartSearchRecord[]> {
  try {
    const params = [partIds];
    // The parts query is org-scoped (PART_ROWS_SQL filters p.org_id = $2). The child queries below
    // load by part_id and are joined to parts in JS, so non-org rows are discarded during assembly —
    // scoping the parts query alone keeps the output tenant-correct.
    const partParams = [partIds, getRequestOrgId()];
    const [
      partRows,
      metricRows,
      assetRows,
      datasheetRows,
      sourceRows,
      extractionSignalRows,
      mateRows,
      accessoryRows,
      cableRows,
      connectorFamilyConflictRows,
      similarRows,
      companionRows,
      workflowRows,
      requestRows,
      reviewRows,
      validationRows,
      promotionAuditRows,
      readinessRows,
      approvalRows,
      issueRows,
      duplicateCandidateRows,
      sourceReconciliationRows,
      riskFlagRows
    ] = await Promise.all([
      timedCatalogQuery<DatabasePartRow>(databasePool, "parts", PART_ROWS_SQL, partParams, options),
      timedCatalogQuery<DatabaseMetricRow>(databasePool, "metrics", METRIC_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseAssetRow>(databasePool, "assets", ASSET_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseDatasheetRow>(databasePool, "datasheets", DATASHEET_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseSourceRow>(databasePool, "sources", SOURCE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseSourceExtractionSignalRow>(databasePool, "source_extraction_signals", SOURCE_EXTRACTION_SIGNAL_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseMateRow>(databasePool, "mate_relations", MATE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseAccessoryRow>(databasePool, "accessory_requirements", ACCESSORY_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseCableRow>(databasePool, "cable_compatibilities", CABLE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseConnectorFamilyConflictRow>(databasePool, "connector_family_conflicts", CONNECTOR_FAMILY_CONFLICT_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseSimilarPartRow>(databasePool, "similar_part_relations", SIMILAR_PART_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseCompanionRow>(databasePool, "companion_recommendations", COMPANION_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseGenerationWorkflowRow>(databasePool, "generation_workflows", GENERATION_WORKFLOW_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseGenerationRequestRow>(databasePool, "generation_requests", GENERATION_REQUEST_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseReviewRow>(databasePool, "review_records", REVIEW_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseAssetValidationRow>(databasePool, "asset_validation_records", ASSET_VALIDATION_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseAssetPromotionAuditRow>(databasePool, "asset_promotion_audits", ASSET_PROMOTION_AUDIT_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartReadinessRow>(databasePool, "part_readiness_summaries", PART_READINESS_SUMMARY_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartApprovalRow>(databasePool, "part_approvals", PART_APPROVAL_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartIssueRow>(databasePool, "part_issues", PART_ISSUE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartDuplicateCandidateRow>(databasePool, "part_duplicate_candidates", PART_DUPLICATE_CANDIDATE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseSourceReconciliationRow>(databasePool, "part_source_reconciliations", SOURCE_RECONCILIATION_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartRiskFlagRow>(databasePool, "part_risk_flags", PART_RISK_FLAG_ROWS_SQL, params, options)
    ]);

    const built = buildPartRecords(
      partRows.rows,
      metricRows.rows,
      assetRows.rows,
      datasheetRows.rows,
      sourceRows.rows,
      extractionSignalRows.rows,
      mateRows.rows,
      accessoryRows.rows,
      cableRows.rows,
      connectorFamilyConflictRows.rows,
      similarRows.rows,
      companionRows.rows,
      workflowRows.rows,
      requestRows.rows,
      reviewRows.rows,
      validationRows.rows,
      promotionAuditRows.rows,
      readinessRows.rows,
      approvalRows.rows,
      issueRows.rows,
      duplicateCandidateRows.rows,
      sourceReconciliationRows.rows,
      riskFlagRows.rows
    );

    return attachEngineeringMemoryWarnings(databasePool, built, options);
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/** Bounds the per-part scan-time memory preview so search rows and detail banners stay compact. */
const ENGINEERING_MEMORY_WARNING_PREVIEW_LIMIT = 3;

/**
 * Attaches the read-only "this part bit us / is blocked" projection to built part records.
 *
 * This is the decision-point push: the same confirmed engineering memory the project overlap
 * panel surfaces, now attached wherever a part is chosen (catalog search rows, part detail).
 * It is a soft reuse signal — best-effort by design: if `part_engineering_records` is absent or
 * the query fails, records come back with `engineeringMemoryWarning: null` rather than breaking
 * catalog search or part detail. It never changes readiness, approval, validation, or export.
 */
async function attachEngineeringMemoryWarnings(
  databasePool: Pool,
  records: PartSearchRecord[],
  options: CatalogReadOptions
): Promise<PartSearchRecord[]> {
  if (records.length === 0) {
    return records;
  }

  const partIds = records.map((record) => record.part.id);

  try {
    const result = await timedCatalogQuery<{
      part_id: string;
      record_id: string;
      record_kind: string;
      severity: string;
      outcome: string | null;
      title: string;
    }>(databasePool, "engineering_memory_warnings", ENGINEERING_MEMORY_WARNING_ROWS_SQL, [partIds], options);

    const byPart = new Map<string, PartEngineeringMemoryWarningSummary>();

    for (const row of result.rows) {
      const summary = byPart.get(row.part_id) ?? { blockingCount: 0, preview: [], warningCount: 0 };
      summary.warningCount += 1;

      if (row.severity === "blocking") {
        summary.blockingCount += 1;
      }

      if (summary.preview.length < ENGINEERING_MEMORY_WARNING_PREVIEW_LIMIT) {
        summary.preview.push({
          outcome: (row.outcome as PartEngineeringRecordOutcome | null) ?? null,
          recordId: row.record_id,
          recordKind: row.record_kind as PartEngineeringRecordKind,
          severity: row.severity as PartEngineeringRecordSeverity,
          title: row.title
        } satisfies PartEngineeringMemoryWarningPreview);
      }

      byPart.set(row.part_id, summary);
    }

    return records.map((record) => ({ ...record, engineeringMemoryWarning: byPart.get(record.part.id) ?? null }));
  } catch {
    return records.map((record) => ({ ...record, engineeringMemoryWarning: null }));
  }
}

/**
 * Reads only identity rows for related parts used by the detail response summary list.
 */
async function readPartSummaryRecords(databasePool: Pool, partIds: string[], options: CatalogReadOptions): Promise<PartSearchRecord[]> {
  if (partIds.length === 0) {
    return [];
  }

  try {
    const partRows = await timedCatalogQuery<DatabasePartRow>(databasePool, "related_part_summaries", PART_ROWS_SQL, [partIds, getRequestOrgId()], options);

    return buildPartRecords(partRows.rows, [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []);
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/**
 * Reads only the summary tables needed by search result rows for already-filtered part ids.
 */
async function readPartSearchSummaryRecords(databasePool: Pool, partIds: string[], options: CatalogReadOptions): Promise<PartSearchRecord[]> {
  if (partIds.length === 0) {
    return [];
  }

  try {
    const params = [partIds];
    // Org-scope only the parts query (PART_ROWS_SQL filters p.org_id = $2); the child-table queries
    // load by part_id and are joined to parts in JS, so non-org rows never surface in the output.
    const partParams = [partIds, getRequestOrgId()];
    const [
      partRows,
      assetRows,
      datasheetRows,
      sourceRows,
      extractionSignalRows,
      mateRows,
      accessoryRows,
      cableRows,
      connectorFamilyConflictRows,
      workflowRows,
      requestRows,
      readinessRows,
      approvalRows,
      issueRows,
      duplicateCandidateRows,
      sourceReconciliationRows,
      riskFlagRows
    ] = await Promise.all([
      timedCatalogQuery<DatabasePartRow>(databasePool, "search_parts", PART_ROWS_SQL, partParams, options),
      timedCatalogQuery<DatabaseAssetRow>(databasePool, "search_assets", ASSET_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseDatasheetRow>(databasePool, "search_datasheets", DATASHEET_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseSourceRow>(databasePool, "search_sources", SOURCE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseSourceExtractionSignalRow>(databasePool, "search_source_extraction_signals", SOURCE_EXTRACTION_SIGNAL_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseMateRow>(databasePool, "search_mate_relations", MATE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseAccessoryRow>(databasePool, "search_accessory_requirements", ACCESSORY_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseCableRow>(databasePool, "search_cable_compatibilities", CABLE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseConnectorFamilyConflictRow>(databasePool, "search_connector_family_conflicts", CONNECTOR_FAMILY_CONFLICT_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseGenerationWorkflowRow>(databasePool, "search_generation_workflows", GENERATION_WORKFLOW_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseGenerationRequestRow>(databasePool, "search_generation_requests", GENERATION_REQUEST_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartReadinessRow>(databasePool, "search_part_readiness_summaries", PART_READINESS_SUMMARY_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartApprovalRow>(databasePool, "search_part_approvals", PART_APPROVAL_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartIssueRow>(databasePool, "search_part_issues", PART_ISSUE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartDuplicateCandidateRow>(databasePool, "search_part_duplicate_candidates", PART_DUPLICATE_CANDIDATE_ROWS_SQL, params, options),
      timedCatalogQuery<DatabaseSourceReconciliationRow>(databasePool, "search_part_source_reconciliations", SOURCE_RECONCILIATION_ROWS_SQL, params, options),
      timedCatalogQuery<DatabasePartRiskFlagRow>(databasePool, "search_part_risk_flags", PART_RISK_FLAG_ROWS_SQL, params, options)
    ]);
    const records = buildPartRecords(
      partRows.rows,
      [],
      assetRows.rows,
      datasheetRows.rows,
      sourceRows.rows,
      extractionSignalRows.rows,
      mateRows.rows,
      accessoryRows.rows,
      cableRows.rows,
      connectorFamilyConflictRows.rows,
      [],
      [],
      workflowRows.rows,
      requestRows.rows,
      [],
      [],
      [],
      readinessRows.rows,
      approvalRows.rows,
      issueRows.rows,
      duplicateCandidateRows.rows,
      sourceReconciliationRows.rows,
      riskFlagRows.rows
    );
    const recordById = new Map(records.map((record) => [record.part.id, record]));
    const orderedRecords = partIds.map((partId) => recordById.get(partId)).filter((record): record is PartSearchRecord => Boolean(record));

    return attachEngineeringMemoryWarnings(databasePool, orderedRecords, options);
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/**
 * Reads the latest acquisition job relevant to one part, including source-record matches when direct part linkage is absent.
 */
async function readLatestPartAcquisitionJobRow(
  databasePool: Pool,
  partId: string,
  options: CatalogReadOptions
): Promise<DatabaseProviderAcquisitionJobRow | null> {
  const directResult = await timedCatalogQuery<DatabaseProviderAcquisitionJobRow>(
    databasePool,
    "part_acquisition_jobs_direct",
    `
      SELECT
        paj.id,
        paj.provider_id,
        paj.provider_part_key,
        paj.requested_lookup,
        paj.manufacturer_name,
        paj.mpn,
        paj.package_name,
        paj.source_url,
        paj.match_type,
        paj.match_confidence,
        paj.job_status,
        paj.requested_by,
        paj.org_id,
        paj.requested_at,
        paj.part_id,
        paj.import_outcome,
        paj.previous_import_status,
        paj.error_code,
        paj.error_message,
        paj.started_at,
        paj.completed_at,
        paj.last_updated_at
      FROM provider_acquisition_jobs paj
      WHERE paj.part_id = $1
      ORDER BY COALESCE(paj.completed_at, paj.started_at, paj.requested_at, paj.last_updated_at) DESC, paj.requested_at DESC, paj.id DESC
      LIMIT 1
    `,
    [partId],
    options
  );

  if (directResult.rows[0]) {
    return directResult.rows[0];
  }

  const fallbackResult = await timedCatalogQuery<DatabaseProviderAcquisitionJobRow>(
    databasePool,
    "part_acquisition_jobs_source_fallback",
    `
      SELECT
        paj.id,
        paj.provider_id,
        paj.provider_part_key,
        paj.requested_lookup,
        paj.manufacturer_name,
        paj.mpn,
        paj.package_name,
        paj.source_url,
        paj.match_type,
        paj.match_confidence,
        paj.job_status,
        paj.requested_by,
        paj.org_id,
        paj.requested_at,
        paj.part_id,
        paj.import_outcome,
        paj.previous_import_status,
        paj.error_code,
        paj.error_message,
        paj.started_at,
        paj.completed_at,
        paj.last_updated_at
      FROM provider_acquisition_jobs paj
      INNER JOIN source_records sr
        ON sr.part_id = $1
        AND sr.provider_id = paj.provider_id
        AND sr.provider_part_key = paj.provider_part_key
      WHERE paj.part_id IS NULL
      ORDER BY COALESCE(paj.completed_at, paj.started_at, paj.requested_at, paj.last_updated_at) DESC, paj.requested_at DESC, paj.id DESC
      LIMIT 1
    `,
    [partId],
    options
  );

  return fallbackResult.rows[0] ?? null;
}

/**
 * Reads the latest attached provider source row when no acquisition job history is available for the part.
 */
async function readLatestPartAcquisitionSourceRow(
  databasePool: Pool,
  partId: string,
  options: CatalogReadOptions
): Promise<DatabaseSourceRow | null> {
  const result = await timedCatalogQuery<DatabaseSourceRow>(
    databasePool,
    "part_acquisition_sources",
    `
      SELECT
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
      FROM source_records
      WHERE part_id = $1
      ORDER BY CASE import_status WHEN 'imported' THEN 0 ELSE 1 END ASC,
        COALESCE(source_last_imported_at, normalized_at, fetched_at, last_updated_at) DESC,
        last_updated_at DESC,
        id DESC
      LIMIT 1
    `,
    [partId],
    options
  );

  return result.rows[0] ?? null;
}

/**
 * Reads provider enrichment jobs for one part in newest-first order.
 */
async function readPartEnrichmentJobRows(
  databasePool: Pool,
  partId: string,
  options: CatalogReadOptions
): Promise<DatabaseProviderEnrichmentJobRow[]> {
  const result = await timedCatalogQuery<DatabaseProviderEnrichmentJobRow>(
    databasePool,
    "part_enrichment_jobs",
    `
      SELECT
        id,
        part_id,
        source_acquisition_job_id,
        job_type,
        job_status,
        requested_by,
        requested_at,
        started_at,
        completed_at,
        error_code,
        error_message,
        last_updated_at
      FROM provider_enrichment_jobs
      WHERE part_id = $1
      ORDER BY COALESCE(completed_at, started_at, requested_at, last_updated_at) DESC, requested_at DESC, id DESC
    `,
    [partId],
    options
  );

  return result.rows;
}

/**
 * Counts matching parts using the same SQL predicate as the paged search id query.
 */
async function readSearchResultCount(databasePool: Pool, searchFilter: SearchSqlFilter, options: CatalogReadOptions): Promise<number> {
  try {
    const result = await timedCatalogQuery<{ total_count: string }>(databasePool, "search_count", buildSearchCountSql(searchFilter), searchFilter.params, options);

    return Number(result.rows[0]?.total_count ?? 0);
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/**
 * Reads only matching part identifiers for the current page and stable sort mode.
 * When queryText is present it is appended between the WHERE params and the LIMIT/OFFSET
 * values to match the parameter indices emitted by buildSearchPartIdsSql.
 */
async function readSearchPartIds(databasePool: Pool, searchFilter: SearchSqlFilter, sort: PartSearchSort, pageSize: number, offset: number, options: CatalogReadOptions): Promise<string[]> {
  try {
    const paginationParams = searchFilter.queryText !== null
      ? [...searchFilter.params, searchFilter.queryText, pageSize, offset]
      : [...searchFilter.params, pageSize, offset];

    const result = await timedCatalogQuery<{ id: string }>(databasePool, "search_part_ids", buildSearchPartIdsSql(searchFilter, sort), paginationParams, options);

    return result.rows.map((row) => row.id);
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/**
 * Reads grouped facet dimensions from SQL so filters stay consistent with DB-backed search.
 */
async function readSearchFacets(databasePool: Pool, searchFilter: SearchSqlFilter, options: CatalogReadOptions): Promise<SearchFacets> {
  try {
    const [manufacturerRows, categoryRows, packageRows, lifecycleRows, readinessRows, approvalRows, connectorClassRows, totalRowResult, cadAvailableResult] = await Promise.all([
      timedCatalogQuery<DatabaseSearchFacetManufacturerRow>(databasePool, "search_facet_manufacturers", buildSearchManufacturerFacetSql(searchFilter.whereSql), searchFilter.params, options),
      timedCatalogQuery<DatabaseSearchFacetCategoryRow>(databasePool, "search_facet_categories", buildSearchCategoryFacetSql(searchFilter.whereSql), searchFilter.params, options),
      timedCatalogQuery<DatabaseSearchFacetPackageRow>(databasePool, "search_facet_packages", buildSearchPackageFacetSql(searchFilter.whereSql), searchFilter.params, options),
      timedCatalogQuery<DatabaseSearchFacetLifecycleRow>(databasePool, "search_facet_lifecycle", buildSearchLifecycleFacetSql(searchFilter.whereSql), searchFilter.params, options),
      timedCatalogQuery<DatabaseSearchFacetReadinessRow>(databasePool, "search_facet_readiness", buildSearchReadinessFacetSql(searchFilter.whereSql), searchFilter.params, options),
      timedCatalogQuery<DatabaseSearchFacetApprovalRow>(databasePool, "search_facet_approval", buildSearchApprovalFacetSql(searchFilter.whereSql), searchFilter.params, options),
      timedCatalogQuery<DatabaseSearchFacetConnectorClassRow>(databasePool, "search_facet_connector_class", buildSearchConnectorClassFacetSql(searchFilter.whereSql), searchFilter.params, options),
      timedCatalogQuery<DatabaseSearchFacetCountRow>(databasePool, "search_facet_total", buildSearchCountSql(searchFilter), searchFilter.params, options),
      timedCatalogQuery<DatabaseCadAvailableFacetRow>(databasePool, "search_facet_cad_available", buildSearchCadAvailableCountSql(searchFilter.whereSql), searchFilter.params, options)
    ]);
    const lifecycleCounts: Record<"active" | "not_recommended" | "obsolete" | "unknown", number> = {
      active: 0,
      not_recommended: 0,
      obsolete: 0,
      unknown: 0
    };
    const readinessCounts: Record<PartReadinessStatus, number> = {
      blocked: 0,
      needs_attention: 0,
      ready_for_export_review: 0,
      unknown: 0
    };
    const approvalCounts: Record<PartApprovalStatus, number> = {
      approved: 0,
      not_applicable: 0,
      not_requested: 0,
      pending_review: 0
    };
    const connectorClassCounts: Record<ConnectorClass, number> = {
      accessory: 0,
      cable: 0,
      connector: 0,
      non_connector: 0,
      tooling: 0
    };

    for (const row of lifecycleRows.rows) {
      lifecycleCounts[row.lifecycle_status] = Number(row.facet_count);
    }
    for (const row of readinessRows.rows) {
      readinessCounts[row.readiness_status] = Number(row.facet_count);
    }
    for (const row of approvalRows.rows) {
      approvalCounts[row.approval_status] = Number(row.facet_count);
    }
    for (const row of connectorClassRows.rows) {
      connectorClassCounts[row.connector_class] = Number(row.facet_count);
    }

    const totalCount = Number(totalRowResult.rows[0]?.total_count ?? 0);
    const availableCount = Number(cadAvailableResult.rows[0]?.available_count ?? 0);

    return {
      approvalStatuses: (["approved", "pending_review", "not_requested", "not_applicable"] as const).filter((status) => approvalCounts[status] > 0),
      categories: categoryRows.rows.map((row) => row.category),
      connectorClasses: (["connector", "accessory", "tooling", "cable", "non_connector"] as const).filter((status) => connectorClassCounts[status] > 0),
      counts: {
        approvalStatuses: approvalCounts,
        cadAvailability: {
          any: totalCount,
          available: availableCount,
          unavailable: Math.max(0, totalCount - availableCount)
        },
        categories: Object.fromEntries(categoryRows.rows.map((row) => [row.category, Number(row.facet_count)])),
        connectorClasses: connectorClassCounts,
        lifecycleStatuses: lifecycleCounts,
        manufacturers: Object.fromEntries(manufacturerRows.rows.map((row) => [row.id, Number(row.facet_count)])),
        packages: Object.fromEntries(packageRows.rows.map((row) => [row.id, Number(row.facet_count)])),
        readinessStatuses: readinessCounts
      },
      lifecycleStatuses: (["active", "not_recommended", "obsolete", "unknown"] as const).filter((status) => lifecycleCounts[status] > 0),
      manufacturers: manufacturerRows.rows.map((row) => ({
        aliases: row.aliases ?? [],
        id: row.id,
        name: row.name,
        website: row.website
      })),
      packages: packageRows.rows.map((row) => ({
        bodyHeightMm: row.body_height_mm ? Number(row.body_height_mm) : null,
        bodyLengthMm: row.body_length_mm ? Number(row.body_length_mm) : null,
        bodyWidthMm: row.body_width_mm ? Number(row.body_width_mm) : null,
        id: row.id,
        packageName: row.package_name,
        pinCount: Number(row.pin_count),
        pitchMm: row.pitch_mm ? Number(row.pitch_mm) : null
      })),
      readinessStatuses: (["ready_for_export_review", "needs_attention", "blocked", "unknown"] as const).filter((status) => readinessCounts[status] > 0)
    };
  } catch (error) {
    throw toCatalogStoreError(error);
  }
}

/**
 * Executes one catalog query and reports timing without changing query semantics.
 */
async function timedCatalogQuery<TRow extends QueryResultRow>(databasePool: Pool, name: string, sql: string, params: unknown[], options: CatalogReadOptions): Promise<QueryResult<TRow>> {
  const startedAt = performance.now();
  const scoped = Array.isArray(params[0]);
  let rowCount: number | null = null;
  let status: CatalogQueryTiming["status"] = "ok";

  try {
    const result = await databasePool.query<TRow>(sql, params);
    rowCount = result.rowCount ?? result.rows.length;

    return result;
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    options.onQueryTiming?.({
      durationMs: performance.now() - startedAt,
      name,
      rowCount,
      scoped,
      status
    });
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

  // RLS backstop: requests run on the shared per-request tenant transaction (see request-db.ts).
  const requestDb = getRequestDb();

  if (requestDb) {
    return requestDb;
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
 * Reads the id of an active queued/running acquisition job for one provider part key when it already exists.
 */
async function findActiveProviderAcquisitionJobId(client: PoolClient, providerId: string, providerPartKey: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM provider_acquisition_jobs
      WHERE provider_id = $1
        AND provider_part_key = $2
        AND job_status IN ('queued', 'running')
      ORDER BY CASE job_status WHEN 'running' THEN 0 ELSE 1 END ASC, requested_at ASC, id ASC
      LIMIT 1
    `,
    [providerId, providerPartKey]
  );

  return result.rows[0]?.id ?? null;
}

/**
 * Reads an active queued/running acquisition job detail by provider id and provider part key.
 */
async function readActiveProviderAcquisitionJobDetailByProviderKey(
  databasePool: Pool,
  providerId: string,
  providerPartKey: string
): Promise<ProviderAcquisitionJobDetailResponse | null> {
  const result = await databasePool.query<{ id: string }>(
    `
      SELECT id
      FROM provider_acquisition_jobs
      WHERE provider_id = $1
        AND provider_part_key = $2
        AND job_status IN ('queued', 'running')
      ORDER BY CASE job_status WHEN 'running' THEN 0 ELSE 1 END ASC, requested_at ASC, id ASC
      LIMIT 1
    `,
    [providerId, providerPartKey]
  );
  const activeJobId = result.rows[0]?.id ?? null;

  return activeJobId ? readProviderAcquisitionJobDetail(databasePool, activeJobId) : null;
}

/**
 * Reads one acquisition job detail payload directly from Postgres.
 */
async function readProviderAcquisitionJobDetail(databasePool: Pool, jobId: string): Promise<ProviderAcquisitionJobDetailResponse | null> {
  const [jobResult, eventResult] = await Promise.all([
    databasePool.query<DatabaseProviderAcquisitionJobRow>(
      `
        SELECT
          id,
          provider_id,
          provider_part_key,
          requested_lookup,
          manufacturer_name,
          mpn,
          package_name,
          source_url,
          match_type,
          match_confidence,
          job_status,
          requested_by,
          org_id,
          requested_at,
          part_id,
          import_outcome,
          previous_import_status,
          error_code,
          error_message,
          started_at,
          completed_at,
          last_updated_at
        FROM provider_acquisition_jobs
        WHERE id = $1
        LIMIT 1
      `,
      [jobId]
    ),
    databasePool.query<DatabaseProviderAcquisitionJobEventRow>(
      `
        SELECT
          id,
          job_id,
          event_type,
          message,
          detail,
          created_at
        FROM provider_acquisition_job_events
        WHERE job_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [jobId]
    )
  ]);
  const jobRow = jobResult.rows[0];

  if (!jobRow) {
    return null;
  }

  return {
    events: eventResult.rows.map((row) => ({
      createdAt: toIsoTimestamp(row.created_at),
      detail: row.detail,
      eventType: row.event_type,
      id: row.id,
      jobId: row.job_id,
      message: row.message
    })),
    job: mapProviderAcquisitionJobRow(jobRow)
  };
}

/**
 * Builds one provider acquisition job record before it is inserted into Postgres.
 */
function buildProviderAcquisitionJobRecord(
  input: ProviderAcquisitionJobCreateInput,
  requestedBy: string,
  requestedAt: string
): ProviderAcquisitionJob {
  return {
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    id: buildProviderAcquisitionJobId(input.providerId, input.providerPartKey, requestedAt),
    importOutcome: null,
    jobStatus: "queued",
    lastUpdatedAt: requestedAt,
    manufacturerName: input.manufacturerName?.trim() || null,
    matchConfidence: input.matchConfidence,
    matchType: input.matchType,
    mpn: input.mpn?.trim() || null,
    orgId: requireRequestOrgId(),
    package: input.package?.trim() || null,
    partId: null,
    previousImportStatus: null,
    providerId: input.providerId,
    providerPartKey: input.providerPartKey,
    requestedAt,
    requestedBy,
    requestedLookup: input.requestedLookup,
    sourceUrl: input.sourceUrl?.trim() || null,
    startedAt: null
  };
}

/**
 * Builds one coarse provider acquisition lifecycle event.
 */
function buildProviderAcquisitionJobEventRecord(
  jobId: string,
  eventType: ProviderAcquisitionJobEvent["eventType"],
  message: string,
  createdAt: string,
  detail: Record<string, unknown> | null
): ProviderAcquisitionJobEvent {
  return {
    createdAt,
    detail,
    eventType,
    id: buildProviderAcquisitionJobEventId(jobId, eventType, createdAt),
    jobId,
    message
  };
}

/**
 * Persists one provider acquisition job inside an existing transaction.
 */
async function persistProviderAcquisitionJobRow(client: PoolClient, job: ProviderAcquisitionJob): Promise<void> {
  await client.query(
    `
      INSERT INTO provider_acquisition_jobs (
        id,
        provider_id,
        provider_part_key,
        requested_lookup,
        manufacturer_name,
        mpn,
        package_name,
        source_url,
        match_type,
        match_confidence,
        job_status,
        requested_by,
        requested_at,
        part_id,
        import_outcome,
        previous_import_status,
        error_code,
        error_message,
        started_at,
        completed_at,
        last_updated_at,
        org_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    `,
    [
      job.id,
      job.providerId,
      job.providerPartKey,
      job.requestedLookup,
      job.manufacturerName,
      job.mpn,
      job.package,
      job.sourceUrl,
      job.matchType,
      job.matchConfidence,
      job.jobStatus,
      job.requestedBy,
      job.requestedAt,
      job.partId,
      job.importOutcome,
      job.previousImportStatus,
      job.errorCode,
      job.errorMessage,
      job.startedAt,
      job.completedAt,
      job.lastUpdatedAt,
      job.orgId
    ]
  );
}

/**
 * Persists one provider acquisition lifecycle event inside an existing transaction.
 */
async function persistProviderAcquisitionJobEventRow(client: PoolClient, event: ProviderAcquisitionJobEvent): Promise<void> {
  await client.query(
    `
      INSERT INTO provider_acquisition_job_events (
        id,
        job_id,
        event_type,
        message,
        detail,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [event.id, event.jobId, event.eventType, event.message, event.detail, event.createdAt]
  );
}

/**
 * Maps one raw acquisition job row into the shared API contract.
 */
function mapProviderAcquisitionJobRow(row: DatabaseProviderAcquisitionJobRow): ProviderAcquisitionJob {
  return {
    completedAt: row.completed_at ? toIsoTimestamp(row.completed_at) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    id: row.id,
    importOutcome: row.import_outcome,
    jobStatus: row.job_status,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    manufacturerName: row.manufacturer_name,
    matchConfidence: toNumber(row.match_confidence),
    matchType: row.match_type,
    mpn: row.mpn,
    orgId: row.org_id ?? "org-default",
    package: row.package_name,
    partId: row.part_id,
    previousImportStatus: row.previous_import_status,
    providerId: row.provider_id,
    providerPartKey: row.provider_part_key,
    requestedAt: toIsoTimestamp(row.requested_at),
    requestedBy: row.requested_by,
    requestedLookup: row.requested_lookup,
    sourceUrl: row.source_url,
    startedAt: row.started_at ? toIsoTimestamp(row.started_at) : null
  };
}

/**
 * Collects relationship target identifiers needed for the detail related-part summaries.
 */
function collectRelatedPartIds(record: PartSearchRecord): string[] {
  return [
    ...record.mateRelations.map((relation) => relation.matePartId),
    ...record.accessoryRequirements.map((relation) => relation.accessoryPartId),
    ...record.cableCompatibilities.map((relation) => relation.cablePartId),
    ...record.connectorFamilyConflicts.map((conflict) => conflict.candidatePartId),
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
 * Builds a deterministic provider acquisition job id from provider key and request timestamp.
 */
function buildProviderAcquisitionJobId(providerId: string, providerPartKey: string, requestedAt: string): string {
  return `acqjob-${slugify(providerId)}-${slugify(providerPartKey)}-${requestedAt.replace(/\D/gu, "")}`;
}

/**
 * Detects duplicate-key failures so acquisition-job creation can re-read the existing active job instead of creating duplicates.
 */
function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const errorCode = "code" in error && typeof error.code === "string" ? error.code : null;
  const errorMessage = "message" in error && typeof error.message === "string" ? error.message : "";

  return errorCode === "23505" || /duplicate key value violates unique constraint/u.test(errorMessage);
}

/**
 * Builds a deterministic provider acquisition event id from job, event type, and timestamp.
 */
function buildProviderAcquisitionJobEventId(jobId: string, eventType: ProviderAcquisitionJobEvent["eventType"], createdAt: string): string {
  return `acqevent-${slugify(jobId)}-${eventType}-${createdAt.replace(/\D/gu, "")}`;
}

/**
 * Converts ids and lookup keys into deterministic lowercase fragments for locally generated ids.
 */
function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "unknown";
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
 * Mirrors terminal workflow review outcomes onto linked requests so request badges do not stay stale.
 */
function linkedRequestStatusForWorkflow(status: GenerationWorkflow["generationStatus"]): GenerationRequest["requestStatus"] | null {
  if (status === "approved" || status === "failed" || status === "review_required") {
    return status;
  }

  return null;
}

/**
 * Builds a deterministic audit row for one export-promotion attempt.
 */
function buildPromotionAuditRecord(partId: string, asset: Asset, newExportStatus: Asset["exportStatus"], promotionOutcome: AssetPromotionAuditRecord["promotionOutcome"], blockerReasons: string[], validationRecordId: string | null, promotedAt: string): AssetPromotionAuditRecord {
  return {
    actor: "local-dev-promotion",
    assetId: asset.id,
    blockerReasons,
    createdAt: promotedAt,
    id: `promotion-${partId}-${asset.id}-${promotionOutcome}-${promotedAt.replace(/\D/gu, "")}`,
    newExportStatus,
    partId,
    priorExportStatus: asset.exportStatus,
    promotionOutcome,
    validationRecordId
  };
}

/**
 * Persists one promotion audit row without requiring the caller to own a transaction.
 */
async function persistPromotionAuditInDatabase(databasePool: Pool, auditRecord: AssetPromotionAuditRecord): Promise<void> {
  const client = await databasePool.connect();

  try {
    await persistPromotionAuditRows(client, auditRecord);
  } catch (error) {
    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }
}

/**
 * Persists one promotion audit row inside an existing transaction-capable client.
 */
async function persistPromotionAuditRows(client: PoolClient, auditRecord: AssetPromotionAuditRecord): Promise<void> {
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
        created_at,
        org_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      auditRecord.id,
      auditRecord.partId,
      auditRecord.assetId,
      auditRecord.priorExportStatus,
      auditRecord.newExportStatus,
      auditRecord.promotionOutcome,
      auditRecord.blockerReasons,
      auditRecord.validationRecordId,
      auditRecord.actor,
      auditRecord.createdAt,
      requireRequestOrgId()
    ]
  );
}

/**
 * Recomputes and persists the part-level readiness projection after a mutable workflow action.
 */
async function refreshPartProjectionInDatabase(databasePool: Pool, partId: string): Promise<void> {
  const refreshedRecords = await readCatalogRecords(databasePool, [partId]);
  const refreshedRecord = refreshedRecords.find((record) => record.part.id === partId);

  if (!refreshedRecord) {
    return;
  }

  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    await persistPartProjectionRows(client, refreshedRecord);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw toCatalogStoreError(error);
  } finally {
    client.release();
  }
}

/**
 * Persists one refreshed part-level readiness projection from the current joined record view.
 */
async function persistPartProjectionRows(client: PoolClient, record: PartSearchRecord): Promise<void> {
  const projection = derivePartProjection({
    accessoryRequirements: record.accessoryRequirements,
    assets: record.assets,
    buildableMatingSet: record.buildableMatingSet,
    datasheetRevision: record.datasheetRevision,
    duplicateCandidates: record.duplicateCandidates,
    extractionSignals: record.extractionSignals,
    generationRequests: record.generationRequests,
    generationWorkflows: record.generationWorkflows,
    mateRelations: record.mateRelations,
    metrics: record.metrics,
    part: record.part,
    promotionAudits: record.promotionAudits,
    reviewRecords: record.reviewRecords,
    sourceReconciliation: record.sourceReconciliation,
    sources: record.sources,
    validationRecords: record.validationRecords
  });

  await client.query(
    `
      INSERT INTO part_readiness_summaries (
        part_id,
        readiness_status,
        identity_status,
        connector_class,
        blocker_count,
        blocker_summary,
        recommended_actions,
        detail,
        last_evaluated_at,
        org_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (part_id) DO UPDATE SET
        readiness_status = EXCLUDED.readiness_status,
        identity_status = EXCLUDED.identity_status,
        connector_class = EXCLUDED.connector_class,
        blocker_count = EXCLUDED.blocker_count,
        blocker_summary = EXCLUDED.blocker_summary,
        recommended_actions = EXCLUDED.recommended_actions,
        detail = EXCLUDED.detail,
        last_evaluated_at = EXCLUDED.last_evaluated_at
    `,
    [
      projection.readinessSummary.partId,
      projection.readinessSummary.status,
      projection.readinessSummary.identityStatus,
      projection.readinessSummary.connectorClass,
      projection.readinessSummary.blockerCount,
      projection.readinessSummary.blockerSummary,
      projection.readinessSummary.recommendedActions,
      projection.readinessSummary.detail,
      projection.readinessSummary.lastEvaluatedAt,
      requireRequestOrgId()
    ]
  );
  await client.query(
    `
      INSERT INTO part_approvals (
        part_id,
        approval_status,
        summary,
        detail,
        evidence,
        decided_by,
        decided_at,
        last_updated_at,
        org_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (part_id) DO UPDATE SET
        approval_status = EXCLUDED.approval_status,
        summary = EXCLUDED.summary,
        detail = EXCLUDED.detail,
        evidence = EXCLUDED.evidence,
        decided_by = EXCLUDED.decided_by,
        decided_at = EXCLUDED.decided_at,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      projection.approval.partId,
      projection.approval.status,
      projection.approval.summary,
      projection.approval.detail,
      projection.approval.evidence,
      projection.approval.decidedBy,
      projection.approval.decidedAt,
      projection.approval.lastUpdatedAt,
      requireRequestOrgId()
    ]
  );
  await syncPartIssueRows(client, record.part.id, projection.issues);
  await client.query(`DELETE FROM part_risk_flags WHERE part_id = $1`, [record.part.id]);

  for (const riskFlag of projection.riskFlags) {
    await client.query(
      `
        INSERT INTO part_risk_flags (
          id,
          part_id,
          risk_code,
          label,
          detail,
          tone,
          last_updated_at,
          org_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [riskFlag.id, riskFlag.partId, riskFlag.code, riskFlag.label, riskFlag.detail, riskFlag.tone, riskFlag.lastUpdatedAt, requireRequestOrgId()]
    );
  }
}

/**
 * Upserts derived issues while preserving manual workflow state across projection refreshes.
 */
async function syncPartIssueRows(client: PoolClient, partId: string, issues: PartIssue[]): Promise<void> {
  if (issues.length === 0) {
    await client.query(`DELETE FROM part_issues WHERE part_id = $1`, [partId]);
    return;
  }

  await client.query(`DELETE FROM part_issues WHERE part_id = $1 AND NOT (issue_code = ANY($2::text[]))`, [partId, issues.map((issue) => issue.code)]);

  for (const issue of issues) {
    await client.query(
      `
        INSERT INTO part_issues (
          id,
          part_id,
          issue_code,
          severity,
          status,
          assigned_to,
          resolution_notes,
          resolved_at,
          summary,
          detail,
          source,
          last_updated_at,
          org_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (part_id, issue_code) DO UPDATE SET
          id = EXCLUDED.id,
          severity = EXCLUDED.severity,
          summary = EXCLUDED.summary,
          detail = EXCLUDED.detail,
          source = EXCLUDED.source,
          last_updated_at = EXCLUDED.last_updated_at
      `,
      [
        issue.id,
        issue.partId,
        issue.code,
        issue.severity,
        issue.status,
        issue.assignedTo,
        issue.resolutionNotes,
        issue.resolvedAt,
        issue.summary,
        issue.detail,
        issue.source,
        issue.lastUpdatedAt,
        requireRequestOrgId()
      ]
    );
  }
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
  extractionSignalRows: DatabaseSourceExtractionSignalRow[],
  mateRows: DatabaseMateRow[],
  accessoryRows: DatabaseAccessoryRow[],
  cableRows: DatabaseCableRow[],
  connectorFamilyConflictRows: DatabaseConnectorFamilyConflictRow[],
  similarRows: DatabaseSimilarPartRow[],
  companionRows: DatabaseCompanionRow[],
  workflowRows: DatabaseGenerationWorkflowRow[],
  requestRows: DatabaseGenerationRequestRow[],
  reviewRows: DatabaseReviewRow[],
  validationRows: DatabaseAssetValidationRow[],
  promotionAuditRows: DatabaseAssetPromotionAuditRow[],
  readinessRows: DatabasePartReadinessRow[],
  approvalRows: DatabasePartApprovalRow[],
  issueRows: DatabasePartIssueRow[],
  duplicateCandidateRows: DatabasePartDuplicateCandidateRow[],
  sourceReconciliationRows: DatabaseSourceReconciliationRow[],
  riskFlagRows: DatabasePartRiskFlagRow[]
): PartSearchRecord[] {
  const metricsByPartId = groupBy(metricRows.map(mapMetricRow), (metric) => metric.partId);
  const assetsByPartId = groupBy(assetRows.map(mapAssetRow), (asset) => asset.partId);
  const datasheetsByPartId = groupBy(datasheetRows.map(mapDatasheetRow), (datasheet) => datasheet.partId);
  const sourcesByPartId = groupBy(sourceRows.map(mapSourceRow), (source) => source.partId ?? "");
  const extractionSignalsByPartId = groupBy(extractionSignalRows.map(mapSourceExtractionSignalRow), (signal) => signal.partId);
  const matesByPartId = groupBy(mateRows.map(mapMateRow), (relation) => relation.partId);
  const accessoriesByPartId = groupBy(accessoryRows.map(mapAccessoryRow), (relation) => relation.partId);
  const cablesByPartId = groupBy(cableRows.map(mapCableRow), (relation) => relation.partId);
  const connectorFamilyConflictsByPartId = groupBy(
    connectorFamilyConflictRows.map(mapConnectorFamilyConflictRow),
    (conflict) => conflict.partId
  );
  const similarPartsByPartId = groupBy(similarRows.map(mapSimilarPartRow), (relation) => relation.partId);
  const companionsByPartId = groupBy(companionRows.map(mapCompanionRow), (relation) => relation.partId);
  const workflowsByPartId = groupBy(workflowRows.map(mapGenerationWorkflowRow), (workflow) => workflow.partId);
  const requestsByPartId = groupBy(requestRows.map(mapGenerationRequestRow), (request) => request.partId);
  const reviewsByPartId = groupBy(reviewRows.map(mapReviewRow), (review) => review.partId);
  const validationsByPartId = groupBy(validationRows.map(mapAssetValidationRow), (validation) => validation.partId);
  const promotionAuditsByPartId = groupBy(promotionAuditRows.map(mapAssetPromotionAuditRow), (audit) => audit.partId);
  const readinessByPartId = new Map(readinessRows.map((row) => [row.part_id, mapPartReadinessRow(row)]));
  const approvalsByPartId = new Map(approvalRows.map((row) => [row.part_id, mapPartApprovalRow(row)]));
  const issuesByPartId = groupBy(issueRows.map(mapPartIssueRow), (issue) => issue.partId);
  const duplicateCandidatesByPartId = groupBy(duplicateCandidateRows.map(mapPartDuplicateCandidateRow), (candidate) => candidate.partId);
  const sourceReconciliationByPartId = new Map(sourceReconciliationRows.map((row) => [row.part_id, mapSourceReconciliationRow(row)]));
  const riskFlagsByPartId = groupBy(riskFlagRows.map(mapPartRiskFlagRow), (riskFlag) => riskFlag.partId);

  return partRows.map((row) => {
    const part = mapPartRow(row);
    const metrics = metricsByPartId.get(part.id) ?? [];
    const assets = assetsByPartId.get(part.id) ?? [];
    const datasheets = datasheetsByPartId.get(part.id) ?? [];
    const sources = sourcesByPartId.get(part.id) ?? [];
    const extractionSignals = extractionSignalsByPartId.get(part.id) ?? [];
    const mateRelations = matesByPartId.get(part.id) ?? [];
    const accessoryRequirements = accessoriesByPartId.get(part.id) ?? [];
    const cableCompatibilities = cablesByPartId.get(part.id) ?? [];
    const connectorFamilyConflicts = connectorFamilyConflictsByPartId.get(part.id) ?? [];
    const similarParts = similarPartsByPartId.get(part.id) ?? [];
    const companionRecommendations = companionsByPartId.get(part.id) ?? [];
    const generationWorkflows = workflowsByPartId.get(part.id) ?? [];
    const generationRequests = requestsByPartId.get(part.id) ?? [];
    const reviewRecords = reviewsByPartId.get(part.id) ?? [];
    const validationRecords = validationsByPartId.get(part.id) ?? [];
    const promotionAudits = promotionAuditsByPartId.get(part.id) ?? [];
    const duplicateCandidates = duplicateCandidatesByPartId.get(part.id) ?? [];
    const sourceReconciliation = sourceReconciliationByPartId.get(part.id) ?? null;
    const buildableMatingSet = buildBuildableMatingSet(mateRelations, accessoryRequirements, cableCompatibilities, connectorFamilyConflicts);
    const derivedProjection = derivePartProjection({
      accessoryRequirements,
      assets,
      buildableMatingSet,
      datasheetRevision: selectLatestDatasheet(datasheets),
      duplicateCandidates,
      extractionSignals,
      generationRequests,
      generationWorkflows,
      mateRelations,
      metrics,
      part,
      promotionAudits,
      reviewRecords,
      sourceReconciliation,
      sources,
      validationRecords
    });
    const readinessSummary = readinessByPartId.get(part.id) ?? derivedProjection.readinessSummary;
    const approval = approvalsByPartId.get(part.id) ?? derivedProjection.approval;
    const issues = issuesByPartId.get(part.id) ?? derivedProjection.issues;
    const riskFlags = riskFlagsByPartId.get(part.id) ?? derivedProjection.riskFlags;
    const lastUpdatedAt = latestTimestamp([
      part.lastUpdatedAt,
      ...metrics.map((metric) => metric.lastUpdatedAt),
      ...assets.map((asset) => asset.lastUpdatedAt),
      ...datasheets.map((datasheet) => datasheet.lastUpdatedAt),
      ...sources.map((source) => source.lastUpdatedAt),
      ...extractionSignals.map((signal) => signal.lastUpdatedAt),
      ...connectorFamilyConflicts.map((conflict) => conflict.lastUpdatedAt),
      ...generationRequests.map((request) => request.lastUpdatedAt),
      ...reviewRecords.map((review) => review.lastUpdatedAt),
      ...validationRecords.map((validation) => validation.lastUpdatedAt),
      ...promotionAudits.map((audit) => audit.createdAt)
    ]);

    return {
      approval,
      accessoryRequirements,
      assets,
      buildableMatingSet,
      cableCompatibilities,
      companionRecommendations,
      connectorFamily: mapConnectorFamilyRow(row),
      connectorFamilyConflicts,
      datasheetRevision: selectLatestDatasheet(datasheets),
      duplicateCandidates,
      extractionSignals,
      generationRequests,
      generationWorkflows,
      issues,
      lastUpdatedAt,
      manufacturer: mapManufacturerRow(row),
      mateRelations,
      metrics,
      package: mapPackageRow(row),
      part,
      promotionAudits,
      readinessSummary,
      reviewRecords,
      riskFlags,
      similarParts,
      sourceReconciliation,
      sources,
      validationRecords
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
    description: row.description,
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
    previewArtifactFormat: row.preview_artifact_format,
    previewArtifactGeneratedAt: row.preview_artifact_generated_at ? toIsoTimestamp(row.preview_artifact_generated_at) : null,
    previewArtifactSource: row.preview_artifact_source,
    previewArtifactStorageKey: row.preview_artifact_storage_key,
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
 * Maps the latest acquisition job into the detail-safe acquisition summary contract.
 */
function mapPartAcquisitionSummaryFromJobRow(row: DatabaseProviderAcquisitionJobRow): PartAcquisitionSummary {
  return {
    completedAt: row.completed_at ? toIsoTimestamp(row.completed_at) : null,
    lastJobStatus: row.job_status,
    manufacturerName: row.manufacturer_name,
    mpn: row.mpn,
    providerId: row.provider_id,
    providerPartKey: row.provider_part_key,
    reason: null,
    requestedAt: toIsoTimestamp(row.requested_at),
    requestedBy: null,
    requestedLookup: row.requested_lookup,
    sourceUrl: row.source_url,
    state: "available"
  };
}

/**
 * Builds the explicit legacy-source state for parts that have provider evidence but no recorded acquisition job.
 */
function buildLegacySourceOnlyPartAcquisitionSummary(row: DatabaseSourceRow): PartAcquisitionSummary {
  return {
    completedAt: null,
    lastJobStatus: null,
    manufacturerName: null,
    mpn: null,
    providerId: row.provider_id,
    providerPartKey: row.provider_part_key,
    reason: "This part has attached provider source evidence, but no acquisition job history was recorded for it.",
    requestedAt: null,
    requestedBy: null,
    requestedLookup: null,
    sourceUrl: row.source_url,
    state: "legacy_source_only"
  };
}

/**
 * Builds the honest default when neither acquisition jobs nor provider source rows are recorded for a part.
 */
function buildNotRecordedPartAcquisitionSummary(): PartAcquisitionSummary {
  return {
    completedAt: null,
    lastJobStatus: null,
    manufacturerName: null,
    mpn: null,
    providerId: null,
    providerPartKey: null,
    reason: "No provider acquisition job or attached provider source evidence is recorded for this part yet.",
    requestedAt: null,
    requestedBy: null,
    requestedLookup: null,
    sourceUrl: null,
    state: "not_recorded"
  };
}

/**
 * Builds an unavailable acquisition summary when the detail route cannot safely read DB-backed provenance.
 */
function buildUnavailablePartAcquisitionSummary(reason: string): PartAcquisitionSummary {
  return {
    ...buildNotRecordedPartAcquisitionSummary(),
    reason,
    state: "unavailable"
  };
}

/**
 * Maps one persisted provider enrichment job into the detail-safe part-detail summary contract.
 */
function mapPartEnrichmentJobSummary(row: DatabaseProviderEnrichmentJobRow): PartEnrichmentJobSummary {
  return {
    completedAt: row.completed_at ? toIsoTimestamp(row.completed_at) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    id: row.id,
    jobStatus: row.job_status,
    jobType: row.job_type,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    requestedAt: toIsoTimestamp(row.requested_at),
    startedAt: row.started_at ? toIsoTimestamp(row.started_at) : null
  };
}

/**
 * Builds the detail-safe enrichment summary from persisted job rows without implying approval or readiness.
 */
function buildPartEnrichmentSummaryFromJobRows(rows: DatabaseProviderEnrichmentJobRow[]): PartEnrichmentSummary {
  const jobs = rows.map(mapPartEnrichmentJobSummary);

  return {
    activeJobCount: jobs.filter((job) => job.jobStatus === "queued" || job.jobStatus === "running").length,
    jobs,
    latestJobStatus: jobs[0]?.jobStatus ?? null,
    reason: null,
    state: "available"
  };
}

/**
 * Builds the honest default when no provider enrichment jobs are recorded for the part.
 */
function buildNotRecordedPartEnrichmentSummary(): PartEnrichmentSummary {
  return {
    activeJobCount: 0,
    jobs: [],
    latestJobStatus: null,
    reason: "No provider enrichment jobs are recorded for this part yet.",
    state: "not_recorded"
  };
}

/**
 * Builds an unavailable enrichment summary when the detail route cannot safely read DB-backed enrichment history.
 */
function buildUnavailablePartEnrichmentSummary(reason: string): PartEnrichmentSummary {
  return {
    ...buildNotRecordedPartEnrichmentSummary(),
    reason,
    state: "unavailable"
  };
}

/**
 * Maps a database row into the shared MateRelation type.
 */
function mapMateRow(row: DatabaseMateRow): MateRelation {
  return {
    compatibilityStatus: row.compatibility_status ?? "probable",
    confidenceScore: toNumber(row.confidence_score),
    evidenceKind: row.evidence_kind ?? "catalog_fixture",
    id: row.id,
    matePartId: row.mate_part_id,
    notes: row.notes,
    partId: row.part_id,
    relationshipType: row.relationship_type,
    sourceRecordId: row.source_record_id,
    sourceRevisionId: row.source_revision_id
  };
}

/**
 * Maps a database row into the shared AccessoryRequirement type.
 */
function mapAccessoryRow(row: DatabaseAccessoryRow): AccessoryRequirement {
  return {
    accessoryPartId: row.accessory_part_id,
    compatibilityStatus: row.compatibility_status ?? "probable",
    confidenceScore: toNumber(row.confidence_score),
    evidenceKind: row.evidence_kind ?? "catalog_fixture",
    id: row.id,
    notes: row.notes,
    partId: row.part_id,
    relationshipType: row.relationship_type,
    sourceRecordId: row.source_record_id,
    sourceRevisionId: row.source_revision_id
  };
}

/**
 * Maps a database row into the shared CableCompatibility type.
 */
function mapCableRow(row: DatabaseCableRow): CableCompatibility {
  return {
    cablePartId: row.cable_part_id,
    compatibilityStatus: row.compatibility_status ?? "uncertain",
    confidenceScore: toNumber(row.confidence_score),
    id: row.id,
    notes: row.notes,
    partId: row.part_id,
    relationshipType: row.relationship_type,
    shieldingRequirement: row.shielding_requirement ?? "unknown",
    sourceRecordId: row.source_record_id,
    sourceRevisionId: row.source_revision_id,
    terminationStyle: row.termination_style ?? "unknown",
    wireGaugeMax: row.wire_gauge_max,
    wireGaugeMin: row.wire_gauge_min
  };
}

/**
 * Maps a database row into the shared ConnectorFamilyConflict type.
 */
function mapConnectorFamilyConflictRow(row: DatabaseConnectorFamilyConflictRow): ConnectorFamilyConflict {
  return {
    candidateConnectorFamilyId: row.candidate_connector_family_id,
    candidatePartId: row.candidate_part_id,
    confidenceScore: toNumber(row.confidence_score),
    conflictType: row.conflict_type,
    detail: row.detail,
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    partId: row.part_id,
    sourceRecordId: row.source_record_id,
    summary: row.summary
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
 * Maps a database row into durable asset validation evidence.
 */
function mapAssetValidationRow(row: DatabaseAssetValidationRow): AssetValidationRecord {
  return {
    assetId: row.asset_id,
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    partId: row.part_id,
    validatedAt: toIsoTimestamp(row.validated_at),
    validationNotes: row.validation_notes,
    validationStatus: row.validation_status,
    validationType: row.validation_type,
    validator: row.validator
  };
}

/**
 * Maps a database row into one export-promotion audit record.
 */
function mapAssetPromotionAuditRow(row: DatabaseAssetPromotionAuditRow): AssetPromotionAuditRecord {
  return {
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
  };
}

/**
 * Maps a database row into the shared PartReadinessSummary type.
 */
function mapPartReadinessRow(row: DatabasePartReadinessRow): PartSearchRecord["readinessSummary"] {
  return {
    blockerCount: row.blocker_count,
    blockerSummary: row.blocker_summary,
    connectorClass: row.connector_class,
    detail: row.detail,
    identityStatus: row.identity_status,
    label: mapReadinessStatusLabel(row.readiness_status),
    lastEvaluatedAt: toIsoTimestamp(row.last_evaluated_at),
    partId: row.part_id,
    recommendedActions: row.recommended_actions,
    status: row.readiness_status
  };
}

/**
 * Maps a database row into the shared PartApproval type.
 */
function mapPartApprovalRow(row: DatabasePartApprovalRow): PartApproval {
  return {
    decidedAt: row.decided_at ? toIsoTimestamp(row.decided_at) : null,
    decidedBy: row.decided_by,
    detail: row.detail,
    evidence: row.evidence,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    partId: row.part_id,
    status: row.approval_status,
    summary: row.summary
  };
}

/**
 * Maps a database row into the shared PartIssue type.
 */
function mapPartIssueRow(row: DatabasePartIssueRow): PartIssue {
  return {
    assignedTo: row.assigned_to,
    code: row.issue_code,
    detail: row.detail,
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    partId: row.part_id,
    resolutionNotes: row.resolution_notes,
    resolvedAt: row.resolved_at ? toIsoTimestamp(row.resolved_at) : null,
    severity: row.severity,
    source: row.source,
    status: row.status,
    summary: row.summary
  };
}

/**
 * Maps a database row into the shared duplicate-candidate type.
 */
function mapPartDuplicateCandidateRow(row: DatabasePartDuplicateCandidateRow): PartDuplicateCandidate {
  return {
    confidenceScore: toNumber(row.confidence_score),
    detail: row.detail,
    detectionSource: row.detection_source,
    duplicateManufacturerName: row.duplicate_manufacturer_name,
    duplicatePartId: row.duplicate_part_id,
    duplicatePartMpn: row.duplicate_part_mpn,
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    partId: row.part_id,
    summary: row.summary
  };
}

/**
 * Maps a database row into the shared source-reconciliation type.
 */
function mapSourceReconciliationRow(row: DatabaseSourceReconciliationRow): SourceReconciliationRecord {
  return {
    notes: row.notes,
    partId: row.part_id,
    preferredSourceRecordId: row.preferred_source_record_id,
    resolutionStatus: row.resolution_status,
    updatedAt: toIsoTimestamp(row.updated_at),
    updatedBy: row.updated_by
  };
}

/**
 * Maps a database row into the shared PartRiskFlag type.
 */
function mapPartRiskFlagRow(row: DatabasePartRiskFlagRow): PartRiskFlag {
  return {
    code: row.risk_code,
    detail: row.detail,
    id: row.id,
    label: row.label,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    partId: row.part_id,
    tone: row.tone
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
    importErrorDetails: row.import_error_details,
    importStatus: row.import_status,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    normalizedAt: row.normalized_at ? toIsoTimestamp(row.normalized_at) : null,
    partId: row.part_id,
    providerId: row.provider_id,
    providerPartKey: row.provider_part_key,
    rawPayload: row.raw_payload,
    sourceLastImportedAt: row.source_last_imported_at ? toIsoTimestamp(row.source_last_imported_at) : null,
    sourceLastSeenAt: toIsoTimestamp(row.source_last_seen_at),
    sourceUrl: row.source_url
  };
}

/**
 * Maps a database row into the shared SourceExtractionSignal type.
 */
function mapSourceExtractionSignalRow(row: DatabaseSourceExtractionSignalRow): SourceExtractionSignal {
  return {
    assetId: row.asset_id,
    confidenceScore: toNumber(row.confidence_score),
    datasheetRevisionId: row.datasheet_revision_id,
    extractionSource: row.extraction_source,
    extractionStatus: row.extraction_status,
    id: row.id,
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    notes: row.notes,
    partId: row.part_id,
    signalType: row.signal_type,
    sourceRecordId: row.source_record_id
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

/**
 * Normalizes optional operator text so empty strings do not persist as fake values.
 */
function normalizeOptionalText(value: string | null): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Maps readiness status values into the same label text used by the derived projection helper.
 */
function mapReadinessStatusLabel(status: PartReadinessStatus): string {
  return {
    blocked: "Blocked",
    needs_attention: "Needs attention",
    ready_for_export_review: "Ready for Export Review",
    unknown: "Readiness unknown"
  }[status];
}

/**
 * Converts a free-text query into a lower-case SQL LIKE pattern.
 */
function buildSearchQueryPattern(query: string | undefined): string | null {
  const normalizedQuery = query?.trim().toLowerCase();

  return normalizedQuery ? `%${normalizedQuery}%` : null;
}

/**
 * Builds one OR branch for a free-text LIKE parameter across the searchable catalog fields.
 * Source-record and datasheet URL checks stay as non-correlated IN-subqueries so trigram
 * indexes can be used before joining the matching part ids back to the parts table.
 */
function buildSearchLikeClause(paramIndex: number, options: { includeCompactSearch?: boolean } = {}): string {
  const compactSearchClause = options.includeCompactSearch
    ? `
      OR ${buildCompactSearchSql("lower(p.mpn)")} LIKE ${buildCompactSearchSql(`$${paramIndex}::text`)}
      OR ${buildCompactSearchSql("lower(p.description)")} LIKE ${buildCompactSearchSql(`$${paramIndex}::text`)}
      OR ${buildCompactSearchSql("lower(pk.package_name)")} LIKE ${buildCompactSearchSql(`$${paramIndex}::text`)}
      OR ${buildCompactSearchSql("lower(COALESCE(cf.name, ''))")} LIKE ${buildCompactSearchSql(`$${paramIndex}::text`)}`
    : "";

  return `(
      lower(p.mpn) LIKE $${paramIndex}
      OR lower(p.description) LIKE $${paramIndex}
      OR lower(p.category) LIKE $${paramIndex}
      OR lower(m.name) LIKE $${paramIndex}
      OR lower(pk.package_name) LIKE $${paramIndex}
      OR lower(COALESCE(cf.name, '')) LIKE $${paramIndex}
      ${compactSearchClause}
      OR p.id IN (
        SELECT sr.part_id
        FROM source_records sr
        WHERE sr.part_id IS NOT NULL
          AND (
            lower(sr.provider_part_key) LIKE $${paramIndex}
            OR lower(COALESCE(sr.source_url, '')) LIKE $${paramIndex}
          )
      )
      OR p.id IN (
        SELECT datasheet_asset.part_id
        FROM assets datasheet_asset
        WHERE datasheet_asset.part_id IS NOT NULL
          AND datasheet_asset.asset_type = 'datasheet'
          AND lower(COALESCE(datasheet_asset.source_url, '')) LIKE $${paramIndex}
      )
    )`;
}

/**
 * Builds the paged search identifier query. When a free-text query is active, relevance
 * ordering is used regardless of the caller's sort preference — queryText is appended as
 * the next parameter after the WHERE params, shifting LIMIT and OFFSET by one slot.
 */
function buildSearchPartIdsSql(searchFilter: SearchSqlFilter, sort: PartSearchSort): string {
  const hasRelevance = searchFilter.queryText !== null;
  const queryParamIndex = hasRelevance ? searchFilter.params.length + 1 : null;
  const limitParamIndex = searchFilter.params.length + (hasRelevance ? 2 : 1);
  const offsetParamIndex = searchFilter.params.length + (hasRelevance ? 3 : 2);

  return `
    SELECT p.id
    ${buildSearchFromSql(searchFilter.needsReadinessJoin, searchFilter.needsApprovalJoin)}
    ${searchFilter.whereSql}
    ${hasRelevance ? relevanceOrderByClause(queryParamIndex!) : searchOrderByClause(sort)}
    LIMIT $${limitParamIndex}::integer
    OFFSET $${offsetParamIndex}::integer
  `;
}

/**
 * Builds the matching count query. Uses the conditional FROM so the prs/pa joins are only
 * included when the active filter references them.
 */
function buildSearchCountSql(searchFilter: SearchSqlFilter): string {
  return `
    SELECT count(*)::text AS total_count
    ${buildSearchFromSql(searchFilter.needsReadinessJoin, searchFilter.needsApprovalJoin)}
    ${searchFilter.whereSql}
  `;
}

/**
 * Builds the grouped manufacturer facet query for the active SQL search filter.
 */
function buildSearchManufacturerFacetSql(whereSql: string): string {
  return `
    SELECT
      m.id,
      m.name,
      m.aliases,
      m.website,
      count(*)::text AS facet_count
    ${SEARCH_PART_FULL_FROM_SQL}
    ${whereSql}
    GROUP BY m.id, m.name, m.aliases, m.website
    ORDER BY lower(m.name) ASC
  `;
}

/**
 * Builds the grouped category facet query for the active SQL search filter.
 */
function buildSearchCategoryFacetSql(whereSql: string): string {
  return `
    SELECT
      p.category,
      count(*)::text AS facet_count
    ${SEARCH_PART_FULL_FROM_SQL}
    ${whereSql}
    GROUP BY p.category
    ORDER BY lower(p.category) ASC
  `;
}

/**
 * Builds the grouped package facet query for the active SQL search filter.
 */
function buildSearchPackageFacetSql(whereSql: string): string {
  return `
    SELECT
      pk.id,
      pk.package_name,
      pk.pin_count,
      pk.pitch_mm,
      pk.body_length_mm,
      pk.body_width_mm,
      pk.body_height_mm,
      count(*)::text AS facet_count
    ${SEARCH_PART_FULL_FROM_SQL}
    ${whereSql}
    GROUP BY pk.id, pk.package_name, pk.pin_count, pk.pitch_mm, pk.body_length_mm, pk.body_width_mm, pk.body_height_mm
    ORDER BY lower(pk.package_name) ASC
  `;
}

/**
 * Builds the grouped lifecycle facet query for the active SQL search filter.
 */
function buildSearchLifecycleFacetSql(whereSql: string): string {
  return `
    SELECT
      p.lifecycle_status,
      count(*)::text AS facet_count
    ${SEARCH_PART_FULL_FROM_SQL}
    ${whereSql}
    GROUP BY p.lifecycle_status
    ORDER BY p.lifecycle_status ASC
  `;
}

/**
 * Builds the grouped readiness facet query for the active SQL search filter.
 */
function buildSearchReadinessFacetSql(whereSql: string): string {
  return `
    SELECT
      COALESCE(prs.readiness_status, 'unknown') AS readiness_status,
      count(*)::text AS facet_count
    ${SEARCH_PART_FULL_FROM_SQL}
    ${whereSql}
    GROUP BY COALESCE(prs.readiness_status, 'unknown')
    ORDER BY COALESCE(prs.readiness_status, 'unknown') ASC
  `;
}

/**
 * Builds the grouped approval facet query for the active SQL search filter.
 */
function buildSearchApprovalFacetSql(whereSql: string): string {
  return `
    SELECT
      COALESCE(pa.approval_status, 'not_requested') AS approval_status,
      count(*)::text AS facet_count
    ${SEARCH_PART_FULL_FROM_SQL}
    ${whereSql}
    GROUP BY COALESCE(pa.approval_status, 'not_requested')
    ORDER BY COALESCE(pa.approval_status, 'not_requested') ASC
  `;
}

/**
 * Builds the grouped connector-class facet query for the active SQL search filter.
 */
function buildSearchConnectorClassFacetSql(whereSql: string): string {
  return `
    SELECT
      scoped.connector_class,
      count(*)::text AS facet_count
    FROM (
      SELECT
        COALESCE(prs.connector_class, CASE
          WHEN lower(p.category) LIKE '%tooling%' THEN 'tooling'
          WHEN lower(p.category) LIKE '%cable%' THEN 'cable'
          WHEN lower(p.category) LIKE '%accessory%' THEN 'accessory'
          WHEN p.connector_family_id IS NOT NULL OR lower(p.category) LIKE '%connector%' THEN 'connector'
          ELSE 'non_connector'
        END) AS connector_class
      ${SEARCH_PART_FULL_FROM_SQL}
      ${whereSql}
    ) scoped
    GROUP BY scoped.connector_class
    ORDER BY scoped.connector_class ASC
  `;
}

/**
 * Counts distinct parts that satisfy the same verified CAD predicate used by search filters.
 */
function buildSearchCadAvailableCountSql(whereSql: string): string {
  return `
    SELECT count(DISTINCT p.id)::text AS available_count
    ${SEARCH_PART_FULL_FROM_SQL}
    JOIN assets cad ON cad.part_id = p.id
      AND cad.asset_type IN ('footprint', 'symbol', 'three_d_model')
      AND cad.availability_status = 'validated'
      AND cad.export_status = 'verified_for_export'
      AND cad.storage_key IS NOT NULL
      AND cad.file_hash IS NOT NULL
      AND cad.validation_status = 'verified'
    ${whereSql}
  `;
}

/**
 * Builds a parameterized WHERE clause from present filters only.
 * Exported for tests so structural assertions on the SQL can codify which trigram indexes
 * the WHERE clause depends on (migrations 019 and 021).
 */
export function buildSearchSqlFilterForTests(filters: PartSearchFilters, cadAvailability: PartSearchFilters["cadAvailability"]): SearchSqlFilter {
  return buildSearchSqlFilter(filters, cadAvailability);
}

/**
 * Builds a parameterized WHERE clause from present filters only.
 */
function buildSearchSqlFilter(filters: PartSearchFilters, cadAvailability: PartSearchFilters["cadAvailability"]): SearchSqlFilter {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const queryPattern = buildSearchQueryPattern(filters.query);
  const queryTokens = buildSearchQueryTokens(filters.query);
  const queryText = filters.query?.trim().toLowerCase() || null;

  if (queryPattern) {
    params.push(queryPattern);
    const phraseParamIndex = params.length;
    const includeCompactPhraseSearch = shouldUseCompactSearch(filters.query);
    const tokenClauses = queryTokens.length > 1
      ? queryTokens.map((token) => {
          const tokenAlternates = buildSearchTokenAlternates(token).map((alternate) => `%${alternate}%`);
          const alternateClauses = tokenAlternates.map((alternatePattern) => {
            params.push(alternatePattern);
            return buildSearchLikeClause(params.length, { includeCompactSearch: shouldUseCompactSearch(alternatePattern) });
          });

          return alternateClauses.length > 1 ? `(${alternateClauses.join("\n        OR ")})` : alternateClauses[0] ?? "FALSE";
        })
      : [];
    // The source_records and datasheet asset branches use non-correlated IN-subqueries instead of
    // correlated EXISTS so PostgreSQL pre-filters those tables on the trigram-indexed LIKE
    // (idx_source_records_provider_part_key_trgm) once, then performs a hash semi-join back to parts —
    // rather than running the inner LIKE per candidate part row. Direct LIKE columns stay on the
    // OR-chain to ride trigram indexes on parts.mpn, parts.category, manufacturers.name, etc.
    // Multi-word searches keep the phrase branch and add an all-tokens branch for separator-heavy
    // engineering queries such as "TPS7A02 DBVR" or "JST PH 2P".
    clauses.push(tokenClauses.length > 0
      ? `(${buildSearchLikeClause(phraseParamIndex, { includeCompactSearch: includeCompactPhraseSearch })} OR (${tokenClauses.join("\n      AND ")}))`
      : buildSearchLikeClause(phraseParamIndex, { includeCompactSearch: includeCompactPhraseSearch }));
  }

  appendTextFilterClause(clauses, params, "p.manufacturer_id", filters.manufacturerId);
  appendTextFilterClause(clauses, params, "p.category", filters.category);
  appendTextFilterClause(clauses, params, "p.package_id", filters.packageId);
  appendTextFilterClause(clauses, params, "p.lifecycle_status", filters.lifecycleStatus);
  appendTextFilterClause(clauses, params, "COALESCE(prs.readiness_status, 'unknown')", filters.readinessStatus);
  appendTextFilterClause(clauses, params, "COALESCE(pa.approval_status, 'not_requested')", filters.approvalStatus);
  appendTextFilterClause(
    clauses,
    params,
    `COALESCE(prs.connector_class, CASE
      WHEN lower(p.category) LIKE '%tooling%' THEN 'tooling'
      WHEN lower(p.category) LIKE '%cable%' THEN 'cable'
      WHEN lower(p.category) LIKE '%accessory%' THEN 'accessory'
      WHEN p.connector_family_id IS NOT NULL OR lower(p.category) LIKE '%connector%' THEN 'connector'
      ELSE 'non_connector'
    END)`,
    filters.connectorClass
  );
  appendPartIdLikeClause(clauses, params, "source_records sr", "sr.part_id", undefined, "lower(sr.provider_part_key)", filters.providerPartId);
  appendPartIdLikeClause(clauses, params, "source_records sr", "sr.part_id", undefined, "lower(COALESCE(sr.source_url, ''))", filters.providerUrl);
  appendPartIdLikeClause(
    clauses,
    params,
    "assets datasheet_asset",
    "datasheet_asset.part_id",
    "datasheet_asset.asset_type = 'datasheet'",
    "lower(COALESCE(datasheet_asset.source_url, ''))",
    filters.datasheetUrl
  );

  if (cadAvailability === "available") {
    clauses.push(`p.id IN (${CAD_READY_PART_IDS_SQL})`);
  }

  if (cadAvailability === "unavailable") {
    clauses.push(`p.id NOT IN (${CAD_READY_PART_IDS_SQL})`);
  }

  return {
    needsApprovalJoin: !!filters.approvalStatus?.trim(),
    needsReadinessJoin: !!(filters.readinessStatus?.trim() || filters.connectorClass?.trim()),
    params,
    queryText,
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join("\n    AND ")}` : ""
  };
}

/**
 * Detects when compact field matching is useful for separator-heavy engineering text.
 */
function shouldUseCompactSearch(value: string | undefined): boolean {
  const normalizedValue = value?.trim().toLowerCase() ?? "";

  return /[a-z][0-9]|[0-9][a-z]|[-_\s/.]/u.test(normalizedValue);
}

/**
 * Appends one exact-match text filter when a URL parameter has a useful value.
 */
function appendTextFilterClause(clauses: string[], params: unknown[], columnName: string, value: string | undefined): void {
  if (!value || value.trim().length === 0) {
    return;
  }

  params.push(value);
  clauses.push(`${columnName} = $${params.length}`);
}

/**
 * Appends a part-id subquery + LIKE clause for provider keys or stored URLs.
 */
function appendPartIdLikeClause(
  clauses: string[],
  params: unknown[],
  tableExpression: string,
  partIdColumn: string,
  staticPredicate: string | undefined,
  columnName: string,
  value: string | undefined
): void {
  const normalizedValue = value?.trim().toLowerCase();

  if (!normalizedValue) {
    return;
  }

  params.push(`%${normalizedValue}%`);
  // Non-correlated IN-subquery so the planner can pre-filter the joined table on the
  // trigram-indexed LIKE expression first, then hash-join back to parts.id. Correlated EXISTS
  // re-runs the inner predicate per candidate part row, which dominates query time at scale.
  clauses.push(`
    p.id IN (
      SELECT ${partIdColumn}
      FROM ${tableExpression}
      WHERE ${partIdColumn} IS NOT NULL
        ${staticPredicate ? `AND ${staticPredicate}` : ""}
        AND ${columnName} LIKE $${params.length}
    )
  `);
}

/**
 * Maps a typed sort value into a fixed SQL ordering with deterministic tie-breaks.
 */
function searchOrderByClause(sort: PartSearchSort): string {
  if (sort === "updated_desc") {
    return "ORDER BY p.last_updated_at DESC, lower(p.mpn) ASC, p.id ASC";
  }

  if (sort === "trust_desc") {
    return "ORDER BY p.trust_score DESC, lower(p.mpn) ASC, p.id ASC";
  }

  if (sort === "mpn_desc") {
    return "ORDER BY lower(p.mpn) DESC, p.id DESC";
  }

  return "ORDER BY lower(p.mpn) ASC, p.id ASC";
}

/**
 * Builds a relevance ORDER BY clause that ranks results by how closely they match the
 * free-text query. The composite GREATEST() score picks the strongest matching signal:
 * Compact MPN scoring removes punctuation from both sides, so space- or dash-separated
 * user input can still rank the canonical contiguous MPN first.
 *
 *   1.5 — exact MPN match          (e.g. searching "LM358" finds part with mpn "LM358" first)
 *   1.2 — MPN prefix match         (e.g. "LM3" surfaces LM358, LM311, LM393 before unrelated parts)
 *   0–1 — trigram similarity(mpn)  (typo-tolerant, handles "LM35" vs "LM358")
 *   0–0.6 — similarity(mfr name)   (manufacturer name is a useful but secondary signal)
 *   0–0.4 — similarity(category)   (category is the weakest signal; used as a tiebreaker)
 *
 * Within the same relevance bucket, trust_score is the next tiebreaker so that better-curated
 * parts surface before low-confidence imports. Alphabetical MPN + id provide final stability.
 *
 * queryParamIndex is the SQL parameter index ($N) that holds the raw lowercased query text.
 */
function relevanceOrderByClause(queryParamIndex: number): string {
  const compactMpnSql = buildCompactSearchSql("lower(p.mpn)");
  const compactQuerySql = buildCompactSearchSql(`$${queryParamIndex}::text`);

  return `
    ORDER BY
      GREATEST(
        CASE WHEN ${compactMpnSql} = ${compactQuerySql} THEN 1.65 ELSE 0 END,
        CASE WHEN lower(p.mpn) = $${queryParamIndex}                        THEN 1.5 ELSE 0 END,
        CASE WHEN ${compactMpnSql} LIKE (${compactQuerySql} || '%') THEN 1.35 ELSE 0 END,
        CASE WHEN lower(p.mpn) LIKE ($${queryParamIndex} || '%')            THEN 1.2 ELSE 0 END,
        similarity(lower(p.mpn),      $${queryParamIndex}),
        similarity(lower(m.name),     $${queryParamIndex}) * 0.6,
        similarity(lower(pk.package_name), $${queryParamIndex}) * 0.5,
        similarity(lower(COALESCE(cf.name, '')), $${queryParamIndex}) * 0.5,
        similarity(lower(p.category), $${queryParamIndex}) * 0.4
      ) DESC,
      p.trust_score DESC,
      lower(p.mpn) ASC,
      p.id ASC
  `;
}

/**
 * Removes common MPN separators in SQL for relevance ranking.
 * Nested replace() is intentionally used instead of regexp_replace() because pg-mem,
 * used by API unit tests, does not emulate PostgreSQL's regex replacement overloads.
 */
function buildCompactSearchSql(expression: string): string {
  return `replace(replace(replace(replace(replace(${expression}, '-', ''), ' ', ''), '_', ''), '/', ''), '.', '')`;
}

/**
 * CAD_READY_PART_IDS_SQL returns all part_ids whose assets satisfy the verified-file-backed
 * export predicate. It is non-correlated so the search WHERE clause can use it as
 * `p.id IN (...)` / `p.id NOT IN (...)`. The non-correlated form lets PostgreSQL's planner
 * compute the matching part_ids once via the assets indexes and hash-semi-join back to parts,
 * instead of re-evaluating the inner predicate per outer candidate row. The `part_id IS NOT
 * NULL` predicate keeps `NOT IN` safe under SQL three-valued logic.
 */
const CAD_READY_PART_IDS_SQL = `
  SELECT cad.part_id
  FROM assets cad
  WHERE cad.part_id IS NOT NULL
    AND cad.asset_type IN ('footprint', 'symbol', 'three_d_model')
    AND cad.availability_status = 'validated'
    AND cad.export_status = 'verified_for_export'
    AND cad.storage_key IS NOT NULL
    AND cad.file_hash IS NOT NULL
    AND cad.validation_status = 'verified'
`;

/**
 * Builds the FROM clause for count/IDs search queries. The prs and pa LEFT JOINs are
 * omitted when the active WHERE clause doesn't reference them — eliminating a 600k-row
 * join on every unfiltered search. Facet builders always pass true for both flags because
 * they group by readiness status, connector class, and approval status unconditionally.
 */
function buildSearchFromSql(needsReadinessJoin: boolean, needsApprovalJoin: boolean): string {
  return `
  FROM parts p
  JOIN manufacturers m ON m.id = p.manufacturer_id
  JOIN packages pk ON pk.id = p.package_id
  LEFT JOIN connector_families cf ON cf.id = p.connector_family_id
  ${needsReadinessJoin ? "LEFT JOIN part_readiness_summaries prs ON prs.part_id = p.id" : ""}
  ${needsApprovalJoin ? "LEFT JOIN part_approvals pa ON pa.part_id = p.id" : ""}
  `;
}

/** SEARCH_PART_FULL_FROM_SQL is the full join chain used by facet queries that always need prs and pa. */
const SEARCH_PART_FULL_FROM_SQL = buildSearchFromSql(true, true);

/** PART_ROWS_SQL reads canonical parts with manufacturer and package joins. */
const PART_ROWS_SQL = `
  SELECT
    p.id AS part_id,
    p.mpn,
    p.description,
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
  -- org filter is placed before the id-list OR-group so pg-mem's planner handles the multi-join
  -- (its "lookups on joins" limit trips when an OR-group precedes the AND across these joins).
  WHERE p.org_id = $2
    AND ($1::text[] IS NULL OR p.id = ANY($1::text[]))
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
    preview_artifact_storage_key,
    preview_artifact_format,
    preview_artifact_generated_at,
    preview_artifact_source,
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
    compatibility_status,
    evidence_kind,
    confidence_score,
    source_revision_id,
    source_record_id,
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
    compatibility_status,
    evidence_kind,
    confidence_score,
    source_revision_id,
    source_record_id,
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
    wire_gauge_min,
    wire_gauge_max,
    shielding_requirement,
    termination_style,
    compatibility_status,
    confidence_score,
    source_revision_id,
    source_record_id,
    notes
  FROM cable_compatibilities
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY confidence_score DESC, id ASC
`;

/** CONNECTOR_FAMILY_CONFLICT_ROWS_SQL reads persisted connector-family ambiguity rows. */
const CONNECTOR_FAMILY_CONFLICT_ROWS_SQL = `
  SELECT
    id,
    part_id,
    candidate_part_id,
    candidate_connector_family_id,
    conflict_type,
    confidence_score,
    summary,
    detail,
    source_record_id,
    last_updated_at
  FROM connector_family_conflicts
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

/** ASSET_VALIDATION_ROWS_SQL reads durable validation evidence for asset trust decisions. */
const ASSET_VALIDATION_ROWS_SQL = `
  SELECT
    id,
    part_id,
    asset_id,
    validation_status,
    validation_type,
    validation_notes,
    validated_at,
    validator,
    last_updated_at
  FROM asset_validation_records
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY validated_at DESC, id DESC
`;

/** ASSET_PROMOTION_AUDIT_ROWS_SQL reads explicit export-promotion attempts. */
const ASSET_PROMOTION_AUDIT_ROWS_SQL = `
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
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY created_at DESC, id DESC
`;

/** PART_READINESS_SUMMARY_ROWS_SQL reads persisted whole-part readiness projections. */
const PART_READINESS_SUMMARY_ROWS_SQL = `
  SELECT
    part_id,
    readiness_status,
    identity_status,
    connector_class,
    blocker_count,
    blocker_summary,
    recommended_actions,
    detail,
    last_evaluated_at
  FROM part_readiness_summaries
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
`;

/** PART_APPROVAL_ROWS_SQL reads persisted whole-part approval projections. */
const PART_APPROVAL_ROWS_SQL = `
  SELECT
    part_id,
    approval_status,
    summary,
    detail,
    evidence,
    decided_by,
    decided_at,
    last_updated_at
  FROM part_approvals
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
`;

/** PART_ISSUE_ROWS_SQL reads backend-derived part issue rows. */
const PART_ISSUE_ROWS_SQL = `
  SELECT
    id,
    part_id,
    issue_code,
    severity,
    status,
    assigned_to,
    resolution_notes,
    resolved_at,
    summary,
    detail,
    source,
    last_updated_at
  FROM part_issues
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY severity ASC, summary ASC, id ASC
`;

/** PART_DUPLICATE_CANDIDATE_ROWS_SQL reads DB-backed duplicate candidates from canonical part rows. */
const PART_DUPLICATE_CANDIDATE_ROWS_SQL = `
  SELECT
    (
      'duplicate-' ||
      CASE WHEN p.id <= candidate.id THEN p.id ELSE candidate.id END ||
      '-' ||
      CASE WHEN p.id <= candidate.id THEN candidate.id ELSE p.id END
    ) AS id,
    p.id AS part_id,
    candidate.id AS duplicate_part_id,
    candidate.mpn AS duplicate_part_mpn,
    duplicate_manufacturer.name AS duplicate_manufacturer_name,
    'mpn_package_match' AS detection_source,
    (CASE WHEN p.manufacturer_id = candidate.manufacturer_id THEN 0.98 ELSE 0.82 END)::text AS confidence_score,
    (CASE
      WHEN p.manufacturer_id = candidate.manufacturer_id THEN 'Same manufacturer, MPN, and package match an existing record.'
      ELSE 'Same MPN and package match another catalog record across manufacturers.'
    END) AS summary,
    (CASE
      WHEN p.manufacturer_id = candidate.manufacturer_id THEN 'This part shares manufacturer, MPN, and package with another record, so duplicate review is required before trusting both records as canonical.'
      ELSE 'This part shares MPN and package with another catalog record under a different manufacturer normalization, so duplicate review is required.'
    END) AS detail,
    CASE
      WHEN p.last_updated_at >= candidate.last_updated_at THEN p.last_updated_at
      ELSE candidate.last_updated_at
    END AS last_updated_at
  FROM parts p
  JOIN parts candidate
    ON candidate.id <> p.id
    AND lower(candidate.mpn) = lower(p.mpn)
    AND candidate.package_id = p.package_id
  JOIN manufacturers duplicate_manufacturer ON duplicate_manufacturer.id = candidate.manufacturer_id
  WHERE ($1::text[] IS NULL OR p.id = ANY($1::text[]))
  ORDER BY part_id ASC, confidence_score DESC, duplicate_part_mpn ASC, duplicate_part_id ASC
`;

/** SOURCE_RECONCILIATION_ROWS_SQL reads persisted source-conflict reconciliation records. */
const SOURCE_RECONCILIATION_ROWS_SQL = `
  SELECT
    part_id,
    preferred_source_record_id,
    resolution_status,
    notes,
    updated_by,
    updated_at
  FROM part_source_reconciliations
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
`;

/** PART_RISK_FLAG_ROWS_SQL reads backend-derived part risk flag rows. */
const PART_RISK_FLAG_ROWS_SQL = `
  SELECT
    id,
    part_id,
    risk_code,
    label,
    detail,
    tone,
    last_updated_at
  FROM part_risk_flags
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY tone ASC, label ASC, id ASC
`;

/**
 * ENGINEERING_MEMORY_WARNING_ROWS_SQL reads confirmed, unresolved "this bit us / blocking"
 * private engineering memory for the queried parts. Blocking rows sort first, then most recent,
 * so a bounded preview is meaningful at scan time.
 */
const ENGINEERING_MEMORY_WARNING_ROWS_SQL = `
  SELECT
    per.part_id AS part_id,
    per.id AS record_id,
    per.record_kind AS record_kind,
    per.severity AS severity,
    per.outcome AS outcome,
    per.title AS title
  FROM part_engineering_records per
  WHERE ($1::text[] IS NULL OR per.part_id = ANY($1::text[]))
    AND per.draft_status = 'confirmed'
    AND per.resolved_at IS NULL
    AND (per.outcome = 'bit_us' OR per.severity = 'blocking')
  ORDER BY CASE WHEN per.severity = 'blocking' THEN 0 ELSE 1 END, per.recorded_at DESC, per.id ASC
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
    source_last_seen_at,
    source_last_imported_at,
    import_status,
    import_error_details,
    last_updated_at
  FROM source_records
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY source_last_seen_at DESC, id ASC
`;

/** SOURCE_EXTRACTION_SIGNAL_ROWS_SQL reads structured CAD-recovery source signals. */
const SOURCE_EXTRACTION_SIGNAL_ROWS_SQL = `
  SELECT
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
  FROM source_extraction_signals
  WHERE ($1::text[] IS NULL OR part_id = ANY($1::text[]))
  ORDER BY confidence_score DESC, last_updated_at DESC, id ASC
`;
