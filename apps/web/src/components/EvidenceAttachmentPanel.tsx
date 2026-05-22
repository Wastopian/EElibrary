/**
 * File header: Client-side evidence metadata capture for project-memory decision provenance.
 */

"use client";

import React, { useCallback, useState } from "react";
import { createEvidenceAttachment, isApiClientError, uploadEvidenceAttachmentFile } from "../lib/api-client";
import { FileUploadField } from "./FileUploadField";
import type { EvidenceAttachmentCreateResponse, EvidenceTargetType } from "@ee-library/shared/types";

/** EvidenceAttachmentPanelProps scopes the simple first-pass form to one evidence target. */
export interface EvidenceAttachmentPanelProps {
  submitLabel: string;
  targetId: string;
  targetType: EvidenceTargetType;
}

/** EvidenceAttachmentStatus tracks metadata creation feedback without implying review acceptance. */
type EvidenceAttachmentStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; response: EvidenceAttachmentCreateResponse }
  | { kind: "failed"; message: string };

/**
 * Renders metadata-only evidence capture for links and notes.
 */
export function EvidenceAttachmentPanel({ submitLabel, targetId, targetType }: EvidenceAttachmentPanelProps): React.ReactElement {
  const [evidenceType, setEvidenceType] = useState<"link" | "note" | "file">("link");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<EvidenceAttachmentStatus>({ kind: "idle" });
  const canSubmit = title.trim().length > 0 && (evidenceType === "link" ? sourceUrl.trim().length > 0 : evidenceType === "file" ? Boolean(file) : notes.trim().length > 0);

  /**
   * Persists project-level evidence metadata while keeping review status unreviewed.
   */
  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!canSubmit) {
        setStatus({ kind: "failed", message: "Evidence needs a title and either a link URL or note body." });
        return;
      }

      setStatus({ kind: "saving" });

      try {
        const response = evidenceType === "file" && file
          ? await uploadEvidenceAttachmentFile({
              contentBase64: await readFileAsBase64(file),
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              notes: notes.trim() || null,
              provenance: "manual_internal",
              reviewStatus: "unreviewed",
              targetId,
              targetType,
              title: title.trim()
            })
          : await createEvidenceAttachment({
              evidenceType,
              notes: evidenceType === "note" ? notes.trim() : null,
              provenance: "manual_internal",
              reviewStatus: "unreviewed",
              sourceUrl: evidenceType === "link" ? sourceUrl.trim() : null,
              targetId,
              targetType,
              title: title.trim()
            });

        setStatus({ kind: "success", response });
        refreshProjectDetail();
      } catch (error) {
        setStatus({ kind: "failed", message: resolveEvidenceFailure(error) });
      }
    },
    [canSubmit, evidenceType, file, notes, sourceUrl, targetId, targetType, title]
  );

  return (
    <div className="evidence-attachment-panel">
      <form className="evidence-attachment-panel__form" onSubmit={onSubmit}>
        <label>
          <span>Evidence type</span>
          <select onChange={(event) => setEvidenceType(readEvidenceType(event.target.value))} value={evidenceType}>
            <option value="link">Link</option>
            <option value="note">Note</option>
            <option value="file">File</option>
          </select>
        </label>
        <label>
          <span>Title</span>
          <input onChange={(event) => setTitle(event.target.value)} placeholder="Design review note" value={title} />
        </label>
        {evidenceType === "link" ? (
          <label>
            <span>Source URL</span>
            <input onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://..." type="url" value={sourceUrl} />
          </label>
        ) : evidenceType === "file" ? (
          <FileUploadField
            caption="Evidence file"
            onFileChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        ) : (
          <label>
            <span>Evidence note</span>
            <textarea onChange={(event) => setNotes(event.target.value)} placeholder="What decision or review does this preserve?" value={notes} />
          </label>
        )}
        <button disabled={!canSubmit || status.kind === "saving"} type="submit">
          {status.kind === "saving" ? "Saving evidence..." : submitLabel}
        </button>
      </form>
      <EvidenceAttachmentStatusMessage status={status} />
    </div>
  );
}

/**
 * Reads the selected evidence type without trusting raw DOM values.
 */
function readEvidenceType(value: string): "link" | "note" | "file" {
  if (value === "note" || value === "file") {
    return value;
  }

  return "link";
}

/**
 * Reads a selected evidence file as base64 for the API's JSON upload boundary.
 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Evidence file read failed.")));
    reader.readAsDataURL(file);
  });
}

/**
 * Renders persistence feedback without saying evidence has been accepted or verified.
 */
function EvidenceAttachmentStatusMessage({ status }: { status: EvidenceAttachmentStatus }) {
  if (status.kind === "success") {
    return <p className="evidence-attachment-panel__status">Saved evidence metadata as unreviewed provenance. {status.response.boundary}</p>;
  }

  if (status.kind === "failed") {
    return <p className="evidence-attachment-panel__status evidence-attachment-panel__status--failed">{status.message}</p>;
  }

  return null;
}

/**
 * Converts API errors into concise evidence-specific copy.
 */
function resolveEvidenceFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Evidence attachment failed. Check the metadata and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Evidence attachment requires an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "Evidence attachment requires the project-memory database.";
  }

  return error.message.replace(/^Evidence attachment create failed \([^)]+\):\s*/u, "");
}

/**
 * Refreshes the project detail route after evidence is saved.
 */
function refreshProjectDetail(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
