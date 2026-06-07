/**
 * File header: Provides testable provider-neutral UI wording and section visibility helpers.
 */

import { getBundleReadinessSummary, getGenerationOptions } from "@ee-library/shared/asset-resolution";
import { isFileBackedAsset, isValidatedDownloadableAsset } from "@ee-library/shared/asset-state";
import type {
  Asset,
  AssetClassSummary,
  AssetGenerationOption,
  AssetPromotionSummary,
  AssetValidationSummary,
  BundleReadinessState,
  BundleReadinessSummary,
  GenerationWorkflow,
  PartAcquisitionSummary,
  PartEnrichmentSummary,
  PartIssueCode,
  PartSearchRecord,
  ReviewState,
  ReviewStatusSummary
} from "@ee-library/shared/types";

/** ViewTone mirrors shared badge tones without coupling this helper to UI components. */
export type ViewTone = "neutral" | "info" | "verified" | "review" | "danger" | "generated";

/** ExportReadinessLabel is the search-card label plus its visual tone. */
export interface ExportReadinessLabel {
  /** User-facing export readiness label. */
  label: string;
  /** Visual tone for the label. */
  tone: ViewTone;
}

/** WorkflowSignalLabel summarizes one scan-speed cue without hiding uncertainty. */
export interface WorkflowSignalLabel {
  /** Short badge label for a result card or hero summary. */
  label: string;
  /** Supporting copy that explains the evidence behind the label. */
  detail: string;
  /** Visual tone for this signal. */
  tone: ViewTone;
}

/** QuickReadinessAction is one concrete next step for quick-check triage. */
export interface QuickReadinessAction {
  /** Short action label grounded in existing catalog state. */
  label: string;
  /** Priority level for scan-speed ordering. */
  priority: "high" | "medium" | "low";
}

/** QuickReadinessSummary adapts a catalog record into V3-style explainable triage copy. */
export interface QuickReadinessSummary {
  /** Short headline that describes whether the part can move forward. */
  headline: string;
  /** One-line readiness explanation derived from existing summaries. */
  subhead: string;
  /** Longer explanation that keeps export and review boundaries explicit. */
  detail: string;
  /** Deterministic next actions based on visible blockers. */
  actions: QuickReadinessAction[];
  /** Key checks shown in the quick result card. */
  checks: WorkflowSignalLabel[];
  /** Status tone for the headline. */
  tone: ViewTone;
}

/** QuickReadinessDataCoverage explains whether the compact result has enough source data. */
export interface QuickReadinessDataCoverage {
  /** Short label for the quick-check result. */
  label: string;
  /** Explanation of missing or present readiness inputs. */
  detail: string;
  /** Tone for compact status badges. */
  tone: ViewTone;
  /** True when the quick summary is missing important record families. */
  partial: boolean;
}

/** PartNextAction is one practical follow-up derived from backend readiness truth. */
export interface PartNextAction {
  /** Stable action id used in tests and rendering keys. */
  id: string;
  /** Short label suitable for catalog rows and detail hero panels. */
  label: string;
  /** Explanation of what the action does and why it is next. */
  detail: string;
  /** Route or in-page anchor for the action. */
  href: string;
  /** Whether the action points to a currently implemented workflow surface. */
  available: boolean;
  /** Visual tone for badge/action styling. */
  tone: ViewTone;
  /** Scan-speed ordering for primary and secondary actions. */
  priority: "primary" | "secondary";
}

/** DetailCompletenessChecklistItem summarizes one engineering-readiness checkpoint for the part detail page. */
export interface DetailCompletenessChecklistItem {
  /** Stable item id for rendering and test targeting. */
  id: string;
  /** Short label shown in the checklist row. */
  label: string;
  /** Compact state label such as Available, Review, Blocked, or Missing. */
  stateLabel: string;
  /** Underlying checklist state keeps the rendered tone and copy explicit. */
  state: "available" | "review" | "blocked" | "missing" | "neutral";
  /** Detail explains the currently recorded evidence without inventing certainty. */
  detail: string;
  /** Tone keeps checklist badges aligned with the rest of the detail page. */
  tone: ViewTone;
}

/** DetailEnrichmentStatusItem summarizes one persisted enrichment job for the part detail page. */
export interface DetailEnrichmentStatusItem {
  /** Stable persisted job id used for rendering and test targeting. */
  id: string;
  /** Short label shown for the enrichment work item. */
  label: string;
  /** Compact state label such as Queued, Running, Succeeded, or Failed. */
  stateLabel: string;
  /** Underlying item state keeps the rendered tone explicit. */
  state: "available" | "review" | "blocked" | "neutral";
  /** Detail explains what the background job did or why it did not complete. */
  detail: string;
  /** Tone keeps enrichment badges aligned with the rest of the detail page. */
  tone: ViewTone;
  /** Requested time remains visible without making the page infer job order. */
  requestedAt: string;
  /** Completed time is explicit when the job reached a terminal state. */
  completedAt: string | null;
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
 * Formats asset source context without hiding generated draft provenance.
 */
export function formatAssetSourceLabel(asset: Asset, assetCount: number): string {
  if (asset.provenance === "generated") {
    return `Best of ${assetCount} / generated draft`;
  }

  return asset.sourceRecordId ? `Best of ${assetCount} / source record attached` : `Best of ${assetCount} / no source record`;
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
 * Formats the asset trust stage without collapsing generated, approved, and verified states.
 */
export function formatAssetTrustStageLabel(asset: Asset, state: ReviewState): string {
  if (isValidatedDownloadableAsset(asset)) {
    return "verified for export";
  }

  if (asset.provenance === "generated" && state === "approved") {
    return "approved draft";
  }

  if (asset.provenance === "generated" && state === "rejected") {
    return "rejected draft";
  }

  if (asset.provenance === "generated" && state === "changes_requested") {
    return "changes requested";
  }

  if (asset.provenance === "generated") {
    return "generated draft";
  }

  return formatReviewStateLabel(state);
}

/**
 * Maps asset trust stage into UI tones with generated drafts staying review-colored.
 */
export function assetTrustStageTone(asset: Asset, state: ReviewState): ViewTone {
  if (isValidatedDownloadableAsset(asset)) {
    return "verified";
  }

  if (asset.provenance === "generated" && state === "approved") {
    return "info";
  }

  if (asset.provenance === "generated" && state === "rejected") {
    return "danger";
  }

  if (asset.provenance === "generated" && state === "changes_requested") {
    return "review";
  }

  if (asset.provenance === "generated") {
    return "generated";
  }

  return reviewStateTone(state);
}

/**
 * Returns true when local/dev review action buttons should be visible for a target.
 */
export function shouldRenderReviewActions(status: ReviewStatusSummary): boolean {
  return status.state !== "verified_for_export" && status.state !== "not_required";
}

/**
 * Returns true only when precomputed validation-backed promotion rules allow the action.
 */
export function shouldRenderAssetPromotionAction(summary: AssetPromotionSummary): boolean {
  return summary.canPromote;
}

/**
 * Formats latest validation evidence for the engineering asset card body.
 */
export function formatAssetValidationEvidence(summary: AssetValidationSummary): string {
  return summary.reason;
}

/**
 * Formats the latest promotion audit without implying a successful promotion happened.
 */
export function formatAssetPromotionHistory(summary: AssetPromotionSummary): string {
  if (!summary.latestPromotion) {
    return "No promotion attempts have been recorded.";
  }

  const blockerText = summary.latestPromotion.blockerReasons.length > 0 ? ` Blockers: ${summary.latestPromotion.blockerReasons.join(" ")}` : "";
  const validationText = summary.latestPromotion.validationRecordId ? ` Evidence: ${summary.latestPromotion.validationRecordId}.` : "";

  return `${summary.latestPromotion.promotionOutcome} at ${summary.latestPromotion.createdAt} by ${summary.latestPromotion.actor}.${validationText}${blockerText}`;
}

/**
 * Formats current promotion blockers for disabled or hidden promotion actions.
 */
export function formatAssetPromotionBlockers(summary: AssetPromotionSummary): string {
  return summary.blockerReasons.length > 0 ? summary.blockerReasons.join(" ") : "Promotion requirements are satisfied.";
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
 * Builds a compact search cue for file-backed CAD, generated drafts, and reference-only assets.
 */
export function getAssetTruthSummary(record: PartSearchRecord): WorkflowSignalLabel {
  const cadAssets = record.assets.filter(isCadAsset);
  const verifiedCadCount = cadAssets.filter(isValidatedDownloadableAsset).length;
  const fileBackedCadCount = cadAssets.filter(isFileBackedAsset).length;
  const generatedDraftCount = cadAssets.filter((asset) => asset.provenance === "generated" && !isValidatedDownloadableAsset(asset)).length;
  const referencedCadCount = cadAssets.filter((asset) => asset.availabilityStatus === "referenced").length;

  if (verifiedCadCount > 0) {
    return {
      detail: `${fileBackedCadCount} stored CAD ${pluralize("file", fileBackedCadCount)} recorded; only verified files count toward export readiness.`,
      label: `${verifiedCadCount} verified CAD ${pluralize("asset", verifiedCadCount)}`,
      tone: "verified"
    };
  }

  if (generatedDraftCount > 0) {
    return {
      detail: `${generatedDraftCount} generated CAD ${pluralize("draft", generatedDraftCount)} must be reviewed and promoted before export.`,
      label: "draft CAD needs review",
      tone: "generated"
    };
  }

  if (fileBackedCadCount > 0) {
    return {
      detail: `${fileBackedCadCount} stored CAD ${pluralize("file", fileBackedCadCount)} exist but are not yet verified for export.`,
      label: "CAD files need verification",
      tone: "review"
    };
  }

  if (referencedCadCount > 0) {
    return {
      detail: `${referencedCadCount} CAD ${pluralize("link", referencedCadCount)} on file without stored files.`,
      label: "CAD links only",
      tone: "review"
    };
  }

  return {
    detail: "No stored CAD files or CAD links are attached to this record.",
    label: "no usable CAD files",
    tone: "neutral"
  };
}

/**
 * Builds a compact recovery cue from typed generation requestability and workflow state.
 */
export function getRecoveryWorkflowSummary(record: PartSearchRecord): WorkflowSignalLabel {
  const generationOptions = getGenerationOptions(record);
  const requestableCount = generationOptions.filter((option) => option.canRequest).length;
  const reviewCount = generationOptions.filter((option) => option.workflowStatus === "generated" || option.workflowStatus === "review_required").length;
  const activeCount = generationOptions.filter((option) => option.workflowStatus === "requested" || option.workflowStatus === "queued" || option.workflowStatus === "processing").length;
  const unavailableCount = generationOptions.filter((option) => option.workflowStatus === "unavailable").length;

  if (reviewCount > 0) {
    return {
      detail: `${reviewCount} generated ${pluralize("output", reviewCount)} await review and remain outside export readiness.`,
      label: "draft output in review",
      tone: "generated"
    };
  }

  if (activeCount > 0) {
    return {
      detail: `${activeCount} generation ${pluralize("workflow", activeCount)} are requested, queued, or processing.`,
      label: "generation in progress",
      tone: "info"
    };
  }

  if (requestableCount > 0) {
    const verb = requestableCount === 1 ? "has" : "have";
    return {
      detail: `${requestableCount} missing CAD ${pluralize("class", requestableCount, "classes")} ${verb} enough extracted source material to request generation.`,
      label: `${requestableCount} recovery ${pluralize("action", requestableCount)}`,
      tone: "info"
    };
  }

  if (unavailableCount > 0) {
    return {
      detail: "Missing CAD recovery is blocked by incomplete extracted source material.",
      label: "recovery source incomplete",
      tone: "neutral"
    };
  }

  return {
    detail: "No missing-CAD workflow is attached to this record.",
    label: "no recovery workflow",
    tone: "neutral"
  };
}

/**
 * Builds a compact connector cue without treating mapped relationships as procurement certainty.
 */
export function getConnectorWorkflowSummary(record: PartSearchRecord): WorkflowSignalLabel | null {
  if (!shouldRenderConnectorSections(record)) {
    return null;
  }

  const bestMate = record.buildableMatingSet.bestMate;
  const accessoryCount = record.buildableMatingSet.requiredAccessories.length;
  const toolingCount = record.buildableMatingSet.toolingRequirements.length;
  const cableCount = record.buildableMatingSet.cableOptions.length;
  const alternateMateCount = record.buildableMatingSet.alternateMates.length;
  const cableAssumptionCount = record.buildableMatingSet.cableAssumptions.length;
  const primaryWarning = record.buildableMatingSet.warningDetails[0] ?? null;

  if (primaryWarning) {
    return {
      detail: `${primaryWarning.detail} ${buildConnectorContextDetail(accessoryCount, toolingCount, cableCount, alternateMateCount, cableAssumptionCount)}`.trim(),
      label: primaryWarning.tone === "danger" ? "connector mapping blocked" : "connector review needed",
      tone: primaryWarning.tone === "danger" ? "danger" : "review"
    };
  }

  if (bestMate) {
    return {
      detail: buildConnectorContextDetail(accessoryCount, toolingCount, cableCount, alternateMateCount, cableAssumptionCount),
      label: "mate set mapped",
      tone: "info"
    };
  }

  return {
    detail: "Connector metadata exists, but no best mate is mapped yet.",
    label: "connector data incomplete",
    tone: "review"
  };
}

/**
 * Builds the explanation-first quick-check summary from existing provider-neutral signals.
 */
export function getQuickReadinessSummary(record: PartSearchRecord): QuickReadinessSummary {
  const exportReadiness = getSearchExportReadiness(record);
  const assetTruth = getAssetTruthSummary(record);
  const recovery = getRecoveryWorkflowSummary(record);
  const connector = getConnectorWorkflowSummary(record);
  const approvalSignal: WorkflowSignalLabel = {
    detail: record.approval.detail,
    label: record.approval.summary,
    tone: approvalTone(record.approval.status)
  };
  const checks = [readinessSignal(record), approvalSignal, assetTruth, connector ?? recovery, lifecycleSignal(record)];
  const actions = buildRecommendedActions(record);
  const tone = readinessTone(record.readinessSummary.status);

  return {
    actions,
    checks,
    detail: buildQuickReadinessDetail(record, exportReadiness, assetTruth, connector ?? recovery),
    headline: record.readinessSummary.label,
    subhead:
      record.readinessSummary.blockerCount > 0
        ? `${record.readinessSummary.blockerCount} ${pluralize("blocker", record.readinessSummary.blockerCount)} before design use or export.`
        : record.approval.summary,
    tone
  };
}

/**
 * Summarizes whether quick readiness has complete-enough backend data to be interpreted confidently.
 */
export function getQuickReadinessDataCoverage(record: PartSearchRecord): QuickReadinessDataCoverage {
  const missingInputs: string[] = [];

  if (record.sources.length === 0) missingInputs.push("source provenance");
  if (record.metrics.length === 0) missingInputs.push("normalized metrics");
  if (record.assets.length === 0) missingInputs.push("asset records");
  if (!record.datasheetRevision) missingInputs.push("datasheet revision metadata");

  if (missingInputs.length === 0) {
    return {
      detail: "Source provenance, normalized metrics, asset records, and datasheet metadata are present.",
      label: "readiness data present",
      partial: false,
      tone: "verified"
    };
  }

  return {
    detail: `Partial readiness data: missing ${missingInputs.join(", ")}.`,
    label: "partial readiness data",
    partial: true,
    tone: "review"
  };
}

/**
 * Maps current backend issues into concrete workstation actions without inventing capabilities.
 */
export function getPartNextActions(record: PartSearchRecord): PartNextAction[] {
  const openIssues = record.issues.filter((issue) => issue.status !== "resolved" && issue.status !== "ignored");
  const issueActions = openIssues.map((issue, index) => createIssueNextAction(issue.code, issue.detail || issue.summary, index === 0));

  if (issueActions.length > 0) {
    return dedupePartNextActions(issueActions);
  }

  if (record.readinessSummary.recommendedActions.length > 0) {
    return record.readinessSummary.recommendedActions.map((action, index) => ({
      available: true,
      detail: record.readinessSummary.detail,
      href: "#overview-heading",
      id: `recommended-${index}`,
      label: action,
      priority: index === 0 ? "primary" : "secondary",
      tone: record.readinessSummary.status === "blocked" ? "danger" : "review"
    }));
  }

  return [
    {
      available: true,
      detail: "Open the detail sections below to inspect provenance, datasheet, CAD, and export evidence before design use.",
      href: "#overview-heading",
      id: "inspect-detail",
      label: "Inspect detail evidence",
      priority: "primary",
      tone: "info"
    }
  ];
}

/**
 * Summarizes asset review and promotion progress without treating approval as export verification.
 */
export function getReviewWorkflowSummary(
  assetReviewStatuses: ReviewStatusSummary[],
  workflowReviewStatuses: ReviewStatusSummary[],
  promotionSummaries: AssetPromotionSummary[]
): WorkflowSignalLabel {
  const statuses = [...assetReviewStatuses, ...workflowReviewStatuses];
  const promotionReadyCount = promotionSummaries.filter((summary) => summary.canPromote).length;
  const pendingCount = statuses.filter((status) => status.state === "pending_review").length;
  const changesRequestedCount = statuses.filter((status) => status.state === "changes_requested").length;
  const rejectedCount = statuses.filter((status) => status.state === "rejected").length;
  const verifiedCount = statuses.filter((status) => status.state === "verified_for_export").length;

  if (promotionReadyCount > 0) {
    return {
      detail: "Validation evidence is present. Verified-for-export still requires the explicit promotion action.",
      label: `${promotionReadyCount} ready to promote`,
      tone: "info"
    };
  }

  if (pendingCount > 0) {
    return {
      detail: "Generated or newly sourced outputs are waiting for review and are not export-ready.",
      label: `${pendingCount} in review`,
      tone: "review"
    };
  }

  if (changesRequestedCount > 0) {
    return {
      detail: "At least one reviewed output needs changes before approval or promotion can continue.",
      label: "Changes requested",
      tone: "review"
    };
  }

  if (rejectedCount > 0) {
    return {
      detail: "Rejected outputs stay outside trust and export readiness until replaced or reworked.",
      label: "Rejected output",
      tone: "danger"
    };
  }

  if (verifiedCount > 0) {
    return {
      detail: "At least one asset has passed review, validation evidence, and explicit export promotion.",
      label: `${verifiedCount} verified for export`,
      tone: "verified"
    };
  }

  return {
    detail: "No asset or generation workflow is currently waiting for review.",
    label: "No open review",
    tone: "neutral"
  };
}

/**
 * Summarizes acquisition history for the part-detail card without exposing internal requester ids.
 */
export function getPartAcquisitionStateLabel(summary: PartAcquisitionSummary): WorkflowSignalLabel {
  if (summary.state === "available") {
    return {
      detail: summary.lastJobStatus === "failed"
        ? "The latest matching acquisition attempt failed, but attached provider/source evidence still exists on the part record."
        : summary.lastJobStatus === "running" || summary.lastJobStatus === "queued"
          ? "A matching acquisition job is still in progress for this part."
          : "A provider acquisition job is recorded for this part detail record.",
      label: summary.lastJobStatus === "failed"
        ? "Latest acquisition failed"
        : summary.lastJobStatus === "running"
          ? "Acquisition running"
          : summary.lastJobStatus === "queued"
            ? "Acquisition queued"
            : "Imported via acquisition job",
      tone: summary.lastJobStatus === "failed" ? "review" : summary.lastJobStatus === "succeeded" ? "info" : "info"
    };
  }

  if (summary.state === "legacy_source_only") {
    return {
      detail: summary.reason ?? "Provider source evidence is attached, but no acquisition job history is recorded for this part.",
      label: "Legacy source evidence only",
      tone: "review"
    };
  }

  if (summary.state === "unavailable") {
    return {
      detail: summary.reason ?? "Acquisition history is unavailable for this detail response.",
      label: "Acquisition history unavailable",
      tone: "neutral"
    };
  }

  return {
    detail: summary.reason ?? "No provider acquisition job or attached source evidence is recorded for this part yet.",
    label: "No acquisition history recorded",
    tone: "neutral"
  };
}

/**
 * Returns the explicit boundary copy that keeps imported parts separate from approval and export truth.
 */
export function getImportedPartBoundaryCopy(summary: PartAcquisitionSummary): string | null {
  if (summary.state === "available" || summary.state === "legacy_source_only") {
    return "Imported does not mean approved, export-ready, or CAD-verified.";
  }

  return null;
}

/**
 * Summarizes enrichment history for the part-detail card without turning background work into truth completion.
 */
export function getPartEnrichmentStateLabel(summary: PartEnrichmentSummary): WorkflowSignalLabel {
  if (summary.state === "available") {
    if (summary.latestJobStatus === "failed") {
      return {
        detail: "The latest background data update failed. The checklist below only counts what we already have on file, so nothing has changed.",
        label: "Latest update failed",
        tone: "review"
      };
    }

    if (summary.latestJobStatus === "running") {
      return {
        detail: "A background data update is running for this part. It can fill in source details, but it does not approve or verify any files.",
        label: "Update running",
        tone: "info"
      };
    }

    if (summary.latestJobStatus === "queued") {
      return {
        detail: "A background data update is queued for this part. The checklist below only counts what we already have on file.",
        label: "Update queued",
        tone: "info"
      };
    }

    return {
      detail: "Background data update history is recorded for this part. Updates can fill in source details, but they do not review, approve, or verify any files.",
      label: "Update history recorded",
      tone: "info"
    };
  }

  if (summary.state === "unavailable") {
    return {
      detail: summary.reason ?? "Update history is unavailable for this detail response.",
      label: "Updates unavailable",
      tone: "neutral"
    };
  }

  return {
    detail: summary.reason ?? "No background data updates are recorded for this part yet.",
    label: "No background updates recorded",
    tone: "neutral"
  };
}

/**
 * Returns explicit boundary copy so enrichment stays separate from approval, parsing, and export truth.
 */
export function getEnrichmentBoundaryCopy(summary: PartEnrichmentSummary): string | null {
  if (summary.state === "available") {
    return "Enriched does not mean approved. Captured does not mean parsed. Parsed does not mean verified. Generated does not mean export-ready.";
  }

  return null;
}

/**
 * Builds compact enrichment status rows for the part detail page without inventing new truth states.
 */
export function getPartEnrichmentStatusItems(
  summary: PartEnrichmentSummary
): DetailEnrichmentStatusItem[] {
  return summary.jobs.map((job) => ({
    completedAt: job.completedAt,
    detail: describePartEnrichmentJob(job),
    id: job.id,
    label: formatPartEnrichmentJobLabel(job.jobType),
    requestedAt: job.requestedAt,
    state: enrichmentJobItemState(job.jobStatus),
    stateLabel: formatPartEnrichmentJobStateLabel(job.jobStatus),
    tone: enrichmentJobTone(job.jobStatus)
  }));
}

/**
 * Builds the compact completeness checklist shown near the part-detail readiness summary.
 */
export function getPartCompletenessChecklist(
  record: PartSearchRecord,
  assetGroups: AssetClassSummary[],
  bundleReadiness: BundleReadinessSummary,
  generationOptions: AssetGenerationOption[],
  reviewWorkflowSummary: WorkflowSignalLabel
): DetailCompletenessChecklistItem[] {
  return [
    buildIdentityChecklistItem(record),
    buildDatasheetChecklistItem(record, assetGroups),
    buildNormalizedSpecsChecklistItem(record),
    buildPackageMechanicalChecklistItem(record, assetGroups),
    buildCadChecklistItem("symbol", "Symbol availability", assetGroups, generationOptions),
    buildCadChecklistItem("footprint", "Footprint availability", assetGroups, generationOptions),
    buildCadChecklistItem("three_d_model", "3D model availability", assetGroups, generationOptions),
    buildConnectorChecklistItem(record),
    buildApprovalChecklistItem(record, reviewWorkflowSummary),
    buildExportChecklistItem(bundleReadiness)
  ];
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
 * Builds the checklist row for whole-part identity confidence.
 */
function buildIdentityChecklistItem(record: PartSearchRecord): DetailCompletenessChecklistItem {
  const identityIssue = record.issues.find((issue) => issue.code === "low_confidence_identity");

  if (record.readinessSummary.identityStatus === "confirmed") {
    return createChecklistItem("identity", "Identity confidence", "available", "Confirmed", "Imported or attached source evidence is strong enough to treat part identity as confirmed.");
  }

  if (record.readinessSummary.identityStatus === "low_confidence") {
    return createChecklistItem(
      "identity",
      "Identity confidence",
      "review",
      "Needs review",
      identityIssue?.detail ?? "Identity evidence exists, but stronger confirmation is still needed before design use."
    );
  }

  return createChecklistItem(
    "identity",
    "Identity confidence",
    "blocked",
    "Blocked",
    identityIssue?.detail ?? "No imported provider source rows are attached, so the record cannot be treated as confirmed."
  );
}

/**
 * Builds the checklist row for datasheet availability and storage truth.
 */
function buildDatasheetChecklistItem(record: PartSearchRecord, assetGroups: AssetClassSummary[]): DetailCompletenessChecklistItem {
  const datasheetGroup = assetGroups.find((group) => group.assetType === "datasheet");
  const datasheetAsset = datasheetGroup?.bestAsset ?? null;
  const missingDatasheetIssue = record.issues.find((issue) => issue.code === "missing_datasheet");

  if (!record.datasheetRevision) {
    return createChecklistItem(
      "datasheet",
      "Datasheet availability",
      "missing",
      "Missing",
      missingDatasheetIssue?.detail ?? "No datasheet revision row is attached, so revision and extraction provenance stay incomplete."
    );
  }

  if (datasheetAsset && isFileBackedAsset(datasheetAsset)) {
    return createChecklistItem(
      "datasheet",
      "Datasheet availability",
      "available",
      "Stored file",
      "Revision metadata and a stored datasheet file are attached to this part."
    );
  }

  return createChecklistItem(
    "datasheet",
    "Datasheet availability",
    "review",
    datasheetAsset?.sourceUrl ? "Reference only" : "Metadata only",
    datasheetAsset?.sourceUrl
      ? "Revision metadata exists, but only a referenced datasheet URL is attached."
      : "Revision metadata exists, but no stored datasheet file is attached."
  );
}

/**
 * Builds the checklist row for normalized specifications captured from structured or datasheet evidence.
 */
function buildNormalizedSpecsChecklistItem(record: PartSearchRecord): DetailCompletenessChecklistItem {
  if (record.metrics.length > 0) {
    return createChecklistItem(
      "normalized-specs",
      "Normalized specs",
      "available",
      "Available",
      `${record.metrics.length} normalized ${pluralize("spec", record.metrics.length)} are attached to this part.`
    );
  }

  if (record.datasheetRevision || record.extractionSignals.length > 0) {
    return createChecklistItem(
      "normalized-specs",
      "Normalized specs",
      "review",
      "Sparse",
      "Source evidence exists, but normalized specifications are still sparse or missing."
    );
  }

  return createChecklistItem(
    "normalized-specs",
    "Normalized specs",
    "missing",
    "Missing",
    "No normalized specifications or supporting extraction evidence are recorded yet."
  );
}

/**
 * Builds the checklist row for package and mechanical confidence from stored dimensions and extraction signals.
 */
function buildPackageMechanicalChecklistItem(record: PartSearchRecord, assetGroups: AssetClassSummary[]): DetailCompletenessChecklistItem {
  const packageSignal = record.extractionSignals.find((signal) => signal.signalType === "package_mechanical_dimensions");
  const hasMechanicalDimensions = record.package.pitchMm !== null || record.package.bodyLengthMm !== null || record.package.bodyWidthMm !== null || record.package.bodyHeightMm !== null;
  const mechanicalGroup = assetGroups.find((group) => group.assetType === "mechanical_drawing");

  if (packageSignal?.extractionStatus === "available" && hasMechanicalDimensions) {
    return createChecklistItem(
      "package-mechanical",
      "Package/mechanical confidence",
      "available",
      "Available",
      packageSignal.notes ?? "Structured package dimensions are recorded and backed by extraction evidence."
    );
  }

  if (hasMechanicalDimensions || packageSignal || mechanicalGroup?.bestAsset) {
    return createChecklistItem(
      "package-mechanical",
      "Package/mechanical confidence",
      "review",
      "Needs review",
      packageSignal?.notes ?? "Some package or mechanical evidence exists, but it still needs engineering review."
    );
  }

  return createChecklistItem(
    "package-mechanical",
    "Package/mechanical confidence",
    "missing",
    "Missing",
    "No extracted package dimensions or mechanical drawing evidence are recorded yet."
  );
}

/**
 * Builds one CAD-class checklist row from existing asset truth and generation workflow state.
 */
function buildCadChecklistItem(
  assetType: AssetGenerationOption["targetAssetType"],
  label: string,
  assetGroups: AssetClassSummary[],
  generationOptions: AssetGenerationOption[]
): DetailCompletenessChecklistItem {
  const assetGroup = assetGroups.find((group) => group.assetType === assetType);
  const generationOption = generationOptions.find((option) => option.targetAssetType === assetType);

  if (assetGroup?.readiness === "export_ready") {
    return createChecklistItem(assetType, label, "available", "Verified", "A stored file for this class is verified for export.");
  }

  if (generationOption?.workflowStatus === "review_required" || generationOption?.workflowStatus === "generated") {
    return createChecklistItem(assetType, label, "review", "Draft in review", generationOption.reason);
  }

  if (generationOption?.workflowStatus === "requested" || generationOption?.workflowStatus === "queued" || generationOption?.workflowStatus === "processing") {
    return createChecklistItem(assetType, label, "review", "In progress", generationOption.reason);
  }

  if (assetGroup?.readiness === "validated_file") {
    return createChecklistItem(assetType, label, "review", "Stored file", "A stored file exists, but it is not yet verified for export.");
  }

  if (assetGroup?.readiness === "downloaded_file") {
    return createChecklistItem(assetType, label, "review", "Downloaded", "A downloaded asset exists, but review or export verification is still pending.");
  }

  if (assetGroup?.readiness === "reference_only") {
    return createChecklistItem(assetType, label, "review", "Reference only", "Only a link is on file for this file type; no stored file is attached.");
  }

  if (assetGroup?.readiness === "failed" || generationOption?.workflowStatus === "failed") {
    return createChecklistItem(assetType, label, "blocked", "Blocked", generationOption?.reason ?? "The latest recovery attempt failed for this file type.");
  }

  if (generationOption?.canRequest) {
    return createChecklistItem(assetType, label, "review", "Requestable", generationOption.reason);
  }

  return createChecklistItem(assetType, label, "missing", "Missing", "No file or recovery request is on file for this file type yet.");
}

/**
 * Builds the connector/mating checklist row while keeping connector applicability explicit for non-connectors.
 */
function buildConnectorChecklistItem(record: PartSearchRecord): DetailCompletenessChecklistItem {
  const connectorSummary = getConnectorWorkflowSummary(record);

  if (!connectorSummary) {
    return createChecklistItem(
      "connector-data",
      "Connector/mating data",
      "neutral",
      "Not applicable",
      "This part does not expose connector-specific mate or accessory data."
    );
  }

  if (connectorSummary.tone === "danger") {
    return createChecklistItem("connector-data", "Connector/mating data", "blocked", "Blocked", connectorSummary.detail);
  }

  if (connectorSummary.tone === "review") {
    return createChecklistItem("connector-data", "Connector/mating data", "review", "Needs review", connectorSummary.detail);
  }

  return createChecklistItem("connector-data", "Connector/mating data", "available", "Mapped", connectorSummary.detail);
}

/**
 * Builds the approval/review checklist row without merging approval into export verification.
 */
function buildApprovalChecklistItem(record: PartSearchRecord, reviewWorkflowSummary: WorkflowSignalLabel): DetailCompletenessChecklistItem {
  if (reviewWorkflowSummary.tone === "danger") {
    return createChecklistItem(
      "approval-review",
      "Approval/review state",
      "blocked",
      "Blocked",
      `${record.approval.detail} ${reviewWorkflowSummary.detail}`.trim()
    );
  }

  if (record.approval.status === "approved" && reviewWorkflowSummary.tone === "neutral") {
    return createChecklistItem(
      "approval-review",
      "Approval/review state",
      "available",
      "Approved",
      "Whole-part approval is recorded, and no open asset or workflow review remains."
    );
  }

  if (record.approval.status === "not_requested") {
    return createChecklistItem(
      "approval-review",
      "Approval/review state",
      "blocked",
      "Not approved",
      `${record.approval.detail} Approving the part does not review its files or mark them ready for export.`
    );
  }

  return createChecklistItem(
    "approval-review",
    "Approval/review state",
    "review",
    record.approval.summary,
    `${record.approval.detail} ${reviewWorkflowSummary.detail}`.trim()
  );
}

/**
 * Builds the export checklist row directly from the existing bundle-readiness truth.
 */
function buildExportChecklistItem(bundleReadiness: BundleReadinessSummary): DetailCompletenessChecklistItem {
  if (bundleReadiness.state === "bundle_ready") {
    return createChecklistItem("export-readiness", "Export readiness", "available", "Ready for review", bundleReadiness.reason);
  }

  if (bundleReadiness.state === "partial_bundle") {
    return createChecklistItem("export-readiness", "Export readiness", "review", "Partial bundle", bundleReadiness.reason);
  }

  if (bundleReadiness.state === "references_only") {
    return createChecklistItem("export-readiness", "Export readiness", "blocked", "Reference only", bundleReadiness.reason);
  }

  return createChecklistItem("export-readiness", "Export readiness", "missing", "Missing", bundleReadiness.reason);
}

/**
 * Formats the currently supported enrichment job type into a readable checklist label.
 */
function formatPartEnrichmentJobLabel(jobType: PartEnrichmentSummary["jobs"][number]["jobType"]): string {
  switch (jobType) {
    case "datasheet_capture":
      return "Datasheet capture";
  }
}

/**
 * Formats the persisted enrichment job status for compact badges.
 */
function formatPartEnrichmentJobStateLabel(
  jobStatus: PartEnrichmentSummary["jobs"][number]["jobStatus"]
): string {
  switch (jobStatus) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
  }
}

/**
 * Maps enrichment job status to the same small set of detail-item states used elsewhere on the page.
 */
function enrichmentJobItemState(
  jobStatus: PartEnrichmentSummary["jobs"][number]["jobStatus"]
): DetailEnrichmentStatusItem["state"] {
  switch (jobStatus) {
    case "queued":
    case "running":
      return "review";
    case "succeeded":
      return "available";
    case "failed":
      return "blocked";
  }
}

/**
 * Maps enrichment job status into UI tones without treating background work as approval or verification.
 */
function enrichmentJobTone(
  jobStatus: PartEnrichmentSummary["jobs"][number]["jobStatus"]
): ViewTone {
  switch (jobStatus) {
    case "queued":
    case "running":
      return "info";
    case "succeeded":
      return "verified";
    case "failed":
      return "danger";
  }
}

/**
 * Builds explicit background-job detail text without inventing parsing, verification, or export readiness.
 */
function describePartEnrichmentJob(
  job: PartEnrichmentSummary["jobs"][number]
): string {
  if (job.jobStatus === "failed") {
    return job.errorMessage ?? "The background data update did not complete.";
  }

  if (job.jobStatus === "queued") {
    return "This background data update is queued and has not started yet.";
  }

  if (job.jobStatus === "running") {
    return "This background data update is running. Readiness, approval, and export status only change when evidence is recorded.";
  }

  return "This background data update completed. New evidence can fill in details, but it does not review, approve, or verify any files.";
}

/**
 * Converts export readiness into the same quick-check row shape as other summaries.
 */
function exportReadinessToSignal(exportReadiness: ExportReadinessLabel): WorkflowSignalLabel {
  return {
    detail: exportReadiness.label === "bundle ready" ? "At least one export bundle has every required stored and verified CAD file." : "Export actions stay disabled until required CAD files are stored and verified for export.",
    label: exportReadiness.label,
    tone: exportReadiness.tone
  };
}

/**
 * Builds a lifecycle scan signal without changing lifecycle semantics.
 */
function lifecycleSignal(record: PartSearchRecord): WorkflowSignalLabel {
  const lifecycleLabels: Record<PartSearchRecord["part"]["lifecycleStatus"], string> = {
    active: "lifecycle active",
    not_recommended: "not recommended",
    obsolete: "obsolete",
    unknown: "lifecycle unknown"
  };
  const lifecycleTones: Record<PartSearchRecord["part"]["lifecycleStatus"], ViewTone> = {
    active: "verified",
    not_recommended: "review",
    obsolete: "danger",
    unknown: "neutral"
  };

  return {
    detail: `Lifecycle state is ${record.part.lifecycleStatus}.`,
    label: lifecycleLabels[record.part.lifecycleStatus],
    tone: lifecycleTones[record.part.lifecycleStatus]
  };
}

/**
 * Builds concise quick-check actions without inventing backend workflow state.
 */
function buildQuickReadinessActions(exportReadiness: ExportReadinessLabel, assetTruth: WorkflowSignalLabel, recovery: WorkflowSignalLabel, connector: WorkflowSignalLabel | null): QuickReadinessAction[] {
  const actions: QuickReadinessAction[] = [];

  if (exportReadiness.tone !== "verified") {
    actions.push({ label: "Inspect export blockers before using CAD in a design.", priority: "high" });
  }

  if (assetTruth.tone === "generated") {
    actions.push({ label: "Review generated CAD drafts before approval or promotion.", priority: "high" });
  } else if (assetTruth.tone === "review") {
    actions.push({ label: "Verify stored CAD files before export.", priority: "high" });
  } else if (assetTruth.tone === "neutral") {
    actions.push({ label: "Recover missing CAD only when source evidence is sufficient.", priority: "medium" });
  }

  if (recovery.tone === "info") {
    actions.push({ label: "Request missing-CAD recovery from the part detail page.", priority: "medium" });
  }

  if (connector?.tone === "review") {
    actions.push({ label: "Resolve connector mate mapping before layout decisions.", priority: "medium" });
  }

  return dedupeQuickActions(actions);
}

/**
 * Maps backend-recommended actions into scan-friendly quick-check actions.
 */
function buildRecommendedActions(record: PartSearchRecord): QuickReadinessAction[] {
  return dedupeQuickActions(
    record.readinessSummary.recommendedActions.map((label, index) => ({
      label,
      priority: index === 0 && record.readinessSummary.status === "blocked" ? "high" : index <= 1 ? "medium" : "low"
    }))
  );
}

/**
 * Creates the primary workstation action for one backend issue code.
 */
function createIssueNextAction(code: PartIssueCode, issueDetail: string, primary: boolean): PartNextAction {
  const metadata = issueActionMetadata[code];

  return {
    available: metadata.available,
    detail: `${metadata.detail} ${issueDetail}`,
    href: metadata.href,
    id: code,
    label: metadata.label,
    priority: primary ? "primary" : "secondary",
    tone: metadata.tone
  };
}

/** issueActionMetadata maps every backend issue code to an honest user action. */
const issueActionMetadata: Record<PartIssueCode, Omit<PartNextAction, "detail" | "id" | "priority"> & { detail: string }> = {
  connector_low_confidence: {
    available: true,
    detail: "Review connector relationship confidence before layout or procurement.",
    href: "#mates-heading",
    label: "Review connector confidence",
    tone: "review"
  },
  duplicate_candidate: {
    available: true,
    detail: "Open admin reconciliation before trusting identity or merging records.",
    href: "/admin",
    label: "Review duplicate candidate",
    tone: "review"
  },
  lifecycle_risk: {
    available: true,
    detail: "Inspect lifecycle and sourcing evidence before design use.",
    href: "#sourcing-heading",
    label: "Review lifecycle risk",
    tone: "review"
  },
  low_confidence_identity: {
    available: true,
    detail: "Inspect provider/source provenance and confirm identity before design use.",
    href: "#sourcing-heading",
    label: "Confirm identity evidence",
    tone: "danger"
  },
  missing_connector_accessories: {
    available: true,
    detail: "Inspect required accessories and cable/tooling relationships.",
    href: "#mates-heading",
    label: "Map connector accessories",
    tone: "review"
  },
  missing_connector_mate: {
    available: true,
    detail: "Inspect connector mate mapping before layout decisions.",
    href: "#mates-heading",
    label: "Map connector mate",
    tone: "review"
  },
  missing_datasheet: {
    available: true,
    detail: "Use sourcing and enrichment evidence to attach or capture a datasheet.",
    href: "#sourcing-heading",
    label: "Capture datasheet",
    tone: "review"
  },
  missing_verified_cad: {
    available: true,
    detail: "Inspect file coverage, then request generation or promote a stored CAD file to verified.",
    href: "#files-heading",
    label: "Resolve CAD/export assets",
    tone: "danger"
  },
  pending_approval: {
    available: true,
    detail: "Review generated or sourced assets before treating this part as engineer-ready.",
    href: "#approval-heading",
    label: "Review pending approval",
    tone: "review"
  },
  source_conflict: {
    available: true,
    detail: "Open admin source reconciliation before trusting mixed provider evidence.",
    href: "/admin",
    label: "Resolve source conflict",
    tone: "danger"
  }
};

/**
 * Keeps duplicate issue actions from crowding compact catalog and detail surfaces.
 */
function dedupePartNextActions(actions: PartNextAction[]): PartNextAction[] {
  const seen = new Set<string>();

  return actions.filter((action) => {
    if (seen.has(action.id)) {
      return false;
    }

    seen.add(action.id);
    return true;
  });
}

/**
 * Keeps repeated action labels from crowding the quick-check result.
 */
function dedupeQuickActions(actions: QuickReadinessAction[]): QuickReadinessAction[] {
  const seen = new Set<string>();

  return actions.filter((action) => {
    if (seen.has(action.label)) {
      return false;
    }

    seen.add(action.label);
    return true;
  });
}

/**
 * Combines existing signal explanations into one readable quick-check sentence.
 */
function buildQuickReadinessDetail(
  record: PartSearchRecord,
  exportReadiness: ExportReadinessLabel,
  assetTruth: WorkflowSignalLabel,
  workflow: WorkflowSignalLabel
): string {
  return `Part readiness: ${record.readinessSummary.detail} Approval: ${record.approval.detail} Export package: ${exportReadiness.label}. CAD status: ${assetTruth.detail} Workflow signal: ${workflow.detail}`;
}

/**
 * Builds one checklist item with consistent tone and state-label mapping.
 */
function createChecklistItem(
  id: string,
  label: string,
  state: DetailCompletenessChecklistItem["state"],
  stateLabel: string,
  detail: string
): DetailCompletenessChecklistItem {
  return {
    detail,
    id,
    label,
    state,
    stateLabel,
    tone: checklistTone(state)
  };
}

/**
 * Maps checklist states into the same tone vocabulary used by badges and status strips.
 */
function checklistTone(state: DetailCompletenessChecklistItem["state"]): ViewTone {
  switch (state) {
    case "available":
      return "verified";
    case "blocked":
      return "danger";
    case "review":
      return "review";
    case "missing":
    case "neutral":
      return "neutral";
  }
}

/**
 * Returns true for CAD asset classes that can participate in export bundle readiness.
 */
function isCadAsset(asset: Asset): boolean {
  return asset.assetType === "footprint" || asset.assetType === "symbol" || asset.assetType === "three_d_model";
}

/**
 * Pluralizes short scan labels without introducing a formatting dependency.
 */
function pluralize(singular: string, count: number, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/**
 * Builds one compact connector-detail sentence for search cards and quick-check summaries.
 */
function buildConnectorContextDetail(
  accessoryCount: number,
  toolingCount: number,
  cableCount: number,
  alternateMateCount: number,
  cableAssumptionCount: number
): string {
  const detailParts = [
    `${accessoryCount} required ${pluralize("accessory", accessoryCount)}`,
    `${toolingCount} tooling ${pluralize("item", toolingCount)}`,
    `${cableCount} cable ${pluralize("option", cableCount)} mapped`
  ];

  if (alternateMateCount > 0) {
    detailParts.push(`${alternateMateCount} alternate ${pluralize("mate", alternateMateCount)} recorded`);
  }

  if (cableAssumptionCount > 0) {
    detailParts.push(`${cableAssumptionCount} cable ${pluralize("assumption", cableAssumptionCount)} noted`);
  }

  return `${detailParts.join(", ")}.`;
}

/**
 * Converts backend readiness into a compact quick-check signal.
 */
function readinessSignal(record: PartSearchRecord): WorkflowSignalLabel {
  return {
    detail: record.readinessSummary.detail,
    label: record.readinessSummary.label,
    tone: readinessTone(record.readinessSummary.status)
  };
}

/**
 * Maps backend readiness status into UI tones.
 */
function readinessTone(status: PartSearchRecord["readinessSummary"]["status"]): ViewTone {
  const tones: Record<PartSearchRecord["readinessSummary"]["status"], ViewTone> = {
    blocked: "danger",
    needs_attention: "review",
    ready_for_export_review: "verified",
    unknown: "neutral"
  };

  return tones[status];
}

/**
 * Maps backend approval status into UI tones.
 */
function approvalTone(status: PartSearchRecord["approval"]["status"]): ViewTone {
  const tones: Record<PartSearchRecord["approval"]["status"], ViewTone> = {
    approved: "verified",
    not_applicable: "neutral",
    not_requested: "review",
    pending_review: "info"
  };

  return tones[status];
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
