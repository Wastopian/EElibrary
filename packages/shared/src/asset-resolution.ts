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
  GenerationTargetAssetType,
  GenerationWorkflow,
  PartSearchRecord
} from "./types";

/** ENGINEERING_ASSET_TYPES is the normalized order for first-class engineering assets. */
export const ENGINEERING_ASSET_TYPES = ["symbol", "footprint", "three_d_model", "datasheet", "mechanical_drawing"] as const satisfies readonly AssetType[];

/** GENERATABLE_ASSET_TYPES are the asset classes supported by the Phase 3A generation foundation. */
const GENERATABLE_ASSET_TYPES = new Set<AssetType>(["footprint", "symbol", "three_d_model"]);

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
 * Builds generation options for missing or non-export-ready generatable asset classes.
 */
export function getGenerationOptions(record: PartSearchRecord, assetGroups: AssetClassSummary[] = resolveAssetClassSummaries(record.assets)): AssetGenerationOption[] {
  return record.generationWorkflows
    .filter((workflow) => GENERATABLE_ASSET_TYPES.has(workflow.targetAssetType))
    .filter((workflow) => shouldShowGenerationOption(workflow, assetGroups))
    .map((workflow) => buildGenerationOption(record, workflow))
    .sort((left, right) => left.targetAssetType.localeCompare(right.targetAssetType) || left.workflowId.localeCompare(right.workflowId));
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
 * Returns true when a workflow targets a class that still lacks an export-ready best asset.
 */
function shouldShowGenerationOption(workflow: GenerationWorkflow, assetGroups: AssetClassSummary[]): boolean {
  if (workflow.generationStatus === "completed") {
    return false;
  }

  const targetGroup = assetGroups.find((group) => group.assetType === workflow.targetAssetType);
  return targetGroup?.bestAsset ? !isValidatedDownloadableAsset(targetGroup.bestAsset) : true;
}

/**
 * Builds one user-visible generation option from a stored workflow.
 */
function buildGenerationOption(record: PartSearchRecord, workflow: GenerationWorkflow): AssetGenerationOption {
  const sourceAsset = workflow.sourceAssetId ? record.assets.find((asset) => asset.id === workflow.sourceAssetId) ?? null : null;

  return {
    confidenceScore: workflow.confidenceScore,
    generationStatus: workflow.generationStatus,
    label: generationOptionLabel(workflow.targetAssetType),
    reason: generationOptionReason(workflow.targetAssetType, workflow, sourceAsset),
    sourceAssetId: workflow.sourceAssetId,
    sourceDatasheetRevisionId: workflow.sourceDatasheetRevisionId,
    targetAssetType: workflow.targetAssetType,
    workflowId: workflow.id
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
 * Explains why a generation option is available without claiming generation succeeded.
 */
function generationOptionReason(targetAssetType: GenerationTargetAssetType, workflow: GenerationWorkflow, sourceAsset: Asset | null): string {
  if (workflow.generationStatus === "blocked") {
    return "Generation is blocked until required source data is reviewed.";
  }

  if (targetAssetType === "three_d_model" && sourceAsset?.assetType === "mechanical_drawing") {
    return `${sourceAsset.assetState} mechanical drawing is available as generation input.`;
  }

  if (targetAssetType === "three_d_model") {
    return "Mechanical drawing input is not registered yet.";
  }

  if (sourceAsset?.assetType !== "datasheet") {
    return "Datasheet-derived source data is not registered yet.";
  }

  return "Datasheet-derived source data is available for a generation workflow.";
}
