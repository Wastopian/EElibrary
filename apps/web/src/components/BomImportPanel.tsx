/**
 * File header: Client-side CSV BOM preview, column mapping, and persistence panel.
 */

"use client";

import React, { useCallback, useMemo, useState } from "react";
import { createBomImport, isApiClientError, previewBomImport } from "../lib/api-client";
import type { BomColumnMapping, BomImportCreateResponse, BomImportPreviewResponse, ProjectRevision } from "@ee-library/shared/types";

/** BomImportPanelProps supplies project and revision context for a BOM upload. */
export interface BomImportPanelProps {
  projectId: string;
  revisions: ProjectRevision[];
}

/** BomImportStatus tracks preview and persistence feedback for the import panel. */
type BomImportStatus =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "ready"; preview: BomImportPreviewResponse }
  | { kind: "saving"; preview: BomImportPreviewResponse }
  | { kind: "success"; response: BomImportCreateResponse }
  | { kind: "failed"; message: string };

const unmappedValue = "__unmapped__";
const newRevisionValue = "__new_revision__";
const maxBomCsvBytes = 2 * 1024 * 1024;

/**
 * Renders a real CSV upload and mapping workflow without running part matching.
 */
export function BomImportPanel({ projectId, revisions }: BomImportPanelProps): React.ReactElement {
  const firstRevisionId = revisions[0]?.id ?? newRevisionValue;
  const [sourceFilename, setSourceFilename] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState(firstRevisionId);
  const [revisionLabel, setRevisionLabel] = useState(revisions.length > 0 ? "" : "Working");
  const [mapping, setMapping] = useState<BomColumnMapping>({});
  const [status, setStatus] = useState<BomImportStatus>({ kind: "idle" });
  const preview = status.kind === "ready" || status.kind === "saving" ? status.preview : null;
  const headers = preview?.headers ?? [];
  const canSave = Boolean(preview && rawContent && sourceFilename && mapping.mpn && (selectedRevisionId !== newRevisionValue || revisionLabel.trim()));

  /**
   * Reads a local CSV file and requests a no-write preview from the API.
   */
  const onFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setStatus({ kind: "failed", message: "Only CSV BOM files are supported in this MVP." });
      return;
    }

    if (file.size > maxBomCsvBytes) {
      setStatus({ kind: "failed", message: "CSV BOM files are limited to 2 MB in this MVP." });
      return;
    }

    setStatus({ kind: "previewing" });

    try {
      const text = await file.text();
      const nextPreview = await previewBomImport({
        rawContent: text,
        sourceFilename: file.name,
        sourceFormat: "csv"
      });

      setSourceFilename(file.name);
      setRawContent(text);
      setMapping(nextPreview.suggestedMapping);
      setStatus({ kind: "ready", preview: nextPreview });
    } catch (error) {
      setStatus({ kind: "failed", message: resolveBomImportFailure(error, "BOM preview failed. Check the CSV and try again.") });
    }
  }, []);

  /**
   * Persists the mapped BOM rows through the project-memory API.
   */
  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!preview) {
        setStatus({ kind: "failed", message: "Preview a CSV BOM before saving it." });
        return;
      }

      if (!mapping.mpn) {
        setStatus({ kind: "failed", message: "Map an MPN column before saving the BOM." });
        return;
      }

      setStatus({ kind: "saving", preview });

      try {
        const response = await createBomImport(projectId, {
          columnMapping: mapping,
          projectRevisionId: selectedRevisionId === newRevisionValue ? null : selectedRevisionId,
          rawContent,
          revisionLabel: selectedRevisionId === newRevisionValue ? revisionLabel.trim() : null,
          sourceFilename,
          sourceFormat: "csv"
        });

        setStatus({ kind: "success", response });
        refreshProjectDetail();
      } catch (error) {
        setStatus({ kind: "failed", message: resolveBomImportFailure(error, "BOM import failed. Check the mapping and try again.") });
      }
    },
    [mapping, preview, projectId, rawContent, revisionLabel, selectedRevisionId, sourceFilename]
  );

  /**
   * Updates one canonical mapping field from a select input.
   */
  const updateMapping = useCallback((field: keyof BomColumnMapping, value: string) => {
    setMapping((currentMapping) => ({
      ...currentMapping,
      [field]: value === unmappedValue ? null : value
    }));
  }, []);

  const revisionOptions = useMemo(() => revisions.map((revision) => ({ id: revision.id, label: revision.revisionLabel })), [revisions]);

  return (
    <div className="bom-import-panel">
      <form className="bom-import-panel__form" onSubmit={onSubmit}>
        <div className="bom-import-panel__upload-row">
          <label className="bom-import-panel__field">
            <span>CSV BOM file</span>
            <input accept=".csv,text/csv" onChange={onFileChange} type="file" />
          </label>
          <label className="bom-import-panel__field">
            <span>Revision scope</span>
            <select onChange={(event) => setSelectedRevisionId(event.target.value)} value={selectedRevisionId}>
              {revisionOptions.map((revision) => (
                <option key={revision.id} value={revision.id}>
                  {revision.label}
                </option>
              ))}
              <option value={newRevisionValue}>Create new revision</option>
            </select>
          </label>
          {selectedRevisionId === newRevisionValue ? (
            <label className="bom-import-panel__field">
              <span>New revision label</span>
              <input onChange={(event) => setRevisionLabel(event.target.value)} placeholder="Rev A" value={revisionLabel} />
            </label>
          ) : null}
        </div>

        {preview ? (
          <>
            <div className="bom-import-panel__summary" aria-live="polite">
              <strong>{preview.rowCount} parsed rows</strong>
              <span>{preview.skippedBlankRowCount} blank rows skipped</span>
              <span>{sourceFilename}</span>
            </div>
            {preview.warnings.length > 0 ? (
              <ul className="bom-import-panel__warnings">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="bom-import-panel__mapping-grid">
              <MappingSelect field="mpn" headers={headers} label="MPN" mapping={mapping} required updateMapping={updateMapping} />
              <MappingSelect field="manufacturer" headers={headers} label="Manufacturer" mapping={mapping} updateMapping={updateMapping} />
              <MappingSelect field="quantity" headers={headers} label="Quantity" mapping={mapping} updateMapping={updateMapping} />
              <MappingSelect field="designators" headers={headers} label="Designators" mapping={mapping} updateMapping={updateMapping} />
              <MappingSelect field="description" headers={headers} label="Description" mapping={mapping} updateMapping={updateMapping} />
              <MappingSelect field="notes" headers={headers} label="Notes" mapping={mapping} updateMapping={updateMapping} />
              <MappingSelect field="supplierReference" headers={headers} label="Supplier reference" mapping={mapping} updateMapping={updateMapping} />
            </div>
            <PreviewTable preview={preview} />
            <div className="bom-import-panel__actions">
              <button disabled={!canSave || status.kind === "saving"} type="submit">
                {status.kind === "saving" ? "Saving BOM..." : "Save mapped BOM"}
              </button>
              <span>Saved rows stay unmatched until P0-MEM5 matching confirms internal parts.</span>
            </div>
          </>
        ) : null}
      </form>
      <BomImportStatusMessage status={status} />
    </div>
  );
}

/**
 * Renders one canonical mapping select.
 */
function MappingSelect({
  field,
  headers,
  label,
  mapping,
  required = false,
  updateMapping
}: {
  field: keyof BomColumnMapping;
  headers: string[];
  label: string;
  mapping: BomColumnMapping;
  required?: boolean;
  updateMapping: (field: keyof BomColumnMapping, value: string) => void;
}) {
  return (
    <label className="bom-import-panel__field">
      <span>{required ? `${label} *` : label}</span>
      <select onChange={(event) => updateMapping(field, event.target.value)} value={mapping[field] ?? unmappedValue}>
        <option value={unmappedValue}>Unmapped</option>
        {headers.map((header) => (
          <option key={header} value={header}>
            {header}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Renders a bounded parsed-row preview from the API response.
 */
function PreviewTable({ preview }: { preview: BomImportPreviewResponse }) {
  const visibleHeaders = preview.headers.slice(0, 8);

  return (
    <div className="bom-import-panel__preview-wrap">
      <table className="bom-import-panel__preview-table">
        <thead>
          <tr>
            <th>Row</th>
            {visibleHeaders.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rowsPreview.slice(0, 8).map((row) => (
            <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              {visibleHeaders.map((header) => (
                <td key={header}>{row.values[header] || ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders panel feedback for preview, save, and error states.
 */
function BomImportStatusMessage({ status }: { status: BomImportStatus }) {
  if (status.kind === "idle") {
    return <p className="bom-import-panel__status bom-import-panel__status--idle">Upload a CSV to preview rows and map columns before anything is persisted.</p>;
  }

  if (status.kind === "previewing") {
    return <p className="bom-import-panel__status bom-import-panel__status--pending">Parsing CSV preview...</p>;
  }

  if (status.kind === "saving") {
    return <p className="bom-import-panel__status bom-import-panel__status--pending">Saving mapped BOM rows...</p>;
  }

  if (status.kind === "success") {
    return (
      <p className="bom-import-panel__status bom-import-panel__status--success">
        Saved {status.response.lineCount} BOM rows. Match status remains unmatched until row matching runs.
      </p>
    );
  }

  if (status.kind === "failed") {
    return <p className="bom-import-panel__status bom-import-panel__status--failed">{status.message}</p>;
  }

  return null;
}

/**
 * Converts preview and persistence failures into concise operator copy.
 */
function resolveBomImportFailure(error: unknown, fallbackMessage: string): string {
  if (!isApiClientError(error)) {
    return fallbackMessage;
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "BOM import requires an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "BOM import requires the project-memory database.";
  }

  return error.message.replace(/^BOM import (preview|create) failed \([^)]+\):\s*/u, "");
}

/**
 * Refreshes the current project detail route after a saved BOM when running in the browser.
 */
function refreshProjectDetail(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
