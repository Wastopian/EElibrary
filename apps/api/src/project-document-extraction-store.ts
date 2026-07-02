/**
 * File header: Coordinates project PDF/Office extraction jobs from the API.
 *
 * Project detail reads call this module after the filesystem scan. New or changed
 * supported files are queued, cached results are reused, legacy Office files are shown
 * as unsupported, and every row receives calm progress and timing guidance.
 */

import { createHash } from "node:crypto";
import { Pool } from "pg";
import { getRequestOrgId } from "./request-context";
import {
  buildProjectDocumentSourceFingerprint,
  estimateProjectDocumentExtractionSeconds,
  isLegacyOfficeDocument,
  PROJECT_DOCUMENT_EXTRACTOR_VERSION,
  PROJECT_DOCUMENT_MAX_SOURCE_LOCATIONS,
  readProjectDocumentExtractionFormat
} from "@ee-library/shared/project-document-extraction";
import type {
  ProjectDocumentExtractionFormat,
  ProjectDocumentExtractionSourceLocation,
  ProjectDocumentExtractionState,
  ProjectDocumentExtractionStatusResponse,
  ProjectDocumentMapEntry
} from "@ee-library/shared/types";
import type { ProjectDocumentExtractionRecordInput } from "./project-files";

/** DatabaseProjectDocumentExtractionRow mirrors the persisted extraction queue row. */
interface DatabaseProjectDocumentExtractionRow {
  id: string;
  project_id: string;
  project_key: string;
  relative_path: string;
  filename: string;
  extraction_format: ProjectDocumentExtractionFormat;
  extractor_version: string;
  source_fingerprint: string;
  source_size_bytes: string | number;
  source_modified_at: Date | string | null;
  extraction_status: "queued" | "running" | "succeeded" | "failed";
  progress_percent: string | number;
  progress_message: string;
  source_unit_count: string | number | null;
  extracted_character_count: string | number;
  extracted_text: string | null;
  extracted_segments: unknown;
  error_code: string | null;
  error_message: string | null;
  requested_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  last_updated_at: Date | string;
  queue_position: string | number | null;
}

/** ProjectDocumentExtractionSyncResult returns persisted and static legacy states. */
export interface ProjectDocumentExtractionSyncResult {
  /** Records ready to merge into the project document map. */
  records: ProjectDocumentExtractionRecordInput[];
  /** Number of new or changed files queued during this read. */
  queuedCount: number;
}

/** ProjectDocumentExtractionSyncOptions controls cleanup for full versus partial scans. */
export interface ProjectDocumentExtractionSyncOptions {
  /**
   * Removes persisted rows that are absent from this document list. This must only be
   * enabled for a complete project-folder scan, never for a single-file retry.
   */
  pruneMissing?: boolean;
}

/** ProjectDocumentExtractionRequeueResult reports a manual retry outcome. */
export type ProjectDocumentExtractionRequeueResult =
  | { status: "ok" }
  | { status: "not_configured" }
  | { status: "not_found" };

/** pool is lazy so API startup does not require project-memory persistence. */
let pool: Pool | null | undefined;

/** Project-page reads retain enough text for useful hints without loading full documents. */
const PROJECT_DOCUMENT_MAP_TEXT_CHARACTER_LIMIT = 250_000;

/** Targeted document searches cap candidates per project before filesystem reconciliation. */
const PROJECT_DOCUMENT_SEARCH_RESULT_LIMIT = 100;

/** Replaces the extraction-store pool for focused tests. */
export function setProjectDocumentExtractionStorePoolForTests(databasePool: Pool | null): void {
  pool = databasePool;
}

/**
 * Queues new or changed supported files and reads current extraction state.
 *
 * The source fingerprint includes extractor version, relative path, size, and mtime, so
 * unchanged files reuse cached text while edits automatically return to queued state.
 */
export async function syncProjectDocumentExtractions(
  projectId: string,
  projectKey: string,
  documents: ProjectDocumentMapEntry[],
  options: ProjectDocumentExtractionSyncOptions = {}
): Promise<ProjectDocumentExtractionSyncResult> {
  const databasePool = getProjectDocumentExtractionPool();
  const supportedDocuments = documents
    .map((document) => ({
      document,
      format: readProjectDocumentExtractionFormat(document.filename)
    }))
    .filter(
      (entry): entry is { document: ProjectDocumentMapEntry; format: ProjectDocumentExtractionFormat } =>
        entry.format !== null
    );
  const unsupportedRecords = documents
    .filter((document) => isLegacyOfficeDocument(document.filename))
    .map(buildUnsupportedLegacyOfficeRecord);

  if (!databasePool) {
    return {
      queuedCount: 0,
      records: unsupportedRecords
    };
  }

  const client = await databasePool.connect();
  let queuedCount = 0;

  try {
    await client.query("BEGIN");
    if (options.pruneMissing) {
      await deleteMissingProjectDocumentExtractions(
        client,
        projectId,
        supportedDocuments.map(({ document }) => document.relativePath)
      );
    }

    if (supportedDocuments.length === 0) {
      await client.query("COMMIT");
      return {
        queuedCount: 0,
        records: unsupportedRecords
      };
    }

    const existingResult = await client.query<{
      relative_path: string;
      source_fingerprint: string;
      extractor_version: string;
    }>(
      `
        SELECT relative_path, source_fingerprint, extractor_version
        FROM project_document_extractions
        WHERE project_id = $1
      `,
      [projectId]
    );
    const existingByPath = new Map(
      existingResult.rows.map((row) => [row.relative_path, row])
    );
    const values: unknown[] = [];
    const valueRows = supportedDocuments.map(({ document, format }, index) => {
      const offset = index * 11;
      const sourceFingerprint = buildProjectDocumentSourceFingerprint(document);
      const existing = existingByPath.get(document.relativePath);
      if (
        !existing ||
        existing.source_fingerprint !== sourceFingerprint ||
        existing.extractor_version !== PROJECT_DOCUMENT_EXTRACTOR_VERSION
      ) {
        queuedCount += 1;
      }
      values.push(
        buildProjectDocumentExtractionId(projectId, document.relativePath),
        projectId,
        projectKey,
        document.relativePath,
        document.filename,
        format,
        PROJECT_DOCUMENT_EXTRACTOR_VERSION,
        sourceFingerprint,
        document.sizeBytes,
        document.modifiedAt,
        getRequestOrgId()
      );
      return `(
        $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5},
        $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10},
        'queued', 0, 'Waiting for the document reader.', now(), now(), $${offset + 11}
      )`;
    });
    await client.query(
      `
        INSERT INTO project_document_extractions (
          id,
          project_id,
          project_key,
          relative_path,
          filename,
          extraction_format,
          extractor_version,
          source_fingerprint,
          source_size_bytes,
          source_modified_at,
          extraction_status,
          progress_percent,
          progress_message,
          requested_at,
          last_updated_at,
          org_id
        )
        VALUES ${valueRows.join(",\n")}
        ON CONFLICT (project_id, relative_path) DO UPDATE
        SET
          project_key = EXCLUDED.project_key,
          filename = EXCLUDED.filename,
          extraction_format = EXCLUDED.extraction_format,
          extractor_version = EXCLUDED.extractor_version,
          source_fingerprint = EXCLUDED.source_fingerprint,
          source_size_bytes = EXCLUDED.source_size_bytes,
          source_modified_at = EXCLUDED.source_modified_at,
          extraction_status = 'queued',
          progress_percent = 0,
          progress_message = 'File changed. Waiting for the document reader.',
          source_unit_count = NULL,
          extracted_character_count = 0,
          extracted_text = NULL,
          extracted_segments = '[]'::jsonb,
          error_code = NULL,
          error_message = NULL,
          requested_at = now(),
          started_at = NULL,
          completed_at = NULL,
          last_updated_at = now()
        WHERE project_document_extractions.source_fingerprint <> EXCLUDED.source_fingerprint
          OR project_document_extractions.extractor_version <> EXCLUDED.extractor_version
      `,
      values
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const persistedRecords = await readProjectDocumentExtractions(projectId);
  return {
    queuedCount,
    records: [...persistedRecords, ...unsupportedRecords]
  };
}

/**
 * Reads current extraction rows for one project with a live queued position.
 *
 * Queue positions come from a separately ordered ID list. This keeps the ordering
 * rule explicit and avoids running a correlated count for every project document.
 */
export async function readProjectDocumentExtractions(
  projectId: string
): Promise<ProjectDocumentExtractionRecordInput[]> {
  const databasePool = getProjectDocumentExtractionPool();
  if (!databasePool) {
    return [];
  }

  const [result, queuedResult] = await Promise.all([
    databasePool.query<Omit<DatabaseProjectDocumentExtractionRow, "queue_position">>(
      `
        SELECT extraction.*
        FROM (
          SELECT
            id,
            project_id,
            project_key,
            relative_path,
            filename,
            extraction_format,
            extractor_version,
            source_fingerprint,
            source_size_bytes,
            source_modified_at,
            extraction_status,
            progress_percent,
            progress_message,
            source_unit_count,
            extracted_character_count,
            LEFT(extracted_text, $2::int) AS extracted_text,
            source_location_previews AS extracted_segments,
            error_code,
            error_message,
            requested_at,
            started_at,
            completed_at,
            last_updated_at
          FROM project_document_extractions
          WHERE project_id = $1
        ) extraction
        ORDER BY extraction.relative_path ASC
      `,
      [projectId, PROJECT_DOCUMENT_MAP_TEXT_CHARACTER_LIMIT]
    ),
    readProjectQueuePositions(databasePool, projectId)
  ]);
  const queuePositionById = new Map(
    queuedResult.rows.map((row) => [row.id, Number(row.queue_position)])
  );

  return result.rows.map((row) =>
    mapProjectDocumentExtractionRow({
      ...row,
      queue_position: queuePositionById.get(row.id) ?? null
    })
  );
}

/**
 * Reads only completed extraction rows whose full text contains every requested clue.
 *
 * PostgreSQL performs the coarse filter before the API loads full text and source
 * segments. The filesystem-backed document map still performs the final exact match.
 */
export async function searchProjectDocumentExtractions(
  projectId: string,
  searchValues: string[]
): Promise<ProjectDocumentExtractionRecordInput[]> {
  const databasePool = getProjectDocumentExtractionPool();
  const normalizedValues = Array.from(
    new Set(
      searchValues
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 12);
  if (!databasePool || normalizedValues.length === 0) {
    return [];
  }

  const conditions = normalizedValues.map(
    (_, index) => `LOWER(extracted_text) LIKE $${index + 2}`
  );
  const patterns = normalizedValues.map((value) => `%${value}%`);
  const result = await databasePool.query<Omit<DatabaseProjectDocumentExtractionRow, "queue_position">>(
    `
      SELECT extraction.*
      FROM project_document_extractions extraction
      WHERE extraction.project_id = $1
        AND extraction.extraction_status = 'succeeded'
        AND extraction.extracted_text IS NOT NULL
        AND ${conditions.join("\n        AND ")}
      ORDER BY extraction.relative_path ASC
      LIMIT ${PROJECT_DOCUMENT_SEARCH_RESULT_LIMIT}
    `,
    [projectId, ...patterns]
  );

  return result.rows.map((row) =>
    mapProjectDocumentExtractionRow({
      ...row,
      queue_position: null
    })
  );
}

/** Reads lightweight extraction states for UI polling without loading full extracted text. */
export async function readProjectDocumentExtractionStatuses(
  projectId: string
): Promise<ProjectDocumentExtractionStatusResponse> {
  const databasePool = getProjectDocumentExtractionPool();
  if (!databasePool) {
    return { activeCount: 0, records: [] };
  }

  const [result, queuedResult] = await Promise.all([
    databasePool.query<Omit<DatabaseProjectDocumentExtractionRow, "queue_position">>(
      `
        SELECT
          id,
          project_id,
          project_key,
          relative_path,
          filename,
          extraction_format,
          extractor_version,
          source_fingerprint,
          source_size_bytes,
          source_modified_at,
          extraction_status,
          progress_percent,
          progress_message,
          source_unit_count,
          extracted_character_count,
          NULL::text AS extracted_text,
          '[]'::jsonb AS extracted_segments,
          error_code,
          error_message,
          requested_at,
          started_at,
          completed_at,
          last_updated_at
        FROM project_document_extractions
        WHERE project_id = $1
        ORDER BY relative_path ASC
      `,
      [projectId]
    ),
    readProjectQueuePositions(databasePool, projectId)
  ]);
  const queuePositionById = new Map(
    queuedResult.rows.map((row) => [row.id, Number(row.queue_position)])
  );
  const records = result.rows.map((row) => {
    const mapped = mapProjectDocumentExtractionRow({
      ...row,
      queue_position: queuePositionById.get(row.id) ?? null
    });
    return {
      extraction: mapped.state,
      relativePath: mapped.relativePath
    };
  });

  return {
    activeCount: records.filter(
      ({ extraction }) => extraction.status === "queued" || extraction.status === "running"
    ).length,
    records
  };
}

/** Requeues one supported extraction row after an operator chooses Retry. */
export async function requeueProjectDocumentExtraction(
  projectId: string,
  relativePath: string
): Promise<ProjectDocumentExtractionRequeueResult> {
  const databasePool = getProjectDocumentExtractionPool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  const result = await databasePool.query(
    `
      UPDATE project_document_extractions
      SET
        extraction_status = 'queued',
        progress_percent = 0,
        progress_message = 'Retry requested. Waiting for the document reader.',
        error_code = NULL,
        error_message = NULL,
        started_at = NULL,
        completed_at = NULL,
        requested_at = now(),
        last_updated_at = now()
      WHERE project_id = $1
        AND relative_path = $2
        AND extraction_status = 'failed'
      RETURNING id
    `,
    [projectId, relativePath.replace(/\\/gu, "/")]
  );

  return result.rowCount === 1 ? { status: "ok" } : { status: "not_found" };
}

/** Maps one persisted row into the project document-map extraction contract. */
function mapProjectDocumentExtractionRow(
  row: DatabaseProjectDocumentExtractionRow
): ProjectDocumentExtractionRecordInput {
  const sourceSizeBytes = Number(row.source_size_bytes);
  const progressPercent = Number(row.progress_percent);
  const queuePosition = row.queue_position === null ? null : Number(row.queue_position);
  const activeSeconds = estimateProjectDocumentExtractionSeconds(row.extraction_format, sourceSizeBytes);
  const estimatedWaitSeconds =
    row.extraction_status === "queued"
      ? activeSeconds + Math.max(0, (queuePosition ?? 1) - 1) * 20
      : row.extraction_status === "running"
        ? Math.max(2, Math.ceil(activeSeconds * (1 - progressPercent / 100)))
        : null;
  const sourceSegments = readSourceSegments(row.extracted_segments);

  return {
    extractedText: row.extracted_text,
    relativePath: row.relative_path,
    sourceSegments,
    state: {
      completedAt: toIsoString(row.completed_at),
      errorCode: row.error_code,
      errorMessage: row.error_message,
      estimatedWaitSeconds,
      extractedCharacterCount: Number(row.extracted_character_count),
      extractorVersion: row.extractor_version,
      format: row.extraction_format,
      progressMessage: row.progress_message,
      progressPercent,
      queuePosition,
      searchableTextAvailable:
        row.extraction_status === "succeeded" && Number(row.extracted_character_count) > 0,
      sourceLocations: sourceSegments
        .slice(0, PROJECT_DOCUMENT_MAX_SOURCE_LOCATIONS)
        .map(({ label, textPreview }) => ({ label, textPreview })),
      sourceUnitCount: row.source_unit_count === null ? null : Number(row.source_unit_count),
      startedAt: toIsoString(row.started_at),
      status: row.extraction_status
    }
  };
}

/** Builds a static unsupported state for legacy binary Office formats. */
function buildUnsupportedLegacyOfficeRecord(
  document: ProjectDocumentMapEntry
): ProjectDocumentExtractionRecordInput {
  return {
    extractedText: null,
    relativePath: document.relativePath,
    sourceSegments: [],
    state: {
      completedAt: null,
      errorCode: "LEGACY_OFFICE_FORMAT",
      errorMessage: "Save this file as DOCX, XLSX, or PPTX so the document reader can open it.",
      estimatedWaitSeconds: null,
      extractedCharacterCount: 0,
      extractorVersion: PROJECT_DOCUMENT_EXTRACTOR_VERSION,
      format: readLegacyFormatFallback(document.filename),
      progressMessage: "This older Office file needs conversion before it can be read.",
      progressPercent: 0,
      queuePosition: null,
      searchableTextAvailable: false,
      sourceLocations: [],
      sourceUnitCount: null,
      startedAt: null,
      status: "unsupported"
    }
  };
}

/**
 * Maps a legacy extension onto its modern target format so the UI can name the expected
 * conversion without widening the supported-format contract.
 */
function readLegacyFormatFallback(filename: string): ProjectDocumentExtractionFormat {
  const extension = filename.toLowerCase().slice(filename.lastIndexOf("."));
  if (extension === ".doc") return "docx";
  if (extension === ".xls") return "xlsx";
  return "pptx";
}

/** Parses bounded source segments from JSONB without trusting arbitrary shapes. */
function readSourceSegments(
  value: unknown
): Array<ProjectDocumentExtractionSourceLocation & { text: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as { label?: unknown }).label !== "string" ||
        typeof (entry as { textPreview?: unknown }).textPreview !== "string" ||
        typeof (entry as { text?: unknown }).text !== "string"
      ) {
        return null;
      }

      return {
        label: (entry as { label: string }).label,
        text: (entry as { text: string }).text,
        textPreview: (entry as { textPreview: string }).textPreview
      };
    })
    .filter(
      (
        entry
      ): entry is ProjectDocumentExtractionSourceLocation & { text: string } =>
        entry !== null
    );
}

/** Deletes cached rows for supported files no longer present in the current project map. */
async function deleteMissingProjectDocumentExtractions(
  client: import("pg").PoolClient,
  projectId: string,
  currentRelativePaths: string[]
): Promise<void> {
  if (currentRelativePaths.length === 0) {
    await client.query(
      `DELETE FROM project_document_extractions WHERE project_id = $1`,
      [projectId]
    );
    return;
  }

  const pathPlaceholders = currentRelativePaths.map((_, index) => `$${index + 2}`).join(", ");
  await client.query(
    `
      DELETE FROM project_document_extractions
      WHERE project_id = $1
        AND relative_path NOT IN (${pathPlaceholders})
    `,
    [projectId, ...currentRelativePaths]
  );
}

/** Reads global queue positions only for queued rows belonging to the requested project. */
async function readProjectQueuePositions(
  databasePool: Pool,
  projectId: string
): Promise<{ rows: Array<{ id: string; queue_position: string | number }> }> {
  try {
    return await databasePool.query<{ id: string; queue_position: string | number }>(
      `
        WITH ordered_queue AS (
          SELECT
            id,
            project_id,
            ROW_NUMBER() OVER (ORDER BY requested_at ASC, id ASC) AS queue_position
          FROM project_document_extractions
          WHERE extraction_status = 'queued'
        )
        SELECT id, queue_position
        FROM ordered_queue
        WHERE project_id = $1
      `,
      [projectId]
    );
  } catch (error) {
    const message = String(error).toLowerCase();
    if (!message.includes("row_number") && !message.includes("over")) {
      throw error;
    }

    // pg-mem does not implement window functions. Keep an equivalent fallback so the
    // store's ordering behavior remains covered by focused unit tests.
    return databasePool.query<{ id: string; queue_position: string | number }>(
      `
        SELECT
          target.id,
          COUNT(earlier.id)::int + 1 AS queue_position
        FROM project_document_extractions target
        LEFT JOIN project_document_extractions earlier
          ON earlier.extraction_status = 'queued'
          AND (
            earlier.requested_at < target.requested_at
            OR (
              earlier.requested_at = target.requested_at
              AND earlier.id < target.id
            )
          )
        WHERE target.project_id = $1
          AND target.extraction_status = 'queued'
        GROUP BY target.id
      `,
      [projectId]
    );
  }
}

/** Builds a deterministic extraction row id without leaking path separators. */
function buildProjectDocumentExtractionId(projectId: string, relativePath: string): string {
  const digest = createHash("sha256").update(projectId).update("\0").update(relativePath).digest("hex").slice(0, 24);
  return `project-doc-extract-${digest}`;
}

/** Resolves the lazy API extraction pool, or null when project memory is disabled. */
function getProjectDocumentExtractionPool(): Pool | null {
  if (pool !== undefined) {
    return pool;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  return pool;
}

/** Converts database timestamps to ISO strings. */
function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
