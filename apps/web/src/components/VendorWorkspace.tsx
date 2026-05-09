"use client";

/**
 * File header: Vendor workspace UI with browser uploads and a notes composer.
 *
 * Mirrors the project file mirror surface so the two systems feel like one product.
 * Notes accept a title + Markdown body; reference files (capability sheets, drawing
 * standards, sample reports) accept binary uploads. After every successful write the
 * page reloads so the listing matches what is on disk.
 */

import React, { useCallback, useState } from "react";
import { isApiClientError, uploadVendorFile } from "../lib/api-client";
import type { ProjectFolderEntry, VendorDetailResponse, VendorFolderSection } from "@ee-library/shared/types";

/**
 * Refreshes the page so the listing always reflects what's on disk. Using a full reload
 * (instead of `useRouter().refresh()`) keeps the workspace honest about its source of
 * truth — filesystem reads — and avoids depending on an app-router context for SSR
 * rendering or unit tests.
 */
function reloadAfterMutation(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

interface VendorWorkspaceProps {
  /** Detail response from `GET /vendors/:slug`. */
  detail: VendorDetailResponse;
}

/** MAX_UPLOAD_BYTES mirrors the API limit so the UI rejects oversize files locally. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Renders the detail workspace. Three honest states are supported explicitly: configured,
 * not_configured (env var disabled), and error. The "vendor missing" state is handled by
 * the page route, not here, so this component can focus on the everyday workflow.
 */
export function VendorWorkspace({ detail }: VendorWorkspaceProps) {
  if (detail.availability === "not_configured") {
    return (
      <div className="vendor-workspace vendor-workspace--unavailable">
        <p>The supplier folder is not set up on the server. Ask your admin to enable it, then reload.</p>
      </div>
    );
  }

  if (detail.availability === "error") {
    return (
      <div className="vendor-workspace vendor-workspace--unavailable">
        <p>Could not read this supplier&apos;s folder. If someone moved files on the server, try again in a moment.</p>
        {detail.message ? <p className="muted-copy">{detail.message}</p> : null}
      </div>
    );
  }

  if (!detail.vendor) {
    return (
      <div className="vendor-workspace vendor-workspace--unavailable">
        <p>This supplier record is missing.</p>
      </div>
    );
  }

  return (
    <div className="vendor-workspace">
      <p className="vendor-workspace__hint muted-copy">
        If your team keeps a shared drive, you can copy files into the folders below on the API computer.
        Or upload here — the page refreshes after each save so everyone sees the same list.
      </p>

      <div className="vendor-workspace__grid">
        <VendorSectionCard
          absolutePath={detail.notesPath}
          allowCompose
          description="Quality observations, lead times, callouts, and decision history."
          entries={detail.notes}
          label="Notes"
          section="notes"
          slug={detail.vendor.slug}
        />
        <VendorSectionCard
          absolutePath={detail.filesPath}
          allowCompose={false}
          description="Capability sheets, drawing standards, sample reports, contact PDFs."
          entries={detail.files}
          label="Reference files"
          section="files"
          slug={detail.vendor.slug}
        />
      </div>
    </div>
  );
}

interface VendorSectionCardProps {
  absolutePath: string | null;
  allowCompose: boolean;
  description: string;
  entries: ProjectFolderEntry[];
  label: string;
  section: VendorFolderSection;
  slug: string;
}

/**
 * Renders one section card (notes or files) with header, file list, upload control,
 * and (for notes only) the inline composer.
 */
function VendorSectionCard({ absolutePath, allowCompose, description, entries, label, section, slug }: VendorSectionCardProps) {
  return (
    <section aria-label={label} className="vendor-section-card">
      <header className="vendor-section-card__header">
        <h3>{label}</h3>
        <p className="muted-copy">{description}</p>
        {absolutePath ? (
          <p className="vendor-section-card__path">
            <span className="vendor-section-card__path-label">Folder</span>
            <code className="ui-mono">{absolutePath}</code>
          </p>
        ) : null}
      </header>

      {entries.length === 0 ? (
        <p className="vendor-section-card__empty muted-copy">
          {section === "notes" ? "No notes yet." : "No files yet."}
        </p>
      ) : (
        <ul className="vendor-section-card__list">
          {entries.map((entry) => (
            <li className="vendor-section-card__row" key={entry.name}>
              <div className="vendor-section-card__name">
                <span className="ui-mono">{entry.name}</span>
                {entry.isFile ? null : <span className="vendor-section-card__badge">folder</span>}
              </div>
              <div className="vendor-section-card__meta muted-copy">
                {entry.isFile && typeof entry.sizeBytes === "number" ? formatBytes(entry.sizeBytes) : "—"}
                {" · "}
                {entry.modifiedAt ? formatDateTime(entry.modifiedAt) : "Unknown date"}
              </div>
            </li>
          ))}
        </ul>
      )}

      <UploadFileControl section={section} slug={slug} />
      {allowCompose ? <NoteComposer slug={slug} /> : null}
    </section>
  );
}

/** Per-section file upload control. */
function UploadFileControl({ section, slug }: { section: VendorFolderSection; slug: string }) {
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

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
        const result = await uploadVendorFile(slug, section, {
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
    [section, slug]
  );

  return (
    <div className="vendor-section-card__upload">
      <label className="vendor-section-card__upload-label">
        <span className="vendor-section-card__upload-prompt">Upload file</span>
        <input
          aria-label={`Upload file to ${section}`}
          className="vendor-section-card__upload-input"
          disabled={status === "uploading"}
          onChange={onChange}
          type="file"
        />
      </label>
      {status !== "idle" && message ? (
        <p
          className={
            status === "error"
              ? "vendor-section-card__upload-status vendor-section-card__upload-status--error"
              : "vendor-section-card__upload-status"
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
 * Inline note composer: title becomes the filename, body is written verbatim as Markdown
 * so files are human-readable on disk.
 */
function NoteComposer({ slug }: { slug: string }) {
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
        const result = await uploadVendorFile(slug, "notes", {
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
    [body, slug, title]
  );

  return (
    <form className="vendor-section-card__compose" onSubmit={onSubmit}>
      <p className="vendor-section-card__compose-prompt">Or write a new note</p>
      <label className="vendor-section-card__compose-field">
        <span>Title</span>
        <input
          maxLength={120}
          name="vendor-note-title"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Lead time observations Q2"
          type="text"
          value={title}
        />
      </label>
      <label className="vendor-section-card__compose-field">
        <span>What did you observe?</span>
        <textarea
          maxLength={8000}
          name="vendor-note-body"
          onChange={(event) => setBody(event.target.value)}
          placeholder="Standard 4-layer HASL ran 5 business days. Advanced specs (impedance control, blind vias) need 3+ weeks."
          rows={4}
          value={body}
        />
      </label>
      <div className="vendor-section-card__compose-actions">
        <button className="button-link button-link--quiet" disabled={status === "saving"} type="submit">
          {status === "saving" ? "Saving…" : "Save note"}
        </button>
        {status !== "idle" && message ? (
          <span
            className={
              status === "error"
                ? "vendor-section-card__upload-status vendor-section-card__upload-status--error"
                : "vendor-section-card__upload-status"
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

/** Reads a browser File and returns its base64 content (without the data: prefix). */
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

/** Maps API client failures to short, human-readable messages. */
function formatUploadError(error: unknown): string {
  if (isApiClientError(error)) {
    if (error.code === "VENDOR_FILE_TOO_LARGE") return "That file is larger than the upload limit.";
    if (error.code === "INVALID_VENDOR_FILE_NAME") return "That filename is not supported. Use letters, numbers, dashes, or dots.";
    if (error.code === "VENDOR_NOTES_NOT_CONFIGURED") return "The vendor notebook is turned off on the API host.";
    if (error.code === "INVALID_VENDOR_FILE_CONTENT") return "The file could not be read. Pick the file again and retry.";
    if (error.code === "VENDOR_NOT_FOUND") return "This vendor was deleted on disk. Reload the list.";
    return `${error.code}: ${error.message}`;
  }
  return "Could not save the upload. Try again or refresh the page.";
}

/** Formats raw byte counts using the smallest sensible unit. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/** Formats ISO timestamps the same way the rest of the workspace does. */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
