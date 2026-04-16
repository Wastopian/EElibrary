/**
 * File header: Implements the provider-neutral component detail workspace.
 */

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { AssetCard, EmptyState, MetricTable, SectionHeading, SectionPanel, StatusBadge, TrustMeter } from "@ee-library/ui";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import { formatAssetAvailabilityStatus, formatAssetExportStatus, formatMetricLabel, formatMetricValue } from "@ee-library/shared/catalog-runtime";
import { createAssetPromotion, createGenerationRequest, createReviewAction, fetchPartDetail } from "../../../lib/api-client";
import { assetTrustStageTone, formatAssetPromotionBlockers, formatAssetPromotionHistory, formatAssetSourceLabel, formatAssetTrustStageLabel, formatAssetValidationEvidence, formatDatasheetParseConfidence, formatGenerationWorkflowLabel, formatReviewStateLabel, getAssetTruthSummary, getConnectorWorkflowSummary, getRecoveryWorkflowSummary, reviewStateTone, shouldRenderAssetPromotionAction, shouldRenderConnectorSections, shouldRenderGenerationOptions, shouldRenderReviewActions } from "../../../lib/detail-view-model";
import type { BadgeTone, MetricTableRow } from "@ee-library/ui";
import type { ViewTone } from "../../../lib/detail-view-model";
import type { Asset, AssetClassReadiness, AssetClassSummary, AssetPromotionSummary, AssetProvenance, AssetValidationSummary, BundleReadinessState, GenerationSourceReadiness, GenerationTargetAssetType, GenerationWorkflowState, MateRelation, Package, PreviewStatus, RelatedPartSummary, ReviewOutcome, ReviewStatusSummary, ReviewTargetType, ValidationStatus } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** DetailPageProps contains the dynamic route parameter supplied by Next.js. */
interface DetailPageProps {
  params: Promise<{ partId: string }>;
}

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
  const reviewWorkflowSummary = buildReviewWorkflowSummary(assetReviewStatuses, workflowReviewStatuses, assetPromotionSummaries);
  const latestSource = record.sources[0];
  const metricRows = record.metrics.map<MetricTableRow>((metric) => ({
    label: formatMetricLabel(metric.metricKey),
    meta: `${Math.round(metric.confidenceScore * 100)}% confidence`,
    tone: scoreTone(metric.confidenceScore),
    value: formatMetricValue(metric)
  }));

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

  const hasGoesWith = hasConnectorIntelligence || record.similarParts.length > 0 || record.companionRecommendations.length > 0;

  return (
    <main className="detail-layout">
      <Link className="back-link" href="/">
        ← Back to catalog search
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
            <p className="detail-hero__meta">
              {record.part.category} · <span className="ui-mono">{record.package.packageName}</span> · lifecycle {record.part.lifecycleStatus}
            </p>
            <p className="detail-trust-callout">
              <strong>Approved drafts are not verified for export.</strong> Generated CAD stays labeled as generated until review, validation evidence, and an explicit promotion step complete. Export buttons stay tied to file-backed, verified assets only.
            </p>
            <div className="signal-strip" role="group" aria-label="Engineering signals">
              <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
              <StatusBadge label={assetTruthSummary.label} tone={mapViewToneToBadge(assetTruthSummary.tone)} />
              <StatusBadge label={connectorSummary?.label ?? recoverySummary.label} tone={mapViewToneToBadge(connectorSummary?.tone ?? recoverySummary.tone)} />
              <StatusBadge label={reviewWorkflowSummary.label} tone={reviewWorkflowSummary.tone} />
              <StatusBadge label={record.connectorFamily ? `${record.connectorFamily.name}` : "Non-connector"} tone={record.connectorFamily ? "info" : "neutral"} />
              <StatusBadge label={`Updated ${formatDateTime(record.lastUpdatedAt)}`} tone="neutral" />
            </div>
          </div>
          <div className="detail-hero__status">
            <TrustMeter label="Catalog trust score" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
            <p className="muted-copy" style={{ fontSize: "0.82rem", margin: "10px 0 0" }}>
              {bundleReadiness.reason}
            </p>
          </div>
        </section>

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

      <section className="detail-section" aria-labelledby="goes-with-heading">
        <SectionHeading
          id="goes-with-heading"
          index="02"
          subtitle="Mates, accessories, cables, alternates, and typical circuit companions—each with its own confidence context."
          title="What goes with it"
        />
        {hasGoesWith ? (
          <>
            {hasConnectorIntelligence ? (
              <div className="detail-two-col">
                <SectionPanel description="Single prioritized recommendation with confidence." title="Best mate">
                  {bestMate ? <RelatedPartLine relation={bestMate} related={findRelatedPart(bestMate.matePartId, relatedPartSummaries)} /> : <p className="muted-copy">No best-mate mapping is stored for this part.</p>}
                </SectionPanel>
                <SectionPanel description="Practical set: mate, required hardware, tooling, and cable options." title="Buildable mating set">
                  <ul className="connector-list">
                    <li>
                      <strong>Best mate:</strong> {bestMate ? renderPart(bestMate.matePartId, relatedPartSummaries) : "Not available"}
                    </li>
                    <li>
                      <strong>Required accessories:</strong> {renderRelatedList(record.buildableMatingSet.requiredAccessories.map((item) => item.accessoryPartId), relatedPartSummaries)}
                    </li>
                    <li>
                      <strong>Tooling:</strong> {renderRelatedList(record.buildableMatingSet.toolingRequirements.map((item) => item.accessoryPartId), relatedPartSummaries)}
                    </li>
                    <li>
                      <strong>Compatible cables:</strong> {renderRelatedList(record.buildableMatingSet.cableOptions.map((item) => item.cablePartId), relatedPartSummaries)}
                    </li>
                  </ul>
                </SectionPanel>
              </div>
            ) : null}
            <div className="detail-two-col">
              {record.similarParts.length > 0 ? (
                <SectionPanel description="Alternates for substitution decisions—not automatic drop-ins." title="Similar parts">
                  <p className="related-inline">{renderRelatedList(record.similarParts.map((relation) => relation.similarPartId), relatedPartSummaries)}</p>
                </SectionPanel>
              ) : (
                <SectionPanel description="No alternate list is stored for this part." title="Similar parts">
                  <p className="muted-copy">None listed.</p>
                </SectionPanel>
              )}
              {record.companionRecommendations.length > 0 ? (
                <SectionPanel description="Parts often used alongside this one in real designs." title="Typical companions">
                  <p className="related-inline">{renderRelatedList(record.companionRecommendations.map((relation) => relation.companionPartId), relatedPartSummaries)}</p>
                </SectionPanel>
              ) : (
                <SectionPanel description="No companion recommendations are stored." title="Typical companions">
                  <p className="muted-copy">None listed.</p>
                </SectionPanel>
              )}
            </div>
          </>
        ) : (
          <EmptyState body="No connector intelligence, similar parts, or companion recommendations are stored for this record." title="No relationship data" />
        )}
      </section>

      <section className="detail-section technical-panel" aria-labelledby="files-heading">
        <SectionHeading
          id="files-heading"
          index="03"
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

      <section className="detail-section" aria-labelledby="next-heading">
        <SectionHeading
          id="next-heading"
          index="04"
          subtitle="Exports, recovery requests, review actions, and explicit export promotion—each with exact blockers when disabled."
          title="Next actions"
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

        <div className="technical-panel">
          <SectionPanel description="Only file-backed assets that passed review, validation evidence, and explicit promotion can authorize export bundles." title="Export bundles">
            <div className="datasheet-panel">
              <div>
                <p className="ui-mono">{bundleReadiness.label}</p>
                <p className="muted-copy">{bundleReadiness.reason}</p>
              </div>
              <div className="datasheet-panel__badges">
                <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
                <StatusBadge label={`${bundleReadiness.verifiedCadAssetCount} verified CAD`} tone={bundleReadiness.verifiedCadAssetCount > 0 ? "verified" : "neutral"} />
                <StatusBadge label={`${bundleReadiness.referencedAssetCount} URL-only references`} tone={bundleReadiness.referencedAssetCount > 0 ? "review" : "neutral"} />
              </div>
            </div>
            <div className="export-list">
              {exportActions.map((action) => (
                <button className="export-action" disabled={!action.available} key={action.id} title={action.reason} type="button">
                  <span>{action.label}</span>
                  <small>{action.reason}</small>
                </button>
              ))}
            </div>
          </SectionPanel>
        </div>

      </section>
    </main>
  );
}

/**
 * Summarizes review and promotion state without treating approval as export verification.
 */
function buildReviewWorkflowSummary(assetReviewStatuses: ReviewStatusSummary[], workflowReviewStatuses: ReviewStatusSummary[], promotionSummaries: AssetPromotionSummary[]): { detail: string; label: string; tone: BadgeTone } {
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
      <article className="ui-asset-card">
        <div>
          <h3>{assetTypeLabel(group.assetType)}</h3>
          <p className="ui-mono">No asset record</p>
        </div>
        <div className="ui-asset-card__badges">
          <StatusBadge label="Missing" tone="neutral" />
          <StatusBadge label="No validation" tone="neutral" />
          <StatusBadge label="No source" tone="neutral" />
        </div>
      </article>
    );
  }

  const reviewStatus = findReviewStatus(reviewStatuses, "asset", bestAsset.id);
  const validationSummary = findAssetValidationSummary(validationSummaries, bestAsset);
  const promotionSummary = findAssetPromotionSummary(promotionSummaries, bestAsset);

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
      <details className="audit-disclosure">
        <summary>Validation evidence and promotion history</summary>
        <div className="asset-review-card__evidence">
          <p>Validation evidence: {formatAssetValidationEvidence(validationSummary)}</p>
          <p>Promotion audit: {formatAssetPromotionHistory(promotionSummary)}</p>
          <p>Promotion blockers: {formatAssetPromotionBlockers(promotionSummary)}</p>
        </div>
      </details>
      <ReviewActionPanel reviewAction={reviewAction} reviewStatus={reviewStatus} targetId={bestAsset.id} targetType="asset" />
      <AssetPromotionPanel asset={bestAsset} promotionAction={promotionAction} promotionSummary={promotionSummary} />
    </div>
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
