"use client";

/**
 * File header: Client authoring surface for one test fixture — header and ports.
 *
 * Every mutation returns the refreshed fixture detail, which becomes local state. Honesty
 * boundary: editing fixture memory never approves a part, validates an asset, proves a bench
 * setup is safe, or unlocks export.
 */

import Link from "next/link";
import React, { useCallback, useState } from "react";
import {
  createFixturePort,
  deleteFixturePort,
  isApiClientError,
  updateFixturePort,
  updateTestFixture
} from "../../lib/api-client";
import type { CableProjectOption } from "./CableCreateForm";
import type { FixturePort, InterconnectRecordStatus, TestFixtureDetail } from "@ee-library/shared/types";

/** STATUS_OPTIONS lists the fixture statuses with plain labels. */
const STATUS_OPTIONS: { value: InterconnectRecordStatus; label: string }[] = [
  { label: "Draft", value: "draft" },
  { label: "In review", value: "in_review" },
  { label: "Approved", value: "approved" },
  { label: "Restricted", value: "restricted" },
  { label: "Retired", value: "retired" }
];

/** Banner tracks the page-wide save feedback. */
type Banner = { kind: "idle" } | { kind: "saving" } | { kind: "success"; message: string } | { kind: "failed"; message: string };

/** FixtureDetailEditorProps carries the loaded detail and project options. */
export interface FixtureDetailEditorProps {
  detail: TestFixtureDetail;
  projectOptions: CableProjectOption[];
}

/** Renders the full fixture authoring surface. */
export function FixtureDetailEditor({ detail: initial, projectOptions }: FixtureDetailEditorProps): React.ReactElement {
  const [detail, setDetail] = useState<TestFixtureDetail>(initial);
  const [banner, setBanner] = useState<Banner>({ kind: "idle" });

  const runMutation = useCallback(async (label: string, mutate: () => Promise<TestFixtureDetail>): Promise<boolean> => {
    setBanner({ kind: "saving" });
    try {
      const next = await mutate();
      setDetail(next);
      setBanner({ kind: "success", message: `${label}. ${next.boundary}` });
      return true;
    } catch (error) {
      setBanner({ kind: "failed", message: describeFixtureError(error) });
      return false;
    }
  }, []);

  const fixtureId = detail.fixture.id;

  return (
    <div className="cable-editor">
      {banner.kind === "success" ? <p className="cable-editor__banner cable-editor__banner--ok" role="status">{banner.message}</p> : null}
      {banner.kind === "failed" ? <p className="cable-editor__banner cable-editor__banner--error" role="alert">{banner.message}</p> : null}

      <FixtureHeaderEditor fixture={detail.fixture} projectOptions={projectOptions} onSave={(input) => runMutation("Fixture updated", () => updateTestFixture(fixtureId, input))} />

      <FixturePortsSection fixtureId={fixtureId} ports={detail.fixture.ports} runMutation={runMutation} />
    </div>
  );
}

/** Renders the fixture header edit form. */
function FixtureHeaderEditor({
  fixture,
  projectOptions,
  onSave
}: {
  fixture: TestFixtureDetail["fixture"];
  projectOptions: CableProjectOption[];
  onSave: (input: { fixtureKey: string; revisionLabel: string; fixtureStatus: InterconnectRecordStatus; owner: string | null; projectId: string | null; purpose: string | null; sourceDocumentRef: string | null }) => Promise<boolean>;
}) {
  const [fixtureKey, setFixtureKey] = useState(fixture.fixtureKey);
  const [revisionLabel, setRevisionLabel] = useState(fixture.revisionLabel);
  const [fixtureStatus, setFixtureStatus] = useState<InterconnectRecordStatus>(fixture.fixtureStatus);
  const [owner, setOwner] = useState(fixture.owner ?? "");
  const [projectId, setProjectId] = useState(fixture.projectId ?? "");
  const [purpose, setPurpose] = useState(fixture.purpose ?? "");
  const [sourceDocumentRef, setSourceDocumentRef] = useState(fixture.sourceDocumentRef ?? "");
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    await onSave({
      fixtureKey: fixtureKey.trim(),
      fixtureStatus,
      owner: owner.trim() || null,
      projectId: projectId || null,
      purpose: purpose.trim() || null,
      revisionLabel: revisionLabel.trim() || "Working",
      sourceDocumentRef: sourceDocumentRef.trim() || null
    });
    setSaving(false);
  }

  return (
    <section className="cable-editor__section">
      <h2>Fixture details</h2>
      <form className="cable-form" onSubmit={onSubmit}>
        <div className="cable-form__grid">
          <label className="cable-form__field">
            <span>Fixture ID</span>
            <input autoComplete="off" onChange={(event) => setFixtureKey(event.target.value)} value={fixtureKey} />
          </label>
          <label className="cable-form__field">
            <span>Revision</span>
            <input autoComplete="off" onChange={(event) => setRevisionLabel(event.target.value)} value={revisionLabel} />
          </label>
          <label className="cable-form__field">
            <span>Status</span>
            <select onChange={(event) => setFixtureStatus(event.target.value as InterconnectRecordStatus)} value={fixtureStatus}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="cable-form__field">
            <span>Owner</span>
            <input autoComplete="off" onChange={(event) => setOwner(event.target.value)} value={owner} />
          </label>
          <label className="cable-form__field">
            <span>Project</span>
            <select onChange={(event) => setProjectId(event.target.value)} value={projectId}>
              <option value="">No project</option>
              {projectOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="cable-form__field">
            <span>Source document</span>
            <input autoComplete="off" onChange={(event) => setSourceDocumentRef(event.target.value)} value={sourceDocumentRef} />
          </label>
          <label className="cable-form__field cable-form__field--wide">
            <span>Purpose</span>
            <textarea onChange={(event) => setPurpose(event.target.value)} rows={2} value={purpose} />
          </label>
        </div>
        <div className="cable-form__actions">
          <button className="button-primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save fixture details"}</button>
          {fixtureStatus === "retired" ? <span className="cable-form__hint">Retired fixtures stay in history; they are never deleted.</span> : null}
        </div>
      </form>
    </section>
  );
}

/** Renders the fixture ports list with an add/edit form and delete actions. */
function FixturePortsSection({
  fixtureId,
  ports,
  runMutation
}: {
  fixtureId: string;
  ports: FixturePort[];
  runMutation: (label: string, mutate: () => Promise<TestFixtureDetail>) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [connectorRef, setConnectorRef] = useState("");
  const [portRole, setPortRole] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm(): void {
    setEditingId(null);
    setConnectorRef("");
    setPortRole("");
    setNotes("");
  }

  function startEdit(port: FixturePort): void {
    setEditingId(port.id);
    setConnectorRef(port.connectorRef);
    setPortRole(port.portRole ?? "");
    setNotes(port.notes ?? "");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const existing = editingId ? ports.find((port) => port.id === editingId) ?? null : null;
    const input = {
      // Preserve any existing matched-part and cable links; this form edits identity, role, and notes only.
      cableAssemblyId: existing?.cableAssemblyId ?? null,
      connectorPartId: existing?.connectorPart.partId ?? null,
      connectorRef: connectorRef.trim(),
      matePartId: existing?.matePart.partId ?? null,
      notes: notes.trim() || null,
      portRole: portRole.trim() || null
    };
    const ok = editingId
      ? await runMutation("Port updated", () => updateFixturePort(fixtureId, editingId, input))
      : await runMutation("Port added", () => createFixturePort(fixtureId, input));
    if (ok) {
      resetForm();
    }
  }

  return (
    <section className="cable-editor__section">
      <h2>Ports</h2>
      {ports.length === 0 ? <p className="muted-copy">No ports recorded yet. Add the connectors on this fixture.</p> : (
        <ul className="cable-editor__list">
          {ports.map((port) => (
            <li className="cable-editor__list-row" key={port.id}>
              <div>
                <span className="ui-mono">{port.connectorRef}</span>
                <p className="muted-copy">{port.portRole ?? "No role recorded"}{port.cableKey ? ` — cable ${port.cableKey}` : ""}{port.notes ? ` — ${port.notes}` : ""}</p>
              </div>
              <div className="cable-editor__row-actions">
                <button className="button-link" onClick={() => startEdit(port)} type="button">Edit</button>
                <button className="button-link button-link--quiet" onClick={() => runMutation("Port removed", () => deleteFixturePort(fixtureId, port.id))} type="button">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="cable-form cable-form--inline" onSubmit={onSubmit}>
        <h3>{editingId ? "Edit port" : "Add a port"}</h3>
        <div className="cable-form__grid">
          <label className="cable-form__field">
            <span>Connector reference</span>
            <input autoComplete="off" onChange={(event) => setConnectorRef(event.target.value)} placeholder="J202" value={connectorRef} />
          </label>
          <label className="cable-form__field">
            <span>Port role (optional)</span>
            <input autoComplete="off" onChange={(event) => setPortRole(event.target.value)} placeholder="DUT port" value={portRole} />
          </label>
          <label className="cable-form__field cable-form__field--wide">
            <span>Notes (optional)</span>
            <input autoComplete="off" onChange={(event) => setNotes(event.target.value)} value={notes} />
          </label>
        </div>
        <div className="cable-form__actions">
          <button className="button-primary" type="submit">{editingId ? "Update port" : "Add port"}</button>
          {editingId ? <button className="button-link button-link--quiet" onClick={resetForm} type="button">Cancel</button> : null}
        </div>
      </form>

      <p className="cable-editor__footnote">
        <Link href="/interconnects">Back to cables &amp; fixtures</Link>
      </p>
    </section>
  );
}

/** Turns an API client error into plain operator copy. */
function describeFixtureError(error: unknown): string {
  if (isApiClientError(error)) {
    return error.message;
  }
  return "That change could not be saved. Check your connection and try again.";
}
