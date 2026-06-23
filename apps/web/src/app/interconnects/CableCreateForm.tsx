"use client";

/**
 * File header: Client form for authoring a new cable assembly header.
 *
 * Honesty boundary: creating a cable records engineering memory. It never approves a part,
 * validates an asset, proves a bench setup is safe, or unlocks export — the form repeats this.
 */

import React, { useState } from "react";
import { createCableAssembly, isApiClientError } from "../../lib/api-client";
import type { InterconnectRecordStatus } from "@ee-library/shared/types";

/** CableProjectOption is one selectable project for the optional project link. */
export interface CableProjectOption {
  id: string;
  label: string;
}

/** CableCreateFormProps seeds the optional project picker. */
export interface CableCreateFormProps {
  projectOptions: CableProjectOption[];
}

/** STATUS_OPTIONS lists the cable statuses with plain labels. */
const STATUS_OPTIONS: { value: InterconnectRecordStatus; label: string }[] = [
  { label: "Draft", value: "draft" },
  { label: "In review", value: "in_review" },
  { label: "Approved", value: "approved" },
  { label: "Restricted", value: "restricted" },
  { label: "Retired", value: "retired" }
];

/** CableCreateFormStatus tracks save feedback. */
type CableCreateFormStatus = { kind: "idle" } | { kind: "saving" } | { kind: "failed"; message: string };

/** Renders the new-cable header form and redirects to the cable's detail page on success. */
export function CableCreateForm({ projectOptions }: CableCreateFormProps): React.ReactElement {
  const [status, setStatus] = useState<CableCreateFormStatus>({ kind: "idle" });
  const [cableKey, setCableKey] = useState("");
  const [revisionLabel, setRevisionLabel] = useState("Working");
  const [assemblyStatus, setAssemblyStatus] = useState<InterconnectRecordStatus>("draft");
  const [owner, setOwner] = useState("");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [sourceDocumentRef, setSourceDocumentRef] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!cableKey.trim()) {
      setStatus({ kind: "failed", message: "A cable needs a cable ID (for example CAB-100)." });
      return;
    }

    setStatus({ kind: "saving" });
    try {
      const detail = await createCableAssembly({
        assemblyStatus,
        cableKey: cableKey.trim(),
        description: description.trim() || null,
        owner: owner.trim() || null,
        projectId: projectId || null,
        revisionLabel: revisionLabel.trim() || "Working",
        sourceDocumentRef: sourceDocumentRef.trim() || null
      });
      window.location.assign(`/interconnects/cables/${encodeURIComponent(detail.cable.id)}`);
    } catch (error) {
      setStatus({ kind: "failed", message: describeCableError(error) });
    }
  }

  return (
    <form className="cable-form" onSubmit={onSubmit}>
      <p className="cable-form__boundary">
        <strong>Engineering memory only.</strong> Recording a cable does not approve a part, validate a file, prove a bench setup is safe, or make anything export-ready.
      </p>

      <div className="cable-form__grid">
        <label className="cable-form__field">
          <span>Cable ID</span>
          <input autoComplete="off" onChange={(event) => setCableKey(event.target.value)} placeholder="CAB-100" value={cableKey} />
        </label>
        <label className="cable-form__field">
          <span>Revision</span>
          <input autoComplete="off" onChange={(event) => setRevisionLabel(event.target.value)} placeholder="Working" value={revisionLabel} />
        </label>
        <label className="cable-form__field">
          <span>Status</span>
          <select onChange={(event) => setAssemblyStatus(event.target.value as InterconnectRecordStatus)} value={assemblyStatus}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="cable-form__field">
          <span>Owner (optional)</span>
          <input autoComplete="off" onChange={(event) => setOwner(event.target.value)} placeholder="Who owns this cable" value={owner} />
        </label>
        <label className="cable-form__field">
          <span>Project (optional)</span>
          <select onChange={(event) => setProjectId(event.target.value)} value={projectId}>
            <option value="">No project</option>
            {projectOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="cable-form__field">
          <span>Source document (optional)</span>
          <input autoComplete="off" onChange={(event) => setSourceDocumentRef(event.target.value)} placeholder="CAB-100-RevD.xlsx" value={sourceDocumentRef} />
        </label>
        <label className="cable-form__field cable-form__field--wide">
          <span>Description (optional)</span>
          <textarea onChange={(event) => setDescription(event.target.value)} placeholder="What this cable is for" rows={2} value={description} />
        </label>
      </div>

      {status.kind === "failed" ? <p className="cable-form__error" role="alert">{status.message}</p> : null}

      <div className="cable-form__actions">
        <button className="button-primary" disabled={status.kind === "saving"} type="submit">
          {status.kind === "saving" ? "Creating…" : "Create cable"}
        </button>
      </div>
    </form>
  );
}

/** Turns an API client error into plain operator copy. */
function describeCableError(error: unknown): string {
  if (isApiClientError(error)) {
    return error.message;
  }
  return "The cable could not be saved. Check your connection and try again.";
}
