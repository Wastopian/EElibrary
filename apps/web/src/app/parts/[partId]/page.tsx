/**
 * File header: Implements the provider-neutral component detail workspace.
 */

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { AssetCard, EmptyState, MetricTable, SectionPanel, StatusBadge, TrustMeter } from "@ee-library/ui";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import { formatAssetStatus, formatMetricLabel, formatMetricValue } from "@ee-library/shared/catalog-runtime";
import { createGenerationRequest, createReviewAction, fetchPartDetail } from "../../../lib/api-client";
import { formatDatasheetParseConfidence, formatGenerationWorkflowLabel, formatReviewStateLabel, reviewStateTone, shouldRenderConnectorSections, shouldRenderGenerationOptions, shouldRenderReviewActions } from "../../../lib/detail-view-model";
import type { BadgeTone, MetricTableRow } from "@ee-library/ui";
import type { Asset, AssetClassReadiness, AssetClassSummary, AssetProvenance, BundleReadinessState, GenerationTargetAssetType, GenerationWorkflowState, MateRelation, Package, PreviewStatus, RelatedPartSummary, ReviewOutcome, ReviewStatusSummary, ReviewTargetType, ValidationStatus } from "@ee-library/shared/types";

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

  const { assetGroups, assetReviewStatuses, bundleReadiness, generationOptions, record, relatedPartSummaries, workflowReviewStatuses } = detail;
  const bestMate = record.buildableMatingSet.bestMate;
  const datasheetAsset = record.datasheetRevision?.fileAssetId ? record.assets.find((asset) => asset.id === record.datasheetRevision?.fileAssetId) : undefined;
  const exportActions = bundleReadiness.exportActions;
  const hasConnectorIntelligence = shouldRenderConnectorSections(record);
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

  return (
    <main className="detail-layout">
      <Link className="back-link" href="/">
        Back to search
      </Link>

      <section className="detail-hero">
        <div>
          <p className="app-kicker">{record.manufacturer.name}</p>
          <h2 className="ui-mono">{record.part.mpn}</h2>
          <p>
            {record.part.category} / {record.package.packageName} / {record.part.lifecycleStatus}
          </p>
        </div>
        <div className="detail-hero__status">
          <StatusBadge label={record.connectorFamily ? `${record.connectorFamily.name} family` : "General component"} tone={record.connectorFamily ? "info" : "neutral"} />
          <StatusBadge label={`${record.sources.length} source records`} tone={record.sources.length > 0 ? "info" : "neutral"} />
          <StatusBadge label={`Updated ${formatDateTime(record.lastUpdatedAt)}`} tone="neutral" />
          <TrustMeter label="Trust score" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
        </div>
      </section>

      <div className="detail-grid">
        <SectionPanel description="Values are normalized to the unit policy and retain source confidence." title="Normalized specs">
          {metricRows.length > 0 ? <MetricTable rows={metricRows} /> : <EmptyState body="No normalized metrics have been attached to this part yet." title="No metrics" />}
        </SectionPanel>

        <SectionPanel description="Raw source records are preserved for audit and later conflict review." title="Provenance">
          <div className="source-list">
            {record.sources.length > 0 ? (
              record.sources.map((source) => (
                <article key={source.id}>
                  <div>
                    <h3>{source.providerId}</h3>
                    <p className="ui-mono">{source.providerPartKey}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>Fetched</dt>
                      <dd>{formatDateTime(source.fetchedAt)}</dd>
                    </div>
                    <div>
                      <dt>Normalized</dt>
                      <dd>{source.normalizedAt ? formatDateTime(source.normalizedAt) : "Not normalized"}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{source.sourceUrl ? <a href={source.sourceUrl}>{source.sourceUrl}</a> : "No source URL"}</dd>
                    </div>
                  </dl>
                </article>
              ))
            ) : (
              <EmptyState body="No source records are attached to this fallback record." title="No provenance" />
            )}
          </div>
        </SectionPanel>

        <SectionPanel description="Dimensions are normalized in millimeters and unknown fields stay explicit." title="Package dimensions">
          <dl className="dimension-grid">
            {packageDimensionRows(record.package).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd className="ui-mono">{row.value}</dd>
              </div>
            ))}
          </dl>
        </SectionPanel>

        {hasConnectorIntelligence ? (
          <>
            <SectionPanel description="One recommendation is prioritized with confidence and notes so connector decisions stay fast." title="Best Mate">
              {bestMate ? <RelatedPartLine relation={bestMate} related={findRelatedPart(bestMate.matePartId, relatedPartSummaries)} /> : <p>No best-mate recommendation is currently available.</p>}
            </SectionPanel>

            <SectionPanel description="Minimum practical mating set: mate, required accessories, tooling, and compatible cable options." title="Buildable Mating Set">
              <ul className="info-list">
                <li>
                  <strong>Best mate:</strong> {bestMate ? renderPart(bestMate.matePartId, relatedPartSummaries) : "Not available"}
                </li>
                <li>
                  <strong>Required accessories:</strong> {renderRelatedList(record.buildableMatingSet.requiredAccessories.map((item) => item.accessoryPartId), relatedPartSummaries)}
                </li>
                <li>
                  <strong>Tooling requirements:</strong> {renderRelatedList(record.buildableMatingSet.toolingRequirements.map((item) => item.accessoryPartId), relatedPartSummaries)}
                </li>
                <li>
                  <strong>Compatible cable options:</strong> {renderRelatedList(record.buildableMatingSet.cableOptions.map((item) => item.cablePartId), relatedPartSummaries)}
                </li>
              </ul>
            </SectionPanel>
          </>
        ) : null}

        <SectionPanel description="Datasheet metadata remains separate from file availability." title="Datasheet">
          <div className="datasheet-panel">
            <div>
              <p className="ui-mono">{record.datasheetRevision?.revisionLabel ?? "No revision"}</p>
              <p>{record.datasheetRevision?.revisionDate ?? "Revision date unknown"}</p>
              <p>{record.datasheetRevision?.pageCount ? `${record.datasheetRevision.pageCount} pages` : "Page count unknown"}</p>
            </div>
            <div className="datasheet-panel__badges">
              <StatusBadge label={formatDatasheetParseConfidence(record.datasheetRevision?.parseConfidence)} tone={record.datasheetRevision ? scoreTone(record.datasheetRevision.parseConfidence) : "neutral"} />
              <StatusBadge label={datasheetAsset && isFileBackedAsset(datasheetAsset) ? "Stored file" : "Metadata only"} tone={datasheetAsset && isFileBackedAsset(datasheetAsset) ? "verified" : "review"} />
              <StatusBadge label={latestSource ? `Source ${latestSource.providerId}` : "No source"} tone={latestSource ? "info" : "neutral"} />
            </div>
          </div>
        </SectionPanel>

        <SectionPanel description="Best available asset per class, ranked by readiness, provenance, validation/export status, and recency." title="Engineering Assets">
          {assetGroups.length > 0 ? (
            <div className="asset-grid">
              {assetGroups.map((group) => (
                <EngineeringAssetSummary group={group} key={group.assetType} reviewAction={submitReviewAction} reviewStatuses={assetReviewStatuses} />
              ))}
            </div>
          ) : (
            <EmptyState body="No asset records are attached to this part yet." title="No assets" />
          )}
        </SectionPanel>

        {shouldRenderGenerationOptions(generationOptions) ? (
          <SectionPanel description="Requests are available only when normalized source-readiness checks pass; generated assets still require review before export." title="Missing Assets / Fallback Actions">
            <ul className="info-list">
              {generationOptions.map((option) => (
                <li key={option.targetAssetType}>
                  <div className="datasheet-panel">
                    <div>
                      <strong>{option.label}</strong>
                      <p>{option.reason}</p>
                      <p>Source check: {option.sourceReadiness.reasons.join(" ")}</p>
                    </div>
                    <div className="datasheet-panel__badges">
                      <StatusBadge label={option.workflowStatusLabel} tone={generationWorkflowTone(option.workflowStatus)} />
                      <StatusBadge label={option.sourceReadiness.ready ? "source ready" : "source incomplete"} tone={option.sourceReadiness.ready ? "verified" : "review"} />
                      <form action={requestGenerationAction}>
                        <input name="targetAssetType" type="hidden" value={option.targetAssetType} />
                        <button className="export-action" disabled={!option.canRequest} type="submit">
                          <span>{option.canRequest ? option.actionLabel : option.workflowStatusLabel}</span>
                          <small>{option.sourceReadiness.ready ? "Creates a tracked request" : "Source material is incomplete"}</small>
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </SectionPanel>
        ) : null}

        {record.similarParts.length > 0 ? (
          <SectionPanel description="Similar parts are alternatives for the same design problem, not guaranteed drop-in replacements." title="Similar Parts">
            <p>{renderRelatedList(record.similarParts.map((relation) => relation.similarPartId), relatedPartSummaries)}</p>
          </SectionPanel>
        ) : null}

        {record.companionRecommendations.length > 0 ? (
          <SectionPanel description="Companion parts are typical pairings with their own confidence context." title="Typical Companion Parts">
            <p>{renderRelatedList(record.companionRecommendations.map((relation) => relation.companionPartId), relatedPartSummaries)}</p>
          </SectionPanel>
        ) : null}

        {record.generationWorkflows.length > 0 ? (
          <SectionPanel description="Generation workflow state is shown separately from official or verified asset availability." title="Generation Workflow">
            <ul className="info-list">
              {record.generationWorkflows.map((workflow) => {
                const reviewStatus = findReviewStatus(workflowReviewStatuses, "generation_workflow", workflow.id);

                return (
                  <li key={workflow.id}>
                    <div className="datasheet-panel">
                      <div>
                        <p>{formatGenerationWorkflowLabel(workflow, record.assets)}</p>
                        <p>Review state: {formatReviewStateLabel(reviewStatus.state)}.</p>
                      </div>
                      <div className="datasheet-panel__badges">
                        <StatusBadge label={formatReviewStateLabel(reviewStatus.state)} tone={reviewStateTone(reviewStatus.state)} />
                        <ReviewActionPanel reviewAction={submitReviewAction} reviewStatus={reviewStatus} targetId={workflow.id} targetType="generation_workflow" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionPanel>
        ) : null}

        <SectionPanel description="Only file-backed assets verified for export can enable bundle actions." title="Export readiness">
          <div className="datasheet-panel">
            <div>
              <p className="ui-mono">{bundleReadiness.label}</p>
              <p>{bundleReadiness.reason}</p>
            </div>
            <div className="datasheet-panel__badges">
              <StatusBadge label={bundleReadiness.label} tone={bundleReadinessTone(bundleReadiness.state)} />
              <StatusBadge label={`${bundleReadiness.verifiedCadAssetCount} verified CAD assets`} tone={bundleReadiness.verifiedCadAssetCount > 0 ? "verified" : "neutral"} />
              <StatusBadge label={`${bundleReadiness.referencedAssetCount} referenced assets`} tone={bundleReadiness.referencedAssetCount > 0 ? "review" : "neutral"} />
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
    </main>
  );
}

/**
 * Renders the best available asset for one engineering asset class.
 */
function EngineeringAssetSummary({ group, reviewAction, reviewStatuses }: { group: AssetClassSummary; reviewAction: (formData: FormData) => Promise<void>; reviewStatuses: ReviewStatusSummary[] }) {
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

  return (
    <div className="asset-review-card">
      <AssetCard
        availabilityLabel={`${assetClassReadinessLabel(group.readiness)} / ${provenanceLabel(bestAsset.provenance)}`}
        availabilityTone={assetClassReadinessTone(group.readiness)}
        fileFormat={bestAsset.fileFormat}
        previewLabel={previewLabel(bestAsset.previewStatus)}
        previewTone={previewTone(bestAsset.previewStatus)}
        reviewLabel={formatReviewStateLabel(reviewStatus.state)}
        reviewTone={reviewStateTone(reviewStatus.state)}
        sourceLabel={bestAsset.providerId ? `Best of ${group.assets.length} / source ${bestAsset.providerId}` : `Best of ${group.assets.length} / no source`}
        title={assetTypeLabel(group.assetType)}
        updatedLabel={`Updated ${formatDateTime(bestAsset.lastUpdatedAt)}`}
        validationLabel={`${validationLabel(bestAsset.validationStatus)} / ${formatAssetStatus(bestAsset.assetStatus)}`}
        validationTone={validationTone(bestAsset.validationStatus)}
      />
      <ReviewActionPanel reviewAction={reviewAction} reviewStatus={reviewStatus} targetId={bestAsset.id} targetType="asset" />
    </div>
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
      <span>Local review actions</span>
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
    generated: "Generated provenance",
    manual_internal: "Manual internal provenance",
    official: "Official provenance",
    trusted_external: "Trusted external provenance"
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
 * Maps asset class readiness into explicit user-facing copy.
 */
function assetClassReadinessLabel(readiness: AssetClassReadiness): string {
  const labels: Record<AssetClassReadiness, string> = {
    downloaded_file: "Downloaded file",
    export_ready: "Export-ready file",
    failed: "Failed asset",
    missing: "Missing asset",
    reference_only: "Reference only",
    validated_file: "Validated file"
  };

  return labels[readiness];
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
    approved: "verified",
    available_to_request: "info",
    failed: "danger",
    generated: "review",
    processing: "review",
    queued: "review",
    requested: "info",
    review_required: "review",
    unavailable: "neutral"
  };

  return tones[state];
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
