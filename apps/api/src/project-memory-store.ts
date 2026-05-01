/**
 * File header: Reads persisted project and BOM memory records from Postgres for the API service.
 */

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { BomCsvParseError, countMappedBomFields, hasMappedHeader, mapBomRowsToDrafts, parseBomCsv } from "@ee-library/shared/bom-csv";
import { CatalogStoreError } from "./catalog-store";
import type {
  BomImport,
  BomImportCreateInput,
  BomImportCreateResponse,
  BomImportLinesResponse,
  BomLine,
  BomLineMatchStatus,
  ProjectCreateInput,
  ProjectCreateResponse,
  Project,
  ProjectBomImportsResponse,
  ProjectDetailResponse,
  ProjectListResponse,
  ProjectMemoryCapability,
  ProjectPartUsage,
  ProjectPartUsagesResponse,
  ProjectRevision,
  ProjectRevisionsResponse,
  ProjectSummary
} from "@ee-library/shared/types";

/** ProjectListReadResult reports list availability without falling back to fake project memory. */
export type ProjectListReadResult = { status: "available"; response: ProjectListResponse } | { status: "not_configured" };

/** ProjectCreateResult reports project creation or safe conflict/setup failures. */
export type ProjectCreateResult =
  | { status: "created"; response: ProjectCreateResponse }
  | { status: "conflict"; message: string }
  | { status: "not_configured" };

/** ProjectDetailReadResult reports one project detail read or an honest persistence boundary failure. */
export type ProjectDetailReadResult =
  | { status: "available"; response: ProjectDetailResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ProjectChildReadResult reports child collections scoped to an existing project. */
export type ProjectChildReadResult<TResponse> =
  | { status: "available"; response: TResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** BomImportLinesReadResult reports BOM line reads scoped to a persisted BOM import. */
export type BomImportLinesReadResult =
  | { status: "available"; response: BomImportLinesResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** BomImportCreateResult reports mapped CSV persistence without running part matching. */
export type BomImportCreateResult =
  | { status: "created"; response: BomImportCreateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ProjectMemoryCapability list labels read foundations and planned workflows for honest API consumers. */
const PROJECT_MEMORY_CAPABILITIES: ProjectMemoryCapability[] = [
  {
    detail: "Project records can be read when they exist in the database.",
    id: "project_records",
    label: "Project records",
    state: "foundation"
  },
  {
    detail: "BOM import metadata and persisted rows can be read after CSV intake creates them.",
    id: "bom_import_records",
    label: "BOM import records",
    state: "foundation"
  },
  {
    detail: "CSV BOM upload and column mapping can persist raw and mapped BOM lines without part matching.",
    id: "bom_upload",
    label: "BOM upload",
    state: "foundation"
  },
  {
    detail: "Automatic BOM row matching is planned; weak and ambiguous matches must not create confirmed usage.",
    id: "bom_matching",
    label: "BOM matching",
    state: "planned"
  },
  {
    detail: "Where-used views will read from confirmed project usage records.",
    id: "where_used",
    label: "Where-used",
    state: "planned"
  },
  {
    detail: "BOM health and risk projections are planned after usage history exists.",
    id: "bom_health",
    label: "BOM health",
    state: "planned"
  },
  {
    detail: "Evidence attachment workflows are planned and remain separate from approval or export readiness.",
    id: "evidence_vault",
    label: "Evidence vault",
    state: "planned"
  },
  {
    detail: "Circuit block records are planned as structured engineering knowledge, not loose notes.",
    id: "circuit_blocks",
    label: "Circuit blocks",
    state: "planned"
  }
];

/** pool is initialized lazily so project-memory reads do not require DATABASE_URL in tests. */
let pool: Pool | null = null;

/** DatabaseProjectSummaryRow is one project row plus project-memory child counts. */
interface DatabaseProjectSummaryRow extends DatabaseProjectRow {
  revision_count: string | number;
  bom_import_count: string | number;
  usage_count: string | number;
  latest_revision_updated_at: Date | string | null;
  latest_bom_import_updated_at: Date | string | null;
  latest_usage_updated_at: Date | string | null;
}

/** DatabaseProjectRow is the persisted project root shape. */
interface DatabaseProjectRow {
  id: string;
  project_key: string;
  name: string;
  description: string;
  owner: string | null;
  status: Project["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseProjectRevisionRow is the persisted project revision shape. */
interface DatabaseProjectRevisionRow {
  id: string;
  project_id: string;
  revision_label: string;
  revision_status: ProjectRevision["revisionStatus"];
  source_reference: string | null;
  released_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseBomImportRow is the persisted BOM import metadata shape. */
interface DatabaseBomImportRow {
  id: string;
  project_id: string;
  project_revision_id: string;
  source_filename: string;
  source_format: BomImport["sourceFormat"];
  storage_key: string | null;
  import_status: BomImport["importStatus"];
  column_mapping: unknown;
  import_summary: unknown;
  imported_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseBomLineRow is the persisted raw and mapped BOM line shape. */
interface DatabaseBomLineRow {
  id: string;
  bom_import_id: string;
  project_id: string;
  project_revision_id: string;
  row_number: number;
  designators: unknown;
  quantity: string | number | null;
  raw_mpn: string | null;
  raw_manufacturer: string | null;
  raw_description: string | null;
  raw_supplier_reference: string | null;
  raw_notes: string | null;
  raw_row_payload: unknown;
  matched_part_id: string | null;
  match_status: BomLine["matchStatus"];
  match_confidence_score: string | number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseProjectPartUsageRow is one confirmed project usage row. */
interface DatabaseProjectPartUsageRow {
  id: string;
  project_id: string;
  project_revision_id: string;
  bom_line_id: string | null;
  part_id: string;
  usage_context: string | null;
  designators: unknown;
  quantity: string | number | null;
  usage_status: ProjectPartUsage["usageStatus"];
  approval_snapshot: unknown;
  readiness_snapshot: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

/** ProjectMemoryInputError reports validated request problems from write helpers. */
class ProjectMemoryInputError extends Error {
  readonly code: string;

  /**
   * Creates a stable input error for project-memory API write responses.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectMemoryInputError";
    this.code = code;
  }
}

/**
 * Replaces the project-memory database pool for tests that use an in-memory Postgres adapter.
 */
export function setProjectMemoryStorePoolForTests(databasePool: Pool | null): void {
  pool = databasePool;
}

/**
 * Creates a project root and first revision so BOM uploads have a durable memory scope.
 */
export async function createProjectInDatabase(input: ProjectCreateInput): Promise<ProjectCreateResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const normalizedProjectKey = normalizeProjectKey(input.projectKey);
  const normalizedName = input.name.trim();
  const revisionLabel = normalizeOptionalText(input.initialRevisionLabel) ?? "Working";

  try {
    const client = await databasePool.connect();

    try {
      await client.query("BEGIN");

      const projectId = buildProjectId(normalizedProjectKey);
      const revisionId = buildProjectRevisionId(projectId, revisionLabel);
      const now = new Date();
      const projectResult = await client.query<DatabaseProjectRow>(
        `
          INSERT INTO projects (id, project_key, name, description, owner, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          RETURNING id, project_key, name, description, owner, status, created_at, updated_at
        `,
        [
          projectId,
          normalizedProjectKey,
          normalizedName,
          normalizeOptionalText(input.description) ?? "",
          normalizeOptionalText(input.owner),
          input.status ?? "active",
          now
        ]
      );
      const revisionResult = await client.query<DatabaseProjectRevisionRow>(
        `
          INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference, created_at, updated_at)
          VALUES ($1, $2, $3, 'draft', $4, $5, $5)
          RETURNING id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
        `,
        [revisionId, projectId, revisionLabel, "Created with project memory setup", now]
      );

      await client.query("COMMIT");

      const detail = await readProjectDetailFromDatabase(projectId);

      if (detail.status !== "available") {
        throw new CatalogStoreError("query_failed", "Created project could not be read back from project memory.", new Error("project_readback_failed"));
      }

      const projectRow = projectResult.rows[0];
      const revisionRow = revisionResult.rows[0];

      if (!projectRow || !revisionRow) {
        throw new CatalogStoreError("query_failed", "Project creation returned no persisted rows.", new Error("missing_project_create_rows"));
      }

      return {
        response: {
          detail: detail.response,
          initialRevision: mapProjectRevisionRow(revisionRow),
          project: mapProjectRow(projectRow)
        },
        status: "created"
      };
    } catch (error) {
      await client.query("ROLLBACK");

      if (isUniqueViolation(error)) {
        return {
          message: "A project with that key already exists.",
          status: "conflict"
        };
      }

      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        message: "A project with that key already exists.",
        status: "conflict"
      };
    }

    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads the project list from persisted project-memory tables.
 */
export async function readProjectsFromDatabase(): Promise<ProjectListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const projects = await readProjectSummaries(databasePool);

    return {
      response: {
        capabilities: PROJECT_MEMORY_CAPABILITIES,
        projects,
        state: projects.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads one project and its immediate persisted memory collections.
 */
export async function readProjectDetailFromDatabase(projectId: string): Promise<ProjectDetailReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const summary = await readProjectSummary(databasePool, projectId);

    if (!summary) {
      return { status: "not_found" };
    }

    const [revisions, bomImports, usages] = await Promise.all([
      readProjectRevisions(databasePool, projectId),
      readProjectBomImports(databasePool, projectId),
      readProjectPartUsages(databasePool, projectId)
    ]);

    return {
      response: {
        bomImports,
        capabilities: PROJECT_MEMORY_CAPABILITIES,
        project: summary.project,
        revisions,
        state: "available",
        summary,
        usages
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Persists one mapped CSV BOM import and raw BOM lines without creating part matches.
 */
export async function createBomImportInDatabase(projectId: string, input: BomImportCreateInput, importedBy: string): Promise<BomImportCreateResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const parsedCsv = parseBomCsv(input.rawContent);
    const columnMapping = normalizeBomColumnMapping(input.columnMapping);

    if (!hasMappedHeader(parsedCsv.headers, columnMapping.mpn)) {
      return {
        code: "BOM_MPN_MAPPING_REQUIRED",
        message: "Map an MPN column before saving the BOM import.",
        status: "invalid"
      };
    }

    const lineDrafts = mapBomRowsToDrafts(parsedCsv.rows, columnMapping);

    if (lineDrafts.length === 0) {
      return {
        code: "BOM_HAS_NO_ROWS",
        message: "The BOM CSV contains no nonblank rows to save.",
        status: "invalid"
      };
    }

    const client = await databasePool.connect();

    try {
      await client.query("BEGIN");

      if (!(await projectExists(client, projectId))) {
        await client.query("ROLLBACK");
        return { status: "not_found" };
      }

      const revision = await resolveProjectRevisionForBomImport(client, projectId, input);
      const now = new Date();
      const bomImportId = `bomimp-${randomUUID()}`;
      const importSummary = {
        createdBy: "p0-mem4",
        mappedFieldCount: countMappedBomFields(columnMapping),
        matchStatus: "unmatched",
        persistedLineCount: lineDrafts.length,
        rowCount: parsedCsv.rowCount,
        skippedBlankRowCount: parsedCsv.skippedBlankRowCount,
        warnings: parsedCsv.warnings
      };
      const bomImportResult = await client.query<DatabaseBomImportRow>(
        `
          INSERT INTO bom_imports (id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 'csv', $5, 'mapped', $6::jsonb, $7::jsonb, $8, $9, $9)
          RETURNING id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at
        `,
        [
          bomImportId,
          projectId,
          revision.id,
          input.sourceFilename.trim(),
          null,
          JSON.stringify(columnMapping),
          JSON.stringify(importSummary),
          importedBy,
          now
        ]
      );
      const savedLines: BomLine[] = [];

      for (const draft of lineDrafts) {
        const lineResult = await client.query<DatabaseBomLineRow>(
          `
            INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, NULL, $14, NULL, $15, $15)
            RETURNING id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at
          `,
          [
            `bomline-${randomUUID()}`,
            bomImportId,
            projectId,
            revision.id,
            draft.rowNumber,
            draft.designators,
            draft.quantity,
            draft.rawMpn,
            draft.rawManufacturer,
            draft.rawDescription,
            draft.rawSupplierReference,
            draft.rawNotes,
            JSON.stringify(draft.rawRowPayload),
            "unmatched" satisfies BomLineMatchStatus,
            now
          ]
        );
        const lineRow = lineResult.rows[0];

        if (lineRow) {
          savedLines.push(mapBomLineRow(lineRow));
        }
      }

      await client.query("UPDATE project_revisions SET updated_at = $2 WHERE id = $1", [revision.id, now]);
      await client.query("UPDATE projects SET updated_at = $2 WHERE id = $1", [projectId, now]);
      await client.query("COMMIT");

      const bomImportRow = bomImportResult.rows[0];

      if (!bomImportRow) {
        throw new CatalogStoreError("query_failed", "BOM import creation returned no persisted import row.", new Error("missing_bom_import_row"));
      }

      return {
        response: {
          bomImport: mapBomImportRow(bomImportRow),
          lineCount: savedLines.length,
          linesPreview: savedLines.slice(0, 25),
          summary: {
            mappedFieldCount: countMappedBomFields(columnMapping),
            matchStatus: "unmatched",
            persistedLineCount: savedLines.length,
            skippedBlankRowCount: parsedCsv.skippedBlankRowCount
          }
        },
        status: "created"
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof ProjectMemoryInputError || error instanceof BomCsvParseError) {
      return {
        code: error instanceof BomCsvParseError ? error.code : error.code,
        message: error.message,
        status: "invalid"
      };
    }

    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads project revisions for one persisted project.
 */
export async function readProjectRevisionsFromDatabase(projectId: string): Promise<ProjectChildReadResult<ProjectRevisionsResponse>> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const revisions = await readProjectRevisions(databasePool, projectId);

    return {
      response: {
        projectId,
        revisions,
        state: revisions.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads persisted BOM import metadata for one project.
 */
export async function readProjectBomImportsFromDatabase(projectId: string): Promise<ProjectChildReadResult<ProjectBomImportsResponse>> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const bomImports = await readProjectBomImports(databasePool, projectId);

    return {
      response: {
        bomImports,
        projectId,
        state: bomImports.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads BOM lines for one persisted BOM import.
 */
export async function readBomImportLinesFromDatabase(bomImportId: string): Promise<BomImportLinesReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await bomImportExists(databasePool, bomImportId))) {
      return { status: "not_found" };
    }

    const lines = await readBomImportLines(databasePool, bomImportId);

    return {
      response: {
        bomImportId,
        lines,
        state: lines.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads confirmed project part usage rows for one project.
 */
export async function readProjectPartUsagesFromDatabase(projectId: string): Promise<ProjectChildReadResult<ProjectPartUsagesResponse>> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const usages = await readProjectPartUsages(databasePool, projectId);

    return {
      response: {
        projectId,
        state: usages.length > 0 ? "available" : "empty",
        usages
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads compact project summaries in stable workbench order.
 */
async function readProjectSummaries(databasePool: Pool): Promise<ProjectSummary[]> {
  const result = await databasePool.query<DatabaseProjectSummaryRow>(`${PROJECT_SUMMARIES_SQL}\nORDER BY p.updated_at DESC, p.project_key ASC, p.id ASC`);

  return result.rows.map(mapProjectSummaryRow);
}

/**
 * Reads one compact project summary by project id.
 */
async function readProjectSummary(databasePool: Pool, projectId: string): Promise<ProjectSummary | null> {
  const result = await databasePool.query<DatabaseProjectSummaryRow>(`${PROJECT_SUMMARIES_SQL}\nWHERE p.id = $1`, [projectId]);

  return result.rows[0] ? mapProjectSummaryRow(result.rows[0]) : null;
}

/**
 * Reads persisted revisions for one project id.
 */
async function readProjectRevisions(databasePool: Pool, projectId: string): Promise<ProjectRevision[]> {
  const result = await databasePool.query<DatabaseProjectRevisionRow>(
    `
      SELECT id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
      FROM project_revisions
      WHERE project_id = $1
      ORDER BY created_at DESC, revision_label ASC, id ASC
    `,
    [projectId]
  );

  return result.rows.map(mapProjectRevisionRow);
}

/**
 * Reads persisted BOM import records for one project id.
 */
async function readProjectBomImports(databasePool: Pool, projectId: string): Promise<BomImport[]> {
  const result = await databasePool.query<DatabaseBomImportRow>(
    `
      SELECT id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at
      FROM bom_imports
      WHERE project_id = $1
      ORDER BY created_at DESC, id ASC
    `,
    [projectId]
  );

  return result.rows.map(mapBomImportRow);
}

/**
 * Reads persisted BOM lines for one BOM import id.
 */
async function readBomImportLines(databasePool: Pool, bomImportId: string): Promise<BomLine[]> {
  const result = await databasePool.query<DatabaseBomLineRow>(
    `
      SELECT id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at
      FROM bom_lines
      WHERE bom_import_id = $1
      ORDER BY row_number ASC, id ASC
    `,
    [bomImportId]
  );

  return result.rows.map(mapBomLineRow);
}

/**
 * Reads confirmed project usage records for one project id.
 */
async function readProjectPartUsages(databasePool: Pool, projectId: string): Promise<ProjectPartUsage[]> {
  const result = await databasePool.query<DatabaseProjectPartUsageRow>(
    `
      SELECT id, project_id, project_revision_id, bom_line_id, part_id, usage_context, designators, quantity, usage_status, approval_snapshot, readiness_snapshot, created_at, updated_at
      FROM project_part_usages
      WHERE project_id = $1
      ORDER BY updated_at DESC, id ASC
    `,
    [projectId]
  );

  return result.rows.map(mapProjectPartUsageRow);
}

/**
 * Checks whether one project id exists before returning scoped empty child reads.
 */
async function projectExists(databasePool: Pool | PoolClient, projectId: string): Promise<boolean> {
  const result = await databasePool.query<{ id: string }>("SELECT id FROM projects WHERE id = $1 LIMIT 1", [projectId]);

  return result.rows.length > 0;
}

/**
 * Checks whether one BOM import exists before returning scoped empty line reads.
 */
async function bomImportExists(databasePool: Pool | PoolClient, bomImportId: string): Promise<boolean> {
  const result = await databasePool.query<{ id: string }>("SELECT id FROM bom_imports WHERE id = $1 LIMIT 1", [bomImportId]);

  return result.rows.length > 0;
}

/**
 * Resolves an existing revision or creates a new draft revision for one BOM upload.
 */
async function resolveProjectRevisionForBomImport(client: PoolClient, projectId: string, input: BomImportCreateInput): Promise<ProjectRevision> {
  const requestedRevisionId = normalizeOptionalText(input.projectRevisionId);

  if (requestedRevisionId) {
    const revisionResult = await client.query<DatabaseProjectRevisionRow>(
      `
        SELECT id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
        FROM project_revisions
        WHERE id = $1 AND project_id = $2
        LIMIT 1
      `,
      [requestedRevisionId, projectId]
    );
    const revisionRow = revisionResult.rows[0];

    if (!revisionRow) {
      throw new ProjectMemoryInputError("PROJECT_REVISION_NOT_FOUND", "The selected project revision does not exist for this project.");
    }

    return mapProjectRevisionRow(revisionRow);
  }

  const revisionLabel = normalizeOptionalText(input.revisionLabel);

  if (!revisionLabel) {
    throw new ProjectMemoryInputError("PROJECT_REVISION_REQUIRED", "Choose an existing project revision or enter a revision label before saving the BOM.");
  }

  const existingRevisionResult = await client.query<DatabaseProjectRevisionRow>(
    `
      SELECT id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
      FROM project_revisions
      WHERE project_id = $1 AND revision_label = $2
      LIMIT 1
    `,
    [projectId, revisionLabel]
  );
  const existingRevision = existingRevisionResult.rows[0];

  if (existingRevision) {
    return mapProjectRevisionRow(existingRevision);
  }

  const now = new Date();
  const revisionResult = await client.query<DatabaseProjectRevisionRow>(
    `
      INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference, created_at, updated_at)
      VALUES ($1, $2, $3, 'draft', $4, $5, $5)
      RETURNING id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
    `,
    [buildProjectRevisionId(projectId, revisionLabel), projectId, revisionLabel, "Created during BOM import", now]
  );
  const revisionRow = revisionResult.rows[0];

  if (!revisionRow) {
    throw new CatalogStoreError("query_failed", "Project revision creation returned no persisted row.", new Error("missing_revision_create_row"));
  }

  return mapProjectRevisionRow(revisionRow);
}

/** PROJECT_SUMMARIES_SQL reads project rows plus child counts and latest child update timestamps. */
const PROJECT_SUMMARIES_SQL = `
  SELECT
    p.id,
    p.project_key,
    p.name,
    p.description,
    p.owner,
    p.status,
    p.created_at,
    p.updated_at,
    COALESCE(revision_summary.revision_count, '0') AS revision_count,
    COALESCE(bom_import_summary.bom_import_count, '0') AS bom_import_count,
    COALESCE(usage_summary.usage_count, '0') AS usage_count,
    revision_summary.latest_revision_updated_at,
    bom_import_summary.latest_bom_import_updated_at,
    usage_summary.latest_usage_updated_at
  FROM projects p
  LEFT JOIN (
    SELECT project_id, COUNT(*)::text AS revision_count, MAX(updated_at) AS latest_revision_updated_at
    FROM project_revisions
    GROUP BY project_id
  ) revision_summary ON revision_summary.project_id = p.id
  LEFT JOIN (
    SELECT project_id, COUNT(*)::text AS bom_import_count, MAX(updated_at) AS latest_bom_import_updated_at
    FROM bom_imports
    GROUP BY project_id
  ) bom_import_summary ON bom_import_summary.project_id = p.id
  LEFT JOIN (
    SELECT project_id, COUNT(*)::text AS usage_count, MAX(updated_at) AS latest_usage_updated_at
    FROM project_part_usages
    GROUP BY project_id
  ) usage_summary ON usage_summary.project_id = p.id
`;

/**
 * Lazily creates the Postgres pool when DATABASE_URL exists.
 */
function getProjectMemoryDatabasePool(): Pool | null {
  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL
  });

  return pool;
}

/**
 * Maps one project summary row into the shared API contract.
 */
function mapProjectSummaryRow(row: DatabaseProjectSummaryRow): ProjectSummary {
  const project = mapProjectRow(row);

  return {
    bomImportCount: toNumber(row.bom_import_count),
    latestActivityAt: latestTimestamp([
      project.updatedAt,
      row.latest_revision_updated_at ? toIsoTimestamp(row.latest_revision_updated_at) : null,
      row.latest_bom_import_updated_at ? toIsoTimestamp(row.latest_bom_import_updated_at) : null,
      row.latest_usage_updated_at ? toIsoTimestamp(row.latest_usage_updated_at) : null
    ]),
    project,
    revisionCount: toNumber(row.revision_count),
    usageCount: toNumber(row.usage_count)
  };
}

/**
 * Maps a persisted project row into the shared Project type.
 */
function mapProjectRow(row: DatabaseProjectRow): Project {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    description: row.description,
    id: row.id,
    name: row.name,
    owner: row.owner,
    projectKey: row.project_key,
    status: row.status,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a persisted project revision row into the shared ProjectRevision type.
 */
function mapProjectRevisionRow(row: DatabaseProjectRevisionRow): ProjectRevision {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    id: row.id,
    projectId: row.project_id,
    releasedAt: row.released_at ? toIsoTimestamp(row.released_at) : null,
    revisionLabel: row.revision_label,
    revisionStatus: row.revision_status,
    sourceReference: row.source_reference,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a persisted BOM import row into the shared BomImport type.
 */
function mapBomImportRow(row: DatabaseBomImportRow): BomImport {
  return {
    columnMapping: toRecord(row.column_mapping),
    createdAt: toIsoTimestamp(row.created_at),
    id: row.id,
    importStatus: row.import_status,
    importSummary: toRecord(row.import_summary),
    importedBy: row.imported_by,
    projectId: row.project_id,
    projectRevisionId: row.project_revision_id,
    sourceFilename: row.source_filename,
    sourceFormat: row.source_format,
    storageKey: row.storage_key,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a persisted BOM line row into the shared BomLine type.
 */
function mapBomLineRow(row: DatabaseBomLineRow): BomLine {
  return {
    bomImportId: row.bom_import_id,
    createdAt: toIsoTimestamp(row.created_at),
    designators: toStringArray(row.designators),
    id: row.id,
    matchConfidenceScore: toNullableNumber(row.match_confidence_score),
    matchedPartId: row.matched_part_id,
    matchStatus: row.match_status,
    projectId: row.project_id,
    projectRevisionId: row.project_revision_id,
    quantity: toNullableNumber(row.quantity),
    rawDescription: row.raw_description,
    rawManufacturer: row.raw_manufacturer,
    rawMpn: row.raw_mpn,
    rawNotes: row.raw_notes,
    rawRowPayload: toRecord(row.raw_row_payload),
    rawSupplierReference: row.raw_supplier_reference,
    rowNumber: row.row_number,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a persisted usage row into the shared ProjectPartUsage type.
 */
function mapProjectPartUsageRow(row: DatabaseProjectPartUsageRow): ProjectPartUsage {
  return {
    approvalSnapshot: toRecord(row.approval_snapshot),
    bomLineId: row.bom_line_id,
    createdAt: toIsoTimestamp(row.created_at),
    designators: toStringArray(row.designators),
    id: row.id,
    partId: row.part_id,
    projectId: row.project_id,
    projectRevisionId: row.project_revision_id,
    quantity: toNullableNumber(row.quantity),
    readinessSnapshot: toRecord(row.readiness_snapshot),
    updatedAt: toIsoTimestamp(row.updated_at),
    usageContext: row.usage_context,
    usageStatus: row.usage_status
  };
}

/**
 * Converts unknown Postgres/network failures into explicit project-memory store failures.
 */
function toProjectMemoryStoreError(error: unknown): CatalogStoreError {
  if (error instanceof CatalogStoreError) {
    return error;
  }

  if (isSchemaMismatchError(error)) {
    return new CatalogStoreError("schema_mismatch", "Project memory database schema does not match the API query contract.", error);
  }

  if (isDatabaseUnavailableError(error)) {
    return new CatalogStoreError("database_unavailable", "Project memory database is configured but unavailable.", error);
  }

  return new CatalogStoreError("query_failed", "Project memory database query failed.", error);
}

/**
 * Checks common Postgres SQLSTATE codes for missing tables, columns, or functions.
 */
function isSchemaMismatchError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "42P01" || code === "42703" || code === "42883";
}

/**
 * Checks common network and server SQLSTATE codes for unavailable databases.
 */
function isDatabaseUnavailableError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "57P01" || code === "57P03";
}

/**
 * Reads a Postgres or Node error code without depending on one concrete error class.
 */
function getErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/**
 * Checks whether Postgres rejected a unique project or revision key.
 */
function isUniqueViolation(error: unknown): boolean {
  return getErrorCode(error) === "23505";
}

/**
 * Normalizes project keys for stable ids and lookups.
 */
function normalizeProjectKey(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/gu, "-");
}

/**
 * Converts optional text into null when empty.
 */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}

/**
 * Normalizes a BOM column mapping so blank headers do not persist as field claims.
 */
function normalizeBomColumnMapping(mapping: BomImportCreateInput["columnMapping"]): BomImportCreateInput["columnMapping"] {
  return {
    description: normalizeOptionalText(mapping.description),
    designators: normalizeOptionalText(mapping.designators),
    manufacturer: normalizeOptionalText(mapping.manufacturer),
    mpn: normalizeOptionalText(mapping.mpn),
    notes: normalizeOptionalText(mapping.notes),
    quantity: normalizeOptionalText(mapping.quantity),
    supplierReference: normalizeOptionalText(mapping.supplierReference)
  };
}

/**
 * Builds a deterministic project id from the unique project key.
 */
function buildProjectId(projectKey: string): string {
  return `project-${slugify(projectKey)}`;
}

/**
 * Builds a deterministic project revision id within one project.
 */
function buildProjectRevisionId(projectId: string, revisionLabel: string): string {
  return `rev-${slugify(projectId)}-${slugify(revisionLabel)}`;
}

/**
 * Converts operator labels into stable lowercase id segments.
 */
function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "item";
}

/**
 * Converts a Postgres numeric/count value into a JavaScript number.
 */
function toNumber(value: string | number): number {
  return Number(value);
}

/**
 * Converts a nullable Postgres numeric value into a JavaScript number or null.
 */
function toNullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Converts database timestamps into ISO strings.
 */
function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Converts database JSON into a plain record without trusting arbitrary payloads.
 */
function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Converts database array output into a clean string array.
 */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Returns the newest non-null timestamp from a set of ISO timestamp candidates.
 */
function latestTimestamp(values: Array<string | null>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? new Date(0).toISOString();
}
