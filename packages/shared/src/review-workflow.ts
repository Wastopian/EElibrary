/**
 * File header: Defines seed-free review status resolution and approval transition rules.
 */

import { isFileBackedAsset, isValidatedDownloadableAsset } from "./asset-state";
import type { Asset, GenerationWorkflow, ReviewOutcome, ReviewRecord, ReviewState, ReviewStatusSummary } from "./types";

/** EXPORT_REVIEW_ASSET_TYPES are the CAD classes that can become export-package inputs. */
const EXPORT_REVIEW_ASSET_TYPES = new Set<Asset["assetType"]>(["footprint", "symbol", "three_d_model"]);

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
 * Checks whether an explicit approval can move an asset into verified-for-export state.
 */
export function canAssetBecomeVerifiedForExport(asset: Asset, outcome: ReviewOutcome): boolean {
  return (
    outcome === "approved" &&
    EXPORT_REVIEW_ASSET_TYPES.has(asset.assetType) &&
    (asset.assetState === "downloaded" || asset.assetState === "validated") &&
    asset.validationStatus !== "failed" &&
    asset.licenseMode === "redistribution_allowed" &&
    isFileBackedAsset(asset)
  );
}

/**
 * Applies the review outcome to one asset without treating approval as automatic export verification.
 */
export function applyAssetReviewOutcome(asset: Asset, outcome: ReviewOutcome): Asset {
  if (outcome === "rejected") {
    return {
      ...asset,
      assetState: "failed",
      assetStatus: "failed",
      validationStatus: "failed"
    };
  }

  if (outcome === "changes_requested") {
    return {
      ...asset,
      assetStatus: "reviewed",
      validationStatus: "needs_review"
    };
  }

  if (canAssetBecomeVerifiedForExport(asset, outcome)) {
    return {
      ...asset,
      assetState: "validated",
      assetStatus: "verified_for_export",
      validationStatus: "verified"
    };
  }

  return {
    ...asset,
    assetStatus: "reviewed",
    validationStatus: asset.validationStatus === "failed" ? "failed" : "verified"
  };
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

  if (asset.assetStatus === "failed" || asset.validationStatus === "failed" || asset.assetState === "failed") {
    return "rejected";
  }

  if (asset.provenance === "generated" || asset.assetStatus === "downloaded" || asset.assetStatus === "validated" || asset.assetStatus === "reviewed" || asset.validationStatus === "needs_review") {
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
