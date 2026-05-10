"use client";

/**
 * File header: Project file mirror UI with browser uploads and a notes composer.
 *
 * The panel renders one card per category folder. Engineers can either:
 *   - Drop files directly into the OS folder shown on the card.
 *   - Upload through the browser using the per-card file input.
 *   - For the `notes` card only, compose a plain-text/Markdown note inline so reasoning
 *     for considered-but-rejected parts gets captured without leaving the workspace.
 *
 * After every successful upload the page reloads via `router.refresh()` so the listing
 * stays the source of truth — we never patch local state to imply a file landed when it
 * did not.
 */

import React, { useCallback, useState } from "react";
import { buildProjectFileAccessUrl, uploadProjectFile } from "../lib/api-client";
import { isApiClientError } from "../lib/api-client";
import type { ProjectFilesResponse, ProjectFolderCategory, ProjectFolderEntry, ProjectFolderListing } from "@ee-library/shared/types";

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
          The project file mirror is turned off. Set <code>EE_LIBRARY_PROJECT_FILES_ROOT</code> on the API host
          to a folder you control and reload this page.
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

      <div className="project-files-panel__grid">
        {files.folders.map((folder) => (
          <ProjectFilesCategory folder={folder} key={folder.category} projectId={projectId} />
        ))}
      </div>
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
                {entry.isFile && entry.mimeType ? (
                  <>
                    {" / "}
                    {formatFileKind(entry.mimeType)}
                  </>
                ) : null}
              </div>
              {entry.isFile ? <ProjectFileActions entry={entry} /> : null}
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
 * Renders plain-language file actions. The SHA-256 hash is labeled as a file ID so
 * engineers can compare duplicates without learning internal evidence/asset terms.
 */
function ProjectFileActions({ entry }: { entry: ProjectFolderEntry }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const previewUrl = buildProjectFileAccessUrl(entry.previewUrl);
  const downloadUrl = buildProjectFileAccessUrl(entry.downloadUrl);

  const copyFileId = useCallback(async () => {
    if (!entry.sha256) {
      return;
    }

    try {
      await navigator.clipboard.writeText(entry.sha256);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }, [entry.sha256]);

  return (
    <div className="project-files-card__actions">
      {previewUrl ? (
        <a className="project-files-card__action" href={previewUrl} rel="noreferrer" target="_blank">
          Open
        </a>
      ) : null}
      {downloadUrl ? (
        <a className="project-files-card__action" href={downloadUrl}>
          Download
        </a>
      ) : null}
      {entry.sha256 ? (
        <button className="project-files-card__action" onClick={() => void copyFileId()} type="button">
          Copy file ID
        </button>
      ) : null}
      {copyState !== "idle" ? (
        <span className="project-files-card__fingerprint-status muted-copy" role={copyState === "failed" ? "alert" : undefined}>
          {copyState === "copied" ? "Copied" : "Copy failed"}
        </span>
      ) : null}
    </div>
  );
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
 * Converts MIME types into short labels that make sense to engineers scanning a folder.
 */
function formatFileKind(mimeType: string): string {
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "Spreadsheet";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("text/")) return "Text";
  if (mimeType.includes("step")) return "STEP";
  if (mimeType.includes("stl")) return "STL";
  return "File";
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
