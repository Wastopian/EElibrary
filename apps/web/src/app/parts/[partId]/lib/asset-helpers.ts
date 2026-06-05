/**
 * File header: Pure helpers around asset trust checks, validation lookup, and
 * document-control gating decisions for the part detail page.
 *
 * These were extracted from page.tsx to keep the route file focused on
 * composition. None of them touch React or server actions directly.
 */

import type {
  Asset,
  AssetClassReadiness,
  AssetPromotionSummary,
  AssetValidationSummary,
  ControlledDocumentRevision,
  DocumentAccessLevel,
  ReviewStatusSummary
} from "@ee-library/shared/types";
import type { BadgeTone } from "@ee-library/ui";
import { formatDateTime } from "./format";
import type { AssetTrustCheckSummary, PartDocumentControlState } from "./types";

/**
 * Builds a map of asset ids to their most-restrictive active controlled-document revision.
 */
export function buildAssetGatingMap(state: PartDocumentControlState): Map<string, ControlledDocumentRevision> {
  const map = new Map<string, ControlledDocumentRevision>();

  if (state.status !== "available") {
    return map;
  }

  for (const revision of state.response.revisions) {
    if (revision.lifecycleStatus === "archived") continue;
    if (revision.accessLevel !== "restricted" && revision.accessLevel !== "itar_controlled") continue;

    const existing = map.get(revision.assetId);
    if (!existing || accessLevelRank(revision.accessLevel) > accessLevelRank(existing.accessLevel)) {
      map.set(revision.assetId, revision);
    }
  }

  return map;
}

/**
 * Compares access levels with most-restrictive first. ITAR outranks plain restricted.
 */
export function accessLevelRank(level: DocumentAccessLevel): number {
  if (level === "itar_controlled") return 2;
  if (level === "restricted") return 1;
  return 0;
}

/**
 * Returns a UI badge label and tone matching the access level for the gating chip.
 */
export function gatedAccessBadge(level: DocumentAccessLevel): { label: string; tone: BadgeTone } {
  if (level === "itar_controlled") return { label: "ITAR controlled", tone: "danger" };
  if (level === "restricted") return { label: "Restricted", tone: "review" };
  return { label: level, tone: "neutral" };
}

/**
 * Finds validation evidence for one asset and falls back to explicit missing evidence.
 */
export function findAssetValidationSummary(summaries: AssetValidationSummary[], asset: Asset): AssetValidationSummary {
  return (
    summaries.find((summary) => summary.assetId === asset.id) ?? {
      assetId: asset.id,
      label: "No validation evidence",
      latestValidation: null,
      reason: "No durable validation evidence is recorded for this asset."
    }
  );
}

/**
 * Finds promotion history for one asset and falls back to current blockers being unknown.
 */
export function findAssetPromotionSummary(summaries: AssetPromotionSummary[], asset: Asset): AssetPromotionSummary {
  return (
    summaries.find((summary) => summary.assetId === asset.id) ?? {
      assetId: asset.id,
      blockerReasons: ["Promotion state is unavailable from the API response."],
      canPromote: false,
      label: "No promotion attempts",
      latestPromotion: null,
      promotionHistory: []
    }
  );
}

/**
 * Builds the top files-panel trust check copy when no asset row exists yet.
 */
export function buildMissingAssetTrustCheckSummary(): AssetTrustCheckSummary {
  return {
    detail: "No file exists for this class yet, so there is nothing for an engineer or validator to check.",
    label: "No file to check",
    tone: "neutral"
  };
}

/**
 * Converts validation evidence into a plain asset trust check result for engineers.
 */
export function buildAssetTrustCheckSummary(asset: Asset, summary: AssetValidationSummary): AssetTrustCheckSummary {
  const latestValidation = summary.latestValidation;

  if (latestValidation) {
    const checkType = formatAssetValidationType(latestValidation.validationType);
    const note = latestValidation.validationNotes ? ` ${latestValidation.validationNotes}` : "";
    const detail = `${checkType} by ${latestValidation.validator} on ${formatDateTime(latestValidation.validatedAt)}.${note}`;

    if (latestValidation.validationStatus === "verified") {
      return {
        detail,
        label: "Check passed",
        tone: "verified"
      };
    }

    if (latestValidation.validationStatus === "failed") {
      return {
        detail: `${detail} Do not rely on this file until the failure is reviewed or replaced.`,
        label: "Check failed",
        tone: "danger"
      };
    }

    if (latestValidation.validationStatus === "needs_review") {
      return {
        detail: `${detail} Engineering review is still required before this file can support export promotion.`,
        label: "Needs review",
        tone: "review"
      };
    }

    return {
      detail: `${detail} This check has not produced usable validation evidence yet.`,
      label: "Not checked",
      tone: "neutral"
    };
  }

  if (!isAutomatedTrustCheckAsset(asset)) {
    return {
      detail: "No automated CAD check is defined for this file class yet. Use manual review and attached evidence before relying on it.",
      label: "Manual review",
      tone: "neutral"
    };
  }

  if (asset.validationStatus === "failed") {
    return {
      detail: "The asset is marked as failed, but no durable validation record is attached. Review or replace the file before using it.",
      label: "Check failed",
      tone: "danger"
    };
  }

  if (asset.validationStatus === "needs_review") {
    return {
      detail: "The file exists, but no durable check result is attached yet. Run or review CAD checks before promotion.",
      label: "Needs review",
      tone: "review"
    };
  }

  if (asset.validationStatus === "verified") {
    return {
      detail: "The asset is marked verified, but no durable validation record is attached in this response. Confirm evidence before promotion.",
      label: "Verify evidence",
      tone: "review"
    };
  }

  return {
    detail: "No CAD check evidence is recorded yet. The file can be inspected, but it should not be treated as trusted for export.",
    label: "Not checked",
    tone: "neutral"
  };
}

/**
 * Returns true for file classes covered by automated CAD validation jobs.
 */
export function isAutomatedTrustCheckAsset(asset: Asset): boolean {
  return asset.assetType === "footprint" || asset.assetType === "symbol" || asset.assetType === "three_d_model";
}

/**
 * Formats validation evidence types without leaking validator implementation names.
 */
export function formatAssetValidationType(type: NonNullable<AssetValidationSummary["latestValidation"]>["validationType"]): string {
  return {
    file_integrity: "File integrity check",
    footprint_geometry: "Footprint geometry check",
    manual_engineering_review: "Manual engineering review",
    symbol_pin_mapping: "Symbol pin-count check",
    three_d_geometry: "3D model geometry check"
  }[type];
}

/**
 * Maps the best asset class state into dense workstation copy without implying stronger certainty.
 */
export function formatAssetClassReadinessLabel(readiness: AssetClassReadiness): string {
  const labels: Record<AssetClassReadiness, string> = {
    downloaded_file: "Downloaded file on hand",
    export_ready: "Export-ready best asset",
    failed: "Failed asset state",
    missing: "No asset coverage",
    reference_only: "Reference-only record",
    validated_file: "Validated file on hand"
  };

  return labels[readiness];
}

/**
 * Explains what the current best-asset class state means for review and export work.
 */
export function formatAssetClassReadinessDetail(readiness: AssetClassReadiness, assetCount: number): string {
  const coverageLabel = assetCount === 1 ? "1 candidate row is stored." : `${assetCount} candidate rows are stored.`;
  const detailByReadiness: Record<AssetClassReadiness, string> = {
    downloaded_file: "A stored file exists, but it still needs stronger validation or final verification before bundles can rely on it.",
    export_ready: "The best-ranked asset already carries the strongest review, validation, and export evidence available in this class.",
    failed: "The best-ranked row is currently a failed asset record and does not support export work.",
    missing: "No asset rows are stored for this class yet.",
    reference_only: "Only URL-level provenance exists for this class, so engineers can inspect provenance without treating it as a usable file.",
    validated_file: "A validated file is present, but it still needs a final verification step before export."
  };

  return `${detailByReadiness[readiness]} ${coverageLabel}`;
}

/**
 * Summarizes the current review and promotion lane for one best-ranked asset.
 */
export function buildAssetWorkflowSurfaceSummary(asset: Asset, promotionSummary: AssetPromotionSummary, reviewStatus: ReviewStatusSummary): { detail: string; title: string } {
  if (asset.exportStatus === "verified_for_export" || reviewStatus.state === "verified_for_export") {
    return {
      detail: "Review, validation evidence, and explicit promotion are all recorded, so this asset can satisfy export bundle gates.",
      title: "Verified for export"
    };
  }

  if (promotionSummary.canPromote) {
    return {
      detail: "Review and validation evidence line up. The remaining step is an explicit promotion action to make this asset export-authoritative.",
      title: "Ready for promotion"
    };
  }

  if (reviewStatus.state === "pending_review") {
    return {
      detail: "The file is visible in the workspace, but engineering review still has to complete before promotion can even be considered.",
      title: "Awaiting review"
    };
  }

  if (reviewStatus.state === "changes_requested") {
    return {
      detail: "Review feedback is open, so this asset should stay out of export decisions until a corrected revision is reviewed again.",
      title: "Changes requested"
    };
  }

  if (reviewStatus.state === "rejected") {
    return {
      detail: "Rejected assets remain visible for audit trail purposes, but they cannot satisfy trust or export readiness.",
      title: "Rejected"
    };
  }

  if (reviewStatus.state === "approved" && asset.validationStatus !== "verified") {
    return {
      detail: "Review is complete, but validation evidence still needs to catch up before export promotion can open.",
      title: "Approved, validation pending"
    };
  }

  if (asset.validationStatus === "failed") {
    return {
      detail: "Current validation evidence blocks this asset from promotion and keeps it outside export-authoritative workflows.",
      title: "Validation failed"
    };
  }

  if (asset.validationStatus === "needs_review") {
    return {
      detail: "The asset exists, but validation still needs engineering attention before it can move toward export-authoritative status.",
      title: "Validation review needed"
    };
  }

  return {
    detail: "The asset is tracked with provenance, but the review and validation lane is still incomplete for export work.",
    title: "Evidence still incomplete"
  };
}

/**
 * Checks whether an asset can be put under document control in the current UI.
 */
export function isControlledDocumentAsset(asset: Asset): boolean {
  return asset.assetType === "datasheet" || asset.assetType === "mechanical_drawing";
}

/**
 * Finds a precomputed review status and falls back to a neutral state if the target is not reviewable.
 */
export function findReviewStatus(
  reviewStatuses: ReviewStatusSummary[],
  targetType: ReviewStatusSummary["targetType"],
  targetId: string
): ReviewStatusSummary {
  return (
    reviewStatuses.find((status) => status.targetType === targetType && status.targetId === targetId) ?? {
      latestReview: null,
      state: "not_required",
      targetId,
      targetType
    }
  );
}
