/**
 * Side-by-side comparison for up to four catalog parts.
 */

import Link from "next/link";
import React from "react";
import { formatMetricLabel } from "@ee-library/shared/catalog-runtime";
import { EmptyState, SectionPanel, StatusBadge, TrustMeter } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";
import { getSetupStateCopy } from "../../lib/setup-state-copy";
import { CompareAssetPreviewBand } from "../../components/CompareAssetPreviewBand";
import { CompareSelectionTray } from "../../components/CompareSelectionTray";
import { CompareMissingPartsRecovery, CompareNoPartsRecovery } from "../../components/CompareRecoveryStates";
import { loadComparePage, type ComparePageState } from "../../lib/compare-page-loader";
import {
  buildCompareAssetClassRows,
  buildCompareAssetPreviewRows,
  buildCompareAssetTrustRows,
  buildCompareConnectorRows,
  buildCompareParameterRows,
  collectCompareMetricKeys,
  detailsToRecords,
  formatCompareMetricCell,
  shouldRenderConnectorCompareRows
} from "../../lib/part-compare";
import type { CompareCellTone, CompareRow } from "../../lib/part-compare";
import type { BundleReadinessState } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

const MAX_PARTS = 4;

type ComparePageProps = {
  searchParams: Promise<{ parts?: string | string[] }>;
};

/**
 * Parses comma-separated part identifiers from the query string (deduped, capped).
 */
function parsePartIdentifiersParam(parts: string | undefined): string[] {
  if (!parts || !parts.trim()) {
    return [];
  }

  const raw = parts.split(",").map((segment) => segment.trim()).filter(Boolean);
  return [...new Set(raw)].slice(0, MAX_PARTS);
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const resolved = await searchParams;
  const raw = resolved.parts;
  const param = Array.isArray(raw) ? raw[0] : raw;
  const partIdentifiers = parsePartIdentifiersParam(typeof param === "string" ? param : undefined);
  const compareState = await loadComparePage(partIdentifiers);
  const details = compareState.status === "ready" ? compareState.details : [];

  const records = detailsToRecords(details);
  const parameterRows = buildCompareParameterRows(details);
  const metricKeys = collectCompareMetricKeys(records);
  const assetClassRows = buildCompareAssetClassRows(records);
  const assetTrustRows = buildCompareAssetTrustRows(records);
  const assetPreviewRows = buildCompareAssetPreviewRows(records);
  const showConnectorRows = shouldRenderConnectorCompareRows(records);
  const connectorRows = showConnectorRows ? buildCompareConnectorRows(records) : [];

  return (
    <main className="compare-layout">
      <header className="compare-hero">
        <div>
          <p className="app-kicker">Compare parts</p>
          <h1>Part comparison</h1>
          <p className="compare-hero__lede">
            Look at up to {MAX_PARTS} parts side by side. Add parts from the catalog, from a part page, or in the box below. A blank cell means that metric is not recorded for that part.
          </p>
        </div>
        <Link className="back-link" href="/catalog">
          &larr; Back to catalog
        </Link>
      </header>

      {compareState.status === "ready" ? <CompareSelectionTray initialPartIds={partIdentifiers} /> : null}

      {compareState.status === "setup_required" ? (
        <CompareSetupState state={compareState} />
      ) : partIdentifiers.length === 0 ? (
        <CompareNoPartsRecovery />
      ) : details.length === 0 ? (
        <CompareMissingPartsRecovery />
      ) : (
        <>
          {details.length === 1 && records[0] ? (
            <p className="compare-callout" role="status">
              One part is selected. Use the box above to add another part by MPN or id, or find another in the catalog and add it from there.
            </p>
          ) : null}

          <SectionPanel description="Basic info: package, category, lifecycle, trust, and approval. Always confirm against the manufacturer datasheet before deciding." title="Summary">
            <div className="admin-table-wrap compare-table-wrap">
              <table className="admin-table compare-table">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    {records.map((record) => (
                      <th key={record.part.id} scope="col">
                        <Link className="ui-mono compare-table__mpn" href={`/parts/${record.part.id}`}>
                          {record.part.mpn}
                        </Link>
                        <span className="muted-copy compare-table__mfg">{record.manufacturer.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Package</th>
                    {records.map((record) => (
                      <td key={record.part.id} className="ui-mono">
                        {record.package.packageName}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Category</th>
                    {records.map((record) => (
                      <td key={record.part.id}>{record.part.category}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Lifecycle</th>
                    {records.map((record) => (
                      <td key={record.part.id}>{record.part.lifecycleStatus}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Trust score</th>
                    {records.map((record) => (
                      <td key={record.part.id}>
                        <TrustMeter label="Trust" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Ready to use</th>
                    {records.map((record) => (
                      <td key={record.part.id}>
                        <StatusBadge label={record.readinessSummary.label} tone="info" />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Approval</th>
                    {records.map((record) => (
                      <td key={record.part.id}>
                        <StatusBadge label={record.approval.summary} tone="neutral" />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Ready for export</th>
                    {details.map((detail) => (
                      <td key={detail.record.part.id}>
                        <StatusBadge label={detail.bundleReadiness.label} tone={bundleTone(detail.bundleReadiness.state)} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </SectionPanel>

          <SectionPanel description="Standardized specs combined across distributors and shown in the same units for every part. A “sources disagree” mark means the distributors reported different values — confirm against the datasheet." title="Specifications">
            {parameterRows.length === 0 ? (
              <EmptyState body="None of these parts have standardized specifications yet. Importing them from a distributor fills this in." title="No shared specifications" />
            ) : (
              <CompareCellTable headers={records.map((record) => record.part.mpn)} rows={parameterRows} />
            )}
          </SectionPanel>

          <SectionPanel description="Specs use the same units as the part page. Confidence is shown per metric — high confidence on one number does not mean the whole part is verified." title="Specs">
            {metricKeys.length === 0 ? (
              <EmptyState body="None of these parts have spec data yet." title="No shared specs" />
            ) : (
              <div className="admin-table-wrap compare-table-wrap">
                <table className="admin-table compare-table compare-table--metrics">
                  <thead>
                    <tr>
                      <th scope="col">Metric</th>
                      {records.map((record) => (
                        <th key={record.part.id} className="ui-mono" scope="col">
                          {record.part.mpn}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metricKeys.map((key) => (
                      <tr key={key}>
                        <th scope="row">{formatMetricLabel(key)}</th>
                        {records.map((record) => (
                          <td key={record.part.id} className="ui-mono">
                            {formatCompareMetricCell(record, key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionPanel>

          <SectionPanel description="Where each CAD file type stands for each part. A stored file is not the same as a verified file." title="CAD file status">
            <CompareCellTable headers={records.map((record) => record.part.mpn)} rows={assetClassRows} />
          </SectionPanel>

          <SectionPanel description="Each row shows where one type of CAD file is in review: generated draft, approved draft, or verified for export. A draft is not the same as verified — they stay separate." title="Verification status per file">
            <CompareCellTable headers={records.map((record) => record.part.mpn)} rows={assetTrustRows} />
          </SectionPanel>

          <SectionPanel description="Side-by-side symbol, footprint, and 3D previews. These are just visual evidence — the verification status above is what controls export." title="CAD preview">
            <CompareAssetPreviewBand rows={assetPreviewRows} />
          </SectionPanel>

          {showConnectorRows ? (
            <SectionPanel description="For connectors only: best mating partner, accessories, family conflicts, and our mating-confidence score. Non-connector parts show a dash." title="Connector details">
              <CompareCellTable headers={records.map((record) => record.part.mpn)} rows={connectorRows} />
            </SectionPanel>
          ) : null}
        </>
      )}
    </main>
  );
}

/**
 * Renders compare setup guidance without pretending missing API data is an empty match set.
 */
function CompareSetupState({ state }: { state: Extract<ComparePageState, { status: "setup_required" }> }) {
  const copy = getSetupStateCopy(state.code);
  return (
    <SectionPanel description={copy.body} title="Connect the catalog database">
      <EmptyState body={copy.headline} title="Compare unavailable" />
      <details className="audit-disclosure">
        <summary>Show technical details</summary>
        <p className="muted-copy">{state.code}: {state.message}</p>
      </details>
    </SectionPanel>
  );
}

/**
 * Renders a generic compare table where each row is a label plus one tone-aware cell per part.
 */
function CompareCellTable({ headers, rows }: { headers: string[]; rows: CompareRow[] }) {
  return (
    <div className="admin-table-wrap compare-table-wrap">
      <table className="admin-table compare-table compare-table--metrics">
        <thead>
          <tr>
            <th scope="col">Field</th>
            {headers.map((mpn, index) => (
              <th key={`${mpn}-${index}`} className="ui-mono" scope="col">
                {mpn}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <th scope="row">{row.label}</th>
              {row.values.map((value) => (
                <td key={`${row.rowKey}:${value.partId}`}>
                  <StatusBadge label={value.text} tone={cellToneToBadge(value.tone)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Maps compare-specific cell tones into shared badge tones.
 */
function cellToneToBadge(tone: CompareCellTone): BadgeTone {
  switch (tone) {
    case "verified":
      return "verified";
    case "danger":
      return "danger";
    case "review":
      return "review";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

/**
 * Maps numeric trust scores into coarse UI tones.
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
 * Maps bundle readiness into compare table badge tones without implying export availability.
 */
function bundleTone(state: BundleReadinessState): BadgeTone {
  if (state === "bundle_ready") {
    return "verified";
  }

  if (state === "no_usable_assets" || state === "references_only") {
    return "danger";
  }

  return "review";
}
