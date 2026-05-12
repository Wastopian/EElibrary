/**
 * File header: Persists controlled document revisions, ACL grants, and redline notes.
 */

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { CatalogStoreError } from "./catalog-store";
import type {
  AssetAvailabilityStatus,
  AssetProvenance,
  AssetType,
  ControlledDocumentAclEntry,
  ControlledDocumentRevision,
  DocumentAccessLevel,
  DocumentAclEntryCreateInput,
  DocumentAclPermission,
  DocumentAclPrincipalType,
  DocumentControlAssetSummary,
  DocumentControlType,
  DocumentRedline,
  DocumentRedlineCreateInput,
  DocumentRedlineCreateResponse,
  DocumentRedlineSeverity,
  DocumentRedlineStatus,
  DocumentRedlineUpdateInput,
  DocumentRedlineUpdateResponse,
  DocumentRevisionCreateInput,
  DocumentRevisionCreateResponse,
  DocumentRevisionLifecycleStatus,
  DocumentRevisionListResponse,
  FileFormat
} from "@ee-library/shared/types";

/** DOCUMENT_CONTROL_BOUNDARY_COPY explains the current enforcement boundary without overclaiming RBAC. */
export const DOCUMENT_CONTROL_BOUNDARY_COPY =
  "Document control records revision, supersession, expiry, ACL intent, and redline metadata. API writes are admin-gated today; the stored ACLs are the foundation for future RBAC and ITAR enforcement.";

/** DocumentControlReadResult reports whether controlled document history can be read. */
export type DocumentControlReadResult =
  | { status: "available"; response: DocumentRevisionListResponse }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** DocumentRevisionCreateResult reports document revision creation or an explicit validation failure. */
export type DocumentRevisionCreateResult =
  | { status: "created"; response: DocumentRevisionCreateResponse }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string }
  | { status: "invalid"; code: string; message: string }
  | { status: "conflict"; code: string; message: string };

/** DocumentRedlineCreateResult reports redline-note creation or an explicit validation failure. */
export type DocumentRedlineCreateResult =
  | { status: "created"; response: DocumentRedlineCreateResponse }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string }
  | { status: "invalid"; code: string; message: string };

/** DocumentRedlineUpdateResult reports redline-note updates or an explicit validation failure. */
export type DocumentRedlineUpdateResult =
  | { status: "updated"; response: DocumentRedlineUpdateResponse }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string }
  | { status: "invalid"; code: string; message: string };

/** pool is initialized lazily so tests and local seed fallback do not require a database. */
let pool: Pool | null = null;

/** documentControlPoolOverride lets tests share a pg-mem pool without using DATABASE_URL. */
let documentControlPoolOverride: Pool | null | undefined;

/**
 * Overrides the document-control pool for tests.
 */
export function setDocumentControlPoolForTests(databasePool: Pool | null): void {
  documentControlPoolOverride = databasePool;
}

/** AssetDownloadGate names whether an asset download is unrestricted or gated by ACL. */
export type AssetDownloadGate =
  | { status: "unrestricted" }
  | {
      status: "gated";
      revisionId: string;
      accessLevel: DocumentAccessLevel;
      revisionLabel: string;
      documentType: DocumentControlType;
    };

/** AssetDownloadGateResult separates honest "unknown" cases (no DB) from a real decision. */
export type AssetDownloadGateResult =
  | { status: "decided"; gate: AssetDownloadGate }
  | { status: "not_configured" };

/** AssetDownloadAclActor is the minimal actor shape the ACL check needs. */
export interface AssetDownloadAclActor {
  userId: string | null;
  role: string | null;
}

/** AssetDownloadGrant explains how a gated download was authorized for the audit record. */
export type AssetDownloadGrant =
  | { status: "acl_user"; permission: DocumentAclPermission }
  | { status: "acl_role"; permission: DocumentAclPermission; role: string };

/** AssetDownloadAclResult reports whether the actor has a usable grant on a revision. */
export type AssetDownloadAclResult =
  | { status: "granted"; grant: AssetDownloadGrant }
  | { status: "no_grant" }
  | { status: "not_configured" };

/**
 * Determines whether downloading one asset is gated by an active controlled-document
 * access level. Returns the highest-restriction non-archived revision found, so the
 * route layer can refuse the download until the caller explicitly acknowledges the
 * restriction or has the right ACL grant.
 *
 * Access-level precedence (most restrictive first): itar_controlled, restricted,
 * internal, public. We gate at restricted or above so internal/public stays open.
 */
export async function readAssetDownloadGateFromDatabase(assetId: string): Promise<AssetDownloadGateResult> {
  const databasePool = getDocumentControlDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const result = await databasePool.query<{ id: string; access_level: DocumentAccessLevel; revision_label: string; document_type: DocumentControlType }>(
      `
        SELECT id, access_level, revision_label, document_type
        FROM document_revisions
        WHERE asset_id = $1
          AND lifecycle_status != 'archived'
          AND access_level IN ('restricted', 'itar_controlled')
        ORDER BY
          CASE access_level WHEN 'itar_controlled' THEN 1 WHEN 'restricted' THEN 2 ELSE 3 END,
          updated_at DESC
        LIMIT 1
      `,
      [assetId]
    );

    const row = result.rows[0];

    if (!row) {
      return { status: "decided", gate: { status: "unrestricted" } };
    }

    return {
      status: "decided",
      gate: {
        status: "gated",
        revisionId: row.id,
        accessLevel: row.access_level,
        revisionLabel: row.revision_label,
        documentType: row.document_type
      }
    };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Asset download gate read failed.", error);
  }
}

/**
 * Resolves whether one actor has a usable ACL grant on a controlled-document revision.
 *
 * The actor's user id is checked against principal_type='user' rows; the actor's role
 * (when present) is checked against principal_type='role' rows. A grant is considered
 * usable when permission is 'view' or 'admin' (review/approve are workflow permissions
 * and intentionally do not unlock downloads on their own) AND the grant has not
 * expired. Team membership is not modelled yet and is intentionally skipped — its
 * absence means a team-only grant cannot authorize a download today.
 */
export async function readAssetDownloadAclGrant(documentRevisionId: string, actor: AssetDownloadAclActor): Promise<AssetDownloadAclResult> {
  const databasePool = getDocumentControlDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  if (!actor.userId && !actor.role) {
    return { status: "no_grant" };
  }

  try {
    const result = await databasePool.query<{ principal_type: DocumentAclPrincipalType; principal_id: string; permission: DocumentAclPermission }>(
      `
        SELECT principal_type, principal_id, permission
        FROM document_acl_entries
        WHERE document_revision_id = $1
          AND permission IN ('view', 'admin')
          AND (expires_at IS NULL OR expires_at > now())
          AND (
            (principal_type = 'user' AND principal_id = $2)
            OR (principal_type = 'role' AND principal_id = $3)
          )
        ORDER BY
          CASE permission WHEN 'admin' THEN 1 ELSE 2 END,
          created_at DESC
        LIMIT 1
      `,
      [documentRevisionId, actor.userId ?? "", actor.role ?? ""]
    );

    const row = result.rows[0];

    if (!row) {
      return { status: "no_grant" };
    }

    if (row.principal_type === "user") {
      return { status: "granted", grant: { status: "acl_user", permission: row.permission } };
    }

    return { status: "granted", grant: { status: "acl_role", permission: row.permission, role: row.principal_id } };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Asset download ACL read failed.", error);
  }
}

/**
 * Reads controlled document revisions for one part.
 */
export async function readDocumentRevisionsForPartFromDatabase(partId: string): Promise<DocumentControlReadResult> {
  const databasePool = getDocumentControlDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const partExists = await databasePool.query<{ id: string }>("SELECT id FROM parts WHERE id = $1", [partId]);

    if (partExists.rowCount === 0) {
      return {
        code: "PART_NOT_FOUND",
        message: "Part not found.",
        status: "not_found"
      };
    }

    const response = await readDocumentControlList(databasePool, partId);

    return { response, status: "available" };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Document control read failed.", error);
  }
}

/**
 * Creates one controlled revision from an existing part asset and optional initial ACL grants.
 */
export async function createDocumentRevisionInDatabase(
  partId: string,
  input: DocumentRevisionCreateInput,
  actor = "local-dev-document-control"
): Promise<DocumentRevisionCreateResult> {
  const databasePool = getDocumentControlDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const normalized = normalizeDocumentRevisionCreateInput(input);

  if (normalized.status === "invalid") {
    return normalized;
  }

  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");

    const assetResult = await client.query<DatabaseDocumentAssetRow>(
      `
        SELECT
          id,
          part_id,
          asset_type,
          file_format,
          storage_key,
          file_hash,
          provenance,
          availability_status,
          source_url
        FROM assets
        WHERE id = $1 AND part_id = $2
      `,
      [normalized.input.assetId, partId]
    );
    const asset = assetResult.rows[0];

    if (!asset) {
      await client.query("ROLLBACK");
      return {
        code: "DOCUMENT_ASSET_NOT_FOUND",
        message: "The selected document asset does not exist for this part.",
        status: "not_found"
      };
    }

    const documentType = normalized.input.documentType ?? inferDocumentType(asset.asset_type);
    const supersedesId = normalized.input.supersedesDocumentRevisionId ?? null;

    if (supersedesId) {
      const superseded = await client.query<{ id: string }>(
        "SELECT id FROM document_revisions WHERE id = $1 AND part_id = $2",
        [supersedesId, partId]
      );

      if (superseded.rowCount === 0) {
        await client.query("ROLLBACK");
        return {
          code: "SUPERSEDED_DOCUMENT_NOT_FOUND",
          message: "The superseded document revision must belong to the same part.",
          status: "invalid"
        };
      }
    }

    const revisionId = randomUUID();
    const now = new Date();

    await client.query(
      `
        INSERT INTO document_revisions (
          id,
          part_id,
          asset_id,
          document_type,
          revision_label,
          revision_date,
          lifecycle_status,
          access_level,
          access_notes,
          effective_at,
          expires_at,
          supersedes_document_revision_id,
          source_asset_hash,
          created_by,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
      `,
      [
        revisionId,
        partId,
        normalized.input.assetId,
        documentType,
        normalized.input.revisionLabel,
        normalized.input.revisionDate ?? null,
        normalized.input.lifecycleStatus,
        normalized.input.accessLevel,
        normalized.input.accessNotes ?? "",
        normalized.input.effectiveAt ? new Date(normalized.input.effectiveAt) : null,
        normalized.input.expiresAt ? new Date(normalized.input.expiresAt) : null,
        supersedesId,
        asset.file_hash,
        actor,
        now
      ]
    );

    for (const aclEntry of normalized.input.aclEntries ?? []) {
      await insertAclEntry(client, revisionId, aclEntry, actor);
    }

    if (supersedesId && normalized.input.lifecycleStatus === "released") {
      await client.query(
        `
          UPDATE document_revisions
          SET lifecycle_status = 'superseded',
              updated_at = $1
          WHERE id = $2
        `,
        [now, supersedesId]
      );
    }

    await client.query("COMMIT");

    const documentControl = await readDocumentControlList(databasePool, partId);
    const revision = documentControl.revisions.find((candidate) => candidate.id === revisionId);

    if (!revision) {
      throw new CatalogStoreError("query_failed", "Created document revision could not be reread.", null);
    }

    return {
      response: {
        boundary: DOCUMENT_CONTROL_BOUNDARY_COPY,
        documentControl,
        revision
      },
      status: "created"
    };
  } catch (error) {
    await rollbackQuietly(client);

    if (isUniqueViolation(error)) {
      return {
        code: "DOCUMENT_REVISION_CONFLICT",
        message: "A controlled revision with this asset and revision label already exists for the part.",
        status: "conflict"
      };
    }

    throw new CatalogStoreError("query_failed", "Document revision create failed.", error);
  } finally {
    client.release();
  }
}

/**
 * Creates one redline note against a controlled document revision.
 */
export async function createDocumentRedlineInDatabase(
  documentRevisionId: string,
  input: DocumentRedlineCreateInput,
  actor = "local-dev-document-control"
): Promise<DocumentRedlineCreateResult> {
  const databasePool = getDocumentControlDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const normalized = normalizeDocumentRedlineCreateInput(input);

  if (normalized.status === "invalid") {
    return normalized;
  }

  try {
    const revisionResult = await databasePool.query<{ part_id: string }>(
      "SELECT part_id FROM document_revisions WHERE id = $1",
      [documentRevisionId]
    );
    const revision = revisionResult.rows[0];

    if (!revision) {
      return {
        code: "DOCUMENT_REVISION_NOT_FOUND",
        message: "Document revision not found.",
        status: "not_found"
      };
    }

    const redlineId = randomUUID();
    const now = new Date();

    await databasePool.query(
      `
        INSERT INTO document_redlines (
          id,
          document_revision_id,
          redline_status,
          page_number,
          anchor_text,
          note,
          severity,
          created_by,
          created_at,
          updated_at
        )
        VALUES ($1, $2, 'open', $3, $4, $5, $6, $7, $8, $8)
      `,
      [
        redlineId,
        documentRevisionId,
        normalized.input.pageNumber ?? null,
        normalized.input.anchorText ?? null,
        normalized.input.note,
        normalized.input.severity,
        actor,
        now
      ]
    );

    const documentControl = await readDocumentControlList(databasePool, revision.part_id);
    const redline = findRedline(documentControl, redlineId);

    if (!redline) {
      throw new CatalogStoreError("query_failed", "Created document redline could not be reread.", null);
    }

    return {
      response: {
        boundary: DOCUMENT_CONTROL_BOUNDARY_COPY,
        documentControl,
        redline
      },
      status: "created"
    };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Document redline create failed.", error);
  }
}

/**
 * Updates redline status or note text without changing the controlled revision itself.
 */
export async function updateDocumentRedlineInDatabase(
  redlineId: string,
  input: DocumentRedlineUpdateInput,
  actor = "local-dev-document-control"
): Promise<DocumentRedlineUpdateResult> {
  const databasePool = getDocumentControlDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const normalized = normalizeDocumentRedlineUpdateInput(input);

  if (normalized.status === "invalid") {
    return normalized;
  }

  try {
    const existingResult = await databasePool.query<{ document_revision_id: string; part_id: string }>(
      `
        SELECT dr.id AS document_revision_id,
               drv.part_id
        FROM document_redlines dr
        INNER JOIN document_revisions drv ON drv.id = dr.document_revision_id
        WHERE dr.id = $1
      `,
      [redlineId]
    );
    const existing = existingResult.rows[0];

    if (!existing) {
      return {
        code: "DOCUMENT_REDLINE_NOT_FOUND",
        message: "Document redline not found.",
        status: "not_found"
      };
    }

    const now = new Date();
    const isTerminal = normalized.input.redlineStatus !== "open";

    await databasePool.query(
      `
        UPDATE document_redlines
        SET redline_status = $1,
            note = COALESCE($2, note),
            resolved_by = CASE WHEN $3 THEN COALESCE(resolved_by, $4) ELSE resolved_by END,
            resolved_at = CASE WHEN $3 THEN COALESCE(resolved_at, $5) ELSE resolved_at END,
            updated_at = $5
        WHERE id = $6
      `,
      [
        normalized.input.redlineStatus,
        normalized.input.note ?? null,
        isTerminal,
        actor,
        now,
        redlineId
      ]
    );

    const documentControl = await readDocumentControlList(databasePool, existing.part_id);
    const redline = findRedline(documentControl, redlineId);

    if (!redline) {
      throw new CatalogStoreError("query_failed", "Updated document redline could not be reread.", null);
    }

    return {
      response: {
        boundary: DOCUMENT_CONTROL_BOUNDARY_COPY,
        documentControl,
        redline
      },
      status: "updated"
    };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Document redline update failed.", error);
  }
}

/**
 * Reads and assembles revisions, ACL grants, and redlines for one part from a configured pool.
 */
async function readDocumentControlList(databasePool: Pool, partId: string): Promise<DocumentRevisionListResponse> {
  const revisionResult = await databasePool.query<DatabaseDocumentRevisionRow>(
    `
      SELECT
        dr.id,
        dr.part_id,
        dr.asset_id,
        dr.document_type,
        dr.revision_label,
        dr.revision_date,
        dr.lifecycle_status,
        dr.access_level,
        dr.access_notes,
        dr.effective_at,
        dr.expires_at,
        dr.supersedes_document_revision_id,
        dr.source_asset_hash,
        dr.created_by,
        dr.created_at,
        dr.updated_at,
        a.asset_type,
        a.file_format,
        a.storage_key,
        a.file_hash,
        a.provenance,
        a.availability_status,
        a.source_url
      FROM document_revisions dr
      INNER JOIN assets a ON a.id = dr.asset_id
      WHERE dr.part_id = $1
      ORDER BY COALESCE(dr.revision_date, CAST(dr.created_at AS DATE)) DESC, dr.created_at DESC, dr.id DESC
    `,
    [partId]
  );
  const revisionIds = revisionResult.rows.map((row) => row.id);
  const aclRows = revisionIds.length > 0 ? await readAclEntries(databasePool, revisionIds) : [];
  const redlineRows = revisionIds.length > 0 ? await readRedlines(databasePool, revisionIds) : [];
  const supersededBy = new Map<string, string>();

  for (const row of revisionResult.rows) {
    if (row.supersedes_document_revision_id) {
      supersededBy.set(row.supersedes_document_revision_id, row.id);
    }
  }

  const revisions = revisionResult.rows.map((row) =>
    mapDocumentRevisionRow(
      row,
      supersededBy.get(row.id) ?? null,
      aclRows.filter((entry) => entry.document_revision_id === row.id),
      redlineRows.filter((redline) => redline.document_revision_id === row.id)
    )
  );

  return {
    boundary: DOCUMENT_CONTROL_BOUNDARY_COPY,
    partId,
    revisions,
    state: revisions.length > 0 ? "available" : "empty"
  };
}

/**
 * Reads ACL entries for a set of controlled document revisions.
 */
async function readAclEntries(databasePool: Pool, revisionIds: string[]): Promise<DatabaseDocumentAclRow[]> {
  const result = await databasePool.query<DatabaseDocumentAclRow>(
    `
      SELECT
        id,
        document_revision_id,
        principal_type,
        principal_id,
        permission,
        granted_by,
        expires_at,
        created_at
      FROM document_acl_entries
      WHERE document_revision_id = ANY($1::text[])
      ORDER BY created_at ASC, id ASC
    `,
    [revisionIds]
  );

  return result.rows;
}

/**
 * Reads redline notes for a set of controlled document revisions.
 */
async function readRedlines(databasePool: Pool, revisionIds: string[]): Promise<DatabaseDocumentRedlineRow[]> {
  const result = await databasePool.query<DatabaseDocumentRedlineRow>(
    `
      SELECT
        id,
        document_revision_id,
        redline_status,
        page_number,
        anchor_text,
        note,
        severity,
        created_by,
        resolved_by,
        resolved_at,
        created_at,
        updated_at
      FROM document_redlines
      WHERE document_revision_id = ANY($1::text[])
      ORDER BY created_at DESC, id DESC
    `,
    [revisionIds]
  );

  return result.rows;
}

/**
 * Inserts one ACL entry while preserving its creator for later policy review.
 */
async function insertAclEntry(
  client: PoolClient,
  documentRevisionId: string,
  aclEntry: DocumentAclEntryCreateInput,
  actor: string
): Promise<void> {
  await client.query(
    `
      INSERT INTO document_acl_entries (
        id,
        document_revision_id,
        principal_type,
        principal_id,
        permission,
        granted_by,
        expires_at,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      randomUUID(),
      documentRevisionId,
      aclEntry.principalType,
      aclEntry.principalId,
      aclEntry.permission,
      actor,
      aclEntry.expiresAt ? new Date(aclEntry.expiresAt) : null,
      new Date()
    ]
  );
}

/**
 * Maps a document revision row into the shared API contract.
 */
function mapDocumentRevisionRow(
  row: DatabaseDocumentRevisionRow,
  supersededByDocumentRevisionId: string | null,
  aclRows: DatabaseDocumentAclRow[],
  redlineRows: DatabaseDocumentRedlineRow[]
): ControlledDocumentRevision {
  return {
    accessLevel: row.access_level,
    accessNotes: row.access_notes,
    aclEntries: aclRows.map(mapAclRow),
    asset: mapDocumentAssetRow(row),
    assetId: row.asset_id,
    createdAt: toIsoTimestamp(row.created_at),
    createdBy: row.created_by,
    documentType: row.document_type,
    effectiveAt: toNullableIsoTimestamp(row.effective_at),
    expiresAt: toNullableIsoTimestamp(row.expires_at),
    id: row.id,
    lifecycleStatus: row.lifecycle_status,
    partId: row.part_id,
    redlines: redlineRows.map(mapRedlineRow),
    revisionDate: toNullableDateOnly(row.revision_date),
    revisionLabel: row.revision_label,
    sourceAssetHash: row.source_asset_hash,
    supersededByDocumentRevisionId,
    supersedesDocumentRevisionId: row.supersedes_document_revision_id,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps asset columns joined onto document revisions into a compact asset summary.
 */
function mapDocumentAssetRow(row: DatabaseDocumentRevisionRow): DocumentControlAssetSummary {
  return {
    assetType: row.asset_type,
    availabilityStatus: row.availability_status,
    fileFormat: row.file_format,
    fileHash: row.file_hash,
    id: row.asset_id,
    partId: row.part_id,
    provenance: row.provenance,
    sourceUrl: row.source_url,
    storageKey: row.storage_key
  };
}

/**
 * Maps one ACL row into the shared API contract.
 */
function mapAclRow(row: DatabaseDocumentAclRow): ControlledDocumentAclEntry {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    documentRevisionId: row.document_revision_id,
    expiresAt: toNullableIsoTimestamp(row.expires_at),
    grantedBy: row.granted_by,
    id: row.id,
    permission: row.permission,
    principalId: row.principal_id,
    principalType: row.principal_type
  };
}

/**
 * Maps one redline row into the shared API contract.
 */
function mapRedlineRow(row: DatabaseDocumentRedlineRow): DocumentRedline {
  return {
    anchorText: row.anchor_text,
    createdAt: toIsoTimestamp(row.created_at),
    createdBy: row.created_by,
    documentRevisionId: row.document_revision_id,
    id: row.id,
    note: row.note,
    pageNumber: row.page_number === null ? null : Number(row.page_number),
    redlineStatus: row.redline_status,
    resolvedAt: toNullableIsoTimestamp(row.resolved_at),
    resolvedBy: row.resolved_by,
    severity: row.severity,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Finds one redline in the nested document-control response.
 */
function findRedline(documentControl: DocumentRevisionListResponse, redlineId: string): DocumentRedline | null {
  for (const revision of documentControl.revisions) {
    const redline = revision.redlines.find((candidate) => candidate.id === redlineId);
    if (redline) {
      return redline;
    }
  }

  return null;
}

/**
 * Normalizes and validates revision creation inputs before any database write.
 */
function normalizeDocumentRevisionCreateInput(input: DocumentRevisionCreateInput): { status: "ok"; input: RequiredDocumentRevisionCreateInput } | Extract<DocumentRevisionCreateResult, { status: "invalid" }> {
  const assetId = normalizeRequiredString(input.assetId);
  const revisionLabel = normalizeRequiredString(input.revisionLabel);

  if (!assetId || !revisionLabel) {
    return invalid("INVALID_DOCUMENT_REVISION", "Document revisions require an assetId and revisionLabel.");
  }

  const documentType = input.documentType === undefined ? undefined : readDocumentControlType(input.documentType);
  const lifecycleStatus = readLifecycleStatus(input.lifecycleStatus ?? "draft");
  const accessLevel = readAccessLevel(input.accessLevel ?? "internal");
  const revisionDate = normalizeDateOnly(input.revisionDate ?? null);
  const effectiveAt = normalizeOptionalTimestamp(input.effectiveAt ?? null);
  const expiresAt = normalizeOptionalTimestamp(input.expiresAt ?? null);
  const supersedesDocumentRevisionId = normalizeOptionalString(input.supersedesDocumentRevisionId ?? null);
  const aclEntries = normalizeAclEntries(input.aclEntries ?? []);

  if (input.documentType !== undefined && !documentType) {
    return invalid("INVALID_DOCUMENT_TYPE", "Document type must be datasheet, mechanical_drawing, controlled_drawing, specification, or other.");
  }

  if (!lifecycleStatus || !accessLevel) {
    return invalid("INVALID_DOCUMENT_REVISION_STATE", "Document lifecycle and access level must use supported values.");
  }

  if (!revisionDate.ok) {
    return invalid("INVALID_DOCUMENT_REVISION_DATES", revisionDate.message);
  }

  if (!effectiveAt.ok) {
    return invalid("INVALID_DOCUMENT_REVISION_DATES", effectiveAt.message);
  }

  if (!expiresAt.ok) {
    return invalid("INVALID_DOCUMENT_REVISION_DATES", expiresAt.message);
  }

  if (!aclEntries.ok) {
    return invalid("INVALID_DOCUMENT_REVISION_DATES", aclEntries.message);
  }

  if (effectiveAt.value && expiresAt.value && new Date(expiresAt.value).getTime() <= new Date(effectiveAt.value).getTime()) {
    return invalid("INVALID_DOCUMENT_EXPIRY", "Document expiry must be after the effective timestamp.");
  }

  return {
    input: {
      accessLevel,
      accessNotes: normalizeOptionalString(input.accessNotes ?? null) ?? "",
      aclEntries: aclEntries.value,
      assetId,
      documentType: documentType ?? undefined,
      effectiveAt: effectiveAt.value,
      expiresAt: expiresAt.value,
      lifecycleStatus,
      revisionDate: revisionDate.value,
      revisionLabel,
      supersedesDocumentRevisionId
    },
    status: "ok"
  };
}

/**
 * Normalizes redline creation inputs before persisting an engineering note.
 */
function normalizeDocumentRedlineCreateInput(input: DocumentRedlineCreateInput): { status: "ok"; input: RequiredDocumentRedlineCreateInput } | Extract<DocumentRedlineCreateResult, { status: "invalid" }> {
  const note = normalizeRequiredString(input.note);
  const severity = readRedlineSeverity(input.severity ?? "review");
  const pageNumber = input.pageNumber === undefined || input.pageNumber === null ? null : Number(input.pageNumber);

  if (!note) {
    return invalid("INVALID_DOCUMENT_REDLINE", "Document redlines require a note.");
  }

  if (!severity || (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 1))) {
    return invalid("INVALID_DOCUMENT_REDLINE", "Document redlines require a valid severity and optional positive page number.");
  }

  return {
    input: {
      anchorText: normalizeOptionalString(input.anchorText ?? null),
      note,
      pageNumber,
      severity
    },
    status: "ok"
  };
}

/**
 * Normalizes redline update inputs before changing review-note state.
 */
function normalizeDocumentRedlineUpdateInput(input: DocumentRedlineUpdateInput): { status: "ok"; input: RequiredDocumentRedlineUpdateInput } | Extract<DocumentRedlineUpdateResult, { status: "invalid" }> {
  const redlineStatus = readRedlineStatus(input.redlineStatus);

  if (!redlineStatus) {
    return invalid("INVALID_DOCUMENT_REDLINE_UPDATE", "Document redline updates require a supported redlineStatus.");
  }

  return {
    input: {
      note: normalizeOptionalString(input.note ?? null),
      redlineStatus
    },
    status: "ok"
  };
}

/**
 * Normalizes initial ACL entries while keeping future identity-directory details outside this layer.
 */
function normalizeAclEntries(entries: DocumentAclEntryCreateInput[]): { ok: true; value: DocumentAclEntryCreateInput[] } | { ok: false; message: string } {
  const normalized: DocumentAclEntryCreateInput[] = [];

  for (const entry of entries) {
    const principalType = readPrincipalType(entry.principalType);
    const principalId = normalizeRequiredString(entry.principalId);
    const permission = readPermission(entry.permission);
    const expiresAt = normalizeOptionalTimestamp(entry.expiresAt ?? null);

    if (!principalType || !principalId || !permission || !expiresAt.ok) {
      return { message: "ACL entries require principalType, principalId, permission, and an optional valid expiry.", ok: false };
    }

    normalized.push({
      expiresAt: expiresAt.value,
      permission,
      principalId,
      principalType
    });
  }

  return { ok: true, value: normalized };
}

/**
 * Infers the controlled document type from the existing asset class when callers do not provide one.
 */
function inferDocumentType(assetType: AssetType): DocumentControlType {
  if (assetType === "datasheet" || assetType === "mechanical_drawing") {
    return assetType;
  }

  return "other";
}

/**
 * Creates a typed invalid result shared by create/update validators.
 */
function invalid<TCode extends string>(code: TCode, message: string): { code: TCode; message: string; status: "invalid" } {
  return { code, message, status: "invalid" };
}

/**
 * Lazily creates the Postgres pool when DATABASE_URL exists.
 */
function getDocumentControlDatabasePool(): Pool | null {
  if (documentControlPoolOverride !== undefined) {
    return documentControlPoolOverride;
  }

  if (process.env.NODE_ENV === "test") {
    return null;
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
 * Rolls back a failed transaction without hiding the original error.
 */
async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Ignore rollback failures so the caller sees the original write failure.
  }
}

/**
 * Identifies unique-constraint conflicts from pg and pg-mem without binding to one error class.
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

/**
 * Converts database timestamps into ISO strings.
 */
function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Converts nullable database timestamps into ISO strings.
 */
function toNullableIsoTimestamp(value: Date | string | null): string | null {
  return value === null ? null : toIsoTimestamp(value);
}

/**
 * Converts date-only database values into stable YYYY-MM-DD strings.
 */
function toNullableDateOnly(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

/**
 * Normalizes a required string field.
 */
function normalizeRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Normalizes optional text while dropping blank strings.
 */
function normalizeOptionalString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validates date-only input without accepting ambiguous free text.
 */
function normalizeDateOnly(value: string | null): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === null || value.trim().length === 0) {
    return { ok: true, value: null };
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return { message: "Revision date must be YYYY-MM-DD.", ok: false };
  }

  return { ok: true, value: trimmed };
}

/**
 * Validates optional timestamp input and returns a normalized ISO string.
 */
function normalizeOptionalTimestamp(value: string | null): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === null || value.trim().length === 0) {
    return { ok: true, value: null };
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return { message: "Timestamp values must be parseable ISO dates.", ok: false };
  }

  return { ok: true, value: timestamp.toISOString() };
}

/**
 * Narrows document-control type values.
 */
function readDocumentControlType(value: unknown): DocumentControlType | null {
  return value === "datasheet" || value === "mechanical_drawing" || value === "controlled_drawing" || value === "specification" || value === "other" ? value : null;
}

/**
 * Narrows lifecycle status values.
 */
function readLifecycleStatus(value: unknown): DocumentRevisionLifecycleStatus | null {
  return value === "draft" || value === "in_review" || value === "released" || value === "superseded" || value === "expired" || value === "archived" ? value : null;
}

/**
 * Narrows document access level values.
 */
function readAccessLevel(value: unknown): DocumentAccessLevel | null {
  return value === "public" || value === "internal" || value === "restricted" || value === "itar_controlled" ? value : null;
}

/**
 * Narrows ACL principal type values.
 */
function readPrincipalType(value: unknown): DocumentAclPrincipalType | null {
  return value === "user" || value === "team" || value === "role" ? value : null;
}

/**
 * Narrows ACL permission values.
 */
function readPermission(value: unknown): DocumentAclPermission | null {
  return value === "view" || value === "review" || value === "approve" || value === "admin" ? value : null;
}

/**
 * Narrows redline severity values.
 */
function readRedlineSeverity(value: unknown): DocumentRedlineSeverity | null {
  return value === "info" || value === "review" || value === "blocker" ? value : null;
}

/**
 * Narrows redline status values.
 */
function readRedlineStatus(value: unknown): DocumentRedlineStatus | null {
  return value === "open" || value === "resolved" || value === "rejected" || value === "superseded" ? value : null;
}

/** RequiredDocumentRevisionCreateInput is the normalized internal shape used after validation. */
interface RequiredDocumentRevisionCreateInput {
  accessLevel: DocumentAccessLevel;
  accessNotes: string;
  aclEntries: DocumentAclEntryCreateInput[];
  assetId: string;
  documentType: DocumentControlType | undefined;
  effectiveAt: string | null;
  expiresAt: string | null;
  lifecycleStatus: DocumentRevisionLifecycleStatus;
  revisionDate: string | null;
  revisionLabel: string;
  supersedesDocumentRevisionId: string | null;
}

/** RequiredDocumentRedlineCreateInput is the normalized internal shape used after validation. */
interface RequiredDocumentRedlineCreateInput {
  anchorText: string | null;
  note: string;
  pageNumber: number | null;
  severity: DocumentRedlineSeverity;
}

/** RequiredDocumentRedlineUpdateInput is the normalized internal shape used after validation. */
interface RequiredDocumentRedlineUpdateInput {
  note: string | null;
  redlineStatus: DocumentRedlineStatus;
}

/** DatabaseDocumentAssetRow is the asset subset needed to anchor a controlled revision. */
interface DatabaseDocumentAssetRow {
  id: string;
  part_id: string;
  asset_type: AssetType;
  file_format: FileFormat;
  storage_key: string | null;
  file_hash: string | null;
  provenance: AssetProvenance;
  availability_status: AssetAvailabilityStatus;
  source_url: string | null;
}

/** DatabaseDocumentRevisionRow is the joined revision and asset row shape read from Postgres. */
interface DatabaseDocumentRevisionRow {
  access_level: DocumentAccessLevel;
  access_notes: string;
  asset_type: AssetType;
  asset_id: string;
  availability_status: AssetAvailabilityStatus;
  created_at: Date | string;
  created_by: string;
  document_type: DocumentControlType;
  effective_at: Date | string | null;
  expires_at: Date | string | null;
  file_format: FileFormat;
  file_hash: string | null;
  id: string;
  lifecycle_status: DocumentRevisionLifecycleStatus;
  part_id: string;
  provenance: AssetProvenance;
  revision_date: Date | string | null;
  revision_label: string;
  source_asset_hash: string | null;
  source_url: string | null;
  storage_key: string | null;
  supersedes_document_revision_id: string | null;
  updated_at: Date | string;
}

/** DatabaseDocumentAclRow is the persisted ACL row shape read from Postgres. */
interface DatabaseDocumentAclRow {
  created_at: Date | string;
  document_revision_id: string;
  expires_at: Date | string | null;
  granted_by: string;
  id: string;
  permission: DocumentAclPermission;
  principal_id: string;
  principal_type: DocumentAclPrincipalType;
}

/** DatabaseDocumentRedlineRow is the persisted redline row shape read from Postgres. */
interface DatabaseDocumentRedlineRow {
  anchor_text: string | null;
  created_at: Date | string;
  created_by: string;
  document_revision_id: string;
  id: string;
  note: string;
  page_number: number | null;
  redline_status: DocumentRedlineStatus;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  severity: DocumentRedlineSeverity;
  updated_at: Date | string;
}
