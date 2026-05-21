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

import React, { useCallback, useEffect, useState } from "react";
import { uploadProjectFile } from "../lib/api-client";
import { isApiClientError } from "../lib/api-client";
import type {
  ProjectCustomHardwareListing,
  ProjectCustomHardwareRecord,
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

/**
 * Top-level panel. Decides which honest state to render and otherwise lays out one
 * category card per folder, plus the inline notes composer.
 */
export function ProjectFilesPanel({ projectId, files }: ProjectFilesPanelProps) {
  if (!files) {
    return (
      <div className="project-files-panel project-files-panel--unavailable">
        <p>The file mirror is paused because the project record is unavailable.</p>
      </div>
    );
  }

  if (files.availability === "not_configured") {
    return (
      <div className="project-files-panel project-files-panel--unavailable">
        <p>
          The project file mirror is turned off. Ask an admin to set a project file folder in the admin workspace, then reload this page.
        </p>
      </div>
    );
  }

  if (files.availability === "error") {
    return (
      <div className="project-files-panel project-files-panel--unavailable">
        <p>The project file mirror could not read the folder on disk.</p>
        {files.message ? <p className="muted-copy">{files.message}</p> : null}
      </div>
    );
  }

  return (
    <div className="project-files-panel">
      <p className="project-files-panel__hint muted-copy">
        Drop files into the folders below on the API host, or upload through this page.
        Notes can be typed in directly.
        {files.rootPath ? (
          <>
            {" "}
            Project root: <code className="ui-mono">{files.rootPath}</code>
          </>
        ) : null}
      </p>

      <ProjectReentryBrief files={files} />

      <ProjectPdfReviewPanel files={files} projectId={projectId} />

      <div className="project-files-panel__grid">
        {files.folders.map((folder) => (
          <ProjectFilesCategory folder={folder} key={folder.category} projectId={projectId} />
        ))}
      </div>

      {files.customHardware ? <CustomDesignsPanel listing={files.customHardware} /> : null}
    </div>
  );
}

interface ProjectPdfReviewTarget {
  /** Stable select value built from folder category and filename. */
  value: string;
  /** Human-readable folder label for the PDF's source category. */
  folderLabel: string;
  /** Project file category where the PDF was observed. */
  category: ProjectFolderCategory;
  /** Bare PDF filename as reported by the file mirror. */
  filename: string;
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
        <ReentryMetric label="Evidence folders" value={`${brief.foldersWithEntries}/${files.folders.length}`} />
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
      label: "Empty evidence folders"
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
    statusLabel: statusTone === "ready" ? "File-backed" : statusTone === "stale" ? "Stale review" : "Needs review",
    statusTone
  };
}

/**
 * Returns every top-level PDF visible to the file mirror. The API does not recurse into
 * nested design folders yet, so this list is honest about what the current read can see.
 */
function listProjectPdfReviewTargets(files: ProjectFilesResponse): ProjectPdfReviewTarget[] {
  return files.folders
    .flatMap((folder) =>
      folder.entries
        .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".pdf"))
        .map((entry) => ({
          category: folder.category,
          filename: entry.name,
          folderLabel: folder.label,
          modifiedAt: entry.modifiedAt,
          value: `${folder.category}:${entry.name}`
        }))
    )
    .sort(comparePdfReviewTargets);
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
function getPdfReviewFolderOrder(category: ProjectFolderCategory): number {
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
  return 4;
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
    `PDF: ${input.target.folderLabel} / ${input.target.filename}`,
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
