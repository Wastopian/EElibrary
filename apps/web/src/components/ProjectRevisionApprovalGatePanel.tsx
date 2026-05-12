/**
 * File header: Client-side controls for project BOM revision approval gates.
 */

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { fetchProjectRevisionApprovalGates, isApiClientError, upsertProjectRevisionApprovalGate } from "../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type {
  ProjectRevision,
  ProjectRevisionApprovalGate,
  ProjectRevisionApprovalGateDecision,
  ProjectRevisionApprovalGateListResponse,
  ProjectRevisionApprovalGateResponse,
  ProjectRevisionApprovalGateStatus
} from "@ee-library/shared/types";

/** ProjectRevisionApprovalGatePanelProps wires the gate controls to one project. */
export interface ProjectRevisionApprovalGatePanelProps {
  projectId: string;
  revisions: ProjectRevision[];
}

/** ApprovalGateLoadState tracks list loading and failure states. */
type ApprovalGateLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; response: ProjectRevisionApprovalGateListResponse }
  | { kind: "failed"; message: string };

/** ApprovalGateSubmitState tracks the current gate decision request. */
type ApprovalGateSubmitState =
  | { kind: "idle" }
  | { kind: "submitting"; decision: ProjectRevisionApprovalGateDecision }
  | { kind: "success"; response: ProjectRevisionApprovalGateResponse }
  | { kind: "failed"; message: string };

/**
 * Renders revision-pair selectors, gate actions, and persisted gate history.
 */
export function ProjectRevisionApprovalGatePanel({ projectId, revisions }: ProjectRevisionApprovalGatePanelProps): React.ReactElement {
  const defaultFromRevisionId = revisions.length >= 2 ? revisions[0]?.id ?? "" : "";
  const defaultToRevisionId = revisions.length >= 2 ? revisions[revisions.length - 1]?.id ?? "" : "";
  const [fromRevisionId, setFromRevisionId] = useState(defaultFromRevisionId);
  const [toRevisionId, setToRevisionId] = useState(defaultToRevisionId);
  const [notes, setNotes] = useState("");
  const [loadState, setLoadState] = useState<ApprovalGateLoadState>({ kind: "idle" });
  const [submitState, setSubmitState] = useState<ApprovalGateSubmitState>({ kind: "idle" });

  const revisionLabelById = useMemo(() => buildRevisionLabelById(revisions), [revisions]);

  /**
   * Loads persisted gate history for this project.
   */
  const loadGates = useCallback(async () => {
    setLoadState({ kind: "loading" });
    try {
      const response = await fetchProjectRevisionApprovalGates(projectId);
      setLoadState({ kind: "ready", response });
    } catch (error) {
      setLoadState({ kind: "failed", message: resolveGateFailure(error, "load") });
    }
  }, [projectId]);

  useEffect(() => {
    void loadGates();
  }, [loadGates]);

  /**
   * Persists one gate decision for the selected revision pair.
   */
  const submitGate = useCallback(
    async (decision: ProjectRevisionApprovalGateDecision) => {
      if (!fromRevisionId || !toRevisionId || fromRevisionId === toRevisionId) return;

      setSubmitState({ decision, kind: "submitting" });
      try {
        const response = await upsertProjectRevisionApprovalGate(projectId, {
          decision,
          fromRevisionId,
          notes: notes.trim().length > 0 ? notes.trim() : null,
          toRevisionId
        });
        setSubmitState({ kind: "success", response });
        await loadGates();
      } catch (error) {
        setSubmitState({ kind: "failed", message: resolveGateFailure(error, "submit") });
      }
    },
    [fromRevisionId, loadGates, notes, projectId, toRevisionId]
  );

  if (revisions.length < 2) {
    return (
      <EmptyState
        title="Need two revisions"
        body="Create another revision before recording a BOM diff approval gate."
      />
    );
  }

  const gates = loadState.kind === "ready" ? loadState.response.gates : [];
  const boundary = loadState.kind === "ready" ? loadState.response.boundary : null;
  const canSubmit = Boolean(fromRevisionId && toRevisionId && fromRevisionId !== toRevisionId);

  return (
    <div className="revision-gate-panel">
      <div className="revision-gate-panel__controls">
        <label>
          <span>From revision</span>
          <select onChange={(event) => setFromRevisionId(event.target.value)} value={fromRevisionId}>
            <option value="">Select base revision</option>
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                {revision.revisionLabel} - {revision.revisionStatus}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>To revision</span>
          <select onChange={(event) => setToRevisionId(event.target.value)} value={toRevisionId}>
            <option value="">Select target revision</option>
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                {revision.revisionLabel} - {revision.revisionStatus}
              </option>
            ))}
          </select>
        </label>
        <label className="revision-gate-panel__notes">
          <span>Notes</span>
          <input onChange={(event) => setNotes(event.target.value)} placeholder="Decision context" type="text" value={notes} />
        </label>
      </div>

      <div className="revision-gate-panel__actions">
        <button className="button-link button-link--quiet" disabled={loadState.kind === "loading"} onClick={() => void loadGates()} type="button">
          {loadState.kind === "loading" ? "Refreshing..." : "Refresh gates"}
        </button>
        <button className="button-link button-link--quiet" disabled={!canSubmit || submitState.kind === "submitting"} onClick={() => void submitGate("open")} type="button">
          Open pending gate
        </button>
        <button className="button-primary" disabled={!canSubmit || submitState.kind === "submitting"} onClick={() => void submitGate("approve")} type="button">
          {submitState.kind === "submitting" && submitState.decision === "approve" ? "Approving..." : "Approve diff"}
        </button>
        <button className="button-link button-link--quiet" disabled={!canSubmit || submitState.kind === "submitting"} onClick={() => void submitGate("request_changes")} type="button">
          Request changes
        </button>
      </div>

      {fromRevisionId === toRevisionId ? <p className="form-feedback form-feedback--failed">Choose two different revisions.</p> : null}
      {loadState.kind === "failed" ? <p className="form-feedback form-feedback--failed">{loadState.message}</p> : null}
      {submitState.kind === "failed" ? <p className="form-feedback form-feedback--failed">{submitState.message}</p> : null}
      {submitState.kind === "success" ? <ApprovalGateSubmitSummary response={submitState.response} /> : null}
      {boundary ? (
        <p className="approval-batch-panel__boundary">
          <strong>Boundary:</strong> {boundary}
        </p>
      ) : null}

      {gates.length === 0 ? (
        <EmptyState title="No revision gates yet" body="Recorded gates appear here after a revision diff is opened, approved, or sent back for changes." />
      ) : (
        <ApprovalGateTable gates={gates} revisionLabelById={revisionLabelById} />
      )}
    </div>
  );
}

/**
 * Renders the result of a submitted gate decision.
 */
function ApprovalGateSubmitSummary({ response }: { response: ProjectRevisionApprovalGateResponse }): React.ReactElement {
  const summary = response.gate.diffSummary;

  return (
    <div className="form-feedback form-feedback--success" role="status">
      <strong>Gate {response.gate.gateStatus.replace(/_/gu, " ")}.</strong>{" "}
      {summary.totalChangedCount} changed rows, {summary.unchangedCount} unchanged rows, fingerprint{" "}
      <code>{response.gate.diffFingerprint.slice(0, 12)}</code>.
    </div>
  );
}

/**
 * Renders saved gates with their current/stale state and compact diff counts.
 */
function ApprovalGateTable({
  gates,
  revisionLabelById
}: {
  gates: ProjectRevisionApprovalGate[];
  revisionLabelById: Map<string, string>;
}): React.ReactElement {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Gate</th>
            <th>Revisions</th>
            <th>Diff</th>
            <th>Fingerprint</th>
            <th>Decision</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {gates.map((gate) => (
            <ApprovalGateRow gate={gate} key={gate.id} revisionLabelById={revisionLabelById} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders one saved approval gate row.
 */
function ApprovalGateRow({
  gate,
  revisionLabelById
}: {
  gate: ProjectRevisionApprovalGate;
  revisionLabelById: Map<string, string>;
}): React.ReactElement {
  const summary = gate.diffSummary;
  const fromLabel = revisionLabelById.get(gate.fromRevisionId) ?? gate.fromRevisionId;
  const toLabel = revisionLabelById.get(gate.toRevisionId) ?? gate.toRevisionId;
  const actorLabel = formatGateActorLabel(gate);

  return (
    <tr>
      <td>
        <StatusBadge label={formatGateStatus(gate.gateStatus)} tone={gateStatusTone(gate.gateStatus)} />
        <div className="muted-copy">
          <StatusBadge label={gate.isCurrent ? "Current diff" : "Stale diff"} tone={gate.isCurrent ? "verified" : "review"} />
        </div>
      </td>
      <td>
        <span className="ui-mono">{fromLabel}</span> to <span className="ui-mono">{toLabel}</span>
      </td>
      <td>
        +{summary.addedCount} / -{summary.removedCount} / swaps {summary.mpnSwapCount} / qty {summary.quantityChangedCount} / refs {summary.designatorChangedCount}
      </td>
      <td className="ui-mono">{gate.diffFingerprint.slice(0, 12)}</td>
      <td>
        {actorLabel}
        <p className="muted-copy">{gate.decisionNotes || "No notes"}</p>
      </td>
      <td>{formatDateTime(gate.updatedAt)}</td>
    </tr>
  );
}

/**
 * Formats the human actor label without implying a pending gate has a final decision.
 */
function formatGateActorLabel(gate: ProjectRevisionApprovalGate): string {
  return gate.decidedBy ? `Decided by ${gate.decidedBy}` : `Opened by ${gate.createdBy}`;
}

/**
 * Builds a lookup table so persisted gate ids can display human revision labels.
 */
function buildRevisionLabelById(revisions: ProjectRevision[]): Map<string, string> {
  return new Map(revisions.map((revision) => [revision.id, revision.revisionLabel]));
}

/**
 * Formats gate status values for badges.
 */
function formatGateStatus(status: ProjectRevisionApprovalGateStatus): string {
  return {
    approved: "Approved",
    changes_requested: "Changes requested",
    pending_review: "Pending review"
  }[status];
}

/**
 * Maps gate status into the shared badge palette.
 */
function gateStatusTone(status: ProjectRevisionApprovalGateStatus): BadgeTone {
  if (status === "approved") {
    return "verified";
  }
  if (status === "changes_requested") {
    return "danger";
  }
  return "review";
}

/**
 * Resolves an API failure into compact operator-facing copy.
 */
function resolveGateFailure(error: unknown, action: "load" | "submit"): string {
  if (isApiClientError(error)) {
    return `${error.code}: ${error.message}`;
  }
  return action === "load" ? "Could not load revision approval gates." : "Could not update the revision approval gate.";
}

/**
 * Formats timestamps for the saved gate table.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
