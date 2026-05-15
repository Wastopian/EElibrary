/**
 * Side-by-side comparison for up to four catalog parts.
 */

import Link from "next/link";
import React from "react";
import { formatMetricLabel } from "@ee-library/shared/catalog-runtime";
import { EmptyState, SectionPanel, StatusBadge, TrustMeter } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";
import { fetchPartDetail, isApiClientError } from "../../lib/api-client";
import { getSetupStateCopy } from "../../lib/setup-state-copy";
import { CompareSelectionTray } from "../../components/CompareSelectionTray";
import { CompareMissingPartsRecovery, CompareNoPartsRecovery } from "../../components/CompareRecoveryStates";
import { CompareAssetPreviewBand } from "../../components/CompareAssetPreviewBand";
import {
  buildCompareAssetClassRows,
  buildCompareAssetPreviewRows,
  buildCompareAssetTrustRows,
  buildCompareConnectorRows,
  collectCompareMetricKeys,
  detailsToRecords,
  formatCompareMetricCell,
  shouldRenderConnectorCompareRows
} from "../../lib/part-compare";
import type { CompareCellTone, CompareRow } from "../../lib/part-compare";
import type { BundleReadinessState, PartDetailResponse } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

const MAX_PARTS = 4;

type ComparePageProps = {
  searchParams: Promise<{ parts?: string | string[] }>;
};

/** ComparePageState separates usable compare data from setup failures. */
type ComparePageState =
  | { details: PartDetailResponse[]; status: "ready" }
  | { code: string; message: string; status: "setup_required" };

/**
 * Parses comma-separated part ids from the query string (deduped, capped).
 */
function parsePartIdsParam(parts: string | undefined): string[] {
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
  const partIds = parsePartIdsParam(typeof param === "string" ? param : undefined);
  const compareState = await loadComparePage(partIds);
  const details = compareState.status === "ready" ? compareState.details : [];

  const records = detailsToRecords(details);
  const metricKeys = collectCompareMetricKeys(records);
  const assetClassRows = buildCompareAssetClassRows(records);
  const assetPreviewRows = buildCompareAssetPreviewRows(records);
  const assetTrustRows = buildCompareAssetTrustRows(records);
  const showConnectorRows = shouldRenderConnectorCompareRows(records);
  const connectorRows = showConnectorRows ? buildCompareConnectorRows(records) : [];

  return (
    <main className="compare-layout">
      <header className="compare-hero">
        <div>
          <p className="app-kicker">Compare workspace</p>
          <h1>Part comparison</h1>
          <p className="compare-hero__lede">
            Look at up to {MAX_PARTS} parts side by side. Add parts from the catalog, from a part page, or in the box below. A blank cell means that metric is not recorded for that part.
          </p>
        </div>
        <Link className="back-link" href="/catalog">
          &larr; Back to catalog
        </Link>
      </header>

      {compareState.status === "ready" ? (
        <CompareSelectionTray
          initialPartIds={partIds}
          initialPartLabels={Object.fromEntries(details.map((detail) => [detail.record.part.id, detail.record.part.mpn]))}
        />
      ) : null}

      {compareState.status === "setup_required" ? (
        <CompareSetupState state={compareState} />
      ) : partIds.length === 0 ? (
        <CompareNoPartsRecovery />
      ) : details.length === 0 ? (
        <CompareMissingPartsRecovery />
      ) : (
        <>
          {details.length === 1 && records[0] ? (
            <p className="compare-callout" role="status">
              One part is selected. Use the box above to add another part by id, or find another in the catalog and add it from there.
            </p>
          ) : null}

          <SectionPanel description="Identity and lifecycle from the current catalog. Always confirm against the manufacturer datasheet before final use." title="Summary">
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
                    <th scope="row">Readiness</th>
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
                    <th scope="row">Export bundle gate</th>
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

          <SectionPanel description="Values use the same normalization as part detail. Confidence is per-metric, not a whole-part guarantee." title="Normalized metrics">
            {metricKeys.length === 0 ? (
              <EmptyState body="None of these parts have normalized metrics yet." title="No shared metrics" />
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

          <SectionPanel description="Per-class readiness from current asset rows—file-backed and verified-for-export remain different states." title="Asset class readiness">
            <CompareCellTable headers={records.map((record) => record.part.mpn)} rows={assetClassRows} />
          </SectionPanel>

          <SectionPanel description="Symbol, footprint, and 3D model rendered side by side from the same per-asset preview pipeline the detail page uses. STEP files render only when a derived viewer artifact has been written—source bytes are never silently re-rendered. Inline preview readiness never implies the underlying asset is approved or verified for export; see the trust-stage diff directly below." title="CAD preview diff">
            <CompareAssetPreviewBand rows={assetPreviewRows} />
          </SectionPanel>

          <SectionPanel description="Trust-stage diff per asset class (generated draft, approved draft, verified-for-export). Stages remain explicit and never collapse into one approval label. Read this row alongside the CAD preview diff above to keep 'previews render' separate from 'asset is trusted'." title="Per-asset trust-stage diff">
            <CompareCellTable headers={records.map((record) => record.part.mpn)} rows={assetTrustRows} />
          </SectionPanel>

          {showConnectorRows ? (
            <SectionPanel description="Connector-only depth: best mate, accessories, family conflicts, and the saved mating-confidence score. Non-connector parts show a dash." title="Connector depth">
              <CompareCellTable headers={records.map((record) => record.part.mpn)} rows={connectorRows} />
            </SectionPanel>
          ) : null}
        </>
      )}
    </main>
  );
}

/**
 * Loads compare detail records while preserving catalog setup errors as page state.
 */
async function loadComparePage(partIds: string[]): Promise<ComparePageState> {
  const details: PartDetailResponse[] = [];

  try {
    for (const partId of partIds) {
      const detail = await fetchPartDetail(partId);

      if (detail) {
        details.push(detail);
      }
    }

    return {
      details,
      status: "ready"
    };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        status: "setup_required"
      };
    }

    return {
      code: "API_UNAVAILABLE",
      message: "The API could not be reached, so compare detail truth cannot be read.",
      status: "setup_required"
    };
  }
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
