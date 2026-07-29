/**
 * File header: Implements the provider-neutral component detail workspace.
 *
 * Composition lives here. Pure helpers, tone mappers, form readers, asset
 * trust-check builders, and async loaders are extracted to `./lib/*` and
 * `./loaders.ts` so each concern is reviewable on its own.
 */

import Link from "next/link";
import React from "react";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { AssetCard, EmptyState, MetricTable, SectionHeading, SectionPanel, StatusBadge, TrustMeter } from "@ee-library/ui";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import { formatAssetAvailabilityStatus, formatAssetExportStatus, formatMetricLabel, formatMetricValue, formatParameterLabel, formatParameterValue } from "@ee-library/shared/catalog-runtime";
import { collectCoveredMetricKeys } from "@ee-library/shared/parameter-registry";
import { DetailSectionNav } from "./DetailSectionNav";
import { loadPartDetailPage, loadRecentActivityForPart } from "./loaders";
import type {
  AssetTrustCheckSummary,
  PartDetailPageDetail,
  PartDetailPageRecord,
  PartDetailPageState,
  PartDocumentControlState,
  PartFilesRow,
  PartSupplyOffersState,
  PartWhereUsedState
} from "./lib/types";
import {
  assetTypeLabel,
  buildConnectorConfidenceSummary,
  buildParameterSourceMeta,
  buildUseDecision,
  datasheetAssetLabel,
  formatAclPrincipal,
  formatDateOnly,
  formatDateTime,
  formatDesignators,
  formatDocumentAccess,
  formatDocumentLifecycle,
  formatDocumentType,
  formatInteger,
  formatInventoryStatus,
  formatPriceBreak,
  formatProviderLabel,
  formatQuantity,
  formatRedlineStatus,
  formatRevisionLabel,
  formatSupplyPrice,
  formatSupplySourceLabel,
  formatSupplyTerms,
  formatUsageStatus,
  getBestPriceBreak,
  isSupplyOfferStale,
  previewLabel,
  provenanceLabel,
  validationLabel
} from "./lib/format";
import {
  acquisitionJobStatusTone,
  approvalStatusTone,
  assetClassReadinessTone,
  bundleReadinessTone,
  documentAccessTone,
  documentLifecycleTone,
  enrichmentJobStatusTone,
  generationWorkflowTone,
  inventoryStatusTone,
  mapViewToneToBadge,
  metricConfidenceTone,
  previewTone,
  readinessStatusTone,
  redlineStatusTone,
  scoreTone,
  usageStatusTone,
  validationTone
} from "./lib/tone";
import {
  buildDocumentAclEntryFromForm,
  readDocumentAccessLevel,
  readDocumentControlType,
  readDocumentLifecycleStatus,
  readDocumentRedlineSeverity,
  readDocumentRedlineStatus,
  readGenerationTargetAssetType,
  readOptionalFormString,
  readPositiveInteger,
  readRequiredFormString,
  readReviewOutcome,
  readReviewTargetType
} from "./lib/form-readers";
import { findRelatedPart, renderCableAssumptionList, renderMateRelationList, renderPart, renderRelatedList } from "./lib/related-part";
import {
  buildAssetGatingMap,
  buildAssetTrustCheckSummary,
  buildAssetWorkflowSurfaceSummary,
  buildMissingAssetTrustCheckSummary,
  findAssetPromotionSummary,
  findAssetValidationSummary,
  findReviewStatus,
  formatAssetClassReadinessDetail,
  formatAssetClassReadinessLabel,
  gatedAccessBadge,
  isControlledDocumentAsset
} from "./lib/asset-helpers";
import { AssetPromotionPanel } from "./sections/AssetPromotionPanel";
import { DetailActionRail } from "./sections/DetailActionRail";
import { DetailAcquisitionSummary } from "./sections/DetailAcquisitionSummary";
import { DetailCompletenessChecklist } from "./sections/DetailCompletenessChecklist";
import { DetailContextPanel } from "./sections/DetailContextPanel";
import { DetailEnrichmentSummary } from "./sections/DetailEnrichmentSummary";
import { DetailReadinessSummary } from "./sections/DetailReadinessSummary";
import { DetailUseDecision } from "./sections/DetailUseDecision";
import { DocumentControlPanel } from "./sections/DocumentControlPanel";
import { EngineeringAssetSummary } from "./sections/EngineeringAssetSummary";
import { ExportBundleSummary } from "./sections/ExportBundleSummary";
import { PartDetailSetupState } from "./sections/PartDetailSetupState";
import { PartFilesPanel } from "./sections/PartFilesPanel";
import { PartWhereUsedPanel } from "./sections/PartWhereUsedPanel";
import { RelatedPartLine } from "./sections/RelatedPartLine";
import { ReviewActionPanel } from "./sections/ReviewActionPanel";
import { SupplyOffersPanel } from "./sections/SupplyOffersPanel";
import { TrustLineageStrip } from "./sections/TrustLineageStrip";
import { PackageDimensions } from "../../../components/PackageDimensions";
import { PartSubstitutionPanel } from "../../../components/PartSubstitutionPanel";
import { PartEngineeringMemoryPanel } from "../../../components/PartEngineeringMemoryPanel";
import { AssetInlinePreview } from "../../../components/AssetInlinePreview";
import { WorkspaceActionPanel, type WorkspaceAction } from "../../../components/WorkspaceActionPanel";
import { buildAssetDownloadUrl, buildCompareUrl, createAssetPromotion, createDocumentRedline, createDocumentRevision, createGenerationRequest, createReviewAction, updateDocumentRedline } from "../../../lib/api-client";
import { RecentActivityStrip } from "../../../components/RecentActivityStrip";
import { getSetupStateCopy } from "../../../lib/setup-state-copy";
import { getTrustLineageSummary } from "../../../lib/trust-lineage";
import type { TrustLineageStageSummary, TrustLineageSummary } from "../../../lib/trust-lineage";
import {
  assetTrustStageTone,
  formatAssetPromotionBlockers,
  formatAssetPromotionHistory,
  formatAssetSourceLabel,
  formatAssetTrustStageLabel,
  formatAssetValidationEvidence,
  formatDatasheetParseConfidence,
  formatGenerationWorkflowLabel,
  formatReviewStateLabel,
  getEnrichmentBoundaryCopy,
  getAssetTruthSummary,
  getConnectorWorkflowSummary,
  getImportedPartBoundaryCopy,
  getPartAcquisitionStateLabel,
  getPartCompletenessChecklist,
  getPartEnrichmentStateLabel,
  getPartEnrichmentStatusItems,
  getPartNextActions,
  getQuickReadinessSummary,
  getRecoveryWorkflowSummary,
  getReviewWorkflowSummary,
  reviewStateTone,
  shouldRenderAssetPromotionAction,
  shouldRenderConnectorSections,
  shouldRenderGenerationOptions,
  shouldRenderReviewActions
} from "../../../lib/detail-view-model";
import { getCircuitBlockReuseHeadline } from "../../../lib/circuit-block-reuse-readiness";
import type { CircuitBlockReuseHeadline } from "../../../lib/circuit-block-reuse-readiness";
import type { BadgeTone, MetricTableRow } from "@ee-library/ui";
import type { DetailCompletenessChecklistItem, DetailEnrichmentStatusItem, PartNextAction } from "../../../lib/detail-view-model";
import type { Asset, AssetClassSummary, AssetPromotionSummary, AssetValidationSummary, AuditEvent, BundleReadinessState, BundleReadinessSummary, CatalogDataSource, ControlledDocumentRevision, DocumentAccessLevel, DocumentAclPermission, DocumentAclPrincipalType, DocumentControlType, DocumentRedlineSeverity, DocumentRedlineStatus, DocumentRevisionLifecycleStatus, GenerationSourceReadiness, GenerationTargetAssetType, MateRelation, Package, PartCircuitBlockDependencyRecord, PriceBreak, RelatedPartSummary, ReviewStatusSummary, ReviewTargetType, SupplyOffering } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** DetailPageProps contains the dynamic route parameter supplied by Next.js. */
interface DetailPageProps {
  params: Promise<{ partId: string }>;
}

/** DetailRiskFlag (re-exported from ./lib/types) is used by inline section helpers below. */
type DetailRiskFlag = import("./lib/types").DetailRiskFlag;

/**
 * Renders a component detail page with provenance, connector intelligence, asset state, and export readiness.
 */
export default async function PartDetailPage({ params }: DetailPageProps) {
  const { partId } = await params;
  const pageState = await loadPartDetailPage(partId);

  if (pageState.status === "not_found") {
    notFound();
  }

  if (pageState.status === "setup_required") {
    return <PartDetailSetupState state={pageState} />;
  }

  const { detail, documentControlState, source, supplyOffersState, whereUsedState } = pageState;
  const { assetGroups, assetPromotionSummaries, assetReviewStatuses, assetValidationSummaries, bundleReadiness, generationOptions, record, relatedPartSummaries, workflowReviewStatuses } = detail;
  const recentActivity = await loadRecentActivityForPart(record.part.id);
  const bestMate = record.buildableMatingSet.bestMate;
  const datasheetAsset = record.datasheetRevision?.fileAssetId ? record.assets.find((asset) => asset.id === record.datasheetRevision?.fileAssetId) : undefined;
  const exportActions = bundleReadiness.exportActions;
  const hasConnectorIntelligence = shouldRenderConnectorSections(record);
  const assetTruthSummary = getAssetTruthSummary(record);
  const connectorSummary = getConnectorWorkflowSummary(record);
  const recoverySummary = getRecoveryWorkflowSummary(record);
  const quickReadinessSummary = getQuickReadinessSummary(record);
  const reviewWorkflowSummary = getReviewWorkflowSummary(assetReviewStatuses, workflowReviewStatuses, assetPromotionSummaries);
  const acquisitionSummarySignal = getPartAcquisitionStateLabel(detail.acquisitionSummary);
  const importedBoundaryCopy = getImportedPartBoundaryCopy(detail.acquisitionSummary);
  const enrichmentSummarySignal = getPartEnrichmentStateLabel(detail.enrichmentSummary);
  const enrichmentBoundaryCopy = getEnrichmentBoundaryCopy(detail.enrichmentSummary);
  const enrichmentStatusItems = getPartEnrichmentStatusItems(detail.enrichmentSummary);
  const completenessChecklist = getPartCompletenessChecklist(record, assetGroups, bundleReadiness, generationOptions, reviewWorkflowSummary);
  const trustLineage = getTrustLineageSummary(record, bundleReadiness, assetReviewStatuses, workflowReviewStatuses, assetPromotionSummaries);
  const nextActions = getPartNextActions(record);
  const primaryNextAction = nextActions[0];
  const latestSource = record.sources[0];
  // Metric rows the reconciled parameters already cover would render the same value twice with two
  // different confidence presentations, so only uncovered metrics (part types the registry does not
  // model yet) keep a row here; the Specifications panel is the canonical spec display.
  const coveredMetricKeys = collectCoveredMetricKeys(detail.parameters);
  const metricRows = record.metrics
    .filter((metric) => !coveredMetricKeys.has(metric.metricKey))
    .map<MetricTableRow>((metric) => ({
      label: formatMetricLabel(metric.metricKey),
      meta: `${Math.round(metric.confidenceScore * 100)}% confidence`,
      tone: metricConfidenceTone(metric.confidenceScore),
      value: formatMetricValue(metric)
    }));
  const specificationRows = detail.specifications.map<MetricTableRow>((specification) => ({
    key: specification.id,
    label: specification.specKey,
    meta: formatProviderLabel(specification.providerId),
    tone: "info",
    value: specification.specValue
  }));
  const parameterRows = detail.parameters.map<MetricTableRow>((parameter) => {
    const source = buildParameterSourceMeta(parameter);

    return {
      key: parameter.id,
      label: formatParameterLabel(parameter.paramKey),
      meta: source.meta,
      tone: source.tone,
      value: formatParameterValue(parameter)
    };
  });
  const detailTabs = buildDetailTabs(hasConnectorIntelligence, record, assetGroups, exportActions, whereUsedState, documentControlState, supplyOffersState);
  const populatedAssetGroups = assetGroups.filter((group) => group.bestAsset !== null);
  const missingAssetGroups = assetGroups.filter((group) => group.bestAsset === null);
  const gatingByAssetId = buildAssetGatingMap(documentControlState);

  /**
   * Requests generation through the API while leaving completion and export approval explicit.
   */
  async function requestGenerationAction(formData: FormData) {
    "use server";

    const targetAssetType = readGenerationTargetAssetType(formData.get("targetAssetType"));

    if (!targetAssetType) {
      return;
    }

    await createGenerationRequest(partId, targetAssetType);
    revalidatePath(`/parts/${partId}`);
  }

  /**
   * Persists an explicit review action without implying unreviewed export readiness.
   */
  async function submitReviewAction(formData: FormData) {
    "use server";

    const targetType = readReviewTargetType(formData.get("targetType"));
    const targetId = readRequiredFormString(formData.get("targetId"));
    const outcome = readReviewOutcome(formData.get("outcome"));

    if (!targetType || !targetId || !outcome) {
      return;
    }

    await createReviewAction(partId, {
      outcome,
      targetId,
      targetType
    });
    revalidatePath(`/parts/${partId}`);
  }

  /**
   * Promotes an approved asset to verified-for-export through an explicit API action.
   */
  async function submitAssetPromotionAction(formData: FormData) {
    "use server";

    const assetId = readRequiredFormString(formData.get("assetId"));

    if (!assetId) {
      return;
    }

    await createAssetPromotion(partId, assetId);
    revalidatePath(`/parts/${partId}`);
  }

  /**
   * Creates a controlled document revision without changing the underlying asset review/export state.
   */
  async function createDocumentRevisionAction(formData: FormData) {
    "use server";

    const assetId = readRequiredFormString(formData.get("assetId"));
    const revisionLabel = readRequiredFormString(formData.get("revisionLabel"));
    const documentType = readDocumentControlType(formData.get("documentType"));
    const lifecycleStatus = readDocumentLifecycleStatus(formData.get("lifecycleStatus"));
    const accessLevel = readDocumentAccessLevel(formData.get("accessLevel"));

    if (!assetId || !revisionLabel || !documentType || !lifecycleStatus || !accessLevel) {
      return;
    }

    const aclEntry = buildDocumentAclEntryFromForm(formData);

    await createDocumentRevision(partId, {
      accessLevel,
      accessNotes: readOptionalFormString(formData.get("accessNotes")),
      aclEntries: aclEntry ? [aclEntry] : [],
      assetId,
      documentType,
      effectiveAt: readOptionalFormString(formData.get("effectiveAt")),
      expiresAt: readOptionalFormString(formData.get("expiresAt")),
      lifecycleStatus,
      revisionDate: readOptionalFormString(formData.get("revisionDate")),
      revisionLabel,
      supersedesDocumentRevisionId: readOptionalFormString(formData.get("supersedesDocumentRevisionId"))
    });
    revalidatePath(`/parts/${partId}`);
  }

  /**
   * Adds an engineering redline note to a controlled document revision.
   */
  async function createDocumentRedlineAction(formData: FormData) {
    "use server";

    const documentRevisionId = readRequiredFormString(formData.get("documentRevisionId"));
    const note = readRequiredFormString(formData.get("note"));
    const severity = readDocumentRedlineSeverity(formData.get("severity"));
    const pageNumber = readPositiveInteger(formData.get("pageNumber"));

    if (!documentRevisionId || !note || !severity) {
      return;
    }

    await createDocumentRedline(documentRevisionId, {
      anchorText: readOptionalFormString(formData.get("anchorText")),
      note,
      pageNumber,
      severity
    });
    revalidatePath(`/parts/${partId}`);
  }

  /**
   * Moves one engineering redline through its review workflow.
   */
  async function updateDocumentRedlineAction(formData: FormData) {
    "use server";

    const redlineId = readRequiredFormString(formData.get("redlineId"));
    const redlineStatus = readDocumentRedlineStatus(formData.get("redlineStatus"));

    if (!redlineId || !redlineStatus) {
      return;
    }

    await updateDocumentRedline(redlineId, {
      note: readOptionalFormString(formData.get("note")),
      redlineStatus
    });
    revalidatePath(`/parts/${partId}`);
  }

  const hasSimilarParts = record.similarParts.length > 0;
  const hasCompanionParts = record.companionRecommendations.length > 0;

  return (
    <main className="detail-layout">
      <div className="detail-nav-links">
        <Link className="back-link" href="/catalog">
          &larr; Back to catalog
        </Link>
        <Link className="detail-nav-links__compare" href={buildCompareUrl([record.part.id])}>
          Compare with another part
        </Link>
      </div>

      <section className="detail-section" aria-labelledby="overview-heading">
        <SectionHeading
          id="overview-heading"
          index="01"
          subtitle="Part identity, key specs, package, and datasheet."
          title="Overview"
        />

        <section className="detail-hero">
          <div>
            <p className="app-kicker">{record.manufacturer.name}</p>
            <h1 className="ui-mono">{record.part.mpn}</h1>
            <div className="detail-hero__meta-strip" aria-label="Part identity summary">
              <span>{record.part.category}</span>
              <span className="ui-mono">{record.package.packageName}</span>
              <span>Lifecycle {record.part.lifecycleStatus}</span>
              <span>{record.connectorFamily ? record.connectorFamily.name : "General component"}</span>
            </div>
            {record.part.description && (
              <p className="detail-hero__description">{record.part.description}</p>
            )}
            <TrustLineageStrip summary={trustLineage} />
            <details className="detail-trust-callout" id="how-verification-works">
              <summary>How verification works</summary>
              <p>
                <strong>Approving a draft is not the same as verifying it for export.</strong> Generated CAD stays a draft until someone reviews it, validation evidence is recorded, and it is explicitly marked verified. Export buttons stay disabled until then.
              </p>
            </details>
            <div className="signal-strip" role="group" aria-label="Engineering signals">
              <div className="signal-strip__primary">
                <div className="signal-strip__cell">
                  <span className="signal-strip__cell-label">Ready to use</span>
                  <StatusBadge label={record.readinessSummary.label} tone={readinessStatusTone(record.readinessSummary.status)} />
                </div>
                <div className="signal-strip__cell">
                  <span className="signal-strip__cell-label">Approval</span>
                  <StatusBadge label={record.approval.summary} tone={approvalStatusTone(record.approval.status)} />
                </div>
                <div className="signal-strip__cell">
                  <span className="signal-strip__cell-label">Ready for export</span>
                  <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
                </div>
                <div className="signal-strip__cell">
                  <span className="signal-strip__cell-label">CAD files</span>
                  <StatusBadge label={assetTruthSummary.label} tone={mapViewToneToBadge(assetTruthSummary.tone)} />
                </div>
                <div className="signal-strip__cell">
                  <span className="signal-strip__cell-label">{connectorSummary ? "Connector info" : "CAD recovery"}</span>
                  <StatusBadge label={connectorSummary?.label ?? recoverySummary.label} tone={mapViewToneToBadge(connectorSummary?.tone ?? recoverySummary.tone)} />
                </div>
              </div>
              <div className="signal-strip__secondary">
                <StatusBadge label={record.connectorFamily ? `${record.connectorFamily.name}` : "Non-connector"} tone={record.connectorFamily ? "info" : "neutral"} />
                <StatusBadge label={`Updated ${formatDateTime(record.lastUpdatedAt)}`} tone="neutral" />
              </div>
            </div>
          </div>
          <div className="detail-hero__status">
            <details className="detail-hero__trust-meter">
              <summary>Confidence score</summary>
              <TrustMeter label="Confidence" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
              <p className="muted-copy">A rough score blended from imported sources. The verification steps above actually decide what can be exported.</p>
            </details>
            {record.engineeringMemoryWarning && record.engineeringMemoryWarning.warningCount > 0 && (
              <div className="detail-memory-warning" role="alert">
                <p className="detail-memory-warning__lead">
                  <strong>
                    {record.engineeringMemoryWarning.blockingCount > 0
                      ? "Your team blocked this part before."
                      : "This part bit your team before."}
                  </strong>{" "}
                  {record.engineeringMemoryWarning.warningCount}{" "}
                  confirmed engineering-memory {record.engineeringMemoryWarning.warningCount === 1 ? "record" : "records"} on file. This is a
                  reuse warning, not a gate — it does not change approval, validation, or export state.
                </p>
                <ul className="detail-memory-warning__list">
                  {record.engineeringMemoryWarning.preview.map((entry) => (
                    <li key={entry.recordId}>
                      <StatusBadge
                        label={entry.severity === "blocking" ? "blocking" : entry.outcome === "bit_us" ? "bit us" : entry.severity}
                        tone={entry.severity === "blocking" ? "danger" : "review"}
                      />
                      <span>{entry.title}</span>
                    </li>
                  ))}
                </ul>
                <p className="muted-copy">
                  <a href="#engineering-memory-heading">Review the full engineering memory</a> before reusing this part.
                </p>
              </div>
            )}
            <DetailUseDecision
              assetTruthSummary={assetTruthSummary}
              datasheetAsset={datasheetAsset}
              latestSource={latestSource}
              nextAction={primaryNextAction}
              record={record}
            />
          </div>
        </section>

        <DetailSectionNav tabs={detailTabs} />

        <PartFilesPanel
          assetGroups={assetGroups}
          gatedRevisionsByAssetId={gatingByAssetId}
          partId={record.part.id}
          source={source}
          validationSummaries={assetValidationSummaries}
        />

        <WorkspaceActionPanel
          actions={buildPartWorkspaceActions(record, bundleReadiness, whereUsedState)}
          description="Quick links for this part."
          title="Next workspaces"
        />

        <RecentActivityStrip events={recentActivity} targetType="part" targetId={record.part.id} />

        <DetailReadinessSummary
          approval={record.approval}
          assetTruthSummary={assetTruthSummary}
          connectorOrRecoverySummary={connectorSummary ?? recoverySummary}
          quickReadinessSummary={quickReadinessSummary}
          readinessSummary={record.readinessSummary}
          reviewWorkflowSummary={reviewWorkflowSummary}
        />

        <SectionPanel description="What is done and what is still missing for this part." title="Completeness checklist">
          <DetailCompletenessChecklist items={completenessChecklist} />
        </SectionPanel>

        <div className="detail-overview-grid">
          <DetailContextPanel
            bestMate={bestMate ?? undefined}
            datasheetAsset={datasheetAsset}
            hasConnectorIntelligence={hasConnectorIntelligence}
            latestSource={latestSource}
            record={record}
            relatedPartSummaries={relatedPartSummaries}
          />
          <DetailActionRail approval={record.approval} bundleReadiness={bundleReadiness} issues={record.issues} nextActions={nextActions} riskFlags={record.riskFlags} reviewWorkflowSummary={reviewWorkflowSummary} />
        </div>

        <div className="detail-two-col">
          {/*
            Key metrics only lists measured specs the Specifications panel below does not already
            cover — a covered metric would repeat the same value with a second, conflicting
            confidence badge. When everything is covered (or no metrics exist), the panel
            disappears and Specifications is the one place to read specs.
          */}
          {metricRows.length > 0 ? (
            <SectionPanel description="Extra measured specs not yet part of the Specifications table below. Always confirm against the official datasheet before final use." title="Key metrics">
              <MetricTable rows={metricRows} />
            </SectionPanel>
          ) : null}
          <SectionPanel description="Package outline and dimensions. Toggle between millimeters and inches for the unit you build in." title="Package">
            <PackageDimensions
              partPackage={{
                bodyHeightMm: record.package.bodyHeightMm,
                bodyLengthMm: record.package.bodyLengthMm,
                bodyWidthMm: record.package.bodyWidthMm,
                pinCount: record.package.pinCount,
                pitchMm: record.package.pitchMm
              }}
            />
          </SectionPanel>
        </div>

        <SectionPanel
          description="Key specs combined across distributors and shown in standard units. “Confirmed by datasheet” means we found the same value in the official datasheet. “Sources disagree” means the sources report different values — check the datasheet before relying on it."
          title="Specifications"
        >
          {parameterRows.length > 0 ? (
            <MetricTable headers={{ label: "Specification", meta: "Source", value: "Value" }} rows={parameterRows} />
          ) : (
            <EmptyState
              body="No standardized specifications are derived for this part yet. Importing it from a distributor fills this section in."
              title="No specifications"
            />
          )}
        </SectionPanel>

        <SectionPanel
          description="Exactly what each distributor reports for this part, word for word. Useful for double-checking — always confirm against the official datasheet."
          title="Distributor details"
        >
          {specificationRows.length > 0 ? (
            <MetricTable headers={{ label: "Specification", meta: "Source", value: "Value" }} rows={specificationRows} />
          ) : (
            <EmptyState
              body="No distributor details are stored for this part yet. Importing or re-importing this part from a distributor fills this section in."
              title="No distributor details"
            />
          )}
        </SectionPanel>

        <SectionPanel description="Which datasheet revision this part record references. Downloads live in the Files and downloads panel above." title="Datasheet revision">
          <div className="datasheet-panel">
            <div>
              <p className="ui-mono">{record.datasheetRevision?.revisionLabel ?? "No revision"}</p>
              <p>{record.datasheetRevision?.revisionDate ?? "Revision date unknown"}</p>
              <p>{record.datasheetRevision?.pageCount ? `${record.datasheetRevision.pageCount} pages` : "Page count unknown"}</p>
            </div>
            <div className="datasheet-panel__badges">
              <StatusBadge label={formatDatasheetParseConfidence(record.datasheetRevision?.parseConfidence)} tone={record.datasheetRevision ? scoreTone(record.datasheetRevision.parseConfidence) : "neutral"} />
              <StatusBadge label={datasheetAssetLabel(datasheetAsset)} tone={datasheetAsset && isFileBackedAsset(datasheetAsset) ? "verified" : "review"} />
              <StatusBadge label={latestSource ? `Ingestion ${latestSource.providerId}` : "No source row"} tone={latestSource ? "info" : "neutral"} />
            </div>
          </div>
        </SectionPanel>

        <div id="document-control-heading" />
        <SectionPanel description="Controlled revision history, ACL intent, expiry, supersession, and engineering redlines." title="Document control">
          <DocumentControlPanel
            addRedlineAction={createDocumentRedlineAction}
            assets={record.assets}
            createRevisionAction={createDocumentRevisionAction}
            state={documentControlState}
            updateRedlineAction={updateDocumentRedlineAction}
          />
        </SectionPanel>

        <details className="audit-disclosure detail-audit-disclosure">
          <summary>Acquisition and enrichment audit</summary>
          <div className="detail-audit-disclosure__grid">
            <SectionPanel description="Where this part record came from." title="Acquisition summary">
              <DetailAcquisitionSummary acquisitionSummary={detail.acquisitionSummary} boundaryCopy={importedBoundaryCopy} summarySignal={acquisitionSummarySignal} />
            </SectionPanel>
            <SectionPanel description="Background data updates. These run separately from review and export." title="Enrichment status">
              <DetailEnrichmentSummary boundaryCopy={enrichmentBoundaryCopy} items={enrichmentStatusItems} summary={detail.enrichmentSummary} summarySignal={enrichmentSummarySignal} />
            </SectionPanel>
          </div>
        </details>

        <details className="audit-disclosure">
          <summary>Source rows and import audit</summary>
          <div className="source-list" style={{ marginTop: 8 }}>
            {record.sources.length > 0 ? (
              record.sources.map((source) => (
                <article key={source.id}>
                  <div>
                    <h3>{source.providerId}</h3>
                    <p className="ui-mono">{source.providerPartKey}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>Import status</dt>
                      <dd>{source.importStatus === "imported" ? "Imported" : "Failed import"}</dd>
                    </div>
                    <div>
                      <dt>Fetched</dt>
                      <dd>{formatDateTime(source.fetchedAt)}</dd>
                    </div>
                    <div>
                      <dt>Last seen</dt>
                      <dd>{formatDateTime(source.sourceLastSeenAt)}</dd>
                    </div>
                    <div>
                      <dt>Normalized</dt>
                      <dd>{source.normalizedAt ? formatDateTime(source.normalizedAt) : "Not normalized"}</dd>
                    </div>
                    <div>
                      <dt>Last imported</dt>
                      <dd>{source.sourceLastImportedAt ? formatDateTime(source.sourceLastImportedAt) : "No successful import"}</dd>
                    </div>
                    {source.importErrorDetails ? (
                      <div>
                        <dt>Import error</dt>
                        <dd>{source.importErrorDetails}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Source URL</dt>
                      <dd>{source.sourceUrl ? <a href={source.sourceUrl}>{source.sourceUrl}</a> : "None"}</dd>
                    </div>
                  </dl>
                </article>
              ))
            ) : (
              <EmptyState body="No source records are attached to this part." title="No source rows" />
            )}
          </div>
        </details>
      </section>

      <section className="detail-section" aria-labelledby="where-used-heading">
        <SectionHeading
          id="where-used-heading"
          index="02"
          subtitle="Where this part appears in saved projects. Past use does not mean it is approved."
          title="Where-used"
        />
        <SectionPanel description="Where this part has been used." title="Confirmed usage history">
          <PartWhereUsedPanel state={whereUsedState} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="mates-heading">
        <SectionHeading
          id="mates-heading"
          index="03"
          subtitle="Mating connectors, accessories, tools, and cables for this part."
          title="Mates and accessories"
        />
        {hasConnectorIntelligence ? (
          <>
            <div className="detail-two-col">
              <SectionPanel description="Top recommended mate. Other close mates may still need review." title="Best mate">
                {bestMate ? (
                  <>
                    <RelatedPartLine relation={bestMate} related={findRelatedPart(bestMate.matePartId, relatedPartSummaries)} />
                    {record.buildableMatingSet.alternateMates.length > 0 ? (
                      <>
                        <p className="muted-copy" style={{ marginTop: 12 }}>Alternate mates that stay visible for family and keying review:</p>
                        <div className="related-inline">
                          {record.buildableMatingSet.alternateMates.map((relation) => (
                            <RelatedPartLine key={relation.id} relation={relation} related={findRelatedPart(relation.matePartId, relatedPartSummaries)} />
                          ))}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : (
                  <p className="muted-copy">No best-mate mapping is stored for this part.</p>
                )}
              </SectionPanel>
              <SectionPanel description="Mate, required hardware, tools, and cable options for a buildable set." title="Buildable mating set">
                <ul className="connector-list">
                  <li>
                    <strong>Best mate:</strong> {bestMate ? renderPart(bestMate.matePartId, relatedPartSummaries) : "Not available"}
                  </li>
                  <li>
                    <strong>Alternate mates:</strong> {renderMateRelationList(record.buildableMatingSet.alternateMates, relatedPartSummaries)}
                  </li>
                  <li>
                    <strong>Family conflicts:</strong> {renderRelatedList(record.buildableMatingSet.familyConflicts.map((item) => item.candidatePartId), relatedPartSummaries)}
                  </li>
                  <li>
                    <strong>Required accessories:</strong> {renderRelatedList(record.buildableMatingSet.requiredAccessories.map((item) => item.accessoryPartId), relatedPartSummaries)}
                  </li>
                  <li>
                    <strong>Optional accessories:</strong> {renderRelatedList(record.buildableMatingSet.optionalAccessories.map((item) => item.accessoryPartId), relatedPartSummaries)}
                  </li>
                  <li>
                    <strong>Tooling:</strong> {renderRelatedList(record.buildableMatingSet.toolingRequirements.map((item) => item.accessoryPartId), relatedPartSummaries)}
                  </li>
                  <li>
                    <strong>Compatible cables:</strong> {renderRelatedList(record.buildableMatingSet.cableOptions.map((item) => item.cablePartId), relatedPartSummaries)}
                  </li>
                  <li>
                    <strong>Cable assumptions:</strong> {renderCableAssumptionList(record.buildableMatingSet.cableAssumptions, relatedPartSummaries)}
                  </li>
                  <li>
                    <strong>Confidence model:</strong> {buildConnectorConfidenceSummary(record.buildableMatingSet)}
                  </li>
                </ul>
                {record.buildableMatingSet.warningDetails.length > 0 ? (
                  <>
                    <p className="muted-copy" style={{ marginTop: 12 }}>Connector review cues stay separate from the base relationship list:</p>
                    <ul className="connector-list">
                      {record.buildableMatingSet.warningDetails.map((warning) => (
                        <li key={warning.code}>
                          <strong>{warning.summary}</strong> {warning.detail}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </SectionPanel>
            </div>
          </>
        ) : (
          <EmptyState body="No mating connectors, accessories, tools, or cables are linked yet." title="No mating data" />
        )}
      </section>

      <section className="detail-section" aria-labelledby="alternates-heading">
        <SectionHeading
          id="alternates-heading"
          index="04"
          subtitle="Possible substitutes and parts often used alongside this one."
          title="Alternates and companions"
        />
        {hasSimilarParts || hasCompanionParts ? (
          <div className="detail-two-col">
            <SectionPanel description="Possible substitutes. Verify before using." title="Similar parts">
              {hasSimilarParts ? <p className="related-inline">{renderRelatedList(record.similarParts.map((relation) => relation.similarPartId), relatedPartSummaries)}</p> : <p className="muted-copy">No similar-part alternates are stored yet.</p>}
            </SectionPanel>
            <SectionPanel description="Parts often used alongside this one in real designs." title="Typical companions">
              {hasCompanionParts ? <p className="related-inline">{renderRelatedList(record.companionRecommendations.map((relation) => relation.companionPartId), relatedPartSummaries)}</p> : <p className="muted-copy">No typical companion recommendations are stored yet.</p>}
            </SectionPanel>
          </div>
        ) : (
          <EmptyState body="No substitute or companion parts linked yet." title="No alternates or companions" />
        )}
      </section>

      <section className="detail-section" aria-labelledby="substitutions-heading">
        <SectionHeading
          id="substitutions-heading"
          index="04b"
          subtitle="Engineer-approved alternates that other engineers can pick when this part is not available."
          title="Approved substitutes"
        />
        <SectionPanel
          description="Add an approved alternate. Choose if it applies to all projects or one."
          title="Substitution decisions"
        >
          <PartSubstitutionPanel partId={record.part.id} partMpn={record.part.mpn} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="engineering-memory-heading">
        <SectionHeading
          id="engineering-memory-heading"
          index="04c"
          subtitle="The private answers a public catalog cannot give: did it work or bite us, what mated in the real harness, which CAD was verified against the physical part, what depended on it, and why it was blocked."
          title="Engineering memory"
        />
        <SectionPanel
          description="Record outcomes, real-harness mate verification, CAD-vs-physical checks, fixture dependencies, blocked reasons, and tribal notes. Recording never approves the part or unlocks export."
          title="Private engineering truth"
        >
          <PartEngineeringMemoryPanel partId={record.part.id} partMpn={record.part.mpn} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="sourcing-heading">
        <SectionHeading
          id="sourcing-heading"
          index="05"
          subtitle="Lifecycle status, where info came from, and recorded distributor prices."
          title="Sourcing and lifecycle"
        />
        <div className="detail-two-col">
          <SectionPanel description="Check if this part is still a safe choice for new designs." title="Lifecycle and source health">
            <div className="detail-sourcing-grid">
              <div>
                <span>Lifecycle</span>
                <strong>{record.part.lifecycleStatus}</strong>
                <p>A &quot;ready&quot; library record does not override lifecycle risk. Treat non-active parts carefully.</p>
              </div>
              <div>
                <span>Latest provider</span>
                <strong>{latestSource?.providerId ?? "No source on file"}</strong>
                <p>{latestSource?.sourceLastImportedAt ? `Last import ${formatDateTime(latestSource.sourceLastImportedAt)}` : "No successful import recorded for this part yet."}</p>
              </div>
              <div>
                <span>Source link</span>
                <strong>{latestSource?.sourceUrl ? "Stored" : "Unavailable"}</strong>
                <p>{latestSource?.sourceUrl ?? "The current provider record has no source link."}</p>
              </div>
            </div>
          </SectionPanel>
          <SectionPanel description="Distributor prices and stock. Refresh imports before buying." title="Distributor offers">
            <SupplyOffersPanel state={supplyOffersState} />
          </SectionPanel>
        </div>
      </section>

      <section className="detail-section detail-section--technical" aria-labelledby="files-heading">
        <SectionHeading
          id="files-heading"
          index="06"
          subtitle="Open usable files first. Missing file types are listed separately below."
          title="Files and models"
        />
        <SectionPanel
          title="File coverage"
          description={`${populatedAssetGroups.length} file type${populatedAssetGroups.length === 1 ? "" : "s"} with files · ${missingAssetGroups.length} missing`}
        >
          <div className="empty-recovery-actions">
            <a className="button-link" href="#approval-heading">Request missing files</a>
            <a className="button-link button-link--quiet" href="#export-bundles">Check export readiness</a>
          </div>
        </SectionPanel>
        {populatedAssetGroups.length > 0 ? (
          <div className="asset-grid">
            {populatedAssetGroups.map((group) => (
              <EngineeringAssetSummary
                group={group}
                key={group.assetType}
                promotionAction={submitAssetPromotionAction}
                promotionSummaries={assetPromotionSummaries}
                reviewAction={submitReviewAction}
                reviewStatuses={assetReviewStatuses}
                source={source}
                validationSummaries={assetValidationSummaries}
                gatedRevision={group.bestAsset ? gatingByAssetId.get(group.bestAsset.id) ?? null : null}
              />
            ))}
          </div>
        ) : (
          <EmptyState body="No files yet. Use the action above to request a draft or upload one." title="No usable files yet" />
        )}
        {missingAssetGroups.length > 0 ? (
          <details className="audit-disclosure" style={{ marginTop: 12 }}>
            <summary>Show missing file types ({missingAssetGroups.length})</summary>
            <ul className="info-list">
              {missingAssetGroups.map((group) => (
                <li key={`missing-${group.assetType}`}>
                  <span>{assetTypeLabel(group.assetType)}: no files yet.</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {record.generationWorkflows.length > 0 ? (
          <>
            <h3 className="ui-section-heading__title" style={{ marginTop: 18 }}>
              File generation status
            </h3>
            <p className="muted-copy" style={{ fontSize: "0.88rem", marginBottom: 12 }}>
              Tracks background work separately from stored official or verified files.
            </p>
            <ul className="info-list">
              {record.generationWorkflows.map((workflow) => {
                const reviewStatus = findReviewStatus(workflowReviewStatuses, "generation_workflow", workflow.id);

                return (
                  <li key={workflow.id}>
                    <div className="datasheet-panel">
                      <div>
                        <p>{formatGenerationWorkflowLabel(workflow, record.assets)}</p>
                        <p className="muted-copy">Review: {formatReviewStateLabel(reviewStatus.state)}</p>
                      </div>
                      <div className="datasheet-panel__badges">
                        <StatusBadge label={formatReviewStateLabel(reviewStatus.state)} tone={mapViewToneToBadge(reviewStateTone(reviewStatus.state))} />
                        <ReviewActionPanel reviewAction={submitReviewAction} reviewStatus={reviewStatus} targetId={workflow.id} targetType="generation_workflow" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </section>

      <section className="detail-section" aria-labelledby="approval-heading">
        <SectionHeading
          id="approval-heading"
          index="07"
          subtitle="Review files, request new ones, and approve for export."
          title="Approval and export"
        />

        {shouldRenderGenerationOptions(generationOptions) ? (
          <SectionPanel description="Request a generated draft from what we already know. Drafts must be reviewed before export." title="Request draft generation">
            <ul className="info-list">
              {generationOptions.map((option) => (
                <li key={`req-${option.targetAssetType}`}>
                  <div className="datasheet-panel">
                    <div>
                      <strong>{option.label}</strong>
                      <p>{option.reason}</p>
                      <p className="muted-copy" style={{ fontSize: "0.82rem" }}>
                        Source check: {option.sourceReadiness.reasons.join(" ")}
                      </p>
                      <p className="muted-copy" style={{ fontSize: "0.82rem" }}>
                        Available info: {formatExtractionSupport(option.sourceReadiness)}
                      </p>
                    </div>
                    <div className="datasheet-panel__badges">
                      <StatusBadge label={option.workflowStatusLabel} tone={generationWorkflowTone(option.workflowStatus)} />
                      <StatusBadge label={option.sourceReadiness.ready ? "Enough info to generate" : "Not enough info yet"} tone={option.sourceReadiness.ready ? "info" : "review"} />
                      <form action={requestGenerationAction}>
                        <input name="targetAssetType" type="hidden" value={option.targetAssetType} />
                        <button className="export-action" disabled={!option.canRequest} type="submit">
                          <span>{option.canRequest ? option.actionLabel : option.workflowStatusLabel}</span>
                          <small>{option.sourceReadiness.ready ? "Adds a tracked request to the catalog" : "Blocked until we have enough info"}</small>
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </SectionPanel>
        ) : null}

        <SectionPanel description="Only verified files can be downloaded as exports." title="Export packages" tone="technical">
          <div id="export-bundles" />
          <ExportBundleSummary bundleReadiness={bundleReadiness} />
        </SectionPanel>

      </section>
    </main>
  );
}

/**
 * Creates compact tab badges from real relationship, asset, and export data.
 */
function buildDetailTabs(
  hasConnectorIntelligence: boolean,
  record: PartDetailPageRecord,
  assetGroups: AssetClassSummary[],
  exportActions: { available: boolean }[],
  whereUsedState: PartWhereUsedState,
  documentControlState: PartDocumentControlState,
  supplyOffersState: PartSupplyOffersState
) {
  const connectorCount = hasConnectorIntelligence
    ? record.buildableMatingSet.requiredAccessories.length + record.buildableMatingSet.optionalAccessories.length + record.buildableMatingSet.toolingRequirements.length + record.buildableMatingSet.cableOptions.length + (record.buildableMatingSet.bestMate ? 1 : 0)
    : 0;
  const alternateCount = record.similarParts.length + record.companionRecommendations.length;
  const cadAttentionCount = assetGroups.filter((group) => group.readiness !== "export_ready" && group.readiness !== "validated_file").length;
  const blockedExportCount = exportActions.filter((action) => !action.available).length;
  const whereUsedCount = whereUsedState.status === "available" ? whereUsedState.response.usages.length : 0;
  const documentRevisionCount = documentControlState.status === "available" ? documentControlState.response.revisions.length : 0;
  const supplyOfferCount = supplyOffersState.status === "available" ? supplyOffersState.response.offers.length : 0;

  return [
    { badge: undefined, href: "#overview-heading", label: "Overview" },
    { badge: documentRevisionCount > 0 ? `${documentRevisionCount}` : undefined, href: "#document-control-heading", label: "Document control" },
    { badge: whereUsedCount > 0 ? `${whereUsedCount}` : undefined, href: "#where-used-heading", label: "Where-used" },
    { badge: connectorCount > 0 ? `${connectorCount}` : undefined, href: "#mates-heading", label: "Mates & accessories" },
    { badge: alternateCount > 0 ? `${alternateCount}` : undefined, href: "#alternates-heading", label: "Alternates" },
    { badge: supplyOfferCount > 0 ? `${supplyOfferCount}` : undefined, href: "#sourcing-heading", label: "Sourcing" },
    { badge: cadAttentionCount > 0 ? `${cadAttentionCount}` : assetGroups.length > 0 ? `${assetGroups.length}` : undefined, href: "#files-heading", label: "CAD assets" },
    { badge: blockedExportCount > 0 ? `${blockedExportCount}` : undefined, href: "#approval-heading", label: "Approval & export" }
  ];
}

/**
 * Builds the part-scoped workflow jumps that help operators continue without URL editing.
 */
function buildPartWorkspaceActions(record: PartDetailPageRecord, bundleReadiness: BundleReadinessSummary, whereUsedState: PartWhereUsedState): WorkspaceAction[] {
  const connectorClass = record.readinessSummary.connectorClass;
  const whereUsedCount = whereUsedState.status === "available" ? whereUsedState.response.usages.length : null;

  return [
    {
      body: "Open this part next to others to compare.",
      href: buildCompareUrl([record.part.id]),
      label: "Compare this part",
      signal: "Side-by-side"
    },
    {
      body: "Find every project and BOM that uses this part.",
      href: buildWhereUsedHref("part", record.part.id),
      label: "Check where-used",
      signal: whereUsedCount === null ? "Projects" : `${whereUsedCount} known`
    },
    {
      body: "Attach review notes, links, or files without changing approval.",
      href: buildEvidenceHref("part", record.part.id),
      label: "Attach evidence",
      signal: "Part target"
    },
    {
      body: connectorClass === "non_connector"
        ? "Browse connector sets in case this part joins a reusable connector set."
        : "Open connector sets filtered to this connector class and MPN.",
      href: buildConnectorSetHref(record),
      label: connectorClass === "non_connector" ? "Browse connector sets" : "Review connector set",
      signal: formatConnectorClassSignal(connectorClass)
    },
    {
      body: "Jump to export readiness and see what is verified, missing, or blocked.",
      href: "#approval-heading",
      label: "See what is blocking export",
      signal: bundleReadiness.label
    }
  ];
}

/**
 * Builds a where-used route with a filled-in query so operators do not need query strings.
 */
function buildWhereUsedHref(targetType: string, query: string): string {
  const params = new URLSearchParams({ q: query, targetType });

  return `/where-used?${params.toString()}`;
}

/**
 * Builds an evidence route scoped to one persisted target id.
 */
function buildEvidenceHref(targetType: string, query: string): string {
  const params = new URLSearchParams({ q: query, targetType });

  return `/evidence?${params.toString()}`;
}

/**
 * Builds a connector-set route that prefers class and MPN when connector evidence exists.
 */
function buildConnectorSetHref(record: PartDetailPageRecord): string {
  const connectorClass = record.readinessSummary.connectorClass;

  if (connectorClass === "non_connector") {
    return "/connector-sets";
  }

  const params = new URLSearchParams({
    connectorClass,
    q: record.part.mpn
  });

  return `/connector-sets?${params.toString()}`;
}

/**
 * Formats connector-class signal copy without exposing null or backend casing.
 */
function formatConnectorClassSignal(connectorClass: PartDetailPageRecord["readinessSummary"]["connectorClass"]): string {
  return connectorClass === "non_connector" ? "Optional" : connectorClass.replace(/_/gu, " ");
}

/**
 * Builds explicit risk flags from current lifecycle, asset, connector, and export truth.
 */
function buildDetailWarnings(
  record: PartDetailPageRecord,
  assetTruthSummary: ReturnType<typeof getAssetTruthSummary>,
  connectorOrRecoverySummary: NonNullable<ReturnType<typeof getConnectorWorkflowSummary>> | ReturnType<typeof getRecoveryWorkflowSummary>,
  bundleReadiness: { reason: string; state: BundleReadinessState },
  reviewWorkflowSummary: ReturnType<typeof getReviewWorkflowSummary>
): DetailRiskFlag[] {
  const warnings: DetailRiskFlag[] = [];

  if (record.part.lifecycleStatus === "obsolete" || record.part.lifecycleStatus === "not_recommended") {
    warnings.push({
      detail: `Lifecycle is ${record.part.lifecycleStatus}. Use this part only with explicit engineering intent.`,
      title: "Lifecycle caution",
      tone: record.part.lifecycleStatus === "obsolete" ? "danger" : "review"
    });
  }

  if (assetTruthSummary.tone === "generated") {
    warnings.push({
      detail: "Generated assets remain drafts until review, validation evidence, and explicit promotion are complete.",
      title: "Generated CAD still needs review",
      tone: "review"
    });
  }

  if (connectorOrRecoverySummary.tone === "review") {
    warnings.push({
      detail: connectorOrRecoverySummary.detail,
      title: "Relationship or recovery gap",
      tone: "review"
    });
  }

  if (bundleReadiness.state !== "bundle_ready") {
    warnings.push({
      detail: bundleReadiness.reason,
      title: "Export remains blocked",
      tone: "review"
    });
  }

  if (reviewWorkflowSummary.tone === "danger") {
    warnings.push({
      detail: reviewWorkflowSummary.detail,
      title: "Rejected output present",
      tone: "danger"
    });
  }

  return warnings;
}


/**
 * Formats structured extraction signals without implying parsing is complete or trusted.
 */
function formatExtractionSupport(sourceReadiness: GenerationSourceReadiness): string {
  if (sourceReadiness.extractionSignalIds.length === 0) {
    return "No extracted source signal registered";
  }

  return `${Math.round(sourceReadiness.extractionConfidence * 100)}% extraction confidence from ${sourceReadiness.extractionSignalIds.join(", ")}`;
}

