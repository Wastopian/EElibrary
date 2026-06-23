"use client";

/**
 * File header: Client authoring surface for one cable assembly — header, ends, and pin rows.
 *
 * Every mutation returns the refreshed cable detail, which becomes local state, so the page
 * stays accurate without a full reload. Honesty boundary: editing cable memory never approves a
 * part, validates an asset, proves a bench setup is safe, or unlocks export.
 */

import Link from "next/link";
import React, { useCallback, useState } from "react";
import {
  createCableAssemblyEnd,
  createCablePinMapRow,
  deleteCableAssemblyEnd,
  deleteCablePinMapRow,
  isApiClientError,
  updateCableAssembly,
  updateCableAssemblyEnd,
  updateCablePinMapRow
} from "../../lib/api-client";
import type { CableProjectOption } from "./CableCreateForm";
import type {
  CableAssemblyDetail,
  CableAssemblyEnd,
  CableAssemblyEndLabel,
  CablePinMapRow,
  InterconnectRecordStatus
} from "@ee-library/shared/types";

/** STATUS_OPTIONS lists the cable statuses with plain labels. */
const STATUS_OPTIONS: { value: InterconnectRecordStatus; label: string }[] = [
  { label: "Draft", value: "draft" },
  { label: "In review", value: "in_review" },
  { label: "Approved", value: "approved" },
  { label: "Restricted", value: "restricted" },
  { label: "Retired", value: "retired" }
];

/** END_OPTIONS lists connector-end labels. */
const END_OPTIONS: CableAssemblyEndLabel[] = ["A", "B", "C", "D", "other"];

/** Banner tracks the page-wide save feedback. */
type Banner = { kind: "idle" } | { kind: "saving" } | { kind: "success"; message: string } | { kind: "failed"; message: string };

/** CableDetailEditorProps carries the loaded detail and project options. */
export interface CableDetailEditorProps {
  detail: CableAssemblyDetail;
  projectOptions: CableProjectOption[];
}

/** Renders the full cable authoring surface. */
export function CableDetailEditor({ detail: initial, projectOptions }: CableDetailEditorProps): React.ReactElement {
  const [detail, setDetail] = useState<CableAssemblyDetail>(initial);
  const [banner, setBanner] = useState<Banner>({ kind: "idle" });

  const runMutation = useCallback(async (label: string, mutate: () => Promise<CableAssemblyDetail>): Promise<boolean> => {
    setBanner({ kind: "saving" });
    try {
      const next = await mutate();
      setDetail(next);
      setBanner({ kind: "success", message: `${label}. ${next.boundary}` });
      return true;
    } catch (error) {
      setBanner({ kind: "failed", message: describeCableError(error) });
      return false;
    }
  }, []);

  const cableId = detail.cable.id;

  return (
    <div className="cable-editor">
      {banner.kind === "success" ? <p className="cable-editor__banner cable-editor__banner--ok" role="status">{banner.message}</p> : null}
      {banner.kind === "failed" ? <p className="cable-editor__banner cable-editor__banner--error" role="alert">{banner.message}</p> : null}

      <CableHeaderEditor cable={detail.cable} projectOptions={projectOptions} onSave={(input) => runMutation("Cable updated", () => updateCableAssembly(cableId, input))} />

      <CableEndsSection
        cableId={cableId}
        ends={detail.cable.ends}
        runMutation={runMutation}
      />

      <CablePinRowsSection
        cableId={cableId}
        pinRows={detail.pinRows}
        runMutation={runMutation}
      />
    </div>
  );
}

/** Renders the cable header edit form. */
function CableHeaderEditor({
  cable,
  projectOptions,
  onSave
}: {
  cable: CableAssemblyDetail["cable"];
  projectOptions: CableProjectOption[];
  onSave: (input: { cableKey: string; revisionLabel: string; assemblyStatus: InterconnectRecordStatus; owner: string | null; projectId: string | null; description: string | null; sourceDocumentRef: string | null }) => Promise<boolean>;
}) {
  const [cableKey, setCableKey] = useState(cable.cableKey);
  const [revisionLabel, setRevisionLabel] = useState(cable.revisionLabel);
  const [assemblyStatus, setAssemblyStatus] = useState<InterconnectRecordStatus>(cable.assemblyStatus);
  const [owner, setOwner] = useState(cable.owner ?? "");
  const [projectId, setProjectId] = useState(cable.projectId ?? "");
  const [description, setDescription] = useState(cable.description ?? "");
  const [sourceDocumentRef, setSourceDocumentRef] = useState(cable.sourceDocumentRef ?? "");
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    await onSave({
      assemblyStatus,
      cableKey: cableKey.trim(),
      description: description.trim() || null,
      owner: owner.trim() || null,
      projectId: projectId || null,
      revisionLabel: revisionLabel.trim() || "Working",
      sourceDocumentRef: sourceDocumentRef.trim() || null
    });
    setSaving(false);
  }

  return (
    <section className="cable-editor__section">
      <h2>Cable details</h2>
      <form className="cable-form" onSubmit={onSubmit}>
        <div className="cable-form__grid">
          <label className="cable-form__field">
            <span>Cable ID</span>
            <input autoComplete="off" onChange={(event) => setCableKey(event.target.value)} value={cableKey} />
          </label>
          <label className="cable-form__field">
            <span>Revision</span>
            <input autoComplete="off" onChange={(event) => setRevisionLabel(event.target.value)} value={revisionLabel} />
          </label>
          <label className="cable-form__field">
            <span>Status</span>
            <select onChange={(event) => setAssemblyStatus(event.target.value as InterconnectRecordStatus)} value={assemblyStatus}>
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
            <span>Description</span>
            <textarea onChange={(event) => setDescription(event.target.value)} rows={2} value={description} />
          </label>
        </div>
        <div className="cable-form__actions">
          <button className="button-primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save cable details"}</button>
          {assemblyStatus === "retired" ? <span className="cable-form__hint">Retired cables stay in history; they are never deleted.</span> : null}
        </div>
      </form>
    </section>
  );
}

/** Renders the connector-ends list with an add/edit form and delete actions. */
function CableEndsSection({
  cableId,
  ends,
  runMutation
}: {
  cableId: string;
  ends: CableAssemblyEnd[];
  runMutation: (label: string, mutate: () => Promise<CableAssemblyDetail>) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [endLabel, setEndLabel] = useState<CableAssemblyEndLabel>("A");
  const [connectorRef, setConnectorRef] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm(): void {
    setEditingId(null);
    setEndLabel("A");
    setConnectorRef("");
    setNotes("");
  }

  function startEdit(end: CableAssemblyEnd): void {
    setEditingId(end.id);
    setEndLabel(end.endLabel);
    setConnectorRef(end.connectorRef);
    setNotes(end.notes ?? "");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const existing = editingId ? ends.find((end) => end.id === editingId) ?? null : null;
    const input = {
      // Preserve any existing matched-part links; this form edits identity and notes only.
      backshellPartId: existing?.backshellPart.partId ?? null,
      connectorPartId: existing?.connectorPart.partId ?? null,
      connectorRef: connectorRef.trim(),
      endLabel,
      matePartId: existing?.matePart.partId ?? null,
      notes: notes.trim() || null
    };
    const ok = editingId
      ? await runMutation("Connector end updated", () => updateCableAssemblyEnd(cableId, editingId, input))
      : await runMutation("Connector end added", () => createCableAssemblyEnd(cableId, input));
    if (ok) {
      resetForm();
    }
  }

  return (
    <section className="cable-editor__section">
      <h2>Connector ends</h2>
      {ends.length === 0 ? <p className="muted-copy">No ends recorded yet. Add the connectors on each end of this cable.</p> : (
        <ul className="cable-editor__list">
          {ends.map((end) => (
            <li className="cable-editor__list-row" key={end.id}>
              <div>
                <span className="ui-mono">End {end.endLabel}: {end.connectorRef}</span>
                <p className="muted-copy">{end.connectorPart.partId ? `${end.connectorPart.manufacturerName ?? ""} ${end.connectorPart.mpn ?? ""}`.trim() : "No matched part"}{end.notes ? ` — ${end.notes}` : ""}</p>
              </div>
              <div className="cable-editor__row-actions">
                <button className="button-link" onClick={() => startEdit(end)} type="button">Edit</button>
                <button className="button-link button-link--quiet" onClick={() => runMutation("Connector end removed", () => deleteCableAssemblyEnd(cableId, end.id))} type="button">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="cable-form cable-form--inline" onSubmit={onSubmit}>
        <h3>{editingId ? "Edit connector end" : "Add a connector end"}</h3>
        <div className="cable-form__grid">
          <label className="cable-form__field">
            <span>End</span>
            <select onChange={(event) => setEndLabel(event.target.value as CableAssemblyEndLabel)} value={endLabel}>
              {END_OPTIONS.map((option) => <option key={option} value={option}>{option === "other" ? "Other" : `End ${option}`}</option>)}
            </select>
          </label>
          <label className="cable-form__field">
            <span>Connector reference</span>
            <input autoComplete="off" onChange={(event) => setConnectorRef(event.target.value)} placeholder="J202" value={connectorRef} />
          </label>
          <label className="cable-form__field cable-form__field--wide">
            <span>Notes (optional)</span>
            <input autoComplete="off" onChange={(event) => setNotes(event.target.value)} value={notes} />
          </label>
        </div>
        <div className="cable-form__actions">
          <button className="button-primary" type="submit">{editingId ? "Update end" : "Add end"}</button>
          {editingId ? <button className="button-link button-link--quiet" onClick={resetForm} type="button">Cancel</button> : null}
        </div>
      </form>
    </section>
  );
}

/** Renders the pin-map rows with an add/edit form and delete actions. */
function CablePinRowsSection({
  cableId,
  pinRows,
  runMutation
}: {
  cableId: string;
  pinRows: CablePinMapRow[];
  runMutation: (label: string, mutate: () => Promise<CableAssemblyDetail>) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyPinForm());

  function resetForm(): void {
    setEditingId(null);
    setForm(emptyPinForm());
  }

  function startEdit(row: CablePinMapRow): void {
    setEditingId(row.id);
    setForm({
      confidenceScore: row.confidenceScore.toString(),
      connectorRef: row.connectorRef,
      destinationConnectorRef: row.destinationConnectorRef ?? "",
      destinationPinNumber: row.destinationPinNumber ?? "",
      endLabel: row.endLabel,
      notes: row.notes ?? "",
      pinNumber: row.pinNumber,
      signalName: row.signalName,
      sourceDocumentRef: row.sourceDocumentRef ?? "",
      wireColor: row.wireColor ?? "",
      wireGauge: row.wireGauge?.toString() ?? ""
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const existing = editingId ? pinRows.find((row) => row.id === editingId) ?? null : null;
    const input = {
      // Preserve end/port links and existing source ref this form does not edit.
      cableEndId: existing?.cableEndId ?? null,
      confidenceScore: form.confidenceScore.trim() ? Number(form.confidenceScore) : null,
      connectorRef: form.connectorRef.trim(),
      destinationConnectorRef: form.destinationConnectorRef.trim() || null,
      destinationPinNumber: form.destinationPinNumber.trim() || null,
      endLabel: form.endLabel,
      fixturePortId: existing?.fixturePortId ?? null,
      notes: form.notes.trim() || null,
      pinNumber: form.pinNumber.trim(),
      signalName: form.signalName.trim(),
      sourceDocumentRef: form.sourceDocumentRef.trim() || null,
      wireColor: form.wireColor.trim() || null,
      wireGauge: form.wireGauge.trim() ? Number(form.wireGauge) : null
    };
    const ok = editingId
      ? await runMutation("Pin row updated", () => updateCablePinMapRow(cableId, editingId, input))
      : await runMutation("Pin row added", () => createCablePinMapRow(cableId, input));
    if (ok) {
      resetForm();
    }
  }

  return (
    <section className="cable-editor__section">
      <h2>Pin map</h2>
      {pinRows.length === 0 ? <p className="muted-copy">No pin rows recorded yet. Add the pin-to-signal wiring for this cable.</p> : (
        <div className="where-used-table-wrap interconnect-table-wrap">
          <table className="where-used-table interconnect-table interconnect-table--pins">
            <thead>
              <tr>
                <th>Connector pin</th>
                <th>Signal</th>
                <th>Wire</th>
                <th>Destination</th>
                <th>Confidence</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {pinRows.map((row) => (
                <tr key={row.id}>
                  <td className="ui-mono">{row.connectorRef} pin {row.pinNumber} <span className="muted-copy">(end {row.endLabel})</span></td>
                  <td>{row.signalName}</td>
                  <td>{[row.wireColor, row.wireGauge ? `${row.wireGauge} AWG` : null].filter(Boolean).join(" / ") || "—"}</td>
                  <td>{row.destinationConnectorRef ? `${row.destinationConnectorRef}${row.destinationPinNumber ? ` pin ${row.destinationPinNumber}` : ""}` : "—"}</td>
                  <td>{Math.round(row.confidenceScore * 100)}%</td>
                  <td className="cable-editor__row-actions">
                    <button className="button-link" onClick={() => startEdit(row)} type="button">Edit</button>
                    <button className="button-link button-link--quiet" onClick={() => runMutation("Pin row removed", () => deleteCablePinMapRow(cableId, row.id))} type="button">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="cable-form cable-form--inline" onSubmit={onSubmit}>
        <h3>{editingId ? "Edit pin row" : "Add a pin row"}</h3>
        <div className="cable-form__grid">
          <label className="cable-form__field">
            <span>End</span>
            <select onChange={(event) => setForm({ ...form, endLabel: event.target.value as CableAssemblyEndLabel })} value={form.endLabel}>
              {END_OPTIONS.map((option) => <option key={option} value={option}>{option === "other" ? "Other" : `End ${option}`}</option>)}
            </select>
          </label>
          <label className="cable-form__field">
            <span>Connector reference</span>
            <input autoComplete="off" onChange={(event) => setForm({ ...form, connectorRef: event.target.value })} placeholder="J202" value={form.connectorRef} />
          </label>
          <label className="cable-form__field">
            <span>Pin number</span>
            <input autoComplete="off" onChange={(event) => setForm({ ...form, pinNumber: event.target.value })} placeholder="47" value={form.pinNumber} />
          </label>
          <label className="cable-form__field">
            <span>Signal name</span>
            <input autoComplete="off" onChange={(event) => setForm({ ...form, signalName: event.target.value })} placeholder="CAN_H" value={form.signalName} />
          </label>
          <label className="cable-form__field">
            <span>Wire color (optional)</span>
            <input autoComplete="off" onChange={(event) => setForm({ ...form, wireColor: event.target.value })} value={form.wireColor} />
          </label>
          <label className="cable-form__field">
            <span>Wire gauge AWG (optional)</span>
            <input inputMode="numeric" onChange={(event) => setForm({ ...form, wireGauge: event.target.value })} value={form.wireGauge} />
          </label>
          <label className="cable-form__field">
            <span>Destination connector (optional)</span>
            <input autoComplete="off" onChange={(event) => setForm({ ...form, destinationConnectorRef: event.target.value })} value={form.destinationConnectorRef} />
          </label>
          <label className="cable-form__field">
            <span>Destination pin (optional)</span>
            <input autoComplete="off" onChange={(event) => setForm({ ...form, destinationPinNumber: event.target.value })} value={form.destinationPinNumber} />
          </label>
          <label className="cable-form__field">
            <span>Confidence 0–1 (optional)</span>
            <input inputMode="decimal" onChange={(event) => setForm({ ...form, confidenceScore: event.target.value })} placeholder="0.5" value={form.confidenceScore} />
          </label>
          <label className="cable-form__field cable-form__field--wide">
            <span>Notes (optional)</span>
            <input autoComplete="off" onChange={(event) => setForm({ ...form, notes: event.target.value })} value={form.notes} />
          </label>
        </div>
        <div className="cable-form__actions">
          <button className="button-primary" type="submit">{editingId ? "Update pin row" : "Add pin row"}</button>
          {editingId ? <button className="button-link button-link--quiet" onClick={resetForm} type="button">Cancel</button> : null}
        </div>
      </form>

      <p className="cable-editor__footnote">
        <Link href="/interconnects">Back to cables &amp; fixtures</Link>
      </p>
    </section>
  );
}

/** PinFormState mirrors the editable pin-row fields as strings for controlled inputs. */
interface PinFormState {
  endLabel: CableAssemblyEndLabel;
  connectorRef: string;
  pinNumber: string;
  signalName: string;
  wireColor: string;
  wireGauge: string;
  destinationConnectorRef: string;
  destinationPinNumber: string;
  confidenceScore: string;
  sourceDocumentRef: string;
  notes: string;
}

/** Returns a blank pin form. */
function emptyPinForm(): PinFormState {
  return {
    confidenceScore: "",
    connectorRef: "",
    destinationConnectorRef: "",
    destinationPinNumber: "",
    endLabel: "A",
    notes: "",
    pinNumber: "",
    signalName: "",
    sourceDocumentRef: "",
    wireColor: "",
    wireGauge: ""
  };
}

/** Turns an API client error into plain operator copy. */
function describeCableError(error: unknown): string {
  if (isApiClientError(error)) {
    return error.message;
  }
  return "That change could not be saved. Check your connection and try again.";
}
