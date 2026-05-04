/**
 * File header: Client-side BOM import diagnostics and revision compare for project detail pages.
 */

"use client";

import React, { useCallback, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { fetchBomImportDiagnostics, fetchBomRevisionCompare, fetchProjectRevisionCompare, isApiClientError } from "../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type {
  BomImport,
  BomImportDiagnosticsResponse,
  BomImportDiagnosticsRow,
  BomLineMatchStatus,
  BomRevisionCompareResponse,
  BomRevisionCompareRow,
  ProjectRevision,
  ProjectRevisionCompareResponse,
  ProjectRevisionCompareRow
} from "@ee-library/shared/types";

/** BomDiagnosticsPanelProps scopes diagnostics to a project's BOM imports and revisions. */
export interface BomDiagnosticsPanelProps {
  bomImports: BomImport[];
  projectId: string;
  revisions: ProjectRevision[];
}

type DiagnosticsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: BomImportDiagnosticsResponse }
  | { kind: "failed"; message: string };

type CompareState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: BomRevisionCompareResponse }
  | { kind: "failed"; message: string };

type RevisionCompareState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: ProjectRevisionCompareResponse }
  | { kind: "failed"; message: string };

/**
 * Renders BOM import diagnostics and side-by-side revision comparison.
 */
export function BomDiagnosticsPanel({ bomImports, projectId, revisions }: BomDiagnosticsPanelProps): React.ReactElement {
  const [diagnosticsState, setDiagnosticsState] = useState<DiagnosticsState>({ kind: "idle" });
  const [compareState, setCompareState] = useState<CompareState>({ kind: "idle" });
  const [revisionCompareState, setRevisionCompareState] = useState<RevisionCompareState>({ kind: "idle" });
  const [selectedImportId, setSelectedImportId] = useState<string>("");
  const [compareImportId1, setCompareImportId1] = useState<string>("");
  const [compareImportId2, setCompareImportId2] = useState<string>("");
  const [revisionFromId, setRevisionFromId] = useState<string>("");
  const [revisionToId, setRevisionToId] = useState<string>("");
  const [showOnlyNonMatched, setShowOnlyNonMatched] = useState(false);

  const loadDiagnostics = useCallback(async () => {
    if (!selectedImportId) return;
    setDiagnosticsState({ kind: "loading" });

    try {
      const data = await fetchBomImportDiagnostics(selectedImportId);
      setDiagnosticsState({ kind: "loaded", data });
    } catch (error) {
      const message = isApiClientError(error) ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "") : "Diagnostics fetch failed.";
      setDiagnosticsState({ kind: "failed", message });
    }
  }, [selectedImportId]);

  const loadCompare = useCallback(async () => {
    if (!compareImportId1 || !compareImportId2) return;
    setCompareState({ kind: "loading" });

    try {
      const data = await fetchBomRevisionCompare(projectId, compareImportId1, compareImportId2);
      setCompareState({ kind: "loaded", data });
    } catch (error) {
      const message = isApiClientError(error) ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "") : "Revision compare failed.";
      setCompareState({ kind: "failed", message });
    }
  }, [projectId, compareImportId1, compareImportId2]);

  const loadRevisionCompare = useCallback(async () => {
    if (!revisionFromId || !revisionToId) return;
    setRevisionCompareState({ kind: "loading" });

    try {
      const data = await fetchProjectRevisionCompare(projectId, revisionFromId, revisionToId);
      setRevisionCompareState({ kind: "loaded", data });
    } catch (error) {
      const message = isApiClientError(error) ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "") : "Revision compare failed.";
      setRevisionCompareState({ kind: "failed", message });
    }
  }, [projectId, revisionFromId, revisionToId]);

  if (bomImports.length === 0) {
    return (
      <EmptyState
        title="No BOM imports"
        body="Upload and map a BOM import first to view diagnostics or compare revisions."
      />
    );
  }

  const diagnosticsData = diagnosticsState.kind === "loaded" ? diagnosticsState.data : null;
  const compareData = compareState.kind === "loaded" ? compareState.data : null;
  const revisionCompareData = revisionCompareState.kind === "loaded" ? revisionCompareState.data : null;

  const visibleDiagnosticsRows = diagnosticsData
    ? showOnlyNonMatched
      ? diagnosticsData.rows.filter((r) => r.matchStatus !== "matched")
      : diagnosticsData.rows
    : [];

  return (
    <div className="bom-diagnostics-panel">
      <div className="bom-diagnostics-panel__section">
        <h4 className="form-section-label">Match diagnostics</h4>
        <p className="form-hint">
          Review match status, confidence scores, and triage hints for each BOM row.
        </p>

        <div className="form-row">
          <label className="form-label" htmlFor="diagnostics-import">
            BOM import
          </label>
          <select
            className="form-select"
            id="diagnostics-import"
            value={selectedImportId}
            onChange={(e) => {
              setSelectedImportId(e.target.value);
              setDiagnosticsState({ kind: "idle" });
            }}
          >
            <option value="">Select a BOM import…</option>
            {bomImports.map((imp) => (
              <option key={imp.id} value={imp.id}>
                {imp.sourceFilename} — {imp.importStatus} ({new Date(imp.createdAt).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>

        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={!selectedImportId || diagnosticsState.kind === "loading"}
            type="button"
            onClick={loadDiagnostics}
          >
            {diagnosticsState.kind === "loading" ? "Loading…" : "Load diagnostics"}
          </button>
        </div>

        {diagnosticsState.kind === "failed" && (
          <div className="form-feedback form-feedback--error">{diagnosticsState.message}</div>
        )}

        {diagnosticsData && (
          <div className="diagnostics-summary">
            <div className="diagnostics-counts">
              <DiagnosticsCount label="Matched" value={diagnosticsData.matchedCount} tone="verified" />
              <DiagnosticsCount label="Unmatched" value={diagnosticsData.unmatchedCount} tone="danger" />
              <DiagnosticsCount label="Weak match" value={diagnosticsData.weakMatchCount} tone="review" />
              <DiagnosticsCount label="Ambiguous" value={diagnosticsData.ambiguousCount} tone="review" />
              <DiagnosticsCount label="Ignored" value={diagnosticsData.ignoredCount} tone="info" />
            </div>

            <div className="diagnostics-filter">
              <label className="checkbox-label">
                <input
                  checked={showOnlyNonMatched}
                  type="checkbox"
                  onChange={(e) => setShowOnlyNonMatched(e.target.checked)}
                />
                {" "}Show only unmatched, weak, and ambiguous rows
              </label>
            </div>

            {visibleDiagnosticsRows.length === 0 ? (
              <EmptyState title="No rows to show" body={showOnlyNonMatched ? "All rows are matched." : "No rows in this import."} />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>MPN</th>
                    <th>Manufacturer</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Status</th>
                    <th>Matched part</th>
                    <th>Triage</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDiagnosticsRows.map((row) => (
                    <DiagnosticsRow key={row.lineId} row={row} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="bom-diagnostics-panel__section">
        <h4 className="form-section-label">Import compare</h4>
        <p className="form-hint">
          Compare two BOM imports side by side to see added, removed, changed, and unchanged rows.
        </p>

        <div className="form-row">
          <label className="form-label" htmlFor="compare-import1">
            Base import
          </label>
          <select
            className="form-select"
            id="compare-import1"
            value={compareImportId1}
            onChange={(e) => {
              setCompareImportId1(e.target.value);
              setCompareState({ kind: "idle" });
            }}
          >
            <option value="">Select base import…</option>
            {bomImports.map((imp) => (
              <option key={imp.id} value={imp.id}>
                {imp.sourceFilename} ({new Date(imp.createdAt).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="compare-import2">
            Compare import
          </label>
          <select
            className="form-select"
            id="compare-import2"
            value={compareImportId2}
            onChange={(e) => {
              setCompareImportId2(e.target.value);
              setCompareState({ kind: "idle" });
            }}
          >
            <option value="">Select compare import…</option>
            {bomImports.map((imp) => (
              <option key={imp.id} value={imp.id}>
                {imp.sourceFilename} ({new Date(imp.createdAt).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>

        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={!compareImportId1 || !compareImportId2 || compareImportId1 === compareImportId2 || compareState.kind === "loading"}
            type="button"
            onClick={loadCompare}
          >
            {compareState.kind === "loading" ? "Comparing…" : "Compare imports"}
          </button>
        </div>

        {compareState.kind === "failed" && (
          <div className="form-feedback form-feedback--error">{compareState.message}</div>
        )}

        {compareData && (
          <div className="compare-results">
            <div className="diagnostics-counts">
              <DiagnosticsCount label="Added" value={compareData.addedCount} tone="verified" />
              <DiagnosticsCount label="Removed" value={compareData.removedCount} tone="danger" />
              <DiagnosticsCount label="Changed" value={compareData.changedCount} tone="review" />
              <DiagnosticsCount label="Unchanged" value={compareData.unchangedCount} tone="info" />
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>MPN</th>
                  <th>Manufacturer</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Match status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {compareData.rows.map((row, i) => (
                  <CompareRow key={i} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bom-diagnostics-panel__section">
        <h4 className="form-section-label">Revision compare</h4>
        <p className="form-hint">
          Compare two project revisions to see added, removed, MPN-swapped, quantity-changed, and designator-changed parts.
          BOM lines are aggregated across all imports under each revision and matched by confirmed part identity when available.
        </p>

        {revisions.length < 2 ? (
          <EmptyState
            title="Need at least two revisions"
            body="Create another project revision before running a revision-vs-revision compare."
          />
        ) : (
          <>
            <div className="form-row">
              <label className="form-label" htmlFor="compare-revision-from">From revision</label>
              <select
                className="form-select"
                id="compare-revision-from"
                value={revisionFromId}
                onChange={(e) => {
                  setRevisionFromId(e.target.value);
                  setRevisionCompareState({ kind: "idle" });
                }}
              >
                <option value="">Select base revision…</option>
                {revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {revision.revisionLabel} — {revision.revisionStatus}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label className="form-label" htmlFor="compare-revision-to">To revision</label>
              <select
                className="form-select"
                id="compare-revision-to"
                value={revisionToId}
                onChange={(e) => {
                  setRevisionToId(e.target.value);
                  setRevisionCompareState({ kind: "idle" });
                }}
              >
                <option value="">Select compare revision…</option>
                {revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {revision.revisionLabel} — {revision.revisionStatus}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-actions">
              <button
                className="button button--primary"
                disabled={!revisionFromId || !revisionToId || revisionFromId === revisionToId || revisionCompareState.kind === "loading"}
                type="button"
                onClick={loadRevisionCompare}
              >
                {revisionCompareState.kind === "loading" ? "Comparing…" : "Compare revisions"}
              </button>
            </div>

            {revisionCompareState.kind === "failed" && (
              <div className="form-feedback form-feedback--error">{revisionCompareState.message}</div>
            )}

            {revisionCompareData && (
              <div className="compare-results">
                <div className="diagnostics-counts">
                  <DiagnosticsCount label="Added" value={revisionCompareData.addedCount} tone="verified" />
                  <DiagnosticsCount label="Removed" value={revisionCompareData.removedCount} tone="danger" />
                  <DiagnosticsCount label="MPN swap" value={revisionCompareData.mpnSwapCount} tone="review" />
                  <DiagnosticsCount label="Qty change" value={revisionCompareData.quantityChangedCount} tone="review" />
                  <DiagnosticsCount label="Designator change" value={revisionCompareData.designatorChangedCount} tone="review" />
                  <DiagnosticsCount label="Unchanged" value={revisionCompareData.unchangedCount} tone="info" />
                </div>

                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Change</th>
                      <th>MPN</th>
                      <th>Identity</th>
                      <th>From qty</th>
                      <th>To qty</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisionCompareData.rows.map((row) => (
                      <RevisionCompareRow key={row.identityKey} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DiagnosticsCount({ label, tone, value }: { label: string; tone: BadgeTone; value: number }): React.ReactElement {
  return (
    <div className="diagnostics-count">
      <span className="diagnostics-count__value">{value}</span>
      <StatusBadge label={label} tone={tone} />
    </div>
  );
}

function DiagnosticsRow({ row }: { row: BomImportDiagnosticsRow }): React.ReactElement {
  return (
    <tr>
      <td className="ui-mono">{row.rowNumber}</td>
      <td className="ui-mono">{row.rawMpn ?? <span className="text-muted">—</span>}</td>
      <td>{row.rawManufacturer ?? <span className="text-muted">—</span>}</td>
      <td className="text-truncate">{row.rawDescription ?? <span className="text-muted">—</span>}</td>
      <td>{row.quantity ?? "—"}</td>
      <td>
        <StatusBadge label={row.matchStatus.replace("_", " ")} tone={matchStatusTone(row.matchStatus)} />
        {row.matchConfidenceScore !== null && (
          <span className="ui-mono text-muted"> {Math.round(row.matchConfidenceScore * 100)}%</span>
        )}
        {row.approvedSubstituteHints.length > 0 && (
          <div className="bom-substitute-hints">
            {row.approvedSubstituteHints.map((hint) => (
              <StatusBadge
                key={hint.substitutionId}
                label={`Substitute: ${hint.candidatePartMpn} (${hint.scope})`}
                tone="info"
              />
            ))}
          </div>
        )}
      </td>
      <td className="ui-mono">
        {row.matchedPartMpn ? (
          <>
            {row.matchedPartMpn}
            {row.matchedManufacturerName && <span className="text-muted"> ({row.matchedManufacturerName})</span>}
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td>
        {row.triageActions.length > 0 ? (
          <ul className="triage-actions">
            {row.triageActions.map((action, i) => (
              <li key={i}>{action}</li>
            ))}
          </ul>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  );
}

function CompareRow({ row }: { row: BomRevisionCompareRow }): React.ReactElement {
  return (
    <tr className={`compare-row compare-row--${row.kind}`}>
      <td>
        <StatusBadge label={row.kind} tone={compareKindTone(row.kind)} />
      </td>
      <td className="ui-mono">{row.rawMpn ?? <span className="text-muted">—</span>}</td>
      <td>{row.rawManufacturer ?? <span className="text-muted">—</span>}</td>
      <td className="text-truncate">{row.rawDescription ?? <span className="text-muted">—</span>}</td>
      <td>{row.quantity ?? "—"}</td>
      <td>
        <StatusBadge label={row.matchStatus.replace("_", " ")} tone={matchStatusTone(row.matchStatus)} />
      </td>
      <td className="text-muted">{row.changeDetail ?? "—"}</td>
    </tr>
  );
}

function matchStatusTone(status: BomLineMatchStatus): BadgeTone {
  switch (status) {
    case "matched":
      return "verified";
    case "unmatched":
      return "danger";
    case "weak_match":
    case "ambiguous":
      return "review";
    case "ignored":
      return "info";
    default:
      return "info";
  }
}

function compareKindTone(kind: BomRevisionCompareRow["kind"]): BadgeTone {
  switch (kind) {
    case "added":
      return "verified";
    case "removed":
      return "danger";
    case "changed":
      return "review";
    default:
      return "info";
  }
}

function RevisionCompareRow({ row }: { row: ProjectRevisionCompareRow }): React.ReactElement {
  const fromQuantity = row.from?.quantity ?? null;
  const toQuantity = row.to?.quantity ?? null;
  const matchedLabel = row.to?.matchedPartMpn ?? row.from?.matchedPartMpn ?? null;
  const identityLabel =
    row.identityKind === "matched_part"
      ? matchedLabel ? `matched: ${matchedLabel}` : "matched part"
      : row.identityKind === "raw_mpn"
        ? "raw MPN"
        : "raw row";

  return (
    <tr className={`compare-row compare-row--${row.changeKind}`}>
      <td>
        <StatusBadge label={row.changeKind.replace("_", " ")} tone={revisionChangeKindTone(row.changeKind)} />
      </td>
      <td className="ui-mono">{row.rawMpn ?? <span className="text-muted">—</span>}</td>
      <td>
        <span className="text-muted">{identityLabel}</span>
      </td>
      <td>{fromQuantity ?? <span className="text-muted">—</span>}</td>
      <td>{toQuantity ?? <span className="text-muted">—</span>}</td>
      <td className="text-muted">{row.changeDetail ?? "—"}</td>
    </tr>
  );
}

function revisionChangeKindTone(kind: ProjectRevisionCompareRow["changeKind"]): BadgeTone {
  switch (kind) {
    case "added":
      return "verified";
    case "removed":
      return "danger";
    case "mpn_swap":
    case "quantity_changed":
    case "designator_changed":
      return "review";
    default:
      return "info";
  }
}
