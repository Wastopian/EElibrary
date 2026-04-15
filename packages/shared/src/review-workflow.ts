/**
 * File header: Defines seed-free review status resolution and approval transition rules.
 */

import { isFileBackedAsset, isValidatedDownloadableAsset } from "./asset-state";
import type { Asset, AssetPromotionAuditRecord, AssetPromotionSummary, AssetValidationRecord, AssetValidationSummary, AssetValidationType, GenerationWorkflow, ReviewOutcome, ReviewRecord, ReviewState, ReviewStatusSummary } from "./types";

/** EXPORT_REVIEW_ASSET_TYPES are the CAD classes that can become export-package inputs. */
const EXPORT_REVIEW_ASSET_TYPES = new Set<Asset["assetType"]>(["footprint", "symbol", "three_d_model"]);

/** QUALIFYING_VALIDATION_TYPES maps CAD asset classes to validation evidence that can support promotion. */
const QUALIFYING_VALIDATION_TYPES: Record<Asset["assetType"], AssetValidationType[]> = {
  datasheet: [],
  footprint: ["footprint_geometry", "manual_engineering_review"],
  mechanical_drawing: [],
  symbol: ["symbol_pin_mapping", "manual_engineering_review"],
  three_d_model: ["three_d_geometry", "manual_engineering_review"]
};

/**
 * Builds latest review states for every asset in a record.
 */
export function getAssetReviewStatuses(assets: Asset[], reviewRecords: ReviewRecord[]): ReviewStatusSummary[] {
  return assets.map((asset) => getAssetReviewStatus(asset, reviewRecords));
}

/**
 * Builds latest review states for every generation workflow in a record.
 */
export function getWorkflowReviewStatuses(workflows: GenerationWorkflow[], reviewRecords: ReviewRecord[]): ReviewStatusSummary[] {
  return workflows.map((workflow) => getWorkflowReviewStatus(workflow, reviewRecords));
}

/**
 * Builds latest validation evidence summaries for every asset in a record.
 */
export function getAssetValidationSummaries(assets: Asset[], validationRecords: AssetValidationRecord[]): AssetValidationSummary[] {
  return assets.map((asset) => getAssetValidationSummary(asset, validationRecords));
}

/**
 * Builds promotion history summaries with current blocker reasons for every asset.
 */
export function getAssetPromotionSummaries(assets: Asset[], validationRecords: AssetValidationRecord[], promotionAudits: AssetPromotionAuditRecord[]): AssetPromotionSummary[] {
  return assets.map((asset) => getAssetPromotionSummary(asset, validationRecords, promotionAudits));
}

/**
 * Resolves one asset's current review state from explicit review records and asset evidence.
 */
export function getAssetReviewStatus(asset: Asset, reviewRecords: ReviewRecord[]): ReviewStatusSummary {
  const latestReview = getLatestReviewForAsset(reviewRecords, asset.id);

  return {
    latestReview,
    state: resolveAssetReviewState(asset, latestReview),
    targetId: asset.id,
    targetType: "asset"
  };
}

/**
 * Resolves one generation workflow's current review state from explicit review records and workflow state.
 */
export function getWorkflowReviewStatus(workflow: GenerationWorkflow, reviewRecords: ReviewRecord[]): ReviewStatusSummary {
  const latestReview = getLatestReviewForWorkflow(reviewRecords, workflow.id);

  return {
    latestReview,
    state: resolveWorkflowReviewState(workflow, latestReview),
    targetId: workflow.id,
    targetType: "generation_workflow"
  };
}

/**
 * Resolves one asset's latest validation evidence summary.
 */
export function getAssetValidationSummary(asset: Asset, validationRecords: AssetValidationRecord[]): AssetValidationSummary {
  const latestValidation = getLatestValidationForAsset(validationRecords, asset.id);

  if (!latestValidation) {
    return {
      assetId: asset.id,
      label: "No validation evidence",
      latestValidation,
      reason: "No durable validation evidence is recorded for this asset."
    };
  }

  return {
    assetId: asset.id,
    label: `${formatValidationStatus(latestValidation.validationStatus)} validation evidence`,
    latestValidation,
    reason: `${formatValidationType(latestValidation.validationType)} by ${latestValidation.validator} at ${latestValidation.validatedAt}.${latestValidation.validationNotes ? ` ${latestValidation.validationNotes}` : ""}`
  };
}

/**
 * Resolves one asset's promotion history and current promotion blockers.
 */
export function getAssetPromotionSummary(asset: Asset, validationRecords: AssetValidationRecord[], promotionAudits: AssetPromotionAuditRecord[]): AssetPromotionSummary {
  const promotionHistory = promotionAudits.filter((audit) => audit.assetId === asset.id).sort(comparePromotionAudits);
  const latestPromotion = promotionHistory[0] ?? null;
  const blockerReasons = getAssetPromotionBlockers(asset, validationRecords);

  return {
    assetId: asset.id,
    blockerReasons,
    canPromote: blockerReasons.length === 0,
    label: latestPromotion ? `${latestPromotion.promotionOutcome} promotion` : "No promotion attempts",
    latestPromotion,
    promotionHistory
  };
}

/**
 * Finds the latest review record for one asset.
 */
export function getLatestReviewForAsset(reviewRecords: ReviewRecord[], assetId: string): ReviewRecord | null {
  return getLatestReview(reviewRecords.filter((review) => review.targetType === "asset" && review.assetId === assetId));
}

/**
 * Finds the latest review record for one generation workflow.
 */
export function getLatestReviewForWorkflow(reviewRecords: ReviewRecord[], workflowId: string): ReviewRecord | null {
  return getLatestReview(reviewRecords.filter((review) => review.targetType === "generation_workflow" && review.generationWorkflowId === workflowId));
}

/**
 * Finds the latest validation record for one asset.
 */
export function getLatestValidationForAsset(validationRecords: AssetValidationRecord[], assetId: string): AssetValidationRecord | null {
  return [...validationRecords].filter((record) => record.assetId === assetId).sort(compareValidationRecords)[0] ?? null;
}

/**
 * Finds the latest qualifying validation evidence for one asset.
 */
export function getQualifyingValidationForAsset(asset: Asset, validationRecords: AssetValidationRecord[]): AssetValidationRecord | null {
  const qualifyingTypes = QUALIFYING_VALIDATION_TYPES[asset.assetType];

  return (
    [...validationRecords]
      .filter((record) => record.assetId === asset.id && record.validationStatus === "verified" && qualifyingTypes.includes(record.validationType))
      .sort(compareValidationRecords)[0] ?? null
  );
}

/**
 * Applies the review outcome to one asset without treating approval as automatic export verification.
 */
export function applyAssetReviewOutcome(asset: Asset, outcome: ReviewOutcome): Asset {
  if (outcome === "rejected") {
    return {
      ...asset,
      availabilityStatus: "failed",
      assetState: "failed",
      assetStatus: "failed",
      exportStatus: "not_exportable",
      reviewStatus: "rejected",
      validationStatus: "failed"
    };
  }

  if (outcome === "changes_requested") {
    return {
      ...asset,
      assetStatus: "reviewed",
      exportStatus: "not_exportable",
      reviewStatus: "changes_requested",
      validationStatus: "needs_review"
    };
  }

  return {
    ...asset,
    assetStatus: "reviewed",
    exportStatus: asset.exportStatus === "verified_for_export" ? "verified_for_export" : "not_exportable",
    reviewStatus: "approved",
    validationStatus: asset.validationStatus === "failed" ? "failed" : "verified"
  };
}

/**
 * Checks whether an asset can be explicitly promoted into export verification.
 */
export function canPromoteAssetToVerifiedForExport(asset: Asset, validationRecords: AssetValidationRecord[] = []): boolean {
  return getAssetPromotionBlockers(asset, validationRecords).length === 0;
}

/**
 * Returns precise blockers for the separate export-verification promotion step.
 */
export function getAssetPromotionBlockers(asset: Asset, validationRecords: AssetValidationRecord[] = []): string[] {
  const blockers: string[] = [];

  if (asset.exportStatus === "verified_for_export" && isValidatedDownloadableAsset(asset)) {
    blockers.push("Asset is already verified for export.");
  }

  if (!EXPORT_REVIEW_ASSET_TYPES.has(asset.assetType)) {
    blockers.push("Only footprint, symbol, and 3D model assets can be promoted for export.");
  }

  if (!isFileBackedAsset(asset)) {
    blockers.push("Promotion requires file-backed storage and hash evidence.");
  }

  if (asset.availabilityStatus !== "downloaded" && asset.availabilityStatus !== "validated") {
    blockers.push("Promotion requires a downloaded or validated asset.");
  }

  if (asset.reviewStatus !== "approved") {
    blockers.push("Promotion requires an explicit approved review state.");
  }

  if (asset.validationStatus !== "verified") {
    blockers.push("Promotion requires verified validation state after review.");
  }

  if (asset.licenseMode !== "redistribution_allowed") {
    blockers.push("Promotion requires redistribution-allowed licensing.");
  }

  if (!getQualifyingValidationForAsset(asset, validationRecords)) {
    blockers.push("Promotion requires qualifying verified validation evidence.");
  }

  return blockers;
}

/**
 * Applies the explicit export-verification promotion once all blockers are cleared.
 */
export function promoteAssetToVerifiedForExport(asset: Asset, validationRecords: AssetValidationRecord[] = []): Asset {
  if (!canPromoteAssetToVerifiedForExport(asset, validationRecords)) {
    return asset;
  }

  return {
    ...asset,
    assetState: "validated",
    assetStatus: "verified_for_export",
    availabilityStatus: "validated",
    exportStatus: "verified_for_export",
    reviewStatus: "approved",
    validationStatus: "verified"
  };
}

/**
 * Legacy compatibility helper: approval alone no longer promotes an asset.
 */
export function canAssetBecomeVerifiedForExport(asset: Asset, outcome: ReviewOutcome): boolean {
  return outcome === "approved" && canPromoteAssetToVerifiedForExport(asset);
}

/**
 * Applies the review outcome to one generation workflow without verifying its output asset.
 */
export function applyWorkflowReviewOutcome(workflow: GenerationWorkflow, outcome: ReviewOutcome): GenerationWorkflow {
  if (outcome === "approved") {
    return { ...workflow, generationStatus: "approved" };
  }

  if (outcome === "rejected") {
    return { ...workflow, generationStatus: "failed" };
  }

  return { ...workflow, generationStatus: "review_required" };
}

/**
 * Resolves asset review state from explicit decisions plus export evidence.
 */
function resolveAssetReviewState(asset: Asset, latestReview: ReviewRecord | null): ReviewState {
  if (isValidatedDownloadableAsset(asset)) {
    return "verified_for_export";
  }

  if (latestReview) {
    return latestReview.outcome;
  }

  if (asset.reviewStatus === "rejected" || asset.validationStatus === "failed" || asset.availabilityStatus === "failed") {
    return "rejected";
  }

  if (asset.reviewStatus === "changes_requested") {
    return "changes_requested";
  }

  if (asset.reviewStatus === "approved") {
    return "approved";
  }

  if (asset.provenance === "generated" || asset.reviewStatus === "review_required" || asset.validationStatus === "needs_review") {
    return "pending_review";
  }

  return "not_required";
}

/**
 * Resolves workflow review state from explicit decisions plus generation status.
 */
function resolveWorkflowReviewState(workflow: GenerationWorkflow, latestReview: ReviewRecord | null): ReviewState {
  if (latestReview) {
    return latestReview.outcome;
  }

  if (workflow.generationStatus === "approved") {
    return "approved";
  }

  if (workflow.generationStatus === "failed") {
    return "rejected";
  }

  if (workflow.generationStatus === "generated" || workflow.generationStatus === "review_required") {
    return "pending_review";
  }

  return "not_required";
}

/**
 * Selects the latest review deterministically by review time and id.
 */
function getLatestReview(reviewRecords: ReviewRecord[]): ReviewRecord | null {
  return [...reviewRecords].sort((left, right) => Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt) || right.id.localeCompare(left.id))[0] ?? null;
}

/**
 * Sorts validation records newest-first with deterministic id tie-breaks.
 */
function compareValidationRecords(left: AssetValidationRecord, right: AssetValidationRecord): number {
  return Date.parse(right.validatedAt) - Date.parse(left.validatedAt) || right.id.localeCompare(left.id);
}

/**
 * Sorts promotion audit records newest-first with deterministic id tie-breaks.
 */
function comparePromotionAudits(left: AssetPromotionAuditRecord, right: AssetPromotionAuditRecord): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id);
}

/**
 * Formats validation status values for API/UI summaries.
 */
function formatValidationStatus(status: AssetValidationRecord["validationStatus"]): string {
  return {
    failed: "Failed",
    needs_review: "Review-required",
    not_validated: "Unvalidated",
    verified: "Verified"
  }[status];
}

/**
 * Formats validation type values without leaking implementation details.
 */
function formatValidationType(type: AssetValidationType): string {
  return {
    file_integrity: "File integrity",
    footprint_geometry: "Footprint geometry",
    manual_engineering_review: "Manual engineering review",
    symbol_pin_mapping: "Symbol pin mapping",
    three_d_geometry: "3D geometry"
  }[type];
}
