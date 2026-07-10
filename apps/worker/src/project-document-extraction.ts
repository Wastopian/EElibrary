/**
 * File header: Background PDF and Office text extraction for project documents.
 *
 * Claims queued project-document jobs, reads files from the shared project mirror,
 * preserves page/sheet/slide/paragraph-group locations, and stores bounded searchable
 * text. Extraction never changes document approval, review, or release state.
 */

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import { XMLParser } from "fast-xml-parser";
import * as XLSX from "xlsx";
import {
  buildProjectDocumentSourceFingerprint,
  PROJECT_DOCUMENT_EXTRACTOR_VERSION,
  PROJECT_DOCUMENT_MAX_EXTRACTED_CHARACTERS,
  PROJECT_DOCUMENT_MAX_FILE_BYTES
} from "@ee-library/shared/project-document-extraction";
import type {
  ProjectDocumentExtractionFormat,
  ProjectDocumentExtractionSourceLocation
} from "@ee-library/shared/types";
import { getWorkerDatabasePool } from "./catalog-repository";
import type { PoolClient } from "pg";

/** ProjectDocumentExtractionSegment is persisted as page/sheet/slide provenance. */
export interface ProjectDocumentExtractionSegment {
  /** Human-readable location label. */
  label: string;
  /** Normalized extracted text from this source location. */
  text: string;
  /** Short source excerpt returned to the API. */
  textPreview: string;
}

/** ProjectDocumentExtractionOutput is one completed parser result. */
export interface ProjectDocumentExtractionOutput {
  /** Bounded full text retained for search. */
  extractedText: string;
  /** Number of characters retained after normalization and bounding. */
  extractedCharacterCount: number;
  /** Page, sheet, slide, or paragraph-group count. */
  sourceUnitCount: number;
  /** Source-labeled text segments retained for provenance. */
  segments: ProjectDocumentExtractionSegment[];
}

/** ProjectDocumentExtractionProgress reports parser progress without prescribing storage. */
export interface ProjectDocumentExtractionProgress {
  /** Integer progress from 0 through 100. */
  percent: number;
  /** Plain-language current activity. */
  message: string;
}

/** ProjectDocumentExtractionProcessingResult reports one terminal worker outcome. */
export interface ProjectDocumentExtractionProcessingResult {
  /** Persisted job id. */
  jobId: string;
  /** Terminal worker result. */
  status: "succeeded" | "failed" | "superseded";
  /** Stable failure code when reading failed. */
  errorCode: string | null;
}

/** ProjectDocumentExtractionProcessingSummary groups one worker batch. */
export interface ProjectDocumentExtractionProcessingSummary {
  /** One row per claimed job. */
  processed: ProjectDocumentExtractionProcessingResult[];
  /** Abandoned running rows returned to the queue before this batch. */
  recoveredStaleCount: number;
}

/** DatabaseProjectDocumentExtractionJob is the minimum claimed queue row. */
interface DatabaseProjectDocumentExtractionJob {
  id: string;
  org_id: string | null;
  project_id: string;
  project_key: string;
  relative_path: string;
  filename: string;
  extraction_format: ProjectDocumentExtractionFormat;
  extractor_version: string;
  source_fingerprint: string;
  source_size_bytes: string | number;
  source_modified_at: Date | string | null;
}

/** ProjectDocumentExtractionError carries stable failure and recovery copy. */
class ProjectDocumentExtractionError extends Error {
  /** Stable persisted failure code. */
  readonly code: string;

  /** Creates one bounded reader failure. */
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectDocumentExtractionError";
    this.code = code;
  }
}

/** XML parser configured to preserve text nodes while ignoring attribute noise. */
const officeXmlParser = new XMLParser({
  ignoreAttributes: true,
  preserveOrder: true,
  processEntities: true,
  trimValues: false
});

/** Maximum source segments retained per extraction to keep JSONB bounded. */
const MAX_PERSISTED_SEGMENTS = 500;

/** Maximum characters retained in one source segment. */
const MAX_SEGMENT_CHARACTERS = 20_000;

/**
 * Maximum files read at once by one worker process.
 *
 * Two readers improve mixed-document throughput while bounding peak memory when large
 * PDF or Office files expand substantially beyond their compressed file size.
 */
const MAX_CONCURRENT_PROJECT_DOCUMENT_EXTRACTIONS = 2;

/** Running rows older than this threshold are treated as abandoned worker work. */
const STALE_PROJECT_DOCUMENT_EXTRACTION_MS = 15 * 60 * 1000;

/** Heartbeat writes keep long parser calls from looking abandoned. */
const PROJECT_DOCUMENT_HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** Progress writes are spaced by percent or time to avoid one write per sheet or slide. */
const PROJECT_DOCUMENT_PROGRESS_STEP = 5;
const PROJECT_DOCUMENT_PROGRESS_MAX_SILENCE_MS = 5 * 1000;

/** Worksheet traversal stops before malformed dimensions can monopolize the worker. */
const MAX_WORKSHEET_CELLS_SCANNED = 250_000;

/** Processes up to `limit` queued project documents in bounded concurrent waves. */
export async function processProjectDocumentExtractionJobs(
  limit = 3
): Promise<ProjectDocumentExtractionProcessingSummary> {
  const processed: ProjectDocumentExtractionProcessingResult[] = [];
  const boundedLimit = Math.max(1, Math.min(limit, 20));
  const recoveredStaleCount = await recoverStaleProjectDocumentExtractions();

  while (processed.length < boundedLimit) {
    const remaining = boundedLimit - processed.length;
    const waveSize = Math.min(remaining, MAX_CONCURRENT_PROJECT_DOCUMENT_EXTRACTIONS);
    const jobs: DatabaseProjectDocumentExtractionJob[] = [];

    for (let index = 0; index < waveSize; index += 1) {
      const job = await claimNextProjectDocumentExtractionJob();
      if (!job) {
        break;
      }
      jobs.push(job);
    }

    if (jobs.length === 0) {
      break;
    }

    const waveResults = await Promise.all(jobs.map(processClaimedProjectDocumentExtractionJob));
    processed.push(...waveResults);
  }

  return { processed, recoveredStaleCount };
}

/** Reads and persists one already-claimed extraction without affecting sibling jobs. */
async function processClaimedProjectDocumentExtractionJob(
  job: DatabaseProjectDocumentExtractionJob
): Promise<ProjectDocumentExtractionProcessingResult> {
  const stopHeartbeat = startProjectDocumentExtractionHeartbeat(job);
  const reportProgress = createProjectDocumentProgressReporter(job);

  try {
    const output = await runProjectDocumentExtractionJob(job, reportProgress);
    stopHeartbeat();
    const persisted = await markProjectDocumentExtractionSucceeded(job, output);
    return {
      errorCode: null,
      jobId: job.id,
      status: persisted ? "succeeded" : "superseded"
    };
  } catch (error) {
    stopHeartbeat();
    const failure = mapProjectDocumentExtractionFailure(error);
    const persisted = await markProjectDocumentExtractionFailed(job, failure);
    return {
      errorCode: persisted ? failure.code : null,
      jobId: job.id,
      status: persisted ? "failed" : "superseded"
    };
  }
}

/**
 * Returns abandoned running rows to the queue after a worker crash or forced restart.
 *
 * Progress writes refresh `last_updated_at`, so actively moving jobs stay running.
 */
async function recoverStaleProjectDocumentExtractions(): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_PROJECT_DOCUMENT_EXTRACTION_MS).toISOString();
  const result = await getWorkerDatabasePool().query(
    `
      UPDATE project_document_extractions
      SET
        extraction_status = 'queued',
        progress_percent = 0,
        progress_message = 'The prior read stopped before finishing. Trying again.',
        requested_at = now(),
        started_at = NULL,
        completed_at = NULL,
        error_code = NULL,
        error_message = NULL,
        last_updated_at = now()
      WHERE extraction_status = 'running'
        AND last_updated_at < $1
      RETURNING id
    `,
    [staleBefore]
  );
  return result.rowCount ?? 0;
}

/** Dispatches bytes to the format-specific extractor after source-integrity checks. */
async function runProjectDocumentExtractionJob(
  job: DatabaseProjectDocumentExtractionJob,
  onProgress: (progress: ProjectDocumentExtractionProgress) => Promise<void>
): Promise<ProjectDocumentExtractionOutput> {
    const absolutePath = resolveProjectDocumentPath(job.org_id, job.project_key, job.relative_path);
  const fileInfo = await stat(absolutePath).catch(() => null);

  if (!fileInfo?.isFile()) {
    throw new ProjectDocumentExtractionError(
      "SOURCE_FILE_MISSING",
      "The file is no longer in the project folder. Refresh the project files and try again."
    );
  }

  if (fileInfo.size > PROJECT_DOCUMENT_MAX_FILE_BYTES) {
    throw new ProjectDocumentExtractionError(
      "SOURCE_FILE_TOO_LARGE",
      `This file is larger than ${Math.round(PROJECT_DOCUMENT_MAX_FILE_BYTES / (1024 * 1024))} MB. Split it into smaller documents before reading.`
    );
  }

  const currentFingerprint = buildProjectDocumentSourceFingerprint({
    modifiedAt: fileInfo.mtime.toISOString(),
    relativePath: job.relative_path,
    sizeBytes: fileInfo.size
  });
  if (
    currentFingerprint !== job.source_fingerprint ||
    job.extractor_version !== PROJECT_DOCUMENT_EXTRACTOR_VERSION
  ) {
    throw new ProjectDocumentExtractionError(
      "SOURCE_FILE_CHANGED",
      "The file changed while it was waiting. Refresh the project page to queue the current copy."
    );
  }

  await onProgress({ message: "Opening the document.", percent: 5 });
  const bytes = await readFile(absolutePath);

  const output =
    job.extraction_format === "pdf"
      ? await extractPdfDocument(bytes, onProgress)
      : job.extraction_format === "docx"
        ? await extractDocxDocument(bytes, onProgress)
        : job.extraction_format === "xlsx"
          ? await extractXlsxDocument(bytes, onProgress)
          : await extractPptxDocument(bytes, onProgress);

  if (output.extractedText.length === 0) {
    throw new ProjectDocumentExtractionError(
      "NO_SEARCHABLE_TEXT",
      job.extraction_format === "pdf"
        ? "No selectable text was found. This may be a scanned PDF; save an OCR-enabled copy in the project folder and retry."
        : "No readable text was found in this file. Save a copy containing text or populated cells, then retry."
    );
  }

  return output;
}

/** Extracts PDF text page-by-page and preserves page labels. */
export async function extractPdfDocument(
  bytes: Buffer,
  onProgress: (progress: ProjectDocumentExtractionProgress) => Promise<void> = async () => {}
): Promise<ProjectDocumentExtractionOutput> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true
  });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const segments: ProjectDocumentExtractionSegment[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = normalizeExtractedText(
        content.items
          .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
          .join(" ")
      );
      segments.push(buildExtractionSegment(`Page ${pageNumber}`, pageText));

      if (pageNumber === pageCount || pageNumber === 1 || pageNumber % 5 === 0) {
        await onProgress({
          message: `Reading page ${pageNumber} of ${pageCount}.`,
          percent: 10 + Math.round((pageNumber / Math.max(pageCount, 1)) * 85)
        });
      }
    }
  } finally {
    await document.destroy();
  }

  return buildExtractionOutput(segments, pageCount);
}

/** Extracts DOCX text and groups paragraphs into stable source sections. */
export async function extractDocxDocument(
  bytes: Buffer,
  onProgress: (progress: ProjectDocumentExtractionProgress) => Promise<void> = async () => {}
): Promise<ProjectDocumentExtractionOutput> {
  await onProgress({ message: "Reading Word document paragraphs.", percent: 25 });
  const result = await mammoth.extractRawText({ buffer: bytes });
  const paragraphs = result.value
    .split(/\n{2,}/gu)
    .map(normalizeExtractedText)
    .filter(Boolean);
  const segments: ProjectDocumentExtractionSegment[] = [];

  for (let startIndex = 0; startIndex < paragraphs.length; startIndex += 20) {
    const endIndex = Math.min(startIndex + 20, paragraphs.length);
    segments.push(
      buildExtractionSegment(
        `Paragraphs ${startIndex + 1}-${endIndex}`,
        paragraphs.slice(startIndex, endIndex).join("\n\n")
      )
    );
  }

  await onProgress({ message: `Read ${paragraphs.length} Word paragraph${paragraphs.length === 1 ? "" : "s"}.`, percent: 95 });
  return buildExtractionOutput(segments, segments.length);
}

/** Extracts spreadsheet cells one sheet at a time and preserves sheet names. */
export async function extractXlsxDocument(
  bytes: Buffer,
  onProgress: (progress: ProjectDocumentExtractionProgress) => Promise<void> = async () => {}
): Promise<ProjectDocumentExtractionOutput> {
  const workbook = XLSX.read(bytes, {
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    dense: true,
    type: "buffer"
  });
  const segments: ProjectDocumentExtractionSegment[] = [];

  for (let index = 0; index < workbook.SheetNames.length; index += 1) {
    const sheetName = workbook.SheetNames[index] ?? `Sheet ${index + 1}`;
    const worksheet = workbook.Sheets[sheetName];
    const worksheetText = worksheet ? readBoundedWorksheetText(worksheet) : "";
    segments.push(buildExtractionSegment(`Sheet: ${sheetName}`, worksheetText));
    await onProgress({
      message: `Reading sheet ${index + 1} of ${workbook.SheetNames.length}: ${sheetName}.`,
      percent: 10 + Math.round(((index + 1) / Math.max(workbook.SheetNames.length, 1)) * 85)
    });
  }

  return buildExtractionOutput(segments, workbook.SheetNames.length);
}

/**
 * Reads a bounded CSV-like worksheet view without materializing an entire large sheet.
 *
 * Dense and sparse worksheet representations are both supported. Empty rows are omitted,
 * while empty cells inside a populated row retain their column position.
 */
function readBoundedWorksheetText(worksheet: XLSX.WorkSheet): string {
  const reference = worksheet["!ref"];
  if (!reference) {
    return "";
  }

  const range = XLSX.utils.decode_range(reference);
  const lines: string[] = [];
  let scannedCellCount = 0;
  let retainedCharacterCount = 0;

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const values: string[] = [];
    let rowHasText = false;

    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      if (scannedCellCount >= MAX_WORKSHEET_CELLS_SCANNED) {
        return lines.join("\n").slice(0, MAX_SEGMENT_CHARACTERS);
      }
      scannedCellCount += 1;

      const cell = readWorksheetCell(worksheet, rowIndex, columnIndex);
      const formattedValue = cell ? XLSX.utils.format_cell(cell) : "";
      rowHasText ||= formattedValue.length > 0;
      values.push(escapeWorksheetCsvValue(formattedValue));
    }

    if (!rowHasText) {
      continue;
    }

    const line = values.join(",");
    const separatorLength = lines.length === 0 ? 0 : 1;
    const remainingCharacters =
      MAX_SEGMENT_CHARACTERS - retainedCharacterCount - separatorLength;
    if (remainingCharacters <= 0) {
      break;
    }

    lines.push(line.slice(0, remainingCharacters));
    retainedCharacterCount += separatorLength + Math.min(line.length, remainingCharacters);
    if (line.length > remainingCharacters) {
      break;
    }
  }

  return lines.join("\n");
}

/** Reads one cell from either the dense array or sparse address worksheet shape. */
function readWorksheetCell(
  worksheet: XLSX.WorkSheet,
  rowIndex: number,
  columnIndex: number
): XLSX.CellObject | undefined {
  if (Array.isArray(worksheet)) {
    const denseRows = worksheet as unknown as Array<Array<XLSX.CellObject | undefined>>;
    return denseRows[rowIndex]?.[columnIndex];
  }

  return worksheet[XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex })] as
    | XLSX.CellObject
    | undefined;
}

/** Quotes worksheet values only when CSV punctuation requires it. */
function escapeWorksheetCsvValue(value: string): string {
  if (!/[",\n]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/gu, "\"\"")}"`;
}

/** Extracts PPTX text slide-by-slide from the Open XML package. */
export async function extractPptxDocument(
  bytes: Buffer,
  onProgress: (progress: ProjectDocumentExtractionProgress) => Promise<void> = async () => {}
): Promise<ProjectDocumentExtractionOutput> {
  const archive = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(archive.files)
    .filter((filename) => /^ppt\/slides\/slide\d+\.xml$/u.test(filename))
    .sort(compareNumberedOfficePaths);
  const segments: ProjectDocumentExtractionSegment[] = [];

  for (let index = 0; index < slideFiles.length; index += 1) {
    const slideFilename = slideFiles[index];
    const slideXml = slideFilename ? await archive.file(slideFilename)?.async("text") : null;
    const slideText = slideXml ? normalizeExtractedText(readOrderedXmlText(officeXmlParser.parse(slideXml))) : "";
    segments.push(buildExtractionSegment(`Slide ${index + 1}`, slideText));
    await onProgress({
      message: `Reading slide ${index + 1} of ${slideFiles.length}.`,
      percent: 10 + Math.round(((index + 1) / Math.max(slideFiles.length, 1)) * 85)
    });
  }

  return buildExtractionOutput(segments, slideFiles.length);
}

/** Claims the oldest queued extraction and marks it running inside one transaction. */
async function claimNextProjectDocumentExtractionJob(): Promise<DatabaseProjectDocumentExtractionJob | null> {
  const databasePool = getWorkerDatabasePool();
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    const queuedResult = await selectNextQueuedProjectDocumentExtraction(client);
    const queuedJob = queuedResult.rows[0];
    if (!queuedJob) {
      await client.query("COMMIT");
      return null;
    }

    const runningResult = await client.query<DatabaseProjectDocumentExtractionJob>(
      `
        UPDATE project_document_extractions
        SET
          extraction_status = 'running',
          progress_percent = 1,
          progress_message = 'Starting the document reader.',
          started_at = now(),
          completed_at = NULL,
          error_code = NULL,
          error_message = NULL,
          last_updated_at = now()
        WHERE id = $1
          AND extraction_status = 'queued'
        RETURNING
          id,
          org_id,
          project_id,
          project_key,
          relative_path,
          filename,
          extraction_format,
          extractor_version,
          source_fingerprint,
          source_size_bytes,
          source_modified_at
      `,
      [queuedJob.id]
    );
    await client.query("COMMIT");
    return runningResult.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Selects the oldest queued extraction with a pg-mem fallback for SKIP LOCKED. */
async function selectNextQueuedProjectDocumentExtraction(
  client: PoolClient
): Promise<{ rows: DatabaseProjectDocumentExtractionJob[] }> {
  try {
    return await client.query<DatabaseProjectDocumentExtractionJob>(
      buildQueuedProjectDocumentExtractionSelect(true)
    );
  } catch (error) {
    if (!String(error).toLowerCase().includes("skip locked")) {
      throw error;
    }
    return client.query<DatabaseProjectDocumentExtractionJob>(
      buildQueuedProjectDocumentExtractionSelect(false)
    );
  }
}

/** Builds the oldest-first extraction claim query. */
function buildQueuedProjectDocumentExtractionSelect(includeSkipLocked: boolean): string {
  return `
    SELECT
      id,
      org_id,
      project_id,
      project_key,
      relative_path,
      filename,
      extraction_format,
      extractor_version,
      source_fingerprint,
      source_size_bytes,
      source_modified_at
    FROM project_document_extractions
    WHERE extraction_status = 'queued'
    ORDER BY requested_at ASC, id ASC
    LIMIT 1
    FOR UPDATE${includeSkipLocked ? " SKIP LOCKED" : ""}
  `;
}

/** Persists a bounded progress update for one running extraction. */
async function updateProjectDocumentExtractionProgress(
  job: DatabaseProjectDocumentExtractionJob,
  progress: ProjectDocumentExtractionProgress
): Promise<void> {
  await getWorkerDatabasePool().query(
    `
      UPDATE project_document_extractions
      SET
        progress_percent = $2,
        progress_message = $3,
        last_updated_at = now()
      WHERE id = $1
        AND extraction_status = 'running'
        AND source_fingerprint = $4
    `,
    [
      job.id,
      Math.max(1, Math.min(99, Math.round(progress.percent))),
      progress.message,
      job.source_fingerprint
    ]
  );
}

/**
 * Creates a serialized, rate-limited progress writer for one claimed job.
 *
 * Parser callbacks may occur once per sheet or slide. Persisting only meaningful changes
 * keeps the database responsive while still giving the engineer timely feedback.
 */
function createProjectDocumentProgressReporter(
  job: DatabaseProjectDocumentExtractionJob
): (progress: ProjectDocumentExtractionProgress) => Promise<void> {
  let lastPercent = 1;
  let lastWriteAt = 0;
  let pendingWrite = Promise.resolve();

  return async (progress) => {
    const percent = Math.max(1, Math.min(99, Math.round(progress.percent)));
    const now = Date.now();
    const shouldPersist =
      lastWriteAt === 0 ||
      percent >= 99 ||
      percent - lastPercent >= PROJECT_DOCUMENT_PROGRESS_STEP ||
      now - lastWriteAt >= PROJECT_DOCUMENT_PROGRESS_MAX_SILENCE_MS;
    if (!shouldPersist) {
      return;
    }

    lastPercent = percent;
    lastWriteAt = now;
    pendingWrite = pendingWrite.then(() =>
      updateProjectDocumentExtractionProgress(job, {
        message: progress.message,
        percent
      })
    );
    await pendingWrite;
  };
}

/** Starts a low-frequency heartbeat and returns an idempotent stop function. */
function startProjectDocumentExtractionHeartbeat(
  job: DatabaseProjectDocumentExtractionJob
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    void touchProjectDocumentExtractionHeartbeat(job).catch(() => {
      // A later progress or terminal write can recover from a transient heartbeat error.
    });
  }, PROJECT_DOCUMENT_HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
  };
}

/** Refreshes only the liveness timestamp for one still-current running job. */
async function touchProjectDocumentExtractionHeartbeat(
  job: DatabaseProjectDocumentExtractionJob
): Promise<void> {
  await getWorkerDatabasePool().query(
    `
      UPDATE project_document_extractions
      SET last_updated_at = now()
      WHERE id = $1
        AND extraction_status = 'running'
        AND source_fingerprint = $2
    `,
    [job.id, job.source_fingerprint]
  );
}

/**
 * Marks one extraction ready only while the claimed fingerprint is still current.
 *
 * A project scan can queue a changed copy while an older read is running. The guard
 * prevents stale text from replacing that newer queued work.
 */
async function markProjectDocumentExtractionSucceeded(
  job: DatabaseProjectDocumentExtractionJob,
  output: ProjectDocumentExtractionOutput
): Promise<boolean> {
  const result = await getWorkerDatabasePool().query(
    `
      UPDATE project_document_extractions
      SET
        extraction_status = 'succeeded',
        progress_percent = 100,
        progress_message = $2,
        source_unit_count = $3,
        extracted_character_count = $4,
        extracted_text = $5,
        extracted_segments = $6::jsonb,
        source_location_previews = $7::jsonb,
        error_code = NULL,
        error_message = NULL,
        completed_at = now(),
        last_updated_at = now()
      WHERE id = $1
        AND extraction_status = 'running'
        AND source_fingerprint = $8
    `,
    [
      job.id,
      `Text ready from ${output.sourceUnitCount} source section${output.sourceUnitCount === 1 ? "" : "s"}.`,
      output.sourceUnitCount,
      output.extractedCharacterCount,
      output.extractedText,
      JSON.stringify(output.segments),
      JSON.stringify(
        output.segments.slice(0, 8).map((segment) => ({
          label: segment.label,
          text: segment.textPreview,
          textPreview: segment.textPreview
        }))
      ),
      job.source_fingerprint
    ]
  );
  return result.rowCount === 1;
}

/** Marks one current extraction failed while preserving the source row for retry. */
async function markProjectDocumentExtractionFailed(
  job: DatabaseProjectDocumentExtractionJob,
  failure: { code: string; message: string }
): Promise<boolean> {
  const result = await getWorkerDatabasePool().query(
    `
      UPDATE project_document_extractions
      SET
        extraction_status = 'failed',
        progress_message = 'The document reader could not finish this file.',
        error_code = $2,
        error_message = $3,
        completed_at = now(),
        last_updated_at = now()
      WHERE id = $1
        AND extraction_status = 'running'
        AND source_fingerprint = $4
    `,
    [job.id, failure.code, failure.message, job.source_fingerprint]
  );
  return result.rowCount === 1;
}

/** Builds bounded output from source-labeled segments. */
function buildExtractionOutput(
  rawSegments: ProjectDocumentExtractionSegment[],
  sourceUnitCount: number
): ProjectDocumentExtractionOutput {
  const segments: ProjectDocumentExtractionSegment[] = [];
  let remainingSegmentCharacters = PROJECT_DOCUMENT_MAX_EXTRACTED_CHARACTERS;

  for (const rawSegment of rawSegments.slice(0, MAX_PERSISTED_SEGMENTS)) {
    if (remainingSegmentCharacters <= 0) {
      break;
    }

    const segment = buildExtractionSegment(rawSegment.label, rawSegment.text);
    const boundedText = segment.text.slice(0, remainingSegmentCharacters);
    if (!boundedText) {
      continue;
    }

    segments.push({
      label: segment.label,
      text: boundedText,
      textPreview: boundedText.slice(0, 320)
    });
    remainingSegmentCharacters -= boundedText.length;
  }
  const extractedText = normalizeExtractedText(
    segments.map((segment) => `${segment.label}\n${segment.text}`).join("\n\n")
  ).slice(0, PROJECT_DOCUMENT_MAX_EXTRACTED_CHARACTERS);

  return {
    extractedCharacterCount: extractedText.length,
    extractedText,
    segments,
    sourceUnitCount
  };
}

/** Builds one normalized, bounded source segment. */
function buildExtractionSegment(label: string, text: string): ProjectDocumentExtractionSegment {
  const normalizedText = normalizeExtractedText(text).slice(0, MAX_SEGMENT_CHARACTERS);
  return {
    label,
    text: normalizedText,
    textPreview: normalizedText.slice(0, 320)
  };
}

/** Reads ordered text nodes from preserve-order XML output. */
function readOrderedXmlText(value: unknown): string {
  const values: string[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === "#text" && typeof child === "string") {
        values.push(child);
      } else {
        visit(child);
      }
    }
  };

  visit(value);
  return values.join(" ");
}

/** Sorts Open XML paths by their embedded numeric suffix. */
function compareNumberedOfficePaths(left: string, right: string): number {
  const leftNumber = Number(/\d+/u.exec(path.basename(left))?.[0] ?? 0);
  const rightNumber = Number(/\d+/u.exec(path.basename(right))?.[0] ?? 0);
  return leftNumber - rightNumber || left.localeCompare(right);
}

/** DEFAULT_ORG_ID keeps existing single-tenant mirrors at their historic root/<projectKey> path. */
const DEFAULT_ORG_ID = "org-default";

/** TENANT_PROJECT_FILES_FOLDER mirrors the API-side tenant namespace. */
const TENANT_PROJECT_FILES_FOLDER = ".ee-library-tenants";

/** Resolves one queued source path inside the configured shared project mirror. */
function resolveProjectDocumentPath(orgId: string | null, projectKey: string, relativePath: string): string {
  const root = resolveProjectFilesRoot();
  const safeProjectKey = sanitizeProjectKey(projectKey);
  const projectRoot =
    !orgId || orgId === DEFAULT_ORG_ID
      ? path.resolve(root, safeProjectKey)
      : path.resolve(root, TENANT_PROJECT_FILES_FOLDER, sanitizeProjectKey(orgId), safeProjectKey);
  const candidate = path.resolve(projectRoot, relativePath.replace(/\//gu, path.sep));
  const relative = path.relative(projectRoot, candidate);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProjectDocumentExtractionError(
      "INVALID_SOURCE_PATH",
      "The stored project document path is not safe to read."
    );
  }

  return candidate;
}

/** Resolves the worker-side project-file mirror root. */
function resolveProjectFilesRoot(): string {
  const raw = process.env.EE_LIBRARY_PROJECT_FILES_ROOT?.trim();
  if (raw?.toLowerCase() === "off") {
    throw new ProjectDocumentExtractionError(
      "PROJECT_FILES_NOT_CONFIGURED",
      "The project file folder is turned off on the background worker."
    );
  }

  return raw ? path.resolve(raw) : path.resolve(homedir(), "EE-Library", "projects");
}

/** Sanitizes project keys with the same cross-platform rules used by the API. */
function sanitizeProjectKey(rawKey: string): string {
  const safeKey = rawKey
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-.]+/u, "")
    .replace(/[-.]+$/u, "");
  return safeKey || "project";
}

/** Normalizes extracted text without changing engineering symbols such as +, -, or underscores. */
function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u0000/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** Maps parser and filesystem failures to stable recovery copy. */
function mapProjectDocumentExtractionFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ProjectDocumentExtractionError) {
    return { code: error.code, message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("password") || normalized.includes("encrypted")) {
    return {
      code: "PASSWORD_PROTECTED",
      message: "This document appears to be password-protected. Save an unlocked copy in the project folder and retry."
    };
  }
  if (normalized.includes("invalid pdf") || normalized.includes("formaterror")) {
    return {
      code: "INVALID_PDF",
      message: "This PDF could not be read. Open it locally and save a fresh PDF copy, then retry."
    };
  }

  return {
    code: "EXTRACTION_FAILED",
    message: "The document reader could not extract text from this file. The original file was not changed."
  };
}
