/**
 * File header: Client-side evidence vault review table for provenance workflow edits.
 */

"use client";

import React, { useCallback, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import { isApiClientError, updateEvidenceAttachment } from "../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { EvidenceAttachment, EvidenceReviewStatus } from "@ee-library/shared/types";

/** EvidenceVaultReviewTableProps carries visible evidence rows from the vault filters. */
export interface EvidenceVaultReviewTableProps {
  attachments: EvidenceAttachment[];
}

/** EvidenceReviewSaveState tracks row-level save feedback. */
type EvidenceReviewSaveState =
  | { kind: "idle" }
  | { kind: "saving"; rowId: string }
  | { kind: "success"; message: string; rowId: string }
  | { kind: "failed"; message: string; rowId: string };

/**
 * Renders editable review metadata for evidence rows without changing target trust state.
 */
export function EvidenceVaultReviewTable({ attachments }: EvidenceVaultReviewTableProps): React.ReactElement {
  const [saveState, setSaveState] = useState<EvidenceReviewSaveState>({ kind: "idle" });

  /**
   * Saves one evidence review row from its form values.
   */
  const saveReview = useCallback(async (attachment: EvidenceAttachment, formData: FormData) => {
    const reviewStatus = readEvidenceReviewStatus(String(formData.get("reviewStatus") ?? attachment.reviewStatus));
    const notes = String(formData.get("notes") ?? "").trim() || null;

    setSaveState({ kind: "saving", rowId: attachment.id });

    try {
      const response = await updateEvidenceAttachment(attachment.id, {
        notes,
        reviewStatus
      });

      setSaveState({ kind: "success", message: response.boundary, rowId: attachment.id });
      refreshEvidenceVault();
    } catch (error) {
      setSaveState({ kind: "failed", message: resolveEvidenceReviewFailure(error), rowId: attachment.id });
    }
  }, []);

  return (
    <div className="projects-table-wrap">
      <table className="projects-table evidence-vault-table">
        <thead>
          <tr>
            <th>Evidence</th>
            <th>Target</th>
            <th>Storage</th>
            <th>Review</th>
            <th>Notes</th>
            <th>Save</th>
          </tr>
        </thead>
        <tbody>
          {attachments.map((attachment) => (
            <EvidenceVaultReviewRow attachment={attachment} key={attachment.id} saveReview={saveReview} saveState={saveState} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** EvidenceVaultReviewRowProps carries one evidence row and shared save behavior. */
interface EvidenceVaultReviewRowProps {
  attachment: EvidenceAttachment;
  saveReview: (attachment: EvidenceAttachment, formData: FormData) => Promise<void>;
  saveState: EvidenceReviewSaveState;
}

/**
 * Renders one evidence row with review controls and provenance references.
 */
function EvidenceVaultReviewRow({ attachment, saveReview, saveState }: EvidenceVaultReviewRowProps): React.ReactElement {
  const isSaving = saveState.kind === "saving" && saveState.rowId === attachment.id;
  const rowMessage = (saveState.kind === "success" || saveState.kind === "failed") && saveState.rowId === attachment.id ? saveState.message : null;

  return (
    <tr>
      <td>
        <strong>{attachment.title}</strong>
        <div className="muted-copy">{attachment.provenance}</div>
      </td>
      <td>
        <span>{formatEvidenceTargetType(attachment.targetType)}</span>
        <div className="ui-mono">{attachment.targetId}</div>
      </td>
      <td>{renderEvidenceReference(attachment)}</td>
      <td>
        <StatusBadge label={formatEvidenceReviewStatus(attachment.reviewStatus)} tone={evidenceReviewTone(attachment.reviewStatus)} />
        <select aria-label={`${attachment.title} review status`} defaultValue={attachment.reviewStatus} form={`evidence-review-form-${attachment.id}`} name="reviewStatus">
          <option value="unreviewed">Unreviewed</option>
          <option value="accepted">Accepted evidence</option>
          <option value="rejected">Rejected evidence</option>
          <option value="superseded">Superseded</option>
        </select>
      </td>
      <td>
        <textarea aria-label={`${attachment.title} notes`} defaultValue={attachment.notes ?? ""} form={`evidence-review-form-${attachment.id}`} name="notes" placeholder="Review notes" />
      </td>
      <td>
        <form
          id={`evidence-review-form-${attachment.id}`}
          onSubmit={(event) => {
            event.preventDefault();
            void saveReview(attachment, new FormData(event.currentTarget));
          }}
        >
          <button disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save"}</button>
        </form>
        {rowMessage ? <p className={saveState.kind === "failed" ? "evidence-vault-table__status evidence-vault-table__status--failed" : "evidence-vault-table__status"}>{rowMessage}</p> : null}
      </td>
    </tr>
  );
}

/**
 * Reads review status form values without trusting arbitrary DOM text.
 */
function readEvidenceReviewStatus(value: string): EvidenceReviewStatus {
  if (value === "accepted" || value === "rejected" || value === "superseded") {
    return value;
  }

  return "unreviewed";
}

/**
 * Formats evidence target types for compact vault rows.
 */
function formatEvidenceTargetType(targetType: EvidenceAttachment["targetType"]): string {
  return {
    asset: "Asset",
    bom_import: "BOM import",
    bom_line: "BOM line",
    circuit_block: "Circuit block",
    circuit_block_part: "Circuit block part",
    part: "Part",
    project: "Project",
    project_part_usage: "Project usage",
    risk_finding: "Risk finding"
  }[targetType];
}

/**
 * Formats evidence review state without implying accepted evidence is validation.
 */
function formatEvidenceReviewStatus(reviewStatus: EvidenceReviewStatus): string {
  return {
    accepted: "Accepted evidence",
    rejected: "Rejected evidence",
    superseded: "Superseded",
    unreviewed: "Unreviewed"
  }[reviewStatus];
}

/**
 * Maps evidence review state into badge tones.
 */
function evidenceReviewTone(reviewStatus: EvidenceReviewStatus): BadgeTone {
  if (reviewStatus === "accepted") {
    return "verified";
  }

  if (reviewStatus === "rejected") {
    return "danger";
  }

  return "review";
}

/**
 * Renders the most concrete evidence pointer available in the row.
 */
function renderEvidenceReference(attachment: EvidenceAttachment): React.ReactNode {
  if (attachment.storageKey) {
    return (
      <span>
        File-backed
        <div className="ui-mono">{attachment.storageKey}</div>
      </span>
    );
  }

  if (attachment.sourceUrl) {
    return <a href={attachment.sourceUrl}>Open link</a>;
  }

  return <span>{attachment.evidenceType}</span>;
}

/**
 * Converts API failures into concise evidence review copy.
 */
function resolveEvidenceReviewFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Evidence review update failed. Check the row and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Evidence review requires an admin session.";
  }

  return error.message.replace(/^Evidence attachment update failed \([^)]+\):\s*/u, "");
}

/**
 * Refreshes the vault after saving review metadata.
 */
function refreshEvidenceVault(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
