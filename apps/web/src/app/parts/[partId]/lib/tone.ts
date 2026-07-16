/**
 * File header: Pure tone mappers that convert backend states into UI badge tones.
 *
 * No React, no fetches — only deterministic state-to-tone tables.
 */

import type {
  AssetClassReadiness,
  BundleReadinessState,
  DocumentAccessLevel,
  DocumentRedlineSeverity,
  DocumentRedlineStatus,
  DocumentRevisionLifecycleStatus,
  GenerationWorkflowState,
  InventoryStatus,
  PartAcquisitionSummary,
  PreviewStatus,
  ProjectPartUsageStatus,
  ValidationStatus
} from "@ee-library/shared/types";
import type { BadgeTone } from "@ee-library/ui";
import type { ViewTone } from "../../../../lib/detail-view-model";
import type { PartDetailPageDetail, PartDetailPageRecord } from "./types";

/**
 * Maps controlled document lifecycle values into badge tones.
 */
export function documentLifecycleTone(status: DocumentRevisionLifecycleStatus): BadgeTone {
  const tones: Record<DocumentRevisionLifecycleStatus, BadgeTone> = {
    archived: "neutral",
    draft: "info",
    expired: "danger",
    in_review: "review",
    released: "verified",
    superseded: "neutral"
  };

  return tones[status];
}

/**
 * Maps document access levels into badge tones without claiming enforcement.
 */
export function documentAccessTone(accessLevel: DocumentAccessLevel): BadgeTone {
  const tones: Record<DocumentAccessLevel, BadgeTone> = {
    internal: "info",
    itar_controlled: "danger",
    public: "neutral",
    restricted: "review"
  };

  return tones[accessLevel];
}

/**
 * Maps redline state and severity into badge tones.
 */
export function redlineStatusTone(status: DocumentRedlineStatus, severity: DocumentRedlineSeverity): BadgeTone {
  if (status !== "open") {
    return status === "resolved" ? "verified" : "neutral";
  }

  return severity === "blocker" ? "danger" : severity === "review" ? "review" : "info";
}

/**
 * Maps project usage status into review-oriented badge tones.
 */
export function usageStatusTone(status: ProjectPartUsageStatus): BadgeTone {
  const tones: Record<ProjectPartUsageStatus, BadgeTone> = {
    deprecated: "danger",
    in_review: "review",
    proposed: "info",
    released: "verified",
    used: "verified"
  };

  return tones[status];
}

/**
 * Maps commercial inventory status into sourcing badge tones.
 */
export function inventoryStatusTone(status: InventoryStatus): BadgeTone {
  const tones: Record<InventoryStatus, BadgeTone> = {
    backorder: "review",
    in_stock: "verified",
    out_of_stock: "danger",
    unknown: "neutral"
  };

  return tones[status];
}

/**
 * Maps confidence scores into UI badge tones.
 */
export function scoreTone(score: number): BadgeTone {
  if (score >= 0.8) return "verified";
  if (score >= 0.65) return "review";
  return "danger";
}

/**
 * Maps a per-spec parse confidence into a badge tone without alarm language. A moderately confident
 * parsed value ("56% confidence") is normal for distributor-derived data — it warrants "info", not the
 * red "danger" scoreTone gives overall part trust, which read as if the part itself were unsafe.
 */
export function metricConfidenceTone(score: number): BadgeTone {
  if (score >= 0.8) return "verified";
  if (score >= 0.5) return "info";
  return "review";
}

/**
 * Maps validation status into badge tone.
 */
export function validationTone(status: ValidationStatus): BadgeTone {
  const tones: Record<ValidationStatus, BadgeTone> = {
    failed: "danger",
    needs_review: "review",
    not_validated: "neutral",
    verified: "verified"
  };

  return tones[status];
}

/**
 * Maps asset class readiness into badge tone.
 */
export function assetClassReadinessTone(readiness: AssetClassReadiness): BadgeTone {
  const tones: Record<AssetClassReadiness, BadgeTone> = {
    downloaded_file: "review",
    export_ready: "verified",
    failed: "danger",
    missing: "neutral",
    reference_only: "review",
    validated_file: "verified"
  };

  return tones[readiness];
}

/**
 * Maps bundle readiness into badge tone.
 */
export function bundleReadinessTone(state: BundleReadinessState): BadgeTone {
  const tones: Record<BundleReadinessState, BadgeTone> = {
    bundle_ready: "verified",
    no_usable_assets: "neutral",
    partial_bundle: "review",
    references_only: "review"
  };

  return tones[state];
}

/**
 * Maps backend whole-part readiness into badge tone.
 */
export function readinessStatusTone(status: PartDetailPageRecord["readinessSummary"]["status"]): BadgeTone {
  const tones: Record<PartDetailPageRecord["readinessSummary"]["status"], BadgeTone> = {
    blocked: "danger",
    needs_attention: "review",
    ready_for_export_review: "verified",
    unknown: "neutral"
  };

  return tones[status];
}

/**
 * Maps backend whole-part approval into badge tone.
 */
export function approvalStatusTone(status: PartDetailPageRecord["approval"]["status"]): BadgeTone {
  const tones: Record<PartDetailPageRecord["approval"]["status"], BadgeTone> = {
    approved: "verified",
    not_applicable: "neutral",
    not_requested: "review",
    pending_review: "info"
  };

  return tones[status];
}

/**
 * Maps acquisition job status into explicit badge tone without treating import as approval.
 */
export function acquisitionJobStatusTone(status: NonNullable<PartAcquisitionSummary["lastJobStatus"]>): BadgeTone {
  const tones: Record<NonNullable<PartAcquisitionSummary["lastJobStatus"]>, BadgeTone> = {
    failed: "review",
    queued: "info",
    running: "info",
    succeeded: "info"
  };

  return tones[status];
}

/**
 * Maps enrichment job status into explicit badge tone without treating enrichment as approval or verification.
 */
export function enrichmentJobStatusTone(
  status: NonNullable<PartDetailPageDetail["enrichmentSummary"]["latestJobStatus"]>
): BadgeTone {
  const tones: Record<
    NonNullable<PartDetailPageDetail["enrichmentSummary"]["latestJobStatus"]>,
    BadgeTone
  > = {
    failed: "danger",
    queued: "info",
    running: "info",
    succeeded: "verified"
  };

  return tones[status];
}

/**
 * Maps generation workflow state into review-oriented badge tone.
 */
export function generationWorkflowTone(state: GenerationWorkflowState): BadgeTone {
  const tones: Record<GenerationWorkflowState, BadgeTone> = {
    approved: "info",
    available_to_request: "info",
    failed: "danger",
    generated: "generated",
    processing: "review",
    queued: "review",
    requested: "info",
    review_required: "generated",
    unavailable: "neutral"
  };

  return tones[state];
}

/**
 * Bridges the view-model tone vocabulary to the UI badge tone vocabulary.
 */
export function mapViewToneToBadge(tone: ViewTone): BadgeTone {
  return tone as BadgeTone;
}

/**
 * Maps preview status into badge tone.
 */
export function previewTone(status: PreviewStatus): BadgeTone {
  const tones: Record<PreviewStatus, BadgeTone> = {
    not_available: "neutral",
    pending: "review",
    ready: "verified"
  };

  return tones[status];
}
