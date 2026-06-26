"use client";

/**
 * File header: Client panel to import a fixture's ports from a CSV/XLSX port list.
 *
 * Upload → preview + suggested column mapping → adjust → import. New ports are created on the
 * fixture, skipping any that duplicate an existing connector ref. Honesty boundary: importing
 * never approves the part or fixture.
 */

import React, { useState } from "react";
import { importFixturePorts, isApiClientError, previewPortListImport } from "../../lib/api-client";
import type { PinMapImportSummary, PortListColumnMapping, PortListImportPreviewResponse } from "@ee-library/shared/types";

const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** FixturePortListImportProps scopes the importer to one fixture. */
export interface FixturePortListImportProps {
  fixtureId: string;
  fixtureKey: string;
}

/** UploadState carries the parsed file content for the import call. */
interface UploadState {
  sourceFilename: string;
  sourceFormat: "csv" | "xlsx";
  rawContent: string;
}

/** PanelStatus tracks the upload/preview/import lifecycle. */
type PanelStatus =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "ready"; preview: PortListImportPreviewResponse; upload: UploadState }
  | { kind: "importing"; preview: PortListImportPreviewResponse; upload: UploadState }
  | { kind: "done"; summary: PinMapImportSummary; boundary: string }
  | { kind: "failed"; message: string };

/** OPTIONAL_FIELDS lists the non-required mapping fields with labels. */
const OPTIONAL_FIELDS: { field: keyof PortListColumnMapping; label: string }[] = [
  { field: "portRole", label: "Port role" },
  { field: "notes", label: "Notes" }
];

/** Renders the port-list import panel. */
export function FixturePortListImport({ fixtureId, fixtureKey }: FixturePortListImportProps): React.ReactElement {
  const [status, setStatus] = useState<PanelStatus>({ kind: "idle" });
  const [mapping, setMapping] = useState<PortListColumnMapping | null>(null);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    const isXlsx = lower.endsWith(".xlsx");
    const isCsv = lower.endsWith(".csv");
    if (!isCsv && !isXlsx) {
      setStatus({ kind: "failed", message: "Only CSV and XLSX port-list files are supported." });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus({ kind: "failed", message: "Port-list files are limited to 4 MB." });
      return;
    }

    setStatus({ kind: "previewing" });
    try {
      let rawContent: string;
      let sourceFormat: "csv" | "xlsx";
      if (isXlsx) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        rawContent = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
        sourceFormat = "xlsx";
      } else {
        rawContent = await file.text();
        sourceFormat = "csv";
      }

      const preview = await previewPortListImport({ rawContent, sourceFilename: file.name, sourceFormat });
      setMapping(preview.suggestedMapping);
      setStatus({ kind: "ready", preview, upload: { rawContent, sourceFilename: file.name, sourceFormat } });
    } catch (error) {
      setStatus({ kind: "failed", message: isApiClientError(error) ? error.message : "Could not read that file. Check it is a valid CSV or XLSX." });
    }
  }

  async function onImport(): Promise<void> {
    if (status.kind !== "ready" || !mapping) return;
    if (!mapping.connectorRef) {
      setStatus({ kind: "failed", message: "Map the connector reference column before importing." });
      return;
    }

    const { preview, upload } = status;
    setStatus({ kind: "importing", preview, upload });
    try {
      const result = await importFixturePorts(fixtureId, { ...upload, columnMapping: mapping });
      setStatus({ kind: "done", boundary: result.boundary, summary: result.summary });
      window.location.reload();
    } catch (error) {
      setStatus({ kind: "failed", message: isApiClientError(error) ? error.message : "The import failed. Check the column mapping and try again." });
    }
  }

  const preview = status.kind === "ready" || status.kind === "importing" ? status.preview : null;
  const headers = preview?.headers ?? [];

  return (
    <section className="cable-editor__section">
      <h2>Import ports</h2>
      <p className="cable-form__boundary">
        <strong>Engineering memory only.</strong> Imported ports are recorded on <span className="ui-mono">{fixtureKey}</span>; importing never approves the part or fixture. Ports that duplicate an existing connector reference are skipped.
      </p>

      <div className="cable-form cable-form--inline">
        <label className="cable-form__field cable-form__field--wide">
          <span>Port-list file (CSV or XLSX)</span>
          <input accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFileChange} type="file" />
        </label>

        {status.kind === "previewing" ? <p className="muted-copy">Reading file…</p> : null}
        {status.kind === "failed" ? <p className="cable-form__error" role="alert">{status.message}</p> : null}
        {status.kind === "done" ? (
          <p className="cable-editor__banner cable-editor__banner--ok" role="status">
            Imported {status.summary.added} port{status.summary.added === 1 ? "" : "s"}
            {status.summary.skippedDuplicate > 0 ? `, skipped ${status.summary.skippedDuplicate} duplicate${status.summary.skippedDuplicate === 1 ? "" : "s"}` : ""}
            {status.summary.skippedInvalid > 0 ? `, skipped ${status.summary.skippedInvalid} unusable row${status.summary.skippedInvalid === 1 ? "" : "s"}` : ""}. {status.boundary}
          </p>
        ) : null}

        {preview && mapping ? (
          <>
            <p className="muted-copy">{preview.rowCount} row{preview.rowCount === 1 ? "" : "s"} found in <span className="ui-mono">{preview.sourceFilename}</span>. Match the columns, then import.</p>
            <div className="cable-form__grid">
              <MappingSelect field="connectorRef" headers={headers} label="Connector reference" mapping={mapping} required setMapping={setMapping} />
              {OPTIONAL_FIELDS.map((option) => (
                <MappingSelect field={option.field} headers={headers} key={option.field} label={option.label} mapping={mapping} setMapping={setMapping} />
              ))}
            </div>
            <div className="cable-form__actions">
              <button className="button-primary" disabled={status.kind === "importing" || !mapping.connectorRef} onClick={onImport} type="button">
                {status.kind === "importing" ? "Importing…" : "Import ports"}
              </button>
              {!mapping.connectorRef ? <span className="cable-form__hint">Map the connector reference to import.</span> : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Renders one column-mapping select for a port field. */
function MappingSelect({
  field,
  headers,
  label,
  mapping,
  required,
  setMapping
}: {
  field: keyof PortListColumnMapping;
  headers: string[];
  label: string;
  mapping: PortListColumnMapping;
  required?: boolean;
  setMapping: React.Dispatch<React.SetStateAction<PortListColumnMapping | null>>;
}) {
  return (
    <label className="cable-form__field">
      <span>{label}{required ? " *" : ""}</span>
      <select
        onChange={(event) => setMapping((current) => (current ? { ...current, [field]: event.target.value || null } : current))}
        value={mapping[field] ?? ""}
      >
        <option value="">{required ? "Choose a column" : "Not in file"}</option>
        {headers.map((header) => (
          <option key={header} value={header}>{header}</option>
        ))}
      </select>
    </label>
  );
}
