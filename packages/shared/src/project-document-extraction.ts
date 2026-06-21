/**
 * File header: Shared project-document extraction rules.
 *
 * Keeps API queueing and worker processing aligned on supported formats, source
 * fingerprints, extractor versions, size limits, and calm time estimates.
 */

import { createHash } from "node:crypto";
import type { ProjectDocumentExtractionFormat } from "./types";

/** PROJECT_DOCUMENT_EXTRACTOR_VERSION invalidates cached text when extraction rules change. */
export const PROJECT_DOCUMENT_EXTRACTOR_VERSION = "project-document-reader-v2";

/** PROJECT_DOCUMENT_MAX_EXTRACTED_CHARACTERS bounds searchable text retained per document. */
export const PROJECT_DOCUMENT_MAX_EXTRACTED_CHARACTERS = 2_000_000;

/** PROJECT_DOCUMENT_MAX_SOURCE_LOCATIONS bounds source excerpts returned to the project page. */
export const PROJECT_DOCUMENT_MAX_SOURCE_LOCATIONS = 8;

/** PROJECT_DOCUMENT_MAX_FILE_BYTES caps background reading for one PDF or Office document. */
export const PROJECT_DOCUMENT_MAX_FILE_BYTES = 75 * 1024 * 1024;

/** ProjectDocumentSourceFingerprintInput identifies one exact on-disk file revision. */
export interface ProjectDocumentSourceFingerprintInput {
  /** Relative path from the project root. */
  relativePath: string;
  /** File size observed during the document-map scan. */
  sizeBytes: number;
  /** Filesystem modification time observed during the scan. */
  modifiedAt: string | null;
}

/**
 * Returns the supported extraction format for a filename.
 *
 * Legacy binary Office formats intentionally return null because reading them reliably
 * requires an external conversion service such as LibreOffice.
 */
export function readProjectDocumentExtractionFormat(filename: string): ProjectDocumentExtractionFormat | null {
  const extension = readLowercaseExtension(filename);

  if (extension === ".pdf") return "pdf";
  if (extension === ".docx") return "docx";
  if (extension === ".xlsx") return "xlsx";
  if (extension === ".pptx") return "pptx";
  return null;
}

/** Returns true for legacy Office formats that need conversion before extraction. */
export function isLegacyOfficeDocument(filename: string): boolean {
  return [".doc", ".xls", ".ppt"].includes(readLowercaseExtension(filename));
}

/**
 * Builds a stable source fingerprint from path, size, modification time, and extractor
 * version. A changed file or upgraded reader therefore queues fresh extraction.
 */
export function buildProjectDocumentSourceFingerprint(input: ProjectDocumentSourceFingerprintInput): string {
  return createHash("sha256")
    .update(PROJECT_DOCUMENT_EXTRACTOR_VERSION)
    .update("\0")
    .update(input.relativePath.replace(/\\/gu, "/"))
    .update("\0")
    .update(String(input.sizeBytes))
    .update("\0")
    .update(input.modifiedAt ?? "unknown")
    .digest("hex");
}

/**
 * Estimates active reading time from format and file size.
 *
 * This is guidance, not a deadline. PDF work scales more with pages and font layout,
 * while Office containers usually spend less time per megabyte.
 */
export function estimateProjectDocumentExtractionSeconds(
  format: ProjectDocumentExtractionFormat,
  sizeBytes: number
): number {
  const sizeMegabytes = Math.max(sizeBytes / (1024 * 1024), 0.1);
  const secondsPerMegabyte = {
    docx: 1.5,
    pdf: 4,
    pptx: 2,
    xlsx: 2.5
  }[format];
  const baseSeconds = format === "pdf" ? 6 : 4;

  return Math.max(5, Math.min(10 * 60, Math.ceil(baseSeconds + sizeMegabytes * secondsPerMegabyte)));
}

/** Returns a lowercase extension including the leading dot. */
function readLowercaseExtension(filename: string): string {
  const separatorIndex = filename.lastIndexOf(".");
  return separatorIndex >= 0 ? filename.slice(separatorIndex).toLowerCase() : "";
}
