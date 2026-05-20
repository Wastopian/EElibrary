/**
 * File header: Implements the provider-neutral component detail workspace.
 */

import Link from "next/link";
import React from "react";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { AssetCard, EmptyState, MetricTable, SectionHeading, SectionPanel, StatusBadge, TrustMeter } from "@ee-library/ui";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import { formatAssetAvailabilityStatus, formatAssetExportStatus, formatMetricLabel, formatMetricValue } from "@ee-library/shared/catalog-runtime";
import { DetailSectionNav } from "./DetailSectionNav";
import { PackageDimensions } from "../../../components/PackageDimensions";
import { PartSubstitutionPanel } from "../../../components/PartSubstitutionPanel";
import { PartEngineeringMemoryPanel } from "../../../components/PartEngineeringMemoryPanel";
import { AssetInlinePreview } from "../../../components/AssetInlinePreview";
import { WorkspaceActionPanel, type WorkspaceAction } from "../../../components/WorkspaceActionPanel";
import { buildAssetDownloadUrl, buildCompareUrl, createAssetPromotion, createDocumentRedline, createDocumentRevision, createGenerationRequest, createReviewAction, fetchEntityAuditEvents, fetchPartDetail, fetchPartDetailEnvelope, fetchPartDocumentRevisions, fetchPartSupplyOffers, fetchPartWhereUsed, isApiClientError, updateDocumentRedline } from "../../../lib/api-client";
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
import type { DetailCompletenessChecklistItem, DetailEnrichmentStatusItem, PartNextAction, ViewTone } from "../../../lib/detail-view-model";
import type { Asset, AssetClassReadiness, AssetClassSummary, AssetPromotionSummary, AssetProvenance, AssetValidationSummary, AuditEvent, BundleReadinessState, BundleReadinessSummary, CatalogDataSource, ControlledDocumentRevision, DocumentAccessLevel, DocumentAclPermission, DocumentAclPrincipalType, DocumentControlType, DocumentRedlineSeverity, DocumentRedlineStatus, DocumentRevisionLifecycleStatus, DocumentRevisionListResponse, GenerationSourceReadiness, GenerationTargetAssetType, GenerationWorkflowState, InventoryStatus, MateRelation, Package, PartAcquisitionSummary, PartCircuitBlockDependencyRecord, PartSupplyOffersResponse, PartWhereUsedResponse, PreviewStatus, PriceBreak, ProjectPartUsageStatus, RelatedPartSummary, ReviewOutcome, ReviewStatusSummary, ReviewTargetType, SupplyOffering, ValidationStatus } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** DetailPageProps contains the dynamic route parameter supplied by Next.js. */
interface DetailPageProps {
  params: Promise<{ partId: string }>;
}

/** PartDetailPageDetail extracts the full detail payload shape directly from the API client return type. */
type PartDetailPageDetail = NonNullable<Awaited<ReturnType<typeof fetchPartDetail>>>;

/** PartDetailPageRecord extracts the detail record shape directly from the API client return type. */
type PartDetailPageRecord = PartDetailPageDetail["record"];

/** DetailRiskFlag keeps derived risk messaging explicit and severity-based. */
type DetailRiskFlag = {
  detail: string;
  title: string;
  tone: "danger" | "review";
};

/** PartWhereUsedState keeps part detail renderable when project memory is unavailable. */
type PartWhereUsedState =
  | { status: "available"; response: PartWhereUsedResponse }
  | { status: "not_found" }
  | { status: "unavailable"; code: string; message: string };

/** PartDocumentControlState keeps document-control history optional while the catalog can still render. */
type PartDocumentControlState =
  | { status: "available"; response: DocumentRevisionListResponse }
  | { status: "not_found" }
  | { status: "unavailable"; code: string; message: string };

/** PartSupplyOffersState keeps sourcing snapshots optional beside canonical part truth. */
type PartSupplyOffersState =
  | { status: "available"; response: PartSupplyOffersResponse }
  | { status: "not_found" }
  | { status: "unavailable"; code: string; message: string };

/** PartDetailPageState keeps catalog setup errors separate from genuine 404s. */
type PartDetailPageState =
  | { detail: PartDetailPageDetail; documentControlState: PartDocumentControlState; source: CatalogDataSource | undefined; status: "ready"; supplyOffersState: PartSupplyOffersState; whereUsedState: PartWhereUsedState }
  | { status: "not_found" }
  | { code: string; message: string; partId: string; status: "setup_required"; whereUsedState: PartWhereUsedState };

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
  const metricRows = record.metrics.map<MetricTableRow>((metric) => ({
    label: formatMetricLabel(metric.metricKey),
    meta: `${Math.round(metric.confidenceScore * 100)}% confidence`,
    tone: scoreTone(metric.confidenceScore),
    value: formatMetricValue(metric)
  }));
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
                <strong>Approved drafts are not yet verified for export.</strong> Generated CAD stays labeled as a generated draft until it has been reviewed, has validation evidence on file, and is explicitly marked verified. Export buttons stay disabled until then.
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
              <p className="muted-copy">A rough blended score from imported sources. The verification steps above are what actually gate export.</p>
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
          <SectionPanel description="Key specs in standard units. Always confirm against the official datasheet before final use." title="Key metrics">
            {metricRows.length > 0 ? <MetricTable rows={metricRows} /> : <EmptyState body="No specs are attached to this part yet." title="No specs" />}
          </SectionPanel>
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
        <SectionPanel description="Past project use of this part." title="Confirmed usage history">
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
          subtitle="Lifecycle status, source provenance, and recorded commercial snapshots."
          title="Sourcing and lifecycle"
        />
        <div className="detail-two-col">
          <SectionPanel description="Check if this part is still a safe choice for new designs." title="Lifecycle and source health">
            <div className="detail-sourcing-grid">
              <div>
                <span>Lifecycle</span>
                <strong>{record.part.lifecycleStatus}</strong>
                <p>Library readiness does not override lifecycle risk. Treat non-active parts carefully.</p>
              </div>
              <div>
                <span>Latest provider</span>
                <strong>{latestSource?.providerId ?? "No source row"}</strong>
                <p>{latestSource?.sourceLastImportedAt ? `Last import ${formatDateTime(latestSource.sourceLastImportedAt)}` : "No successful import is recorded for this part yet."}</p>
              </div>
              <div>
                <span>Source URL</span>
                <strong>{latestSource?.sourceUrl ? "Stored" : "Unavailable"}</strong>
                <p>{latestSource?.sourceUrl ?? "The current provider row does not include a source URL."}</p>
              </div>
            </div>
          </SectionPanel>
          <SectionPanel description="Source-linked commercial snapshots; refresh imports before buying." title="Distributor offers">
            <SupplyOffersPanel state={supplyOffersState} />
          </SectionPanel>
        </div>
      </section>

      <section className="detail-section detail-section--technical" aria-labelledby="files-heading">
        <SectionHeading
          id="files-heading"
          index="06"
          subtitle="Open usable files first. Missing classes are listed separately below."
          title="Files and models"
        />
        <SectionPanel
          title="File coverage"
          description={`${populatedAssetGroups.length} class${populatedAssetGroups.length === 1 ? "" : "es"} with files · ${missingAssetGroups.length} missing`}
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
            <summary>Show missing file classes ({missingAssetGroups.length})</summary>
            <ul className="info-list">
              {missingAssetGroups.map((group) => (
                <li key={`missing-${group.assetType}`}>
                  <span>{assetTypeLabel(group.assetType)}: no file rows yet.</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {record.generationWorkflows.length > 0 ? (
          <>
            <h3 className="ui-section-heading__title" style={{ marginTop: 18 }}>
              Generation workflow status
            </h3>
            <p className="muted-copy" style={{ fontSize: "0.88rem", marginBottom: 12 }}>
              Tracks async work separately from stored official or verified file assets.
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
          subtitle="Track reviews, file generation requests, and approval to export."
          title="Approval and export"
        />

        {shouldRenderGenerationOptions(generationOptions) ? (
          <SectionPanel description="Request a draft from existing data. Drafts must be reviewed before export." title="Request draft generation">
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
                        Structured signals: {formatExtractionSupport(option.sourceReadiness)}
                      </p>
                    </div>
                    <div className="datasheet-panel__badges">
                      <StatusBadge label={option.workflowStatusLabel} tone={generationWorkflowTone(option.workflowStatus)} />
                      <StatusBadge label={option.sourceReadiness.ready ? "Signals sufficient" : "Signals incomplete"} tone={option.sourceReadiness.ready ? "info" : "review"} />
                      <form action={requestGenerationAction}>
                        <input name="targetAssetType" type="hidden" value={option.targetAssetType} />
                        <button className="export-action" disabled={!option.canRequest} type="submit">
                          <span>{option.canRequest ? option.actionLabel : option.workflowStatusLabel}</span>
                          <small>{option.sourceReadiness.ready ? "Creates a tracked request in the catalog" : "Blocked until source signals are sufficient"}</small>
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </SectionPanel>
        ) : null}

        <SectionPanel description="Only verified files can power export bundles." title="Export bundles" tone="technical">
          <div id="export-bundles" />
          <ExportBundleSummary bundleReadiness={bundleReadiness} />
        </SectionPanel>

      </section>
    </main>
  );
}

/**
 * Loads the primary detail record and keeps setup failures renderable instead of route-fatal.
 */
async function loadPartDetailPage(partId: string): Promise<PartDetailPageState> {
  const whereUsedPromise = loadPartWhereUsed(partId);
  const supplyOffersPromise = loadPartSupplyOffers(partId);

  try {
    const detailEnvelope = await fetchPartDetailEnvelope(partId);

    if (!detailEnvelope) {
      return { status: "not_found" };
    }

    const detail = detailEnvelope.data;
    const [whereUsedState, documentControlState, supplyOffersState] = await Promise.all([
      whereUsedPromise,
      loadPartDocumentControl(partId),
      supplyOffersPromise
    ]);

    return {
      detail,
      documentControlState,
      source: detailEnvelope.source,
      status: "ready",
      supplyOffersState,
      whereUsedState
    };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        partId,
        status: "setup_required",
        whereUsedState: await whereUsedPromise
      };
    }

    return {
      code: "API_UNAVAILABLE",
      message: "The API could not be reached, so catalog detail truth cannot be read.",
      partId,
      status: "setup_required",
      whereUsedState: await whereUsedPromise
    };
  }
}

/**
 * Renders setup guidance when detail truth cannot be loaded from the catalog API.
 */
function PartDetailSetupState({ state }: { state: Extract<PartDetailPageState, { status: "setup_required" }> }) {
  const copy = getSetupStateCopy(state.code);

  return (
    <main className="detail-layout">
      <div className="detail-nav-links">
        <Link className="back-link" href="/catalog">
          &larr; Back to catalog
        </Link>
      </div>

      <section className="detail-section" aria-labelledby="part-detail-setup-heading">
        <SectionHeading
          id="part-detail-setup-heading"
          index="01"
          subtitle={copy.body}
          title={copy.headline}
        />
        <SectionPanel description="Once the catalog is reachable, this part record will load on its own." title="What you can do now">
          <div className="setup-steps">
            <div>
              <strong>Try again in a moment</strong>
              <span>If you opened this from a link, refresh after a minute.</span>
            </div>
            <div>
              <strong>Check service status</strong>
              <span>Open <Link href="/system">System</Link> to see what is offline.</span>
            </div>
            <div>
              <strong>Need an admin?</strong>
              <span>Share the technical details below so they can bring the catalog online.</span>
            </div>
          </div>
        </SectionPanel>
        <details className="audit-disclosure detail-audit-disclosure">
          <summary>Show technical details</summary>
          <div className="setup-steps">
            <div>
              <strong>Detail read failed</strong>
              <span>{state.code}: {state.message}</span>
              <code>{state.partId}</code>
            </div>
            <div>
              <strong>Bring the catalog online</strong>
              <code>$env:DATABASE_URL=&quot;postgres://ee_library:ee_library@127.0.0.1:5432/ee_library&quot;</code>
              <code>npm run db:migrate</code>
              <code>npm run dev</code>
            </div>
          </div>
        </details>
        <SectionPanel description="Usage history loads separately, so it can still appear here." title="Project usage history">
          <PartWhereUsedPanel state={state.whereUsedState} />
        </SectionPanel>
      </section>
    </main>
  );
}

/**
 * Loads where-used history as a recoverable side-channel so detail truth can still render.
 */
async function loadPartWhereUsed(partId: string): Promise<PartWhereUsedState> {
  try {
    const response = await fetchPartWhereUsed(partId);

    return response ? { response, status: "available" } : { status: "not_found" };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        status: "unavailable"
      };
    }

    return {
      code: "WHERE_USED_UNAVAILABLE",
      message: "Where-used history could not be read from projects.",
      status: "unavailable"
    };
  }
}

/**
 * Loads supply offer snapshots as a recoverable side-channel so detail truth stays renderable.
 */
async function loadPartSupplyOffers(partId: string): Promise<PartSupplyOffersState> {
  try {
    const response = await fetchPartSupplyOffers(partId);

    return response ? { response, status: "available" } : { status: "not_found" };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        status: "unavailable"
      };
    }

    return {
      code: "SUPPLY_OFFERS_UNAVAILABLE",
      message: "Supply offer snapshots could not be read from the catalog.",
      status: "unavailable"
    };
  }
}

/**
 * Loads the last few audit events for this part so detail pages can render a compact
 * "Recent activity" strip. Auditing is admin-gated; for non-admin sessions or any
 * transport failure the helper returns null so the page renders without a strip.
 */
async function loadRecentActivityForPart(partId: string): Promise<AuditEvent[] | null> {
  const response = await fetchEntityAuditEvents("part", partId, 5);
  return response ? response.events : null;
}

/**
 * Loads document-control history as a recoverable side-channel for part detail.
 */
async function loadPartDocumentControl(partId: string): Promise<PartDocumentControlState> {
  try {
    const response = await fetchPartDocumentRevisions(partId);

    return response ? { response, status: "available" } : { status: "not_found" };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        status: "unavailable"
      };
    }

    return {
      code: "DOCUMENT_CONTROL_UNAVAILABLE",
      message: "Controlled document revision history could not be read.",
      status: "unavailable"
    };
  }
}

/**
 * Renders controlled document revision history, ACL intent, and redline workflows.
 */
function DocumentControlPanel({
  addRedlineAction,
  assets,
  createRevisionAction,
  state,
  updateRedlineAction
}: {
  addRedlineAction: (formData: FormData) => Promise<void>;
  assets: Asset[];
  createRevisionAction: (formData: FormData) => Promise<void>;
  state: PartDocumentControlState;
  updateRedlineAction: (formData: FormData) => Promise<void>;
}) {
  const documentAssets = assets.filter((asset) => isControlledDocumentAsset(asset));
  const revisions = state.status === "available" ? state.response.revisions : [];

  if (state.status === "unavailable") {
    return (
      <EmptyState
        body={`Document control requires the database-backed catalog. ${state.message}`}
        title="Document control unavailable"
      />
    );
  }

  if (documentAssets.length === 0) {
    return (
      <EmptyState
        body="No datasheet or mechanical drawing assets are attached yet, so there is no file to place under document control."
        title="No controllable documents"
      />
    );
  }

  return (
    <div className="document-control-panel">
      <p className="document-control-panel__boundary">
        <strong>Admin-gated foundation.</strong> ACL entries are recorded for future RBAC and ITAR enforcement; asset review, validation, and export promotion remain separate workflows.
      </p>

      <form action={createRevisionAction} className="document-control-form">
        <div className="form-row">
          <label className="form-label" htmlFor="document-asset-id">Document asset</label>
          <select className="form-select" id="document-asset-id" name="assetId" required>
            {documentAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {assetTypeLabel(asset)} / {asset.fileFormat} / {asset.storageKey ? "stored file" : "reference"}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-type">Document type</label>
          <select className="form-select" id="document-type" name="documentType" defaultValue={documentAssets[0]?.assetType === "mechanical_drawing" ? "mechanical_drawing" : "datasheet"}>
            <option value="datasheet">Datasheet</option>
            <option value="mechanical_drawing">Mechanical drawing</option>
            <option value="controlled_drawing">Controlled drawing</option>
            <option value="specification">Specification</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-revision-label">Revision</label>
          <input className="form-input" id="document-revision-label" name="revisionLabel" placeholder="Rev A" required />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-revision-date">Revision date</label>
          <input className="form-input" id="document-revision-date" name="revisionDate" type="date" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-lifecycle">Lifecycle</label>
          <select className="form-select" id="document-lifecycle" name="lifecycleStatus" defaultValue="in_review">
            <option value="draft">Draft</option>
            <option value="in_review">In review</option>
            <option value="released">Released</option>
            <option value="superseded">Superseded</option>
            <option value="expired">Expired</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-access">Access</label>
          <select className="form-select" id="document-access" name="accessLevel" defaultValue="internal">
            <option value="public">Public</option>
            <option value="internal">Internal</option>
            <option value="restricted">Restricted</option>
            <option value="itar_controlled">ITAR controlled</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-supersedes">Replaces revision</label>
          <select className="form-select" id="document-supersedes" name="supersedesDocumentRevisionId" defaultValue="">
            <option value="">None</option>
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                {revision.revisionLabel} / {formatDocumentType(revision.documentType)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-effective">Effective</label>
          <input className="form-input" id="document-effective" name="effectiveAt" type="datetime-local" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-expires">Expires</label>
          <input className="form-input" id="document-expires" name="expiresAt" type="datetime-local" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-principal-id">Review principal</label>
          <input className="form-input" id="document-principal-id" name="principalId" placeholder="hardware-team" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-principal-type">Principal type</label>
          <select className="form-select" id="document-principal-type" name="principalType" defaultValue="team">
            <option value="team">Team</option>
            <option value="role">Role</option>
            <option value="user">User</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-permission">Permission</label>
          <select className="form-select" id="document-permission" name="permission" defaultValue="review">
            <option value="view">View</option>
            <option value="review">Review</option>
            <option value="approve">Approve</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="form-row document-control-form__wide">
          <label className="form-label" htmlFor="document-access-notes">Access notes</label>
          <textarea className="form-textarea" id="document-access-notes" name="accessNotes" placeholder="Distribution limits, customer program, or review instructions." />
        </div>
        <div className="document-control-form__actions">
          <button className="button-link" type="submit">Create controlled revision</button>
        </div>
      </form>

      {state.status === "not_found" || revisions.length === 0 ? (
        <EmptyState
          body="No controlled revisions have been recorded for this part yet. Create one from a datasheet or drawing asset above."
          title="No controlled revisions"
        />
      ) : (
        <div className="document-control-revision-list">
          {revisions.map((revision) => (
            <DocumentRevisionCard
              addRedlineAction={addRedlineAction}
              key={revision.id}
              revision={revision}
              updateRedlineAction={updateRedlineAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders one controlled document revision with its review notes and ACL grants.
 */
function DocumentRevisionCard({
  addRedlineAction,
  revision,
  updateRedlineAction
}: {
  addRedlineAction: (formData: FormData) => Promise<void>;
  revision: ControlledDocumentRevision;
  updateRedlineAction: (formData: FormData) => Promise<void>;
}) {
  const openRedlineCount = revision.redlines.filter((redline) => redline.redlineStatus === "open").length;

  return (
    <article className="document-revision-card">
      <div className="document-revision-card__header">
        <div>
          <p className="app-kicker">{formatDocumentType(revision.documentType)}</p>
          <h3>{revision.revisionLabel}</h3>
          <p className="muted-copy">{revision.revisionDate ? `Revision date ${formatDateOnly(revision.revisionDate)}` : "Revision date not recorded"}</p>
        </div>
        <div className="document-revision-card__badges">
          <StatusBadge label={formatDocumentLifecycle(revision.lifecycleStatus)} tone={documentLifecycleTone(revision.lifecycleStatus)} />
          <StatusBadge label={formatDocumentAccess(revision.accessLevel)} tone={documentAccessTone(revision.accessLevel)} />
          <StatusBadge label={`${openRedlineCount} open redline${openRedlineCount === 1 ? "" : "s"}`} tone={openRedlineCount > 0 ? "review" : "verified"} />
        </div>
      </div>

      <dl className="document-revision-card__facts">
        <div>
          <dt>Asset</dt>
          <dd className="ui-mono">{revision.asset.fileFormat} / {revision.asset.storageKey ? "stored" : "reference"}</dd>
        </div>
        <div>
          <dt>File hash</dt>
          <dd className="ui-mono">{revision.sourceAssetHash ?? revision.asset.fileHash ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>{revision.effectiveAt ? formatDateTime(revision.effectiveAt) : "Not set"}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{revision.expiresAt ? formatDateTime(revision.expiresAt) : "No expiry"}</dd>
        </div>
        <div>
          <dt>Replaces</dt>
          <dd>{revision.supersedesDocumentRevisionId ?? "None"}</dd>
        </div>
        <div>
          <dt>Replaced by</dt>
          <dd>{revision.supersededByDocumentRevisionId ?? "None"}</dd>
        </div>
      </dl>

      {revision.accessNotes ? <p className="document-revision-card__notes">{revision.accessNotes}</p> : null}

      <div className="document-revision-card__subgrid">
        <section aria-label="Document ACL entries">
          <h4>ACL intent</h4>
          {revision.aclEntries.length > 0 ? (
            <ul className="info-list">
              {revision.aclEntries.map((entry) => (
                <li key={entry.id}>
                  <span>
                    {formatAclPrincipal(entry.principalType, entry.principalId)} can {entry.permission}
                    {entry.expiresAt ? ` until ${formatDateTime(entry.expiresAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-copy">No explicit ACL grants recorded for this revision.</p>
          )}
        </section>

        <section aria-label="Document redlines">
          <h4>Redlines</h4>
          {revision.redlines.length > 0 ? (
            <div className="document-redline-list">
              {revision.redlines.map((redline) => (
                <article className="document-redline" key={redline.id}>
                  <div className="document-redline__header">
                    <StatusBadge label={formatRedlineStatus(redline.redlineStatus)} tone={redlineStatusTone(redline.redlineStatus, redline.severity)} />
                    <span>{redline.pageNumber ? `Page ${redline.pageNumber}` : "No page anchor"}</span>
                  </div>
                  <p>{redline.note}</p>
                  {redline.anchorText ? <p className="muted-copy">Anchor: {redline.anchorText}</p> : null}
                  {redline.redlineStatus === "open" ? (
                    <form action={updateRedlineAction} className="document-redline__resolve-form">
                      <input name="redlineId" type="hidden" value={redline.id} />
                      <input name="redlineStatus" type="hidden" value="resolved" />
                      <button className="button-link button-link--quiet" type="submit">Resolve</button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No redlines recorded for this revision.</p>
          )}

          <form action={addRedlineAction} className="document-redline-form">
            <input name="documentRevisionId" type="hidden" value={revision.id} />
            <div className="form-row">
              <label className="form-label" htmlFor={`redline-note-${revision.id}`}>New redline</label>
              <textarea className="form-textarea" id={`redline-note-${revision.id}`} name="note" placeholder="Review note or markup summary." required />
            </div>
            <div className="document-redline-form__row">
              <input className="form-input" min={1} name="pageNumber" placeholder="Page" type="number" />
              <select className="form-select" name="severity" defaultValue="review">
                <option value="info">Info</option>
                <option value="review">Review</option>
                <option value="blocker">Blocker</option>
              </select>
            </div>
            <input className="form-input" name="anchorText" placeholder="Anchor text or drawing zone" />
            <button className="button-link" type="submit">Add redline</button>
          </form>
        </section>
      </div>
    </article>
  );
}

/**
 * Renders source-linked commercial snapshots without treating them as live stock or approval.
 */
function SupplyOffersPanel({ state }: { state: PartSupplyOffersState }) {
  if (state.status === "unavailable") {
    return (
      <EmptyState
        body={`Supply snapshots require the database-backed catalog. ${state.message}`}
        title="Supply offers unavailable"
      />
    );
  }

  if (state.status === "not_found") {
    return (
      <EmptyState
        body="The detail source did not return a catalog part identity for this supply-offer request."
        title="No distributor offers recorded"
      />
    );
  }

  if (state.response.offers.length === 0) {
    return (
      <EmptyState
        body="No source-record-linked distributor offers are recorded for this part yet. Run a provider import that captures commercial snapshots before using this workspace for sourcing decisions."
        title="No distributor offers recorded"
      />
    );
  }

  const { response } = state;
  const { summary } = response;

  return (
    <div className="supply-offers-panel">
      <p className="document-control-panel__boundary">
        <strong>Commercial snapshot.</strong> {response.boundary}
      </p>

      <div className="detail-sourcing-grid" style={{ marginBottom: 12 }}>
        <div>
          <span>Recorded offers</span>
          <strong>{summary.offerCount}</strong>
          <p>{summary.inStockOfferCount} in-stock snapshot{summary.inStockOfferCount === 1 ? "" : "s"} recorded.</p>
        </div>
        <div>
          <span>Lowest price tier</span>
          <strong>{summary.lowestUnitPrice ? formatSupplyPrice(summary.lowestUnitPrice.unitPrice, summary.lowestUnitPrice.currencyCode) : "No price tiers"}</strong>
          <p>{summary.lowestUnitPrice ? `${formatSupplySourceLabel(summary.lowestUnitPrice)} at ${summary.lowestUnitPrice.minQuantity}+ units.` : "No provider price breaks are attached yet."}</p>
        </div>
        <div>
          <span>Freshness</span>
          <strong>{summary.lastSeenAt ? formatDateTime(summary.lastSeenAt) : "Not seen"}</strong>
          <p>{summary.staleOfferCount} offer{summary.staleOfferCount === 1 ? "" : "s"} older than {response.staleAfterDays} days.</p>
        </div>
      </div>

      <div className="ui-table-wrap">
        <table className="ui-table supply-offers-table">
          <thead>
            <tr>
              <th scope="col">Supplier</th>
              <th scope="col">Availability</th>
              <th scope="col">Terms</th>
              <th scope="col">Price break</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {response.offers.map((offer) => (
              <SupplyOfferRow key={offer.id} offer={offer} staleAfterDays={response.staleAfterDays} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Renders one supply-offer row with source and freshness context.
 */
function SupplyOfferRow({ offer, staleAfterDays }: { offer: SupplyOffering; staleAfterDays: number }) {
  const bestBreak = getBestPriceBreak(offer.priceBreaks);
  const supplierLabel = formatSupplySourceLabel(offer);

  return (
    <tr>
      <td>
        <strong>{supplierLabel}</strong>
        <p>{offer.supplierName ? `via ${offer.providerId}` : `Provider ${offer.providerId}`}</p>
        <p>{offer.providerSku ? `SKU ${offer.providerSku}` : `Provider key ${offer.providerPartKey}`}</p>
        {offer.sourceUrl ? <a href={offer.sourceUrl}>Source record</a> : <span className="muted-copy">No source URL</span>}
      </td>
      <td>
        <StatusBadge label={formatInventoryStatus(offer.inventoryStatus)} tone={inventoryStatusTone(offer.inventoryStatus)} />
        <p>{offer.inventoryQuantity === null ? "Quantity not captured" : `${formatInteger(offer.inventoryQuantity)} available`}</p>
      </td>
      <td>
        <strong>{formatSupplyTerms(offer)}</strong>
        <p>{offer.packaging ?? "Packaging not captured"}{offer.preferredRank ? ` / preferred rank ${offer.preferredRank}` : ""}</p>
      </td>
      <td>
        <strong>{bestBreak ? formatPriceBreak(bestBreak) : "No price tier"}</strong>
        <p>{offer.priceBreaks.length > 1 ? `${offer.priceBreaks.length} tiers captured` : "Single or no tier captured"}</p>
      </td>
      <td>
        <StatusBadge label={isSupplyOfferStale(offer.lastSeenAt, staleAfterDays) ? "Stale" : "Current"} tone={isSupplyOfferStale(offer.lastSeenAt, staleAfterDays) ? "review" : "info"} />
        <p>{formatDateTime(offer.lastSeenAt)}</p>
      </td>
    </tr>
  );
}

/**
 * Renders confirmed project usage history and circuit-block dependencies without feeding
 * either signal into approval or export labels.
 *
 * The panel keeps both signals visibly distinct: project usages are concrete BOM history,
 * circuit-block dependencies are reusable-design memory. A part can have one and not the
 * other (a part appearing in three reusable blocks but never instantiated yet, or a part
 * confirmed in two projects but not yet promoted into a reusable block). Neither row count
 * implies the part is approved, validated, or export-ready — the panel boundary repeats that.
 */
function PartWhereUsedPanel({ state }: { state: PartWhereUsedState }) {
  if (state.status === "unavailable") {
    return (
      <EmptyState
        body={`Confirmed where-used history requires projects to be available. ${state.message}`}
        title="Where-used unavailable"
      />
    );
  }

  if (state.status === "not_found") {
    return (
      <EmptyState
        body="The detail source did not return a project-memory part identity for this where-used request."
        title="No where-used history"
      />
    );
  }

  const { usages, circuitBlockDependencies } = state.response;

  if (usages.length === 0 && circuitBlockDependencies.length === 0) {
    return (
      <EmptyState
        body="No confirmed project usage records and no circuit block dependencies exist for this part. Weak, ambiguous, and unmatched BOM rows are intentionally excluded."
        title="No confirmed project usage"
      />
    );
  }

  return (
    <div className="where-used-panel">
      <p className="where-used-panel__boundary">
        <strong>Usage evidence only.</strong> Project usage and circuit-block dependency do not approve this part or make exports available.
      </p>

      <section aria-labelledby="part-where-used-projects-heading" className="where-used-panel__section">
        <header className="where-used-panel__section-heading">
          <h3 id="part-where-used-projects-heading">Projects</h3>
          <p className="muted-copy">
            {usages.length > 0
              ? `Confirmed in ${usages.length} ${usages.length === 1 ? "project usage row" : "project usage rows"}.`
              : "No confirmed project usage rows. Weak, ambiguous, and unmatched BOM rows are excluded."}
          </p>
        </header>
        {usages.length === 0
          ? <EmptyState title="No confirmed project usage" body="Once a matching BOM row promotes to a confirmed usage record, it will appear here." />
          : (
            <div className="where-used-table-wrap">
              <table className="where-used-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Revision</th>
                    <th>Usage status</th>
                    <th>Designators</th>
                    <th>Qty</th>
                    <th>Context</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {usages.map(({ bomLine, project, projectRevision, usage }) => (
                    <tr key={usage.id}>
                      <td>
                        <Link href={`/projects/${project.id}`}>{project.name}</Link>
                        <p className="ui-mono">{project.projectKey}</p>
                      </td>
                      <td>
                        <span>{formatRevisionLabel(projectRevision.revisionLabel)}</span>
                        <p>{projectRevision.revisionStatus}</p>
                      </td>
                      <td>
                        <StatusBadge label={formatUsageStatus(usage.usageStatus)} tone={usageStatusTone(usage.usageStatus)} />
                      </td>
                      <td className="ui-mono">{formatDesignators(usage.designators)}</td>
                      <td>{formatQuantity(usage.quantity)}</td>
                      <td>
                        <span>{usage.usageContext ?? bomLine?.rawDescription ?? "No usage context recorded"}</span>
                        {bomLine ? <p className="ui-mono">BOM row {bomLine.rowNumber}</p> : <p>No BOM row linked</p>}
                      </td>
                      <td>{formatDateTime(usage.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <section aria-labelledby="part-where-used-blocks-heading" className="where-used-panel__section">
        <header className="where-used-panel__section-heading">
          <h3 id="part-where-used-blocks-heading">Circuit blocks</h3>
          <p className="muted-copy">
            {circuitBlockDependencies.length > 0
              ? `Linked to ${circuitBlockDependencies.length} reusable ${circuitBlockDependencies.length === 1 ? "block" : "blocks"}. Reuse readiness here mirrors the block detail strip and does not approve this part.`
              : "No reusable block references this part yet. Promoting a working circuit into a reusable block is how engineering memory grows."}
          </p>
        </header>
        {circuitBlockDependencies.length === 0
          ? <EmptyState title="No circuit block dependencies" body="When this part is added to a role in a reusable circuit block, that block will appear here with its reuse-readiness verdict." />
          : <PartCircuitBlockDependencyTable dependencies={circuitBlockDependencies} />}
      </section>
    </div>
  );
}

/**
 * Renders the per-block dependency rows showing which roles this part fills inside each
 * reusable circuit block, alongside the block's reuse-readiness headline.
 *
 * The headline is derived locally from the persisted `CircuitBlockSummary` using the same
 * shared helper as the library and detail strip, so a part page can never claim a block is
 * "ready to reuse" when the detail strip would say it is blocked.
 */
function PartCircuitBlockDependencyTable({ dependencies }: { dependencies: PartCircuitBlockDependencyRecord[] }) {
  return (
    <div className="where-used-table-wrap">
      <table className="where-used-table">
        <thead>
          <tr>
            <th>Block</th>
            <th>Status</th>
            <th>Reuse</th>
            <th>Roles for this part</th>
            <th>Required roles</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {dependencies.map(({ summary, blockParts }) => {
            const headline: CircuitBlockReuseHeadline = getCircuitBlockReuseHeadline(summary);
            return (
              <tr key={summary.circuitBlock.id}>
                <td>
                  <Link href={`/circuit-blocks/${encodeURIComponent(summary.circuitBlock.id)}`}>
                    {summary.circuitBlock.name}
                  </Link>
                  <p className="ui-mono">{summary.circuitBlock.blockKey}</p>
                  <p className="muted-copy">{summary.circuitBlock.reuseScope || summary.circuitBlock.description}</p>
                </td>
                <td>
                  <StatusBadge
                    label={formatCircuitBlockStatusLabel(summary.circuitBlock.status)}
                    tone={circuitBlockStatusToneForWhereUsed(summary.circuitBlock.status)}
                  />
                </td>
                <td>
                  <StatusBadge label={headline.label} tone={headlineToneToBadgeForWhereUsed(headline.tone)} />
                  <p className="muted-copy">{headline.detail}</p>
                </td>
                <td>
                  <ul className="where-used-role-list">
                    {blockParts.map((blockPart) => (
                      <li key={blockPart.id}>
                        <span className="ui-mono">{blockPart.role}</span>
                        {" "}
                        <StatusBadge label={blockPart.isRequired ? "Required" : "Optional"} tone={blockPart.isRequired ? "review" : "neutral"} />
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{summary.requiredPartCount}</td>
                <td>{formatDateTime(summary.circuitBlock.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Formats `CircuitBlockStatus` enum values for the part-detail circuit-block dependency table.
 */
function formatCircuitBlockStatusLabel(status: PartCircuitBlockDependencyRecord["summary"]["circuitBlock"]["status"]): string {
  return {
    approved: "Approved",
    deprecated: "Deprecated",
    draft: "Draft",
    in_review: "In review",
    restricted: "Restricted"
  }[status];
}

/**
 * Maps `CircuitBlockStatus` to a badge tone for the part-detail where-used table.
 *
 * Block status is intentionally surfaced as reference context, never as part approval.
 */
function circuitBlockStatusToneForWhereUsed(status: PartCircuitBlockDependencyRecord["summary"]["circuitBlock"]["status"]): BadgeTone {
  if (status === "approved") return "verified";
  if (status === "in_review" || status === "restricted") return "review";
  if (status === "deprecated") return "neutral";
  return "info";
}

/**
 * Maps the reuse-headline `ViewTone` onto a `BadgeTone` accepted by StatusBadge.
 */
function headlineToneToBadgeForWhereUsed(tone: CircuitBlockReuseHeadline["tone"]): BadgeTone {
  if (tone === "generated") return "info";
  return tone;
}

/**
 * Renders the answer-first decision card above the audit-heavy detail sections.
 */
function DetailUseDecision({
  assetTruthSummary,
  datasheetAsset,
  latestSource,
  nextAction,
  record
}: {
  assetTruthSummary: ReturnType<typeof getAssetTruthSummary>;
  datasheetAsset: Asset | undefined;
  latestSource: PartDetailPageRecord["sources"][number] | undefined;
  nextAction: PartNextAction | undefined;
  record: PartDetailPageRecord;
}) {
  const decision = buildUseDecision(record);

  return (
    <section aria-label="Use decision" className="detail-use-decision">
      <div className="detail-use-decision__header">
        <span>Use decision</span>
        <StatusBadge label={decision.label} tone={decision.tone} />
      </div>
      <strong>{decision.headline}</strong>
      <p>{decision.detail}</p>

      <dl className="detail-use-decision__facts">
        <div>
          <dt>Datasheet</dt>
          <dd>{datasheetAssetLabel(datasheetAsset)}</dd>
        </div>
        <div>
          <dt>CAD/export</dt>
          <dd>{assetTruthSummary.label}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{latestSource ? `${latestSource.providerId} / ${latestSource.providerPartKey}` : "No source row"}</dd>
        </div>
      </dl>

      {nextAction ? (
        <a className={`button-link ${nextAction.available ? "" : "button-link--quiet"}`} href={nextAction.href}>
          {nextAction.label}
        </a>
      ) : null}
    </section>
  );
}

/** PartFilesRow describes one row of the Files and downloads panel. */
type PartFilesRow = {
  action: { href: string; label: string } | null;
  format: string | null | undefined;
  label: string;
  status: { label: string; tone: BadgeTone };
  trustCheck: AssetTrustCheckSummary;
  unavailableLabel: string;
};

/** AssetTrustCheckSummary is the operator-facing result of the latest durable asset check. */
type AssetTrustCheckSummary = {
  detail: string;
  label: string;
  tone: BadgeTone;
};

/**
 * Renders the Files and downloads panel near the top of the part detail page so
 * cross-discipline engineers can find datasheets, footprints, symbols, and 3D
 * models without scrolling past the trust workflow. Stored files and reference
 * URLs intentionally use different action labels so a reference never looks like
 * captured local bytes.
 */
function PartFilesPanel({
  assetGroups,
  partId,
  source,
  validationSummaries
}: {
  assetGroups: AssetClassSummary[];
  partId: string;
  source: CatalogDataSource | undefined;
  validationSummaries: AssetValidationSummary[];
}) {
  const assetRows: PartFilesRow[] = assetGroups.map((group) => {
    const best = group.bestAsset;
    if (!best) {
      return {
        action: null,
        format: undefined,
        label: assetTypeLabel(group.assetType),
        status: { label: "Not yet generated", tone: "neutral" },
        trustCheck: buildMissingAssetTrustCheckSummary(),
        unavailableLabel: "No file yet"
      };
    }

    const validationSummary = findAssetValidationSummary(validationSummaries, best);

    return {
      action: buildPartFileAction(best, partId, source),
      format: best.fileFormat,
      label: assetTypeLabel(group.assetType),
      status: { label: formatAssetClassReadinessLabel(group.readiness), tone: assetClassReadinessTone(group.readiness) },
      trustCheck: buildAssetTrustCheckSummary(best, validationSummary),
      unavailableLabel: formatPartFileUnavailableLabel(best, source)
    };
  });

  return (
    <SectionPanel
      description="Datasheet PDF, 3D model, footprint, and symbol. If we have a stored file you can download it; if we only have a link, you can open the source. Only verified files can be used for export."
      title="Files and downloads"
    >
      <ul className="part-files-list">
        {assetRows.map((row) => (
          <li className="part-files-list__row" key={row.label}>
            <div className="part-files-list__identity">
              <strong>{row.label}</strong>
              {row.format ? <span className="ui-mono part-files-list__format">{row.format}</span> : null}
            </div>
            <StatusBadge label={row.status.label} tone={row.status.tone} />
            <span className="part-files-list__trust-check" title={row.trustCheck.detail}>
              <StatusBadge label={row.trustCheck.label} tone={row.trustCheck.tone} />
            </span>
            {row.action ? (
              <a className="button-link button-link--quiet part-files-list__action" href={row.action.href} rel="noopener noreferrer" target="_blank">
                {row.action.label}
              </a>
            ) : (
              <span className="muted-copy part-files-list__action">{row.unavailableLabel}</span>
            )}
          </li>
        ))}
      </ul>
    </SectionPanel>
  );
}

/**
 * Builds the top-panel action for one asset without collapsing references into downloads.
 */
function buildPartFileAction(asset: Asset, partId: string, source: CatalogDataSource | undefined): PartFilesRow["action"] {
  if (source === "seed_fallback") {
    return asset.sourceUrl ? { href: asset.sourceUrl, label: "View source" } : null;
  }

  if (isFileBackedAsset(asset)) {
    return {
      href: buildAssetDownloadUrl(partId, asset.id),
      label: "Download file"
    };
  }

  if (asset.availabilityStatus === "referenced" && asset.sourceUrl) {
    return {
      href: asset.sourceUrl,
      label: "View source"
    };
  }

  return null;
}

/**
 * Explains why the top files panel is not offering an action for this asset row.
 */
function formatPartFileUnavailableLabel(asset: Asset, source: CatalogDataSource | undefined): string {
  if (source === "seed_fallback" && isFileBackedAsset(asset)) {
    return "Sample file not available";
  }

  if (asset.availabilityStatus === "failed") {
    return "File failed";
  }

  if (asset.availabilityStatus === "referenced") {
    return "No source URL";
  }

  if (asset.availabilityStatus === "downloaded" || asset.availabilityStatus === "validated") {
    return "File evidence incomplete";
  }

  return "No file yet";
}

/**
 * Renders the explanation-first readiness record summary using existing view-model signals.
 */
function DetailReadinessSummary({
  approval,
  assetTruthSummary,
  connectorOrRecoverySummary,
  quickReadinessSummary,
  readinessSummary,
  reviewWorkflowSummary
}: {
  approval: PartDetailPageRecord["approval"];
  assetTruthSummary: ReturnType<typeof getAssetTruthSummary>;
  connectorOrRecoverySummary: NonNullable<ReturnType<typeof getConnectorWorkflowSummary>> | ReturnType<typeof getRecoveryWorkflowSummary>;
  quickReadinessSummary: ReturnType<typeof getQuickReadinessSummary>;
  readinessSummary: PartDetailPageRecord["readinessSummary"];
  reviewWorkflowSummary: ReturnType<typeof getReviewWorkflowSummary>;
}) {
  return (
    <section aria-label="Readiness summary" className={`detail-readiness-summary detail-readiness-summary--${quickReadinessSummary.tone}`}>
      <div className="detail-readiness-summary__lead">
        <div>
          <p className="app-kicker">Readiness record</p>
          <h2>{readinessSummary.label}</h2>
          <p className="detail-readiness-summary__subhead">{approval.summary}</p>
          <p>{readinessSummary.detail}</p>
        </div>
        <div className="detail-readiness-summary__badges">
          <StatusBadge label={readinessSummary.label} tone={readinessStatusTone(readinessSummary.status)} />
          <StatusBadge label={approval.summary} tone={approvalStatusTone(approval.status)} />
          <StatusBadge label={assetTruthSummary.label} tone={mapViewToneToBadge(assetTruthSummary.tone)} />
          <StatusBadge label={connectorOrRecoverySummary.label} tone={mapViewToneToBadge(connectorOrRecoverySummary.tone)} />
          <StatusBadge label={reviewWorkflowSummary.label} tone={mapViewToneToBadge(reviewWorkflowSummary.tone)} />
        </div>
      </div>

      <div className="detail-readiness-summary__grid">
        <div>
          <span>Blockers and next actions</span>
          {readinessSummary.recommendedActions.length > 0 ? (
            <ul>
              {readinessSummary.recommendedActions.map((action, index) => (
                <li key={action}>
                  <strong>{index === 0 && readinessSummary.status === "blocked" ? "high" : index <= 1 ? "medium" : "low"}</strong>
                  {action}
                </li>
              ))}
            </ul>
          ) : (
            <p>No readiness actions are currently recorded for this part.</p>
          )}
        </div>
        <div>
          <span>Approval</span>
          <p>{approval.detail}</p>
          <p>Whole-part approval remains separate from generated asset review and explicit export promotion.</p>
        </div>
        <div>
          <span>File status</span>
          <p>{quickReadinessSummary.detail}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * Renders the acquisition/source summary without pretending import implies approval or export readiness.
 */
function DetailAcquisitionSummary({
  acquisitionSummary,
  boundaryCopy,
  summarySignal
}: {
  acquisitionSummary: PartDetailPageDetail["acquisitionSummary"];
  boundaryCopy: string | null;
  summarySignal: ReturnType<typeof getPartAcquisitionStateLabel>;
}) {
  return (
    <div className="detail-acquisition-summary">
      <div className="detail-acquisition-summary__lead">
        <div>
          <p className="app-kicker">Acquisition provenance</p>
          <h3>{summarySignal.label}</h3>
          <p>{summarySignal.detail}</p>
        </div>
        <div className="detail-acquisition-summary__badges">
          <StatusBadge label={summarySignal.label} tone={mapViewToneToBadge(summarySignal.tone)} />
          {acquisitionSummary.lastJobStatus ? <StatusBadge label={`Job ${acquisitionSummary.lastJobStatus}`} tone={acquisitionJobStatusTone(acquisitionSummary.lastJobStatus)} /> : null}
        </div>
      </div>

      {boundaryCopy ? (
        <p className="detail-acquisition-summary__boundary">
          <strong>{boundaryCopy}</strong> Use the completeness checklist below to confirm what still needs review before engineering use or export.
        </p>
      ) : null}

      <dl className="detail-acquisition-grid">
        <div>
          <dt>Provider</dt>
          <dd>{acquisitionSummary.providerId ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Provider part key</dt>
          <dd className="ui-mono">{acquisitionSummary.providerPartKey ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Requested lookup</dt>
          <dd className="ui-mono">{acquisitionSummary.requestedLookup ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Manufacturer</dt>
          <dd>{acquisitionSummary.manufacturerName ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>MPN</dt>
          <dd className="ui-mono">{acquisitionSummary.mpn ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Latest job status</dt>
          <dd>{acquisitionSummary.lastJobStatus ?? "No job recorded"}</dd>
        </div>
        <div>
          <dt>Requested at</dt>
          <dd>{acquisitionSummary.requestedAt ? formatDateTime(acquisitionSummary.requestedAt) : "Not recorded"}</dd>
        </div>
        <div>
          <dt>Completed at</dt>
          <dd>{acquisitionSummary.completedAt ? formatDateTime(acquisitionSummary.completedAt) : "Not recorded"}</dd>
        </div>
        <div className="detail-acquisition-grid__wide">
          <dt>Source URL</dt>
          <dd>
            {acquisitionSummary.sourceUrl ? (
              <a href={acquisitionSummary.sourceUrl}>{acquisitionSummary.sourceUrl}</a>
            ) : (
              "No source URL recorded"
            )}
          </dd>
        </div>
        {acquisitionSummary.reason ? (
          <div className="detail-acquisition-grid__wide">
            <dt>Acquisition note</dt>
            <dd>{acquisitionSummary.reason}</dd>
          </div>
        ) : null}
        {acquisitionSummary.requestedBy ? (
          <div>
            <dt>Requested by</dt>
            <dd>{acquisitionSummary.requestedBy}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * Renders the background enrichment summary without turning queued or succeeded work into approval or export truth.
 */
function DetailEnrichmentSummary({
  boundaryCopy,
  items,
  summary,
  summarySignal
}: {
  boundaryCopy: string | null;
  items: DetailEnrichmentStatusItem[];
  summary: PartDetailPageDetail["enrichmentSummary"];
  summarySignal: ReturnType<typeof getPartEnrichmentStateLabel>;
}) {
  return (
    <div className="detail-acquisition-summary">
      <div className="detail-acquisition-summary__lead">
        <div>
          <p className="app-kicker">Background enrichment</p>
          <h3>{summarySignal.label}</h3>
          <p>{summarySignal.detail}</p>
        </div>
        <div className="detail-acquisition-summary__badges">
          <StatusBadge label={summarySignal.label} tone={mapViewToneToBadge(summarySignal.tone)} />
          {summary.latestJobStatus ? <StatusBadge label={`Latest ${summary.latestJobStatus}`} tone={enrichmentJobStatusTone(summary.latestJobStatus)} /> : null}
          {summary.activeJobCount > 0 ? <StatusBadge label={`${summary.activeJobCount} active`} tone="info" /> : null}
        </div>
      </div>

      {boundaryCopy ? (
        <p className="detail-acquisition-summary__boundary">
          <strong>{boundaryCopy}</strong> The completeness checklist below still reflects only currently stored review, asset, and export truth.
        </p>
      ) : null}

      <dl className="detail-acquisition-grid">
        <div>
          <dt>Latest job status</dt>
          <dd>{summary.latestJobStatus ?? "No jobs recorded"}</dd>
        </div>
        <div>
          <dt>Active jobs</dt>
          <dd>{summary.activeJobCount}</dd>
        </div>
        <div className="detail-acquisition-grid__wide">
          <dt>Enrichment note</dt>
          <dd>{summary.reason ?? "Background enrichment can improve source evidence, but it does not imply parsing, verification, approval, or export readiness."}</dd>
        </div>
      </dl>

      {items.length > 0 ? (
        <div className="detail-completeness-list" aria-label="Enrichment jobs">
          {items.map((item) => (
            <article className={`detail-completeness-item detail-completeness-item--${item.state}`} key={item.id}>
              <div className="detail-completeness-item__lead">
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                  <p className="muted-copy">
                    Requested {formatDateTime(item.requestedAt)}
                    {item.completedAt ? ` · Completed ${formatDateTime(item.completedAt)}` : ""}
                  </p>
                </div>
                <StatusBadge label={item.stateLabel} tone={mapViewToneToBadge(item.tone)} />
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders the compact engineering-readiness checklist derived from existing detail truth only.
 */
function DetailCompletenessChecklist({ items }: { items: DetailCompletenessChecklistItem[] }) {
  return (
    <div className="detail-completeness-list" aria-label="Completeness checklist">
      {items.map((item) => (
        <article className={`detail-completeness-item detail-completeness-item--${item.state}`} key={item.id}>
          <div className="detail-completeness-item__lead">
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            <StatusBadge label={item.stateLabel} tone={mapViewToneToBadge(item.tone)} />
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Renders the early engineering context panel so identity, mates, and package truth stay near readiness.
 */
function DetailContextPanel({
  bestMate,
  datasheetAsset,
  hasConnectorIntelligence,
  latestSource,
  record,
  relatedPartSummaries
}: {
  bestMate: MateRelation | undefined;
  datasheetAsset: Asset | undefined;
  hasConnectorIntelligence: boolean;
  latestSource: PartDetailPageRecord["sources"][number] | undefined;
  record: PartDetailPageRecord;
  relatedPartSummaries: RelatedPartSummary[];
}) {
  if (hasConnectorIntelligence) {
    const primaryConnectorWarning = record.buildableMatingSet.warningDetails[0] ?? null;

    return (
      <section className="detail-context-panel" aria-label="Connector build set">
        <div className="detail-context-panel__header">
          <div>
            <p className="app-kicker">Connector build set</p>
            <h3>Implementation-friendly mate and accessory context</h3>
          </div>
          <StatusBadge
            label={
              primaryConnectorWarning
                ? primaryConnectorWarning.summary
                : bestMate
                  ? "Best mate mapped"
                  : "Mate mapping incomplete"
            }
            tone={primaryConnectorWarning ? primaryConnectorWarning.tone : bestMate ? "info" : "review"}
          />
        </div>
        <p className="muted-copy">
          Buildable set reflects stored relationship mapping. Verify pitch, family, and mechanical fit before layout.
          {record.buildableMatingSet.confidenceScore !== null ? ` ${buildConnectorConfidenceSummary(record.buildableMatingSet)}` : ""}
        </p>
        {record.buildableMatingSet.warningDetails.length > 0 ? (
          <ul className="connector-list" style={{ marginBottom: 12 }}>
            {record.buildableMatingSet.warningDetails.map((warning) => (
              <li key={warning.code}>
                <strong>{warning.summary}</strong> {warning.detail}
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="detail-context-list">
          <li>
            <strong>Best mate</strong>
            <span>{bestMate ? renderPart(bestMate.matePartId, relatedPartSummaries) : "No best mate stored"}</span>
          </li>
          <li>
            <strong>Alternate mates</strong>
            <span>{renderMateRelationList(record.buildableMatingSet.alternateMates, relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Family conflicts</strong>
            <span>{renderRelatedList(record.buildableMatingSet.familyConflicts.map((item) => item.candidatePartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Required accessories</strong>
            <span>{renderRelatedList(record.buildableMatingSet.requiredAccessories.map((item) => item.accessoryPartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Optional accessories</strong>
            <span>{renderRelatedList(record.buildableMatingSet.optionalAccessories.map((item) => item.accessoryPartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Tooling</strong>
            <span>{renderRelatedList(record.buildableMatingSet.toolingRequirements.map((item) => item.accessoryPartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Compatible cables</strong>
            <span>{renderRelatedList(record.buildableMatingSet.cableOptions.map((item) => item.cablePartId), relatedPartSummaries)}</span>
          </li>
          <li>
            <strong>Cable assumptions</strong>
            <span>{renderCableAssumptionList(record.buildableMatingSet.cableAssumptions, relatedPartSummaries)}</span>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="detail-context-panel" aria-label="Engineering context">
      <div className="detail-context-panel__header">
        <div>
          <p className="app-kicker">Engineering context</p>
          <h3>Identity and source evidence</h3>
        </div>
        <StatusBadge label={datasheetAssetLabel(datasheetAsset)} tone={datasheetAsset && isFileBackedAsset(datasheetAsset) ? "verified" : "review"} />
      </div>
      <p className="muted-copy">This panel keeps package, lifecycle, and source evidence visible before scrolling into deeper audit detail.</p>
      <ul className="detail-context-list">
        <li>
          <strong>Package</strong>
          <span>{record.package.packageName}</span>
        </li>
        <li>
          <strong>Lifecycle</strong>
          <span>{record.part.lifecycleStatus}</span>
        </li>
        <li>
          <strong>Latest source</strong>
          <span>{latestSource ? `${latestSource.providerId} / ${latestSource.providerPartKey}` : "No source row stored"}</span>
        </li>
        <li>
          <strong>Datasheet revision</strong>
          <span>{record.datasheetRevision?.revisionLabel ?? "No revision metadata"}</span>
        </li>
      </ul>
    </section>
  );
}

/**
 * Renders the right-rail style summary for blockers, risk flags, and review/export truth.
 */
function DetailActionRail({
  approval,
  bundleReadiness,
  issues,
  nextActions,
  riskFlags,
  reviewWorkflowSummary,
}: {
  approval: PartDetailPageRecord["approval"];
  bundleReadiness: { label: string; reason: string; state: BundleReadinessState };
  issues: PartDetailPageRecord["issues"];
  nextActions: PartNextAction[];
  riskFlags: PartDetailPageRecord["riskFlags"];
  reviewWorkflowSummary: ReturnType<typeof getReviewWorkflowSummary>;
}) {
  return (
    <aside className="detail-action-rail" aria-label="Readiness blockers and next actions">
      <div className="detail-action-rail__card">
        <span>Next action</span>
        {nextActions.length > 0 ? (
          <ul>
            {nextActions.slice(0, 4).map((action) => (
              <li key={action.id}>
                <strong>{action.priority}</strong>
                <p>{action.label}</p>
                <p>{action.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No next action is currently derived for this record.</p>
        )}
      </div>

      <div className="detail-action-rail__card">
        <span>Top blockers</span>
        {issues.length > 0 ? (
          <ul>
            {issues.map((issue) => (
              <li key={issue.id}>
                <strong>{issue.severity}</strong>
                <p>{issue.summary}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No part-level blockers are currently recorded.</p>
        )}
      </div>

      <div className="detail-action-rail__card">
        <span>Risk flags</span>
        {riskFlags.length > 0 ? (
          <ul>
            {riskFlags.map((flag) => (
              <li key={flag.id}>
                <strong className={`detail-risk-flag detail-risk-flag--${flag.tone}`}>{flag.label}</strong>
                <p>{flag.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No part-level risk flags are currently recorded.</p>
        )}
      </div>

      <div className="detail-action-rail__card">
        <span>Review and export state</span>
        <div className="detail-action-rail__badges">
          <StatusBadge label={approval.summary} tone={approvalStatusTone(approval.status)} />
          <StatusBadge label={reviewWorkflowSummary.label} tone={mapViewToneToBadge(reviewWorkflowSummary.tone)} />
          <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
        </div>
        <p>{approval.detail}</p>
        <p>{bundleReadiness.reason}</p>
        <div className="detail-action-rail__links">
          <a href="#files-heading">Inspect assets</a>
          <a href="#approval-heading">Review export blockers</a>
        </div>
      </div>
    </aside>
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
      body: "Open this part in the side-by-side compare workspace.",
      href: buildCompareUrl([record.part.id]),
      label: "Compare this part",
      signal: "Side-by-side"
    },
    {
      body: "Find confirmed project usage and BOM history for this exact internal part.",
      href: buildWhereUsedHref("part", record.part.id),
      label: "Check where-used",
      signal: whereUsedCount === null ? "Projects" : `${whereUsedCount} known`
    },
    {
      body: "Attach review notes, links, or file evidence to this part without changing approval.",
      href: buildEvidenceHref("part", record.part.id),
      label: "Attach evidence",
      signal: "Part target"
    },
    {
      body: connectorClass === "non_connector"
        ? "Browse connector sets if this part becomes part of a reusable connector set."
        : "Open connector sets filtered to this connector class and MPN.",
      href: buildConnectorSetHref(record),
      label: connectorClass === "non_connector" ? "Browse connector sets" : "Review connector set",
      signal: formatConnectorClassSignal(connectorClass)
    },
    {
      body: "Jump to the export gate and see which files are verified, missing, or blocked.",
      href: "#approval-heading",
      label: "Review export blockers",
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
 * Labels datasheet file state without treating references as stored files.
 */
function datasheetAssetLabel(asset: Asset | undefined): string {
  if (!asset) {
    return "No datasheet asset";
  }

  if (isFileBackedAsset(asset)) {
    return "Stored datasheet file";
  }

  return asset.sourceUrl ? "Referenced datasheet only" : "Datasheet metadata only";
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

/**
 * Builds a map of asset id to the most-restrictive non-archived controlled revision
 * for that asset, so the file action area can render a gating badge and a guarded
 * download path (`?ack=1`) without re-querying per row.
 *
 * Precedence (highest first): itar_controlled, restricted. Internal and public
 * revisions intentionally do not appear in the map — the gate only fires for
 * restricted-or-above access levels, matching the server-side check.
 */
function buildAssetGatingMap(state: PartDocumentControlState): Map<string, ControlledDocumentRevision> {
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
function accessLevelRank(level: DocumentAccessLevel): number {
  if (level === "itar_controlled") return 2;
  if (level === "restricted") return 1;
  return 0;
}

/**
 * Returns a UI badge label and tone matching the access level for the gating chip.
 */
function gatedAccessBadge(level: DocumentAccessLevel): { label: string; tone: BadgeTone } {
  if (level === "itar_controlled") return { label: "ITAR controlled", tone: "danger" };
  if (level === "restricted") return { label: "Restricted", tone: "review" };
  return { label: level, tone: "neutral" };
}

/**
 * Renders the best available asset for one engineering asset class.
 */
function EngineeringAssetSummary({ group, promotionAction, promotionSummaries, reviewAction, reviewStatuses, source, validationSummaries, gatedRevision }: { group: AssetClassSummary; promotionAction: (formData: FormData) => Promise<void>; promotionSummaries: AssetPromotionSummary[]; reviewAction: (formData: FormData) => Promise<void>; reviewStatuses: ReviewStatusSummary[]; source: CatalogDataSource | undefined; validationSummaries: AssetValidationSummary[]; gatedRevision: ControlledDocumentRevision | null }) {
  const bestAsset = group.bestAsset;

  if (!bestAsset) {
    return (
      <article className="ui-asset-card ui-asset-card--missing">
        <div className="ui-asset-card__header">
          <div className="ui-asset-card__identity">
            <span className="ui-asset-card__eyebrow">Asset class</span>
            <h3>{assetTypeLabel(group.assetType)}</h3>
          </div>
          <span className="ui-asset-card__format ui-mono">No file</span>
        </div>
        <div className="ui-asset-card__status-grid">
          <div className="ui-asset-card__status-item">
            <span className="ui-asset-card__status-label">Availability</span>
            <StatusBadge label="Missing" tone="neutral" />
          </div>
          <div className="ui-asset-card__status-item">
            <span className="ui-asset-card__status-label">Validation</span>
            <StatusBadge label="No validation" tone="neutral" />
          </div>
          <div className="ui-asset-card__status-item">
            <span className="ui-asset-card__status-label">Review</span>
            <StatusBadge label="No review" tone="neutral" />
          </div>
          <div className="ui-asset-card__status-item">
            <span className="ui-asset-card__status-label">Coverage</span>
            <StatusBadge label="No candidate rows" tone="neutral" />
          </div>
        </div>
        <dl className="ui-asset-card__meta">
          <div>
            <dt>Detail</dt>
            <dd>No asset rows are attached to this class yet, so it cannot contribute to review or export readiness.</dd>
          </div>
        </dl>
      </article>
    );
  }

  const reviewStatus = findReviewStatus(reviewStatuses, "asset", bestAsset.id);
  const validationSummary = findAssetValidationSummary(validationSummaries, bestAsset);
  const promotionSummary = findAssetPromotionSummary(promotionSummaries, bestAsset);
  const workflowSummary = buildAssetWorkflowSurfaceSummary(bestAsset, promotionSummary, reviewStatus);
  const trustCheckSummary = buildAssetTrustCheckSummary(bestAsset, validationSummary);
  const accessAction = buildAssetAccessAction(bestAsset, source, gatedRevision);

  return (
    <div className="asset-review-card">
      <AssetCard
        availabilityLabel={`${formatAssetAvailabilityStatus(bestAsset.availabilityStatus)} / ${provenanceLabel(bestAsset.provenance)}`}
        availabilityTone={assetClassReadinessTone(group.readiness)}
        fileFormat={bestAsset.fileFormat}
        previewLabel={previewLabel(bestAsset.previewStatus)}
        previewTone={previewTone(bestAsset.previewStatus)}
        reviewLabel={formatAssetTrustStageLabel(bestAsset, reviewStatus.state)}
        reviewTone={mapViewToneToBadge(assetTrustStageTone(bestAsset, reviewStatus.state))}
        sourceLabel={formatAssetSourceLabel(bestAsset, group.assets.length)}
        title={assetTypeLabel(group.assetType)}
        updatedLabel={`Updated ${formatDateTime(bestAsset.lastUpdatedAt)}`}
        validationLabel={`${validationLabel(bestAsset.validationStatus)} / ${formatAssetExportStatus(bestAsset.exportStatus)}`}
        validationTone={validationTone(bestAsset.validationStatus)}
      />
      <AssetInlinePreview asset={bestAsset} partId={bestAsset.partId} />
      <div className="asset-review-card__snapshot">
        <div>
          <span>Class state</span>
          <strong>{formatAssetClassReadinessLabel(group.readiness)}</strong>
          <p>{formatAssetClassReadinessDetail(group.readiness, group.assets.length)}</p>
        </div>
        <div>
          <span>Review lane</span>
          <strong>{workflowSummary.title}</strong>
          <p>{workflowSummary.detail}</p>
        </div>
        <div>
          <span>Trust check</span>
          <div className="asset-review-card__snapshot-heading">
            <strong>{trustCheckSummary.label}</strong>
            <StatusBadge label={trustCheckSummary.label} tone={trustCheckSummary.tone} />
          </div>
          <p>{trustCheckSummary.detail}</p>
        </div>
      </div>
      <details className="audit-disclosure audit-disclosure--asset">
        <summary>Detailed validation evidence and promotion history</summary>
        <div className="asset-review-card__evidence">
          <p>Validation evidence: {formatAssetValidationEvidence(validationSummary)}</p>
          <p>Promotion audit: {formatAssetPromotionHistory(promotionSummary)}</p>
          <p>Promotion blockers: {formatAssetPromotionBlockers(promotionSummary)}</p>
        </div>
      </details>
      <div className="asset-review-card__actions">
        {gatedRevision ? (
          <div className="asset-gating-notice">
            <StatusBadge label={gatedAccessBadge(gatedRevision.accessLevel).label} tone={gatedAccessBadge(gatedRevision.accessLevel).tone} />
            <p className="muted-copy">
              Active controlled revision <strong className="ui-mono">{gatedRevision.revisionLabel}</strong> ({gatedRevision.documentType}). Downloading requires explicit acknowledgment.
            </p>
          </div>
        ) : null}
        {accessAction ? (
          <a className={accessAction.gated ? "asset-download-link asset-download-link--gated" : "asset-download-link"} href={accessAction.href} rel="noopener noreferrer" target="_blank">
            {accessAction.label}
          </a>
        ) : null}
        <ReviewActionPanel reviewAction={reviewAction} reviewStatus={reviewStatus} targetId={bestAsset.id} targetType="asset" />
        <AssetPromotionPanel asset={bestAsset} promotionAction={promotionAction} promotionSummary={promotionSummary} />
      </div>
    </div>
  );
}

/**
 * Builds the detailed asset action without showing sample storage keys as real downloads.
 */
function buildAssetAccessAction(asset: Asset, source: CatalogDataSource | undefined, gatedRevision: ControlledDocumentRevision | null): { gated: boolean; href: string; label: string } | null {
  if (source === "seed_fallback") {
    return asset.sourceUrl ? { gated: false, href: asset.sourceUrl, label: "View source" } : null;
  }

  if (asset.availabilityStatus === "referenced" && asset.sourceUrl) {
    return { gated: false, href: asset.sourceUrl, label: "View source" };
  }

  if (!isFileBackedAsset(asset)) {
    return null;
  }

  if (gatedRevision) {
    return {
      gated: true,
      href: `${buildAssetDownloadUrl(asset.partId, asset.id)}?ack=1`,
      label: "Acknowledge and download"
    };
  }

  return {
    gated: false,
    href: buildAssetDownloadUrl(asset.partId, asset.id),
    label: "Download file"
  };
}

/**
 * Renders the export bundle gate as a compact workstation summary plus bundle actions.
 */
function ExportBundleSummary({ bundleReadiness }: { bundleReadiness: BundleReadinessSummary }) {
  const availableBundleCount = bundleReadiness.exportActions.filter((action) => action.available).length;
  const blockedBundleCount = bundleReadiness.exportActions.length - availableBundleCount;

  return (
    <>
      <section aria-label="Export bundle summary" className={`detail-export-summary detail-export-summary--${bundleReadiness.state}`}>
        <div className="detail-export-summary__lead">
          <div>
            <p className="app-kicker">Bundle gate</p>
            <h3 className="ui-mono">{bundleReadiness.label}</h3>
            <p>{bundleReadiness.reason}</p>
          </div>
          <div className="detail-export-summary__badges">
            <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
            <StatusBadge label={`${bundleReadiness.verifiedCadAssetCount} verified CAD`} tone={bundleReadiness.verifiedCadAssetCount > 0 ? "verified" : "neutral"} />
            <StatusBadge label={`${bundleReadiness.fileBackedCadAssetCount} stored CAD file${bundleReadiness.fileBackedCadAssetCount === 1 ? "" : "s"}`} tone={bundleReadiness.fileBackedCadAssetCount > 0 ? "info" : "neutral"} />
            <StatusBadge label={`${bundleReadiness.referencedAssetCount} URL-only references`} tone={bundleReadiness.referencedAssetCount > 0 ? "review" : "neutral"} />
          </div>
        </div>
        <div className="detail-export-summary__grid">
          <div>
            <span>Ready bundles</span>
            <strong>{availableBundleCount}</strong>
            <p>{availableBundleCount > 0 ? "These bundles have every required stored and verified file." : "No bundle has every required stored and verified file yet."}</p>
          </div>
          <div>
            <span>Blocked bundles</span>
            <strong>{blockedBundleCount}</strong>
            <p>{blockedBundleCount > 0 ? "These bundle targets still need missing review, validation, or promotion steps." : "Every supported bundle target is currently open."}</p>
          </div>
          <div>
            <span>Verified CAD</span>
            <strong>{bundleReadiness.verifiedCadAssetCount}</strong>
            <p>Verified CAD is the only asset class that can satisfy bundle export gates.</p>
          </div>
          <div>
            <span>Reference-only rows</span>
            <strong>{bundleReadiness.referencedAssetCount}</strong>
            <p>Referenced metadata stays visible for provenance, but it never unlocks export actions on its own.</p>
          </div>
        </div>
      </section>
      <div className="export-list">
        {bundleReadiness.exportActions.map((action) => (
          <button className={`export-action ${action.available ? "export-action--available" : "export-action--blocked"}`} disabled={!action.available} key={action.id} title={action.reason} type="button">
            <span className="export-action__eyebrow">{action.available ? "Export lane open" : "Export lane blocked"}</span>
            <strong>{action.label}</strong>
            <small>{action.reason}</small>
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Renders the separate verified-for-export promotion action when review has earned it.
 */
function AssetPromotionPanel({ asset, promotionAction, promotionSummary }: { asset: Asset; promotionAction: (formData: FormData) => Promise<void>; promotionSummary: AssetPromotionSummary }) {
  if (!shouldRenderAssetPromotionAction(promotionSummary)) {
    return null;
  }

  return (
    <form action={promotionAction} className="review-action-panel">
      <input name="assetId" type="hidden" value={asset.id} />
      <span>Export promotion</span>
      <button type="submit">Promote to verified for export</button>
    </form>
  );
}

/**
 * Finds validation evidence for one asset and falls back to explicit missing evidence.
 */
function findAssetValidationSummary(summaries: AssetValidationSummary[], asset: Asset): AssetValidationSummary {
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
function findAssetPromotionSummary(summaries: AssetPromotionSummary[], asset: Asset): AssetPromotionSummary {
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
function buildMissingAssetTrustCheckSummary(): AssetTrustCheckSummary {
  return {
    detail: "No file exists for this class yet, so there is nothing for an engineer or validator to check.",
    label: "No file to check",
    tone: "neutral"
  };
}

/**
 * Converts validation evidence into a plain asset trust check result for engineers.
 */
function buildAssetTrustCheckSummary(asset: Asset, summary: AssetValidationSummary): AssetTrustCheckSummary {
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
function isAutomatedTrustCheckAsset(asset: Asset): boolean {
  return asset.assetType === "footprint" || asset.assetType === "symbol" || asset.assetType === "three_d_model";
}

/**
 * Formats validation evidence types without leaking validator implementation names.
 */
function formatAssetValidationType(type: NonNullable<AssetValidationSummary["latestValidation"]>["validationType"]): string {
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
function formatAssetClassReadinessLabel(readiness: AssetClassReadiness): string {
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
function formatAssetClassReadinessDetail(readiness: AssetClassReadiness, assetCount: number): string {
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
function buildAssetWorkflowSurfaceSummary(asset: Asset, promotionSummary: AssetPromotionSummary, reviewStatus: ReviewStatusSummary): { detail: string; title: string } {
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
 * Renders local review actions for one reviewable asset or workflow.
 */
function ReviewActionPanel({ reviewAction, reviewStatus, targetId, targetType }: { reviewAction: (formData: FormData) => Promise<void>; reviewStatus: ReviewStatusSummary; targetId: string; targetType: ReviewTargetType }) {
  if (!shouldRenderReviewActions(reviewStatus)) {
    return null;
  }

  return (
    <form action={reviewAction} className="review-action-panel">
      <input name="targetId" type="hidden" value={targetId} />
      <input name="targetType" type="hidden" value={targetType} />
      <span>Local review (dev)</span>
      <button name="outcome" type="submit" value="approved">
        Approve
      </button>
      <button name="outcome" type="submit" value="changes_requested">
        Request changes
      </button>
      <button name="outcome" type="submit" value="rejected">
        Reject
      </button>
    </form>
  );
}

/**
 * Finds a precomputed review status and falls back to a neutral state if the target is not reviewable.
 */
function findReviewStatus(reviewStatuses: ReviewStatusSummary[], targetType: ReviewTargetType, targetId: string): ReviewStatusSummary {
  return (
    reviewStatuses.find((status) => status.targetType === targetType && status.targetId === targetId) ?? {
      latestReview: null,
      state: "not_required",
      targetId,
      targetType
    }
  );
}

/**
 * Renders a related part line with confidence and optional notes.
 */
function RelatedPartLine({ relation, related }: { relation: MateRelation; related: RelatedPartSummary | null }) {
  return (
    <p>
      <span className="ui-mono">{related?.mpn ?? relation.matePartId}</span>
      <span> - confidence {Math.round(relation.confidenceScore * 100)}%</span>
      {relation.notes ? <span> ({relation.notes})</span> : null}
    </p>
  );
}

/**
 * Formats an ISO timestamp for dense workspace metadata.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

/**
 * Formats a date-only string without shifting it across time zones.
 */
function formatDateOnly(value: string): string {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Formats a project revision label without duplicating labels that already include "Rev".
 */
function formatRevisionLabel(value: string): string {
  return /^rev\b/iu.test(value.trim()) ? value : `Rev ${value}`;
}

/**
 * Formats controlled document type values for dense workstation copy.
 */
function formatDocumentType(type: DocumentControlType): string {
  return {
    controlled_drawing: "Controlled drawing",
    datasheet: "Datasheet",
    mechanical_drawing: "Mechanical drawing",
    other: "Other document",
    specification: "Specification"
  }[type];
}

/**
 * Formats controlled document lifecycle values.
 */
function formatDocumentLifecycle(status: DocumentRevisionLifecycleStatus): string {
  return {
    archived: "Archived",
    draft: "Draft",
    expired: "Expired",
    in_review: "In review",
    released: "Released",
    superseded: "Superseded"
  }[status];
}

/**
 * Maps controlled document lifecycle values into badge tones.
 */
function documentLifecycleTone(status: DocumentRevisionLifecycleStatus): BadgeTone {
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
 * Formats controlled document access levels.
 */
function formatDocumentAccess(accessLevel: DocumentAccessLevel): string {
  return {
    internal: "Internal",
    itar_controlled: "ITAR controlled",
    public: "Public",
    restricted: "Restricted"
  }[accessLevel];
}

/**
 * Maps document access levels into badge tones without claiming enforcement.
 */
function documentAccessTone(accessLevel: DocumentAccessLevel): BadgeTone {
  const tones: Record<DocumentAccessLevel, BadgeTone> = {
    internal: "info",
    itar_controlled: "danger",
    public: "neutral",
    restricted: "review"
  };

  return tones[accessLevel];
}

/**
 * Formats one ACL principal for revision history.
 */
function formatAclPrincipal(principalType: DocumentAclPrincipalType, principalId: string): string {
  return `${principalType}:${principalId}`;
}

/**
 * Formats document redline workflow states.
 */
function formatRedlineStatus(status: DocumentRedlineStatus): string {
  return {
    open: "Open",
    rejected: "Rejected",
    resolved: "Resolved",
    superseded: "Superseded"
  }[status];
}

/**
 * Maps redline state and severity into badge tones.
 */
function redlineStatusTone(status: DocumentRedlineStatus, severity: DocumentRedlineSeverity): BadgeTone {
  if (status !== "open") {
    return status === "resolved" ? "verified" : "neutral";
  }

  return severity === "blocker" ? "danger" : severity === "review" ? "review" : "info";
}

/**
 * Formats project usage status into stable workstation copy.
 */
function formatUsageStatus(status: ProjectPartUsageStatus): string {
  const labels: Record<ProjectPartUsageStatus, string> = {
    deprecated: "Deprecated",
    in_review: "In review",
    proposed: "Proposed",
    released: "Released",
    used: "Used"
  };

  return labels[status];
}

/**
 * Maps project usage status into review-oriented badge tones.
 */
function usageStatusTone(status: ProjectPartUsageStatus): BadgeTone {
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
 * Formats commercial inventory status labels without implying a live provider check.
 */
function formatInventoryStatus(status: InventoryStatus): string {
  const labels: Record<InventoryStatus, string> = {
    backorder: "Backorder",
    in_stock: "In stock",
    out_of_stock: "Out of stock",
    unknown: "Unknown"
  };

  return labels[status];
}

/**
 * Maps commercial inventory status into sourcing badge tones.
 */
function inventoryStatusTone(status: InventoryStatus): BadgeTone {
  const tones: Record<InventoryStatus, BadgeTone> = {
    backorder: "review",
    in_stock: "verified",
    out_of_stock: "danger",
    unknown: "neutral"
  };

  return tones[status];
}

/**
 * Formats supplier identity while falling back to provider provenance when the seller is not captured.
 */
function formatSupplySourceLabel(source: { providerId: string; supplierName: string | null }): string {
  return source.supplierName ?? source.providerId;
}

/**
 * Formats MOQ and lead-time terms while preserving missing values as unknown.
 */
function formatSupplyTerms(offer: SupplyOffering): string {
  const moq = offer.moq === null ? "MOQ unknown" : `MOQ ${formatInteger(offer.moq)}`;
  const leadTime = offer.leadTimeDays === null ? "lead time unknown" : `${offer.leadTimeDays} day${offer.leadTimeDays === 1 ? "" : "s"} lead`;

  return `${moq} / ${leadTime}`;
}

/**
 * Selects the lowest price break for one offer and keeps the MOQ tie-break deterministic.
 */
function getBestPriceBreak(priceBreaks: PriceBreak[]): PriceBreak | null {
  const sorted = [...priceBreaks].sort((left, right) => left.unitPrice - right.unitPrice || left.minQuantity - right.minQuantity);

  return sorted[0] ?? null;
}

/**
 * Formats a price tier with currency and quantity context.
 */
function formatPriceBreak(priceBreak: PriceBreak): string {
  return `${formatSupplyPrice(priceBreak.unitPrice, priceBreak.currencyCode)} at ${formatInteger(priceBreak.minQuantity)}+`;
}

/**
 * Formats a provider price with a safe fallback for unexpected currency codes.
 */
function formatSupplyPrice(unitPrice: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      currency: currencyCode,
      maximumFractionDigits: unitPrice < 1 ? 6 : 2,
      minimumFractionDigits: unitPrice < 1 ? 4 : 2,
      style: "currency"
    }).format(unitPrice);
  } catch {
    return `${unitPrice.toFixed(unitPrice < 1 ? 4 : 2)} ${currencyCode}`;
  }
}

/**
 * Formats integer-like quantities with thousands separators.
 */
function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

/**
 * Checks whether a commercial snapshot is older than the API's freshness window.
 */
function isSupplyOfferStale(lastSeenAt: string, staleAfterDays: number): boolean {
  const parsed = Date.parse(lastSeenAt);

  if (!Number.isFinite(parsed)) {
    return true;
  }

  return Date.now() - parsed > staleAfterDays * 24 * 60 * 60 * 1000;
}

/**
 * Formats BOM designators without hiding the difference between none and unknown.
 */
function formatDesignators(designators: string[]): string {
  return designators.length > 0 ? designators.join(", ") : "None recorded";
}

/**
 * Formats nullable BOM quantity without pretending unknown is zero.
 */
function formatQuantity(quantity: number | null): string {
  return quantity === null ? "Unknown" : quantity.toString();
}

/**
 * Builds the concise answer to "can I use this part?" from stored readiness truth.
 */
function buildUseDecision(record: PartDetailPageRecord): { detail: string; headline: string; label: string; tone: BadgeTone } {
  if (record.readinessSummary.status === "ready_for_export_review") {
    return {
      detail: "Core evidence is strong enough to review for use. Still inspect export assets before committing CAD to a design.",
      headline: "Usable after export review",
      label: "Review-ready",
      tone: "verified"
    };
  }

  if (record.readinessSummary.status === "blocked") {
    return {
      detail: record.readinessSummary.detail,
      headline: "Do not use yet",
      label: "Blocked",
      tone: "danger"
    };
  }

  if (record.readinessSummary.status === "needs_attention") {
    return {
      detail: record.readinessSummary.detail,
      headline: "Use only after follow-up",
      label: "Needs attention",
      tone: "review"
    };
  }

  return {
    detail: "Readiness evidence is incomplete, so this record needs inspection before design use.",
    headline: "Evidence incomplete",
    label: "Unknown",
    tone: "neutral"
  };
}

/**
 * Maps confidence scores into UI badge tones.
 */
function scoreTone(score: number): BadgeTone {
  if (score >= 0.8) return "verified";
  if (score >= 0.65) return "review";
  return "danger";
}

/**
 * Maps asset type values into user-facing labels.
 */
function assetTypeLabel(assetOrType: Asset | Asset["assetType"]): string {
  const assetType = typeof assetOrType === "string" ? assetOrType : assetOrType.assetType;

  return {
    datasheet: "Datasheet",
    footprint: "Footprint",
    mechanical_drawing: "Mechanical drawing",
    symbol: "Symbol",
    three_d_model: "3D model"
  }[assetType];
}

/**
 * Maps validation status values into direct user-facing labels.
 */
function validationLabel(status: ValidationStatus): string {
  return {
    failed: "Validation failed",
    needs_review: "Needs review",
    not_validated: "Not validated",
    verified: "Verified"
  }[status];
}

/**
 * Maps provenance values without treating provenance as validation.
 */
function provenanceLabel(provenance: AssetProvenance): string {
  return {
    generated: "Generated",
    manual_internal: "Manual internal",
    official: "Official",
    trusted_external: "Trusted vendor"
  }[provenance];
}

/**
 * Maps validation status into badge tone.
 */
function validationTone(status: ValidationStatus): BadgeTone {
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
function assetClassReadinessTone(readiness: AssetClassReadiness): BadgeTone {
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
function bundleReadinessTone(state: BundleReadinessState): BadgeTone {
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
function readinessStatusTone(status: PartDetailPageRecord["readinessSummary"]["status"]): BadgeTone {
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
function approvalStatusTone(status: PartDetailPageRecord["approval"]["status"]): BadgeTone {
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
function acquisitionJobStatusTone(status: NonNullable<PartAcquisitionSummary["lastJobStatus"]>): BadgeTone {
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
function enrichmentJobStatusTone(
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
function generationWorkflowTone(state: GenerationWorkflowState): BadgeTone {
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

function mapViewToneToBadge(tone: ViewTone): BadgeTone {
  return tone as BadgeTone;
}

/**
 * Reads a generation target from form data without trusting arbitrary input.
 */
function readGenerationTargetAssetType(value: FormDataEntryValue | null): GenerationTargetAssetType | null {
  if (value === "footprint" || value === "symbol" || value === "three_d_model") {
    return value;
  }

  return null;
}

/**
 * Reads a review target type from form data without trusting arbitrary input.
 */
function readReviewTargetType(value: FormDataEntryValue | null): ReviewTargetType | null {
  if (value === "asset" || value === "generation_workflow") {
    return value;
  }

  return null;
}

/**
 * Reads a review outcome from form data without trusting arbitrary input.
 */
function readReviewOutcome(value: FormDataEntryValue | null): ReviewOutcome | null {
  if (value === "approved" || value === "changes_requested" || value === "rejected") {
    return value;
  }

  return null;
}

/**
 * Reads a required string from form data without accepting empty strings.
 */
function readRequiredFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Reads optional form text while converting blanks to null.
 */
function readOptionalFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Reads a controlled document type from form data without trusting arbitrary input.
 */
function readDocumentControlType(value: FormDataEntryValue | null): DocumentControlType | null {
  if (value === "datasheet" || value === "mechanical_drawing" || value === "controlled_drawing" || value === "specification" || value === "other") {
    return value;
  }

  return null;
}

/**
 * Reads a controlled document lifecycle status from form data.
 */
function readDocumentLifecycleStatus(value: FormDataEntryValue | null): DocumentRevisionLifecycleStatus | null {
  if (value === "draft" || value === "in_review" || value === "released" || value === "superseded" || value === "expired" || value === "archived") {
    return value;
  }

  return null;
}

/**
 * Reads a controlled document access level from form data.
 */
function readDocumentAccessLevel(value: FormDataEntryValue | null): DocumentAccessLevel | null {
  if (value === "public" || value === "internal" || value === "restricted" || value === "itar_controlled") {
    return value;
  }

  return null;
}

/**
 * Reads an ACL principal type from form data.
 */
function readDocumentAclPrincipalType(value: FormDataEntryValue | null): DocumentAclPrincipalType | null {
  if (value === "user" || value === "team" || value === "role") {
    return value;
  }

  return null;
}

/**
 * Reads an ACL permission from form data.
 */
function readDocumentAclPermission(value: FormDataEntryValue | null): DocumentAclPermission | null {
  if (value === "view" || value === "review" || value === "approve" || value === "admin") {
    return value;
  }

  return null;
}

/**
 * Reads a redline severity from form data.
 */
function readDocumentRedlineSeverity(value: FormDataEntryValue | null): DocumentRedlineSeverity | null {
  if (value === "info" || value === "review" || value === "blocker") {
    return value;
  }

  return null;
}

/**
 * Reads a redline workflow status from form data.
 */
function readDocumentRedlineStatus(value: FormDataEntryValue | null): DocumentRedlineStatus | null {
  if (value === "open" || value === "resolved" || value === "rejected" || value === "superseded") {
    return value;
  }

  return null;
}

/**
 * Reads a positive integer from form data without accepting zero or text.
 */
function readPositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Builds a single optional ACL grant from the document-control creation form.
 */
function buildDocumentAclEntryFromForm(formData: FormData) {
  const principalId = readRequiredFormString(formData.get("principalId"));
  const principalType = readDocumentAclPrincipalType(formData.get("principalType"));
  const permission = readDocumentAclPermission(formData.get("permission"));

  if (!principalId || !principalType || !permission) {
    return null;
  }

  return {
    permission,
    principalId,
    principalType
  };
}

/**
 * Checks whether an asset can be put under document control in the current UI.
 */
function isControlledDocumentAsset(asset: Asset): boolean {
  return asset.assetType === "datasheet" || asset.assetType === "mechanical_drawing";
}

/**
 * Maps preview status into short user-facing copy.
 */
function previewLabel(status: PreviewStatus): string {
  return { not_available: "No preview", pending: "Preview pending", ready: "Preview ready" }[status];
}

/**
 * Maps preview status into badge tone.
 */
function previewTone(status: PreviewStatus): BadgeTone {
  const tones: Record<PreviewStatus, BadgeTone> = {
    not_available: "neutral",
    pending: "review",
    ready: "verified"
  };

  return tones[status];
}

/**
 * Finds lightweight display data for a related part identifier.
 */
function findRelatedPart(partId: string, relatedPartSummaries: RelatedPartSummary[]): RelatedPartSummary | null {
  return relatedPartSummaries.find((item) => item.id === partId) ?? null;
}

/**
 * Renders one related part reference.
 */
function renderPart(partId: string, relatedPartSummaries: RelatedPartSummary[]): string {
  const related = findRelatedPart(partId, relatedPartSummaries);
  return related ? `${related.mpn} (${related.manufacturerName})` : partId;
}

/**
 * Renders a comma-separated related part list with an explicit empty state.
 */
function renderRelatedList(partIds: string[], relatedPartSummaries: RelatedPartSummary[]): string {
  if (partIds.length === 0) return "None";
  return partIds.map((partId) => renderPart(partId, relatedPartSummaries)).join(", ");
}

/**
 * Renders mate relations with confidence so near-match alternatives remain reviewable.
 */
function renderMateRelationList(relations: PartDetailPageRecord["buildableMatingSet"]["alternateMates"], relatedPartSummaries: RelatedPartSummary[]): string {
  if (relations.length === 0) {
    return "None";
  }

  return relations
    .map((relation) => `${renderPart(relation.matePartId, relatedPartSummaries)} (${Math.round(relation.confidenceScore * 100)}%)`)
    .join(", ");
}

/**
 * Renders parsed cable assumptions without implying the assumptions were independently validated.
 */
function renderCableAssumptionList(
  assumptions: PartDetailPageRecord["buildableMatingSet"]["cableAssumptions"],
  relatedPartSummaries: RelatedPartSummary[]
): string {
  if (assumptions.length === 0) {
    return "None recorded";
  }

  return assumptions
    .map((assumption) => `${renderPart(assumption.cablePartId, relatedPartSummaries)}: ${assumption.summary}`)
    .join(" | ");
}

/**
 * Formats the connector confidence breakdown so engineers can inspect the score inputs quickly.
 */
function buildConnectorConfidenceSummary(buildableMatingSet: PartDetailPageRecord["buildableMatingSet"]): string {
  const detailParts: string[] = [];
  const evidenceParts: string[] = [];

  if (buildableMatingSet.confidenceBreakdown.overallScore !== null) {
    detailParts.push(`Overall ${Math.round(buildableMatingSet.confidenceBreakdown.overallScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.bestMateScore !== null) {
    detailParts.push(`best mate ${Math.round(buildableMatingSet.confidenceBreakdown.bestMateScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.requiredAccessoryScore !== null) {
    detailParts.push(`required accessories ${Math.round(buildableMatingSet.confidenceBreakdown.requiredAccessoryScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.optionalAccessoryScore !== null) {
    detailParts.push(`optional accessories ${Math.round(buildableMatingSet.confidenceBreakdown.optionalAccessoryScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.toolingScore !== null) {
    detailParts.push(`tooling ${Math.round(buildableMatingSet.confidenceBreakdown.toolingScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.cableScore !== null) {
    detailParts.push(`cables ${Math.round(buildableMatingSet.confidenceBreakdown.cableScore * 100)}%`);
  }

  if (buildableMatingSet.confidenceBreakdown.directEvidenceCount > 0) {
    evidenceParts.push(`${buildableMatingSet.confidenceBreakdown.directEvidenceCount} direct`);
  }

  if (buildableMatingSet.confidenceBreakdown.inferredEvidenceCount > 0) {
    evidenceParts.push(`${buildableMatingSet.confidenceBreakdown.inferredEvidenceCount} inferred`);
  }

  if (buildableMatingSet.confidenceBreakdown.verifiedEvidenceCount > 0) {
    evidenceParts.push(`${buildableMatingSet.confidenceBreakdown.verifiedEvidenceCount} verified`);
  }

  if (buildableMatingSet.confidenceBreakdown.uncertainEvidenceCount > 0) {
    evidenceParts.push(`${buildableMatingSet.confidenceBreakdown.uncertainEvidenceCount} uncertain`);
  }

  if (detailParts.length === 0) {
    return "No connector confidence evidence is stored.";
  }

  return `${detailParts.join("; ")} from ${buildableMatingSet.confidenceBreakdown.evidenceCount} mapped relationship signals${evidenceParts.length > 0 ? ` (${evidenceParts.join(", ")})` : ""}.`;
}

/**
 * Renders the four-stage trust lineage strip so engineers can scan
 * imported / reviewed / approved / verified-for-export at a glance.
 */
function TrustLineageStrip({ summary }: { summary: TrustLineageSummary }): React.ReactElement {
  const guidance = summarizeTrustGuidance(summary);

  return (
    <section className="trust-lineage-strip" role="group" aria-label="Trust lineage">
      <div className="trust-lineage-strip__guidance">
        <strong>{guidance.title}</strong>
        <p>{guidance.detail}</p>
      </div>
      <details className="trust-lineage-strip__steps">
        <summary>Show verification steps</summary>
        <ol className="trust-lineage-strip__stages">
          {summary.stages.map((stage, index) => (
            <TrustLineageStageItem
              key={stage.stage}
              isLast={index === summary.stages.length - 1}
              stage={stage}
            />
          ))}
        </ol>
        <p className="trust-lineage-strip__boundary muted-copy">{summary.boundary}</p>
      </details>
    </section>
  );
}

function summarizeTrustGuidance(summary: TrustLineageSummary): { detail: string; title: string } {
  const stageByKey = new Map(summary.stages.map((stage) => [stage.stage, stage]));
  const verifiedStage = stageByKey.get("verified_for_export");
  const approvedStage = stageByKey.get("approved");
  const reviewedStage = stageByKey.get("reviewed");
  const importedStage = stageByKey.get("imported");
  const blockedStage = summary.stages.find((stage) => stage.state === "blocked");

  if (blockedStage) {
    return {
      detail: `Resolve "${blockedStage.label}" first. Then continue in order from left to right.`,
      title: "Blocked right now"
    };
  }

  if (verifiedStage?.state === "passed") {
    return {
      detail: "This part has a verified export path.",
      title: "Ready for export"
    };
  }

  if (approvedStage?.state === "passed") {
    return {
      detail: "Part approval is complete. File verification is the remaining step.",
      title: "Almost ready"
    };
  }

  if (reviewedStage?.state === "passed") {
    return {
      detail: "Review is complete. Approval is the next step.",
      title: "Needs part approval"
    };
  }

  if (importedStage?.state === "passed") {
    return {
      detail: "Import is complete. Review is the next step.",
      title: "Needs review"
    };
  }

  return {
    detail: "No trust steps are complete yet.",
    title: "Not started"
  };
}

/**
 * Renders one trust-lineage stage with state badge, label, and one-line reason.
 */
function TrustLineageStageItem({ stage, isLast }: { stage: TrustLineageStageSummary; isLast: boolean }): React.ReactElement {
  return (
    <li className="trust-lineage-strip__item" data-state={stage.state}>
      <div className="trust-lineage-strip__item-header">
        <StatusBadge label={stage.label} tone={mapViewToneToBadge(stage.tone)} />
        <span className={`trust-lineage-strip__state trust-lineage-strip__state--${stage.state}`}>
          {stage.badgeLabel}
        </span>
      </div>
      <p className="trust-lineage-strip__detail">{stage.detail}</p>
      {!isLast ? <span aria-hidden="true" className="trust-lineage-strip__connector">→</span> : null}
    </li>
  );
}
