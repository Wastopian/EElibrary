/**
 * File header: Client-side panel for browsing, recording, and resolving circuit-block known risks.
 *
 * Known risks are engineering-memory observations the team learned the hard way: an erratum, a
 * tested-only-up-to limitation, an inrush spike on cold start. Each row carries explicit
 * provenance (recordedBy, recordedAt) so a future reader can trust the context.
 *
 * Honesty contract this component preserves:
 *   * Resolving a risk never deletes the row — past project audits remain consistent.
 *   * Only unresolved `blocking` rows gate the reusable-stage verdict; this panel surfaces the
 *     severity in the badge tone but never claims a non-blocking risk approves or unblocks
 *     anything.
 *   * Recording or resolving a risk does not approve linked parts, validate assets, or unlock
 *     export — the boundary copy at the top of the panel repeats this.
 */

"use client";

import React, { useCallback, useMemo, useState } from "react";
import { createCircuitBlockKnownRisk, isApiClientError, resolveCircuitBlockKnownRisk } from "../lib/api-client";
import type { CircuitBlockKnownRisk, CircuitBlockKnownRiskSeverity } from "@ee-library/shared/types";

/** CircuitBlockKnownRisksPanelProps scopes the panel to one block and seeds the existing rows. */
export interface CircuitBlockKnownRisksPanelProps {
  circuitBlockId: string;
  knownRisks: CircuitBlockKnownRisk[];
}

/** CircuitBlockKnownRisksPanelStatus tracks the panel-wide save/resolve feedback. */
type CircuitBlockKnownRisksPanelStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "resolving"; riskId: string }
  | { kind: "success"; message: string }
  | { kind: "failed"; message: string };

/**
 * Renders the known-risks list, a per-row resolve action, and the record-new form.
 *
 * Active rows render first (newest-first by `recordedAt`); resolved rows render under a
 * collapsed history affordance so they don't clutter the scan-first view but remain auditable.
 */
export function CircuitBlockKnownRisksPanel({ circuitBlockId, knownRisks }: CircuitBlockKnownRisksPanelProps): React.ReactElement {
  const [status, setStatus] = useState<CircuitBlockKnownRisksPanelStatus>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState<CircuitBlockKnownRiskSeverity>("caution");
  const [recordedBy, setRecordedBy] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  const { activeRisks, resolvedRisks } = useMemo(() => {
    const active: CircuitBlockKnownRisk[] = [];
    const resolved: CircuitBlockKnownRisk[] = [];
    for (const risk of knownRisks) {
      if (risk.resolvedAt) resolved.push(risk);
      else active.push(risk);
    }
    return { activeRisks: active, resolvedRisks: resolved };
  }, [knownRisks]);

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedTitle = title.trim();

      if (!trimmedTitle) {
        setStatus({ kind: "failed", message: "Title is required so the risk is scannable in the library." });
        return;
      }

      setStatus({ kind: "saving" });

      try {
        const response = await createCircuitBlockKnownRisk(circuitBlockId, {
          detail: detail.trim() || null,
          evidenceUrl: evidenceUrl.trim() || null,
          recordedBy: recordedBy.trim() || null,
          severity,
          title: trimmedTitle
        });

        setStatus({ kind: "success", message: `Recorded "${response.knownRisk.title}". ${response.boundary}` });
        refreshCircuitBlockDetail();
      } catch (error) {
        setStatus({ kind: "failed", message: resolveCircuitBlockKnownRiskFailure(error) });
      }
    },
    [circuitBlockId, detail, evidenceUrl, recordedBy, severity, title]
  );

  const onResolve = useCallback(
    async (riskId: string) => {
      setStatus({ kind: "resolving", riskId });

      try {
        const response = await resolveCircuitBlockKnownRisk(circuitBlockId, riskId, {});
        setStatus({ kind: "success", message: `Resolved "${response.knownRisk.title}". ${response.boundary}` });
        refreshCircuitBlockDetail();
      } catch (error) {
        setStatus({ kind: "failed", message: resolveCircuitBlockKnownRiskFailure(error) });
      }
    },
    [circuitBlockId]
  );

  return (
    <div className="known-risks-panel">
      <p className="known-risks-panel__boundary">
        <strong>Engineering memory only.</strong> Recording or resolving a known risk does not approve linked parts, validate assets, or make export available. Only <em>unresolved</em> <code>blocking</code> rows gate the reusable-stage verdict.
      </p>

      <CircuitBlockKnownRisksList
        activeRisks={activeRisks}
        resolvedRisks={resolvedRisks}
        resolvingId={status.kind === "resolving" ? status.riskId : null}
        onResolve={onResolve}
      />

      <form className="known-risks-panel__form" onSubmit={onSubmit}>
        <h4>Record a new risk or limitation</h4>
        <label className="known-risks-panel__field--wide">
          <span>Title</span>
          <input
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Inrush spike on cold start"
            value={title}
          />
        </label>
        <label>
          <span>Severity</span>
          <select onChange={(event) => setSeverity(event.target.value as CircuitBlockKnownRiskSeverity)} value={severity}>
            <option value="info">Info — neutral context</option>
            <option value="limitation">Limitation — design constraint</option>
            <option value="caution">Caution — review before reuse</option>
            <option value="blocking">Blocking — do not reuse until resolved</option>
          </select>
        </label>
        <label>
          <span>Recorded by</span>
          <input
            autoComplete="off"
            onChange={(event) => setRecordedBy(event.target.value)}
            placeholder="gerry@hardware"
            value={recordedBy}
          />
        </label>
        <label className="known-risks-panel__field--wide">
          <span>Detail</span>
          <textarea
            onChange={(event) => setDetail(event.target.value)}
            placeholder="Output cap > 22uF caused VIN dip on Bravo Rev B. Recommend slow-start resistor."
            rows={3}
            value={detail}
          />
        </label>
        <label className="known-risks-panel__field--wide">
          <span>Evidence URL (optional)</span>
          <input
            autoComplete="off"
            onChange={(event) => setEvidenceUrl(event.target.value)}
            placeholder="https://internal-wiki.example.test/inrush-debug-2026"
            type="url"
            value={evidenceUrl}
          />
        </label>
        <div className="known-risks-panel__actions">
          <button disabled={status.kind === "saving"} type="submit">
            {status.kind === "saving" ? "Recording..." : "Record risk"}
          </button>
          <span className="muted-copy">
            Only <code>blocking</code> + unresolved gates reuse readiness. Lower severities are surfaced for context.
          </span>
        </div>
      </form>

      <CircuitBlockKnownRisksStatusMessage status={status} />
    </div>
  );
}

/**
 * Renders the active and resolved risk lists, each grouped under an explicit heading so a
 * reader scanning the page sees what is still open versus what has been resolved.
 */
function CircuitBlockKnownRisksList({
  activeRisks,
  resolvedRisks,
  resolvingId,
  onResolve
}: {
  activeRisks: CircuitBlockKnownRisk[];
  resolvedRisks: CircuitBlockKnownRisk[];
  resolvingId: string | null;
  onResolve: (riskId: string) => void;
}) {
  if (activeRisks.length === 0 && resolvedRisks.length === 0) {
    return (
      <p className="known-risks-panel__empty">
        No known risks recorded yet. When the team discovers an erratum, limitation, or caution that future engineers should know about before reusing this block, record it here so the memory survives the project.
      </p>
    );
  }

  return (
    <div className="known-risks-panel__lists">
      <section aria-labelledby="known-risks-active-heading" className="known-risks-panel__list">
        <h4 id="known-risks-active-heading">Active ({activeRisks.length})</h4>
        {activeRisks.length === 0
          ? <p className="muted-copy">No unresolved known risks. Block reuse is not gated by known-risk state.</p>
          : (
            <ul className="known-risks-list">
              {activeRisks.map((risk) => (
                <CircuitBlockKnownRiskRow
                  key={risk.id}
                  isResolving={resolvingId === risk.id}
                  onResolve={() => onResolve(risk.id)}
                  risk={risk}
                />
              ))}
            </ul>
          )}
      </section>

      {resolvedRisks.length > 0 ? (
        <section aria-labelledby="known-risks-resolved-heading" className="known-risks-panel__list">
          <h4 id="known-risks-resolved-heading">Resolved ({resolvedRisks.length})</h4>
          <ul className="known-risks-list known-risks-list--resolved">
            {resolvedRisks.map((risk) => (
              <CircuitBlockKnownRiskRow key={risk.id} isResolving={false} onResolve={null} risk={risk} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Renders one known-risk row with its severity badge, provenance, and optional resolve action.
 *
 * Resolved rows omit the resolve button and surface the resolver/resolution-notes inline so
 * the historical fix is visible without losing the original observation copy.
 */
function CircuitBlockKnownRiskRow({
  risk,
  onResolve,
  isResolving
}: {
  risk: CircuitBlockKnownRisk;
  onResolve: (() => void) | null;
  isResolving: boolean;
}) {
  const severityClassName = `known-risks-badge known-risks-badge--${risk.severity}`;
  return (
    <li className="known-risks-row">
      <header className="known-risks-row__header">
        <span className={severityClassName}>{formatSeverityLabel(risk.severity)}</span>
        <strong className="known-risks-row__title">{risk.title}</strong>
      </header>
      {risk.detail ? <p className="known-risks-row__detail">{risk.detail}</p> : null}
      <p className="known-risks-row__meta">
        Recorded {formatRiskDateTime(risk.recordedAt)}
        {risk.recordedBy ? ` by ${risk.recordedBy}` : ""}
        {risk.evidenceUrl ? <> · <a href={risk.evidenceUrl} rel="noopener noreferrer" target="_blank">Evidence link</a></> : null}
      </p>
      {risk.resolvedAt ? (
        <p className="known-risks-row__meta known-risks-row__meta--resolved">
          Resolved {formatRiskDateTime(risk.resolvedAt)}
          {risk.resolvedBy ? ` by ${risk.resolvedBy}` : ""}
          {risk.resolutionNotes ? <> · {risk.resolutionNotes}</> : null}
        </p>
      ) : null}
      {onResolve ? (
        <div className="known-risks-row__actions">
          <button disabled={isResolving} onClick={onResolve} type="button">
            {isResolving ? "Resolving..." : "Mark as resolved"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Renders panel-wide feedback for the create/resolve operations.
 */
function CircuitBlockKnownRisksStatusMessage({ status }: { status: CircuitBlockKnownRisksPanelStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "saving") return <p className="known-risks-panel__status known-risks-panel__status--pending">Recording risk...</p>;
  if (status.kind === "resolving") return <p className="known-risks-panel__status known-risks-panel__status--pending">Resolving risk...</p>;
  if (status.kind === "success") return <p className="known-risks-panel__status known-risks-panel__status--success">{status.message}</p>;
  return <p className="known-risks-panel__status known-risks-panel__status--failed">{status.message}</p>;
}

/**
 * Formats severity into UI copy. Stays terse so it fits in the badge slot.
 */
function formatSeverityLabel(severity: CircuitBlockKnownRiskSeverity): string {
  if (severity === "info") return "Info";
  if (severity === "limitation") return "Limitation";
  if (severity === "caution") return "Caution";
  return "Blocking";
}

/**
 * Formats an ISO timestamp into a calm, readable string for the risk meta line.
 */
function formatRiskDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/**
 * Converts API failures into concise known-risk copy.
 */
function resolveCircuitBlockKnownRiskFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Known-risk save failed. Try again or check the engineering-memory connection.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Recording or resolving known risks requires an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "Known risks require the engineering-memory database.";
  }

  return error.message.replace(/^Circuit block known risk (?:create|resolve) failed \([^)]+\):\s*/u, "");
}

/**
 * Refreshes the detail route after the panel mutates known-risk state.
 */
function refreshCircuitBlockDetail(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
