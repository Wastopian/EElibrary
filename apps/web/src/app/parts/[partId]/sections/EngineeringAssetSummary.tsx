/**
 * File header: Renders the best available asset for one engineering asset class —
 * the dense per-class card with review/promotion/access actions and inline preview.
 */

import { AssetCard, StatusBadge } from "@ee-library/ui";
import React from "react";
import { isFileBackedAsset } from "@ee-library/shared/asset-state";
import { formatAssetAvailabilityStatus, formatAssetExportStatus } from "@ee-library/shared/catalog-runtime";
import type {
  Asset,
  AssetClassSummary,
  AssetPromotionSummary,
  AssetValidationSummary,
  CatalogDataSource,
  ControlledDocumentRevision,
  ReviewStatusSummary
} from "@ee-library/shared/types";
import { AssetInlinePreview } from "../../../../components/AssetInlinePreview";
import { buildAssetDownloadUrl } from "../../../../lib/api-client";
import {
  assetTrustStageTone,
  formatAssetPromotionBlockers,
  formatAssetPromotionHistory,
  formatAssetSourceLabel,
  formatAssetTrustStageLabel,
  formatAssetValidationEvidence
} from "../../../../lib/detail-view-model";
import {
  buildAssetTrustCheckSummary,
  buildAssetWorkflowSurfaceSummary,
  findAssetPromotionSummary,
  findAssetValidationSummary,
  findReviewStatus,
  formatAssetClassReadinessDetail,
  formatAssetClassReadinessLabel,
  gatedAccessBadge
} from "../lib/asset-helpers";
import {
  assetTypeLabel,
  formatDateTime,
  previewLabel,
  provenanceLabel,
  validationLabel
} from "../lib/format";
import { assetClassReadinessTone, mapViewToneToBadge, previewTone, validationTone } from "../lib/tone";
import { AssetPromotionPanel } from "./AssetPromotionPanel";
import { ReviewActionPanel } from "./ReviewActionPanel";

/**
 * Renders the best available asset for one engineering asset class.
 */
export function EngineeringAssetSummary({ group, promotionAction, promotionSummaries, reviewAction, reviewStatuses, source, validationSummaries, gatedRevision }: { group: AssetClassSummary; promotionAction: (formData: FormData) => Promise<void>; promotionSummaries: AssetPromotionSummary[]; reviewAction: (formData: FormData) => Promise<void>; reviewStatuses: ReviewStatusSummary[]; source: CatalogDataSource | undefined; validationSummaries: AssetValidationSummary[]; gatedRevision: ControlledDocumentRevision | null }) {
  const bestAsset = group.bestAsset;

  if (!bestAsset) {
    return (
      <article className="ui-asset-card ui-asset-card--missing">
        <div className="ui-asset-card__header">
          <div className="ui-asset-card__identity">
            <span className="ui-asset-card__eyebrow">File type</span>
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
            <StatusBadge label="No files yet" tone="neutral" />
          </div>
        </div>
        <dl className="ui-asset-card__meta">
          <div>
            <dt>Detail</dt>
            <dd>No files are attached to this type yet, so it cannot count toward review or export readiness.</dd>
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
          <span>File status</span>
          <strong>{formatAssetClassReadinessLabel(group.readiness)}</strong>
          <p>{formatAssetClassReadinessDetail(group.readiness, group.assets.length)}</p>
        </div>
        <div>
          <span>Review step</span>
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
        <summary>Validation details and history</summary>
        <div className="asset-review-card__evidence">
          <p>Validation evidence: {formatAssetValidationEvidence(validationSummary)}</p>
          <p>Verification history: {formatAssetPromotionHistory(promotionSummary)}</p>
          <p>What is blocking verification: {formatAssetPromotionBlockers(promotionSummary)}</p>
        </div>
      </details>
      <div className="asset-review-card__actions">
        {gatedRevision ? (
          <div className="asset-gating-notice">
            <StatusBadge label={gatedAccessBadge(gatedRevision.accessLevel).label} tone={gatedAccessBadge(gatedRevision.accessLevel).tone} />
            <p className="muted-copy">
              Active controlled revision <strong className="ui-mono">{gatedRevision.revisionLabel}</strong> ({gatedRevision.documentType}). You must acknowledge access before downloading.
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

  if (asset.availabilityStatus === "failed") {
    return null;
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
