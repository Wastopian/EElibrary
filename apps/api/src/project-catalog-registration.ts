/**
 * File header: Registers project mirror BOM rows into the shared parts catalog and links where-used.
 *
 * Unmatched BOM lines become catalog parts with file-backed assets copied into object storage.
 * Matched lines are enriched with any missing datasheet, model, or footprint files from the mirror.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import type { AssetType, BomLine } from "@ee-library/shared/types";
import { getStorageClient } from "./file-storage";
import {
  buildPartLookupKeys,
  findMirrorAssetsForPart,
  hashMirrorAssetFile,
  indexMirrorAssetFiles,
  type MirrorAssetFile
} from "./project-folder-assets";

/** PROJECT_MIRROR_PROVIDER_ID tags catalog rows sourced from project folder sync. */
export const PROJECT_MIRROR_PROVIDER_ID = "project-folder-mirror";

/** UNKNOWN_INTAKE_PACKAGE_ID is the shared placeholder package for intake-created parts. */
export const UNKNOWN_INTAKE_PACKAGE_ID = "pkg-project-intake-unknown";

/** ProjectCatalogRegistrationSummary reports catalog writes performed during mirror ingest. */
export interface ProjectCatalogRegistrationSummary {
  catalogAssetsIngested: number;
  partsRegistered: number;
  usagesLinked: number;
}

/**
 * Registers mirror BOM rows in the catalog and links confirmed project usages for matched parts.
 */
export async function registerCatalogPartsFromProjectMirror(
  databasePool: Pool,
  projectId: string,
  projectRoot: string,
  lines: BomLine[],
  actor: string
): Promise<ProjectCatalogRegistrationSummary> {
  if (lines.length === 0) {
    return { catalogAssetsIngested: 0, partsRegistered: 0, usagesLinked: 0 };
  }

  const assetIndex = await indexMirrorAssetFiles(projectRoot);
  const storage = getStorageClient();
  const client = await databasePool.connect();
  let partsRegistered = 0;
  let catalogAssetsIngested = 0;
  let usagesLinked = 0;

  try {
    await client.query("BEGIN");
    await ensureUnknownIntakePackage(client);

    for (const line of lines) {
      const lookupKeys = collectLineLookupKeys(line);
      const mirrorFiles = lookupKeys.length > 0 ? findMirrorAssetsForPart(assetIndex, lookupKeys) : [];

      if (line.matchStatus === "matched" && line.matchedPartId) {
        catalogAssetsIngested += await ingestMirrorFilesIntoCatalogPart(client, storage, line.matchedPartId, mirrorFiles, actor);
        usagesLinked += await upsertCatalogUsageForLine(client, line, line.matchedPartId);
        continue;
      }

      if (line.matchStatus !== "unmatched" || !normalizeOptionalText(line.rawMpn)) {
        continue;
      }

      const partId = await ensureCatalogPartForBomLine(client, line, actor);

      if (!partId) {
        continue;
      }

      partsRegistered += 1;
      catalogAssetsIngested += await ingestMirrorFilesIntoCatalogPart(client, storage, partId, mirrorFiles, actor);
      await markBomLineMatched(client, line, partId);
      usagesLinked += await upsertCatalogUsageForLine(client, line, partId);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { catalogAssetsIngested, partsRegistered, usagesLinked };
}

/**
 * Collects lookup keys for one BOM line from its MPN and designators.
 */
function collectLineLookupKeys(line: BomLine): string[] {
  const keys = new Set<string>();

  for (const partName of [line.rawMpn, ...line.designators]) {
    const normalized = normalizeOptionalText(partName);
    if (!normalized) {
      continue;
    }

    for (const key of buildPartLookupKeys(normalized)) {
      keys.add(key);
    }
  }

  return Array.from(keys);
}

/**
 * Ensures the shared unknown package exists for intake-created parts.
 */
async function ensureUnknownIntakePackage(client: PoolClient): Promise<void> {
  await client.query(
    `
      INSERT INTO packages (id, package_name)
      VALUES ($1, 'Unknown (project intake)')
      ON CONFLICT (id) DO NOTHING
    `,
    [UNKNOWN_INTAKE_PACKAGE_ID]
  );
}

/**
 * Resolves or creates one catalog part for an unmatched BOM line.
 */
async function ensureCatalogPartForBomLine(client: PoolClient, line: BomLine, actor: string): Promise<string | null> {
  const rawMpn = normalizeOptionalText(line.rawMpn);
  if (!rawMpn) {
    return null;
  }

  const manufacturerId = await ensureManufacturerForBomLine(client, line);
  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM parts
      WHERE manufacturer_id = $1
        AND lower(mpn) = lower($2)
      LIMIT 1
    `,
    [manufacturerId, rawMpn]
  );
  const existingId = existing.rows[0]?.id;

  if (existingId) {
    await ensureProjectMirrorSourceRecord(client, existingId, rawMpn, line, actor);
    return existingId;
  }

  const partId = buildIntakePartId(manufacturerId, rawMpn);
  const now = new Date().toISOString();
  const description =
    normalizeOptionalText(line.rawDescription) ??
    `Registered from project folder mirror (${normalizeOptionalText(line.rawManufacturer) ?? "unknown manufacturer"}).`;

  await client.query(
    `
      INSERT INTO parts (
        id,
        mpn,
        description,
        manufacturer_id,
        category,
        lifecycle_status,
        package_id,
        connector_family_id,
        trust_score,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, 'Other', 'active', $5, NULL, 0.25, $6)
      ON CONFLICT (manufacturer_id, mpn) DO UPDATE SET
        description = EXCLUDED.description,
        last_updated_at = EXCLUDED.last_updated_at
      RETURNING id
    `,
    [partId, rawMpn, description, manufacturerId, UNKNOWN_INTAKE_PACKAGE_ID, now]
  );

  await ensureCatalogPartProjections(client, partId, now);
  await ensureProjectMirrorSourceRecord(client, partId, rawMpn, line, actor);

  const resolved = await client.query<{ id: string }>(
    `
      SELECT id
      FROM parts
      WHERE manufacturer_id = $1
        AND lower(mpn) = lower($2)
      LIMIT 1
    `,
    [manufacturerId, rawMpn]
  );

  return resolved.rows[0]?.id ?? partId;
}

/**
 * Creates baseline readiness and approval rows for intake-created catalog parts.
 */
async function ensureCatalogPartProjections(client: PoolClient, partId: string, now: string): Promise<void> {
  await client.query(
    `
      INSERT INTO part_readiness_summaries (
        part_id,
        readiness_status,
        identity_status,
        connector_class,
        blocker_count,
        blocker_summary,
        recommended_actions,
        detail,
        last_evaluated_at
      )
      VALUES ($1, 'needs_attention', 'unknown', 'non_connector', 1, '{"Project folder intake only"}', '{"Review datasheet and CAD before export"}', 'Registered from a project folder mirror. Assets are file-backed but not validated.', $2)
      ON CONFLICT (part_id) DO NOTHING
    `,
    [partId, now]
  );
  await client.query(
    `
      INSERT INTO part_approvals (part_id, approval_status, summary, detail, evidence, decided_by, decided_at, last_updated_at)
      VALUES ($1, 'pending_review', 'Pending review', 'Project folder intake does not approve this part for export.', '{"project_folder_mirror"}', NULL, NULL, $2)
      ON CONFLICT (part_id) DO NOTHING
    `,
    [partId, now]
  );
}

/**
 * Ensures a manufacturer row exists for one BOM line.
 */
async function ensureManufacturerForBomLine(client: PoolClient, line: BomLine): Promise<string> {
  const manufacturerName = normalizeOptionalText(line.rawManufacturer) ?? "Unknown manufacturer";
  const manufacturerId = `mfg-intake-${slugifyToken(manufacturerName)}`;

  await client.query(
    `
      INSERT INTO manufacturers (id, name, aliases)
      VALUES ($1, $2, '{}')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name
    `,
    [manufacturerId, manufacturerName]
  );

  return manufacturerId;
}

/**
 * Persists a source record that explains the project mirror intake provenance.
 */
async function ensureProjectMirrorSourceRecord(
  client: PoolClient,
  partId: string,
  rawMpn: string,
  line: BomLine,
  actor: string
): Promise<void> {
  const now = new Date().toISOString();
  const sourceRecordId = `source-${PROJECT_MIRROR_PROVIDER_ID}-${slugifyToken(rawMpn)}-${slugifyToken(line.projectId)}`;

  await client.query(
    `
      INSERT INTO source_records (
        id,
        provider_id,
        provider_part_key,
        part_id,
        source_url,
        fetched_at,
        raw_payload,
        normalized_at,
        source_last_seen_at,
        source_last_imported_at,
        import_status,
        import_error_details,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, NULL, $5, $6::jsonb, $5, $5, $5, 'imported', NULL, $5)
      ON CONFLICT (id) DO UPDATE SET
        part_id = EXCLUDED.part_id,
        source_last_seen_at = EXCLUDED.source_last_seen_at,
        source_last_imported_at = EXCLUDED.source_last_imported_at,
        import_status = EXCLUDED.import_status,
        last_updated_at = EXCLUDED.last_updated_at
    `,
    [
      sourceRecordId,
      PROJECT_MIRROR_PROVIDER_ID,
      rawMpn,
      partId,
      now,
      JSON.stringify({
        actor,
        bomLineId: line.id,
        projectId: line.projectId,
        source: "project_folder_mirror"
      })
    ]
  );
}

/**
 * Copies mirror files into catalog storage and registers assets on the part.
 */
async function ingestMirrorFilesIntoCatalogPart(
  client: PoolClient,
  storage: ReturnType<typeof getStorageClient>,
  partId: string,
  mirrorFiles: MirrorAssetFile[],
  actor: string
): Promise<number> {
  let ingested = 0;

  for (const file of mirrorFiles) {
    const assetType = mapMirrorCategoryToAssetType(file.category);
    if (!assetType || (await catalogAssetAlreadyExists(client, partId, assetType, file.name))) {
      continue;
    }

    const content = await readFile(file.absolutePath);
    const storageKey = buildCatalogAssetStorageKey(partId, assetType, file.name);
    const fileHash = createHash("sha256").update(content).digest("hex");

    if (storage.backend !== "not_configured") {
      await storage.write(storageKey, content);
    }

    const now = new Date().toISOString();
    const assetId = `asset-${slugifyToken(partId)}-${slugifyToken(assetType)}-${slugifyToken(path.parse(file.name).name)}`.slice(0, 180);
    const fileFormat = inferCatalogFileFormat(file.name, assetType);
    const sourceUrl = `file://${file.absolutePath.replace(/\\/gu, "/")}`;
    const persistedStorageKey = storage.backend === "not_configured" ? null : storageKey;
    const availabilityStatus = persistedStorageKey && fileHash ? "downloaded" : "referenced";
    const assetState = persistedStorageKey && fileHash ? "downloaded" : "referenced";

    await client.query(
      `
        INSERT INTO assets (
          id,
          part_id,
          asset_type,
          file_format,
          storage_key,
          file_hash,
          provider_id,
          license_mode,
          provenance,
          availability_status,
          review_status,
          export_status,
          asset_status,
          validation_status,
          preview_status,
          asset_state,
          source_url,
          last_updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          'metadata_only',
          'manual_internal',
          $8,
          'review_required',
          'not_exportable',
          $9,
          'not_validated',
          'not_available',
          $10,
          $11,
          $12
        )
        ON CONFLICT (id) DO UPDATE SET
          storage_key = COALESCE(assets.storage_key, EXCLUDED.storage_key),
          file_hash = COALESCE(assets.file_hash, EXCLUDED.file_hash),
          source_url = EXCLUDED.source_url,
          availability_status = EXCLUDED.availability_status,
          asset_state = EXCLUDED.asset_state,
          asset_status = EXCLUDED.asset_status,
          last_updated_at = EXCLUDED.last_updated_at
      `,
      [
        assetId,
        partId,
        assetType,
        fileFormat,
        persistedStorageKey,
        fileHash,
        PROJECT_MIRROR_PROVIDER_ID,
        availabilityStatus,
        assetState,
        assetState,
        persistedStorageKey ? null : sourceUrl,
        now
      ]
    );

    if (assetType === "datasheet") {
      await ensureDatasheetRevisionForAsset(client, partId, assetId, file.name);
    }

    ingested += 1;
  }

  return ingested;
}

/**
 * Ensures a minimal datasheet revision row exists when a datasheet asset is ingested.
 */
async function ensureDatasheetRevisionForAsset(
  client: PoolClient,
  partId: string,
  assetId: string,
  fileName: string
): Promise<void> {
  const revisionId = `dsr-${slugifyToken(partId)}-mirror-${slugifyToken(path.parse(fileName).name)}`.slice(0, 180);

  await client.query(
    `
      INSERT INTO datasheet_revisions (id, part_id, revision_label, file_asset_id, parse_confidence, pin_table_status)
      VALUES ($1, $2, $3, $4, 0.25, 'not_available')
      ON CONFLICT (id) DO UPDATE SET
        file_asset_id = COALESCE(datasheet_revisions.file_asset_id, EXCLUDED.file_asset_id)
    `,
    [revisionId, partId, `Project mirror (${fileName})`, assetId]
  );
}

/**
 * Returns true when the part already has a similarly named catalog asset for the type.
 */
async function catalogAssetAlreadyExists(
  client: PoolClient,
  partId: string,
  assetType: AssetType,
  fileName: string
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM assets
      WHERE part_id = $1
        AND asset_type = $2
        AND (
          storage_key LIKE $3
          OR source_url LIKE $3
        )
      LIMIT 1
    `,
    [partId, assetType, `%${fileName.replace(/[%_]/gu, "")}%`]
  );

  return result.rows.length > 0;
}

/**
 * Marks one BOM line as an exact catalog match after intake registration.
 */
async function markBomLineMatched(client: PoolClient, line: BomLine, partId: string): Promise<void> {
  const now = new Date();

  await client.query(
    `
      UPDATE bom_lines
      SET matched_part_id = $2,
        match_status = 'matched',
        match_confidence_score = 1,
        updated_at = $3
      WHERE id = $1
    `,
    [line.id, partId, now]
  );
}

/**
 * Upserts a confirmed project usage row for one matched BOM line.
 */
async function upsertCatalogUsageForLine(client: PoolClient, line: BomLine, partId: string): Promise<number> {
  const usageId = `usage-${slugifyToken(line.id)}`;
  const now = new Date();
  const usageContext = normalizeOptionalText(line.rawDescription)
    ? `BOM row ${line.rowNumber}: ${normalizeOptionalText(line.rawDescription)}`
    : `BOM row ${line.rowNumber}: project folder mirror match`;

  const result = await client.query<{ id: string }>(
    `
      INSERT INTO project_part_usages (
        id,
        project_id,
        project_revision_id,
        bom_line_id,
        part_id,
        usage_context,
        designators,
        quantity,
        usage_status,
        approval_snapshot,
        readiness_snapshot,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'proposed', '{}'::jsonb, '{}'::jsonb, $9, $9)
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        project_revision_id = EXCLUDED.project_revision_id,
        bom_line_id = EXCLUDED.bom_line_id,
        part_id = EXCLUDED.part_id,
        usage_context = EXCLUDED.usage_context,
        designators = EXCLUDED.designators,
        quantity = EXCLUDED.quantity,
        usage_status = EXCLUDED.usage_status,
        updated_at = EXCLUDED.updated_at
      RETURNING id
    `,
    [usageId, line.projectId, line.projectRevisionId, line.id, partId, usageContext, line.designators, line.quantity, now]
  );

  return result.rows.length > 0 ? 1 : 0;
}

/**
 * Infers the catalog file_format token from a mirror filename and asset type.
 */
function inferCatalogFileFormat(fileName: string, assetType: AssetType): string {
  const extension = path.extname(fileName).toLowerCase().replace(/^\./u, "");

  if (extension === "pdf") {
    return "pdf";
  }

  if (extension === "step" || extension === "stp") {
    return "step";
  }

  if (extension === "stl") {
    return "stl";
  }

  if (extension === "kicad_mod" || extension === "mod") {
    return "kicad_mod";
  }

  if (extension === "kicad_sym" || extension === "sym") {
    return "kicad_sym";
  }

  if (assetType === "datasheet") {
    return "pdf";
  }

  if (assetType === "three_d_model") {
    return "step";
  }

  if (assetType === "footprint") {
    return "kicad_mod";
  }

  return extension.length > 0 ? extension : "unknown";
}

/**
 * Maps mirror folder categories to catalog asset types.
 */
function mapMirrorCategoryToAssetType(category: MirrorAssetFile["category"]): AssetType | null {
  switch (category) {
    case "datasheets":
      return "datasheet";
    case "models":
      return "three_d_model";
    case "footprints":
      return "footprint";
    default:
      return null;
  }
}

/**
 * Builds a deterministic catalog storage key for one intake asset.
 */
function buildCatalogAssetStorageKey(partId: string, assetType: AssetType, fileName: string): string {
  return `project-intake/${slugifyToken(partId)}/${assetType}/${slugifyToken(fileName)}`;
}

/**
 * Builds a stable intake part id from manufacturer and MPN tokens.
 */
function buildIntakePartId(manufacturerId: string, rawMpn: string): string {
  return `part-intake-${slugifyToken(manufacturerId)}-${slugifyToken(rawMpn)}`.slice(0, 180);
}

/**
 * Normalizes optional free text from BOM rows.
 */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Slugifies one token for ids and storage keys.
 */
function slugifyToken(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "unknown";
}
