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
import { buildAssetDownloadUrl, createAssetPromotion, createGenerationRequest, createReviewAction, fetchPartDetail } from "../../../lib/api-client";
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
import type { BadgeTone, MetricTableRow } from "@ee-library/ui";
import type { DetailCompletenessChecklistItem, DetailEnrichmentStatusItem, PartNextAction, ViewTone } from "../../../lib/detail-view-model";
import type { Asset, AssetClassReadiness, AssetClassSummary, AssetPromotionSummary, AssetProvenance, AssetValidationSummary, BundleReadinessState, BundleReadinessSummary, GenerationSourceReadiness, GenerationTargetAssetType, GenerationWorkflowState, MateRelation, Package, PartAcquisitionSummary, PreviewStatus, RelatedPartSummary, ReviewOutcome, ReviewStatusSummary, ReviewTargetType, ValidationStatus } from "@ee-library/shared/types";

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

/**
 * Renders a component detail page with provenance, connector intelligence, asset state, and export readiness.
 */
export default async function PartDetailPage({ params }: DetailPageProps) {
  const { partId } = await params;
  const detail = await fetchPartDetail(partId);

  if (!detail) {
    notFound();
  }

  const { assetGroups, assetPromotionSummaries, assetReviewStatuses, assetValidationSummaries, bundleReadiness, generationOptions, record, relatedPartSummaries, workflowReviewStatuses } = detail;
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
  const nextActions = getPartNextActions(record);
  const primaryNextAction = nextActions[0];
  const latestSource = record.sources[0];
  const metricRows = record.metrics.map<MetricTableRow>((metric) => ({
    label: formatMetricLabel(metric.metricKey),
    meta: `${Math.round(metric.confidenceScore * 100)}% confidence`,
    tone: scoreTone(metric.confidenceScore),
    value: formatMetricValue(metric)
  }));
  const detailTabs = buildDetailTabs(hasConnectorIntelligence, record, assetGroups, exportActions);

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

  const hasSimilarParts = record.similarParts.length > 0;
  const hasCompanionParts = record.companionRecommendations.length > 0;

  return (
    <main className="detail-layout">
      <Link className="back-link" href="/catalog">
        &larr; Back to catalog search
      </Link>

      <section className="detail-section" aria-labelledby="overview-heading">
        <SectionHeading
          id="overview-heading"
          index="01"
          subtitle="Identity, normalized metrics, package, datasheet metadata, and catalog signals."
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
            <p className="detail-trust-callout">
              <strong>Approved drafts are not verified for export.</strong> Generated CAD stays labeled as generated until review, validation evidence, and an explicit promotion step complete. Export buttons stay tied to file-backed, verified assets only.
            </p>
            <div className="signal-strip" role="group" aria-label="Engineering signals">
              <div className="signal-strip__primary">
                <StatusBadge label={record.readinessSummary.label} tone={readinessStatusTone(record.readinessSummary.status)} />
                <StatusBadge label={record.approval.summary} tone={approvalStatusTone(record.approval.status)} />
                <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
                <StatusBadge label={assetTruthSummary.label} tone={mapViewToneToBadge(assetTruthSummary.tone)} />
                <StatusBadge label={connectorSummary?.label ?? recoverySummary.label} tone={mapViewToneToBadge(connectorSummary?.tone ?? recoverySummary.tone)} />
              </div>
              <div className="signal-strip__secondary">
                <StatusBadge label={record.connectorFamily ? `${record.connectorFamily.name}` : "Non-connector"} tone={record.connectorFamily ? "info" : "neutral"} />
                <StatusBadge label={`Updated ${formatDateTime(record.lastUpdatedAt)}`} tone="neutral" />
              </div>
            </div>
          </div>
          <div className="detail-hero__status">
            <TrustMeter label="Catalog trust score" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
            <DetailUseDecision
              assetTruthSummary={assetTruthSummary}
              datasheetAsset={datasheetAsset}
              latestSource={latestSource}
              nextAction={primaryNextAction}
              record={record}
            />
            <DetailHeroWorkbench approval={record.approval} bundleReadiness={bundleReadiness} connectorOrRecoverySummary={connectorSummary ?? recoverySummary} reviewWorkflowSummary={reviewWorkflowSummary} />
          </div>
        </section>

        <DetailHeroFacts
          assetCount={record.assets.length}
          bestMateMapped={Boolean(bestMate)}
          bundleReadiness={bundleReadiness}
          generationWorkflowCount={record.generationWorkflows.length}
          hasConnectorIntelligence={hasConnectorIntelligence}
          sourceCount={record.sources.length}
        />

        <DetailSectionNav tabs={detailTabs} />

        <DetailReadinessSummary
          approval={record.approval}
          assetTruthSummary={assetTruthSummary}
          connectorOrRecoverySummary={connectorSummary ?? recoverySummary}
          quickReadinessSummary={quickReadinessSummary}
          readinessSummary={record.readinessSummary}
          reviewWorkflowSummary={reviewWorkflowSummary}
        />

        <SectionPanel description="Compact engineering-readiness checkpoints derived from the existing detail truth." title="Completeness checklist">
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
          <SectionPanel description="Normalized to internal units. Confidence reflects source extraction, not manufacturing guarantee." title="Key metrics">
            {metricRows.length > 0 ? <MetricTable rows={metricRows} /> : <EmptyState body="No normalized metrics are attached to this part yet." title="No metrics" />}
          </SectionPanel>
          <SectionPanel description="Mechanical outline fields; unknowns stay explicit." title="Package">
            <dl className="dimension-grid">
              {packageDimensionRows(record.package).map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd className="ui-mono">{row.value}</dd>
                </div>
              ))}
            </dl>
          </SectionPanel>
        </div>

        <SectionPanel description="Revision metadata is separate from whether a PDF is stored in object storage." title="Datasheet">
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

        <details className="audit-disclosure detail-audit-disclosure">
          <summary>Acquisition and enrichment audit</summary>
          <div className="detail-audit-disclosure__grid">
            <SectionPanel description="Where this part came from and whether the current detail page has job-backed acquisition provenance." title="Acquisition summary">
              <DetailAcquisitionSummary acquisitionSummary={detail.acquisitionSummary} boundaryCopy={importedBoundaryCopy} summarySignal={acquisitionSummarySignal} />
            </SectionPanel>
            <SectionPanel description="Background enrichment progress stays separate from approval, parsing, and export truth." title="Enrichment status">
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

      <section className="detail-section" aria-labelledby="mates-heading">
        <SectionHeading
          id="mates-heading"
          index="02"
          subtitle="Connector build sets, mates, accessories, tooling, and cable relationships stay close to readiness."
          title="Mates and accessories"
        />
        {hasConnectorIntelligence ? (
          <>
            <div className="detail-two-col">
              <SectionPanel description="Single prioritized recommendation plus any close alternate mates that still need review." title="Best mate">
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
              <SectionPanel description="Practical set: mate, required hardware, tooling, cable options, and note-derived assumptions." title="Buildable mating set">
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
          <EmptyState body="No connector-specific mate, accessory, tooling, or cable relationships are stored for this record." title="No mating data" />
        )}
      </section>

      <section className="detail-section" aria-labelledby="alternates-heading">
        <SectionHeading
          id="alternates-heading"
          index="03"
          subtitle="Alternates and companion parts stay separate so substitutions do not blur into typical co-parts."
          title="Alternates and companions"
        />
        {hasSimilarParts || hasCompanionParts ? (
          <div className="detail-two-col">
            <SectionPanel description="Alternates for substitution decisions - not automatic drop-ins." title="Similar parts">
              {hasSimilarParts ? <p className="related-inline">{renderRelatedList(record.similarParts.map((relation) => relation.similarPartId), relatedPartSummaries)}</p> : <p className="muted-copy">No similar-part alternates are stored yet.</p>}
            </SectionPanel>
            <SectionPanel description="Parts often used alongside this one in real designs." title="Typical companions">
              {hasCompanionParts ? <p className="related-inline">{renderRelatedList(record.companionRecommendations.map((relation) => relation.companionPartId), relatedPartSummaries)}</p> : <p className="muted-copy">No typical companion recommendations are stored yet.</p>}
            </SectionPanel>
          </div>
        ) : (
          <EmptyState body="No similar-part alternates or typical companion recommendations are stored for this record." title="No alternates or companions" />
        )}
      </section>

      <section className="detail-section" aria-labelledby="sourcing-heading">
        <SectionHeading
          id="sourcing-heading"
          index="04"
          subtitle="Lifecycle, source freshness, and import provenance are available here. Distributor pricing remains unavailable until the backend models it."
          title="Sourcing and lifecycle"
        />
        <div className="detail-two-col">
          <SectionPanel description="Use lifecycle and latest import evidence to decide whether the part is still a healthy design candidate." title="Lifecycle and source health">
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
          <SectionPanel description="The V3 design includes distributor pricing and stock, but the current backend contract does not expose supplier rows yet." title="Distributor pricing">
            <div className="detail-unavailable-card" role="status">
              <StatusBadge label="Unavailable" tone="neutral" />
              <strong>Supplier pricing and stock are not in the current API contract.</strong>
              <p>The UI stays explicit here instead of inventing sourcing data. Lifecycle, source import status, and provenance remain the current source of truth.</p>
            </div>
          </SectionPanel>
        </div>
      </section>

      <section className="detail-section detail-section--technical" aria-labelledby="files-heading">
        <SectionHeading
          id="files-heading"
          index="05"
          subtitle="Best-ranked asset per class. Availability, provenance, review, validation, and export status stay separate."
          title="Files and models"
        />
        {assetGroups.length > 0 ? (
          <div className="asset-grid">
            {assetGroups.map((group) => (
              <EngineeringAssetSummary group={group} key={group.assetType} promotionAction={submitAssetPromotionAction} promotionSummaries={assetPromotionSummaries} reviewAction={submitReviewAction} reviewStatuses={assetReviewStatuses} validationSummaries={assetValidationSummaries} />
            ))}
          </div>
        ) : (
          <EmptyState body="No engineering asset rows are attached to this part yet." title="No assets" />
        )}

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
          index="06"
          subtitle="Review workflows, generation requests, and explicit export promotion stay separate from part identity and asset provenance."
          title="Approval and export"
        />

        {shouldRenderGenerationOptions(generationOptions) ? (
          <SectionPanel description="Each control creates a tracked generation request when structured source-readiness checks pass. Generated outputs remain drafts until reviewed; approval is not export verification." title="Request draft generation">
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

        <SectionPanel description="Only file-backed assets that passed review, validation evidence, and explicit promotion can authorize export bundles." title="Export bundles" tone="technical">
          <ExportBundleSummary bundleReadiness={bundleReadiness} />
        </SectionPanel>

      </section>
    </main>
  );
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
          <dt>Provenance</dt>
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
          <span>Asset truth</span>
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
 * Renders dense overview facts under the hero so engineers can scan record scope before scrolling.
 */
function DetailHeroFacts({
  assetCount,
  bestMateMapped,
  bundleReadiness,
  generationWorkflowCount,
  hasConnectorIntelligence,
  sourceCount
}: {
  assetCount: number;
  bestMateMapped: boolean;
  bundleReadiness: { label: string };
  generationWorkflowCount: number;
  hasConnectorIntelligence: boolean;
  sourceCount: number;
}) {
  return (
    <section aria-label="Record scope facts" className="detail-hero-facts">
      <div>
        <span>Source rows</span>
        <strong>{sourceCount}</strong>
        <p>Provider identities currently attached to this record.</p>
      </div>
      <div>
        <span>Asset rows</span>
        <strong>{assetCount}</strong>
        <p>Engineering assets across datasheet, symbol, footprint, drawing, and 3D.</p>
      </div>
      <div>
        <span>Bundle gate</span>
        <strong>{bundleReadiness.label}</strong>
        <p>Export still follows verified file-backed truth, not review alone.</p>
      </div>
      <div>
        <span>Generation workflows</span>
        <strong>{generationWorkflowCount}</strong>
        <p>Tracked requests and generated drafts remain separate from stored assets.</p>
      </div>
      <div>
        <span>{hasConnectorIntelligence ? "Best mate" : "Connector intelligence"}</span>
        <strong>{hasConnectorIntelligence ? (bestMateMapped ? "Mapped" : "Missing") : "Not applicable"}</strong>
        <p>{hasConnectorIntelligence ? "Stored mate mapping stays visible before layout decisions." : "This part does not expose connector-specific relationship data."}</p>
      </div>
    </section>
  );
}

/**
 * Renders a compact decision rail beside the part hero so engineers can scan the current state quickly.
 */
function DetailHeroWorkbench({
  approval,
  bundleReadiness,
  connectorOrRecoverySummary,
  reviewWorkflowSummary
}: {
  approval: PartDetailPageRecord["approval"];
  bundleReadiness: { label: string; reason: string; state: BundleReadinessState };
  connectorOrRecoverySummary: NonNullable<ReturnType<typeof getConnectorWorkflowSummary>> | ReturnType<typeof getRecoveryWorkflowSummary>;
  reviewWorkflowSummary: ReturnType<typeof getReviewWorkflowSummary>;
}) {
  return (
    <section aria-label="Top-level decision rail" className="detail-workbench-rail">
      <div className="detail-workbench-rail__card">
        <span>Bundle gate</span>
        <strong>{bundleReadiness.label}</strong>
        <p>{bundleReadiness.reason}</p>
      </div>
      <div className="detail-workbench-rail__card">
        <span>Connector or recovery</span>
        <strong>{connectorOrRecoverySummary.label}</strong>
        <p>{connectorOrRecoverySummary.detail}</p>
      </div>
      <div className="detail-workbench-rail__card">
        <span>Approval and review</span>
        <strong>{approval.summary}</strong>
        <p>{approval.detail}</p>
        <div className="detail-workbench-rail__badges">
          <StatusBadge label={reviewWorkflowSummary.label} tone={mapViewToneToBadge(reviewWorkflowSummary.tone)} />
          <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
        </div>
      </div>
    </section>
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
function buildDetailTabs(hasConnectorIntelligence: boolean, record: PartDetailPageRecord, assetGroups: AssetClassSummary[], exportActions: { available: boolean }[]) {
  const connectorCount = hasConnectorIntelligence
    ? record.buildableMatingSet.requiredAccessories.length + record.buildableMatingSet.optionalAccessories.length + record.buildableMatingSet.toolingRequirements.length + record.buildableMatingSet.cableOptions.length + (record.buildableMatingSet.bestMate ? 1 : 0)
    : 0;
  const alternateCount = record.similarParts.length + record.companionRecommendations.length;
  const cadAttentionCount = assetGroups.filter((group) => group.readiness !== "export_ready" && group.readiness !== "validated_file").length;
  const blockedExportCount = exportActions.filter((action) => !action.available).length;

  return [
    { badge: undefined, href: "#overview-heading", label: "Overview" },
    { badge: connectorCount > 0 ? `${connectorCount}` : undefined, href: "#mates-heading", label: "Mates & accessories" },
    { badge: alternateCount > 0 ? `${alternateCount}` : undefined, href: "#alternates-heading", label: "Alternates" },
    { badge: undefined, href: "#sourcing-heading", label: "Sourcing" },
    { badge: cadAttentionCount > 0 ? `${cadAttentionCount}` : assetGroups.length > 0 ? `${assetGroups.length}` : undefined, href: "#files-heading", label: "CAD assets" },
    { badge: blockedExportCount > 0 ? `${blockedExportCount}` : undefined, href: "#approval-heading", label: "Approval & export" }
  ];
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
 * Renders the best available asset for one engineering asset class.
 */
function EngineeringAssetSummary({ group, promotionAction, promotionSummaries, reviewAction, reviewStatuses, validationSummaries }: { group: AssetClassSummary; promotionAction: (formData: FormData) => Promise<void>; promotionSummaries: AssetPromotionSummary[]; reviewAction: (formData: FormData) => Promise<void>; reviewStatuses: ReviewStatusSummary[]; validationSummaries: AssetValidationSummary[] }) {
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
      </div>
      <details className="audit-disclosure audit-disclosure--asset">
        <summary>Validation evidence and promotion history</summary>
        <div className="asset-review-card__evidence">
          <p>Validation evidence: {formatAssetValidationEvidence(validationSummary)}</p>
          <p>Promotion audit: {formatAssetPromotionHistory(promotionSummary)}</p>
          <p>Promotion blockers: {formatAssetPromotionBlockers(promotionSummary)}</p>
        </div>
      </details>
      <div className="asset-review-card__actions">
        {bestAsset.availabilityStatus !== "missing" && bestAsset.availabilityStatus !== "failed" ? (
          <a className="asset-download-link" href={buildAssetDownloadUrl(bestAsset.partId, bestAsset.id)} rel="noopener noreferrer" target="_blank">
            {bestAsset.availabilityStatus === "referenced" ? "View source" : "Download"}
          </a>
        ) : null}
        <ReviewActionPanel reviewAction={reviewAction} reviewStatus={reviewStatus} targetId={bestAsset.id} targetType="asset" />
        <AssetPromotionPanel asset={bestAsset} promotionAction={promotionAction} promotionSummary={promotionSummary} />
      </div>
    </div>
  );
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
            <StatusBadge label={`${bundleReadiness.fileBackedCadAssetCount} file-backed CAD`} tone={bundleReadiness.fileBackedCadAssetCount > 0 ? "info" : "neutral"} />
            <StatusBadge label={`${bundleReadiness.referencedAssetCount} URL-only references`} tone={bundleReadiness.referencedAssetCount > 0 ? "review" : "neutral"} />
          </div>
        </div>
        <div className="detail-export-summary__grid">
          <div>
            <span>Ready bundles</span>
            <strong>{availableBundleCount}</strong>
            <p>{availableBundleCount > 0 ? "These bundles have every required verified file-backed asset." : "No bundle has all required verified file-backed assets yet."}</p>
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
    downloaded_file: "A file-backed asset exists, but it still needs stronger validation or export promotion before bundles can rely on it.",
    export_ready: "The best-ranked asset already carries the strongest review, validation, and export evidence available in this class.",
    failed: "The best-ranked row is currently a failed asset record and does not support export work.",
    missing: "No asset rows are stored for this class yet.",
    reference_only: "Only URL-level provenance exists for this class, so engineers can inspect provenance without treating it as a usable file.",
    validated_file: "A validated file is present, but explicit verified-for-export promotion still remains separate."
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
 * Builds display rows for normalized package dimensions.
 */
function packageDimensionRows(partPackage: Package) {
  return [
    { label: "Pins", value: partPackage.pinCount?.toString() ?? "Unknown" },
    { label: "Pitch", value: formatMillimeters(partPackage.pitchMm) },
    { label: "Body length", value: formatMillimeters(partPackage.bodyLengthMm) },
    { label: "Body width", value: formatMillimeters(partPackage.bodyWidthMm) },
    { label: "Body height", value: formatMillimeters(partPackage.bodyHeightMm) }
  ];
}

/**
 * Formats a nullable millimeter value without pretending unknowns are zero.
 */
function formatMillimeters(value: number | null): string {
  return value === null ? "Unknown" : `${value} mm`;
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
