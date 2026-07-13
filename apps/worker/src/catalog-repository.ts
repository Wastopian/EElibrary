/**
 * File header: Persists provider-neutral normalized records into Postgres.
 */

import { Pool, type PoolClient } from "pg";
import { deriveAssetState, withCanonicalAssetTruth } from "@ee-library/shared/asset-state";
import { buildBuildableMatingSet, getConnectorRelationEffectiveConfidence } from "@ee-library/shared/connector-intelligence";
import { derivePartProjection } from "@ee-library/shared/part-readiness";
import { findParamDefForSpecKey, getParameterDefs } from "@ee-library/shared/parameter-registry";
import { parseEngineeringValue, reconcileParameterSources, type ParameterContribution } from "@ee-library/shared/parameter-normalize";
import { resolvePartType } from "@ee-library/shared/part-type";
import { SUPPLY_OFFER_MISSING_FROM_PROVIDER_REASON } from "@ee-library/shared/supply-offers";
import { scopeEntityId } from "@ee-library/shared/tenant";
import type {
  AccessoryRequirement,
  Asset,
  AssetPromotionAuditRecord,
  AssetValidationRecord,
  CableCompatibility,
  CompanionRecommendation,
  ConnectorFamily,
  ConnectorFamilyConflict,
  DatasheetRevision,
  GenerationRequest,
  GenerationWorkflow,
  Manufacturer,
  MateRelation,
  Package,
  Part,
  PartDuplicateCandidate,
  PartIssue,
  PartMetric,
  PartSpecification,
  ProviderImportDiagnostic,
  ReviewRecord,
  SimilarPartRelation,
  SourceExtractionSignal,
  SourceImportStatus,
  SourceReconciliationRecord,
  SourceRecord
} from "@ee-library/shared/types";
import type { NormalizedProviderPart, NormalizedSupplyOffering, NormalizedSupplyPriceBreak, ProviderAdapter } from "./provider-adapters";

/**
 * DEFAULT_ORG_ID is the tenant a worker write is attributed to when no acquisition job supplies one
 * (e.g. the no-argument CLI ingest). Today every team is org-default; once org-on-signup lands the
 * acquisition job always carries the acting org.
 */
const DEFAULT_ORG_ID = "org-default";

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

/** ReferencedDatasheetCaptureInput carries the minimum official-source evidence needed to attach a referenced datasheet. */
export interface ReferencedDatasheetCaptureInput {
  /** Canonical part id receiving the datasheet evidence. */
  partId: string;
  /** Provider identifier used for deterministic asset/revision ids and provenance. */
  providerId: string;
  /** Provider-specific exact part key used for deterministic asset/revision ids. */
  providerPartKey: string;
  /** Source record that exposed the official datasheet reference. */
  sourceRecordId: string;
  /** Official provider-exposed datasheet URL. */
  sourceUrl: string;
  /** Capture timestamp used for asset, revision, and projection refresh rows. */
  capturedAt: string;
}

/** ReferencedDatasheetCaptureResult reports which asset and revision now carry the referenced datasheet evidence. */
export interface ReferencedDatasheetCaptureResult {
  /** Datasheet asset id after persistence. */
  assetId: string;
  /** Datasheet revision id after persistence. */
  datasheetRevisionId: string;
  /** True when the helper updated an existing revision instead of creating a new placeholder. */
  reusedExistingRevision: boolean;
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
 * Returns the subset of the given part ids that have a canonical row, in one query.
 *
 * Replaces a per-endpoint `SELECT EXISTS` that, inside the five cross-part loops below,
 * issued up to 2 serial point-queries per relation — O(relations) round-trips per import.
 * One `id = ANY($1)` lookup keeps cross-part persistence O(1) round-trips regardless of fan-out.
 */
async function selectExistingPartIds(client: PoolClient, partIds: string[]): Promise<Set<string>> {
  const distinctIds = [...new Set(partIds)];

  if (distinctIds.length === 0) {
    return new Set<string>();
  }

  // Dynamic placeholder IN-list, not `id = ANY($1::text[])`: pg-mem's planner mis-handles
  // `pk = ANY($1::text[])` against primary-key columns and returns zero rows. The id set per
  // import is small and bounded, so the expanded IN-list is both safe and inexpensive.
  const placeholders = distinctIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query<{ id: string }>(`SELECT id FROM parts WHERE id IN (${placeholders})`, distinctIds);

  return new Set(result.rows.map((row) => row.id));
}

/**
 * Persists mate/accessory/cable/similar/companion edges only when both endpoints exist, then replays safely after a batch import.
 */
export async function persistCrossPartRelations(client: PoolClient, normalizedPart: NormalizedProviderPart): Promise<void> {
  const mateRelations = normalizedPart.mateRelations ?? [];
  const accessoryRequirements = normalizedPart.accessoryRequirements ?? [];
  const cableCompatibilities = normalizedPart.cableCompatibilities ?? [];
  const similarPartRelations = normalizedPart.similarPartRelations ?? [];
  const companionRecommendations = normalizedPart.companionRecommendations ?? [];

  // One round-trip resolves every endpoint referenced by all five edge types.
  const referencedPartIds = [
    ...mateRelations.flatMap((relation) => [relation.partId, relation.matePartId]),
    ...accessoryRequirements.flatMap((requirement) => [requirement.partId, requirement.accessoryPartId]),
    ...cableCompatibilities.flatMap((compatibility) => [compatibility.partId, compatibility.cablePartId]),
    ...similarPartRelations.flatMap((relation) => [relation.partId, relation.similarPartId]),
    ...companionRecommendations.flatMap((recommendation) => [recommendation.partId, recommendation.companionPartId])
  ];
  const existingPartIds = await selectExistingPartIds(client, referencedPartIds);

  for (const relation of mateRelations) {
    if (existingPartIds.has(relation.partId) && existingPartIds.has(relation.matePartId)) {
      await persistMateRelation(client, relation);
    }
  }

  for (const requirement of accessoryRequirements) {
    if (existingPartIds.has(requirement.partId) && existingPartIds.has(requirement.accessoryPartId)) {
      await persistAccessoryRequirement(client, requirement);
    }
  }

  for (const compatibility of cableCompatibilities) {
    if (existingPartIds.has(compatibility.partId) && existingPartIds.has(compatibility.cablePartId)) {
      await persistCableCompatibility(client, compatibility);
    }
  }

  for (const relation of similarPartRelations) {
    if (existingPartIds.has(relation.partId) && existingPartIds.has(relation.similarPartId)) {
      await persistSimilarPartRelation(client, relation);
    }
  }

  for (const recommendation of companionRecommendations) {
    if (existingPartIds.has(recommendation.partId) && existingPartIds.has(recommendation.companionPartId)) {
      await persistCompanionRecommendation(client, recommendation);
    }
  }
}

/**
 * Replays cross-part graph edges for every local-catalog row after a full ingest so housing-to-mate links persist once all endpoints exist.
 */
export async function replayLocalCatalogCrossPartRelations(adapter: ProviderAdapter): Promise<void> {
  const databasePool = getDatabasePool();
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    const requests = await adapter.listAvailablePartRequests();

    for (const request of requests) {
      const rawPayload = await adapter.fetchRawPart(request);
      const normalizedPart = adapter.normalizeRawPart(rawPayload);
      await persistCrossPartRelations(client, normalizedPart);
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
 * Persists a normalized provider part into canonical Postgres tables.
 */
export async function persistNormalizedPart(normalizedPart: NormalizedProviderPart, orgId: string = DEFAULT_ORG_ID): Promise<void> {
  const databasePool = getDatabasePool();
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    await persistNormalizedPartRows(client, normalizedPart, orgId);

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
  const attachedPartId = await persistSourceRecord(client, {
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

  // Stamp the failure source record's org: from its attached part if any, else the shared default
  // (a part-less failed import carries no tenant data). Keeps RLS-ready tables free of null org rows.
  const failureOrgId = attachedPartId ? await readPartOrgId(client, attachedPartId) : DEFAULT_ORG_ID;
  await client.query(
    "UPDATE source_records SET org_id = $1 WHERE id = $2 AND org_id IS NULL",
    [failureOrgId, buildSourceRecordId(input.providerId, input.providerPartKey)]
  );

  if (attachedPartId) {
    await refreshStoredPartProjectionRows(client, attachedPartId);
    await stampPartChildOrgIds(client, attachedPartId);
  }
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
 * Namespaces every org-scoped id (and cross-reference) in a normalized part to its owning org so two
 * teams importing the same provider part never collide on a primary key. Provider ids are derived
 * deterministically from provider/mpn slugs and are identical across orgs; without this, the second
 * org's import would hit `ON CONFLICT (id)` and silently cross-update the first org's rows.
 *
 * `org-default` keeps the historical unprefixed ids (this is a pure no-op for it, so existing data and
 * deterministic re-import/refresh are untouched). The **global taxonomy** — manufacturer, package,
 * connector-family — is intentionally left alone (those tables are shared across tenants), as are the
 * relation collections, which only the org-default seed/local-catalog provider ever populates. The real
 * distributor / JLC / Octopart import paths that non-default orgs use populate only the core
 * collections handled here.
 */
export function namespaceNormalizedPartIds(normalizedPart: NormalizedProviderPart, orgId: string): NormalizedProviderPart {
  if (orgId === DEFAULT_ORG_ID) {
    return normalizedPart;
  }

  const scope = (id: string): string => scopeEntityId(orgId, id);
  const scopeNullable = (id: string | null): string | null => (id === null ? null : scope(id));

  return {
    ...normalizedPart,
    // Global taxonomy (manufacturer / package / connectorFamily) and the relation collections are left
    // as-is on purpose; see the doc comment.
    part: { ...normalizedPart.part, id: scope(normalizedPart.part.id) },
    sourceRecord: {
      ...normalizedPart.sourceRecord,
      id: scope(normalizedPart.sourceRecord.id),
      partId: scopeNullable(normalizedPart.sourceRecord.partId)
    },
    assets: normalizedPart.assets.map((asset) => ({
      ...asset,
      id: scope(asset.id),
      partId: scope(asset.partId),
      sourceRecordId: scopeNullable(asset.sourceRecordId),
      generationSourceAssetId: scopeNullable(asset.generationSourceAssetId)
    })),
    datasheetRevisions: normalizedPart.datasheetRevisions.map((revision) => ({
      ...revision,
      id: scope(revision.id),
      partId: scope(revision.partId),
      sourceRecordId: scopeNullable(revision.sourceRecordId),
      fileAssetId: scopeNullable(revision.fileAssetId)
    })),
    metrics: normalizedPart.metrics.map((metric) => ({
      ...metric,
      id: scope(metric.id),
      partId: scope(metric.partId),
      sourceRecordId: scopeNullable(metric.sourceRecordId),
      sourceRevisionId: scope(metric.sourceRevisionId)
    })),
    specifications: (normalizedPart.specifications ?? []).map((specification) => ({
      ...specification,
      id: scope(specification.id),
      partId: scope(specification.partId),
      sourceRecordId: scopeNullable(specification.sourceRecordId)
    })),
    supplyOfferings: normalizedPart.supplyOfferings.map((offering) => ({
      ...offering,
      id: scope(offering.id),
      partId: scope(offering.partId),
      sourceRecordId: scope(offering.sourceRecordId),
      priceBreaks: offering.priceBreaks.map((priceBreak) => ({
        ...priceBreak,
        id: scope(priceBreak.id),
        supplyOfferingId: scope(priceBreak.supplyOfferingId)
      }))
    })),
    extractionSignals: normalizedPart.extractionSignals.map((signal) => ({
      ...signal,
      id: scope(signal.id),
      partId: scope(signal.partId),
      sourceRecordId: scopeNullable(signal.sourceRecordId),
      datasheetRevisionId: scopeNullable(signal.datasheetRevisionId),
      assetId: scopeNullable(signal.assetId)
    }))
  };
}

/**
 * Persists normalized rows using an existing transaction-capable client.
 */
export async function persistNormalizedPartRows(client: PoolClient, rawNormalizedPart: NormalizedProviderPart, orgId: string = DEFAULT_ORG_ID): Promise<void> {
  const normalizedPart = namespaceNormalizedPartIds(rawNormalizedPart, orgId);
  const previousPartIdentity = await readStoredPartIdentity(client, normalizedPart.part.id);

  await persistManufacturer(client, normalizedPart.manufacturer);
  await persistPackage(client, normalizedPart.package);

  if (normalizedPart.connectorFamily) {
    await persistConnectorFamily(client, normalizedPart.connectorFamily);
  }

  await persistPart(client, normalizedPart.part, orgId);
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

  await retireMissingMetrics(client, normalizedPart);
  await persistPartSpecifications(client, normalizedPart.part.id, normalizedPart.sourceRecord.providerId, normalizedPart.specifications ?? []);
  await persistPartParameters(client, normalizedPart.part, normalizedPart.part.lastUpdatedAt);

  for (const supplyOffering of normalizedPart.supplyOfferings) {
    await persistSupplyOffering(client, supplyOffering);
  }

  await retireMissingSupplyOfferings(client, normalizedPart);

  for (const signal of normalizedPart.extractionSignals) {
    await persistSourceExtractionSignal(client, signal);
  }

  await persistCrossPartRelations(client, normalizedPart);

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

  await persistPartProjectionRows(client, normalizedPart, previousPartIdentity);

  await stampPartChildOrgIds(client, normalizedPart.part.id);
}

/**
 * Stamps org_id on the part's just-written catalog child rows, using the part's own authoritative org
 * (persistPart preserves it across re-ingests, so children always follow their part regardless of
 * which caller is refreshing). Newly inserted rows have a null org_id; the `IS NULL` guard means a
 * re-ingest never re-owns an existing child. connector_family_conflicts is intentionally excluded: it
 * is a global family-level taxonomy.
 */
async function stampPartChildOrgIds(client: PoolClient, partId: string): Promise<void> {
  const orgId = await readPartOrgId(client, partId);
  const partChildTables = [
    "source_records",
    "assets",
    "datasheet_revisions",
    "part_metrics",
    "part_specifications",
    "part_parameters",
    "supply_offerings",
    "source_extraction_signals",
    "mate_relations",
    "accessory_requirements",
    "cable_compatibilities",
    "similar_part_relations",
    "companion_recommendations",
    "generation_workflows",
    "generation_requests",
    "review_records",
    "asset_validation_records",
    "asset_promotion_audits",
    "part_readiness_summaries",
    "part_approvals",
    "part_issues",
    "part_source_reconciliations",
    "part_risk_flags"
  ];

  for (const table of partChildTables) {
    // Table names are hardcoded constants, not user input.
    await client.query(`UPDATE ${table} SET org_id = $1 WHERE part_id = $2 AND org_id IS NULL`, [orgId, partId]);
  }

  // price_breaks hang off supply_offerings, which hang off the part.
  await client.query(
    `UPDATE price_breaks SET org_id = $1
       WHERE org_id IS NULL
         AND supply_offering_id IN (SELECT id FROM supply_offerings WHERE part_id = $2)`,
    [orgId, partId]
  );
}

/**
 * Attaches referenced datasheet evidence from an official provider URL and refreshes stored part projections.
 */
export async function captureReferencedDatasheetEvidenceForPart(
  client: PoolClient,
  input: ReferencedDatasheetCaptureInput
): Promise<ReferencedDatasheetCaptureResult> {
  const existingDatasheetAsset = await readLatestDatasheetAssetRow(client, input.partId);
  const existingDatasheetRevision = await readLatestDatasheetRevisionRow(client, input.partId);
  const assetId = existingDatasheetAsset?.id ?? buildDatasheetAssetId(input.providerId, input.providerPartKey);
  const assetState = deriveAssetState({
    fileHash: existingDatasheetAsset?.file_hash ?? null,
    sourceUrl: input.sourceUrl,
    storageKey: existingDatasheetAsset?.storage_key ?? null,
    validationStatus: existingDatasheetAsset?.validation_status ?? "not_validated"
  });
  const asset = withCanonicalAssetTruth({
    assetState,
    assetStatus: assetState,
    assetType: "datasheet",
    fileFormat: existingDatasheetAsset?.file_format ?? "pdf",
    fileHash: existingDatasheetAsset?.file_hash ?? null,
    generationMethod: existingDatasheetAsset?.generation_method ?? null,
    generationSourceAssetId: existingDatasheetAsset?.generation_source_asset_id ?? null,
    id: assetId,
    lastUpdatedAt: input.capturedAt,
    licenseMode: existingDatasheetAsset?.license_mode ?? "metadata_only",
    partId: input.partId,
    previewArtifactFormat: existingDatasheetAsset?.preview_artifact_format ?? null,
    previewArtifactGeneratedAt: existingDatasheetAsset?.preview_artifact_generated_at
      ? toIsoTimestamp(existingDatasheetAsset.preview_artifact_generated_at)
      : null,
    previewArtifactSource: existingDatasheetAsset?.preview_artifact_source ?? null,
    previewArtifactStorageKey: existingDatasheetAsset?.preview_artifact_storage_key ?? null,
    previewStatus: existingDatasheetAsset?.preview_status ?? "not_available",
    providerId: existingDatasheetAsset?.provider_id ?? input.providerId,
    provenance: existingDatasheetAsset?.provenance ?? "trusted_external",
    sourceRecordId: input.sourceRecordId,
    sourceUrl: input.sourceUrl,
    storageKey: existingDatasheetAsset?.storage_key ?? null,
    validationStatus: existingDatasheetAsset?.validation_status ?? "not_validated"
  });
  const datasheetRevision: DatasheetRevision = existingDatasheetRevision
    ? {
        fileAssetId: assetId,
        id: existingDatasheetRevision.id,
        lastUpdatedAt: input.capturedAt,
        pageCount: existingDatasheetRevision.page_count,
        parseConfidence: Number(existingDatasheetRevision.parse_confidence),
        partId: input.partId,
        pinTableStatus: existingDatasheetRevision.pin_table_status,
        revisionDate: existingDatasheetRevision.revision_date ? toIsoDate(existingDatasheetRevision.revision_date) : null,
        revisionLabel: existingDatasheetRevision.revision_label,
        sourceRecordId: input.sourceRecordId
      }
    : {
        fileAssetId: assetId,
        id: buildDatasheetRevisionId(input.providerId, input.providerPartKey),
        lastUpdatedAt: input.capturedAt,
        pageCount: null,
        parseConfidence: 0,
        partId: input.partId,
        pinTableStatus: "not_available",
        revisionDate: null,
        revisionLabel: "Captured datasheet reference",
        sourceRecordId: input.sourceRecordId
      };

  await persistAsset(client, asset);
  await persistDatasheetRevision(client, datasheetRevision);
  await refreshStoredPartProjectionRows(client, input.partId);
  await stampPartChildOrgIds(client, input.partId);

  return {
    assetId,
    datasheetRevisionId: datasheetRevision.id,
    reusedExistingRevision: Boolean(existingDatasheetRevision)
  };
}

/** Reads the org that owns a part, defaulting to the shared org when the part is missing/unstamped. */
async function readPartOrgId(client: PoolClient, partId: string): Promise<string> {
  const result = await client.query<{ org_id: string | null }>("SELECT org_id FROM parts WHERE id = $1 LIMIT 1", [partId]);
  return result.rows[0]?.org_id ?? DEFAULT_ORG_ID;
}

/** DownloadedDatasheetInput carries file evidence to persist after a successful datasheet download. */
export interface DownloadedDatasheetInput {
  /** Canonical part id whose datasheet asset should be advanced to downloaded state. */
  partId: string;
  /** Storage key under which the file was written. */
  storageKey: string;
  /** Hex-encoded SHA-256 hash of the downloaded bytes. */
  fileHash: string;
  /** Official provider URL the file was fetched from. */
  sourceUrl: string;
  /** Timestamp of the download completion. */
  updatedAt: string;
}

/** DownloadedDatasheetResult reports the asset id after persisting the downloaded state. */
export interface DownloadedDatasheetResult {
  /** Id of the datasheet asset that was advanced to downloaded state. */
  assetId: string;
}

/**
 * Advances an existing datasheet asset to downloaded state with stored file evidence.
 * Throws when no datasheet asset exists for the part — acquisition must run first.
 */
export async function markDatasheetAssetAsDownloaded(
  client: PoolClient,
  input: DownloadedDatasheetInput
): Promise<DownloadedDatasheetResult> {
  const existingAsset = await readLatestDatasheetAssetRow(client, input.partId);

  if (!existingAsset) {
    throw new Error(
      `No datasheet asset found for part ${input.partId} — acquisition must run before download enrichment.`
    );
  }

  await client.query(
    `
      UPDATE assets
      SET
        storage_key = $1,
        file_hash = $2,
        source_url = $3,
        availability_status = 'downloaded',
        asset_status = 'downloaded',
        asset_state = 'downloaded',
        last_updated_at = $4
      WHERE id = $5
    `,
    [input.storageKey, input.fileHash, input.sourceUrl, input.updatedAt, existingAsset.id]
  );

  return { assetId: existingAsset.id };
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

/** ReadinessRecomputeSummary reports the outcome of a bulk readiness recompute run. */
export interface ReadinessRecomputeSummary {
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  failedPartIds: string[];
  batchCount: number;
}

/** PartRecomputeHandler is the per-part refresh function, injectable for tests. */
type PartRecomputeHandler = (client: PoolClient, partId: string) => Promise<void>;

let partRecomputeHandler: PartRecomputeHandler = (client, partId) =>
  refreshStoredPartProjectionRows(client, partId);

/**
 * Replaces the per-part recompute handler for tests that do not need the full schema.
 */
export function setPartRecomputeHandlerForTests(handler: PartRecomputeHandler | null): void {
  partRecomputeHandler = handler ?? ((client, partId) => refreshStoredPartProjectionRows(client, partId));
}

/**
 * Pages through all parts and refreshes each stored readiness projection row.
 * Continues on per-part errors, accumulating failed part IDs for the caller.
 */
export async function recomputeReadinessForAllParts(
  batchSize: number,
  since?: string,
  onBatchProgress?: (progress: Omit<ReadinessRecomputeSummary, "failedPartIds">) => void
): Promise<ReadinessRecomputeSummary> {
  const databasePool = getDatabasePool();
  let cursorLastUpdatedAt: string | null = null;
  let cursorId: string | null = null;
  let processedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;
  const failedPartIds: string[] = [];
  let batchCount = 0;

  for (;;) {
    const rows = await listPartIdsForRecompute(databasePool, batchSize, since ?? null, cursorLastUpdatedAt, cursorId);

    if (rows.length === 0) {
      break;
    }

    batchCount += 1;

    for (const row of rows) {
      const client = await databasePool.connect();

      try {
        await partRecomputeHandler(client, row.id);
        succeededCount += 1;
      } catch {
        failedCount += 1;
        failedPartIds.push(row.id);
      } finally {
        client.release();
        processedCount += 1;
      }
    }

    const lastRow = rows[rows.length - 1];
    cursorLastUpdatedAt = lastRow?.lastUpdatedAt ?? null;
    cursorId = lastRow?.id ?? null;

    onBatchProgress?.({ batchCount, failedCount, processedCount, succeededCount });

    if (rows.length < batchSize) {
      break;
    }
  }

  return { batchCount, failedCount, failedPartIds, processedCount, succeededCount };
}

async function listPartIdsForRecompute(
  databasePool: Pool,
  limit: number,
  since: string | null,
  cursorLastUpdatedAt: string | null,
  cursorId: string | null
): Promise<{ id: string; lastUpdatedAt: string }[]> {
  const result = await databasePool.query<{ id: string; last_updated_at: string | Date }>(
    `
      SELECT id, last_updated_at
      FROM parts
      WHERE ($1::timestamptz IS NULL OR last_updated_at >= $1::timestamptz)
        AND (
          $2::timestamptz IS NULL
          OR last_updated_at > $2::timestamptz
          OR (last_updated_at = $2::timestamptz AND id > $3::text)
        )
      ORDER BY last_updated_at ASC, id ASC
      LIMIT $4
    `,
    [since, cursorLastUpdatedAt, cursorId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    lastUpdatedAt: row.last_updated_at instanceof Date ? row.last_updated_at.toISOString() : String(row.last_updated_at)
  }));
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
    connectionString: process.env.DATABASE_URL,
    // The worker is a trusted system component: its job claim is legitimately cross-org and every
    // write derives/preserves the owning org explicitly (persistPart ownership rules, org-threaded
    // acquisition jobs). It is therefore exempt from the RLS backstop, which guards interactive API
    // requests (migration 055). Only code already executing SQL can set this, so it does not weaken
    // the backstop against application query bugs.
    options: "-c app.rls_bypass=on"
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
async function persistPart(client: PoolClient, part: Part, orgId: string): Promise<void> {
  await client.query(
    `
      INSERT INTO parts (
        id,
        mpn,
        description,
        manufacturer_id,
        category,
        lifecycle_status,
        package_id,
        connector_family_id,
        trust_score,
        org_id,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        mpn = EXCLUDED.mpn,
        description = EXCLUDED.description,
        manufacturer_id = EXCLUDED.manufacturer_id,
        category = EXCLUDED.category,
        lifecycle_status = EXCLUDED.lifecycle_status,
        package_id = EXCLUDED.package_id,
        connector_family_id = EXCLUDED.connector_family_id,
        trust_score = EXCLUDED.trust_score,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    // org_id is intentionally NOT in the ON CONFLICT SET: a re-ingest must never change which org owns
    // an existing part. The acting org comes from the acquisition job (the worker has no request context).
    [part.id, part.mpn, part.description, part.manufacturerId, part.category, part.lifecycleStatus, part.packageId, part.connectorFamilyId, part.trustScore, orgId, part.lastUpdatedAt]
  );
}

/**
 * Reads the previously stored part identity fields so duplicate refresh can clean up stale matches.
 */
async function readStoredPartIdentity(
  client: PoolClient,
  partId: string
): Promise<{ mpn: string; packageId: string } | null> {
  const result = await client.query<{ mpn: string; package_id: string }>(
    `
      SELECT mpn, package_id
      FROM parts
      WHERE id = $1
      LIMIT 1
    `,
    [partId]
  );
  const row = result.rows[0];

  return row ? { mpn: row.mpn, packageId: row.package_id } : null;
}

/**
 * Upserts one raw provider source record.
 */
async function persistSourceRecord(client: PoolClient, sourceRecord: SourceRecord): Promise<string | null> {
  const result = await client.query<{ part_id: string | null }>(
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
      RETURNING part_id
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

  return result.rows[0]?.part_id ?? null;
}

/**
 * Upserts one asset registry row.
 */
async function persistAsset(client: PoolClient, asset: Asset): Promise<void> {
  const persistedPreviewState = normalizePreviewStateForPersistedAsset(asset);
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
        preview_artifact_storage_key,
        preview_artifact_format,
        preview_artifact_generated_at,
        preview_artifact_source,
        asset_state,
        source_url,
        source_record_id,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        asset_type = EXCLUDED.asset_type,
        file_format = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.file_format
          ELSE EXCLUDED.file_format
        END,
        storage_key = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.storage_key
          ELSE EXCLUDED.storage_key
        END,
        file_hash = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.file_hash
          ELSE EXCLUDED.file_hash
        END,
        provider_id = EXCLUDED.provider_id,
        license_mode = EXCLUDED.license_mode,
        provenance = EXCLUDED.provenance,
        availability_status = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.availability_status
          ELSE EXCLUDED.availability_status
        END,
        review_status = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.review_status
          ELSE EXCLUDED.review_status
        END,
        export_status = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.export_status
          ELSE EXCLUDED.export_status
        END,
        asset_status = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.asset_status
          ELSE EXCLUDED.asset_status
        END,
        generation_method = EXCLUDED.generation_method,
        generation_source_asset_id = EXCLUDED.generation_source_asset_id,
        validation_status = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.validation_status
          ELSE EXCLUDED.validation_status
        END,
        preview_status = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.preview_status
          ELSE EXCLUDED.preview_status
        END,
        preview_artifact_storage_key = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.preview_artifact_storage_key
          ELSE EXCLUDED.preview_artifact_storage_key
        END,
        preview_artifact_format = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.preview_artifact_format
          ELSE EXCLUDED.preview_artifact_format
        END,
        preview_artifact_generated_at = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.preview_artifact_generated_at
          ELSE EXCLUDED.preview_artifact_generated_at
        END,
        preview_artifact_source = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.preview_artifact_source
          ELSE EXCLUDED.preview_artifact_source
        END,
        asset_state = CASE
          WHEN EXCLUDED.storage_key IS NULL AND EXCLUDED.file_hash IS NULL AND (assets.storage_key IS NOT NULL OR assets.file_hash IS NOT NULL) THEN assets.asset_state
          ELSE EXCLUDED.asset_state
        END,
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
      persistedPreviewState.previewStatus,
      persistedPreviewState.previewArtifactStorageKey,
      persistedPreviewState.previewArtifactFormat,
      persistedPreviewState.previewArtifactGeneratedAt,
      persistedPreviewState.previewArtifactSource,
      asset.assetState,
      asset.sourceUrl,
      asset.sourceRecordId,
      asset.lastUpdatedAt
    ]
  );
}

/**
 * Keeps preview readiness honest at the worker write boundary.
 *
 * Two rules applied together:
 *   1. `previewStatus = 'ready'` is persisted only when previewable bytes actually exist in
 *      storage. Either the source `fileFormat` is itself directly embeddable AND locally stored,
 *      OR a derived preview artifact (`previewArtifactStorageKey`) has been generated. Otherwise
 *      `ready` is downgraded to `not_available` so the UI never advertises an inline preview that
 *      cannot be rendered.
 *   2. The artifact channel (`previewArtifactStorageKey` / `previewArtifactFormat` /
 *      `previewArtifactSource` / `previewArtifactGeneratedAt`) is cleared to null when the source
 *      file is missing or the asset has no previewable target. This prevents a stale artifact
 *      pointer from outliving the source row it described.
 */
function normalizePreviewStateForPersistedAsset(asset: Asset): {
  previewStatus: Asset["previewStatus"];
  previewArtifactStorageKey: Asset["previewArtifactStorageKey"];
  previewArtifactFormat: Asset["previewArtifactFormat"];
  previewArtifactGeneratedAt: Asset["previewArtifactGeneratedAt"];
  previewArtifactSource: Asset["previewArtifactSource"];
} {
  const hasStoredSource = (asset.availabilityStatus === "downloaded" || asset.availabilityStatus === "validated")
    && typeof asset.storageKey === "string"
    && asset.storageKey.length > 0;
  const sourceIsEmbeddable = isEmbeddableFileFormat(asset.fileFormat);
  const sourceCanBeReady = sourceIsEmbeddable && hasStoredSource;
  const artifactCanBeReady = typeof asset.previewArtifactStorageKey === "string"
    && asset.previewArtifactStorageKey.length > 0
    && asset.previewArtifactFormat !== null
    && asset.previewArtifactSource !== null;

  // When the source file is gone, neither the source nor a derived artifact is renderable; clear
  // the entire preview channel so a stale artifact pointer does not advertise rendering bytes
  // that no longer correspond to a real asset row.
  if (!hasStoredSource) {
    return {
      previewArtifactFormat: null,
      previewArtifactGeneratedAt: null,
      previewArtifactSource: null,
      previewArtifactStorageKey: null,
      previewStatus: asset.previewStatus === "ready" ? "not_available" : asset.previewStatus
    };
  }

  if (asset.previewStatus !== "ready") {
    // Non-ready states pass through with the artifact channel preserved (a worker may have
    // written a partial artifact while the previewStatus is still `pending` for review).
    return {
      previewArtifactFormat: asset.previewArtifactFormat,
      previewArtifactGeneratedAt: asset.previewArtifactGeneratedAt,
      previewArtifactSource: asset.previewArtifactSource,
      previewArtifactStorageKey: asset.previewArtifactStorageKey,
      previewStatus: asset.previewStatus
    };
  }

  if (sourceCanBeReady || artifactCanBeReady) {
    return {
      previewArtifactFormat: asset.previewArtifactFormat,
      previewArtifactGeneratedAt: asset.previewArtifactGeneratedAt,
      previewArtifactSource: asset.previewArtifactSource,
      previewArtifactStorageKey: asset.previewArtifactStorageKey,
      previewStatus: "ready"
    };
  }

  return {
    previewArtifactFormat: null,
    previewArtifactGeneratedAt: null,
    previewArtifactSource: null,
    previewArtifactStorageKey: null,
    previewStatus: "not_available"
  };
}

/**
 * Returns true for source file formats that can be rendered inline in a browser without a
 * conversion step. STEP / kicad_mod / kicad_sym / dxf are excluded so their preview path stays
 * gated on a derived artifact.
 */
function isEmbeddableFileFormat(fileFormat: Asset["fileFormat"]): boolean {
  return fileFormat === "pdf"
    || fileFormat === "png"
    || fileFormat === "jpg"
    || fileFormat === "jpeg"
    || fileFormat === "webp"
    || fileFormat === "glb"
    || fileFormat === "gltf";
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
 * Replaces this provider's normalized metric snapshot for the part.
 *
 * Metric ids can change when a provider payload changes shape, so upsert alone would leave retired
 * metrics behind. Parameters are derived from all stored metrics, which makes stale rows look current.
 */
async function retireMissingMetrics(client: PoolClient, normalizedPart: NormalizedProviderPart): Promise<void> {
  const metricIds = normalizedPart.metrics.map((metric) => metric.id);

  await client.query(
    `
      DELETE FROM part_metrics pm
      USING source_records sr
      WHERE pm.source_record_id = sr.id
        AND pm.part_id = $1
        AND sr.provider_id = $2
        AND NOT (pm.id = ANY($3::text[]))
    `,
    [normalizedPart.part.id, normalizedPart.sourceRecord.providerId, metricIds]
  );
}

/**
 * Replaces this part's specification rows for one provider with the latest verbatim snapshot.
 *
 * Spec rows are a display snapshot with no dependents, so a delete-then-insert per
 * (part_id, provider_id) is the honest behavior: the panel always shows exactly what the provider
 * returned on the most recent import, and stale rows never linger when a provider drops a label.
 * The delete keys on the provider from the source record so a re-import that returns no rows still
 * clears the old ones. Rows insert with a null org_id and are stamped by stampPartChildOrgIds.
 */
async function persistPartSpecifications(client: PoolClient, partId: string, providerId: string, specifications: PartSpecification[]): Promise<void> {
  await client.query("DELETE FROM part_specifications WHERE part_id = $1 AND provider_id = $2", [partId, providerId]);

  for (const specification of specifications) {
    await client.query(
      `
        INSERT INTO part_specifications (
          id,
          part_id,
          provider_id,
          source_record_id,
          spec_key,
          spec_value,
          spec_group,
          last_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        specification.id,
        specification.partId,
        specification.providerId,
        specification.sourceRecordId,
        specification.specKey,
        specification.specValue,
        specification.specGroup,
        specification.lastUpdatedAt
      ]
    );
  }
}

/** DISTRIBUTOR_SPEC_CONFIDENCE is the parse confidence assigned to a value read from a distributor spec. */
const DISTRIBUTOR_SPEC_CONFIDENCE = 0.6;

/** DatabaseSpecForReconciliation is the minimal spec row shape the parameter projection reads. */
interface DatabaseSpecForReconciliation {
  provider_id: string;
  source_record_id: string | null;
  spec_key: string;
  spec_value: string;
}

/** DatabaseMetricForReconciliation is the minimal metric row shape the parameter projection reads. */
interface DatabaseMetricForReconciliation {
  metric_key: string;
  metric_value: string | number | null;
  source_record_id: string | null;
  confidence_score: string | number | null;
  provider_id: string | null;
}

/**
 * Recomputes this part's normalized parameters from all of its stored specifications.
 *
 * This is a derived projection over part_specifications (like part_readiness_summaries over evidence),
 * recomputed on every import. It resolves the part type, maps each provider spec label onto a canonical
 * parameter, parses the verbatim value into a base unit, and reconciles the sources into one winning
 * value per parameter with an explicit conflict flag. Delete-then-insert per part keeps the set exactly
 * in step with the current specs. Rows insert with a null org_id and are stamped by stampPartChildOrgIds.
 */
async function persistPartParameters(client: PoolClient, part: Part, lastUpdatedAt: string): Promise<void> {
  await client.query("DELETE FROM part_parameters WHERE part_id = $1", [part.id]);

  const partType = resolvePartType(part);
  const specResult = await client.query<DatabaseSpecForReconciliation>(
    "SELECT provider_id, source_record_id, spec_key, spec_value FROM part_specifications WHERE part_id = $1",
    [part.id]
  );
  // Some parameters (notably resistance for passives) are only ever captured as normalized metrics --
  // e.g. parsed from a distributor description string -- and never appear as a verbatim spec row. The
  // registry's metricKeys let those metrics corroborate a parameter so the most important spec is not
  // dropped. The provider is resolved from the metric's source record so provenance stays honest.
  const metricResult = await client.query<DatabaseMetricForReconciliation>(
    `SELECT pm.metric_key, pm.metric_value, pm.source_record_id, pm.confidence_score, sr.provider_id
     FROM part_metrics pm
     LEFT JOIN source_records sr ON sr.id = pm.source_record_id
     WHERE pm.part_id = $1`,
    [part.id]
  );

  for (const def of getParameterDefs(partType)) {
    const contributions: ParameterContribution[] = [];

    for (const row of specResult.rows) {
      if (findParamDefForSpecKey(partType, row.spec_key)?.paramKey !== def.paramKey) {
        continue;
      }

      const typed = parseEngineeringValue(row.spec_value, def);

      if (!typed) {
        continue;
      }

      contributions.push({
        confidence: DISTRIBUTOR_SPEC_CONFIDENCE,
        providerId: row.provider_id,
        rawSpecKey: row.spec_key,
        rawValue: row.spec_value,
        sourceRecordId: row.source_record_id,
        typed
      });
    }

    for (const row of metricResult.rows) {
      if (def.valueKind !== "numeric" || !def.metricKeys.includes(row.metric_key) || row.metric_value === null) {
        continue;
      }

      const value = Number(row.metric_value);

      if (!Number.isFinite(value)) {
        continue;
      }

      contributions.push({
        confidence: row.confidence_score === null ? DISTRIBUTOR_SPEC_CONFIDENCE : Number(row.confidence_score),
        providerId: row.provider_id ?? "unknown",
        rawSpecKey: row.metric_key,
        rawValue: String(row.metric_value),
        sourceRecordId: row.source_record_id,
        typed: { kind: "numeric", unit: def.unit, value }
      });
    }

    const reconciled = reconcileParameterSources(contributions);

    if (!reconciled) {
      continue;
    }

    await client.query(
      `
        INSERT INTO part_parameters (
          id,
          part_id,
          part_type,
          param_key,
          value_kind,
          value_numeric,
          value_min,
          value_max,
          value_text,
          unit,
          is_conflicted,
          confidence_score,
          winning_provider_id,
          winning_source_record_id,
          sources,
          last_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16)
      `,
      [
        `param-${part.id}-${def.paramKey}`,
        part.id,
        partType,
        def.paramKey,
        reconciled.valueKind,
        reconciled.valueNumeric,
        reconciled.valueMin,
        reconciled.valueMax,
        reconciled.valueText,
        reconciled.unit,
        reconciled.isConflicted,
        reconciled.confidenceScore,
        reconciled.winningProviderId,
        reconciled.winningSourceRecordId,
        JSON.stringify(reconciled.sources),
        lastUpdatedAt
      ]
    );
  }
}

/**
 * Upserts one provider commercial offering and replaces its price tiers with the latest snapshot.
 */
async function persistSupplyOffering(client: PoolClient, offering: NormalizedSupplyOffering): Promise<void> {
  await client.query(
    `
      INSERT INTO supply_offerings (
        id,
        part_id,
        provider_id,
        source_record_id,
        provider_part_key,
        supplier_name,
        provider_sku,
        inventory_status,
        inventory_quantity,
        moq,
        lead_time_days,
        packaging,
        currency_code,
        preferred_rank,
        last_seen_at,
        retired_at,
        retirement_reason,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULL, NULL, $16, $17)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        provider_id = EXCLUDED.provider_id,
        source_record_id = EXCLUDED.source_record_id,
        provider_part_key = EXCLUDED.provider_part_key,
        supplier_name = EXCLUDED.supplier_name,
        provider_sku = EXCLUDED.provider_sku,
        inventory_status = EXCLUDED.inventory_status,
        inventory_quantity = EXCLUDED.inventory_quantity,
        moq = EXCLUDED.moq,
        lead_time_days = EXCLUDED.lead_time_days,
        packaging = EXCLUDED.packaging,
        currency_code = EXCLUDED.currency_code,
        preferred_rank = EXCLUDED.preferred_rank,
        last_seen_at = EXCLUDED.last_seen_at,
        retired_at = NULL,
        retirement_reason = NULL,
        created_at = supply_offerings.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [
      offering.id,
      offering.partId,
      offering.providerId,
      offering.sourceRecordId,
      offering.providerPartKey,
      offering.supplierName,
      offering.providerSku,
      offering.inventoryStatus,
      offering.inventoryQuantity,
      offering.moq,
      offering.leadTimeDays,
      offering.packaging,
      offering.currencyCode,
      offering.preferredRank,
      offering.lastSeenAt,
      offering.createdAt,
      offering.updatedAt
    ]
  );

  await client.query("DELETE FROM price_breaks WHERE supply_offering_id = $1", [offering.id]);

  for (const priceBreak of offering.priceBreaks) {
    await persistSupplyPriceBreak(client, priceBreak);
  }
}

/**
 * Retires active commercial rows from the same source record when the latest provider
 * snapshot no longer includes them. This keeps the audit trail while preventing old
 * offers from continuing to render as current sourcing context.
 */
async function retireMissingSupplyOfferings(client: PoolClient, normalizedPart: NormalizedProviderPart): Promise<void> {
  const activeOfferingIds = normalizedPart.supplyOfferings.map((offering) => offering.id);
  const retiredAt = normalizedPart.sourceRecord.sourceLastSeenAt ?? normalizedPart.part.lastUpdatedAt;

  try {
    await client.query(
      `
        UPDATE supply_offerings
        SET
          retired_at = $4,
          retirement_reason = $5,
          updated_at = $4
        WHERE part_id = $1
          AND source_record_id = $2
          AND retired_at IS NULL
          AND NOT (id = ANY($3::text[]))
      `,
      [
        normalizedPart.part.id,
        normalizedPart.sourceRecord.id,
        activeOfferingIds,
        retiredAt,
        SUPPLY_OFFER_MISSING_FROM_PROVIDER_REASON
      ]
    );
  } catch (error) {
    if (isSupplyOfferingRetirementSchemaMissing(error)) {
      return;
    }

    throw error;
  }
}

/**
 * Detects older deployments or narrow test schemas that predate supply-offer retirement columns.
 */
function isSupplyOfferingRetirementSchemaMissing(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);

  return code === "42P01" || code === "42703" || /relation "supply_offerings" does not exist|column .*retired_at/u.test(message);
}

/**
 * Inserts one price tier for a supply offering after the parent snapshot has been upserted.
 */
async function persistSupplyPriceBreak(client: PoolClient, priceBreak: NormalizedSupplyPriceBreak): Promise<void> {
  await client.query(
    `
      INSERT INTO price_breaks (
        id,
        supply_offering_id,
        min_quantity,
        unit_price,
        currency_code,
        captured_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        supply_offering_id = EXCLUDED.supply_offering_id,
        min_quantity = EXCLUDED.min_quantity,
        unit_price = EXCLUDED.unit_price,
        currency_code = EXCLUDED.currency_code,
        captured_at = EXCLUDED.captured_at
    `,
    [
      priceBreak.id,
      priceBreak.supplyOfferingId,
      priceBreak.minQuantity,
      priceBreak.unitPrice,
      priceBreak.currencyCode,
      priceBreak.capturedAt
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
        compatibility_status,
        evidence_kind,
        confidence_score,
        source_revision_id,
        source_record_id,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        mate_part_id = EXCLUDED.mate_part_id,
        relationship_type = EXCLUDED.relationship_type,
        compatibility_status = EXCLUDED.compatibility_status,
        evidence_kind = EXCLUDED.evidence_kind,
        confidence_score = EXCLUDED.confidence_score,
        source_revision_id = EXCLUDED.source_revision_id,
        source_record_id = EXCLUDED.source_record_id,
        notes = EXCLUDED.notes
    `,
    [
      relation.id,
      relation.partId,
      relation.matePartId,
      relation.relationshipType,
      relation.compatibilityStatus,
      relation.evidenceKind,
      relation.confidenceScore,
      relation.sourceRevisionId,
      relation.sourceRecordId,
      relation.notes
    ]
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
        compatibility_status,
        evidence_kind,
        confidence_score,
        source_revision_id,
        source_record_id,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        accessory_part_id = EXCLUDED.accessory_part_id,
        relationship_type = EXCLUDED.relationship_type,
        compatibility_status = EXCLUDED.compatibility_status,
        evidence_kind = EXCLUDED.evidence_kind,
        confidence_score = EXCLUDED.confidence_score,
        source_revision_id = EXCLUDED.source_revision_id,
        source_record_id = EXCLUDED.source_record_id,
        notes = EXCLUDED.notes
    `,
    [
      requirement.id,
      requirement.partId,
      requirement.accessoryPartId,
      requirement.relationshipType,
      requirement.compatibilityStatus,
      requirement.evidenceKind,
      requirement.confidenceScore,
      requirement.sourceRevisionId,
      requirement.sourceRecordId,
      requirement.notes
    ]
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
        wire_gauge_min,
        wire_gauge_max,
        shielding_requirement,
        termination_style,
        compatibility_status,
        confidence_score,
        source_revision_id,
        source_record_id,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        cable_part_id = EXCLUDED.cable_part_id,
        relationship_type = EXCLUDED.relationship_type,
        wire_gauge_min = EXCLUDED.wire_gauge_min,
        wire_gauge_max = EXCLUDED.wire_gauge_max,
        shielding_requirement = EXCLUDED.shielding_requirement,
        termination_style = EXCLUDED.termination_style,
        compatibility_status = EXCLUDED.compatibility_status,
        confidence_score = EXCLUDED.confidence_score,
        source_revision_id = EXCLUDED.source_revision_id,
        source_record_id = EXCLUDED.source_record_id,
        notes = EXCLUDED.notes
    `,
    [
      compatibility.id,
      compatibility.partId,
      compatibility.cablePartId,
      compatibility.relationshipType,
      compatibility.wireGaugeMin,
      compatibility.wireGaugeMax,
      compatibility.shieldingRequirement,
      compatibility.terminationStyle,
      compatibility.compatibilityStatus,
      compatibility.confidenceScore,
      compatibility.sourceRevisionId,
      compatibility.sourceRecordId,
      compatibility.notes
    ]
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
 * Builds a deterministic datasheet asset id for provider-backed datasheet references.
 */
function buildDatasheetAssetId(providerId: string, providerPartKey: string): string {
  return `asset-${slugify(providerId)}-${slugify(providerPartKey)}-datasheet`;
}

/**
 * Builds a deterministic datasheet revision id for provider-backed datasheet references.
 */
function buildDatasheetRevisionId(providerId: string, providerPartKey: string): string {
  return `dsr-${slugify(providerId)}-${slugify(providerPartKey)}`;
}

/**
 * Reads the latest datasheet asset row for one part so capture jobs can update or reuse it safely.
 */
async function readLatestDatasheetAssetRow(
  client: PoolClient,
  partId: string
): Promise<{
  id: string;
  file_format: Asset["fileFormat"];
  file_hash: string | null;
  generation_method: string | null;
  generation_source_asset_id: string | null;
  license_mode: Asset["licenseMode"];
  preview_status: Asset["previewStatus"];
  preview_artifact_storage_key: string | null;
  preview_artifact_format: Asset["previewArtifactFormat"];
  preview_artifact_generated_at: Date | string | null;
  preview_artifact_source: Asset["previewArtifactSource"];
  provider_id: string | null;
  provenance: Asset["provenance"];
  storage_key: string | null;
  validation_status: Asset["validationStatus"];
} | null> {
  const result = await client.query<{
    id: string;
    file_format: Asset["fileFormat"];
    file_hash: string | null;
    generation_method: string | null;
    generation_source_asset_id: string | null;
    license_mode: Asset["licenseMode"];
    preview_status: Asset["previewStatus"];
    preview_artifact_storage_key: string | null;
    preview_artifact_format: Asset["previewArtifactFormat"];
    preview_artifact_generated_at: Date | string | null;
    preview_artifact_source: Asset["previewArtifactSource"];
    provider_id: string | null;
    provenance: Asset["provenance"];
    storage_key: string | null;
    validation_status: Asset["validationStatus"];
  }>(
    `
      SELECT
        id,
        file_format,
        file_hash,
        generation_method,
        generation_source_asset_id,
        license_mode,
        preview_status,
        preview_artifact_storage_key,
        preview_artifact_format,
        preview_artifact_generated_at,
        preview_artifact_source,
        provider_id,
        provenance,
        storage_key,
        validation_status
      FROM assets
      WHERE part_id = $1
        AND asset_type = 'datasheet'
      ORDER BY last_updated_at DESC, id DESC
      LIMIT 1
    `,
    [partId]
  );

  return result.rows[0] ?? null;
}

/**
 * Reads the latest datasheet revision row for one part so capture jobs can attach the captured asset to it when possible.
 */
async function readLatestDatasheetRevisionRow(
  client: PoolClient,
  partId: string
): Promise<{
  id: string;
  page_count: number | null;
  parse_confidence: number | string;
  pin_table_status: DatasheetRevision["pinTableStatus"];
  revision_date: Date | string | null;
  revision_label: string;
} | null> {
  const result = await client.query<{
    id: string;
    page_count: number | null;
    parse_confidence: number | string;
    pin_table_status: DatasheetRevision["pinTableStatus"];
    revision_date: Date | string | null;
    revision_label: string;
  }>(
    `
      SELECT
        id,
        page_count,
        parse_confidence,
        pin_table_status,
        revision_date,
        revision_label
      FROM datasheet_revisions
      WHERE part_id = $1
      ORDER BY revision_date DESC NULLS LAST, last_updated_at DESC, id DESC
      LIMIT 1
    `,
    [partId]
  );

  return result.rows[0] ?? null;
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
 * Converts a database date or timestamp into an ISO date string for persisted datasheet revision metadata.
 */
function toIsoDate(value: Date | string): string {
  return toIsoTimestamp(value).slice(0, 10);
}

/**
 * Converts ids and lookup keys into deterministic lowercase key fragments.
 */
function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "unknown";
}

/**
 * Formats one mate relation label for concise persisted conflict summaries.
 */
function formatMateRelationLabel(relationshipType: MateRelation["relationshipType"]): string {
  return relationshipType === "best_mate" ? "Best mate" : "Alternate mate";
}

/**
 * Formats connector evidence kinds for concise persisted conflict details.
 */
function formatConnectorEvidenceLabel(evidenceKind: MateRelation["evidenceKind"]): string {
  switch (evidenceKind) {
    case "provider_direct":
      return "direct provider-backed";
    case "datasheet_reference":
      return "datasheet-backed";
    case "family_inference":
      return "family-inferred";
    case "manual_review":
      return "review-confirmed";
    case "catalog_fixture":
      return "fixture-backed";
  }
}

/**
 * Persists the backend-derived part readiness projection after canonical rows are up to date.
 */
async function persistPartProjectionRows(
  client: PoolClient,
  normalizedPart: NormalizedProviderPart,
  previousPartIdentity: { mpn: string; packageId: string } | null
): Promise<void> {
  const affectedPartIds = await readAffectedProjectionPartIds(client, normalizedPart.part, previousPartIdentity);

  if (affectedPartIds.length === 0) {
    const buildableMatingSet = buildBuildableMatingSet(
      normalizedPart.mateRelations,
      normalizedPart.accessoryRequirements,
      normalizedPart.cableCompatibilities,
      normalizedPart.connectorFamilyConflicts
    );
    const projection = derivePartProjection({
      accessoryRequirements: normalizedPart.accessoryRequirements,
      assets: normalizedPart.assets,
      buildableMatingSet,
      datasheetRevision: normalizedPart.datasheetRevisions[0] ?? null,
      duplicateCandidates: [],
      extractionSignals: normalizedPart.extractionSignals,
      generationRequests: [],
      generationWorkflows: normalizedPart.generationWorkflows,
      mateRelations: normalizedPart.mateRelations,
      metrics: normalizedPart.metrics,
      part: normalizedPart.part,
      promotionAudits: normalizedPart.promotionAudits,
      reviewRecords: normalizedPart.reviewRecords,
      sourceReconciliation: null,
      sources: [normalizedPart.sourceRecord],
      validationRecords: normalizedPart.validationRecords
    });

    await writePartProjectionRows(client, normalizedPart.part.id, projection);
    return;
  }

  for (const partId of affectedPartIds) {
    await refreshStoredPartProjectionRows(client, partId);
  }
}

/**
 * Rebuilds stored part-level readiness rows from the canonical tables for one existing part.
 */
async function refreshStoredPartProjectionRows(client: PoolClient, partId: string): Promise<void> {
  await refreshStoredConnectorFamilyConflictRows(client, partId);

  const projectionSource = await readStoredProjectionSource(client, partId);

  if (!projectionSource) {
    return;
  }

  const buildableMatingSet = buildBuildableMatingSet(
    projectionSource.mateRelations,
    projectionSource.accessoryRequirements,
    projectionSource.cableCompatibilities,
    projectionSource.connectorFamilyConflicts
  );
  const projection = derivePartProjection({
    ...projectionSource,
    buildableMatingSet
  });

  await writePartProjectionRows(client, partId, projection);
}

/**
 * Recomputes persisted connector-family conflict rows from stored alternate-mate evidence.
 */
async function refreshStoredConnectorFamilyConflictRows(client: PoolClient, partId: string): Promise<void> {
  const result = await client.query<{
    candidateConnectorFamilyId: string | null;
    candidateLastUpdatedAt: Date | string | null;
    candidateManufacturerName: string | null;
    candidateMpn: string | null;
    candidatePartId: string | null;
    currentConnectorFamilyId: string | null;
    currentLastUpdatedAt: Date | string;
    relationCompatibilityStatus: MateRelation["compatibilityStatus"] | null;
    relationConfidenceScore: number | string | null;
    relationEvidenceKind: MateRelation["evidenceKind"] | null;
    relationId: string | null;
    relationSourceRecordId: string | null;
    relationType: MateRelation["relationshipType"] | null;
  }>(
    `
      SELECT
        source_part.connector_family_id AS "currentConnectorFamilyId",
        source_part.last_updated_at AS "currentLastUpdatedAt",
        relation.id AS "relationId",
        relation.mate_part_id AS "candidatePartId",
        relation.relationship_type AS "relationType",
        relation.compatibility_status AS "relationCompatibilityStatus",
        relation.evidence_kind AS "relationEvidenceKind",
        relation.confidence_score AS "relationConfidenceScore",
        relation.source_record_id AS "relationSourceRecordId",
        candidate.connector_family_id AS "candidateConnectorFamilyId",
        candidate.mpn AS "candidateMpn",
        candidate.last_updated_at AS "candidateLastUpdatedAt",
        candidate_manufacturer.name AS "candidateManufacturerName"
      FROM parts source_part
      LEFT JOIN mate_relations relation ON relation.part_id = source_part.id
      LEFT JOIN parts candidate ON candidate.id = relation.mate_part_id
      LEFT JOIN manufacturers candidate_manufacturer ON candidate_manufacturer.id = candidate.manufacturer_id
      WHERE source_part.id = $1
      ORDER BY relation.confidence_score DESC NULLS LAST, relation.id ASC
    `,
    [partId]
  );

  if (result.rows.length === 0) {
    return;
  }

  await client.query(`DELETE FROM connector_family_conflicts WHERE part_id = $1`, [partId]);

  const dominantMateFamilyId = result.rows
    .filter(
      (row): row is typeof row & {
        candidateConnectorFamilyId: string;
        relationCompatibilityStatus: MateRelation["compatibilityStatus"];
        relationEvidenceKind: MateRelation["evidenceKind"];
        relationConfidenceScore: number | string;
      } =>
        Boolean(row.candidateConnectorFamilyId) &&
        Boolean(row.relationCompatibilityStatus) &&
        Boolean(row.relationEvidenceKind) &&
        row.relationCompatibilityStatus !== "rejected"
    )
    .sort(
      (left, right) =>
        getConnectorRelationEffectiveConfidence({
          compatibilityStatus: right.relationCompatibilityStatus,
          confidenceScore: parseNumericValue(right.relationConfidenceScore),
          evidenceKind: right.relationEvidenceKind
        }) -
          getConnectorRelationEffectiveConfidence({
            compatibilityStatus: left.relationCompatibilityStatus,
            confidenceScore: parseNumericValue(left.relationConfidenceScore),
            evidenceKind: left.relationEvidenceKind
          }) || String(left.relationId).localeCompare(String(right.relationId))
    )[0]?.candidateConnectorFamilyId ?? null;

  for (const row of result.rows) {
    if (
      !row.relationId ||
      !row.relationType ||
      !row.relationCompatibilityStatus ||
      !row.relationEvidenceKind ||
      !row.candidatePartId
    ) {
      continue;
    }

    const confidenceScore = getConnectorRelationEffectiveConfidence({
      compatibilityStatus: row.relationCompatibilityStatus,
      confidenceScore: parseNumericValue(row.relationConfidenceScore ?? 0),
      evidenceKind: row.relationEvidenceKind
    });
    const minimumConfidence = row.relationEvidenceKind === "family_inference" ? 0.82 : 0.68;

    if (row.relationCompatibilityStatus === "rejected" || confidenceScore < minimumConfidence) {
      continue;
    }

    const conflictsWithCurrentFamily = Boolean(
      row.candidateConnectorFamilyId && row.currentConnectorFamilyId && row.candidateConnectorFamilyId !== row.currentConnectorFamilyId
    );
    const conflictsWithDominantMateFamily = Boolean(
      row.candidateConnectorFamilyId && dominantMateFamilyId && row.candidateConnectorFamilyId !== dominantMateFamilyId
    );
    const conflictType =
      conflictsWithCurrentFamily || conflictsWithDominantMateFamily
        ? "family_confusion"
        : row.relationType === "alternate_mate"
          ? "near_match_variant"
          : null;

    if (!conflictType) {
      continue;
    }

    const candidateLabel = row.candidateMpn
      ? `${row.candidateMpn}${row.candidateManufacturerName ? ` (${row.candidateManufacturerName})` : ""}`
      : row.candidatePartId;
    const summary =
      conflictType === "family_confusion"
        ? `${formatMateRelationLabel(row.relationType)} evidence crosses connector-family boundaries.`
        : "Near-match connector variant still needs review.";
    const detail =
      conflictType === "family_confusion"
        ? `${candidateLabel} is stored as a ${Math.round(confidenceScore * 100)}% ${formatMateRelationLabel(row.relationType).toLowerCase()} backed by ${formatConnectorEvidenceLabel(row.relationEvidenceKind)} evidence, but its connector family differs from the current or dominant mate family.`
        : `${candidateLabel} remains a ${Math.round(confidenceScore * 100)}% alternate mate candidate backed by ${formatConnectorEvidenceLabel(row.relationEvidenceKind)} evidence, so shell, keying, and variant differences still need review.`;
    const lastUpdatedAt = latestTimestamp([
      toIsoTimestamp(row.currentLastUpdatedAt),
      ...(row.candidateLastUpdatedAt ? [toIsoTimestamp(row.candidateLastUpdatedAt)] : [])
    ]);

    await client.query(
      `
        INSERT INTO connector_family_conflicts (
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
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (part_id, candidate_part_id, conflict_type) DO UPDATE SET
          id = EXCLUDED.id,
          candidate_connector_family_id = EXCLUDED.candidate_connector_family_id,
          confidence_score = EXCLUDED.confidence_score,
          summary = EXCLUDED.summary,
          detail = EXCLUDED.detail,
          source_record_id = EXCLUDED.source_record_id,
          last_updated_at = EXCLUDED.last_updated_at
      `,
      [
        `connector-conflict-${partId}-${slugify(row.candidatePartId)}-${conflictType}`,
        partId,
        row.candidatePartId,
        row.candidateConnectorFamilyId,
        conflictType,
        confidenceScore,
        summary,
        detail,
        row.relationSourceRecordId,
        lastUpdatedAt
      ]
    );
  }
}

/**
 * Reads every part id whose duplicate-candidate projection could change after one canonical part write.
 */
async function readAffectedProjectionPartIds(
  client: PoolClient,
  part: Part,
  previousPartIdentity: { mpn: string; packageId: string } | null
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM parts
      WHERE id = $1
        OR (lower(mpn) = lower($2) AND package_id = $3)
        OR ($4::text IS NOT NULL AND $5::text IS NOT NULL AND lower(mpn) = lower($4) AND package_id = $5)
      ORDER BY id ASC
    `,
    [part.id, part.mpn, part.packageId, previousPartIdentity?.mpn ?? null, previousPartIdentity?.packageId ?? null]
  );

  return Array.from(new Set(result.rows.map((row) => row.id)));
}

/**
 * Reads the canonical rows needed to derive part-level readiness from the current database state.
 */
async function readStoredProjectionSource(client: PoolClient, partId: string): Promise<{
  accessoryRequirements: AccessoryRequirement[];
  assets: Asset[];
  cableCompatibilities: CableCompatibility[];
  connectorFamilyConflicts: ConnectorFamilyConflict[];
  datasheetRevision: DatasheetRevision | null;
  duplicateCandidates: PartDuplicateCandidate[];
  extractionSignals: SourceExtractionSignal[];
  generationRequests: GenerationRequest[];
  generationWorkflows: GenerationWorkflow[];
  mateRelations: MateRelation[];
  metrics: PartMetric[];
  part: Part;
  promotionAudits: AssetPromotionAuditRecord[];
  reviewRecords: ReviewRecord[];
  sourceReconciliation: SourceReconciliationRecord | null;
  sources: SourceRecord[];
  validationRecords: AssetValidationRecord[];
} | null> {
  const [
    partResult,
    assetResult,
    datasheetResult,
    sourceResult,
    metricResult,
    extractionSignalResult,
    mateResult,
    accessoryResult,
    cableResult,
    connectorFamilyConflictResult,
    workflowResult,
    requestResult,
    reviewResult,
    validationResult,
    promotionAuditResult,
    duplicateCandidateResult,
    sourceReconciliationResult
  ] = await Promise.all([
    client.query<{
      id: string;
      mpn: string;
      description: string;
      manufacturerId: string;
      category: string;
      lifecycleStatus: Part["lifecycleStatus"];
      packageId: string;
      connectorFamilyId: string | null;
      trustScore: number | string;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          mpn,
          description,
          manufacturer_id AS "manufacturerId",
          category,
          lifecycle_status AS "lifecycleStatus",
          package_id AS "packageId",
          connector_family_id AS "connectorFamilyId",
          trust_score AS "trustScore",
          last_updated_at AS "lastUpdatedAt"
        FROM parts
        WHERE id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      assetType: Asset["assetType"];
      fileFormat: Asset["fileFormat"];
      storageKey: string | null;
      fileHash: string | null;
      providerId: string | null;
      licenseMode: Asset["licenseMode"];
      provenance: Asset["provenance"];
      availabilityStatus: Asset["availabilityStatus"];
      reviewStatus: Asset["reviewStatus"];
      exportStatus: Asset["exportStatus"];
      assetState: Asset["assetState"];
      assetStatus: Asset["assetStatus"];
      generationMethod: string | null;
      generationSourceAssetId: string | null;
      validationStatus: Asset["validationStatus"];
      previewStatus: Asset["previewStatus"];
      previewArtifactStorageKey: string | null;
      previewArtifactFormat: Asset["previewArtifactFormat"];
      previewArtifactGeneratedAt: Date | string | null;
      previewArtifactSource: Asset["previewArtifactSource"];
      sourceUrl: string | null;
      sourceRecordId: string | null;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          asset_type AS "assetType",
          file_format AS "fileFormat",
          storage_key AS "storageKey",
          file_hash AS "fileHash",
          provider_id AS "providerId",
          license_mode AS "licenseMode",
          provenance,
          availability_status AS "availabilityStatus",
          review_status AS "reviewStatus",
          export_status AS "exportStatus",
          asset_state AS "assetState",
          asset_status AS "assetStatus",
          generation_method AS "generationMethod",
          generation_source_asset_id AS "generationSourceAssetId",
          validation_status AS "validationStatus",
          preview_status AS "previewStatus",
          preview_artifact_storage_key AS "previewArtifactStorageKey",
          preview_artifact_format AS "previewArtifactFormat",
          preview_artifact_generated_at AS "previewArtifactGeneratedAt",
          preview_artifact_source AS "previewArtifactSource",
          source_url AS "sourceUrl",
          source_record_id AS "sourceRecordId",
          last_updated_at AS "lastUpdatedAt"
        FROM assets
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      revisionLabel: string;
      revisionDate: Date | string | null;
      pageCount: number | null;
      fileAssetId: string | null;
      parseConfidence: number | string;
      pinTableStatus: DatasheetRevision["pinTableStatus"];
      sourceRecordId: string | null;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          revision_label AS "revisionLabel",
          revision_date AS "revisionDate",
          page_count AS "pageCount",
          file_asset_id AS "fileAssetId",
          parse_confidence AS "parseConfidence",
          pin_table_status AS "pinTableStatus",
          source_record_id AS "sourceRecordId",
          last_updated_at AS "lastUpdatedAt"
        FROM datasheet_revisions
        WHERE part_id = $1
        ORDER BY revision_date DESC NULLS LAST, last_updated_at DESC
        LIMIT 1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      providerId: string;
      providerPartKey: string;
      partId: string | null;
      sourceUrl: string | null;
      fetchedAt: Date | string;
      rawPayload: unknown;
      normalizedAt: Date | string | null;
      sourceLastSeenAt: Date | string;
      sourceLastImportedAt: Date | string | null;
      importStatus: SourceImportStatus;
      importErrorDetails: string | null;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          provider_id AS "providerId",
          provider_part_key AS "providerPartKey",
          part_id AS "partId",
          source_url AS "sourceUrl",
          fetched_at AS "fetchedAt",
          raw_payload AS "rawPayload",
          normalized_at AS "normalizedAt",
          source_last_seen_at AS "sourceLastSeenAt",
          source_last_imported_at AS "sourceLastImportedAt",
          import_status AS "importStatus",
          import_error_details AS "importErrorDetails",
          last_updated_at AS "lastUpdatedAt"
        FROM source_records
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      metricKey: string;
      metricValue: number | string | null;
      unit: PartMetric["unit"];
      minValue: number | string | null;
      maxValue: number | string | null;
      confidenceScore: number | string;
      sourceRevisionId: string;
      sourceRecordId: string | null;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          metric_key AS "metricKey",
          metric_value AS "metricValue",
          unit,
          min_value AS "minValue",
          max_value AS "maxValue",
          confidence_score AS "confidenceScore",
          source_revision_id AS "sourceRevisionId",
          source_record_id AS "sourceRecordId",
          last_updated_at AS "lastUpdatedAt"
        FROM part_metrics
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      sourceRecordId: string | null;
      datasheetRevisionId: string | null;
      assetId: string | null;
      signalType: SourceExtractionSignal["signalType"];
      extractionStatus: SourceExtractionSignal["extractionStatus"];
      confidenceScore: number | string;
      extractionSource: SourceExtractionSignal["extractionSource"];
      notes: string | null;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          source_record_id AS "sourceRecordId",
          datasheet_revision_id AS "datasheetRevisionId",
          asset_id AS "assetId",
          signal_type AS "signalType",
          extraction_status AS "extractionStatus",
          confidence_score AS "confidenceScore",
          extraction_source AS "extractionSource",
          notes,
          last_updated_at AS "lastUpdatedAt"
        FROM source_extraction_signals
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      matePartId: string;
      relationshipType: MateRelation["relationshipType"];
      compatibilityStatus: MateRelation["compatibilityStatus"] | null;
      evidenceKind: MateRelation["evidenceKind"] | null;
      confidenceScore: number | string;
      sourceRevisionId: string;
      sourceRecordId: string | null;
      notes: string | null;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          mate_part_id AS "matePartId",
          relationship_type AS "relationshipType",
          compatibility_status AS "compatibilityStatus",
          evidence_kind AS "evidenceKind",
          confidence_score AS "confidenceScore",
          source_revision_id AS "sourceRevisionId",
          source_record_id AS "sourceRecordId",
          notes
        FROM mate_relations
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      accessoryPartId: string;
      relationshipType: AccessoryRequirement["relationshipType"];
      compatibilityStatus: AccessoryRequirement["compatibilityStatus"] | null;
      evidenceKind: AccessoryRequirement["evidenceKind"] | null;
      confidenceScore: number | string;
      sourceRevisionId: string;
      sourceRecordId: string | null;
      notes: string | null;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          accessory_part_id AS "accessoryPartId",
          relationship_type AS "relationshipType",
          compatibility_status AS "compatibilityStatus",
          evidence_kind AS "evidenceKind",
          confidence_score AS "confidenceScore",
          source_revision_id AS "sourceRevisionId",
          source_record_id AS "sourceRecordId",
          notes
        FROM accessory_requirements
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      cablePartId: string;
      relationshipType: CableCompatibility["relationshipType"];
      wireGaugeMin: number | null;
      wireGaugeMax: number | null;
      shieldingRequirement: CableCompatibility["shieldingRequirement"];
      terminationStyle: CableCompatibility["terminationStyle"];
      compatibilityStatus: CableCompatibility["compatibilityStatus"];
      confidenceScore: number | string;
      sourceRevisionId: string;
      sourceRecordId: string | null;
      notes: string | null;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          cable_part_id AS "cablePartId",
          relationship_type AS "relationshipType",
          wire_gauge_min AS "wireGaugeMin",
          wire_gauge_max AS "wireGaugeMax",
          shielding_requirement AS "shieldingRequirement",
          termination_style AS "terminationStyle",
          compatibility_status AS "compatibilityStatus",
          confidence_score AS "confidenceScore",
          source_revision_id AS "sourceRevisionId",
          source_record_id AS "sourceRecordId",
          notes
        FROM cable_compatibilities
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      candidatePartId: string;
      candidateConnectorFamilyId: string | null;
      conflictType: ConnectorFamilyConflict["conflictType"];
      confidenceScore: number | string;
      summary: string;
      detail: string;
      sourceRecordId: string | null;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          candidate_part_id AS "candidatePartId",
          candidate_connector_family_id AS "candidateConnectorFamilyId",
          conflict_type AS "conflictType",
          confidence_score AS "confidenceScore",
          summary,
          detail,
          source_record_id AS "sourceRecordId",
          last_updated_at AS "lastUpdatedAt"
        FROM connector_family_conflicts
        WHERE part_id = $1
        ORDER BY confidence_score DESC, id ASC
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      targetAssetType: GenerationWorkflow["targetAssetType"];
      sourceDatasheetRevisionId: string | null;
      sourceAssetId: string | null;
      generationStatus: GenerationWorkflow["generationStatus"];
      confidenceScore: number | string;
      outputAssetId: string | null;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          target_asset_type AS "targetAssetType",
          source_datasheet_revision_id AS "sourceDatasheetRevisionId",
          source_asset_id AS "sourceAssetId",
          generation_status AS "generationStatus",
          confidence_score AS "confidenceScore",
          output_asset_id AS "outputAssetId"
        FROM generation_workflows
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      targetAssetType: GenerationRequest["targetAssetType"];
      sourceDatasheetRevisionId: string | null;
      sourceAssetId: string | null;
      requestStatus: GenerationRequest["requestStatus"];
      requestedAt: Date | string;
      requestedBy: string;
      workflowId: string | null;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          target_asset_type AS "targetAssetType",
          source_datasheet_revision_id AS "sourceDatasheetRevisionId",
          source_asset_id AS "sourceAssetId",
          request_status AS "requestStatus",
          requested_at AS "requestedAt",
          requested_by AS "requestedBy",
          workflow_id AS "workflowId",
          last_updated_at AS "lastUpdatedAt"
        FROM generation_requests
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      targetType: ReviewRecord["targetType"];
      assetId: string | null;
      generationWorkflowId: string | null;
      outcome: ReviewRecord["outcome"];
      reviewer: string;
      notes: string | null;
      reviewedAt: Date | string;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          target_type AS "targetType",
          asset_id AS "assetId",
          generation_workflow_id AS "generationWorkflowId",
          outcome,
          reviewer,
          notes,
          reviewed_at AS "reviewedAt",
          last_updated_at AS "lastUpdatedAt"
        FROM review_records
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      assetId: string;
      validationStatus: AssetValidationRecord["validationStatus"];
      validationType: AssetValidationRecord["validationType"];
      validationNotes: string | null;
      validatedAt: Date | string;
      validator: string;
      lastUpdatedAt: Date | string;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          asset_id AS "assetId",
          validation_status AS "validationStatus",
          validation_type AS "validationType",
          validation_notes AS "validationNotes",
          validated_at AS "validatedAt",
          validator,
          last_updated_at AS "lastUpdatedAt"
        FROM asset_validation_records
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      partId: string;
      assetId: string;
      priorExportStatus: AssetPromotionAuditRecord["priorExportStatus"];
      newExportStatus: AssetPromotionAuditRecord["newExportStatus"];
      promotionOutcome: AssetPromotionAuditRecord["promotionOutcome"];
      blockerReasons: string[];
      validationRecordId: string | null;
      actor: string;
      createdAt: Date | string;
    }>(
      `
        SELECT
          id,
          part_id AS "partId",
          asset_id AS "assetId",
          prior_export_status AS "priorExportStatus",
          new_export_status AS "newExportStatus",
          promotion_outcome AS "promotionOutcome",
          blocker_reasons AS "blockerReasons",
          validation_record_id AS "validationRecordId",
          actor,
          created_at AS "createdAt"
        FROM asset_promotion_audits
        WHERE part_id = $1
      `,
      [partId]
    ),
    client.query<{
      id: string;
      part_id: string;
      duplicate_part_id: string;
      duplicate_part_mpn: string;
      duplicate_manufacturer_name: string;
      detection_source: string;
      confidence_score: number | string;
      summary: string;
      detail: string;
      last_updated_at: Date | string;
    }>(
      `
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
          (CASE WHEN p.manufacturer_id = candidate.manufacturer_id THEN 0.98 ELSE 0.82 END) AS confidence_score,
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
        WHERE p.id = $1
        ORDER BY confidence_score DESC, duplicate_part_mpn ASC, duplicate_part_id ASC
      `,
      [partId]
    ),
    client.query<{
      part_id: string;
      preferred_source_record_id: string | null;
      resolution_status: SourceReconciliationRecord["resolutionStatus"];
      notes: string | null;
      updated_by: string | null;
      updated_at: Date | string;
    }>(
      `
        SELECT
          part_id,
          preferred_source_record_id,
          resolution_status,
          notes,
          updated_by,
          updated_at
        FROM part_source_reconciliations
        WHERE part_id = $1
        LIMIT 1
      `,
      [partId]
    )
  ]);
  const partRow = partResult.rows[0];

  if (!partRow) {
    return null;
  }

  return {
    accessoryRequirements: accessoryResult.rows.map((row) => ({
      ...row,
      compatibilityStatus: row.compatibilityStatus ?? "probable",
      confidenceScore: parseNumericValue(row.confidenceScore),
      evidenceKind: row.evidenceKind ?? "catalog_fixture",
      sourceRecordId: row.sourceRecordId ?? null
    })),
    assets: assetResult.rows.map((row) => ({
      ...row,
      lastUpdatedAt: toIsoTimestamp(row.lastUpdatedAt),
      previewArtifactGeneratedAt: row.previewArtifactGeneratedAt ? toIsoTimestamp(row.previewArtifactGeneratedAt) : null
    })),
    cableCompatibilities: cableResult.rows.map((row) => ({
      ...row,
      compatibilityStatus: row.compatibilityStatus ?? "uncertain",
      confidenceScore: parseNumericValue(row.confidenceScore),
      shieldingRequirement: row.shieldingRequirement ?? "unknown",
      sourceRecordId: row.sourceRecordId ?? null,
      terminationStyle: row.terminationStyle ?? "unknown",
      wireGaugeMax: row.wireGaugeMax ?? null,
      wireGaugeMin: row.wireGaugeMin ?? null
    })),
    connectorFamilyConflicts: connectorFamilyConflictResult.rows.map((row) => ({
      ...row,
      confidenceScore: parseNumericValue(row.confidenceScore),
      lastUpdatedAt: toIsoTimestamp(row.lastUpdatedAt)
    })),
    datasheetRevision: datasheetResult.rows[0]
      ? {
          ...datasheetResult.rows[0],
          lastUpdatedAt: toIsoTimestamp(datasheetResult.rows[0].lastUpdatedAt),
          parseConfidence: parseNumericValue(datasheetResult.rows[0].parseConfidence),
          revisionDate: datasheetResult.rows[0].revisionDate ? toIsoTimestamp(datasheetResult.rows[0].revisionDate).slice(0, 10) : null
        }
      : null,
    duplicateCandidates: duplicateCandidateResult.rows.map((row) => ({
      confidenceScore: parseNumericValue(row.confidence_score),
      detail: row.detail,
      detectionSource: row.detection_source,
      duplicateManufacturerName: row.duplicate_manufacturer_name,
      duplicatePartId: row.duplicate_part_id,
      duplicatePartMpn: row.duplicate_part_mpn,
      id: row.id,
      lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
      partId: row.part_id,
      summary: row.summary
    })),
    extractionSignals: extractionSignalResult.rows.map((row) => ({
      ...row,
      confidenceScore: parseNumericValue(row.confidenceScore),
      lastUpdatedAt: toIsoTimestamp(row.lastUpdatedAt)
    })),
    generationRequests: requestResult.rows.map((row) => ({
      ...row,
      lastUpdatedAt: toIsoTimestamp(row.lastUpdatedAt),
      requestedAt: toIsoTimestamp(row.requestedAt)
    })),
    generationWorkflows: workflowResult.rows.map((row) => ({
      ...row,
      confidenceScore: parseNumericValue(row.confidenceScore)
    })),
    mateRelations: mateResult.rows.map((row) => ({
      ...row,
      compatibilityStatus: row.compatibilityStatus ?? "probable",
      confidenceScore: parseNumericValue(row.confidenceScore),
      evidenceKind: row.evidenceKind ?? "catalog_fixture",
      sourceRecordId: row.sourceRecordId ?? null
    })),
    metrics: metricResult.rows.map((row) => ({
      ...row,
      confidenceScore: parseNumericValue(row.confidenceScore),
      lastUpdatedAt: toIsoTimestamp(row.lastUpdatedAt),
      maxValue: parseNullableNumericValue(row.maxValue),
      metricValue: parseNullableNumericValue(row.metricValue),
      minValue: parseNullableNumericValue(row.minValue)
    })),
    part: {
      ...partRow,
      lastUpdatedAt: toIsoTimestamp(partRow.lastUpdatedAt),
      trustScore: parseNumericValue(partRow.trustScore)
    },
    promotionAudits: promotionAuditResult.rows.map((row) => ({
      ...row,
      blockerReasons: row.blockerReasons ?? [],
      createdAt: toIsoTimestamp(row.createdAt)
    })),
    reviewRecords: reviewResult.rows.map((row) => ({
      ...row,
      lastUpdatedAt: toIsoTimestamp(row.lastUpdatedAt),
      reviewedAt: toIsoTimestamp(row.reviewedAt)
    })),
    sources: sourceResult.rows.map((row) => ({
      ...row,
      fetchedAt: toIsoTimestamp(row.fetchedAt),
      lastUpdatedAt: toIsoTimestamp(row.lastUpdatedAt),
      normalizedAt: row.normalizedAt ? toIsoTimestamp(row.normalizedAt) : null,
      sourceLastImportedAt: row.sourceLastImportedAt ? toIsoTimestamp(row.sourceLastImportedAt) : null,
      sourceLastSeenAt: toIsoTimestamp(row.sourceLastSeenAt)
    })),
    sourceReconciliation: sourceReconciliationResult.rows[0]
      ? {
          notes: sourceReconciliationResult.rows[0].notes,
          partId: sourceReconciliationResult.rows[0].part_id,
          preferredSourceRecordId: sourceReconciliationResult.rows[0].preferred_source_record_id,
          resolutionStatus: sourceReconciliationResult.rows[0].resolution_status,
          updatedAt: toIsoTimestamp(sourceReconciliationResult.rows[0].updated_at),
          updatedBy: sourceReconciliationResult.rows[0].updated_by
        }
      : null,
    validationRecords: validationResult.rows.map((row) => ({
      ...row,
      lastUpdatedAt: toIsoTimestamp(row.lastUpdatedAt),
      validatedAt: toIsoTimestamp(row.validatedAt)
    }))
  };
}

/**
 * Writes one derived projection into the persisted readiness, approval, issue, and risk tables.
 */
async function writePartProjectionRows(
  client: PoolClient,
  partId: string,
  projection: ReturnType<typeof derivePartProjection>
): Promise<void> {
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
        last_evaluated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      projection.readinessSummary.lastEvaluatedAt
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
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
      projection.approval.lastUpdatedAt
    ]
  );
  await syncPartIssueRows(client, partId, projection.issues);
  await client.query(`DELETE FROM part_risk_flags WHERE part_id = $1`, [partId]);

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
          last_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [riskFlag.id, riskFlag.partId, riskFlag.code, riskFlag.label, riskFlag.detail, riskFlag.tone, riskFlag.lastUpdatedAt]
    );
  }
}

/**
 * Upserts derived issues while preserving manual admin workflow state across worker refreshes.
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
          last_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        issue.lastUpdatedAt
      ]
    );
  }
}

/**
 * Parses numeric database values into JavaScript numbers without hiding invalid data.
 */
function parseNumericValue(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * Parses nullable numeric database values into JavaScript numbers.
 */
function parseNullableNumericValue(value: number | string | null): number | null {
  return value === null ? null : parseNumericValue(value);
}

/**
 * Returns the newest ISO timestamp from one or more ISO-like timestamp strings.
 */
function latestTimestamp(timestamps: string[]): string {
  return [...timestamps].sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? new Date(0).toISOString();
}
