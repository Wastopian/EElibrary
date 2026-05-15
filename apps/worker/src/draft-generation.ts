/**
 * File header: Generates review-required draft CAD assets from structured source extraction signals.
 */

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getWorkerDatabasePool } from "./catalog-repository";
import type { Asset, GenerationTargetAssetType, SourceExtractionSignalType } from "@ee-library/shared/types";

/** DraftableTarget limits Phase 5B generation to footprint and symbol drafts only. */
type DraftableTarget = Extract<GenerationTargetAssetType, "footprint" | "symbol">;

/** PendingGenerationRequestRow is the joined row needed to build one draft artifact. */
interface PendingGenerationRequestRow {
  /** Generation request id to update after a draft is created. */
  request_id: string;
  /** Canonical part id. */
  part_id: string;
  /** Canonical manufacturer part number. */
  mpn: string;
  /** Requested draft target. */
  target_asset_type: DraftableTarget;
  /** Optional source datasheet selected by the request API. */
  source_datasheet_revision_id: string | null;
  /** Optional source asset selected by the request API. */
  source_asset_id: string | null;
  /** Optional workflow id already linked to the request. */
  workflow_id: string | null;
  /** Normalized package name. */
  package_name: string;
  /** Normalized pin count. */
  pin_count: number | null;
  /** Normalized pitch in millimeters. */
  pitch_mm: string | number | null;
  /** Normalized body length in millimeters. */
  body_length_mm: string | number | null;
  /** Normalized body width in millimeters. */
  body_width_mm: string | number | null;
  /** Normalized body height in millimeters. */
  body_height_mm: string | number | null;
}

/** SourceSignalRow carries the best structured extraction evidence for one target. */
interface SourceSignalRow {
  /** Source extraction signal id. */
  id: string;
  /** Optional source record preserving provenance. */
  source_record_id: string | null;
  /** Optional datasheet revision behind the signal. */
  datasheet_revision_id: string | null;
  /** Optional source asset behind the signal. */
  asset_id: string | null;
  /** Signal confidence score from structured extraction. */
  confidence_score: string | number;
}

/** DraftGenerationOutput summarizes one generated draft asset. */
export interface DraftGenerationOutput {
  /** Generation request that produced this draft. */
  requestId: string;
  /** Workflow linked to the generated draft. */
  workflowId: string;
  /** Draft asset id. */
  assetId: string;
  /** Part id that owns the draft. */
  partId: string;
  /** Generated target asset type. */
  targetAssetType: DraftableTarget;
  /** Hash of the deterministic draft artifact content. */
  fileHash: string;
}

/** DraftGenerationSkip explains why a pending request was not generated. */
export interface DraftGenerationSkip {
  /** Generation request that was skipped. */
  requestId: string;
  /** Part id on the skipped request. */
  partId: string;
  /** Requested target. */
  targetAssetType: GenerationTargetAssetType;
  /** Operator-readable reason. */
  reason: string;
}

/** DraftGenerationSummary is the worker-admin result for one processing pass. */
export interface DraftGenerationSummary {
  /** Number of pending requests inspected. */
  processed: number;
  /** Draft outputs generated or refreshed. */
  generated: DraftGenerationOutput[];
  /** Pending requests skipped without fake success. */
  skipped: DraftGenerationSkip[];
}

/**
 * Processes pending DB-backed generation requests through the worker database pool.
 */
export async function generateDraftAssetsFromDatabase(limit = 20): Promise<DraftGenerationSummary> {
  return generateDraftAssetsForPendingRequests(getWorkerDatabasePool(), { limit });
}

/**
 * Generates deterministic footprint and symbol draft assets for requestable pending requests.
 */
export async function generateDraftAssetsForPendingRequests(databasePool: Pool, options: { limit?: number; generatedAt?: string } = {}): Promise<DraftGenerationSummary> {
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    const summary = await generateDraftAssetsWithClient(client, options);
    await client.query("COMMIT");

    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs the draft-generation transaction against one connected database client.
 */
async function generateDraftAssetsWithClient(client: PoolClient, options: { limit?: number; generatedAt?: string }): Promise<DraftGenerationSummary> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const requests = await listPendingDraftableRequests(client, options.limit ?? 20);
  const generated: DraftGenerationOutput[] = [];
  const skipped: DraftGenerationSkip[] = [];

  for (const request of requests) {
    const signal = await findBestSourceSignal(client, request.part_id, signalTypeForTarget(request.target_asset_type));
    const readinessFailure = getReadinessFailure(request, signal);

    if (readinessFailure || !signal) {
      skipped.push({
        partId: request.part_id,
        reason: readinessFailure ?? "No usable extraction signal is available.",
        requestId: request.request_id,
        targetAssetType: request.target_asset_type
      });
      continue;
    }

    const output = buildDraftOutput(request, signal, generatedAt);

    await persistDraftAsset(client, output.asset);
    await persistDraftWorkflow(client, output.workflow, output.request.request_id);
    await markRequestReviewRequired(client, output.request.request_id, output.workflow.id, generatedAt);

    generated.push({
      assetId: output.asset.id,
      fileHash: output.asset.fileHash ?? "",
      partId: output.asset.partId,
      requestId: output.request.request_id,
      targetAssetType: output.request.target_asset_type,
      workflowId: output.workflow.id
    });
  }

  return {
    generated,
    processed: requests.length,
    skipped
  };
}

/**
 * Lists requested, queued, or processing generation requests that Phase 5B can produce.
 */
async function listPendingDraftableRequests(client: PoolClient, limit: number): Promise<PendingGenerationRequestRow[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const result = await client.query<PendingGenerationRequestRow>(
    `
      SELECT
        generation_requests.id AS request_id,
        generation_requests.part_id,
        parts.mpn,
        generation_requests.target_asset_type,
        generation_requests.source_datasheet_revision_id,
        generation_requests.source_asset_id,
        generation_requests.workflow_id,
        packages.package_name,
        packages.pin_count,
        packages.pitch_mm,
        packages.body_length_mm,
        packages.body_width_mm,
        packages.body_height_mm
      FROM generation_requests
      INNER JOIN parts ON parts.id = generation_requests.part_id
      INNER JOIN packages ON packages.id = parts.package_id
      WHERE generation_requests.request_status IN ('requested', 'queued', 'processing')
        AND generation_requests.target_asset_type IN ('footprint', 'symbol')
      ORDER BY generation_requests.requested_at ASC, generation_requests.id ASC
      LIMIT $1
    `,
    [boundedLimit]
  );

  return result.rows;
}

/**
 * Finds the strongest extraction signal that can support one draft target.
 */
async function findBestSourceSignal(client: PoolClient, partId: string, signalType: SourceExtractionSignalType): Promise<SourceSignalRow | null> {
  const result = await client.query<SourceSignalRow>(
    `
      SELECT
        id,
        source_record_id,
        datasheet_revision_id,
        asset_id,
        confidence_score
      FROM source_extraction_signals
      WHERE part_id = $1
        AND signal_type = $2
        AND extraction_status IN ('available', 'needs_review')
      ORDER BY confidence_score DESC, last_updated_at DESC, id ASC
      LIMIT 1
    `,
    [partId, signalType]
  );

  return result.rows[0] ?? null;
}

/**
 * Checks Phase 5B source readiness using only structured DB-backed evidence.
 */
function getReadinessFailure(request: PendingGenerationRequestRow, signal: SourceSignalRow | null): string | null {
  if (!signal) {
    return request.target_asset_type === "footprint" ? "No usable package/mechanical extraction signal is available." : "No usable pin-table extraction signal is available.";
  }

  if (request.pin_count === null) {
    return "Package pin count is missing.";
  }

  if (request.target_asset_type === "footprint") {
    if (request.pitch_mm === null) return "Package pitch is missing.";
    if (request.body_length_mm === null || request.body_width_mm === null) return "Package body dimensions are incomplete.";
  }

  return null;
}

/**
 * Builds the draft asset and workflow rows that will be persisted together.
 */
function buildDraftOutput(request: PendingGenerationRequestRow, signal: SourceSignalRow, generatedAt: string) {
  const artifact = request.target_asset_type === "footprint" ? buildFootprintDraftContent(request, signal) : buildSymbolDraftContent(request, signal);
  const fileHash = `sha256:${createHash("sha256").update(artifact).digest("hex")}`;
  const assetId = buildDraftAssetId(request.part_id, request.target_asset_type);
  const workflowId = request.workflow_id ?? buildWorkflowId(request.part_id, request.target_asset_type);
  const asset: Asset = {
    assetState: "downloaded",
    assetStatus: "downloaded",
    assetType: request.target_asset_type,
    availabilityStatus: "downloaded",
    exportStatus: "not_exportable",
    fileFormat: request.target_asset_type === "footprint" ? "kicad_mod" : "kicad_sym",
    fileHash,
    generationMethod: request.target_asset_type === "footprint" ? "draft_footprint_from_extraction_signal" : "draft_symbol_from_extraction_signal",
    generationSourceAssetId: request.source_asset_id ?? signal.asset_id,
    id: assetId,
    lastUpdatedAt: generatedAt,
    licenseMode: "redistribution_allowed",
    partId: request.part_id,
    previewArtifactFormat: null,
    previewArtifactGeneratedAt: null,
    previewArtifactSource: null,
    previewArtifactStorageKey: null,
    previewStatus: "pending",
    providerId: null,
    provenance: "generated",
    reviewStatus: "review_required",
    sourceRecordId: signal.source_record_id,
    sourceUrl: null,
    storageKey: `generated/drafts/${slugify(request.part_id)}/${request.target_asset_type}.${request.target_asset_type === "footprint" ? "kicad_mod" : "kicad_sym"}`,
    validationStatus: "needs_review"
  };

  return {
    asset,
    request,
    workflow: {
      confidenceScore: numeric(signal.confidence_score),
      generationStatus: "review_required" as const,
      id: workflowId,
      outputAssetId: assetId,
      partId: request.part_id,
      sourceAssetId: request.source_asset_id ?? signal.asset_id,
      sourceDatasheetRevisionId: request.source_datasheet_revision_id ?? signal.datasheet_revision_id,
      targetAssetType: request.target_asset_type
    }
  };
}

/**
 * Writes one generated draft asset without passing it through legacy optimistic derivation.
 */
async function persistDraftAsset(client: PoolClient, asset: Asset): Promise<void> {
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
 * Writes or refreshes the workflow that links a request to its draft output asset.
 */
async function persistDraftWorkflow(client: PoolClient, workflow: ReturnType<typeof buildDraftOutput>["workflow"], requestId: string): Promise<void> {
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
    [
      workflow.id,
      workflow.partId,
      workflow.targetAssetType,
      workflow.sourceDatasheetRevisionId,
      workflow.sourceAssetId,
      workflow.generationStatus,
      workflow.confidenceScore,
      workflow.outputAssetId
    ]
  );

  await client.query(
    `
      UPDATE generation_requests
      SET workflow_id = $1
      WHERE id = $2
    `,
    [workflow.id, requestId]
  );
}

/**
 * Marks the request as review-required once the draft output has been recorded.
 */
async function markRequestReviewRequired(client: PoolClient, requestId: string, workflowId: string, generatedAt: string): Promise<void> {
  await client.query(
    `
      UPDATE generation_requests
      SET
        request_status = 'review_required',
        workflow_id = $1,
        last_updated_at = $2
      WHERE id = $3
    `,
    [workflowId, generatedAt, requestId]
  );
}

/**
 * Builds a deterministic KiCad footprint draft body from normalized package dimensions.
 */
function buildFootprintDraftContent(request: PendingGenerationRequestRow, signal: SourceSignalRow): string {
  const pitch = numeric(request.pitch_mm);
  const bodyLength = numeric(request.body_length_mm);
  const bodyWidth = numeric(request.body_width_mm);
  const pinCount = request.pin_count ?? 0;

  return [
    "# EE Library generated draft footprint",
    "# Requires engineering review before trust or export.",
    `# Source extraction signal: ${signal.id}`,
    `(footprint "${escapeDraftString(request.mpn)}_${escapeDraftString(request.package_name)}"`,
    `  (attr smd)`,
    `  (property "Reference" "REF**")`,
    `  (property "Value" "${escapeDraftString(request.mpn)}")`,
    `  (property "Package" "${escapeDraftString(request.package_name)}")`,
    `  (property "PinCount" "${pinCount}")`,
    `  (property "PitchMm" "${formatDraftNumber(pitch)}")`,
    `  (fp_rect (start ${formatDraftNumber(-bodyLength / 2)} ${formatDraftNumber(-bodyWidth / 2)}) (end ${formatDraftNumber(bodyLength / 2)} ${formatDraftNumber(bodyWidth / 2)}) (stroke (width 0.1) (type default)) (fill none))`,
    ...buildFootprintPads(pinCount, pitch, bodyWidth),
    ")",
    ""
  ].join("\n");
}

/**
 * Builds a deterministic KiCad symbol draft body from normalized pin count data.
 */
function buildSymbolDraftContent(request: PendingGenerationRequestRow, signal: SourceSignalRow): string {
  const pinCount = request.pin_count ?? 0;

  return [
    "# EE Library generated draft symbol",
    "# Requires engineering review before trust or export.",
    `# Source extraction signal: ${signal.id}`,
    `(symbol "${escapeDraftString(request.mpn)}"`,
    `  (property "Reference" "U" (at 0 0 0))`,
    `  (property "Value" "${escapeDraftString(request.mpn)}" (at 0 -2.54 0))`,
    ...Array.from({ length: pinCount }, (_, index) => {
      const pinNumber = index + 1;
      const x = index % 2 === 0 ? -7.62 : 7.62;
      const y = Math.floor(index / 2) * -2.54;
      const rotation = index % 2 === 0 ? 0 : 180;

      return `  (pin passive line (at ${formatDraftNumber(x)} ${formatDraftNumber(y)} ${rotation}) (length 2.54) (name "PIN${pinNumber}") (number "${pinNumber}"))`;
    }),
    ")",
    ""
  ].join("\n");
}

/**
 * Builds simple symmetric SMD pads for a draft footprint outline.
 */
function buildFootprintPads(pinCount: number, pitch: number, bodyWidth: number): string[] {
  const leftPins = Math.ceil(pinCount / 2);
  const rightPins = pinCount - leftPins;
  const leftX = -Math.max(bodyWidth / 2, 0.5);
  const rightX = Math.max(bodyWidth / 2, 0.5);

  return [
    ...Array.from({ length: leftPins }, (_, index) => buildPadLine(index + 1, leftX, centeredPadOffset(index, leftPins, pitch))),
    ...Array.from({ length: rightPins }, (_, index) => buildPadLine(leftPins + index + 1, rightX, centeredPadOffset(index, rightPins, pitch)))
  ];
}

/**
 * Builds one KiCad pad line for the draft footprint artifact.
 */
function buildPadLine(pinNumber: number, x: number, y: number): string {
  return `  (pad "${pinNumber}" smd rect (at ${formatDraftNumber(x)} ${formatDraftNumber(y)}) (size 0.6 1.0) (layers "F.Cu" "F.Paste" "F.Mask"))`;
}

/**
 * Centers generated pads around the origin for deterministic draft geometry.
 */
function centeredPadOffset(index: number, count: number, pitch: number): number {
  return (index - (count - 1) / 2) * pitch;
}

/**
 * Maps a draftable asset target to its required extraction signal type.
 */
function signalTypeForTarget(targetAssetType: DraftableTarget): SourceExtractionSignalType {
  return targetAssetType === "footprint" ? "package_mechanical_dimensions" : "pin_table";
}

/**
 * Builds a deterministic asset id for generated drafts.
 */
function buildDraftAssetId(partId: string, targetAssetType: DraftableTarget): string {
  return `asset-draft-${slugify(partId)}-${targetAssetType}`;
}

/**
 * Builds a deterministic workflow id when the request was not already linked.
 */
function buildWorkflowId(partId: string, targetAssetType: DraftableTarget): string {
  return `gen-${partId}-${targetAssetType}`;
}

/**
 * Converts numeric database values to JavaScript numbers.
 */
function numeric(value: string | number | null): number {
  if (value === null) return 0;

  return typeof value === "number" ? value : Number(value);
}

/**
 * Formats draft numbers with enough precision for readable generated artifacts.
 */
function formatDraftNumber(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : "0";
}

/**
 * Escapes strings used in generated draft text bodies.
 */
function escapeDraftString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

/**
 * Converts ids and names into deterministic storage-safe fragments.
 */
function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "unknown";
}
