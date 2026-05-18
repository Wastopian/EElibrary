"use client";

/**
 * File header: Renders list and dense-table catalog result modes over backend-backed readiness rows.
 */

import React, { useState } from "react";
import { StatusBadge, TrustMeter } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";
import type { CatalogTrustLineageBadge } from "../lib/trust-lineage";

/** CatalogResultRowViewModel keeps the search presentation decoupled from raw backend records. */
export type CatalogResultRowViewModel = {
  approvalDetail: string;
  approvalLabel: string;
  approvalTone: BadgeTone;
  assetTruthDetail: string;
  assetTruthLabel: string;
  category: string;
  cadExportLabel: string;
  cadExportTone: BadgeTone;
  compareAddHref: string;
  description: string;
  connectorSignalDetail: string;
  connectorSignalLabel: string;
  connectorSignalTitle: string;
  datasheetLabel: string;
  datasheetTone: BadgeTone;
  connectorTitle: string;
  exportLabel: string;
  exportTone: BadgeTone;
  href: string;
  id: string;
  lifecycleLabel: string;
  manufacturerName: string;
  /**
   * Read-only "this bit us / is blocked" memory projection for scan-time interrupt. Null when
   * there is no confirmed warning memory. Never a gate.
   */
  memoryWarning: { count: number; blocking: boolean; topTitle: string } | null;
  mpn: string;
  packageName: string;
  nextActionDetail: string;
  nextActionLabel: string;
  riskLabel: string;
  readinessDetail: string;
  readinessHeadline: string;
  readinessSubhead: string;
  topBlocker: string;
  trustScore: number;
  trustLineageBadges: CatalogTrustLineageBadge[];
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
        <p>List mode shows each match with its readiness explained. Switch to table for a dense scan view across all rows.</p>
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
            <strong>{rows.length} visible rows</strong>
            <p>Scan identity, datasheet, CAD/export state, readiness, and the next action before opening a record.</p>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--dense catalog-results-table">
              <thead>
                <tr>
                  <th>MPN</th>
                  <th>Manufacturer</th>
                  <th>Description</th>
                  <th>Package</th>
                  <th>Lifecycle</th>
                  <th>Datasheet</th>
                  <th>CAD/export</th>
                  <th>Prior memory</th>
                  <th>Verification steps</th>
                  <th>Readiness</th>
                  <th>Next action</th>
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
                      <div>{row.description || row.category}</div>
                      <div className="muted-copy">{row.category}</div>
                    </td>
                    <td className="ui-mono">{row.packageName}</td>
                    <td>{row.lifecycleLabel.replace(/^Lifecycle: /u, "")}</td>
                    <td>
                      <StatusBadge label={row.datasheetLabel} tone={row.datasheetTone} />
                    </td>
                    <td>
                      <StatusBadge label={row.cadExportLabel} tone={row.cadExportTone} />
                    </td>
                    <td>
                      {row.memoryWarning ? (
                        <span title={row.memoryWarning.topTitle}>
                          <StatusBadge
                            label={row.memoryWarning.blocking ? `Blocked before (${row.memoryWarning.count})` : `Bit us before (${row.memoryWarning.count})`}
                            tone={row.memoryWarning.blocking ? "danger" : "review"}
                          />
                        </span>
                      ) : (
                        <span className="muted-copy">-</span>
                      )}
                    </td>
                    <td>
                      <details className="catalog-trust-gates-cell">
                        <summary>stages</summary>
                        <CatalogTrustGatesRow badges={row.trustLineageBadges} />
                      </details>
                    </td>
                    <td>
                      <strong>{row.readinessHeadline}</strong>
                      <div className="muted-copy">{row.readinessSubhead}</div>
                    </td>
                    <td>
                      <strong>{row.nextActionLabel}</strong>
                      <div className="muted-copy">{row.nextActionDetail}</div>
                    </td>
                    <td>
                      <a className="button-link button-link--quiet" href={row.href}>
                        Open
                      </a>
                      <a className="button-link button-link--quiet" href={row.compareAddHref}>
                        Compare
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
        {row.memoryWarning && (
          <p className="result-row__memory-warning">
            <StatusBadge
              label={row.memoryWarning.blocking ? "Blocked before" : "Bit us before"}
              tone={row.memoryWarning.blocking ? "danger" : "review"}
            />
            <span>{row.memoryWarning.topTitle}{row.memoryWarning.count > 1 ? ` (+${row.memoryWarning.count - 1} more)` : ""}</span>
          </p>
        )}
      </div>

      <div className="result-row__sidebar">
        <div className="result-row__next">
          <span>{row.riskLabel}</span>
          <p>{row.topBlocker}</p>
        </div>
        <div className="result-row__actions">
          <a className="button-link button-link--quiet" href={row.href}>
            Open record
          </a>
          <a className="button-link button-link--quiet" href={row.compareAddHref}>
            Add to compare
          </a>
        </div>
      </div>

      <details className="result-row__details">
        <summary>Show signals and verification steps</summary>
        <div className="result-row__details-body">
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
              <span>File status</span>
              <strong>{row.assetTruthLabel}</strong>
              <small>{row.assetTruthDetail}</small>
            </div>
            <div>
              <span>{row.connectorSignalTitle}</span>
              <strong>{row.connectorSignalLabel}</strong>
              <small>{row.connectorSignalDetail}</small>
            </div>
          </div>
          <div className="catalog-result-trust-gates" role="group" aria-label="Verification step gates">
            <span className="catalog-result-trust-gates__label">Verification steps</span>
            <CatalogTrustGatesRow badges={row.trustLineageBadges} />
          </div>
          <div className="result-row__details-meter">
            <div className="result-row__badges">
              <StatusBadge label={row.lifecycleLabel} tone="neutral" />
              <StatusBadge label={row.approvalLabel} tone={row.approvalTone} />
              <StatusBadge label={row.exportLabel} tone={row.exportTone} />
            </div>
            <TrustMeter label="Trust" score={row.trustScore} tone={row.trustTone} />
          </div>
        </div>
      </details>
    </article>
  );
}

/**
 * Renders four abbreviated trust-stage badges so imported/reviewed/approved/export stay distinct at scan speed.
 */
function CatalogTrustGatesRow({ badges }: { badges: CatalogTrustLineageBadge[] }): React.ReactElement {
  return (
    <div className="catalog-trust-gates">
      {badges.map((badge) => (
        <span key={badge.stageKey} className="catalog-trust-gates__item" title={badge.title}>
          <StatusBadge label={`${badge.abbrev}·${badge.stateMark}`} tone={badge.badgeTone} />
        </span>
      ))}
    </div>
  );
}
