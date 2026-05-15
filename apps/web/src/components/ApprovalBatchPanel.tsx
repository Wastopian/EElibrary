/**
 * File header: Client-side approval batch controls for project BOM context.
 */

"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { applyApprovalBatch, fetchApprovalBatchCandidates, isApiClientError } from "../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { ApprovalBatchAction, ApprovalBatchCandidate, ApprovalBatchCandidatesResponse, ApprovalBatchOutcome, ApprovalBatchResponse } from "@ee-library/shared/types";

/** ApprovalBatchPanelProps wires the panel to one project's approval queue. */
export interface ApprovalBatchPanelProps {
  projectId: string;
}

/** ApprovalBatchPanelState tracks loading, ready, and failure modes. */
type ApprovalBatchPanelState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; response: ApprovalBatchCandidatesResponse }
  | { kind: "failed"; message: string };

/** ApprovalBatchSubmitState tracks the bulk action button's progress. */
type ApprovalBatchSubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; mpnByPartId: Record<string, string>; response: ApprovalBatchResponse }
  | { kind: "failed"; message: string };

/**
 * Renders an approval-gap queue for one project with bulk approve / flag-for-review actions.
 */
export function ApprovalBatchPanel({ projectId }: ApprovalBatchPanelProps): React.ReactElement {
  const router = useRouter();
  const [state, setState] = useState<ApprovalBatchPanelState>({ kind: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<ApprovalBatchAction>("approve");
  const [notes, setNotes] = useState("");
  const [submit, setSubmit] = useState<ApprovalBatchSubmitState>({ kind: "idle" });

  /**
   * Loads the current candidate queue from the project API.
   *
   * Selection starts empty so a stray click on the bulk-action button cannot approve every visible
   * row by accident. Operators use Select all / per-row checkboxes to opt in.
   */
  const loadCandidates = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetchApprovalBatchCandidates(projectId);
      setState({ kind: "ready", response });
      setSelected(new Set());
    } catch (error) {
      setState({ kind: "failed", message: resolveBatchFailure(error, "load") });
    }
  }, [projectId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  /**
   * Toggles a part id in the selection set.
   */
  const toggleSelected = useCallback((partId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(partId)) {
        next.delete(partId);
      } else {
        next.add(partId);
      }
      return next;
    });
  }, []);

  /**
   * Selects every visible candidate.
   */
  const selectAll = useCallback(() => {
    if (state.kind !== "ready") return;
    setSelected(new Set(state.response.candidates.map((candidate) => candidate.partId)));
  }, [state]);

  /**
   * Clears the selection set.
   */
  const clearAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  /**
   * Submits the selected part ids with the chosen action.
   */
  const submitBatch = useCallback(async () => {
    if (state.kind !== "ready") return;
    if (selected.size === 0) return;

    setSubmit({ kind: "submitting" });
    try {
      const partIds = Array.from(selected);
      // Snapshot the MPN map before refreshing -- once approved, those candidates leave the queue
      // and the post-submit summary would otherwise have nothing but raw UUIDs to render.
      const mpnByPartId = Object.fromEntries(
        state.response.candidates.map((candidate) => [candidate.partId, candidate.mpn])
      );
      const response = await applyApprovalBatch(projectId, {
        action,
        notes: notes.trim().length > 0 ? notes.trim() : null,
        partIds
      });
      setSubmit({ kind: "success", mpnByPartId, response });
      await loadCandidates();
      router.refresh();
    } catch (error) {
      setSubmit({ kind: "failed", message: resolveBatchFailure(error, "submit") });
    }
  }, [projectId, action, notes, selected, state, loadCandidates, router]);

  return (
    <div className="approval-batch-panel">
      <div className="follow-up-panel__toolbar">
        <button className="button-primary" disabled={state.kind === "loading"} onClick={() => void loadCandidates()} type="button">
          {state.kind === "loading" ? "Loading..." : "Refresh approval candidates"}
        </button>
        {state.kind === "ready" ? (
          <span className="muted-copy">{state.response.candidates.length} candidates · {selected.size} selected</span>
        ) : null}
      </div>

      {state.kind === "failed" ? <p className="form-feedback form-feedback--failed">{state.message}</p> : null}

      {state.kind === "ready" && state.response.candidates.length === 0 ? (
        <EmptyState title="No approval gaps in this project" body="Every confirmed-usage part already has an approved record. Run BOM matching first if you expected more rows." />
      ) : null}

      {state.kind === "ready" && state.response.candidates.length > 0 ? (
        <>
          <div className="approval-batch-panel__controls">
            <button className="button-link" onClick={selectAll} type="button">Select all</button>
            <button className="button-link" onClick={clearAll} type="button">Clear selection</button>
            <label>
              <span>Action</span>
              <select onChange={(event) => setAction(event.target.value as ApprovalBatchAction)} value={action}>
                <option value="approve">Approve</option>
                <option value="flag_for_review">Flag for review</option>
              </select>
            </label>
            <label className="approval-batch-panel__notes">
              <span>Notes (optional)</span>
              <input onChange={(event) => setNotes(event.target.value)} placeholder="Project context for this batch" type="text" value={notes} />
            </label>
            <button className="button-primary" disabled={submit.kind === "submitting" || selected.size === 0} onClick={() => void submitBatch()} type="button">
              {submit.kind === "submitting" ? "Applying..." : `${action === "approve" ? "Approve" : "Flag"} ${selected.size} part${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>

          {submit.kind === "success" ? (
            <ApprovalBatchSubmitSummary mpnByPartId={submit.mpnByPartId} response={submit.response} />
          ) : null}
          {submit.kind === "failed" ? <p className="form-feedback form-feedback--failed">{submit.message}</p> : null}

          <p className="approval-batch-panel__boundary">
            <strong>Boundary:</strong> {state.response.boundary}
          </p>

          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Part</th>
                  <th>Approval</th>
                  <th>Lifecycle</th>
                  <th>Readiness</th>
                  <th>BOM rows</th>
                  <th>Designators</th>
                </tr>
              </thead>
              <tbody>
                {state.response.candidates.map((candidate) => (
                  <ApprovalBatchRow candidate={candidate} key={candidate.partId} onToggle={toggleSelected} selected={selected.has(candidate.partId)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Renders one approval candidate row with a checkbox and trace-back context.
 */
function ApprovalBatchRow({ candidate, onToggle, selected }: { candidate: ApprovalBatchCandidate; onToggle: (partId: string) => void; selected: boolean }): React.ReactElement {
  const designatorPreview = candidate.designators.length > 0 ? candidate.designators.slice(0, 8).join(", ") : "n/a";
  const designatorOverflow = candidate.designators.length > 8 ? `, +${candidate.designators.length - 8} more` : "";

  return (
    <tr>
      <td>
        <input aria-label={`Select ${candidate.mpn}`} checked={selected} onChange={() => onToggle(candidate.partId)} type="checkbox" />
      </td>
      <td>
        <a className="ui-mono" href={`/parts/${encodeURIComponent(candidate.partId)}`}>{candidate.mpn}</a>
        <p className="muted-copy">{candidate.manufacturerName}</p>
      </td>
      <td>
        <StatusBadge label={candidate.approvalStatus ?? "missing"} tone={approvalTone(candidate.approvalStatus)} />
      </td>
      <td>{candidate.lifecycleStatus ?? "unknown"}</td>
      <td>{candidate.readinessStatus ?? "unknown"}</td>
      <td>{candidate.bomLineCount}</td>
      <td className="muted-copy">{designatorPreview}{designatorOverflow}</td>
    </tr>
  );
}

/**
 * Renders the summary of a successful batch submission.
 *
 * `mpnByPartId` is the pre-submit snapshot of the queue. The approved/flagged candidates have
 * already left the live queue by the time this renders, so the snapshot is the only way to label
 * outcomes with an MPN an engineer would recognize.
 */
function ApprovalBatchSubmitSummary({
  mpnByPartId,
  response
}: {
  mpnByPartId: Record<string, string>;
  response: ApprovalBatchResponse;
}): React.ReactElement {
  return (
    <div className="form-feedback form-feedback--success" role="status">
      <strong>Action: {response.action.replace(/_/gu, " ")}.</strong>
      {" "}Applied {response.appliedCount}, skipped {response.skippedCount}, not found {response.notFoundCount}.
      <details>
        <summary>Per-part outcomes</summary>
        <ul>
          {response.outcomes.map((outcome) => {
            const mpn = mpnByPartId[outcome.partId];
            return (
              <li key={outcome.partId}>
                {mpn ? <strong className="ui-mono">{mpn}</strong> : <code className="ui-mono">{outcome.partId}</code>}
                : {outcome.status.replace(/_/gu, " ")} — {outcome.message}
                {outcome.previousApprovalStatus ? ` (was ${outcome.previousApprovalStatus})` : ""}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}

/**
 * Maps an approval status to a badge tone for compact rendering.
 */
function approvalTone(status: ApprovalBatchCandidate["approvalStatus"]): BadgeTone {
  if (status === "approved") return "verified";
  if (status === "pending_review") return "review";
  return "neutral";
}

/**
 * Resolves an error from an API call into an operator-friendly message.
 */
function resolveBatchFailure(error: unknown, action: "load" | "submit"): string {
  if (isApiClientError(error)) {
    return `${error.code}: ${error.message}`;
  }
  return action === "load"
    ? "Could not load approval candidates."
    : "Could not apply approval batch.";
}

// Export an alias for downstream test fixtures that expect this name.
export type { ApprovalBatchOutcome };
