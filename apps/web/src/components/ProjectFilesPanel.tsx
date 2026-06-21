"use client";

/**
 * File header: Project file mirror UI with browser uploads and a notes composer.
 *
 * The panel renders one card per category folder. Engineers can either:
 *   - Drop files directly into the OS folder shown on the card.
 *   - Upload through the browser using the per-card file input.
 *   - Review custom design records found in the design folder and parts-list files.
 *   - Capture PDF redline notes as file-backed review notes for the working engineer.
 *   - For the `notes` card only, compose a plain-text/Markdown note inline so reasoning
 *     for considered-but-rejected parts gets captured without leaving the workspace.
 *
 * After every successful upload the page reloads via `router.refresh()` so the listing
 * stays the source of truth — we never patch local state to imply a file landed when it
 * did not.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  copyProjectDocumentSuggestion,
  fetchProjectDocumentExtractionStatuses,
  fetchProjectFiles,
  isApiClientError,
  retryProjectDocumentExtraction,
  uploadProjectFile
} from "../lib/api-client";
import type {
  ProjectCustomHardwareListing,
  ProjectCustomHardwareRecord,
  ProjectDocumentExtractionStatusRecord,
  ProjectDocumentExtractionState,
  ProjectDocumentFolderPattern,
  ProjectDocumentFolderPatternAction,
  ProjectDocumentMap,
  ProjectDocumentMapEntry,
  ProjectDocumentSignals,
  ProjectDocumentType,
  ProjectFilesResponse,
  ProjectFolderCategory,
  ProjectFolderListing
} from "@ee-library/shared/types";

/**
 * Refreshes the page so the listing always reflects what's on disk. Using a full reload
 * (instead of `useRouter().refresh()`) keeps this surface honest about its source of
 * truth — filesystem reads — and avoids depending on the app router context for SSR
 * rendering or unit tests.
 */
function reloadAfterMutation(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

interface ProjectFilesPanelProps {
  /** Stable database id for this project. */
  projectId: string;
  /** Response from `GET /projects/:id/files`, or null when the API is unavailable. */
  files: ProjectFilesResponse | null;
}

/** MAX_UPLOAD_BYTES mirrors the API limit so the UI rejects oversize files before the round-trip. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** STALE_PROJECT_FILE_DAYS flags projects whose file evidence has not moved in roughly two quarters. */
const STALE_PROJECT_FILE_DAYS = 180;

/** DOCUMENT_EXTRACTION_POLL_INTERVAL_MS keeps background-reader progress visible. */
const DOCUMENT_EXTRACTION_POLL_INTERVAL_MS = 4_000;

/** ProjectDocumentMapScope names the current document-map review filter. */
type ProjectDocumentMapScope = "all" | "attention" | "ready" | "reader_issues";

/**
 * Top-level panel. Decides which honest state to render and otherwise lays out one
 * category card per folder, plus the inline notes composer.
 */
export function ProjectFilesPanel({ projectId, files }: ProjectFilesPanelProps) {
  const [liveFiles, setLiveFiles] = useState<ProjectFilesResponse | null>(files);
  const activeExtractionCount =
    (liveFiles?.documentMap?.summary.extractionQueuedCount ?? 0) +
    (liveFiles?.documentMap?.summary.extractionRunningCount ?? 0);
  const hasActiveExtractions = activeExtractionCount > 0;

  useEffect(() => {
    setLiveFiles(files);
  }, [files]);

  useEffect(() => {
    if (!hasActiveExtractions) {
      return;
    }

    let cancelled = false;
    let timeout: number | null = null;

    const poll = async (): Promise<void> => {
      try {
        const statusResponse = await fetchProjectDocumentExtractionStatuses(projectId);
        if (cancelled) {
          return;
        }

        if (statusResponse.activeCount === 0) {
          const refreshedFiles = await fetchProjectFiles(projectId);
          if (!cancelled && refreshedFiles) {
            setLiveFiles(refreshedFiles);
          }
          return;
        }

        setLiveFiles((current) =>
          current ? mergeProjectDocumentExtractionStatuses(current, statusResponse.records) : current
        );
      } catch {
        // Keep the last known state. The next scheduled status read can recover from a
        // transient API interruption without launching overlapping requests.
      }

      if (!cancelled) {
        timeout = window.setTimeout(() => void poll(), DOCUMENT_EXTRACTION_POLL_INTERVAL_MS);
      }
    };

    timeout = window.setTimeout(() => void poll(), DOCUMENT_EXTRACTION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, [hasActiveExtractions, projectId]);

  if (!liveFiles) {
    return (
      <div className="project-files-panel project-files-panel--unavailable">
        <p>The file mirror is paused because the project record is unavailable.</p>
      </div>
    );
  }

  if (liveFiles.availability === "not_configured") {
    return (
      <div className="project-files-panel project-files-panel--unavailable">
        <p>
          The project file mirror is turned off. Set <code>EE_LIBRARY_PROJECT_FILES_ROOT</code> on the API host
          to a folder you control and reload this page.
        </p>
      </div>
    );
  }

  if (liveFiles.availability === "error") {
    return (
      <div className="project-files-panel project-files-panel--unavailable">
        <p>The project file mirror could not read the folder on disk.</p>
        {liveFiles.message ? <p className="muted-copy">{liveFiles.message}</p> : null}
      </div>
    );
  }

  return (
    <div className="project-files-panel">
      <p className="project-files-panel__hint muted-copy">
        Drop files into the folders below on the API host, or upload through this page.
        Notes can be typed in directly.
        {liveFiles.rootPath ? (
          <>
            {" "}
            Project root: <code className="ui-mono">{liveFiles.rootPath}</code>
          </>
        ) : null}
      </p>

      <ProjectReentryBrief files={liveFiles} />

      {liveFiles.documentMap ? <ProjectDocumentMapPanel documentMap={liveFiles.documentMap} projectId={projectId} /> : null}

      <ProjectPdfReviewPanel files={liveFiles} projectId={projectId} />

      <div className="project-files-panel__grid">
        {liveFiles.folders.map((folder) => (
          <ProjectFilesCategory folder={folder} key={folder.category} projectId={projectId} />
        ))}
      </div>

      {liveFiles.customHardware ? <CustomDesignsPanel listing={liveFiles.customHardware} /> : null}
    </div>
  );
}

/**
 * Merges lightweight reader states without replacing filesystem classifications or
 * source excerpts that were already loaded by the full project-files response.
 */
export function mergeProjectDocumentExtractionStatuses(
  files: ProjectFilesResponse,
  records: ProjectDocumentExtractionStatusRecord[]
): ProjectFilesResponse {
  if (!files.documentMap || records.length === 0) {
    return files;
  }

  const recordsByPath = new Map(
    records.map((record) => [record.relativePath.replace(/\\/gu, "/"), record.extraction])
  );
  const documents = files.documentMap.documents.map((document) => {
    const nextExtraction = recordsByPath.get(document.relativePath);
    if (!nextExtraction) {
      return document;
    }

    // The polling route intentionally omits extracted source excerpts. Keep excerpts
    // already loaded for completed files until the final full refresh is available.
    const extraction =
      document.extraction?.status === "succeeded" && nextExtraction.status === "succeeded"
        ? document.extraction
        : nextExtraction;
    return { ...document, extraction };
  });
  const summary = {
    ...files.documentMap.summary,
    extractionFailedCount: documents.filter(
      (document) => document.extraction?.status === "failed"
    ).length,
    extractionQueuedCount: documents.filter(
      (document) => document.extraction?.status === "queued"
    ).length,
    extractionRunningCount: documents.filter(
      (document) => document.extraction?.status === "running"
    ).length,
    extractionSucceededCount: documents.filter(
      (document) => document.extraction?.status === "succeeded"
    ).length,
    extractionUnsupportedCount: documents.filter(
      (document) => document.extraction?.status === "unsupported"
    ).length
  };

  return {
    ...files,
    documentMap: {
      ...files.documentMap,
      documents,
      summary
    }
  };
}

/**
 * Project document map. The rows come from a bounded folder scan, so every classification
 * is shown as a sorting hint rather than a reviewed document record.
 */
function ProjectDocumentMapPanel({ documentMap, projectId }: { documentMap: ProjectDocumentMap; projectId: string }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ProjectDocumentMapScope>("all");
  const attentionCount = documentMap.documents.filter((entry) => entry.needsAttention).length;
  const readyCount = documentMap.documents.filter(
    (entry) => !entry.needsAttention && entry.extraction?.status !== "failed" && entry.extraction?.status !== "unsupported"
  ).length;
  const readerIssueCount = documentMap.documents.filter(
    (entry) => entry.extraction?.status === "failed" || entry.extraction?.status === "unsupported"
  ).length;
  const filteredDocuments = useMemo(
    () => filterProjectDocumentMapEntries(documentMap.documents, query, scope),
    [documentMap.documents, query, scope]
  );
  const visibleDocuments = filteredDocuments.slice(0, 16);

  return (
    <section className="custom-hardware-panel" aria-label="Document map">
      <header className="custom-hardware-panel__header">
        <div>
          <h3>Document map</h3>
          <p className="muted-copy">{documentMap.boundary}</p>
          <p className="muted-copy">
            Scanned <code className="ui-mono">{documentMap.scanRootPath}</code>
          </p>
        </div>
        <p className="custom-hardware-panel__path">
          <span className="project-files-card__path-label">Scan limit</span>
          <span>{documentMap.maxFiles} files / {documentMap.maxDepth} folders deep</span>
        </p>
      </header>

      <div className="custom-hardware-panel__summary" aria-label="Document map summary">
        <DocumentMapSummaryItem label="Files mapped" value={documentMap.summary.documentCount} />
        <DocumentMapSummaryItem label="Needs sorting" value={attentionCount} />
        <DocumentMapSummaryItem label="Move suggestions" value={documentMap.summary.moveSuggestionCount} />
        <DocumentMapSummaryItem label="Folder trends" value={documentMap.summary.folderPatternCount} />
        <DocumentMapSummaryItem label="Mixed folders" value={documentMap.summary.mixedFolderCount} />
        <DocumentMapSummaryItem label="Outside folders" value={documentMap.summary.outsideStandardFolderCount} />
        <DocumentMapSummaryItem label="Connector refs" value={documentMap.summary.connectorMentionCount} />
        <DocumentMapSummaryItem label="Pin refs" value={documentMap.summary.pinMentionCount} />
        <DocumentMapSummaryItem label="Text ready" value={documentMap.summary.extractionSucceededCount} />
        <DocumentMapSummaryItem
          label="Reading"
          value={documentMap.summary.extractionQueuedCount + documentMap.summary.extractionRunningCount}
        />
        <DocumentMapSummaryItem label="Read failed" value={documentMap.summary.extractionFailedCount} />
        <DocumentMapSummaryItem label="Unknown" value={documentMap.summary.unknownDocumentCount} />
      </div>

      <ProjectDocumentExtractionNotice documentMap={documentMap} />

      {documentMap.documents.length > 0 ? (
        <div className="document-map-toolbar">
          <label className="document-map-toolbar__search">
            <span>Find a mapped file</span>
            <input
              autoComplete="off"
              name="document-map-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filename, folder, J202, pin 47, cable, fixture, or signal"
              type="search"
              value={query}
            />
          </label>
          <div className="document-map-toolbar__scope" role="group" aria-label="Filter document map">
            <DocumentMapScopeButton
              active={scope === "all"}
              count={documentMap.documents.length}
              label="All"
              onClick={() => setScope("all")}
            />
            <DocumentMapScopeButton
              active={scope === "attention"}
              count={attentionCount}
              label="Needs sorting"
              onClick={() => setScope("attention")}
            />
            <DocumentMapScopeButton
              active={scope === "ready"}
              count={readyCount}
              label="Looks sorted"
              onClick={() => setScope("ready")}
            />
            <DocumentMapScopeButton
              active={scope === "reader_issues"}
              count={readerIssueCount}
              label="Read issues"
              onClick={() => setScope("reader_issues")}
            />
          </div>
          <p className="document-map-toolbar__count muted-copy" aria-live="polite">
            {filteredDocuments.length} of {documentMap.documents.length} file
            {documentMap.documents.length === 1 ? "" : "s"}
          </p>
        </div>
      ) : null}

      {documentMap.folderPatterns.length > 0 ? <ProjectDocumentFolderPatternTable patterns={documentMap.folderPatterns} /> : null}

      {documentMap.documents.length === 0 ? (
        <p className="project-files-card__empty muted-copy">No files found under this project folder yet.</p>
      ) : filteredDocuments.length === 0 ? (
        <p className="document-map-toolbar__empty">
          No mapped files match this search and filter. Try another clue or choose All.
        </p>
      ) : (
        <div className="projects-table-wrap custom-hardware-panel__table-wrap">
          <table className="projects-table custom-hardware-panel__table">
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Clues</th>
                <th>Document reader</th>
                <th>Suggested place</th>
                <th>Attention</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocuments.map((entry) => (
                <ProjectDocumentMapRow entry={entry} key={entry.id} projectId={projectId} />
              ))}
            </tbody>
          </table>
          {filteredDocuments.length > visibleDocuments.length ? (
            <p className="muted-copy">
              Showing the first {visibleDocuments.length} of {filteredDocuments.length} matching files.
            </p>
          ) : null}
        </div>
      )}

      {documentMap.summary.skippedCount > 0 ? (
        <p className="muted-copy">
          {documentMap.summary.skippedCount} file or folder{documentMap.summary.skippedCount === 1 ? "" : "s"} skipped by scan limits.
        </p>
      ) : null}
    </section>
  );
}

/** Renders one document-map scope button with a stable count. */
function DocumentMapScopeButton({
  active,
  count,
  label,
  onClick
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-pressed={active} onClick={onClick} type="button">
      {label} <span>{count}</span>
    </button>
  );
}

/** Filters mapped documents by review scope and common engineering lookup text. */
export function filterProjectDocumentMapEntries(
  documents: ProjectDocumentMapEntry[],
  rawQuery: string,
  scope: ProjectDocumentMapScope
): ProjectDocumentMapEntry[] {
  const query = rawQuery.trim().toLowerCase();

  return documents.filter((entry) => {
    const scopeMatches =
      scope === "all" ||
      (scope === "attention" && entry.needsAttention) ||
      (scope === "ready" &&
        !entry.needsAttention &&
        entry.extraction?.status !== "failed" &&
        entry.extraction?.status !== "unsupported") ||
      (scope === "reader_issues" &&
        (entry.extraction?.status === "failed" || entry.extraction?.status === "unsupported"));
    if (!scopeMatches) {
      return false;
    }
    if (!query) {
      return true;
    }

    const searchText = [
      entry.filename,
      entry.relativePath,
      entry.parentFolder,
      entry.documentType,
      formatProjectDocumentType(entry.documentType),
      entry.reason,
      entry.sortPlan.reason,
      entry.sortPlan.targetRelativePath ?? "",
      ...entry.signals.connectorRefs,
      ...entry.signals.pinRefs,
      ...entry.signals.pinRefs.map((pinRef) => `pin ${pinRef}`),
      ...entry.signals.cableKeys,
      ...entry.signals.fixtureKeys,
      ...entry.signals.revisionLabels,
      ...entry.signals.signalNames
    ].join(" ").toLowerCase();
    return searchText.includes(query);
  });
}

/** Explains automatic PDF/Office reading and surfaces active or failed work. */
function ProjectDocumentExtractionNotice({ documentMap }: { documentMap: ProjectDocumentMap }) {
  const activeCount =
    documentMap.summary.extractionQueuedCount + documentMap.summary.extractionRunningCount;
  const failedCount = documentMap.summary.extractionFailedCount;
  const unsupportedCount = documentMap.summary.extractionUnsupportedCount;

  if (activeCount === 0 && failedCount === 0 && unsupportedCount === 0) {
    return null;
  }

  return (
    <div className="project-document-reader-notice" aria-label="Document reader status">
      <strong>
        {activeCount > 0
          ? `Reading ${activeCount} document${activeCount === 1 ? "" : "s"} in the background`
          : "Document reader attention"}
      </strong>
      <span>
        {activeCount > 0
          ? "Large PDFs and workbooks can take a few minutes. This page updates automatically, and you can keep working."
          : "The original files were not changed."}
      </span>
      {failedCount > 0 ? (
        <span>{failedCount} file{failedCount === 1 ? "" : "s"} could not be read. See its row for recovery details.</span>
      ) : null}
      {unsupportedCount > 0 ? (
        <span>{unsupportedCount} older Office file{unsupportedCount === 1 ? "" : "s"} need saving as DOCX, XLSX, or PPTX.</span>
      ) : null}
    </div>
  );
}

/** Renders folder-level trends so messy project trees have an obvious first sorting pass. */
function ProjectDocumentFolderPatternTable({ patterns }: { patterns: ProjectDocumentFolderPattern[] }) {
  return (
    <details
      className="custom-hardware-panel__folder-patterns"
      aria-label="Folder trends"
      open={patterns.length <= 2}
    >
      <summary>
        <span>Folder trends</span>
        <small>{patterns.length} pattern{patterns.length === 1 ? "" : "s"} found from folder names and file mixes</small>
      </summary>
      <div className="projects-table-wrap custom-hardware-panel__table-wrap">
        <table className="projects-table custom-hardware-panel__table">
          <thead>
            <tr>
              <th>Folder</th>
              <th>Trend</th>
              <th>Suggested sorting</th>
              <th>Examples</th>
            </tr>
          </thead>
          <tbody>
            {patterns.slice(0, 6).map((pattern) => (
              <ProjectDocumentFolderPatternRow key={pattern.id} pattern={pattern} />
            ))}
          </tbody>
        </table>
      </div>
      {patterns.length > 6 ? <p className="muted-copy">Showing the first 6 folder trends that most need attention.</p> : null}
    </details>
  );
}

/** Renders one folder-level trend row with confidence, clues, and example files. */
function ProjectDocumentFolderPatternRow({ pattern }: { pattern: ProjectDocumentFolderPattern }) {
  return (
    <tr>
      <td>
        <span className="ui-mono">{pattern.folderPath === "." ? "Project root" : pattern.folderPath}</span>
        <div className="muted-copy">
          {pattern.fileCount} file{pattern.fileCount === 1 ? "" : "s"} - {pattern.outsideStandardFolders ? "Outside folders" : formatCurrentProjectFolder(pattern.currentCategory, pattern.folderPath)}
        </div>
      </td>
      <td>
        <span>{formatFolderPatternTrend(pattern)}</span>
        <div className="muted-copy">{Math.round(pattern.confidenceScore * 100)}% - {pattern.reason}</div>
        {formatFolderPatternTypeMix(pattern) ? <div className="muted-copy">{formatFolderPatternTypeMix(pattern)}</div> : null}
      </td>
      <td>
        <span>{formatFolderPatternAction(pattern)}</span>
        {pattern.suggestedFolderLabel ? <div className="muted-copy">Likely folder: {pattern.suggestedFolderLabel}</div> : null}
        {pattern.moveSuggestionCount > 0 ? (
          <div className="muted-copy">
            {pattern.moveSuggestionCount} file{pattern.moveSuggestionCount === 1 ? "" : "s"} with copy suggestions below
          </div>
        ) : null}
        {pattern.unknownDocumentCount > 0 ? (
          <div className="muted-copy">
            {pattern.unknownDocumentCount} unclear file{pattern.unknownDocumentCount === 1 ? "" : "s"}
          </div>
        ) : null}
      </td>
      <td>
        <ul className="where-used-role-list">
          {pattern.exampleFilenames.map((filename) => (
            <li key={filename}>
              <code className="ui-mono">{filename}</code>
            </li>
          ))}
        </ul>
        {renderFolderPatternSignals(pattern.signals)}
      </td>
    </tr>
  );
}

/** Renders one compact document-map summary metric. */
function DocumentMapSummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="custom-hardware-panel__summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** Renders one document-map row with file clues, a sorting hint, and safe copy action. */
function ProjectDocumentMapRow({ entry, projectId }: { entry: ProjectDocumentMapEntry; projectId: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "success" | "error">("idle");
  const [copyMessage, setCopyMessage] = useState("");
  const canCopySuggestion = entry.sortPlan.action === "move_to_standard_folder" && Boolean(entry.sortPlan.targetRelativePath);

  const onCopySuggestion = useCallback(async () => {
    setCopyStatus("copying");
    setCopyMessage("Copying file...");

    try {
      const result = await copyProjectDocumentSuggestion(projectId, {
        sourceRelativePath: entry.relativePath
      });
      setCopyStatus("success");
      setCopyMessage(`Copied to ${result.targetRelativePath}. Original left in place.`);
      reloadAfterMutation();
    } catch (error) {
      setCopyStatus("error");
      setCopyMessage(formatUploadError(error));
    }
  }, [entry.relativePath, projectId]);

  return (
    <tr>
      <td>
        <span className="ui-mono">{entry.filename}</span>
        <div className="muted-copy">{entry.relativePath}</div>
        <div className="muted-copy">
          {formatBytes(entry.sizeBytes)} - {entry.modifiedAt ? formatDateTime(entry.modifiedAt) : "Unknown date"}
        </div>
      </td>
      <td>
        <span>{formatProjectDocumentType(entry.documentType)}</span>
        <div className="muted-copy">{Math.round(entry.confidenceScore * 100)}% - {entry.reason}</div>
      </td>
      <td>{renderProjectDocumentSignals(entry)}</td>
      <td>
        <ProjectDocumentExtractionCell entry={entry} projectId={projectId} />
      </td>
      <td>
        <span>{formatDocumentSortAction(entry)}</span>
        {entry.sortPlan.targetRelativePath ? (
          <div className="muted-copy">
            Put at: <code className="ui-mono">{entry.sortPlan.targetRelativePath}</code>
          </div>
        ) : (
          <div className="muted-copy">{formatSuggestedProjectFolder(entry.suggestedCategory)}</div>
        )}
        <div className="muted-copy">Now: {formatCurrentProjectFolder(entry.currentCategory, entry.parentFolder)}</div>
        <div className="muted-copy">{entry.sortPlan.reason}</div>
        {canCopySuggestion ? (
          <button
            aria-label={`Copy ${entry.filename} to suggested folder`}
            className="button-link button-link--quiet"
            disabled={copyStatus === "copying"}
            onClick={onCopySuggestion}
            type="button"
          >
            {copyStatus === "copying" ? "Copying..." : "Copy to suggested folder"}
          </button>
        ) : null}
        {copyStatus !== "idle" && copyMessage ? (
          <div
            className={
              copyStatus === "error"
                ? "project-files-card__upload-status project-files-card__upload-status--error"
                : "project-files-card__upload-status"
            }
            role={copyStatus === "error" ? "alert" : undefined}
          >
            {copyMessage}
          </div>
        ) : null}
      </td>
      <td>
        <span className="project-files-card__badge">{formatDocumentMapAttention(entry)}</span>
      </td>
    </tr>
  );
}

/** Renders PDF/Office extraction progress, source excerpts, and retry recovery. */
function ProjectDocumentExtractionCell({
  entry,
  projectId
}: {
  entry: ProjectDocumentMapEntry;
  projectId: string;
}) {
  const extraction = entry.extraction;
  const [retryState, setRetryState] = useState<"idle" | "retrying" | "error">("idle");
  const [retryMessage, setRetryMessage] = useState("");

  const onRetry = useCallback(async () => {
    setRetryState("retrying");
    setRetryMessage("Queueing retry...");

    try {
      await retryProjectDocumentExtraction(projectId, {
        sourceRelativePath: entry.relativePath
      });
      setRetryMessage("Retry queued. This page will update automatically.");
      reloadAfterMutation();
    } catch (error) {
      setRetryState("error");
      setRetryMessage(formatUploadError(error));
    }
  }, [entry.relativePath, projectId]);

  if (!extraction) {
    return <span className="custom-hardware-panel__missing">Filename and small-text scan only</span>;
  }

  return (
    <div className="project-document-reader-cell">
      <span className={`project-document-reader-cell__status project-document-reader-cell__status--${extraction.status}`}>
        {formatExtractionStatus(extraction)}
      </span>
      <div className="muted-copy">{extraction.progressMessage}</div>
      {extraction.status === "queued" || extraction.status === "running" ? (
        <>
          <progress
            aria-label={`Document reader progress for ${entry.filename}`}
            max={100}
            value={extraction.progressPercent}
          />
          <div className="muted-copy">
            {formatExtractionWait(extraction)}
            {extraction.queuePosition ? ` - Queue position ${extraction.queuePosition}` : ""}
          </div>
        </>
      ) : null}
      {extraction.status === "succeeded" ? (
        <>
          <div className="muted-copy">
            {formatExtractionSourceCount(extraction)} - {formatNumber(extraction.extractedCharacterCount)} searchable characters
          </div>
          {extraction.sourceLocations.length > 0 ? (
            <details className="project-document-reader-cell__sources">
              <summary>Source excerpts</summary>
              <ul>
                {extraction.sourceLocations.map((location) => (
                  <li key={`${location.label}-${location.textPreview}`}>
                    <strong>{location.label}</strong>
                    <span>{location.textPreview || "No text found in this section."}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
      {extraction.errorMessage ? <div className="project-document-reader-cell__error">{extraction.errorMessage}</div> : null}
      {extraction.status === "failed" ? (
        <button
          className="button-link button-link--quiet"
          disabled={retryState === "retrying"}
          onClick={onRetry}
          type="button"
        >
          {retryState === "retrying" ? "Queueing..." : "Retry reading"}
        </button>
      ) : null}
      {retryMessage ? (
        <div
          className={retryState === "error" ? "project-document-reader-cell__error" : "muted-copy"}
          role={retryState === "error" ? "alert" : undefined}
        >
          {retryMessage}
        </div>
      ) : null}
    </div>
  );
}

/** Renders compact engineering clues extracted from one document-map row. */
function renderProjectDocumentSignals(entry: ProjectDocumentMapEntry): React.ReactNode {
  const groups = [
    entry.signals.connectorRefs.length > 0 ? `Connectors: ${entry.signals.connectorRefs.slice(0, 4).join(", ")}` : null,
    entry.signals.pinRefs.length > 0 ? `Pins: ${entry.signals.pinRefs.slice(0, 4).join(", ")}` : null,
    entry.signals.cableKeys.length > 0 ? `Cables: ${entry.signals.cableKeys.slice(0, 3).join(", ")}` : null,
    entry.signals.fixtureKeys.length > 0 ? `Fixtures: ${entry.signals.fixtureKeys.slice(0, 3).join(", ")}` : null,
    entry.signals.revisionLabels.length > 0 ? `Revisions: ${entry.signals.revisionLabels.slice(0, 3).join(", ")}` : null,
    entry.signals.signalNames.length > 0 ? `Signals: ${entry.signals.signalNames.slice(0, 3).join(", ")}` : null
  ].filter((value): value is string => Boolean(value));

  if (groups.length === 0) {
    return <span className="custom-hardware-panel__missing">No clues found</span>;
  }

  return (
    <ul className="where-used-role-list">
      {groups.slice(0, 4).map((group) => (
        <li key={group}>{group}</li>
      ))}
    </ul>
  );
}

/** Formats a document-map type for engineers sorting a project folder. */
function formatProjectDocumentType(documentType: ProjectDocumentType): string {
  return {
    archive: "Archive",
    cad_model: "CAD model",
    cable_doc: "Cable or harness doc",
    datasheet: "Datasheet or app note",
    drawing: "Drawing",
    fixture_doc: "Fixture doc",
    parts_list: "Parts list",
    pinout: "Connector pinout",
    requirements: "Requirements",
    review_note: "Review note",
    schematic: "Schematic or board file",
    test_procedure: "Test procedure",
    unknown: "Needs sorting"
  }[documentType];
}

/** Formats the current document-reader state in plain language. */
function formatExtractionStatus(extraction: ProjectDocumentExtractionState): string {
  if (extraction.status === "queued") return "Waiting to read";
  if (extraction.status === "running") return `${extraction.progressPercent}% read`;
  if (extraction.status === "succeeded") return "Text ready";
  if (extraction.status === "unsupported") return "Needs newer file format";
  return "Could not read";
}

/** Formats an approximate background-reader wait without presenting it as a deadline. */
function formatExtractionWait(extraction: ProjectDocumentExtractionState): string {
  const seconds = extraction.estimatedWaitSeconds;
  if (!seconds) {
    return "Time remaining is not available";
  }
  if (seconds < 60) {
    return "Usually under a minute";
  }

  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Approximately ${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
}

/** Formats the source-unit count using the extraction format's familiar noun. */
function formatExtractionSourceCount(extraction: ProjectDocumentExtractionState): string {
  const count = extraction.sourceUnitCount ?? extraction.sourceLocations.length;
  const noun =
    extraction.format === "pdf"
      ? "page"
      : extraction.format === "xlsx"
        ? "sheet"
        : extraction.format === "pptx"
          ? "slide"
          : "paragraph group";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Formats a count for compact workstation metadata. */
function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Formats a folder trend title from its strongest document-family hint. */
function formatFolderPatternTrend(pattern: ProjectDocumentFolderPattern): string {
  if (!pattern.dominantDocumentType || pattern.dominantDocumentType === "unknown") {
    return "Needs sorting";
  }

  return `Mostly ${formatProjectDocumentType(pattern.dominantDocumentType).toLowerCase()}s`;
}

/** Formats the safe next step for a folder trend without implying a bulk move happened. */
function formatFolderPatternAction(pattern: ProjectDocumentFolderPattern): string {
  if (pattern.suggestedAction === "use_file_copy_buttons") {
    return `Use file copy buttons for ${pattern.suggestedFolderLabel ?? "the likely folder"}`;
  }
  if (pattern.suggestedAction === "sort_each_file") {
    return "Sort file rows below";
  }
  if (pattern.suggestedAction === "open_folder") {
    return "Open folder first";
  }
  return "Leave folder as is";
}

/** Formats the compact type mix shown under a folder trend. */
function formatFolderPatternTypeMix(pattern: ProjectDocumentFolderPattern): string | null {
  const visibleTypes = pattern.typeCounts.slice(0, 3);
  if (visibleTypes.length === 0) {
    return null;
  }

  return visibleTypes.map((entry) => `${formatProjectDocumentType(entry.documentType)}: ${entry.count}`).join(" / ");
}

/** Renders a short folder-level clue line when connector, pin, cable, or fixture hints exist. */
function renderFolderPatternSignals(signals: ProjectDocumentSignals): React.ReactNode {
  const groups = [
    signals.connectorRefs.length > 0 ? `Connectors: ${signals.connectorRefs.slice(0, 3).join(", ")}` : null,
    signals.pinRefs.length > 0 ? `Pins: ${signals.pinRefs.slice(0, 3).join(", ")}` : null,
    signals.cableKeys.length > 0 ? `Cables: ${signals.cableKeys.slice(0, 2).join(", ")}` : null,
    signals.fixtureKeys.length > 0 ? `Fixtures: ${signals.fixtureKeys.slice(0, 2).join(", ")}` : null
  ].filter((value): value is string => Boolean(value));

  if (groups.length === 0) {
    return null;
  }

  return <div className="muted-copy">{groups.join(" - ")}</div>;
}

/** Formats the current standard folder for one scanned file. */
function formatCurrentProjectFolder(category: ProjectFolderCategory | null, parentFolder: string): string {
  if (!category) {
    return parentFolder === "." ? "Project root" : parentFolder;
  }

  return formatSuggestedProjectFolder(category);
}

/** Formats a standard project folder category. */
function formatSuggestedProjectFolder(category: ProjectFolderCategory | null): string {
  if (category === "datasheets") return "Datasheets";
  if (category === "hardware") return "Custom designs";
  if (category === "models") return "3D models";
  if (category === "notes") return "Notes";
  if (category === "parts_list") return "Parts list";
  return "No suggestion";
}

/** Formats the safe cleanup suggestion for one mapped document. */
function formatDocumentSortAction(entry: ProjectDocumentMapEntry): string {
  if (entry.sortPlan.action === "leave_in_place") return "Leave here";
  if (entry.sortPlan.action === "move_to_standard_folder") return `Move to ${entry.sortPlan.targetFolderLabel ?? "standard folder"}`;
  if (entry.sortPlan.action === "review_unknown") return "Open and sort";
  return "Choose folder";
}

/** Formats why a scanned document needs attention. */
function formatDocumentMapAttention(entry: ProjectDocumentMapEntry): string {
  if (entry.documentType === "unknown") {
    return "Needs sorting";
  }
  if (entry.outsideStandardFolders) {
    return "Outside folders";
  }
  if (entry.suggestedCategory && entry.currentCategory && entry.suggestedCategory !== entry.currentCategory) {
    return "Review folder";
  }
  if (entry.confidenceScore < 0.7) {
    return "Low confidence";
  }
  return "Looks sorted";
}

interface ProjectPdfReviewTarget {
  /** Stable select value built from the full relative path. */
  value: string;
  /** Human-readable folder label for the PDF's observed parent folder. */
  folderLabel: string;
  /** Project file category where the PDF was observed, when it is in a standard folder. */
  category: ProjectFolderCategory | null;
  /** Bare PDF filename as reported by the file mirror. */
  filename: string;
  /** Full relative path preserved in the saved review note. */
  relativePath: string;
  /** Last modified timestamp from the filesystem when available. */
  modifiedAt: string | null;
}

interface ProjectReviewNoteFile {
  /** Bare filename for an existing saved review note. */
  filename: string;
  /** Last modified timestamp from the notes folder when available. */
  modifiedAt: string | null;
}

type ProjectPdfReviewCategory = "drawing" | "electrical" | "mechanical" | "manufacturing" | "documentation";

/**
 * Project PDF review workspace. Review notes are written to the notes folder so redline
 * feedback is visible in the file mirror and remains separated from release approval.
 */
function ProjectPdfReviewPanel({ files, projectId }: { files: ProjectFilesResponse; projectId: string }) {
  const pdfTargets = listProjectPdfReviewTargets(files);
  const existingReviewNotes = listProjectReviewNoteFiles(files);
  const [selectedTargetValue, setSelectedTargetValue] = useState(pdfTargets[0]?.value ?? "");
  const [reviewCategory, setReviewCategory] = useState<ProjectPdfReviewCategory>("drawing");
  const [reviewer, setReviewer] = useState("");
  const [severity, setSeverity] = useState<"review" | "blocker">("review");
  const [location, setLocation] = useState("");
  const [owner, setOwner] = useState("");
  const [redlineNote, setRedlineNote] = useState("");
  const [requestedChange, setRequestedChange] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const selectedTarget = pdfTargets.find((target) => target.value === selectedTargetValue) ?? pdfTargets[0] ?? null;

  useEffect(() => {
    if (!selectedTargetValue && pdfTargets[0]) {
      setSelectedTargetValue(pdfTargets[0].value);
      return;
    }

    if (selectedTargetValue && !pdfTargets.some((target) => target.value === selectedTargetValue)) {
      setSelectedTargetValue(pdfTargets[0]?.value ?? "");
    }
  }, [pdfTargets, selectedTargetValue]);

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!selectedTarget) {
        setStatus("error");
        setMessage("Upload a PDF to the project files before adding a review note.");
        return;
      }

      const trimmedReviewer = reviewer.trim();
      const trimmedLocation = location.trim();
      const trimmedOwner = owner.trim();
      const trimmedRedlineNote = redlineNote.trim();
      const trimmedRequestedChange = requestedChange.trim();

      if (!trimmedReviewer || !trimmedLocation || !trimmedRedlineNote || !trimmedRequestedChange) {
        setStatus("error");
        setMessage("Add reviewer, page/sheet context, red note, and requested correction before saving.");
        return;
      }

      setStatus("saving");
      setMessage("Saving review note...");

      try {
        const filename = buildPdfReviewNoteFilename(selectedTarget.filename);
        const result = await uploadProjectFile(projectId, "notes", {
          filename,
          content: buildPdfReviewNoteContent({
            location: trimmedLocation,
            owner: trimmedOwner,
            redlineNote: trimmedRedlineNote,
            reviewCategory,
            requestedChange: trimmedRequestedChange,
            reviewer: trimmedReviewer,
            severity,
            target: selectedTarget
          })
        });
        setStatus("success");
        setMessage(`Saved review as ${result.entry.name}.`);
        setLocation("");
        setOwner("");
        setRedlineNote("");
        setRequestedChange("");
        reloadAfterMutation();
      } catch (error) {
        setStatus("error");
        setMessage(formatUploadError(error));
      }
    },
    [location, owner, projectId, redlineNote, requestedChange, reviewCategory, reviewer, selectedTarget, severity]
  );

  return (
    <section className="project-review-panel" aria-label="PDF review">
      <header className="project-review-panel__header">
        <div>
          <h3>PDF review</h3>
          <p className="muted-copy">
            Capture red notes and requested corrections against project PDFs. Saved notes are review items, not approvals.
          </p>
        </div>
        <div className="project-review-panel__counts">
          <span className="project-review-panel__count">{pdfTargets.length} PDF{pdfTargets.length === 1 ? "" : "s"}</span>
          <span className="project-review-panel__count">{existingReviewNotes.length} saved review note{existingReviewNotes.length === 1 ? "" : "s"}</span>
        </div>
      </header>

      {existingReviewNotes.length > 0 ? (
        <div className="project-review-panel__existing" aria-label="Saved PDF review notes">
          <h4>Saved review notes</h4>
          <ul>
            {existingReviewNotes.slice(0, 5).map((note) => (
              <li key={note.filename}>
                <code className="ui-mono">{note.filename}</code>
                {note.modifiedAt ? <span>{formatDateTime(note.modifiedAt)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pdfTargets.length === 0 ? (
        <p className="project-review-panel__empty muted-copy">
          No PDFs found in project folders yet. Upload drawings, datasheets, or review packets as PDFs to start a review.
        </p>
      ) : (
        <form className="project-review-panel__form" onSubmit={onSubmit}>
          <label className="project-review-panel__field">
            <span>PDF to review</span>
            <select value={selectedTarget?.value ?? ""} onChange={(event) => setSelectedTargetValue(event.target.value)}>
              {pdfTargets.map((target) => (
                <option key={target.value} value={target.value}>
                  {target.folderLabel} - {target.filename}
                </option>
              ))}
            </select>
          </label>

          <div className="project-review-panel__row">
            <label className="project-review-panel__field">
              <span>Review category</span>
              <select value={reviewCategory} onChange={(event) => setReviewCategory(readPdfReviewCategory(event.target.value))}>
                <option value="drawing">Drawing / title block</option>
                <option value="electrical">Electrical / PCB</option>
                <option value="mechanical">Mechanical fit</option>
                <option value="manufacturing">Manufacturing package</option>
                <option value="documentation">Documentation</option>
              </select>
            </label>
            <label className="project-review-panel__field">
              <span>Reviewer</span>
              <input maxLength={120} onChange={(event) => setReviewer(event.target.value)} placeholder="Name or initials" type="text" value={reviewer} />
            </label>
            <label className="project-review-panel__field">
              <span>Severity</span>
              <select value={severity} onChange={(event) => setSeverity(event.target.value === "blocker" ? "blocker" : "review")}>
                <option value="review">Review</option>
                <option value="blocker">Blocker</option>
              </select>
            </label>
          </div>

          <div className="project-review-panel__row">
            <label className="project-review-panel__field">
              <span>Page / sheet / area</span>
              <input maxLength={160} onChange={(event) => setLocation(event.target.value)} placeholder="Page 3, Sheet 2, Detail B" type="text" value={location} />
            </label>
            <label className="project-review-panel__field">
              <span>Correction owner</span>
              <input maxLength={120} onChange={(event) => setOwner(event.target.value)} placeholder="Optional" type="text" value={owner} />
            </label>
          </div>

          <label className="project-review-panel__field">
            <span>Red note</span>
            <textarea
              maxLength={5000}
              onChange={(event) => setRedlineNote(event.target.value)}
              placeholder="Page 3: connector callout does not match the harness drawing."
              rows={3}
              value={redlineNote}
            />
          </label>

          <label className="project-review-panel__field">
            <span>Requested correction</span>
            <textarea
              maxLength={5000}
              onChange={(event) => setRequestedChange(event.target.value)}
              placeholder="Update the callout to J2, regenerate the PDF, and add the corrected drawing to the review packet."
              rows={3}
              value={requestedChange}
            />
          </label>

          {selectedTarget ? (
            <p className="project-review-panel__target muted-copy">
              Source: {selectedTarget.folderLabel} / <code className="ui-mono">{selectedTarget.filename}</code>
              {selectedTarget.modifiedAt ? <> - {formatDateTime(selectedTarget.modifiedAt)}</> : null}
            </p>
          ) : null}

          <div className="project-review-panel__actions">
            <button className="button-link button-link--quiet" disabled={status === "saving"} type="submit">
              {status === "saving" ? "Saving..." : "Save review note"}
            </button>
            {status !== "idle" && message ? (
              <span
                className={
                  status === "error"
                    ? "project-files-card__upload-status project-files-card__upload-status--error"
                    : "project-files-card__upload-status"
                }
                role={status === "error" ? "alert" : undefined}
              >
                {message}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Project re-entry brief. This is intentionally derived only from file-backed reads so
 * an engineer returning to an old project can see what exists without stale guesses.
 */
function ProjectReentryBrief({ files }: { files: ProjectFilesResponse }) {
  const brief = buildProjectReentryBrief(files);

  return (
    <section className="project-reentry-brief" aria-label="Project re-entry brief">
      <header className="project-reentry-brief__header">
        <div>
          <h3>Re-entry brief</h3>
          <p className="muted-copy">{brief.headline}</p>
        </div>
        <span className={`project-reentry-brief__status project-reentry-brief__status--${brief.statusTone}`}>{brief.statusLabel}</span>
      </header>

      <div className="project-reentry-brief__metrics">
        <ReentryMetric label="Latest file activity" value={brief.latestActivityLabel} />
        <ReentryMetric label="File entries" value={String(brief.fileEntryCount)} />
        <ReentryMetric label="Custom designs" value={String(brief.customDesignCount)} />
        <ReentryMetric label="Folders with files" value={`${brief.foldersWithEntries}/${files.folders.length}`} />
      </div>

      {brief.attentionItems.length > 0 ? (
        <ul className="project-reentry-brief__attention" aria-label="Re-entry attention items">
          {brief.attentionItems.map((item) => (
            <li key={item.label}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="project-reentry-brief__clear muted-copy">No stored-file re-entry gaps detected.</p>
      )}
    </section>
  );
}

/** Renders one compact metric in the re-entry brief. */
function ReentryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="project-reentry-brief__metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Single-category card: header, on-disk path, file list, upload control, and (for
 * notes only) the text composer.
 */
function ProjectFilesCategory({ folder, projectId }: { folder: ProjectFolderListing; projectId: string }) {
  return (
    <section aria-label={folder.label} className="project-files-card">
      <header className="project-files-card__header">
        <h3>{folder.label}</h3>
        <p className="muted-copy">{folder.description}</p>
        <p className="project-files-card__path">
          <span className="project-files-card__path-label">Folder</span>
          <code className="ui-mono">{folder.absolutePath}</code>
        </p>
      </header>

      {folder.entries.length === 0 ? (
        <p className="project-files-card__empty muted-copy">No files yet.</p>
      ) : (
        <ul className="project-files-card__list">
          {folder.entries.map((entry) => (
            <li className="project-files-card__row" key={entry.name}>
              <div className="project-files-card__name">
                <span className="ui-mono">{entry.name}</span>
                {entry.isFile ? null : <span className="project-files-card__badge">folder</span>}
              </div>
              <div className="project-files-card__meta muted-copy">
                {entry.isFile && typeof entry.sizeBytes === "number" ? formatBytes(entry.sizeBytes) : "—"}
                {" · "}
                {entry.modifiedAt ? formatDateTime(entry.modifiedAt) : "Unknown date"}
              </div>
            </li>
          ))}
        </ul>
      )}

      <UploadFileControl category={folder.category} projectId={projectId} />
      {folder.category === "notes" ? <NoteComposer projectId={projectId} /> : null}
    </section>
  );
}

/**
 * Custom design register. The records come from filesystem folders and parts-list
 * scans, so missing note fields are rendered as "Not recorded" instead of inferred.
 */
function CustomDesignsPanel({ listing }: { listing: ProjectCustomHardwareListing }) {
  const summary = buildCustomDesignSummary(listing.records);

  return (
    <section className="custom-hardware-panel" aria-label="Custom designs">
      <header className="custom-hardware-panel__header">
        <div>
          <h3>Custom designs</h3>
          <p className="muted-copy">{listing.boundary}</p>
          <p className="muted-copy">Recognized families: {listing.recognizedPrefixes.join(", ")}</p>
        </div>
        <p className="custom-hardware-panel__path">
          <span className="project-files-card__path-label">Design folder</span>
          <code className="ui-mono">{listing.hardwareFolderPath}</code>
        </p>
      </header>

      <div className="custom-hardware-panel__summary" aria-label="Custom design summary">
        <CustomDesignSummaryItem label="Records" value={summary.total} />
        <CustomDesignSummaryItem label="Folders" value={summary.folderBacked} />
        <CustomDesignSummaryItem label="Parts-list only" value={summary.partsListOnly} />
        <CustomDesignSummaryItem label="Documented" value={summary.documented} />
        <CustomDesignSummaryItem label="Needs notes" value={summary.needsNotes} />
      </div>

      {listing.records.length === 0 ? (
        <p className="project-files-card__empty muted-copy">No custom design folders or parts-list references found yet.</p>
      ) : (
        <div className="projects-table-wrap custom-hardware-panel__table-wrap">
          <table className="projects-table custom-hardware-panel__table">
            <thead>
              <tr>
                <th>Design</th>
                <th>Connects to</th>
                <th>Validates</th>
                <th>Project note</th>
                <th>Documentation</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {listing.records.map((record) => (
                <CustomHardwareRow key={record.partNumber} record={record} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Renders one design row with provenance and parts-list mentions kept visible. A folder-only
 * record still needs a note file before its connection/test/project fields are known.
 */
function CustomHardwareRow({ record }: { record: ProjectCustomHardwareRecord }) {
  const documentation = getCustomDesignDocumentation(record);

  return (
    <tr>
      <td>
        <span className="ui-mono">{record.partNumber}</span>
        <div className="custom-hardware-panel__state">
          <span className="project-files-card__badge">{getCustomDesignFamily(record.partNumber)}</span>
          <span className="project-files-card__badge">{formatHardwareState(record)}</span>
        </div>
        {record.notes ? <p className="custom-hardware-panel__notes">{record.notes}</p> : null}
      </td>
      <td>{renderHardwareField(record.connectsTo)}</td>
      <td>{renderHardwareField(record.tests)}</td>
      <td>{renderHardwareField(record.attachedProject)}</td>
      <td>
        <div className="custom-hardware-panel__doc">
          <span className={documentation.missing.length === 0 ? "custom-hardware-panel__doc-status" : "custom-hardware-panel__doc-status custom-hardware-panel__doc-status--needs-work"}>
            {documentation.label}
          </span>
          {documentation.missing.length > 0 ? (
            <span className="custom-hardware-panel__missing">Missing: {documentation.missing.join(", ")}</span>
          ) : null}
        </div>
      </td>
      <td>
        <div className="custom-hardware-panel__source">
          {record.folderName ? (
            <span>
              Folder: <code className="ui-mono">{record.folderName}</code>
            </span>
          ) : null}
          {record.metadataSource ? (
            <span>
              Note: <code className="ui-mono">{record.metadataSource}</code>
            </span>
          ) : (
            <span className="custom-hardware-panel__missing">
              {record.folderState === "folder_backed" ? "No note file" : "No design folder"}
            </span>
          )}
          {record.modifiedAt ? <span>{formatDateTime(record.modifiedAt)}</span> : null}
          {record.mentionedInPartsListFiles.length > 0 ? (
            <span>Parts list: {record.mentionedInPartsListFiles.join(", ")}</span>
          ) : (
            <span className="custom-hardware-panel__missing">No parts-list mention</span>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Small metric block used by the custom-design summary strip.
 */
function CustomDesignSummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="custom-hardware-panel__summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Builds the summary counts for the custom-design register without treating incomplete
 * filesystem notes as validation state.
 */
function buildCustomDesignSummary(records: ProjectCustomHardwareRecord[]) {
  const folderBacked = records.filter((record) => record.folderState === "folder_backed").length;
  const documented = records.filter((record) => getCustomDesignDocumentation(record).missing.length === 0).length;

  return {
    documented,
    folderBacked,
    needsNotes: records.length - documented,
    partsListOnly: records.length - folderBacked,
    total: records.length
  };
}

/**
 * Builds the re-entry brief from project file listings and custom design records. Counts
 * are descriptive only; they do not approve designs or claim release readiness.
 */
function buildProjectReentryBrief(files: ProjectFilesResponse) {
  const customDesignRecords = files.customHardware?.records ?? [];
  const customDesignSummary = buildCustomDesignSummary(customDesignRecords);
  const folderEntryCount = files.folders.reduce((total, folder) => total + folder.entries.length, 0);
  const foldersWithEntries = files.folders.filter((folder) => folder.entries.length > 0).length;
  const latestActivityAt = findLatestProjectFileActivity(files);
  const latestActivityAgeDays = latestActivityAt ? getAgeInDays(latestActivityAt) : null;
  const emptyFolders = files.folders.filter((folder) => folder.entries.length === 0).map((folder) => folder.label);
  const attentionItems: Array<{ label: string; detail: string }> = [];

  if (!latestActivityAt) {
    attentionItems.push({
      detail: "No filesystem timestamp was available from the project mirror.",
      label: "No file activity"
    });
  } else if (latestActivityAgeDays !== null && latestActivityAgeDays > STALE_PROJECT_FILE_DAYS) {
    attentionItems.push({
      detail: `Latest file activity was ${latestActivityAgeDays} days ago.`,
      label: "Stale file set"
    });
  }

  if (customDesignSummary.needsNotes > 0) {
    attentionItems.push({
      detail: "Some design records are missing connects-to, validates, or project fields.",
      label: `${customDesignSummary.needsNotes} design note gap${customDesignSummary.needsNotes === 1 ? "" : "s"}`
    });
  }

  if (customDesignSummary.partsListOnly > 0) {
    attentionItems.push({
      detail: "Parts-list references exist without matching design folders.",
      label: `${customDesignSummary.partsListOnly} BOM-only design reference${customDesignSummary.partsListOnly === 1 ? "" : "s"}`
    });
  }

  if (emptyFolders.length > 0) {
    attentionItems.push({
      detail: emptyFolders.join(", "),
      label: "Empty folders"
    });
  }

  const statusTone = attentionItems.length === 0 ? "ready" : latestActivityAgeDays !== null && latestActivityAgeDays > STALE_PROJECT_FILE_DAYS ? "stale" : "review";

  return {
    attentionItems,
    customDesignCount: customDesignSummary.total,
    fileEntryCount: folderEntryCount,
    foldersWithEntries,
    headline: buildReentryHeadline(latestActivityAt, customDesignSummary.total),
    latestActivityLabel: latestActivityAt ? formatDateTime(latestActivityAt) : "Not recorded",
    statusLabel: statusTone === "ready" ? "Files present" : statusTone === "stale" ? "Stale review" : "Needs review",
    statusTone
  };
}

/**
 * Returns every PDF visible to either the recursive document map or standard folder cards.
 *
 * Relative paths de-duplicate top-level files that appear in both reads and preserve
 * same-named PDFs from different messy folders as separate review targets.
 */
function listProjectPdfReviewTargets(files: ProjectFilesResponse): ProjectPdfReviewTarget[] {
  const targetsByPath = new Map<string, ProjectPdfReviewTarget>();

  for (const document of files.documentMap?.documents ?? []) {
    if (!document.filename.toLowerCase().endsWith(".pdf")) {
      continue;
    }

    targetsByPath.set(document.relativePath, {
      category: document.currentCategory,
      filename: document.filename,
      folderLabel: formatPdfReviewParentFolder(document),
      modifiedAt: document.modifiedAt,
      relativePath: document.relativePath,
      value: document.relativePath
    });
  }

  for (const folder of files.folders) {
    for (const entry of folder.entries) {
      if (!entry.isFile || !entry.name.toLowerCase().endsWith(".pdf")) {
        continue;
      }

      const relativePath = `${readProjectFolderDirectory(folder.category)}/${entry.name}`;
      if (targetsByPath.has(relativePath)) {
        continue;
      }

      targetsByPath.set(relativePath, {
        category: folder.category,
        filename: entry.name,
        folderLabel: folder.label,
        modifiedAt: entry.modifiedAt,
        relativePath,
        value: relativePath
      });
    }
  }

  return Array.from(targetsByPath.values()).sort(comparePdfReviewTargets);
}

/** Formats a recursive PDF's parent folder without hiding messy-folder locations. */
function formatPdfReviewParentFolder(document: ProjectDocumentMapEntry): string {
  if (document.parentFolder === ".") {
    return "Project root";
  }
  if (document.currentCategory && !document.parentFolder.includes("/")) {
    return formatSuggestedProjectFolder(document.currentCategory);
  }
  return document.parentFolder;
}

/** Maps a standard project category to its stable on-disk directory name. */
function readProjectFolderDirectory(category: ProjectFolderCategory): string {
  if (category === "parts_list") return "parts-list";
  if (category === "hardware") return "hardware";
  if (category === "datasheets") return "datasheets";
  if (category === "models") return "models";
  return "notes";
}

/**
 * Lists saved Markdown review notes already visible in the notes folder. This gives the
 * working engineer a quick signal that review corrections exist without reading files.
 */
function listProjectReviewNoteFiles(files: ProjectFilesResponse): ProjectReviewNoteFile[] {
  const notesFolder = files.folders.find((folder) => folder.category === "notes");
  return (notesFolder?.entries ?? [])
    .filter((entry) => entry.isFile && /^review-.+\.md$/iu.test(entry.name))
    .map((entry) => ({
      filename: entry.name,
      modifiedAt: entry.modifiedAt
    }))
    .sort((left, right) => compareOptionalIsoDateDesc(left.modifiedAt, right.modifiedAt) || left.filename.localeCompare(right.filename));
}

/**
 * Orders PDFs in the way engineers usually review a project: drawings first, then design
 * folders, notes/review packets, and finally source parts lists.
 */
function comparePdfReviewTargets(left: ProjectPdfReviewTarget, right: ProjectPdfReviewTarget): number {
  const folderOrder = getPdfReviewFolderOrder(left.category) - getPdfReviewFolderOrder(right.category);
  if (folderOrder !== 0) {
    return folderOrder;
  }

  return compareOptionalIsoDateDesc(left.modifiedAt, right.modifiedAt) || left.filename.localeCompare(right.filename);
}

/** Returns a stable folder-priority rank for PDF review selection. */
function getPdfReviewFolderOrder(category: ProjectFolderCategory | null): number {
  if (category === "datasheets") {
    return 0;
  }
  if (category === "models") {
    return 1;
  }
  if (category === "hardware") {
    return 2;
  }
  if (category === "notes") {
    return 3;
  }
  if (category === "parts_list") {
    return 4;
  }
  return 5;
}

/** Sorts nullable ISO timestamps newest first while keeping invalid dates at the bottom. */
function compareOptionalIsoDateDesc(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }
  return 0;
}

/** Parses the review category select value with a safe fallback. */
function readPdfReviewCategory(value: string): ProjectPdfReviewCategory {
  return value === "electrical" || value === "mechanical" || value === "manufacturing" || value === "documentation"
    ? value
    : "drawing";
}

/**
 * Returns a concise display label for Markdown review notes.
 */
function formatPdfReviewCategory(value: ProjectPdfReviewCategory): string {
  if (value === "electrical") {
    return "Electrical / PCB";
  }
  if (value === "mechanical") {
    return "Mechanical fit";
  }
  if (value === "manufacturing") {
    return "Manufacturing package";
  }
  if (value === "documentation") {
    return "Documentation";
  }
  return "Drawing / title block";
}

/**
 * Builds deterministic-enough filenames for review notes while leaving collision suffixes
 * to the API file writer.
 */
function buildPdfReviewNoteFilename(pdfFilename: string): string {
  const stem = pdfFilename.replace(/\.pdf$/iu, "");
  const safeStem = stem
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "");
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");

  return `review-${safeStem || "pdf"}-${timestamp}.md`;
}

/**
 * Serializes one PDF review note as Markdown so it is readable both in EE Library and
 * directly from the project notes folder.
 */
function buildPdfReviewNoteContent(input: {
  location: string;
  owner: string;
  redlineNote: string;
  reviewCategory: ProjectPdfReviewCategory;
  requestedChange: string;
  reviewer: string;
  severity: "review" | "blocker";
  target: ProjectPdfReviewTarget;
}): string {
  return [
    `# PDF Review - ${input.target.filename}`,
    "",
    `PDF: ${input.target.relativePath}`,
    `Category: ${formatPdfReviewCategory(input.reviewCategory)}`,
    `Location: ${input.location}`,
    `Reviewer: ${input.reviewer}`,
    `Correction owner: ${input.owner || "Unassigned"}`,
    `Severity: ${input.severity}`,
    "Status: open",
    "",
    "## Red note",
    "",
    input.redlineNote,
    "",
    "## Requested correction",
    "",
    input.requestedChange,
    "",
    "## Close-out checklist",
    "",
    "- [ ] Correction made in source file",
    "- [ ] Corrected PDF regenerated and uploaded",
    "- [ ] Reviewer rechecked the corrected PDF",
    ""
  ].join("\n");
}

/**
 * Builds the brief headline from known activity and custom design counts without
 * guessing project health from absent data.
 */
function buildReentryHeadline(latestActivityAt: string | null, customDesignCount: number): string {
  const designCopy = customDesignCount === 1 ? "1 custom design" : `${customDesignCount} custom designs`;
  if (!latestActivityAt) {
    return `${designCopy}; no file activity timestamp recorded.`;
  }

  return `${designCopy}; latest file activity ${formatDateTime(latestActivityAt)}.`;
}

/**
 * Finds the latest timestamp across category entries and custom design records.
 */
function findLatestProjectFileActivity(files: ProjectFilesResponse): string | null {
  const timestamps = [
    ...files.folders.flatMap((folder) => folder.entries.map((entry) => entry.modifiedAt)),
    ...(files.customHardware?.records.map((record) => record.modifiedAt) ?? [])
  ];
  const latestTime = timestamps.reduce<number | null>((latest, timestamp) => {
    if (!timestamp) {
      return latest;
    }

    const parsed = Date.parse(timestamp);
    if (!Number.isFinite(parsed)) {
      return latest;
    }

    return latest === null || parsed > latest ? parsed : latest;
  }, null);

  return latestTime === null ? null : new Date(latestTime).toISOString();
}

/**
 * Returns whole elapsed days for stale-project checks. Future timestamps count as fresh
 * rather than creating negative copy in the UI.
 */
function getAgeInDays(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000)));
}

/**
 * Calculates whether the note captures the three fields engineers need to understand a
 * custom design later: connection, validation intent, and project attachment.
 */
function getCustomDesignDocumentation(record: ProjectCustomHardwareRecord) {
  const missing: string[] = [];
  if (!record.connectsTo) {
    missing.push("connects to");
  }
  if (!record.tests) {
    missing.push("validates");
  }
  if (!record.attachedProject) {
    missing.push("project");
  }

  return {
    label: missing.length === 0 ? "Complete" : `${3 - missing.length}/3 fields`,
    missing
  };
}

/**
 * Extracts the design family from the canonical part number for compact row scanning.
 */
function getCustomDesignFamily(partNumber: string): string {
  return partNumber.split("-")[0] ?? partNumber;
}

/**
 * Renders a nullable design metadata field without substituting guesses from folder
 * names, current project context, or parts-list mentions.
 */
function renderHardwareField(value: string | null): React.ReactNode {
  return value ? value : <span className="custom-hardware-panel__missing">Not recorded</span>;
}

/**
 * Maps the record origin into compact copy for the part-number column.
 */
function formatHardwareState(record: ProjectCustomHardwareRecord): string {
  return record.folderState === "folder_backed" ? "folder" : "parts-list only";
}

/**
 * Per-card file upload control. Reads the selected file as base64 in the browser, then
 * posts to the API. Errors surface inline so the engineer can correct and retry.
 */
function UploadFileControl({ category, projectId }: { category: ProjectFolderCategory; projectId: string }) {
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  const onChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        setStatus("error");
        setMessage(`File is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
        return;
      }

      setStatus("uploading");
      setMessage(`Uploading ${file.name}…`);

      try {
        const contentBase64 = await readFileAsBase64(file);
        const result = await uploadProjectFile(projectId, category, {
          filename: file.name,
          contentBase64
        });
        setStatus("success");
        setMessage(`Saved as ${result.entry.name}.`);
        reloadAfterMutation();
      } catch (error) {
        setStatus("error");
        setMessage(formatUploadError(error));
      }
    },
    [category, projectId]
  );

  return (
    <div className="project-files-card__upload">
      <label className="project-files-card__upload-label">
        <span className="project-files-card__upload-prompt">Upload file</span>
        <input
          aria-label={`Upload file to ${category.replace("_", " ")}`}
          className="project-files-card__upload-input"
          disabled={status === "uploading"}
          onChange={onChange}
          type="file"
        />
      </label>
      {status !== "idle" && message ? (
        <p
          className={
            status === "error"
              ? "project-files-card__upload-status project-files-card__upload-status--error"
              : "project-files-card__upload-status"
          }
          role={status === "error" ? "alert" : undefined}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Inline note composer: title becomes the filename, body is written verbatim. Saves as
 * Markdown so the file is human-readable on disk.
 */
function NoteComposer({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedTitle = title.trim();
      const trimmedBody = body.trim();
      if (!trimmedTitle || !trimmedBody) {
        setStatus("error");
        setMessage("Add a short title and a few words of detail before saving.");
        return;
      }

      setStatus("saving");
      setMessage("Saving note…");

      try {
        const result = await uploadProjectFile(projectId, "notes", {
          filename: `${trimmedTitle}.md`,
          content: `# ${trimmedTitle}\n\n${trimmedBody}\n`
        });
        setStatus("success");
        setMessage(`Saved as ${result.entry.name}.`);
        setTitle("");
        setBody("");
        reloadAfterMutation();
      } catch (error) {
        setStatus("error");
        setMessage(formatUploadError(error));
      }
    },
    [body, projectId, title]
  );

  return (
    <form className="project-files-card__compose" onSubmit={onSubmit}>
      <p className="project-files-card__compose-prompt">Or write a new note</p>
      <label className="project-files-card__compose-field">
        <span>Title</span>
        <input
          maxLength={120}
          name="note-title"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Considered alternates for U3"
          type="text"
          value={title}
        />
      </label>
      <label className="project-files-card__compose-field">
        <span>What did you decide and why?</span>
        <textarea
          maxLength={8000}
          name="note-body"
          onChange={(event) => setBody(event.target.value)}
          placeholder="GRM31 was rejected — lead time too long. Sticking with GRM21 because…"
          rows={4}
          value={body}
        />
      </label>
      <div className="project-files-card__compose-actions">
        <button className="button-link button-link--quiet" disabled={status === "saving"} type="submit">
          {status === "saving" ? "Saving…" : "Save note"}
        </button>
        {status !== "idle" && message ? (
          <span
            className={
              status === "error"
                ? "project-files-card__upload-status project-files-card__upload-status--error"
                : "project-files-card__upload-status"
            }
            role={status === "error" ? "alert" : undefined}
          >
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Reads a browser File and returns its base64 content (without the `data:...,` prefix).
 * The FileReader API surfaces failures as null so the upload control can show a calm
 * inline error rather than crashing the page.
 */
async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("File read failed."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected file reader payload."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Maps API client failures to short, human-readable messages. Everything else falls
 * back to a generic "could not save" line so we never expose stack traces in the UI.
 */
function formatUploadError(error: unknown): string {
  if (isApiClientError(error)) {
    if (error.code === "PROJECT_FILE_TOO_LARGE") {
      return "That file is larger than the upload limit.";
    }
    if (error.code === "INVALID_PROJECT_FILE_NAME") {
      return "That filename is not supported. Use letters, numbers, dashes, or dots.";
    }
    if (error.code === "PROJECT_FILES_NOT_CONFIGURED") {
      return "The file mirror is turned off on the API host.";
    }
    if (error.code === "INVALID_PROJECT_FILE_CONTENT") {
      return "The file could not be read. Pick the file again and retry.";
    }
    return `${error.code}: ${error.message}`;
  }
  return "Could not save the upload. Try again or refresh the page.";
}

/**
 * Formats raw byte counts using the smallest sensible unit (B, KB, MB, GB) so file sizes
 * stay scannable in the dense workspace layout.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Formats ISO timestamps the same way the rest of the project workspace does.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
