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
  PartSearchRecord
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
  const referencedAssetCount = record.assets.filter((asset) => asset.assetState === "referenced").length;

  if (readyBundleCount > 0) {
    return {
      exportActions,
      fileBackedCadAssetCount,
      label: "bundle ready",
      reason: readyBundleCount === 1 ? "One export bundle has all required verified file-backed assets." : `${readyBundleCount} export bundles have all required verified file-backed assets.`,
      referencedAssetCount,
      state: "bundle_ready",
      verifiedCadAssetCount
    };
  }

  if (fileBackedCadAssetCount > 0) {
    return {
      exportActions,
      fileBackedCadAssetCount,
      label: "partial bundle",
      reason: "Some CAD files exist, but no export bundle has every required asset verified for export.",
      referencedAssetCount,
      state: "partial_bundle",
      verifiedCadAssetCount
    };
  }

  if (referencedAssetCount > 0) {
    return {
      exportActions,
      fileBackedCadAssetCount,
      label: "references only",
      reason: "Only referenced metadata is available; no file-backed CAD assets are ready for export.",
      referencedAssetCount,
      state: "references_only",
      verifiedCadAssetCount
    };
  }

  return {
    exportActions,
    fileBackedCadAssetCount,
    label: "no usable assets",
    reason: "No usable asset records are available for export or generation evidence.",
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

  const stateScores: Record<Asset["assetState"], number> = {
    downloaded: 250,
    failed: -200,
    missing: 0,
    referenced: 100,
    validated: 400
  };

  return stateScores[asset.assetState];
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
  const statusScores: Record<Asset["assetStatus"], number> = {
    downloaded: 20,
    failed: -100,
    missing: 0,
    referenced: 10,
    reviewed: 30,
    validated: 60,
    verified_for_export: 120
  };

  return validationScores[asset.validationStatus] + statusScores[asset.assetStatus];
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
  if (bestAsset.assetState === "validated") return "validated_file";
  if (bestAsset.assetState === "downloaded") return "downloaded_file";
  if (bestAsset.assetState === "referenced") return "reference_only";
  if (bestAsset.assetState === "failed") return "failed";
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
    approved: "The generated asset has been approved, but export still requires a separate verified file-backed asset.",
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

  if (!record.datasheetRevision) {
    reasons.push("No datasheet revision is registered for package evidence.");
  }

  if (record.package.pinCount === null) reasons.push("Package pin count is missing.");
  if (record.package.pitchMm === null) reasons.push("Package pitch is missing.");
  if (record.package.bodyLengthMm === null || record.package.bodyWidthMm === null) reasons.push("Package body dimensions are incomplete.");

  return {
    ready: reasons.length === 0,
    reasons: reasons.length === 0 ? ["Package pin count, pitch, and body dimensions are available for a reviewed footprint request."] : reasons,
    requiredMaterial: "package_mechanical_data",
    sourceAssetId: record.datasheetRevision?.fileAssetId ?? null,
    sourceDatasheetRevisionId: record.datasheetRevision?.id ?? null,
    targetAssetType: "footprint"
  };
}

/**
 * Checks reviewed pin-table source metadata needed to request symbol generation.
 */
function evaluateSymbolSourceReadiness(record: PartSearchRecord): GenerationSourceReadiness {
  const reasons: string[] = [];

  if (!record.datasheetRevision) {
    reasons.push("No datasheet revision is registered for pin-table evidence.");
  } else if (record.datasheetRevision.pinTableStatus === "not_available") {
    reasons.push("No reviewed pin-table source is registered.");
  } else if (record.datasheetRevision.pinTableStatus === "needs_review") {
    reasons.push("Pin-table source is registered and will require review during generation.");
  }

  if (record.package.pinCount === null) {
    reasons.push("Package pin count is missing.");
  }

  const ready = Boolean(record.datasheetRevision && record.datasheetRevision.pinTableStatus !== "not_available" && record.package.pinCount !== null);

  return {
    ready,
    reasons: ready && reasons.length === 0 ? ["Reviewed pin-table source is available for a symbol request."] : reasons,
    requiredMaterial: "pin_table_data",
    sourceAssetId: record.datasheetRevision?.fileAssetId ?? null,
    sourceDatasheetRevisionId: record.datasheetRevision?.id ?? null,
    targetAssetType: "symbol"
  };
}

/**
 * Checks mechanical drawing availability needed to request 3D model generation.
 */
function evaluateThreeDSourceReadiness(record: PartSearchRecord): GenerationSourceReadiness {
  const mechanicalDrawing = selectBestAvailableAsset(record.assets.filter((asset) => asset.assetType === "mechanical_drawing"));
  const hasUsableDrawing = Boolean(mechanicalDrawing && mechanicalDrawing.assetState !== "missing" && mechanicalDrawing.assetState !== "failed");
  const reasons = hasUsableDrawing ? [`${mechanicalDrawing?.assetState ?? "Referenced"} mechanical drawing is available for a reviewed 3D request.`] : ["No usable mechanical drawing source is registered."];

  return {
    ready: hasUsableDrawing,
    reasons,
    requiredMaterial: "mechanical_drawing",
    sourceAssetId: hasUsableDrawing ? mechanicalDrawing?.id ?? null : null,
    sourceDatasheetRevisionId: record.datasheetRevision?.id ?? null,
    targetAssetType: "three_d_model"
  };
}
