/**
 * File header: Client-side follow-up queue controls for project and circuit block work records.
 */

"use client";

import React, { useCallback, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { isApiClientError, syncCircuitBlockFollowUps, syncProjectFollowUps, updateFollowUp } from "../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { FollowUpListResponse, FollowUpRecord, FollowUpStatus, FollowUpTargetType } from "@ee-library/shared/types";

/** FollowUpPanelProps scopes follow-up queue behavior to one target. */
export interface FollowUpPanelProps {
  followUps: FollowUpListResponse;
  targetId: string;
  targetType: FollowUpTargetType;
}

/** FollowUpSaveState tracks sync and row-save feedback. */
type FollowUpSaveState =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "saving"; rowId: string }
  | { kind: "success"; message: string; rowId?: string }
  | { kind: "failed"; message: string; rowId?: string };

/**
 * Renders a follow-up queue with sync and workflow edit actions.
 */
export function FollowUpPanel({ followUps, targetId, targetType }: FollowUpPanelProps): React.ReactElement {
  const [saveState, setSaveState] = useState<FollowUpSaveState>({ kind: "idle" });

  /**
   * Refreshes follow-up records from current computed source gaps.
   */
  const syncFollowUps = useCallback(async () => {
    setSaveState({ kind: "syncing" });

    try {
      const response = targetType === "project" ? await syncProjectFollowUps(targetId) : await syncCircuitBlockFollowUps(targetId);
      setSaveState({ kind: "success", message: `${response.createdCount} created, ${response.refreshedCount} refreshed. ${response.boundary}` });
      refreshFollowUps();
    } catch (error) {
      setSaveState({ kind: "failed", message: resolveFollowUpFailure(error, "sync") });
    }
  }, [targetId, targetType]);

  /**
   * Saves one follow-up workflow row from form values.
   */
  const saveFollowUp = useCallback(async (followUp: FollowUpRecord, formData: FormData) => {
    const status = readFollowUpStatus(String(formData.get("status") ?? followUp.status));
    const assignedTo = String(formData.get("assignedTo") ?? "").trim() || null;
    const resolutionNotes = String(formData.get("resolutionNotes") ?? "").trim() || null;
    const evidenceAttachmentIds = parseEvidenceAttachmentIds(String(formData.get("evidenceAttachmentIds") ?? ""));

    setSaveState({ kind: "saving", rowId: followUp.id });

    try {
      const response = await updateFollowUp(followUp.id, {
        assignedTo,
        evidenceAttachmentIds,
        resolutionNotes,
        status
      });

      setSaveState({ kind: "success", message: response.boundary, rowId: followUp.id });
      refreshFollowUps();
    } catch (error) {
      setSaveState({ kind: "failed", message: resolveFollowUpFailure(error, "update"), rowId: followUp.id });
    }
  }, []);

  return (
    <div className="follow-up-panel">
      <div className="follow-up-panel__toolbar">
        <button className="button-primary" disabled={saveState.kind === "syncing"} onClick={() => void syncFollowUps()} type="button">
          {saveState.kind === "syncing" ? "Refreshing..." : "Refresh from computed gaps"}
        </button>
        <FollowUpSummary followUps={followUps} />
      </div>
      {saveState.kind === "success" && !saveState.rowId ? <p className="follow-up-panel__status">{saveState.message}</p> : null}
      {saveState.kind === "failed" && !saveState.rowId ? <p className="follow-up-panel__status follow-up-panel__status--failed">{saveState.message}</p> : null}
      {followUps.followUps.length > 0 ? (
        <div className="projects-table-wrap">
          <table className="projects-table follow-up-table">
            <thead>
              <tr>
                <th>Work</th>
                <th>Source</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Evidence</th>
                <th>Resolution</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {followUps.followUps.map((followUp) => (
                <FollowUpRow followUp={followUp} key={followUp.id} saveFollowUp={saveFollowUp} saveState={saveState} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No follow-ups yet" body="Refresh from computed gaps to create assignable work from current BOM health or circuit readiness inputs." />
      )}
    </div>
  );
}

/**
 * Renders compact queue counts without collapsing them into a score.
 */
function FollowUpSummary({ followUps }: { followUps: FollowUpListResponse }): React.ReactElement {
  return (
    <div className="follow-up-panel__summary" aria-label="Follow-up summary">
      <span>{followUps.summary.openCount} open</span>
      <span>{followUps.summary.inProgressCount} in progress</span>
      <span>{followUps.summary.resolvedCount} resolved</span>
      <span>{followUps.summary.dangerCount} danger</span>
    </div>
  );
}

/** FollowUpRowProps carries one work item and shared save behavior. */
interface FollowUpRowProps {
  followUp: FollowUpRecord;
  saveFollowUp: (followUp: FollowUpRecord, formData: FormData) => Promise<void>;
  saveState: FollowUpSaveState;
}

/**
 * Renders one editable follow-up row while keeping source inputs visible.
 */
function FollowUpRow({ followUp, saveFollowUp, saveState }: FollowUpRowProps): React.ReactElement {
  const isSaving = saveState.kind === "saving" && saveState.rowId === followUp.id;
  const rowMessage = (saveState.kind === "success" || saveState.kind === "failed") && saveState.rowId === followUp.id ? saveState.message : null;

  return (
    <tr>
      <td>
        <strong>{followUp.title}</strong>
        <p>{followUp.detail}</p>
        <p><strong>Next:</strong> {followUp.nextAction}</p>
      </td>
      <td>
        <StatusBadge label={followUp.severity} tone={followUp.severity === "danger" ? "danger" : "review"} />
        <div className="ui-mono">{followUp.sourceFindingId}</div>
        {followUp.sourceInputs.length > 0 ? (
          <ul>
            {followUp.sourceInputs.slice(0, 3).map((input) => (
              <li key={input}>{input}</li>
            ))}
          </ul>
        ) : null}
      </td>
      <td>
        <StatusBadge label={formatFollowUpStatus(followUp.status)} tone={followUpStatusTone(followUp.status)} />
        <select aria-label={`${followUp.title} status`} defaultValue={followUp.status} form={`follow-up-form-${followUp.id}`} name="status">
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </td>
      <td>
        <input aria-label={`${followUp.title} assignee`} defaultValue={followUp.assignedTo ?? ""} form={`follow-up-form-${followUp.id}`} name="assignedTo" placeholder="Owner" />
      </td>
      <td>
        <textarea aria-label={`${followUp.title} evidence ids`} defaultValue={followUp.evidenceAttachmentIds.join(", ")} form={`follow-up-form-${followUp.id}`} name="evidenceAttachmentIds" placeholder="evidence-..." />
      </td>
      <td>
        <textarea aria-label={`${followUp.title} resolution notes`} defaultValue={followUp.resolutionNotes ?? ""} form={`follow-up-form-${followUp.id}`} name="resolutionNotes" placeholder="Resolution notes" />
      </td>
      <td>
        <form
          id={`follow-up-form-${followUp.id}`}
          onSubmit={(event) => {
            event.preventDefault();
            void saveFollowUp(followUp, new FormData(event.currentTarget));
          }}
        >
          <button disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save"}</button>
        </form>
        {rowMessage ? <p className={saveState.kind === "failed" ? "follow-up-panel__status follow-up-panel__status--failed" : "follow-up-panel__status"}>{rowMessage}</p> : null}
      </td>
    </tr>
  );
}

/**
 * Parses comma or newline separated evidence ids from a row form.
 */
function parseEvidenceAttachmentIds(value: string): string[] {
  return value.split(/[,\n]/u).map((item) => item.trim()).filter(Boolean);
}

/**
 * Reads status form values without trusting arbitrary DOM text.
 */
function readFollowUpStatus(value: string): FollowUpStatus {
  if (value === "in_progress" || value === "resolved" || value === "dismissed") {
    return value;
  }

  return "open";
}

/**
 * Formats follow-up workflow states.
 */
function formatFollowUpStatus(status: FollowUpStatus): string {
  return {
    dismissed: "Dismissed",
    in_progress: "In progress",
    open: "Open",
    resolved: "Resolved"
  }[status];
}

/**
 * Maps follow-up workflow states into badge tones.
 */
function followUpStatusTone(status: FollowUpStatus): BadgeTone {
  if (status === "resolved") {
    return "verified";
  }

  if (status === "dismissed") {
    return "neutral";
  }

  return "review";
}

/**
 * Converts API failures into concise follow-up workflow copy.
 */
function resolveFollowUpFailure(error: unknown, action: "sync" | "update"): string {
  if (!isApiClientError(error)) {
    return `Follow-up ${action} failed. Check the queue and try again.`;
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Follow-up workflow changes require an admin session.";
  }

  return error.message.replace(/^.* failed \([^)]+\):\s*/u, "");
}

/**
 * Refreshes the current detail page after follow-up changes.
 */
function refreshFollowUps(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
