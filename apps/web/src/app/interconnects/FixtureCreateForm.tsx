"use client";

/**
 * File header: Client form for authoring a new test fixture header.
 *
 * Honesty boundary: creating a fixture records engineering memory. It never approves a part,
 * validates an asset, proves a bench setup is safe, or unlocks export — the form repeats this.
 */

import React, { useState } from "react";
import { createTestFixture, isApiClientError } from "../../lib/api-client";
import type { CableProjectOption } from "./CableCreateForm";
import type { InterconnectRecordStatus } from "@ee-library/shared/types";

/** FixtureCreateFormProps seeds the optional project picker. */
export interface FixtureCreateFormProps {
  projectOptions: CableProjectOption[];
}

/** STATUS_OPTIONS lists the fixture statuses with plain labels. */
const STATUS_OPTIONS: { value: InterconnectRecordStatus; label: string }[] = [
  { label: "Draft", value: "draft" },
  { label: "In review", value: "in_review" },
  { label: "Approved", value: "approved" },
  { label: "Restricted", value: "restricted" },
  { label: "Retired", value: "retired" }
];

/** FixtureCreateFormStatus tracks save feedback. */
type FixtureCreateFormStatus = { kind: "idle" } | { kind: "saving" } | { kind: "failed"; message: string };

/** Renders the new-fixture header form and redirects to the fixture's detail page on success. */
export function FixtureCreateForm({ projectOptions }: FixtureCreateFormProps): React.ReactElement {
  const [status, setStatus] = useState<FixtureCreateFormStatus>({ kind: "idle" });
  const [fixtureKey, setFixtureKey] = useState("");
  const [revisionLabel, setRevisionLabel] = useState("Working");
  const [fixtureStatus, setFixtureStatus] = useState<InterconnectRecordStatus>("draft");
  const [owner, setOwner] = useState("");
  const [projectId, setProjectId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [sourceDocumentRef, setSourceDocumentRef] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!fixtureKey.trim()) {
      setStatus({ kind: "failed", message: "A fixture needs a fixture ID (for example TFX-42)." });
      return;
    }

    setStatus({ kind: "saving" });
    try {
      const detail = await createTestFixture({
        fixtureKey: fixtureKey.trim(),
        fixtureStatus,
        owner: owner.trim() || null,
        projectId: projectId || null,
        purpose: purpose.trim() || null,
        revisionLabel: revisionLabel.trim() || "Working",
        sourceDocumentRef: sourceDocumentRef.trim() || null
      });
      window.location.assign(`/interconnects/fixtures/${encodeURIComponent(detail.fixture.id)}`);
    } catch (error) {
      setStatus({ kind: "failed", message: isApiClientError(error) ? error.message : "The fixture could not be saved. Check your connection and try again." });
    }
  }

  return (
    <form className="cable-form" onSubmit={onSubmit}>
      <p className="cable-form__boundary">
        <strong>Engineering memory only.</strong> Recording a fixture does not approve a part, validate a file, prove a bench setup is safe, or make anything export-ready.
      </p>

      <div className="cable-form__grid">
        <label className="cable-form__field">
          <span>Fixture ID</span>
          <input autoComplete="off" onChange={(event) => setFixtureKey(event.target.value)} placeholder="TFX-42" value={fixtureKey} />
        </label>
        <label className="cable-form__field">
          <span>Revision</span>
          <input autoComplete="off" onChange={(event) => setRevisionLabel(event.target.value)} placeholder="Working" value={revisionLabel} />
        </label>
        <label className="cable-form__field">
          <span>Status</span>
          <select onChange={(event) => setFixtureStatus(event.target.value as InterconnectRecordStatus)} value={fixtureStatus}>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="cable-form__field">
          <span>Owner (optional)</span>
          <input autoComplete="off" onChange={(event) => setOwner(event.target.value)} placeholder="Who owns this fixture" value={owner} />
        </label>
        <label className="cable-form__field">
          <span>Project (optional)</span>
          <select onChange={(event) => setProjectId(event.target.value)} value={projectId}>
            <option value="">No project</option>
            {projectOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="cable-form__field">
          <span>Source document (optional)</span>
          <input autoComplete="off" onChange={(event) => setSourceDocumentRef(event.target.value)} placeholder="TFX-42-ports.pdf" value={sourceDocumentRef} />
        </label>
        <label className="cable-form__field cable-form__field--wide">
          <span>Purpose (optional)</span>
          <textarea onChange={(event) => setPurpose(event.target.value)} placeholder="What this fixture is for" rows={2} value={purpose} />
        </label>
      </div>

      {status.kind === "failed" ? <p className="cable-form__error" role="alert">{status.message}</p> : null}

      <div className="cable-form__actions">
        <button className="button-primary" disabled={status.kind === "saving"} type="submit">
          {status.kind === "saving" ? "Creating…" : "Create fixture"}
        </button>
      </div>
    </form>
  );
}
