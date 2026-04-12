/**
 * File header: Implements the Phase 1 component detail shell.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetCard, MetricTable, SectionPanel, StatusBadge, TrustMeter } from "@ee-library/ui";
import {
  formatMetricLabel,
  formatMetricValue,
  getExportAvailability,
  isFileBackedAsset
} from "@ee-library/shared";
import { fetchPartDetail } from "../../../lib/api-client";
import type { BadgeTone, MetricTableRow } from "@ee-library/ui";
import type { Asset, Package, PreviewStatus, ValidationStatus } from "@ee-library/shared";

/** dynamic forces detail data to flow through the API service at request time. */
export const dynamic = "force-dynamic";

/** DetailPageProps supports both current and previous Next.js params shapes. */
interface DetailPageProps {
  /** Route params from the app router. */
  params: Promise<{ partId: string }>;
}

/**
 * Renders the component detail shell with metrics, package data, assets, and export readiness.
 */
export default async function PartDetailPage({ params }: DetailPageProps) {
  const { partId } = await params;
  const record = await fetchPartDetail(partId);

  if (!record) {
    notFound();
  }

  const exportActions = getExportAvailability(record);
  const metricRows = record.metrics.map<MetricTableRow>((metric) => ({
    label: formatMetricLabel(metric.metricKey),
    meta: `${Math.round(metric.confidenceScore * 100)}% confidence`,
    tone: scoreTone(metric.confidenceScore),
    value: formatMetricValue(metric)
  }));
  const datasheetAsset = record.datasheetRevision?.fileAssetId ? record.assets.find((asset) => asset.id === record.datasheetRevision?.fileAssetId) : undefined;

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
          <StatusBadge label="Normalized seed record" tone="info" />
          <TrustMeter label="Trust score" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
        </div>
      </section>

      <div className="detail-grid">
        <SectionPanel description="Values are normalized to the unit policy and retain datasheet revision confidence." title="Normalized specs">
          <MetricTable rows={metricRows} />
        </SectionPanel>

        <SectionPanel description="Dimensions are normalized in millimeters and unknown fields stay blank." title="Package dimensions">
          <dl className="dimension-grid">
            {packageDimensionRows(record.package).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd className="ui-mono">{row.value}</dd>
              </div>
            ))}
          </dl>
        </SectionPanel>

        <SectionPanel description="Datasheet metadata remains separate from file availability." title="Datasheet">
          <div className="datasheet-panel">
            <div>
              <p className="ui-mono">{record.datasheetRevision?.revisionLabel ?? "No revision"}</p>
              <p>{record.datasheetRevision?.revisionDate ?? "Revision date unknown"}</p>
              <p>{record.datasheetRevision?.pageCount ? `${record.datasheetRevision.pageCount} pages` : "Page count unknown"}</p>
            </div>
            <div className="datasheet-panel__badges">
              <StatusBadge label={`${Math.round((record.datasheetRevision?.parseConfidence ?? 0) * 100)}% parse confidence`} tone={scoreTone(record.datasheetRevision?.parseConfidence ?? 0)} />
              <StatusBadge label={datasheetAsset && isFileBackedAsset(datasheetAsset) ? "File available" : "Metadata only"} tone={datasheetAsset && isFileBackedAsset(datasheetAsset) ? "verified" : "review"} />
            </div>
          </div>
        </SectionPanel>

        <SectionPanel description="Cards reflect captured metadata and never imply missing files are exportable." title="Assets">
          <div className="asset-grid">
            {record.assets.map((asset) => (
              <AssetCard
                availabilityLabel={isFileBackedAsset(asset) ? "File available" : "Metadata only"}
                availabilityTone={isFileBackedAsset(asset) ? "verified" : "review"}
                fileFormat={asset.fileFormat}
                key={asset.id}
                previewLabel={previewLabel(asset.previewStatus)}
                previewTone={previewTone(asset.previewStatus)}
                title={assetTypeLabel(asset)}
                validationLabel={validationLabel(asset.validationStatus)}
                validationTone={validationTone(asset.validationStatus)}
              />
            ))}
          </div>
        </SectionPanel>

        <SectionPanel description="File-backed assets are required before CAD bundles can be packaged." title="Export readiness">
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
 * Formats a millimeter value while keeping unknown dimensions explicit.
 */
function formatMillimeters(value: number | null): string {
  return value === null ? "Unknown" : `${value} mm`;
}

/**
 * Maps a score to a shared visual tone.
 */
function scoreTone(score: number): BadgeTone {
  if (score >= 0.8) {
    return "verified";
  }

  if (score >= 0.65) {
    return "review";
  }

  return "danger";
}

/**
 * Formats an asset type into a user-facing title.
 */
function assetTypeLabel(asset: Asset): string {
  const labels: Record<Asset["assetType"], string> = {
    datasheet: "Datasheet",
    footprint: "Footprint",
    symbol: "Symbol",
    three_d_model: "3D model"
  };

  return labels[asset.assetType];
}

/**
 * Maps validation status into short user-facing copy.
 */
function validationLabel(status: ValidationStatus): string {
  const labels: Record<ValidationStatus, string> = {
    failed: "Validation failed",
    needs_review: "Needs review",
    not_validated: "Not validated",
    verified: "Verified"
  };

  return labels[status];
}

/**
 * Maps validation status into a badge tone.
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
 * Maps preview status into short user-facing copy.
 */
function previewLabel(status: PreviewStatus): string {
  const labels: Record<PreviewStatus, string> = {
    not_available: "No preview",
    pending: "Preview pending",
    ready: "Preview ready"
  };

  return labels[status];
}

/**
 * Maps preview status into a badge tone.
 */
function previewTone(status: PreviewStatus): BadgeTone {
  const tones: Record<PreviewStatus, BadgeTone> = {
    not_available: "neutral",
    pending: "review",
    ready: "verified"
  };

  return tones[status];
}
