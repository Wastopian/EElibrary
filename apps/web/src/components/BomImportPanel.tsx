/**
 * File header: Client-side CSV/XLSX BOM preview, column mapping, and persistence panel.
 */

"use client";

import { useRouter } from "next/navigation";
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
const maxBomFileBytes = 4 * 1024 * 1024;

/**
 * Renders a real CSV upload and mapping workflow while keeping matching as a separate action.
 */
export function BomImportPanel({ projectId, revisions }: BomImportPanelProps): React.ReactElement {
  const router = useRouter();
  const firstRevisionId = revisions[0]?.id ?? newRevisionValue;
  const [sourceFilename, setSourceFilename] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [sourceFormat, setSourceFormat] = useState<"csv" | "xlsx">("csv");
  const [selectedRevisionId, setSelectedRevisionId] = useState(firstRevisionId);
  const [revisionLabel, setRevisionLabel] = useState(revisions.length > 0 ? "" : "Working");
  const [mapping, setMapping] = useState<BomColumnMapping>({});
  const [status, setStatus] = useState<BomImportStatus>({ kind: "idle" });
  const preview = status.kind === "ready" || status.kind === "saving" ? status.preview : null;
  const headers = preview?.headers ?? [];
  const canSave = Boolean(preview && rawContent && sourceFilename && mapping.mpn && (selectedRevisionId !== newRevisionValue || revisionLabel.trim()));

  /**
   * Reads a local CSV or XLSX file and requests a no-write preview from the API.
   */
  const onFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const lowerName = file.name.toLowerCase();
    const isXlsx = lowerName.endsWith(".xlsx");
    const isCsv = lowerName.endsWith(".csv");

    if (!isCsv && !isXlsx) {
      setStatus({ kind: "failed", message: "Only CSV and XLSX BOM files are supported." });
      return;
    }

    if (file.size > maxBomFileBytes) {
      setStatus({ kind: "failed", message: "BOM files are limited to 4 MB." });
      return;
    }

    setStatus({ kind: "previewing" });

    try {
      let content: string;
      let fmt: "csv" | "xlsx";

      if (isXlsx) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        content = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
        fmt = "xlsx";
      } else {
        content = await file.text();
        fmt = "csv";
      }

      const nextPreview = await previewBomImport({
        rawContent: content,
        sourceFilename: file.name,
        sourceFormat: fmt
      });

      setSourceFilename(file.name);
      setRawContent(content);
      setSourceFormat(fmt);
      setMapping(nextPreview.suggestedMapping);
      setStatus({ kind: "ready", preview: nextPreview });
    } catch (error) {
      setStatus({ kind: "failed", message: resolveBomImportFailure(error, "BOM preview failed. Check the file and try again.") });
    }
  }, []);

  /**
   * Persists the mapped BOM rows through the project-memory API.
   */
  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!preview) {
        setStatus({ kind: "failed", message: "Preview a BOM file before saving it." });
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
          sourceFormat
        });

        setStatus({ kind: "success", response });
        router.refresh();
      } catch (error) {
        setStatus({ kind: "failed", message: resolveBomImportFailure(error, "BOM import failed. Check the mapping and try again.") });
      }
    },
    [mapping, preview, projectId, rawContent, revisionLabel, router, selectedRevisionId, sourceFilename, sourceFormat]
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
            <span>BOM file (CSV or XLSX)</span>
            <input accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFileChange} type="file" />
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
              <span>Saving stores the rows. Matching them to known parts is a separate step in the import table below.</span>
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
    return <p className="bom-import-panel__status bom-import-panel__status--idle">Upload a CSV or XLSX file to preview rows and map columns. Nothing is saved until you click Save mapped BOM.</p>;
  }

  if (status.kind === "previewing") {
    return <p className="bom-import-panel__status bom-import-panel__status--pending">Parsing BOM preview...</p>;
  }

  if (status.kind === "saving") {
    return <p className="bom-import-panel__status bom-import-panel__status--pending">Saving mapped BOM rows...</p>;
  }

  if (status.kind === "success") {
    return (
      <p className="bom-import-panel__status bom-import-panel__status--success">
        Saved {status.response.lineCount} {status.response.lineCount === 1 ? "row" : "rows"}. Next step: scroll down to &ldquo;Match uploaded parts list&rdquo; and click Match rows to link them to known parts.
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
