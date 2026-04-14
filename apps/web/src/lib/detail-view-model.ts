/**
 * File header: Provides testable provider-neutral UI wording and section visibility helpers.
 */

import { getBundleReadinessSummary } from "@ee-library/shared/asset-resolution";
import type { Asset, AssetGenerationOption, BundleReadinessState, GenerationWorkflow, PartSearchRecord, ReviewState, ReviewStatusSummary } from "@ee-library/shared/types";

/** ViewTone mirrors shared badge tones without coupling this helper to UI components. */
export type ViewTone = "neutral" | "info" | "verified" | "review" | "danger";

/** ExportReadinessLabel is the search-card label plus its visual tone. */
export interface ExportReadinessLabel {
  /** User-facing export readiness label. */
  label: string;
  /** Visual tone for the label. */
  tone: ViewTone;
}

/**
 * Returns true only when connector-specific sections have meaningful connector data.
 */
export function shouldRenderConnectorSections(record: PartSearchRecord): boolean {
  return record.connectorFamily !== null || record.mateRelations.length > 0 || record.accessoryRequirements.length > 0 || record.cableCompatibilities.length > 0;
}

/**
 * Formats parse confidence without pretending a missing datasheet revision means zero confidence.
 */
export function formatDatasheetParseConfidence(parseConfidence: number | null | undefined): string {
  return parseConfidence === null || parseConfidence === undefined ? "No parse confidence" : `${Math.round(parseConfidence * 100)}% parse confidence`;
}

/**
 * Formats generation workflow status without treating planned outputs as generated files.
 */
export function formatGenerationWorkflowLabel(workflow: GenerationWorkflow, assets: Asset[]): string {
  const output = formatWorkflowOutput(workflow, assets);

  return `${workflow.targetAssetType} generation is ${workflow.generationStatus} at ${Math.round(workflow.confidenceScore * 100)}% confidence (${output})`;
}

/**
 * Returns true only when a stored missing-asset workflow should be rendered as a fallback action.
 */
export function shouldRenderGenerationOptions(generationOptions: AssetGenerationOption[]): boolean {
  return generationOptions.length > 0;
}

/**
 * Formats review state for reviewer-facing asset and workflow badges.
 */
export function formatReviewStateLabel(state: ReviewState): string {
  const labels: Record<ReviewState, string> = {
    approved: "approved",
    changes_requested: "changes requested",
    not_required: "no review required",
    pending_review: "pending review",
    rejected: "rejected",
    verified_for_export: "verified for export"
  };

  return labels[state];
}

/**
 * Maps review state into UI tones without putting UI code into shared runtime helpers.
 */
export function reviewStateTone(state: ReviewState): ViewTone {
  const tones: Record<ReviewState, ViewTone> = {
    approved: "info",
    changes_requested: "review",
    not_required: "neutral",
    pending_review: "review",
    rejected: "danger",
    verified_for_export: "verified"
  };

  return tones[state];
}

/**
 * Returns true when local/dev review action buttons should be visible for a target.
 */
export function shouldRenderReviewActions(status: ReviewStatusSummary): boolean {
  return status.state !== "verified_for_export" && status.state !== "not_required";
}

/**
 * Builds a precise search-result export readiness label.
 */
export function getSearchExportReadiness(record: PartSearchRecord): ExportReadinessLabel {
  const summary = getBundleReadinessSummary(record);

  return {
    label: summary.label,
    tone: bundleReadinessTone(summary.state)
  };
}

/**
 * Maps bundle readiness into search-card badge tone.
 */
function bundleReadinessTone(state: BundleReadinessState): ViewTone {
  const tones: Record<BundleReadinessState, ViewTone> = {
    bundle_ready: "verified",
    no_usable_assets: "neutral",
    partial_bundle: "review",
    references_only: "review"
  };

  return tones[state];
}

/**
 * Formats the output side of a generation workflow with completed-vs-planned wording.
 */
function formatWorkflowOutput(workflow: GenerationWorkflow, assets: Asset[]): string {
  if (!workflow.outputAssetId) {
    return "no output asset";
  }

  const outputAsset = assets.find((asset) => asset.id === workflow.outputAssetId);

  if (workflow.generationStatus === "approved") {
    return outputAsset ? `approved output ${workflow.outputAssetId}` : `approved output ${workflow.outputAssetId} is not registered`;
  }

  if (workflow.generationStatus === "generated" || workflow.generationStatus === "review_required") {
    return outputAsset ? `review output ${workflow.outputAssetId}` : `review output ${workflow.outputAssetId} is not registered`;
  }

  return outputAsset ? `planned output ${workflow.outputAssetId}` : `planned output ${workflow.outputAssetId} is not registered`;
}
