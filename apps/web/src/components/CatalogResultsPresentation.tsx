"use client";

/**
 * File header: Renders list and dense-table catalog result modes over backend-backed readiness rows.
 */

import React, { useState } from "react";
import { StatusBadge, TrustMeter } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";

/** CatalogResultRowViewModel keeps the search presentation decoupled from raw backend records. */
export type CatalogResultRowViewModel = {
  approvalDetail: string;
  approvalLabel: string;
  approvalTone: BadgeTone;
  assetTruthDetail: string;
  assetTruthLabel: string;
  category: string;
  description: string;
  connectorSignalDetail: string;
  connectorSignalLabel: string;
  connectorSignalTitle: string;
  connectorTitle: string;
  exportLabel: string;
  exportTone: BadgeTone;
  href: string;
  id: string;
  lifecycleLabel: string;
  manufacturerName: string;
  mpn: string;
  packageName: string;
  riskLabel: string;
  readinessDetail: string;
  readinessHeadline: string;
  readinessSubhead: string;
  topBlocker: string;
  trustScore: number;
  trustTone: BadgeTone;
};

/** CatalogResultsPresentationProps describes the backend-backed rows and optional initial mode. */
type CatalogResultsPresentationProps = {
  initialMode?: "list" | "table";
  rows: CatalogResultRowViewModel[];
};

/**
 * Renders the real catalog results in either explanation-first list mode or dense engineering table mode.
 */
export function CatalogResultsPresentation({ initialMode = "list", rows }: CatalogResultsPresentationProps) {
  const [mode, setMode] = useState<"list" | "table">(initialMode);

  return (
    <div className="catalog-results-presentation">
      <div className="results-panel__toolbar">
        <p>Use list mode for explanation-first review or table mode for faster dense scanning.</p>
        <div className="results-panel__mode" aria-label="Catalog results presentation mode">
          <button aria-pressed={mode === "list"} onClick={() => setMode("list")} type="button">
            List
          </button>
          <button aria-pressed={mode === "table"} onClick={() => setMode("table")} type="button">
            Table
          </button>
        </div>
      </div>

      {mode === "list" ? (
        <div className="results-list">
          {rows.map((row) => (
            <CatalogResultListRow key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <div className="catalog-results-table-view">
          <div className="catalog-results-table-view__intro">
            <strong>{rows.length} backend-backed rows</strong>
            <p>Dense mode keeps readiness, export, and blocker truth visible without opening every record.</p>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--dense catalog-results-table">
              <thead>
                <tr>
                  <th>MPN</th>
                  <th>Manufacturer</th>
                  <th>Category / package</th>
                  <th>Readiness</th>
                  <th>Approval</th>
                  <th>Export</th>
                  <th>Top blocker</th>
                  <th>Trust</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <a href={row.href}>
                        <span className="ui-mono">{row.mpn}</span>
                      </a>
                    </td>
                    <td>{row.manufacturerName}</td>
                    <td>
                      <div>{row.category}</div>
                      <div className="muted-copy ui-mono">{row.packageName}</div>
                    </td>
                    <td>
                      <strong>{row.readinessHeadline}</strong>
                      <div className="muted-copy">{row.readinessSubhead}</div>
                    </td>
                    <td>
                      <StatusBadge label={row.approvalLabel} tone={row.approvalTone} />
                    </td>
                    <td>
                      <StatusBadge label={row.exportLabel} tone={row.exportTone} />
                    </td>
                    <td>{row.topBlocker}</td>
                    <td className="catalog-results-table__trust">
                      <TrustMeter label="Trust" score={row.trustScore} tone={row.trustTone} />
                    </td>
                    <td>
                      <a className="button-link button-link--quiet" href={row.href}>
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Renders one explanation-first catalog row in the V3-inspired list format.
 */
function CatalogResultListRow({ row }: { row: CatalogResultRowViewModel }) {
  return (
    <article className="result-row">
      <div className="result-row__identity">
        <a className="result-row__mpn" href={row.href}>
          {row.mpn}
        </a>
        <p>{row.manufacturerName} - {row.category}</p>
        {row.description && <p className="result-row__description muted-copy">{row.description}</p>}
        <div className="result-row__identity-meta">
          <span className="ui-mono">{row.packageName}</span>
          <span>{row.lifecycleLabel}</span>
          <span>{row.connectorTitle}</span>
        </div>
      </div>

      <div className="result-row__summary">
        <strong>{row.readinessHeadline}</strong>
        <p>{row.readinessSubhead}</p>
        <small>{row.readinessDetail}</small>
      </div>

      <div className="result-row__signals">
        <div>
          <span>Export bundle</span>
          <strong>{row.exportLabel}</strong>
          <small>Bundle export follows verified file-backed CAD, not single-file luck.</small>
        </div>
        <div>
          <span>Approval</span>
          <strong>{row.approvalLabel}</strong>
          <small>{row.approvalDetail}</small>
        </div>
        <div>
          <span>CAD truth</span>
          <strong>{row.assetTruthLabel}</strong>
          <small>{row.assetTruthDetail}</small>
        </div>
        <div>
          <span>{row.connectorSignalTitle}</span>
          <strong>{row.connectorSignalLabel}</strong>
          <small>{row.connectorSignalDetail}</small>
        </div>
      </div>

      <div className="result-row__sidebar">
        <div className="result-row__badges">
          <StatusBadge label={row.lifecycleLabel} tone="neutral" />
          <StatusBadge label={row.approvalLabel} tone={row.approvalTone} />
          <StatusBadge label={row.exportLabel} tone={row.exportTone} />
        </div>
        <TrustMeter label="Trust" score={row.trustScore} tone={row.trustTone} />
        <div className="result-row__next">
          <span>{row.riskLabel}</span>
          <p>{row.topBlocker}</p>
        </div>
        <div className="result-row__actions">
          <a className="button-link button-link--quiet" href={row.href}>
            Open record
          </a>
        </div>
      </div>
    </article>
  );
}
