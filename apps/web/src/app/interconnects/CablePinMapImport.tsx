"use client";

/**
 * File header: Client panel to import a cable pin map from a CSV/XLSX spreadsheet.
 *
 * Upload → preview + suggested column mapping → adjust → import. New pin rows are created on the
 * cable, skipping any that duplicate an existing connector ref + pin. Honesty boundary: importing
 * never approves the part or cable; imported rows land below review confidence until checked.
 */

import React, { useState } from "react";
import { importCablePinMap, isApiClientError, previewPinMapImport } from "../../lib/api-client";
import type { PinMapColumnMapping, PinMapImportPreviewResponse, PinMapImportSummary } from "@ee-library/shared/types";

const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** CablePinMapImportProps scopes the importer to one cable. */
export interface CablePinMapImportProps {
  cableId: string;
  cableKey: string;
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
  | { kind: "ready"; preview: PinMapImportPreviewResponse; upload: UploadState }
  | { kind: "importing"; preview: PinMapImportPreviewResponse; upload: UploadState }
  | { kind: "done"; summary: PinMapImportSummary; boundary: string }
  | { kind: "failed"; message: string };

/** OPTIONAL_FIELDS lists the non-required mapping fields with labels. */
const OPTIONAL_FIELDS: { field: keyof PinMapColumnMapping; label: string }[] = [
  { field: "endLabel", label: "End" },
  { field: "wireColor", label: "Wire color" },
  { field: "wireGauge", label: "Wire gauge (AWG)" },
  { field: "destinationConnectorRef", label: "Destination connector" },
  { field: "destinationPinNumber", label: "Destination pin" }
];

/** Renders the pin-map import panel. */
export function CablePinMapImport({ cableId, cableKey }: CablePinMapImportProps): React.ReactElement {
  const [status, setStatus] = useState<PanelStatus>({ kind: "idle" });
  const [mapping, setMapping] = useState<PinMapColumnMapping | null>(null);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    const isXlsx = lower.endsWith(".xlsx");
    const isCsv = lower.endsWith(".csv");
    if (!isCsv && !isXlsx) {
      setStatus({ kind: "failed", message: "Only CSV and XLSX pin-map files are supported." });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus({ kind: "failed", message: "Pin-map files are limited to 4 MB." });
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

      const preview = await previewPinMapImport({ rawContent, sourceFilename: file.name, sourceFormat });
      setMapping(preview.suggestedMapping);
      setStatus({ kind: "ready", preview, upload: { rawContent, sourceFilename: file.name, sourceFormat } });
    } catch (error) {
      setStatus({ kind: "failed", message: isApiClientError(error) ? error.message : "Could not read that file. Check it is a valid CSV or XLSX." });
    }
  }

  async function onImport(): Promise<void> {
    if (status.kind !== "ready" || !mapping) return;
    if (!mapping.connectorRef || !mapping.pinNumber || !mapping.signalName) {
      setStatus({ kind: "failed", message: "Map the connector reference, pin number, and signal columns before importing." });
      return;
    }

    const { preview, upload } = status;
    setStatus({ kind: "importing", preview, upload });
    try {
      const result = await importCablePinMap(cableId, { ...upload, columnMapping: mapping });
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
      <h2>Import pin map</h2>
      <p className="cable-form__boundary">
        <strong>Engineering memory only.</strong> Imported pins are recorded as needs-check memory on <span className="ui-mono">{cableKey}</span>; importing never approves the part or cable. Rows that duplicate an existing connector + pin are skipped.
      </p>

      <div className="cable-form cable-form--inline">
        <label className="cable-form__field cable-form__field--wide">
          <span>Pin-map file (CSV or XLSX)</span>
          <input accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFileChange} type="file" />
        </label>

        {status.kind === "previewing" ? <p className="muted-copy">Reading file…</p> : null}
        {status.kind === "failed" ? <p className="cable-form__error" role="alert">{status.message}</p> : null}
        {status.kind === "done" ? (
          <p className="cable-editor__banner cable-editor__banner--ok" role="status">
            Imported {status.summary.added} pin row{status.summary.added === 1 ? "" : "s"}
            {status.summary.skippedDuplicate > 0 ? `, skipped ${status.summary.skippedDuplicate} duplicate${status.summary.skippedDuplicate === 1 ? "" : "s"}` : ""}
            {status.summary.skippedInvalid > 0 ? `, skipped ${status.summary.skippedInvalid} unusable row${status.summary.skippedInvalid === 1 ? "" : "s"}` : ""}. {status.boundary}
          </p>
        ) : null}

        {preview && mapping ? (
          <>
            <p className="muted-copy">{preview.rowCount} row{preview.rowCount === 1 ? "" : "s"} found in <span className="ui-mono">{preview.sourceFilename}</span>. Match the columns, then import.</p>
            <div className="cable-form__grid">
              <MappingSelect field="connectorRef" headers={headers} label="Connector reference" mapping={mapping} required setMapping={setMapping} />
              <MappingSelect field="pinNumber" headers={headers} label="Pin number" mapping={mapping} required setMapping={setMapping} />
              <MappingSelect field="signalName" headers={headers} label="Signal" mapping={mapping} required setMapping={setMapping} />
              {OPTIONAL_FIELDS.map((option) => (
                <MappingSelect field={option.field} headers={headers} key={option.field} label={option.label} mapping={mapping} setMapping={setMapping} />
              ))}
            </div>
            <div className="cable-form__actions">
              <button
                className="button-primary"
                disabled={status.kind === "importing" || !mapping.connectorRef || !mapping.pinNumber || !mapping.signalName}
                onClick={onImport}
                type="button"
              >
                {status.kind === "importing" ? "Importing…" : "Import pins"}
              </button>
              {(!mapping.connectorRef || !mapping.pinNumber || !mapping.signalName) ? (
                <span className="cable-form__hint">Map connector reference, pin number, and signal to import.</span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Renders one column-mapping select for a pin-row field. */
function MappingSelect({
  field,
  headers,
  label,
  mapping,
  required,
  setMapping
}: {
  field: keyof PinMapColumnMapping;
  headers: string[];
  label: string;
  mapping: PinMapColumnMapping;
  required?: boolean;
  setMapping: React.Dispatch<React.SetStateAction<PinMapColumnMapping | null>>;
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
