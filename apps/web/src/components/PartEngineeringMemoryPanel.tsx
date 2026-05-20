/**
 * File header: Client-side panel for recording and reading private engineering memory on a part.
 *
 * This is the surface that answers the questions a public component aggregator cannot: did this
 * part work or bite us, which connector mated in the real harness, which CAD model was verified
 * against the physical part, which fixture/board/cable/program depended on it, why it was blocked,
 * and the free-form tribal knowledge around it. Recording never approves the part or unlocks export.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import {
  createPartEngineeringRecord,
  decidePartEngineeringRecordDraft,
  fetchPartEngineeringRecords,
  isApiClientError,
  resolvePartEngineeringRecord
} from "../lib/api-client";
import type {
  PartEngineeringRecord,
  PartEngineeringRecordKind,
  PartEngineeringRecordListResponse,
  PartEngineeringRecordOutcome,
  PartEngineeringRecordSeverity
} from "@ee-library/shared/types";

/** PartEngineeringMemoryPanelProps scopes engineering memory to one catalog part. */
export interface PartEngineeringMemoryPanelProps {
  partId: string;
  partMpn: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; data: PartEngineeringRecordListResponse }
  | { kind: "failed"; message: string };

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "failed"; message: string };

const KIND_OPTIONS: ReadonlyArray<{ value: PartEngineeringRecordKind; label: string }> = [
  { label: "Outcome — did it work or bite us?", value: "outcome" },
  { label: "Real-harness mate verified", value: "harness_mate_verified" },
  { label: "CAD verified against physical part", value: "cad_physical_verified" },
  { label: "Dependency (fixture / board / cable / program)", value: "dependency" },
  { label: "Decision / blocked-reason", value: "decision_blocked" },
  { label: "Note (tribal knowledge)", value: "note" }
];

const SEVERITY_OPTIONS: ReadonlyArray<PartEngineeringRecordSeverity> = ["info", "limitation", "caution", "blocking"];

const OUTCOME_OPTIONS: ReadonlyArray<{ value: PartEngineeringRecordOutcome; label: string }> = [
  { label: "Worked", value: "worked" },
  { label: "Worked with caveats", value: "worked_with_caveats" },
  { label: "Bit us", value: "bit_us" },
  { label: "Could not verify", value: "not_verified" }
];

const KINDS_WITH_OUTCOME: ReadonlySet<PartEngineeringRecordKind> = new Set([
  "outcome",
  "harness_mate_verified",
  "cad_physical_verified"
]);

/**
 * Renders existing engineering-memory records and a typed create form for one part.
 */
export function PartEngineeringMemoryPanel({ partId, partMpn }: PartEngineeringMemoryPanelProps): React.ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [recordKind, setRecordKind] = useState<PartEngineeringRecordKind>("outcome");
  const [title, setTitle] = useState<string>("");
  const [detail, setDetail] = useState<string>("");
  const [severity, setSeverity] = useState<PartEngineeringRecordSeverity>("info");
  const [outcome, setOutcome] = useState<PartEngineeringRecordOutcome>("worked");
  const [relatedMpn, setRelatedMpn] = useState<string>("");
  const [dependedOnBy, setDependedOnBy] = useState<string>("");
  const [relatedAssetId, setRelatedAssetId] = useState<string>("");
  const [datasheetRevisionId, setDatasheetRevisionId] = useState<string>("");
  const [evidenceUrl, setEvidenceUrl] = useState<string>("");
  const [recordedBy, setRecordedBy] = useState<string>("");

  const reload = useCallback(async () => {
    try {
      const data = await fetchPartEngineeringRecords(partId);
      setLoadState({ kind: "loaded", data });
    } catch (error) {
      const message = isApiClientError(error)
        ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
        : "Engineering memory fetch failed.";
      setLoadState({ kind: "failed", message });
    }
  }, [partId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = useCallback(async () => {
    if (!title.trim()) {
      setSubmitState({ kind: "failed", message: "Enter a short title so this is scannable later." });
      return;
    }
    setSubmitState({ kind: "submitting" });
    try {
      await createPartEngineeringRecord(partId, {
        datasheetRevisionId: datasheetRevisionId.trim() || null,
        dependedOnBy: dependedOnBy.trim() || null,
        detail: detail.trim() || null,
        evidenceUrl: evidenceUrl.trim() || null,
        outcome: KINDS_WITH_OUTCOME.has(recordKind) ? outcome : null,
        recordKind,
        recordedBy: recordedBy.trim() || null,
        relatedAssetId: relatedAssetId.trim() || null,
        relatedMpn: relatedMpn.trim() || null,
        severity,
        title: title.trim()
      });
      setSubmitState({ kind: "success", message: `Engineering memory recorded for ${partMpn}.` });
      setTitle("");
      setDetail("");
      setRelatedMpn("");
      setDependedOnBy("");
      setRelatedAssetId("");
      setDatasheetRevisionId("");
      setEvidenceUrl("");
      await reload();
    } catch (error) {
      const message = isApiClientError(error)
        ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
        : "Engineering memory create failed.";
      setSubmitState({ kind: "failed", message });
    }
  }, [datasheetRevisionId, dependedOnBy, detail, evidenceUrl, outcome, partId, partMpn, recordKind, recordedBy, relatedAssetId, relatedMpn, reload, severity, title]);

  const onResolve = useCallback(
    async (record: PartEngineeringRecord) => {
      try {
        await resolvePartEngineeringRecord(partId, record.id);
        await reload();
      } catch (error) {
        const message = isApiClientError(error)
          ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
          : "Engineering memory resolve failed.";
        setSubmitState({ kind: "failed", message });
      }
    },
    [partId, reload]
  );

  const onDecide = useCallback(
    async (record: PartEngineeringRecord, decision: "confirm" | "dismiss") => {
      try {
        await decidePartEngineeringRecordDraft(partId, record.id, decision);
        await reload();
      } catch (error) {
        const message = isApiClientError(error)
          ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
          : "Engineering memory review failed.";
        setSubmitState({ kind: "failed", message });
      }
    },
    [partId, reload]
  );

  return (
    <div className="part-engineering-memory-panel">
      <p className="form-hint">
        Private engineering memory only this team can record. It preserves what was learned the hard way; it does not approve the part, validate assets, or make export available.
      </p>

      <div className="part-engineering-memory-panel__form">
        <h4 className="form-section-label">Record engineering memory</h4>

        <div className="form-row">
          <label className="form-label" htmlFor="perec-kind">Kind</label>
          <select className="form-select" id="perec-kind" value={recordKind} onChange={(e) => setRecordKind(e.target.value as PartEngineeringRecordKind)}>
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="perec-title">Title</label>
          <input
            className="form-input"
            id="perec-title"
            maxLength={200}
            placeholder="e.g. Bit us: contact backed out after thermal cycling"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="perec-detail">Detail</label>
          <textarea
            className="form-textarea form-textarea--notes"
            id="perec-detail"
            maxLength={2000}
            placeholder="What happened, where, and what the next engineer must know. Include test/board IDs."
            rows={5}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </div>

        {KINDS_WITH_OUTCOME.has(recordKind) && (
          <div className="form-row">
            <label className="form-label" htmlFor="perec-outcome">Outcome</label>
            <select className="form-select" id="perec-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as PartEngineeringRecordOutcome)}>
              {OUTCOME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}

        {recordKind === "harness_mate_verified" && (
          <div className="form-row">
            <label className="form-label" htmlFor="perec-mate">Counterpart connector MPN</label>
            <input className="form-input" id="perec-mate" placeholder="MPN that actually mated in the real harness" value={relatedMpn} onChange={(e) => setRelatedMpn(e.target.value)} />
          </div>
        )}

        {recordKind === "dependency" && (
          <div className="form-row">
            <label className="form-label" htmlFor="perec-dep">Depended on by</label>
            <input className="form-input" id="perec-dep" placeholder="Test fixture / board / cable / program identifier" value={dependedOnBy} onChange={(e) => setDependedOnBy(e.target.value)} />
          </div>
        )}

        {recordKind === "cad_physical_verified" && (
          <>
            <div className="form-row">
              <label className="form-label" htmlFor="perec-asset">Verified asset id (optional)</label>
              <input className="form-input" id="perec-asset" placeholder="Internal asset id of the footprint / symbol / 3D model" value={relatedAssetId} onChange={(e) => setRelatedAssetId(e.target.value)} />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="perec-dsr">Datasheet revision id (optional)</label>
              <input className="form-input" id="perec-dsr" placeholder="Datasheet revision the design was checked against" value={datasheetRevisionId} onChange={(e) => setDatasheetRevisionId(e.target.value)} />
            </div>
          </>
        )}

        <div className="form-row">
          <label className="form-label" htmlFor="perec-severity">Severity</label>
          <select className="form-select" id="perec-severity" value={severity} onChange={(e) => setSeverity(e.target.value as PartEngineeringRecordSeverity)}>
            {SEVERITY_OPTIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="perec-evidence">Evidence URL (optional)</label>
          <input className="form-input" id="perec-evidence" placeholder="Link to a report, ticket, or photo" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} />
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="perec-by">Recorded by (optional)</label>
          <input className="form-input" id="perec-by" placeholder="Your name or handle" value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)} />
        </div>

        <div className="form-actions">
          <button className="button button--primary" disabled={submitState.kind === "submitting"} type="button" onClick={submit}>
            {submitState.kind === "submitting" ? "Saving…" : "Record engineering memory"}
          </button>
        </div>

        {submitState.kind === "failed" && <div className="form-feedback form-feedback--error">{submitState.message}</div>}
        {submitState.kind === "success" && <div className="form-feedback form-feedback--success">{submitState.message}</div>}
      </div>

      {loadState.kind === "loading" && <p className="form-hint">Loading engineering memory…</p>}
      {loadState.kind === "failed" && <div className="form-feedback form-feedback--error">{loadState.message}</div>}
      {loadState.kind === "loaded" && <EngineeringMemoryHistory data={loadState.data} onResolve={onResolve} onDecide={onDecide} />}
    </div>
  );
}

function EngineeringMemoryHistory({
  data,
  onDecide,
  onResolve
}: {
  data: PartEngineeringRecordListResponse;
  onDecide: (record: PartEngineeringRecord, decision: "confirm" | "dismiss") => Promise<void>;
  onResolve: (record: PartEngineeringRecord) => Promise<void>;
}): React.ReactElement {
  return (
    <div className="part-engineering-memory-history">
      {data.proposed.length > 0 && (
        <>
          <h4 className="form-section-label">Suggested from your activity — review</h4>
          <p className="form-hint">
            Auto-captured from substitutions and export bundles. These are suggestions, not memory: they do not count toward anything until you Confirm. Dismiss is preserved for audit.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Title</th>
                <th>Detail</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {data.proposed.map((record) => (
                <tr key={record.id}>
                  <td><StatusBadge label={record.draftSource.replace(/^auto_/u, "").replace(/_/gu, " ")} tone="review" /></td>
                  <td>{record.title}</td>
                  <td className="text-muted">{record.detail || "-"}</td>
                  <td>
                    <button className="link-button" type="button" onClick={() => { void onDecide(record, "confirm"); }}>
                      Confirm
                    </button>
                    {" · "}
                    <button className="link-button" type="button" onClick={() => { void onDecide(record, "dismiss"); }}>
                      Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h4 className="form-section-label">Open engineering memory</h4>
      {data.open.length === 0 ? (
        <EmptyState title="No open records" body="No open engineering-memory records for this part yet." />
      ) : (
        <EngineeringMemoryTable rows={data.open} onResolve={onResolve} showResolve />
      )}

      {data.resolved.length > 0 && (
        <>
          <h4 className="form-section-label">Resolved (history)</h4>
          <EngineeringMemoryTable rows={data.resolved} showResolve={false} />
        </>
      )}
    </div>
  );
}

function EngineeringMemoryTable({
  onResolve,
  rows,
  showResolve
}: {
  onResolve?: (record: PartEngineeringRecord) => Promise<void>;
  rows: PartEngineeringRecord[];
  showResolve: boolean;
}): React.ReactElement {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Kind</th>
          <th>Title</th>
          <th>Outcome</th>
          <th>Severity</th>
          <th>Recorded by</th>
          <th>{showResolve ? "Action" : "Resolved"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((record) => (
          <tr key={record.id}>
            <td><StatusBadge label={record.recordKind.replace(/_/gu, " ")} tone="info" /></td>
            <td>
              {record.title}
              {record.detail ? <div className="text-muted">{record.detail}</div> : null}
              {record.relatedMpn ? <div className="text-muted">Mated with: {record.relatedMpn}</div> : null}
              {record.dependedOnBy ? <div className="text-muted">Depended on by: {record.dependedOnBy}</div> : null}
              {record.relatedAssetId ? <div className="text-muted">Asset: {record.relatedAssetId}</div> : null}
              {record.datasheetRevisionId ? <div className="text-muted">Datasheet rev: {record.datasheetRevisionId}</div> : null}
              {record.evidenceUrl ? <div className="text-muted">Evidence: {record.evidenceUrl}</div> : null}
            </td>
            <td>{record.outcome ? <StatusBadge label={record.outcome.replace(/_/gu, " ")} tone={record.outcome === "bit_us" ? "danger" : record.outcome === "worked" ? "verified" : "review"} /> : <span className="text-muted">-</span>}</td>
            <td>
              <StatusBadge label={record.severity} tone={record.severity === "blocking" ? "danger" : record.severity === "caution" ? "review" : "info"} />
            </td>
            <td>{record.recordedBy ?? <span className="text-muted">-</span>}</td>
            <td>
              {showResolve && onResolve ? (
                <button className="link-button" type="button" onClick={() => { void onResolve(record); }}>
                  Resolve
                </button>
              ) : (
                <span className="text-muted">
                  {record.resolvedBy ?? "-"}
                  {record.resolvedAt ? ` on ${new Date(record.resolvedAt).toLocaleDateString()}` : ""}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
