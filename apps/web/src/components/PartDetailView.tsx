/**
 * File header: Pure (renderable) detail view for an imported or seeded part. Takes a fully
 * resolved PartDetailViewModel from @ee-library/shared so unit tests can drive it without
 * touching Next routing or the API. Uses plain anchors instead of next/link so server-side
 * rendering tests can exercise it in isolation.
 */

import * as React from "react";
import { AssetCard, MetricTable, SectionPanel, StatusBadge, TrustMeter } from "@ee-library/ui";
import type { BadgeTone, MetricTableRow } from "@ee-library/ui";
import {
  assetStateLabel,
  assetStateTone,
  assetTypeLabel,
  previewLabel,
  previewTone,
  validationLabel,
  validationTone
} from "@ee-library/shared";
import type {
  Asset,
  AssetState,
  Package,
  PartDetailCadAsset,
  PartDetailIssue,
  PartDetailViewModel,
  PreviewStatus,
  Tone,
  ValidationStatus
} from "@ee-library/shared";

/** PartDetailViewProps accepts the engineer-first view model and an optional back-href. */
export interface PartDetailViewProps {
  /** Engineer-first detail view model. */
  viewModel: PartDetailViewModel;
  /** Optional back-link target. Defaults to "/" so the search page is reachable from /parts/:id. */
  backHref?: string;
}

/**
 * Renders the engineer-first part detail page. Provenance and raw assets stay below the
 * summary so the page answers "can I use this part?" before "where did it come from?".
 */
export function PartDetailView({ backHref = "/", viewModel }: PartDetailViewProps) {
  const { cadReadiness, datasheet, exportActions, identity, issues, metrics, partPackage, provenance, rawAssets } = viewModel;

  const metricRows: MetricTableRow[] = metrics.map((row) => ({
    label: row.label,
    meta: `${row.confidencePercent}% confidence`,
    tone: toBadgeTone(row.confidenceTone),
    value: row.value
  }));

  return (
    <main className="detail-layout">
      <a className="back-link" href={backHref}>
        Back to search
      </a>

      <section className="detail-hero">
        <div>
          <p className="app-kicker">{identity.manufacturerName}</p>
          <h2 className="ui-mono">{identity.mpn}</h2>
          <p>{identity.description}</p>
        </div>
        <div className="detail-hero__status">
          <StatusBadge label={identity.lifecycleLabel} tone={toBadgeTone(identity.lifecycleTone)} />
          <StatusBadge label={`${identity.sourceCount} source records`} tone="info" />
          <StatusBadge label={`Updated ${formatDateTime(identity.lastUpdatedAt)}`} tone="neutral" />
          <TrustMeter label="Trust score" score={identity.trustScore} tone={toBadgeTone(identity.trustTone)} />
        </div>
      </section>

      <SectionPanel description="A scannable summary of identity, package, and lifecycle." title="Engineer summary">
        <dl className="identity-grid">
          <IdentityRow label="MPN" value={<span className="ui-mono">{identity.mpn}</span>} />
          <IdentityRow label="Manufacturer" value={identity.manufacturerName} />
          <IdentityRow label="Category" value={identity.category} />
          <IdentityRow label="Package" value={identity.packageName} />
          <IdentityRow label="Lifecycle" value={identity.lifecycleLabel} />
        </dl>
      </SectionPanel>

      <div className="detail-grid">
        <SectionPanel description="Top normalized metrics, sorted by source datasheet confidence." title="Key specs">
          {metricRows.length > 0 ? (
            <MetricTable rows={metricRows} />
          ) : (
            <p className="muted-copy">No normalized metrics have been captured for this part yet.</p>
          )}
        </SectionPanel>

        <SectionPanel description="Datasheet metadata stays separate from file availability." title="Datasheet">
          <div className="datasheet-panel">
            <div>
              <p className="ui-mono">{datasheet.revisionLabel}</p>
              <p>{datasheet.revisionDate ?? "Revision date unknown"}</p>
              <p>{datasheet.pageCount ? `${datasheet.pageCount} pages` : "Page count unknown"}</p>
            </div>
            <div className="datasheet-panel__badges">
              <StatusBadge label={`${datasheet.parseConfidencePercent}% parse confidence`} tone={toBadgeTone(datasheet.parseConfidenceTone)} />
              <StatusBadge label={datasheet.fileBacked ? "Stored file" : datasheet.available ? "Referenced only" : "Metadata only"} tone={toBadgeTone(datasheet.fileBackedTone)} />
            </div>
            <div className="datasheet-panel__action">
              {datasheet.actionEnabled && datasheet.actionUrl ? (
                <a
                  className="datasheet-action"
                  data-testid="datasheet-action"
                  href={datasheet.actionUrl}
                  rel={datasheet.actionOpensExternal ? "noopener noreferrer" : undefined}
                  target={datasheet.actionOpensExternal ? "_blank" : undefined}
                >
                  {datasheet.actionLabel}
                </a>
              ) : (
                <button className="datasheet-action" data-testid="datasheet-action" disabled type="button">
                  {datasheet.actionLabel}
                </button>
              )}
            </div>
          </div>
        </SectionPanel>

        <SectionPanel description="Symbol, footprint, and 3D model readiness for export bundles." title="CAD readiness">
          <div className="cad-readiness-grid" data-testid="cad-readiness-grid">
            <CadReadinessCard summary={cadReadiness.symbol} />
            <CadReadinessCard summary={cadReadiness.footprint} />
            <CadReadinessCard summary={cadReadiness.threeDModel} />
          </div>
          <p className="cad-readiness-summary">
            {cadReadiness.exportableCount} of 3 CAD asset types are validated and downloadable.
          </p>
        </SectionPanel>

        <SectionPanel description="What's blocking trust or export, and the next step to fix it." title="What's missing">
          {issues.length === 0 ? (
            <p className="muted-copy" data-testid="issues-empty">
              No outstanding readiness issues. This part has datasheet, CAD, and lifecycle data engineers can rely on.
            </p>
          ) : (
            <ul className="issue-list" data-testid="issue-list">
              {issues.map((issue) => (
                <IssueRow issue={issue} key={issue.code} />
              ))}
            </ul>
          )}
        </SectionPanel>

        <SectionPanel description="Dimensions are normalized in millimeters and unknown fields stay blank." title="Package dimensions">
          <dl className="dimension-grid">
            {packageDimensionRows(partPackage).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd className="ui-mono">{row.value}</dd>
              </div>
            ))}
          </dl>
        </SectionPanel>

        <SectionPanel description="Validated downloadable assets are required before CAD bundles can be packaged." title="Export readiness">
          <div className="export-list">
            {exportActions.map((action) => (
              <button className="export-action" disabled={!action.available} key={action.id} title={action.reason} type="button">
                <span>{action.label}</span>
                <small>{action.reason}</small>
              </button>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel description="Cards reflect captured metadata and never imply missing files are exportable." title="Raw assets">
          <div className="asset-grid">
            {rawAssets.length === 0 ? (
              <p className="muted-copy">No asset records exist yet for this part.</p>
            ) : (
              rawAssets.map((asset) => (
                <AssetCard
                  availabilityLabel={assetStateLabel(asset.assetState)}
                  availabilityTone={toBadgeTone(assetStateTone(asset.assetState as AssetState))}
                  fileFormat={asset.fileFormat}
                  key={asset.id}
                  previewLabel={previewLabel(asset.previewStatus as PreviewStatus)}
                  previewTone={toBadgeTone(previewTone(asset.previewStatus as PreviewStatus))}
                  sourceLabel={asset.providerId ? `Source ${asset.providerId}` : "No source"}
                  title={assetTypeLabel(asset.assetType)}
                  updatedLabel={`Updated ${formatDateTime(asset.lastUpdatedAt)}`}
                  validationLabel={validationLabel(asset.validationStatus as ValidationStatus)}
                  validationTone={toBadgeTone(validationTone(asset.validationStatus as ValidationStatus))}
                />
              ))
            )}
          </div>
        </SectionPanel>

        <SectionPanel description="Raw source records are preserved for audit and later conflict review." title="Provenance">
          <div className="source-list">
            {provenance.length > 0 ? (
              provenance.map((source) => (
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
              <p className="muted-copy">No source records are attached to this fallback record.</p>
            )}
          </div>
        </SectionPanel>
      </div>
    </main>
  );
}

/**
 * Renders one identity-grid row.
 */
function IdentityRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Renders a CAD readiness card for one asset type.
 */
function CadReadinessCard({ summary }: { summary: PartDetailCadAsset }) {
  return (
    <article className="cad-readiness-card" data-testid={`cad-readiness-${summary.assetType}`}>
      <header>
        <h3>{summary.label}</h3>
        <StatusBadge label={summary.exportable ? "Exportable" : summary.stateLabel} tone={toBadgeTone(summary.exportable ? "verified" : summary.stateTone)} />
      </header>
      <dl>
        <div>
          <dt>State</dt>
          <dd>{summary.stateLabel}</dd>
        </div>
        <div>
          <dt>Validation</dt>
          <dd>{summary.validationLabel}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{summary.fileFormat}</dd>
        </div>
      </dl>
      {summary.sourceUrl ? (
        <a className="cad-readiness-card__action" href={summary.sourceUrl} rel="noopener noreferrer" target="_blank">
          Open referenced source
        </a>
      ) : null}
    </article>
  );
}

/**
 * Renders one issue with its next-action link or command hint.
 */
function IssueRow({ issue }: { issue: PartDetailIssue }) {
  return (
    <li className="issue-row" data-testid={`issue-${issue.code}`}>
      <div className="issue-row__copy">
        <StatusBadge label={issue.headline} tone={toBadgeTone(issue.tone)} />
        <p>{issue.body}</p>
      </div>
      {issue.next ? (
        <div className="issue-row__action">
          {issue.next.kind === "link" && issue.next.href ? (
            <a className="issue-action" href={issue.next.href} rel="noopener noreferrer" target="_blank">
              {issue.next.label}
            </a>
          ) : (
            <span className="issue-action issue-action--command">
              {issue.next.label}
              {issue.next.command ? <code>{issue.next.command}</code> : null}
            </span>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Maps the shared Tone union to the UI BadgeTone (identical string values).
 */
function toBadgeTone(tone: Tone): BadgeTone {
  return tone;
}

/**
 * Formats an ISO timestamp for dense workspace metadata.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
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

/** Re-export Asset to keep callers happy; not currently consumed externally but used by the file. */
export type { Asset };
