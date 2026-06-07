/**
 * File header: Provides seed-free engineering asset grouping, ranking, and generation option helpers.
 */

import { isFileBackedAsset, isValidatedDownloadableAsset } from "./asset-state";
import { getExportAvailability } from "./catalog-runtime";
import type {
  Asset,
  AssetClassSummary,
  AssetGenerationOption,
  AssetType,
  BundleReadinessSummary,
  GenerationRequest,
  GenerationTargetAssetType,
  GenerationWorkflowState,
  GenerationWorkflow,
  GenerationSourceReadiness,
  PartSearchRecord,
  SourceExtractionSignal,
  SourceExtractionSignalType
} from "./types";

/** ENGINEERING_ASSET_TYPES is the normalized order for first-class engineering assets. */
export const ENGINEERING_ASSET_TYPES = ["symbol", "footprint", "three_d_model", "datasheet", "mechanical_drawing"] as const satisfies readonly AssetType[];

/** GENERATION_TARGET_ASSET_TYPES is the stable UI/API order for requestable CAD assets. */
const GENERATION_TARGET_ASSET_TYPES = ["footprint", "symbol", "three_d_model"] as const satisfies readonly GenerationTargetAssetType[];

/**
 * Groups assets by normalized engineering asset class and selects the best available asset in each group.
 */
export function resolveAssetClassSummaries(assets: Asset[]): AssetClassSummary[] {
  return ENGINEERING_ASSET_TYPES.map((assetType) => {
    const groupAssets = assets.filter((asset) => asset.assetType === assetType).sort(compareAssetsForBest);

    return {
      assetType,
      assets: groupAssets,
      bestAsset: groupAssets[0] ?? null,
      readiness: resolveClassReadiness(groupAssets[0] ?? null)
    };
  });
}

/**
 * Selects one best available asset using export readiness, validation, provenance, recency, and id tie-breaks.
 */
export function selectBestAvailableAsset(assets: Asset[]): Asset | null {
  return [...assets].sort(compareAssetsForBest)[0] ?? null;
}

/**
 * Builds an honest bundle readiness summary from file-backed and verified CAD evidence.
 */
export function getBundleReadinessSummary(record: PartSearchRecord): BundleReadinessSummary {
  const exportActions = getExportAvailability(record);
  const readyBundleCount = exportActions.filter((action) => action.available).length;
  const cadAssets = record.assets.filter((asset) => asset.assetType === "footprint" || asset.assetType === "symbol" || asset.assetType === "three_d_model");
  const verifiedCadAssetCount = cadAssets.filter(isValidatedDownloadableAsset).length;
  const fileBackedCadAssetCount = cadAssets.filter(isFileBackedAsset).length;
  const referencedAssetCount = record.assets.filter((asset) => asset.availabilityStatus === "referenced").length;

  if (readyBundleCount > 0) {
    return {
      exportActions,
      fileBackedCadAssetCount,
      label: "bundle ready",
      reason: readyBundleCount === 1 ? "One export bundle has all required stored and verified files." : `${readyBundleCount} export bundles have all required stored and verified files.`,
      referencedAssetCount,
      state: "bundle_ready",
      verifiedCadAssetCount
    };
  }

  if (fileBackedCadAssetCount > 0) {
    return {
      exportActions,
      fileBackedCadAssetCount,
      label: "partial package",
      reason: "Some CAD files exist, but no export package has every required file marked verified.",
      referencedAssetCount,
      state: "partial_bundle",
      verifiedCadAssetCount
    };
  }

  if (referencedAssetCount > 0) {
    return {
      exportActions,
      fileBackedCadAssetCount,
      label: "links only",
      reason: "Only links are on file; no stored CAD files are ready for export.",
      referencedAssetCount,
      state: "references_only",
      verifiedCadAssetCount
    };
  }

  return {
    exportActions,
    fileBackedCadAssetCount,
    label: "no usable files",
    reason: "No usable files are on file for export or generation.",
    referencedAssetCount,
    state: "no_usable_assets",
    verifiedCadAssetCount
  };
}

/**
 * Builds requestability and workflow summaries for missing or non-export-ready generatable asset classes.
 */
export function getGenerationOptions(record: PartSearchRecord, assetGroups: AssetClassSummary[] = resolveAssetClassSummaries(record.assets)): AssetGenerationOption[] {
  return GENERATION_TARGET_ASSET_TYPES
    .filter((targetAssetType) => shouldShowGenerationOption(record, targetAssetType, assetGroups))
    .map((targetAssetType) => buildGenerationOption(record, targetAssetType));
}

/**
 * Evaluates whether a part has enough normalized source material to request generation.
 */
export function evaluateGenerationSourceReadiness(record: PartSearchRecord, targetAssetType: GenerationTargetAssetType): GenerationSourceReadiness {
  if (targetAssetType === "footprint") {
    return evaluateFootprintSourceReadiness(record);
  }

  if (targetAssetType === "symbol") {
    return evaluateSymbolSourceReadiness(record);
  }

  return evaluateThreeDSourceReadiness(record);
}

/**
 * Compares two assets for best-available selection.
 */
function compareAssetsForBest(left: Asset, right: Asset): number {
  return (
    assetRankingScore(right) - assetRankingScore(left) ||
    Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Scores an asset without treating references as downloads or generated assets as official.
 */
function assetRankingScore(asset: Asset): number {
  return readinessScore(asset) + validationScore(asset) + provenanceScore(asset);
}

/**
 * Scores concrete file readiness and export verification evidence.
 */
function readinessScore(asset: Asset): number {
  if (isValidatedDownloadableAsset(asset)) return 600;

  const stateScores: Record<Asset["availabilityStatus"], number> = {
    downloaded: 250,
    failed: -200,
    missing: 0,
    referenced: 100,
    validated: 400
  };

  return stateScores[asset.availabilityStatus];
}

/**
 * Scores validation and review/export status independently from file availability.
 */
function validationScore(asset: Asset): number {
  const validationScores: Record<Asset["validationStatus"], number> = {
    failed: -100,
    needs_review: 10,
    not_validated: 0,
    verified: 80
  };
  const reviewScores: Record<Asset["reviewStatus"], number> = {
    approved: 30,
    changes_requested: -20,
    not_reviewed: 0,
    rejected: -100,
    review_required: 10
  };
  const exportScores: Record<Asset["exportStatus"], number> = {
    not_exportable: 0,
    partially_exportable: 50,
    verified_for_export: 120
  };

  return validationScores[asset.validationStatus] + reviewScores[asset.reviewStatus] + exportScores[asset.exportStatus];
}

/**
 * Scores provenance without making generated or manual assets outrank stronger readiness evidence.
 */
function provenanceScore(asset: Asset): number {
  const provenanceScores: Record<Asset["provenance"], number> = {
    generated: 20,
    manual_internal: 10,
    official: 40,
    trusted_external: 30
  };

  return provenanceScores[asset.provenance];
}

/**
 * Summarizes one asset class by the best asset's concrete state.
 */
function resolveClassReadiness(bestAsset: Asset | null): AssetClassSummary["readiness"] {
  if (!bestAsset) return "missing";
  if (isValidatedDownloadableAsset(bestAsset)) return "export_ready";
  if (bestAsset.availabilityStatus === "validated") return "validated_file";
  if (bestAsset.availabilityStatus === "downloaded") return "downloaded_file";
  if (bestAsset.availabilityStatus === "referenced") return "reference_only";
  if (bestAsset.availabilityStatus === "failed") return "failed";
  return "missing";
}

/**
 * Returns true when a target class still lacks an export-ready best asset.
 */
function shouldShowGenerationOption(record: PartSearchRecord, targetAssetType: GenerationTargetAssetType, assetGroups: AssetClassSummary[]): boolean {
  const targetGroup = assetGroups.find((group) => group.assetType === targetAssetType);
  const hasWorkflowState = record.generationRequests.some((request) => request.targetAssetType === targetAssetType) || record.generationWorkflows.some((workflow) => workflow.targetAssetType === targetAssetType && workflow.generationStatus !== "available_to_request" && workflow.generationStatus !== "unavailable");

  if (hasWorkflowState) {
    return true;
  }

  if (!targetGroup?.bestAsset) {
    return true;
  }

  return targetGroup.readiness === "missing" || targetGroup.readiness === "failed" || targetGroup.readiness === "reference_only";
}

/**
 * Builds one user-visible generation option from readiness, requests, and workflow state.
 */
function buildGenerationOption(record: PartSearchRecord, targetAssetType: GenerationTargetAssetType): AssetGenerationOption {
  const sourceReadiness = evaluateGenerationSourceReadiness(record, targetAssetType);
  const workflow = findWorkflow(record.generationWorkflows, targetAssetType);
  const latestRequest = findLatestRequest(record.generationRequests, targetAssetType);
  const workflowStatus = resolveWorkflowStatus(sourceReadiness, workflow, latestRequest);

  return {
    actionLabel: generationActionLabel(targetAssetType),
    canRequest: workflowStatus === "available_to_request",
    confidenceScore: workflow?.confidenceScore ?? 0,
    generationStatus: workflowStatus,
    label: generationOptionLabel(targetAssetType),
    latestRequest,
    reason: generationOptionReason(workflowStatus, sourceReadiness),
    sourceAssetId: sourceReadiness.sourceAssetId,
    sourceDatasheetRevisionId: sourceReadiness.sourceDatasheetRevisionId,
    sourceReadiness,
    targetAssetType,
    workflow,
    workflowId: workflow?.id ?? latestRequest?.workflowId ?? null,
    workflowStatus,
    workflowStatusLabel: workflowStatusLabel(workflowStatus)
  };
}

/**
 * Labels a generation option by the intended engineering source.
 */
function generationOptionLabel(targetAssetType: GenerationTargetAssetType): string {
  const labels: Record<GenerationTargetAssetType, string> = {
    footprint: "Generate footprint from datasheet",
    symbol: "Generate symbol from pin table",
    three_d_model: "Generate 3D from mechanical drawing"
  };

  return labels[targetAssetType];
}

/**
 * Labels the request action without implying generation has already happened.
 */
function generationActionLabel(targetAssetType: GenerationTargetAssetType): string {
  const labels: Record<GenerationTargetAssetType, string> = {
    footprint: "Request footprint generation",
    symbol: "Request symbol generation",
    three_d_model: "Request 3D generation"
  };

  return labels[targetAssetType];
}

/**
 * Explains why a generation option is available or blocked without claiming success.
 */
function generationOptionReason(workflowStatus: GenerationWorkflowState, sourceReadiness: GenerationSourceReadiness): string {
  if (!sourceReadiness.ready) {
    return sourceReadiness.reasons.join(" ");
  }

  const statusReasons: Record<GenerationWorkflowState, string> = {
    approved: "The generated asset has been approved, but export still requires a separate stored, verified file.",
    available_to_request: sourceReadiness.reasons.join(" "),
    failed: "The latest generation workflow failed; review the failure before requesting more work.",
    generated: "A generated output is recorded and still needs review before it can be trusted.",
    processing: "The generation workflow is processing and has not produced an export-ready asset.",
    queued: "The generation request is queued and has not produced an output asset.",
    requested: "The generation request has been recorded and is waiting for processing.",
    review_required: "A generated output is waiting for review and is not export-ready.",
    unavailable: sourceReadiness.reasons.join(" ")
  };

  return statusReasons[workflowStatus];
}

/**
 * Labels workflow states for compact UI badges.
 */
function workflowStatusLabel(workflowStatus: GenerationWorkflowState): string {
  const labels: Record<GenerationWorkflowState, string> = {
    approved: "approved",
    available_to_request: "request available",
    failed: "failed",
    generated: "generated, review needed",
    processing: "processing",
    queued: "queued",
    requested: "requested",
    review_required: "in review",
    unavailable: "not available"
  };

  return labels[workflowStatus];
}

/**
 * Finds the active workflow row for a target asset class.
 */
function findWorkflow(workflows: GenerationWorkflow[], targetAssetType: GenerationTargetAssetType): GenerationWorkflow | null {
  return workflows.find((workflow) => workflow.targetAssetType === targetAssetType) ?? null;
}

/**
 * Finds the latest persisted generation request for a target asset class.
 */
function findLatestRequest(requests: GenerationRequest[], targetAssetType: GenerationTargetAssetType): GenerationRequest | null {
  return (
    requests
      .filter((request) => request.targetAssetType === targetAssetType)
      .sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt) || right.id.localeCompare(left.id))[0] ?? null
  );
}

/**
 * Resolves a user-facing workflow state from source readiness plus persisted records.
 */
function resolveWorkflowStatus(sourceReadiness: GenerationSourceReadiness, workflow: GenerationWorkflow | null, latestRequest: GenerationRequest | null): GenerationWorkflowState {
  if (latestRequest) {
    return latestRequest.requestStatus;
  }

  if (workflow && workflow.generationStatus !== "available_to_request" && workflow.generationStatus !== "unavailable") {
    return workflow.generationStatus;
  }

  return sourceReadiness.ready ? "available_to_request" : "unavailable";
}

/**
 * Checks package and datasheet metadata needed to request footprint generation.
 */
function evaluateFootprintSourceReadiness(record: PartSearchRecord): GenerationSourceReadiness {
  const reasons: string[] = [];
  const signal = selectBestExtractionSignal(record.extractionSignals, "package_mechanical_dimensions");

  appendExtractionSignalReason(reasons, signal, "Package/mechanical dimensions");

  if (record.package.pinCount === null) reasons.push("Package pin count is missing.");
  if (record.package.pitchMm === null) reasons.push("Package pitch is missing.");
  if (record.package.bodyLengthMm === null || record.package.bodyWidthMm === null) reasons.push("Package body dimensions are incomplete.");

  const ready = Boolean(signal && supportsExtraction(signal) && record.package.pinCount !== null && record.package.pitchMm !== null && record.package.bodyLengthMm !== null && record.package.bodyWidthMm !== null);

  return {
    extractionConfidence: signal?.confidenceScore ?? 0,
    extractionSignalIds: signal ? [signal.id] : [],
    ready,
    reasons: ready ? [successExtractionReason(signal, "Package pin count, pitch, and body dimensions support a footprint request.")] : reasons,
    requiredMaterial: "package_mechanical_data",
    sourceAssetId: signal?.assetId ?? record.datasheetRevision?.fileAssetId ?? null,
    sourceDatasheetRevisionId: signal?.datasheetRevisionId ?? record.datasheetRevision?.id ?? null,
    targetAssetType: "footprint"
  };
}

/**
 * Checks reviewed pin-table source metadata needed to request symbol generation.
 */
function evaluateSymbolSourceReadiness(record: PartSearchRecord): GenerationSourceReadiness {
  const reasons: string[] = [];
  const signal = selectBestExtractionSignal(record.extractionSignals, "pin_table");

  appendExtractionSignalReason(reasons, signal, "Pin table");

  if (record.package.pinCount === null) {
    reasons.push("Package pin count is missing.");
  }

  const ready = Boolean(signal && supportsExtraction(signal) && record.package.pinCount !== null);

  return {
    extractionConfidence: signal?.confidenceScore ?? 0,
    extractionSignalIds: signal ? [signal.id] : [],
    ready,
    reasons: ready ? [successExtractionReason(signal, "Extracted pin table and package pin count support a symbol request.")] : reasons,
    requiredMaterial: "pin_table_data",
    sourceAssetId: signal?.assetId ?? record.datasheetRevision?.fileAssetId ?? null,
    sourceDatasheetRevisionId: signal?.datasheetRevisionId ?? record.datasheetRevision?.id ?? null,
    targetAssetType: "symbol"
  };
}

/**
 * Checks mechanical drawing availability needed to request 3D model generation.
 */
function evaluateThreeDSourceReadiness(record: PartSearchRecord): GenerationSourceReadiness {
  const mechanicalDrawing = selectBestAvailableAsset(record.assets.filter((asset) => asset.assetType === "mechanical_drawing"));
  const signal = selectBestExtractionSignal(record.extractionSignals, "mechanical_drawing");
  const hasUsableDrawing = Boolean(mechanicalDrawing && mechanicalDrawing.availabilityStatus !== "missing" && mechanicalDrawing.availabilityStatus !== "failed");
  const reasons: string[] = [];
  appendExtractionSignalReason(reasons, signal, "Mechanical drawing");

  if (!hasUsableDrawing) {
    reasons.push("No usable mechanical drawing asset is registered.");
  }

  const ready = Boolean(signal && supportsExtraction(signal) && hasUsableDrawing);

  return {
    extractionConfidence: signal?.confidenceScore ?? 0,
    extractionSignalIds: signal ? [signal.id] : [],
    ready,
    reasons: ready ? [successExtractionReason(signal, `${mechanicalDrawing?.availabilityStatus ?? "referenced"} mechanical drawing supports a reviewed 3D request.`)] : reasons,
    requiredMaterial: "mechanical_drawing",
    sourceAssetId: ready ? signal?.assetId ?? mechanicalDrawing?.id ?? null : null,
    sourceDatasheetRevisionId: signal?.datasheetRevisionId ?? record.datasheetRevision?.id ?? null,
    targetAssetType: "three_d_model"
  };
}

/**
 * Selects the strongest extraction signal for one source material type.
 */
function selectBestExtractionSignal(signals: SourceExtractionSignal[], signalType: SourceExtractionSignalType): SourceExtractionSignal | null {
  return [...signals]
    .filter((signal) => signal.signalType === signalType)
    .sort((left, right) => extractionSignalScore(right) - extractionSignalScore(left) || Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt) || left.id.localeCompare(right.id))[0] ?? null;
}

/**
 * Scores extracted evidence while keeping unavailable records below usable evidence.
 */
function extractionSignalScore(signal: SourceExtractionSignal): number {
  const statusScores: Record<SourceExtractionSignal["extractionStatus"], number> = {
    available: 200,
    needs_review: 120,
    not_available: 0
  };

  return statusScores[signal.extractionStatus] + signal.confidenceScore;
}

/**
 * Checks whether a signal is real extraction support, even if review is still needed.
 */
function supportsExtraction(signal: SourceExtractionSignal): boolean {
  return signal.extractionStatus === "available" || signal.extractionStatus === "needs_review";
}

/**
 * Adds explicit unavailable/review reasons for a source extraction signal.
 */
function appendExtractionSignalReason(reasons: string[], signal: SourceExtractionSignal | null, label: string): void {
  if (!signal) {
    reasons.push(`No extracted ${label.toLowerCase()} signal is registered.`);
    return;
  }

  if (signal.extractionStatus === "not_available") {
    reasons.push(`${label} extraction is not available.${signal.notes ? ` ${signal.notes}` : ""}`);
    return;
  }

  if (signal.extractionStatus === "needs_review") {
    reasons.push(`${label} extraction exists but needs review before generation work can be trusted.${signal.notes ? ` ${signal.notes}` : ""}`);
  }
}

/**
 * Builds one concise success reason from an extraction signal.
 */
function successExtractionReason(signal: SourceExtractionSignal | null, baseReason: string): string {
  if (!signal) {
    return baseReason;
  }

  const confidence = `${Math.round(signal.confidenceScore * 100)}% extraction confidence`;
  const reviewNote = signal.extractionStatus === "needs_review" ? " It still needs review before output trust can increase." : "";

  return `${baseReason} Source signal ${signal.id} has ${confidence} from ${formatExtractionSource(signal.extractionSource)}.${reviewNote}`;
}

/**
 * Formats extraction source classes for API/UI reasons without naming provider internals.
 */
function formatExtractionSource(source: SourceExtractionSignal["extractionSource"]): string {
  const labels: Record<SourceExtractionSignal["extractionSource"], string> = {
    asset_reference: "an asset reference",
    datasheet_metadata: "datasheet metadata",
    manual_internal: "internal review metadata",
    provider_structured_metadata: "structured provider metadata"
  };

  return labels[source];
}
