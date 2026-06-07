/**
 * File header: Derives part-level readiness, approval, issue, and risk projections from provider-neutral record evidence.
 */

import { isFileBackedAsset, isValidatedDownloadableAsset } from "./asset-state";
import type {
  Asset,
  AssetPromotionAuditRecord,
  AssetValidationRecord,
  BuildableMatingSet,
  ConnectorClass,
  DatasheetRevision,
  GenerationRequest,
  GenerationWorkflow,
  MateRelation,
  Part,
  PartApproval,
  PartApprovalStatus,
  PartDuplicateCandidate,
  PartIdentityStatus,
  PartIssue,
  PartIssueCode,
  PartIssueSeverity,
  PartReadinessSummary,
  PartReadinessStatus,
  PartRiskFlag,
  ReviewRecord,
  SourceReconciliationRecord,
  SourceExtractionSignal,
  SourceRecord
} from "./types";

/** PartProjectionSource contains the provider-neutral evidence needed to derive part-level readiness. */
export interface PartProjectionSource {
  part: Part;
  assets: Asset[];
  datasheetRevision: DatasheetRevision | null;
  sources: SourceRecord[];
  metrics: Array<{ lastUpdatedAt: string }>;
  mateRelations: MateRelation[];
  accessoryRequirements: Array<{ relationshipType: string }>;
  buildableMatingSet: BuildableMatingSet;
  generationWorkflows: GenerationWorkflow[];
  generationRequests: GenerationRequest[];
  extractionSignals: SourceExtractionSignal[];
  reviewRecords: ReviewRecord[];
  validationRecords: AssetValidationRecord[];
  promotionAudits: AssetPromotionAuditRecord[];
  duplicateCandidates: PartDuplicateCandidate[];
  sourceReconciliation: SourceReconciliationRecord | null;
}

/** PartProjection groups the backend-derived readiness data persisted and exposed by the API. */
export interface PartProjection {
  approval: PartApproval;
  issues: PartIssue[];
  readinessSummary: PartReadinessSummary;
  riskFlags: PartRiskFlag[];
}

/** CAD_ASSET_TYPES limits whole-part export readiness to real CAD asset classes. */
const CAD_ASSET_TYPES = new Set<Asset["assetType"]>(["footprint", "symbol", "three_d_model"]);

/**
 * Resolves connector class from normalized category text plus connector-family identity.
 */
export function resolveConnectorClass(part: Pick<Part, "category" | "connectorFamilyId">): ConnectorClass {
  const normalizedCategory = part.category.trim().toLowerCase();

  if (normalizedCategory.includes("tooling")) {
    return "tooling";
  }

  if (normalizedCategory.includes("cable")) {
    return "cable";
  }

  if (normalizedCategory.includes("accessory")) {
    return "accessory";
  }

  if (part.connectorFamilyId || normalizedCategory.includes("connector")) {
    return "connector";
  }

  return "non_connector";
}

/**
 * Derives the part-level readiness projection from normalized evidence without inventing certainty.
 */
export function derivePartProjection(source: PartProjectionSource): PartProjection {
  const lastEvaluatedAt = latestTimestamp([
    source.part.lastUpdatedAt,
    ...source.assets.map((asset) => asset.lastUpdatedAt),
    ...(source.datasheetRevision ? [source.datasheetRevision.lastUpdatedAt] : []),
    ...source.sources.map((item) => item.lastUpdatedAt),
    ...source.metrics.map((item) => item.lastUpdatedAt),
    ...source.generationRequests.map((item) => item.lastUpdatedAt),
    ...source.reviewRecords.map((item) => item.lastUpdatedAt),
    ...source.validationRecords.map((item) => item.lastUpdatedAt),
    ...source.promotionAudits.map((item) => item.createdAt)
  ]);
  const connectorClass = resolveConnectorClass(source.part);
  const cadAssets = source.assets.filter((asset) => CAD_ASSET_TYPES.has(asset.assetType));
  const verifiedCadAssets = cadAssets.filter(isValidatedDownloadableAsset);
  const fileBackedCadAssets = cadAssets.filter(isFileBackedAsset);
  const referencedAssets = source.assets.filter((asset) => asset.availabilityStatus === "referenced");
  const generatedDraftAssets = cadAssets.filter((asset) => asset.provenance === "generated" && !isValidatedDownloadableAsset(asset));
  const hasBundleReady = hasReadyExportBundle(verifiedCadAssets);
  const hasImportedSource = source.sources.some((item) => item.importStatus === "imported");
  const hasFailedSource = source.sources.some((item) => item.importStatus === "failed");
  const hasPartialReadinessData =
    source.sources.length === 0 ||
    source.assets.length === 0 ||
    source.metrics.length === 0 ||
    source.datasheetRevision === null;
  const identityStatus = resolveIdentityStatus(source.part, source.sources, hasImportedSource);
  const openReviewCount =
    source.assets.filter((asset) => asset.reviewStatus === "review_required" || asset.reviewStatus === "changes_requested").length +
    source.generationWorkflows.filter((workflow) => workflow.generationStatus === "generated" || workflow.generationStatus === "review_required").length;
  const inFlightGenerationCount =
    source.generationRequests.filter((request) => request.requestStatus === "requested" || request.requestStatus === "queued" || request.requestStatus === "processing").length +
    source.generationWorkflows.filter((workflow) => workflow.generationStatus === "requested" || workflow.generationStatus === "queued" || workflow.generationStatus === "processing").length;
  const connectorWarnings = source.buildableMatingSet.warnings;
  const primaryConnectorWarning = source.buildableMatingSet.warningDetails[0] ?? null;
  const connectorConfidence = source.buildableMatingSet.confidenceScore;

  const provisionalApprovalStatus = resolveApprovalStatus({
    connectorClass,
    hasBundleReady,
    hasVerifiedCad: verifiedCadAssets.length > 0,
    identityStatus,
    inFlightGenerationCount,
    lifecycleStatus: source.part.lifecycleStatus,
    openReviewCount
  });
  const approval = buildPartApproval(source.part.id, provisionalApprovalStatus, {
    connectorClass,
    hasBundleReady,
    hasVerifiedCad: verifiedCadAssets.length > 0,
    identityStatus,
    inFlightGenerationCount,
    lastEvaluatedAt,
    openReviewCount
  });

  const issues: PartIssue[] = [];

  if (identityStatus !== "confirmed") {
    issues.push(
      createIssue(
        source.part.id,
        "low_confidence_identity",
        identityStatus === "unknown" ? "error" : "warning",
        identityStatus === "unknown" ? "Identity evidence is missing." : "Identity still needs stronger confirmation.",
        identityStatus === "unknown"
          ? "No imported provider source rows are attached, so the record cannot be treated as confirmed."
          : `Trust score is ${Math.round(source.part.trustScore * 100)}%, which keeps identity confidence below the confirmed threshold.`,
        "catalog_rule",
        lastEvaluatedAt
      )
    );
  }

  if (!source.datasheetRevision) {
    issues.push(
      createIssue(
        source.part.id,
        "missing_datasheet",
        "warning",
        "Datasheet metadata is missing.",
        "No datasheet revision row is attached, so revision and extraction provenance stay incomplete.",
        "catalog_rule",
        lastEvaluatedAt
      )
    );
  }

  if (!hasBundleReady) {
    issues.push(
      createIssue(
        source.part.id,
        "missing_verified_cad",
        "error",
        buildMissingCadSummary(fileBackedCadAssets.length, referencedAssets.length),
        buildMissingCadDetail(fileBackedCadAssets.length, referencedAssets.length, generatedDraftAssets.length),
        "asset_truth",
        lastEvaluatedAt
      )
    );
  }

  if (connectorClass === "connector" && !source.buildableMatingSet.bestMate) {
    issues.push(
      createIssue(
        source.part.id,
        "missing_connector_mate",
        "error",
        "Best mating part is missing.",
        "Connector intelligence exists for this record, but no prioritized best mate is stored yet.",
        "connector_intelligence",
        lastEvaluatedAt
      )
    );
  }

  if (
    connectorClass === "connector" &&
    source.buildableMatingSet.requiredAccessories.length === 0 &&
    source.buildableMatingSet.optionalAccessories.length === 0
  ) {
    issues.push(
      createIssue(
        source.part.id,
        "missing_connector_accessories",
        "warning",
        "Accessory coverage is incomplete.",
        "No required or optional accessory mappings are stored for this connector record yet.",
        "connector_intelligence",
        lastEvaluatedAt
      )
    );
  }

  if (
    connectorClass === "connector" &&
    (connectorWarnings.length > 0 || (connectorConfidence !== null && connectorConfidence < 0.75))
  ) {
    issues.push(
      createIssue(
        source.part.id,
        "connector_low_confidence",
        "warning",
        "Connector relationship confidence is below target.",
        primaryConnectorWarning?.detail ??
          connectorWarnings[0] ??
          `Buildable set confidence is ${Math.round((connectorConfidence ?? 0) * 100)}%, so connector compatibility still needs review.`,
        "connector_intelligence",
        lastEvaluatedAt
      )
    );
  }

  if (source.part.lifecycleStatus !== "active") {
    issues.push(
      createIssue(
        source.part.id,
        "lifecycle_risk",
        source.part.lifecycleStatus === "obsolete" ? "error" : "warning",
        `Lifecycle is ${source.part.lifecycleStatus}.`,
        "Lifecycle status is not active, so this part should be reviewed carefully before design use.",
        "catalog_rule",
        lastEvaluatedAt
      )
    );
  }

  if (hasFailedSource) {
    issues.push(
      createIssue(
        source.part.id,
        "source_conflict",
        "warning",
        "At least one provider import failed.",
        buildSourceConflictDetail(source.sources, source.sourceReconciliation),
        "source_import",
        lastEvaluatedAt
      )
    );
  }

  if (source.duplicateCandidates.length > 0) {
    issues.push(
      createIssue(
        source.part.id,
        "duplicate_candidate",
        "warning",
        buildDuplicateCandidateSummary(source.duplicateCandidates),
        buildDuplicateCandidateDetail(source.duplicateCandidates),
        "catalog_rule",
        lastEvaluatedAt
      )
    );
  }

  if (approval.status !== "approved" && approval.status !== "not_applicable") {
    issues.push(
      createIssue(
        source.part.id,
        "pending_approval",
        "warning",
        approval.summary,
        approval.detail,
        "approval",
        lastEvaluatedAt
      )
    );
  }

  const riskFlags: PartRiskFlag[] = [];

  if (source.part.lifecycleStatus !== "active") {
    riskFlags.push(
      createRiskFlag(
        source.part.id,
        "lifecycle_not_active",
        `Lifecycle: ${source.part.lifecycleStatus}`,
        "Lifecycle is not active, so replacement planning or explicit approval may be needed.",
        source.part.lifecycleStatus === "obsolete" ? "danger" : "review",
        lastEvaluatedAt
      )
    );
  }

  if (generatedDraftAssets.length > 0) {
    riskFlags.push(
      createRiskFlag(
        source.part.id,
        "generated_assets_present",
        "Generated CAD present",
        `${generatedDraftAssets.length} generated CAD ${pluralize("draft", generatedDraftAssets.length)} cannot be exported until review is complete and the file is marked verified.`,
        "review",
        lastEvaluatedAt
      )
    );
  }

  if (hasFailedSource) {
    riskFlags.push(
      createRiskFlag(
        source.part.id,
        "source_conflict",
        "Mixed import health",
        "At least one attached provider import failed, so the source needs review.",
        "review",
        lastEvaluatedAt
      )
    );
  }

  if (connectorClass === "connector" && (connectorWarnings.length > 0 || (connectorConfidence !== null && connectorConfidence < 0.75))) {
    riskFlags.push(
      createRiskFlag(
        source.part.id,
        "connector_low_confidence",
        "Connector confidence low",
        primaryConnectorWarning?.detail ??
          connectorWarnings[0] ??
          `Buildable set confidence is ${Math.round((connectorConfidence ?? 0) * 100)}%, so mate/accessory data still needs confirmation.`,
        "review",
        lastEvaluatedAt
      )
    );
  }

  if (hasPartialReadinessData) {
    riskFlags.push(
      createRiskFlag(
        source.part.id,
        "partial_readiness_data",
        "Partial readiness data",
        buildPartialDataDetail(source),
        "review",
        lastEvaluatedAt
      )
    );
  }

  const readinessSummary = buildReadinessSummary(source.part.id, {
    approvalStatus: approval.status,
    bundleReady: hasBundleReady,
    hasVerifiedCad: verifiedCadAssets.length > 0,
    identityStatus,
    issues,
    lastEvaluatedAt,
    partialData: hasPartialReadinessData,
    connectorClass
  });

  return {
    approval,
    issues: sortIssues(issues),
    readinessSummary,
    riskFlags: sortRiskFlags(riskFlags)
  };
}

/**
 * Resolves record identity confidence from trust score plus import evidence.
 */
function resolveIdentityStatus(part: Pick<Part, "trustScore">, sources: SourceRecord[], hasImportedSource: boolean): PartIdentityStatus {
  if (sources.length === 0 || !hasImportedSource) {
    return "unknown";
  }

  return part.trustScore >= 0.75 ? "confirmed" : "low_confidence";
}

/**
 * Resolves part-level approval from identity, lifecycle, review, and export evidence.
 */
function resolveApprovalStatus({
  connectorClass,
  hasBundleReady,
  hasVerifiedCad,
  identityStatus,
  inFlightGenerationCount,
  lifecycleStatus,
  openReviewCount
}: {
  connectorClass: ConnectorClass;
  hasBundleReady: boolean;
  hasVerifiedCad: boolean;
  identityStatus: PartIdentityStatus;
  inFlightGenerationCount: number;
  lifecycleStatus: Part["lifecycleStatus"];
  openReviewCount: number;
}): PartApprovalStatus {
  if ((connectorClass === "tooling" || connectorClass === "cable") && !hasVerifiedCad && openReviewCount === 0 && inFlightGenerationCount === 0) {
    return "not_applicable";
  }

  if (identityStatus === "confirmed" && lifecycleStatus === "active" && hasBundleReady && openReviewCount === 0 && inFlightGenerationCount === 0) {
    return "approved";
  }

  if (openReviewCount > 0 || inFlightGenerationCount > 0) {
    return "pending_review";
  }

  return "not_requested";
}

/**
 * Builds the approval row from the derived status and visible evidence.
 */
function buildPartApproval(
  partId: string,
  status: PartApprovalStatus,
  evidenceSource: {
    connectorClass: ConnectorClass;
    hasBundleReady: boolean;
    hasVerifiedCad: boolean;
    identityStatus: PartIdentityStatus;
    inFlightGenerationCount: number;
    lastEvaluatedAt: string;
    openReviewCount: number;
  }
): PartApproval {
  const evidence = [
    `identity ${evidenceSource.identityStatus}`,
    evidenceSource.hasVerifiedCad ? "verified CAD evidence present" : "verified CAD evidence missing",
    evidenceSource.hasBundleReady ? "at least one export bundle is ready" : "no export bundle is ready",
    evidenceSource.openReviewCount > 0 ? `${evidenceSource.openReviewCount} open review items` : "no open review items",
    evidenceSource.inFlightGenerationCount > 0 ? `${evidenceSource.inFlightGenerationCount} generation workflows in flight` : "no generation workflows in flight",
    `connector class ${evidenceSource.connectorClass}`
  ];

  if (status === "approved") {
    return {
      decidedAt: evidenceSource.lastEvaluatedAt,
      decidedBy: "system",
      detail: "Identity is confirmed, no open review work remains, and stored, verified export evidence exists.",
      evidence,
      lastUpdatedAt: evidenceSource.lastEvaluatedAt,
      partId,
      status,
      summary: "Approved for engineering use"
    };
  }

  if (status === "pending_review") {
    return {
      decidedAt: null,
      decidedBy: null,
      detail: "Review or generation work is still active, so the part should not be treated as approved yet.",
      evidence,
      lastUpdatedAt: evidenceSource.lastEvaluatedAt,
      partId,
      status,
      summary: "Pending engineering approval"
    };
  }

  if (status === "not_applicable") {
    return {
      decidedAt: null,
      decidedBy: null,
      detail: "This connector-support part does not need the same approval step as a CAD-exportable design part.",
      evidence,
      lastUpdatedAt: evidenceSource.lastEvaluatedAt,
      partId,
      status,
      summary: "Part approval not applicable"
    };
  }

  return {
    decidedAt: null,
    decidedBy: null,
    detail: "Approval has not been earned yet because identity, CAD evidence, or review state is still incomplete.",
    evidence,
    lastUpdatedAt: evidenceSource.lastEvaluatedAt,
    partId,
    status,
    summary: "Approval not earned yet"
  };
}

/**
 * Builds the whole-part readiness summary from derived issues and approval state.
 */
function buildReadinessSummary(
  partId: string,
  input: {
    approvalStatus: PartApprovalStatus;
    bundleReady: boolean;
    hasVerifiedCad: boolean;
    identityStatus: PartIdentityStatus;
    issues: PartIssue[];
    lastEvaluatedAt: string;
    partialData: boolean;
    connectorClass: ConnectorClass;
  }
): PartReadinessSummary {
  const errorIssues = input.issues.filter((issue) => issue.severity === "error");
  const blockerSummary = input.issues.slice(0, 3).map((issue) => issue.summary);
  const recommendedActions = dedupeStrings(input.issues.map((issue) => issueAction(issue.code)));
  const status: PartReadinessStatus =
    input.identityStatus === "unknown" && !input.hasVerifiedCad && input.partialData
      ? "unknown"
      : input.approvalStatus === "approved" && input.bundleReady
        ? "ready_for_export_review"
        : errorIssues.length > 0
          ? "blocked"
          : "needs_attention";

  return {
    blockerCount: input.issues.length,
    blockerSummary,
    connectorClass: input.connectorClass,
    detail: readinessDetail(status, input.issues.length, blockerSummary),
    identityStatus: input.identityStatus,
    label: readinessLabel(status),
    lastEvaluatedAt: input.lastEvaluatedAt,
    partId,
    recommendedActions,
    status
  };
}

/**
 * Creates one stable part issue record.
 */
function createIssue(
  partId: string,
  code: PartIssueCode,
  severity: PartIssueSeverity,
  summary: string,
  detail: string,
  source: string,
  lastUpdatedAt: string
): PartIssue {
  return {
    assignedTo: null,
    code,
    detail,
    id: `issue-${partId}-${code}`,
    lastUpdatedAt,
    partId,
    resolutionNotes: null,
    resolvedAt: null,
    severity,
    source,
    status: "open",
    summary
  };
}

/**
 * Creates one stable part risk flag.
 */
function createRiskFlag(
  partId: string,
  code: PartRiskFlag["code"],
  label: string,
  detail: string,
  tone: PartRiskFlag["tone"],
  lastUpdatedAt: string
): PartRiskFlag {
  return {
    code,
    detail,
    id: `risk-${partId}-${code}`,
    label,
    lastUpdatedAt,
    partId,
    tone
  };
}

/**
 * Returns true when at least one export bundle has every required verified CAD asset.
 */
function hasReadyExportBundle(verifiedCadAssets: Asset[]): boolean {
  const hasFootprint = verifiedCadAssets.some((asset) => asset.assetType === "footprint");
  const hasSymbol = verifiedCadAssets.some((asset) => asset.assetType === "symbol");
  const hasThreeDModel = verifiedCadAssets.some((asset) => asset.assetType === "three_d_model");
  const hasStepModel = verifiedCadAssets.some((asset) => asset.assetType === "three_d_model" && asset.fileFormat === "step");

  return (hasFootprint && hasSymbol) || hasThreeDModel || hasStepModel;
}

/**
 * Formats the missing-CAD summary without implying that references are exportable.
 */
function buildMissingCadSummary(fileBackedCadCount: number, referencedAssetCount: number): string {
  if (fileBackedCadCount > 0) {
    return "CAD files exist, but export verification is still missing.";
  }

  if (referencedAssetCount > 0) {
    return "Only URL-backed references exist for CAD-related evidence.";
  }

  return "Stored, verified CAD is missing.";
}

/**
 * Formats the missing-CAD detail for dense search/detail/admin views.
 */
function buildMissingCadDetail(fileBackedCadCount: number, referencedAssetCount: number, generatedDraftCount: number): string {
  if (fileBackedCadCount > 0) {
    return "Stored CAD files exist, but no export package has every required file marked verified yet.";
  }

  if (generatedDraftCount > 0) {
    return `${generatedDraftCount} generated CAD ${pluralize("draft", generatedDraftCount)} exist, but generated files cannot be exported until review is complete and they are marked verified.`;
  }

  if (referencedAssetCount > 0) {
    return "CAD-related links exist, but linked URLs cannot be downloaded as part of an export.";
  }

  return "No stored CAD file is attached for export or handoff.";
}

/**
 * Formats the partial-data risk detail.
 */
function buildPartialDataDetail(source: PartProjectionSource): string {
  const missing: string[] = [];

  if (source.sources.length === 0) {
    missing.push("source provenance");
  }

  if (source.metrics.length === 0) {
    missing.push("normalized metrics");
  }

  if (source.assets.length === 0) {
    missing.push("asset records");
  }

  if (!source.datasheetRevision) {
    missing.push("datasheet metadata");
  }

  return missing.length > 0 ? `Readiness evidence is partial: missing ${missing.join(", ")}.` : "Readiness evidence is complete enough for evaluation.";
}

/**
 * Formats the duplicate summary without implying that the records are confirmed duplicates.
 */
function buildDuplicateCandidateSummary(candidates: PartDuplicateCandidate[]): string {
  if (candidates.length === 1) {
    return "Possible duplicate catalog record detected.";
  }

  return `${candidates.length} possible duplicate catalog records detected.`;
}

/**
 * Formats duplicate-candidate detail for admin and part detail review.
 */
function buildDuplicateCandidateDetail(candidates: PartDuplicateCandidate[]): string {
  const preview = candidates
    .slice(0, 3)
    .map((candidate) => `${candidate.duplicatePartMpn} (${candidate.duplicateManufacturerName})`)
    .join(", ");
  const remainder = candidates.length > 3 ? ` ${candidates.length - 3} more candidate ${pluralize("record", candidates.length - 3)} remain.` : "";

  return `Matching MPN/package heuristics found possible duplicates: ${preview}.${remainder} Review and merge, reconcile, or dismiss these candidates before treating the catalog row as canonical.`;
}

/**
 * Formats source-conflict detail while keeping operator reconciliation explicit.
 */
function buildSourceConflictDetail(sources: SourceRecord[], reconciliation: SourceReconciliationRecord | null): string {
  const failedProviders = sources
    .filter((source) => source.importStatus === "failed")
    .map((source) => source.providerId);
  const failedProviderPreview = dedupeStrings(failedProviders).slice(0, 3).join(", ");

  if (!reconciliation || reconciliation.resolutionStatus === "unreviewed") {
    return failedProviderPreview
      ? `Provider source health is mixed across ${failedProviderPreview}, so provenance should be reviewed before trusting this record completely.`
      : "Provider source health is mixed, so provenance should be reviewed before trusting this record completely.";
  }

  if (reconciliation.resolutionStatus === "canonical_source_selected") {
    return `Mixed provider health remains, but an operator selected a preferred source record${reconciliation.preferredSourceRecordId ? ` (${reconciliation.preferredSourceRecordId})` : ""}. Verify that the preferred source still reflects the intended canonical record.`;
  }

  return "Mixed provider health remains, but an operator accepted mixed-source provenance. Verify that the accepted source blend still matches engineering intent.";
}

/**
 * Maps issue codes into stable next-action language.
 */
function issueAction(code: PartIssueCode): string {
  return {
    connector_low_confidence: "Review connector relationship confidence before procurement or layout decisions.",
    duplicate_candidate: "Review duplicate candidates and merge or dismiss them before trusting the canonical record.",
    lifecycle_risk: "Review lifecycle risk before continuing design use.",
    low_confidence_identity: "Confirm part identity and provenance before design use.",
    missing_connector_accessories: "Map required or optional accessories before procurement handoff.",
    missing_connector_mate: "Resolve the prioritized mating part before layout decisions.",
    missing_datasheet: "Attach or reference a datasheet before trusting the full record.",
    missing_verified_cad: "Verify or generate a stored CAD file before export.",
    pending_approval: "Complete review and approval before treating this part as engineer-ready.",
    source_conflict: "Investigate mixed provider/source health before relying on this record."
  }[code];
}

/**
 * Maps readiness status into compact badge copy.
 */
function readinessLabel(status: PartReadinessStatus): string {
  return {
    blocked: "Blocked",
    needs_attention: "Needs attention",
    ready_for_export_review: "Ready for Export Review",
    unknown: "Readiness unknown"
  }[status];
}

/**
 * Formats the one-line readiness detail.
 */
function readinessDetail(status: PartReadinessStatus, issueCount: number, blockerSummary: string[]): string {
  if (status === "ready_for_export_review") {
    return "Identity, approval, and export-capable asset evidence are aligned.";
  }

  if (status === "unknown") {
    return "Too little evidence is present to make a trustworthy whole-part readiness call.";
  }

  if (blockerSummary.length === 0) {
    return issueCount > 0 ? `${issueCount} follow-up items remain.` : "No readiness blockers are currently recorded.";
  }

  return `${issueCount} ${pluralize("issue", issueCount)} remain: ${blockerSummary.join(" ")}`;
}

/**
 * Sorts issues by severity, then summary, then id for stable UI rendering.
 */
function sortIssues(issues: PartIssue[]): PartIssue[] {
  const severityScore: Record<PartIssueSeverity, number> = {
    error: 0,
    warning: 1
  };

  return [...issues].sort(
    (left, right) =>
      severityScore[left.severity] - severityScore[right.severity] ||
      left.summary.localeCompare(right.summary) ||
      left.id.localeCompare(right.id)
  );
}

/**
 * Sorts risk flags by tone and label for stable UI rendering.
 */
function sortRiskFlags(riskFlags: PartRiskFlag[]): PartRiskFlag[] {
  const toneScore: Record<PartRiskFlag["tone"], number> = {
    danger: 0,
    review: 1
  };

  return [...riskFlags].sort(
    (left, right) =>
      toneScore[left.tone] - toneScore[right.tone] ||
      left.label.localeCompare(right.label) ||
      left.id.localeCompare(right.id)
  );
}

/**
 * Returns the newest timestamp from a set of ISO-like timestamps.
 */
function latestTimestamp(timestamps: string[]): string {
  return [...timestamps].sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? new Date(0).toISOString();
}

/**
 * Removes empty and repeated strings while preserving order.
 */
function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

/**
 * Pluralizes short readiness labels without bringing in a formatting dependency.
 */
function pluralize(singular: string, count: number, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}
