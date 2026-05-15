/**
 * File header: Client-side CSV/XLSX BOM preview, column mapping, and persistence panel.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useMemo, useRef, useState } from "react";
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
  const firstRevisionId = revisions[0]?.id ?? newRevisionValue;
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Last filename the user attempted, kept across failure states so the operator can see what they
  // dropped/picked/pasted even after the preview attempt errored out. Cleared on a successful save.
  const [lastAttemptedFilename, setLastAttemptedFilename] = useState<string | null>(null);
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

  /**
   * Shared preview path used by file-picker, drag-drop, and paste flows. Extracted so the
   * dropzone and the clipboard handler can both produce a ready preview without duplicating
   * the file/text/xlsx coercion logic.
   */
  const previewBomContent = useCallback(
    async ({ content, filename, fmt }: { content: string; filename: string; fmt: "csv" | "xlsx" }) => {
      setLastAttemptedFilename(filename);
      setStatus({ kind: "previewing" });

      try {
        const nextPreview = await previewBomImport({
          rawContent: content,
          sourceFilename: filename,
          sourceFormat: fmt
        });

        setSourceFilename(filename);
        setRawContent(content);
        setSourceFormat(fmt);
        setMapping(nextPreview.suggestedMapping);
        setStatus({ kind: "ready", preview: nextPreview });
      } catch (error) {
        setStatus({ kind: "failed", message: resolveBomImportFailure(error, "BOM preview failed. Check the file and try again.") });
      }
    },
    []
  );

  /**
   * Resets the upload picker so an operator can retry after a failed validation or preview without
   * needing a manual `value=""` workaround in the browser. Browsers suppress `onChange` when the
   * same File is re-picked unless the input is cleared, so this is the supported recovery path.
   */
  const resetUpload = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setLastAttemptedFilename(null);
    setStatus({ kind: "idle" });
  }, []);

  const previewBomFile = useCallback(
    async (file: File) => {
      const lowerName = file.name.toLowerCase();
      const isXlsx = lowerName.endsWith(".xlsx");
      const isCsv = lowerName.endsWith(".csv");
      setLastAttemptedFilename(file.name);

      if (!isCsv && !isXlsx) {
        setStatus({ kind: "failed", message: "Only CSV and XLSX BOM files are supported." });
        return;
      }

      if (file.size > maxBomFileBytes) {
        setStatus({ kind: "failed", message: "BOM files are limited to 4 MB." });
        return;
      }

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

      await previewBomContent({ content, filename: file.name, fmt });
    },
    [previewBomContent]
  );

  // Replaces the original onChange path so file-picker, drag-drop, and paste all share preview logic.
  const onFilePicked = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        await previewBomFile(file);
      }
    },
    [previewBomFile]
  );

  const [isDragActive, setIsDragActive] = useState(false);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes("text/plain")) {
      event.dataTransfer.dropEffect = "copy";
      setIsDragActive(true);
    }
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  }, []);

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragActive(false);

      const file = event.dataTransfer.files?.[0];
      if (file) {
        await previewBomFile(file);
        return;
      }

      const pasted = event.dataTransfer.getData("text/plain");
      if (pasted && pasted.includes("\n")) {
        await previewBomContent({ content: pasted, filename: "pasted-bom.csv", fmt: "csv" });
      }
    },
    [previewBomContent, previewBomFile]
  );

  // Paste CSV text directly into the dropzone (Cmd/Ctrl+V) for engineers piping clipboard content
  // out of a spreadsheet without saving to disk first. XLSX clipboard payloads come in as raw
  // bytes that browsers do not surface as files, so paste only supports CSV/TSV-style text.
  const onPaste = useCallback(
    async (event: React.ClipboardEvent<HTMLDivElement>) => {
      const file = event.clipboardData?.files?.[0];
      if (file) {
        event.preventDefault();
        await previewBomFile(file);
        return;
      }

      const text = event.clipboardData?.getData("text/plain");
      if (text && text.includes("\n")) {
        event.preventDefault();
        await previewBomContent({ content: text, filename: "pasted-bom.csv", fmt: "csv" });
      }
    },
    [previewBomContent, previewBomFile]
  );

  return (
    <div className="bom-import-panel">
      <form className="bom-import-panel__form" onSubmit={onSubmit}>
        <div
          className={`bom-import-panel__upload-row${isDragActive ? " bom-import-panel__upload-row--drag" : ""}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onPaste={onPaste}
          tabIndex={0}
        >
          <label className="bom-import-panel__field">
            <span>BOM file — drop, paste, or browse (CSV or XLSX, up to 4 MB)</span>
            <input accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFilePicked} ref={fileInputRef} type="file" />
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
      <BomImportStatusMessage
        lastAttemptedFilename={lastAttemptedFilename}
        onReset={resetUpload}
        projectId={projectId}
        status={status}
      />
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
function BomImportStatusMessage({
  lastAttemptedFilename,
  onReset,
  projectId,
  status
}: {
  lastAttemptedFilename: string | null;
  onReset: () => void;
  projectId: string;
  status: BomImportStatus;
}) {
  if (status.kind === "idle") {
    return <p className="bom-import-panel__status bom-import-panel__status--idle">Upload a CSV or XLSX file to preview rows and map columns. Nothing is saved until you click Save mapped BOM.</p>;
  }

  if (status.kind === "previewing") {
    return <p className="bom-import-panel__status bom-import-panel__status--pending">Parsing BOM preview{lastAttemptedFilename ? ` for ${lastAttemptedFilename}` : ""}...</p>;
  }

  if (status.kind === "saving") {
    return <p className="bom-import-panel__status bom-import-panel__status--pending">Saving mapped BOM rows...</p>;
  }

  if (status.kind === "success") {
    return (
      <p className="bom-import-panel__status bom-import-panel__status--success">
        Saved {status.response.lineCount} rows — workspace summary and BOM import list updated.
        {" "}
        <Link href={`/projects/${encodeURIComponent(projectId)}#project-bom-imports-heading`}>Jump to BOM imports</Link>
        {" "}to match rows when ready.
      </p>
    );
  }

  if (status.kind === "failed") {
    return (
      <p className="bom-import-panel__status bom-import-panel__status--failed">
        {status.message}
        {lastAttemptedFilename ? (
          <>
            {" "}File: <span className="ui-mono">{lastAttemptedFilename}</span>.
          </>
        ) : null}
        {" "}
        <button className="button-link" onClick={onReset} type="button">Try a different file</button>
      </p>
    );
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
