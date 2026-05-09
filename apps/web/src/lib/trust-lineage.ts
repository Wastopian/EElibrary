/**
 * File header: Builds the four-stage trust lineage strip for the part detail page.
 *
 * The strip exposes the four explicit, *non-blurring* stages a part progresses through:
 *
 *   imported → reviewed → approved → verified-for-export
 *
 * Each stage stays distinct so engineers can scan the chain without conflating
 * "we have data" (imported), "an admin reviewed it" (reviewed),
 * "engineering approved the part" (approved), and "an asset is verified for export"
 * (verified-for-export). Each stage has a state plus a one-line reason, so the
 * strip is honest even when the data is partial.
 */

import { getAssetPromotionSummary, getAssetReviewStatus, getWorkflowReviewStatus } from "@ee-library/shared/review-workflow";
import type {
  AssetPromotionSummary,
  BundleReadinessSummary,
  PartSearchRecord,
  ReviewStatusSummary
} from "@ee-library/shared/types";
import type { BadgeTone } from "@ee-library/ui";
import type { ViewTone } from "./detail-view-model";

/** TrustLineageStage names the four explicit gates a part passes through on its way to export. */
export type TrustLineageStage = "imported" | "reviewed" | "approved" | "verified_for_export";

/** TrustLineageStageState keeps the per-stage outcome explicit and non-blurring. */
export type TrustLineageStageState = "passed" | "pending" | "blocked" | "not_applicable";

/** TrustLineageStageSummary describes one scannable stage in the trust strip. */
export interface TrustLineageStageSummary {
  stage: TrustLineageStage;
  label: string;
  state: TrustLineageStageState;
  /** Short label suitable for a status badge (eg "Approved", "Pending review"). */
  badgeLabel: string;
  /** One-line plain-English reason (eg "No source rows recorded"). */
  detail: string;
  /** Tone aligned with the rest of the detail page. */
  tone: ViewTone;
}

/** TrustLineageSummary bundles all four stages with the explicit boundary copy. */
export interface TrustLineageSummary {
  stages: TrustLineageStageSummary[];
  /** Boundary reminder so the strip never blurs the four gates. */
  boundary: string;
}

const BOUNDARY_COPY =
  "Each step is separate: imported data, review sign-off, part approval, and export-ready assets.";

/** Fallback when a catalog/search projection omits bundle readiness so lineage stays honest without crashing. */
const CATALOG_FALLBACK_BUNDLE_READINESS: BundleReadinessSummary = {
  exportActions: [],
  fileBackedCadAssetCount: 0,
  label: "Unavailable",
  reason: "Bundle readiness is not included in this catalog projection.",
  referencedAssetCount: 0,
  state: "references_only",
  verifiedCadAssetCount: 0
};

const STAGE_ABBREV: Record<TrustLineageStage, string> = {
  approved: "Apr",
  imported: "Imp",
  reviewed: "Rev",
  verified_for_export: "Exp"
};

/** Compact gate row for catalog tables: four abbreviations stay visually distinct from approval/export badges alone. */
export interface CatalogTrustLineageBadge {
  abbrev: string;
  badgeTone: BadgeTone;
  stageKey: TrustLineageStage;
  stateMark: string;
  title: string;
}

/**
 * Resolves trust lineage for any `PartSearchRecord`, including sparse catalog projections.
 */
export function getTrustLineageSummaryForSearchRecord(record: PartSearchRecord): TrustLineageSummary {
  const bundleReadiness = record.bundleReadiness ?? CATALOG_FALLBACK_BUNDLE_READINESS;
  const assetReviewStatuses = record.assets.map((asset) => getAssetReviewStatus(asset, record.reviewRecords));
  const workflowReviewStatuses = record.generationWorkflows.map((workflow) =>
    getWorkflowReviewStatus(workflow, record.reviewRecords)
  );
  const promotionSummaries = record.assets.map((asset) =>
    getAssetPromotionSummary(asset, record.validationRecords, record.promotionAudits)
  );

  return getTrustLineageSummary(record, bundleReadiness, assetReviewStatuses, workflowReviewStatuses, promotionSummaries);
}

/**
 * Builds four compact badges for catalog scanning without collapsing stages into one label.
 */
export function buildCatalogTrustLineageBadges(record: PartSearchRecord): CatalogTrustLineageBadge[] {
  const summary = getTrustLineageSummaryForSearchRecord(record);

  return summary.stages.map((stage) => ({
    abbrev: STAGE_ABBREV[stage.stage],
    badgeTone: stage.tone as BadgeTone,
    stageKey: stage.stage,
    stateMark: formatCatalogTrustStateMark(stage.state),
    title: `${stage.label}: ${stage.badgeLabel}. ${stage.detail}`
  }));
}

function formatCatalogTrustStateMark(state: TrustLineageStageState): string {
  switch (state) {
    case "blocked":
      return "!";
    case "not_applicable":
      return "n/a";
    case "passed":
      return "OK";
    case "pending":
      return "…";
    default:
      return "?";
  }
}

/**
 * Builds the four-stage trust lineage strip for one part record.
 */
export function getTrustLineageSummary(
  record: PartSearchRecord,
  bundleReadiness: BundleReadinessSummary,
  assetReviewStatuses: ReviewStatusSummary[],
  workflowReviewStatuses: ReviewStatusSummary[],
  promotionSummaries: AssetPromotionSummary[]
): TrustLineageSummary {
  return {
    boundary: BOUNDARY_COPY,
    stages: [
      buildImportedStage(record),
      buildReviewedStage(assetReviewStatuses, workflowReviewStatuses),
      buildApprovedStage(record),
      buildVerifiedForExportStage(bundleReadiness, promotionSummaries)
    ]
  };
}

/**
 * Imported stage answers: did any provider source row land on this part?
 *
 * Sources can record success or failure; only success counts as imported.
 * Failed-only ingest is honestly reported as `blocked`.
 */
function buildImportedStage(record: PartSearchRecord): TrustLineageStageSummary {
  const importedCount = record.sources.filter((source) => source.importStatus === "imported").length;
  const failedCount = record.sources.filter((source) => source.importStatus === "failed").length;

  if (importedCount > 0) {
    return {
      badgeLabel: `${importedCount} source${importedCount === 1 ? "" : "s"} imported`,
      detail: `${importedCount} source ${pluralize("row", importedCount)} imported.`,
      label: "Imported",
      stage: "imported",
      state: "passed",
      tone: "info"
    };
  }

  if (failedCount > 0) {
    return {
      badgeLabel: "Import failed",
      detail: `${failedCount} import ${pluralize("attempt", failedCount)} failed.`,
      label: "Imported",
      stage: "imported",
      state: "blocked",
      tone: "danger"
    };
  }

  return {
    badgeLabel: "No source rows",
    detail: "No import rows yet.",
    label: "Imported",
    stage: "imported",
    state: "pending",
    tone: "neutral"
  };
}

/**
 * Reviewed stage answers: did at least one admin-sign-off review pass on an asset or workflow?
 *
 * Pending or change-requested reviews surface as `pending`; explicit rejections as `blocked`.
 */
function buildReviewedStage(
  assetReviewStatuses: ReviewStatusSummary[],
  workflowReviewStatuses: ReviewStatusSummary[]
): TrustLineageStageSummary {
  const statuses = [...assetReviewStatuses, ...workflowReviewStatuses];

  if (statuses.length === 0) {
    return {
      badgeLabel: "No review on file",
      detail: "No review records yet.",
      label: "Reviewed",
      stage: "reviewed",
      state: "pending",
      tone: "neutral"
    };
  }

  const approvedCount = statuses.filter(
    (status) => status.state === "approved" || status.state === "verified_for_export"
  ).length;
  const rejectedCount = statuses.filter((status) => status.state === "rejected").length;
  const pendingCount = statuses.filter((status) => status.state === "pending_review").length;
  const changeCount = statuses.filter((status) => status.state === "changes_requested").length;

  if (approvedCount > 0 && rejectedCount === 0 && changeCount === 0) {
    return {
      badgeLabel: `${approvedCount} reviewed`,
      detail: `${approvedCount} review ${pluralize("sign-off", approvedCount)} recorded.`,
      label: "Reviewed",
      stage: "reviewed",
      state: "passed",
      tone: "info"
    };
  }

  if (rejectedCount > 0) {
    return {
      badgeLabel: `${rejectedCount} rejected`,
      detail: `${rejectedCount} review ${pluralize("record", rejectedCount)} rejected.`,
      label: "Reviewed",
      stage: "reviewed",
      state: "blocked",
      tone: "danger"
    };
  }

  if (changeCount > 0) {
    return {
      badgeLabel: "Changes requested",
      detail: "At least one review needs changes before sign-off can continue.",
      label: "Reviewed",
      stage: "reviewed",
      state: "pending",
      tone: "review"
    };
  }

  if (pendingCount > 0) {
    return {
      badgeLabel: `${pendingCount} in review`,
      detail: `${pendingCount} review ${pluralize("record", pendingCount)} open.`,
      label: "Reviewed",
      stage: "reviewed",
      state: "pending",
      tone: "review"
    };
  }

  return {
    badgeLabel: "Mixed review state",
    detail: "Reviews exist but their outcomes do not yet move the trust chain forward.",
    label: "Reviewed",
    stage: "reviewed",
    state: "pending",
    tone: "review"
  };
}

/**
 * Approved stage answers: has the whole part received engineering approval?
 *
 * Mirrors the persisted `record.approval.status` rather than re-deriving it.
 */
function buildApprovedStage(record: PartSearchRecord): TrustLineageStageSummary {
  const approval = record.approval;

  if (approval.status === "approved") {
    return {
      badgeLabel: "Approved",
      detail: approval.detail || "Whole-part approval has been recorded. Approved does not unlock export by itself.",
      label: "Approved",
      stage: "approved",
      state: "passed",
      tone: "verified"
    };
  }

  if (approval.status === "pending_review") {
    return {
      badgeLabel: "Pending review",
      detail: approval.detail || "Approval review is open. Approval is decided separately from individual asset reviews.",
      label: "Approved",
      stage: "approved",
      state: "pending",
      tone: "review"
    };
  }

  if (approval.status === "not_requested") {
    return {
      badgeLabel: "Approval not requested",
      detail: approval.detail || "No approval request has been opened on this part.",
      label: "Approved",
      stage: "approved",
      state: "pending",
      tone: "neutral"
    };
  }

  return {
    badgeLabel: "Approval n/a",
    detail: approval.detail || "Approval is not applicable for this part.",
    label: "Approved",
    stage: "approved",
    state: "not_applicable",
    tone: "neutral"
  };
}

/**
 * Verified-for-export stage answers: does at least one asset have a complete promotion record AND a ready bundle?
 *
 * `bundleReadiness.state === "bundle_ready"` is the persisted truth that an export bundle would
 * include verified file-backed assets. We surface explicit "ready to promote" / "blocked" states
 * for the in-progress cases instead of folding them into approval or review.
 */
function buildVerifiedForExportStage(
  bundleReadiness: BundleReadinessSummary,
  promotionSummaries: AssetPromotionSummary[]
): TrustLineageStageSummary {
  const verifiedCount = bundleReadiness.verifiedCadAssetCount;
  const promotionReadyCount = promotionSummaries.filter((summary) => summary.canPromote).length;

  if (bundleReadiness.state === "bundle_ready" && verifiedCount > 0) {
    return {
      badgeLabel: `${verifiedCount} verified`,
      detail: `${verifiedCount} CAD ${pluralize("asset", verifiedCount)} verified for export. Bundle generation is unblocked.`,
      label: "Verified for export",
      stage: "verified_for_export",
      state: "passed",
      tone: "verified"
    };
  }

  if (promotionReadyCount > 0) {
    return {
      badgeLabel: `${promotionReadyCount} ready to promote`,
      detail: "Validation evidence is present for at least one asset. Verified-for-export still requires the explicit promotion action.",
      label: "Verified for export",
      stage: "verified_for_export",
      state: "pending",
      tone: "info"
    };
  }

  if (bundleReadiness.state === "partial_bundle" || bundleReadiness.state === "references_only") {
    return {
      badgeLabel: "Export blocked",
      detail: bundleReadiness.reason || "Some assets exist but are not verified-for-export. Bundle generation stays blocked.",
      label: "Verified for export",
      stage: "verified_for_export",
      state: "blocked",
      tone: "review"
    };
  }

  return {
    badgeLabel: "Not verified",
    detail: bundleReadiness.reason || "No verified-for-export assets are recorded for this part.",
    label: "Verified for export",
    stage: "verified_for_export",
    state: "pending",
    tone: "neutral"
  };
}

function pluralize(word: string, count: number, plural?: string): string {
  if (count === 1) return word;
  return plural ?? `${word}s`;
}
