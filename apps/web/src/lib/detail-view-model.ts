/**
 * File header: Provides testable provider-neutral UI wording and section visibility helpers.
 */

import { getBundleReadinessSummary, getGenerationOptions } from "@ee-library/shared/asset-resolution";
import { isFileBackedAsset, isValidatedDownloadableAsset } from "@ee-library/shared/asset-state";
import type { Asset, AssetGenerationOption, AssetPromotionSummary, AssetValidationSummary, BundleReadinessState, GenerationWorkflow, PartSearchRecord, ReviewState, ReviewStatusSummary } from "@ee-library/shared/types";

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
      detail: `${fileBackedCadCount} file-backed CAD ${pluralize("asset", fileBackedCadCount)} recorded; only verified assets count toward export readiness.`,
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
      detail: `${fileBackedCadCount} file-backed CAD ${pluralize("asset", fileBackedCadCount)} exist but are not verified for export.`,
      label: "CAD files need verification",
      tone: "review"
    };
  }

  if (referencedCadCount > 0) {
    return {
      detail: `${referencedCadCount} CAD ${pluralize("reference", referencedCadCount)} exist without stored files.`,
      label: "CAD references only",
      tone: "review"
    };
  }

  return {
    detail: "No file-backed CAD assets or CAD references are attached to this record.",
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
    return {
      detail: `${requestableCount} missing CAD ${pluralize("class", requestableCount, "classes")} have enough extracted source material to request generation.`,
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

  if (bestMate) {
    return {
      detail: `${accessoryCount} required ${pluralize("accessory", accessoryCount)}, ${toolingCount} tooling ${pluralize("item", toolingCount)}, ${cableCount} cable ${pluralize("option", cableCount)} mapped.`,
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
  const checks = [exportReadinessToSignal(exportReadiness), assetTruth, connector ?? recovery, lifecycleSignal(record)];
  const actions = buildQuickReadinessActions(exportReadiness, assetTruth, recovery, connector);
  const tone = exportReadiness.tone === "verified" && assetTruth.tone === "verified" ? "verified" : actions.some((action) => action.priority === "high") ? "review" : exportReadiness.tone;

  return {
    actions,
    checks,
    detail: buildQuickReadinessDetail(exportReadiness, assetTruth, connector ?? recovery),
    headline: tone === "verified" ? "Ready for Export Review" : actions.length > 0 ? "Review Needed" : "Catalog Record Found",
    subhead: actions.length > 0 ? `${actions.length} ${pluralize("action", actions.length)} before design use or export.` : "No immediate quick-check actions were derived from this catalog record.",
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
 * Converts export readiness into the same quick-check row shape as other summaries.
 */
function exportReadinessToSignal(exportReadiness: ExportReadinessLabel): WorkflowSignalLabel {
  return {
    detail: exportReadiness.label === "bundle ready" ? "At least one export bundle has every required verified file-backed CAD asset." : "Export actions stay disabled until required CAD assets are file-backed and verified for export.",
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
    actions.push({ label: "Verify file-backed CAD assets before export.", priority: "high" });
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
function buildQuickReadinessDetail(exportReadiness: ExportReadinessLabel, assetTruth: WorkflowSignalLabel, workflow: WorkflowSignalLabel): string {
  return `Export bundle: ${exportReadiness.label}. CAD truth: ${assetTruth.detail} Workflow signal: ${workflow.detail}`;
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
