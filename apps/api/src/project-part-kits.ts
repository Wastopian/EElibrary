/**
 * File header: Builds and updates project-scoped part kits from BOM metadata and mirror folders.
 */

import { Pool } from "pg";
import type {
  ProjectMirrorIngestResponse,
  ProjectPartKit,
  ProjectPartKitFileRef,
  ProjectPartKitUpdateInput,
  ProjectPartKitsResponse
} from "@ee-library/shared/types";
import { selectBestAvailableAsset } from "@ee-library/shared/asset-resolution";
import type { Asset, AssetType } from "@ee-library/shared/types";
import { CatalogStoreError } from "./catalog-store";
import { ensureProjectMirrorForKey, getProjectFilesRoot } from "./project-files";
import {
  buildPartLookupKeys,
  findMirrorAssetsForPart,
  indexMirrorAssetFiles,
  type MirrorAssetCategory,
  type MirrorAssetFile
} from "./project-folder-assets";
import { ingestProjectMirrorForProjectInDatabase, readProjectPartUsagesFromDatabase } from "./project-memory-store";

/** ProjectPartKitsListResult is the store outcome for listing kits. */
export type ProjectPartKitsListResult =
  | { status: "not_configured" }
  | { status: "not_found" }
  | { status: "ready"; response: ProjectPartKitsResponse };

/** ProjectPartKitUpdateResult is the store outcome for updating one kit. */
export type ProjectPartKitUpdateResult =
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string }
  | { status: "invalid"; code: string; message: string }
  | { status: "ready"; response: { kit: ProjectPartKit; catalogSync: ProjectMirrorIngestResponse | null } };

/**
 * Lists part kits for every part in a project: confirmed usage, matched BOM rows,
 * catalog parts referenced by BOM MPN, and on-disk mirror assets.
 */
export async function listProjectPartKitsInDatabase(projectId: string): Promise<ProjectPartKitsListResult> {
  if (!isDatabaseConfigured()) {
    return { status: "not_configured" };
  }

  const databasePool = getDatabasePool();
  const projectRow = await databasePool.query<{ id: string; project_key: string }>(
    "SELECT id, project_key FROM projects WHERE id = $1 LIMIT 1",
    [projectId]
  );

  if (!projectRow.rows[0]) {
    return { status: "not_found" };
  }

  const usageResult = await readProjectPartUsagesFromDatabase(projectId);

  if (usageResult.status === "not_configured") {
    return { status: "not_configured" };
  }

  if (usageResult.status === "not_found") {
    return { status: "not_found" };
  }

  const usages = usageResult.response.usages;
  const mirror = await ensureProjectMirrorForKey(projectRow.rows[0].project_key);
  const assetIndex =
    mirror.availability === "configured" && mirror.projectRoot
      ? await indexMirrorAssetFiles(mirror.projectRoot)
      : new Map<string, MirrorAssetFile[]>();

  const kitsByPartId = new Map<string, ProjectPartKit>();
  const bomLines = await readProjectBomLinesForKits(databasePool, projectId);
  const catalogByMpn = await lookupCatalogPartsByMpns(
    databasePool,
    collectMpnsForCatalogLookup(usages, bomLines, assetIndex)
  );
  const metadataByPartId = await readBomMetadataByPartId(databasePool, projectId, catalogByMpn);

  for (const usage of usages) {
    mergePartKit(kitsByPartId, {
      designators: usage.designators,
      manufacturerName: usage.manufacturerName ?? null,
      metadata: metadataByPartId.get(usage.partId) ?? { note: null, partUrl: null },
      mirrorFiles: findMirrorAssetsForPart(assetIndex, buildPartLookupKeys(usage.partMpn?.trim() ?? usage.partId)),
      mpn: usage.partMpn?.trim() ?? usage.partId,
      partId: usage.partId,
      usageId: usage.id
    });
  }

  for (const line of bomLines) {
    const mpn = line.rawMpn?.trim();
    if (!mpn) {
      continue;
    }

    const partId = line.matchedPartId ?? catalogByMpn.get(normalizeMpnLookupKey(mpn))?.partId ?? null;
    if (!partId) {
      continue;
    }

    const catalogPart = catalogByMpn.get(normalizeMpnLookupKey(mpn));
    mergePartKit(kitsByPartId, {
      designators: line.designators,
      manufacturerName: line.rawManufacturer?.trim() ?? catalogPart?.manufacturerName ?? null,
      metadata: metadataByPartId.get(partId) ?? readBomLineMetadata(line),
      mirrorFiles: findMirrorAssetsForPart(assetIndex, buildPartLookupKeys(mpn)),
      mpn,
      partId,
      usageId: null
    });
  }

  for (const mpn of collectMirrorPartMpns(assetIndex)) {
    const catalogPart = catalogByMpn.get(normalizeMpnLookupKey(mpn));
    if (!catalogPart || kitsByPartId.has(catalogPart.partId)) {
      continue;
    }

    mergePartKit(kitsByPartId, {
      designators: [],
      manufacturerName: catalogPart.manufacturerName,
      metadata: metadataByPartId.get(catalogPart.partId) ?? { note: null, partUrl: null },
      mirrorFiles: findMirrorAssetsForPart(assetIndex, buildPartLookupKeys(mpn)),
      mpn: catalogPart.mpn,
      partId: catalogPart.partId,
      usageId: null
    });
  }

  const partIds = [...kitsByPartId.keys()];
  const catalogAssetsByPartId = await readCatalogKitFilesByPartId(databasePool, partIds);
  const catalogContextByPartId = await readCatalogPartContextByPartId(databasePool, partIds);

  for (const kit of kitsByPartId.values()) {
    mergeCatalogAssetsIntoKit(kit, catalogAssetsByPartId.get(kit.partId));
    const catalogContext = catalogContextByPartId.get(kit.partId);

    if (catalogContext) {
      kit.partUrl ??= catalogContext.partUrl;
      kit.note ??= catalogContext.note;
    }
  }

  const kits = Array.from(kitsByPartId.values()).sort((left, right) =>
    left.mpn.localeCompare(right.mpn, undefined, { sensitivity: "base" })
  );

  const mirrorRootConfigured = Boolean(getProjectFilesRoot());

  return {
    status: "ready",
    response: {
      kits,
      mirrorAvailable: mirror.availability === "configured" || mirrorRootConfigured,
      projectId
    }
  };
}

/**
 * Updates BOM-linked note and supplier URL for one part, optionally syncing mirror assets to the catalog.
 */
export async function updateProjectPartKitInDatabase(
  projectId: string,
  partId: string,
  input: ProjectPartKitUpdateInput,
  actorId: string
): Promise<ProjectPartKitUpdateResult> {
  if (!isDatabaseConfigured()) {
    return { status: "not_configured" };
  }

  if (input.partUrl === undefined && input.note === undefined && input.syncToCatalog !== true) {
    return {
      status: "invalid",
      code: "INVALID_PART_KIT_UPDATE",
      message: "Part kit update requires a note, part URL, or syncToCatalog request."
    };
  }

  const databasePool = getDatabasePool();
  const projectRow = await databasePool.query<{ id: string }>("SELECT id FROM projects WHERE id = $1 LIMIT 1", [projectId]);

  if (!projectRow.rows[0]) {
    return { status: "not_found", code: "PROJECT_NOT_FOUND", message: "Project not found." };
  }

  const usageCheck = await databasePool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM (
        SELECT 1
        FROM project_part_usages
        WHERE project_id = $1 AND part_id = $2
        UNION ALL
        SELECT 1
        FROM bom_lines
        WHERE project_id = $1 AND matched_part_id = $2
        UNION ALL
        SELECT 1
        FROM bom_lines bl
        INNER JOIN parts p ON lower(p.mpn) = lower(bl.raw_mpn)
        WHERE bl.project_id = $1 AND p.id = $2
      ) linked
    `,
    [projectId, partId]
  );

  if (Number(usageCheck.rows[0]?.count ?? "0") === 0) {
    return {
      status: "not_found",
      code: "PART_NOT_IN_PROJECT",
      message: "This part is not confirmed in the project yet."
    };
  }

  const now = new Date().toISOString();

  if (input.partUrl !== undefined || input.note !== undefined) {
    await databasePool.query(
      `
        UPDATE bom_lines
        SET
          raw_supplier_reference = CASE WHEN $3::boolean THEN $4 ELSE raw_supplier_reference END,
          raw_description = CASE WHEN $5::boolean THEN $6 ELSE raw_description END,
          updated_at = $7
        WHERE project_id = $1
          AND (
            matched_part_id = $2
            OR EXISTS (
              SELECT 1
              FROM parts p
              WHERE p.id = $2
                AND lower(p.mpn) = lower(bom_lines.raw_mpn)
            )
          )
      `,
      [
        projectId,
        partId,
        input.partUrl !== undefined,
        normalizeOptionalText(input.partUrl),
        input.note !== undefined,
        normalizeOptionalText(input.note),
        now
      ]
    );
  }

  let catalogSync: ProjectMirrorIngestResponse | null = null;

  if (input.syncToCatalog) {
    const ingestResult = await ingestProjectMirrorForProjectInDatabase(projectId, actorId);

    if (ingestResult.status === "not_configured") {
      return { status: "not_configured" };
    }

    if (ingestResult.status === "not_found") {
      return { status: "not_found", code: "PROJECT_NOT_FOUND", message: "Project not found." };
    }

    if (ingestResult.status === "mirror_unavailable") {
      throw new CatalogStoreError(
        "query_failed",
        ingestResult.message ?? "Project mirror ingest is unavailable.",
        new Error("project_mirror_unavailable")
      );
    }

    catalogSync = ingestResult.response;
  }

  const listed = await listProjectPartKitsInDatabase(projectId);

  if (listed.status !== "ready") {
    return { status: "not_configured" };
  }

  const kit = listed.response.kits.find((entry) => entry.partId === partId);

  if (!kit) {
    return {
      status: "not_found",
      code: "PART_NOT_IN_PROJECT",
      message: "This part is not confirmed in the project yet."
    };
  }

  return {
    status: "ready",
    response: {
      catalogSync,
      kit
    }
  };
}

/** CatalogPartSummary is the minimum catalog identity needed to build a kit row. */
interface CatalogPartSummary {
  manufacturerName: string | null;
  mpn: string;
  partId: string;
}

/** PartKitMergeInput is one upsert into the kits map. */
interface PartKitMergeInput {
  designators: string[];
  manufacturerName: string | null;
  metadata: { note: string | null; partUrl: string | null };
  mirrorFiles: MirrorAssetFile[];
  mpn: string;
  partId: string;
  usageId: string | null;
}

/**
 * Merges one part identity into the kits map.
 */
function mergePartKit(kitsByPartId: Map<string, ProjectPartKit>, input: PartKitMergeInput): void {
  const existing = kitsByPartId.get(input.partId);

  if (existing) {
    existing.designators = mergeDesignators(existing.designators, input.designators);
    if (input.usageId) {
      existing.usageIds.push(input.usageId);
    }
    if (!existing.note && input.metadata.note) {
      existing.note = input.metadata.note;
    }
    if (!existing.partUrl && input.metadata.partUrl) {
      existing.partUrl = input.metadata.partUrl;
    }
    if (!existing.manufacturerName && input.manufacturerName) {
      existing.manufacturerName = input.manufacturerName;
    }
    existing.datasheet ??= pickKitFile(input.mirrorFiles, "datasheets");
    existing.model ??= pickKitFile(input.mirrorFiles, "models");
    existing.footprint ??= pickKitFile(input.mirrorFiles, "footprints");
    return;
  }

  kitsByPartId.set(input.partId, {
    datasheet: pickKitFile(input.mirrorFiles, "datasheets"),
    designators: [...input.designators],
    footprint: pickKitFile(input.mirrorFiles, "footprints"),
    manufacturerName: input.manufacturerName,
    model: pickKitFile(input.mirrorFiles, "models"),
    mpn: input.mpn,
    note: input.metadata.note,
    partId: input.partId,
    partUrl: input.metadata.partUrl,
    usageIds: input.usageId ? [input.usageId] : []
  });
}

/**
 * Reads every BOM line for one project so kits stay populated across re-imports.
 */
async function readProjectBomLinesForKits(
  databasePool: Pool,
  projectId: string
): Promise<
  Array<{
    designators: string[];
    matchedPartId: string | null;
    rawDescription: string | null;
    rawManufacturer: string | null;
    rawMpn: string | null;
    rawRowPayload: Record<string, unknown>;
    rawSupplierReference: string | null;
  }>
> {
  const result = await databasePool.query<{
    designators: string[] | null;
    matched_part_id: string | null;
    raw_manufacturer: string | null;
    raw_description: string | null;
    raw_mpn: string | null;
    raw_row_payload: Record<string, unknown> | null;
    raw_supplier_reference: string | null;
  }>(
    `
      SELECT designators, matched_part_id, raw_manufacturer, raw_mpn, raw_description, raw_supplier_reference, raw_row_payload
      FROM bom_lines
      WHERE project_id = $1
      ORDER BY updated_at DESC, id ASC
    `,
    [projectId]
  );

  return result.rows.map((row) => ({
    designators: Array.isArray(row.designators) ? row.designators : [],
    matchedPartId: row.matched_part_id,
    rawDescription: row.raw_description,
    rawManufacturer: row.raw_manufacturer,
    rawMpn: row.raw_mpn,
    rawRowPayload: row.raw_row_payload && typeof row.raw_row_payload === "object" ? row.raw_row_payload : {},
    rawSupplierReference: row.raw_supplier_reference
  }));
}

/**
 * Loads catalog parts for a set of BOM or mirror MPN strings.
 */
async function lookupCatalogPartsByMpns(
  databasePool: Pool,
  mpns: string[]
): Promise<Map<string, CatalogPartSummary>> {
  const loweredMpns = [...new Set(mpns.map((mpn) => mpn.trim().toLowerCase()).filter(Boolean))];

  if (loweredMpns.length === 0) {
    return new Map();
  }

  const result = await databasePool.query<{
    id: string;
    manufacturer_name: string | null;
    mpn: string;
  }>(
    `
      SELECT p.id, p.mpn, m.name AS manufacturer_name
      FROM parts p
      LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
      WHERE lower(p.mpn) = ANY($1::text[])
    `,
    [loweredMpns]
  );

  const catalogByMpn = new Map<string, CatalogPartSummary>();

  for (const row of result.rows) {
    const key = normalizeMpnLookupKey(row.mpn);
    if (!key || catalogByMpn.has(key)) {
      continue;
    }

    catalogByMpn.set(key, {
      manufacturerName: row.manufacturer_name,
      mpn: row.mpn,
      partId: row.id
    });
  }

  return catalogByMpn;
}

/**
 * Collects MPN strings that may need catalog lookups while building kits.
 */
function collectMpnsForCatalogLookup(
  usages: Array<{ partMpn?: string }>,
  bomLines: Array<{ rawMpn: string | null }>,
  assetIndex: Map<string, MirrorAssetFile[]>
): string[] {
  const mpns = new Set<string>();

  for (const usage of usages) {
    const mpn = usage.partMpn?.trim();
    if (mpn) {
      mpns.add(mpn);
    }
  }

  for (const line of bomLines) {
    const mpn = line.rawMpn?.trim();
    if (mpn) {
      mpns.add(mpn);
    }
  }

  for (const label of collectMirrorPartMpns(assetIndex)) {
    mpns.add(label);
  }

  return Array.from(mpns);
}

/**
 * Collects human-readable part labels from indexed mirror asset paths.
 */
function collectMirrorPartMpns(assetIndex: Map<string, MirrorAssetFile[]>): string[] {
  const labels = new Set<string>();

  for (const files of assetIndex.values()) {
    for (const file of files) {
      const label = readMirrorPartLabel(file);
      if (label) {
        labels.add(label);
      }
    }
  }

  return Array.from(labels);
}

/**
 * Reads the part folder or filename stem from one mirror asset path.
 */
function readMirrorPartLabel(file: MirrorAssetFile): string | null {
  const segments = file.relativePath.split("/").filter(Boolean);

  if (segments.length >= 3) {
    return segments[1] ?? null;
  }

  if (segments.length === 2) {
    const fileName = segments[1] ?? "";
    const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
    const stem = extension ? fileName.slice(0, -extension.length) : fileName;

    return stem.length > 0 ? stem : null;
  }

  return null;
}

/**
 * Normalizes one MPN for catalog lookup comparisons.
 */
function normalizeMpnLookupKey(mpn: string): string {
  return mpn.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

/**
 * Reads note and supplier URL from one BOM line when no aggregated metadata exists yet.
 */
function readBomLineMetadata(line: {
  rawDescription: string | null;
  rawMpn: string | null;
  rawRowPayload: Record<string, unknown>;
  rawSupplierReference: string | null;
}): { note: string | null; partUrl: string | null } {
  const mpn = line.rawMpn?.trim() ?? null;

  return {
    note: pickBomDescription(line.rawDescription, line.rawRowPayload, mpn),
    partUrl: pickBomSupplierUrl(line.rawSupplierReference, line.rawRowPayload)
  };
}

/**
 * Resolves the BOM descriptor from the mapped description column or common header aliases.
 */
export function pickBomDescription(
  rawDescription: string | null,
  rawRowPayload: Record<string, unknown>,
  mpn: string | null = null
): string | null {
  return (
    normalizeOptionalText(rawDescription) ??
    pickPayloadText(rawRowPayload, BOM_DESCRIPTION_HEADER_HINTS) ??
    scanPayloadForDescription(rawRowPayload, mpn)
  );
}

/**
 * Resolves the supplier URL from the mapped supplier column or URL-like payload fields.
 */
export function pickBomSupplierUrl(rawSupplierReference: string | null, rawRowPayload: Record<string, unknown>): string | null {
  const direct =
    normalizeOptionalText(rawSupplierReference) ??
    pickPayloadText(rawRowPayload, BOM_SUPPLIER_HEADER_HINTS) ??
    scanPayloadForHttpUrl(rawRowPayload);

  if (!direct) {
    return null;
  }

  return direct;
}

/** BOM_DESCRIPTION_HEADER_HINTS names common spreadsheet headers for the part descriptor. */
const BOM_DESCRIPTION_HEADER_HINTS = [
  "description",
  "desc",
  "part description",
  "item description",
  "value",
  "comment",
  "comments"
];

/** BOM_SUPPLIER_HEADER_HINTS names common spreadsheet headers for supplier purchase links. */
const BOM_SUPPLIER_HEADER_HINTS = [
  "supplier",
  "supplier url",
  "supplier link",
  "product url",
  "purchase link",
  "link",
  "url",
  "digikey",
  "mouser",
  "lcsc",
  "jlcpcb"
];

/**
 * Reads the first non-empty payload cell that matches one of the supplied header hints.
 */
function pickPayloadText(payload: Record<string, unknown>, headerHints: string[]): string | null {
  const normalizedHints = new Set(headerHints.map((hint) => hint.toLowerCase()));

  for (const [header, value] of Object.entries(payload)) {
    const normalizedHeader = header.trim().toLowerCase();
    const matchesHint =
      normalizedHints.has(normalizedHeader) ||
      (normalizedHints.has("url") && (normalizedHeader.includes("url") || normalizedHeader.includes("link")));

    if (!matchesHint) {
      continue;
    }

    const text = normalizeOptionalText(typeof value === "string" ? value : value == null ? null : String(value));

    if (text) {
      return text;
    }
  }

  return null;
}

/**
 * Scans every BOM payload cell for the first http(s) URL when columns were not mapped.
 */
function scanPayloadForHttpUrl(payload: Record<string, unknown>): string | null {
  for (const value of Object.values(payload)) {
    const text = normalizeOptionalText(typeof value === "string" ? value : value == null ? null : String(value));

    if (text && /^https?:\/\//iu.test(text)) {
      return text;
    }
  }

  return null;
}

/**
 * Picks the longest plausible description cell when header mapping did not run.
 */
function scanPayloadForDescription(payload: Record<string, unknown>, mpn: string | null): string | null {
  const mpnNorm = mpn?.trim().toLowerCase() ?? "";
  let best: string | null = null;
  let bestLength = 0;

  for (const value of Object.values(payload)) {
    const text = normalizeOptionalText(typeof value === "string" ? value : value == null ? null : String(value));

    if (!text || text.length < 4) {
      continue;
    }

    if (mpnNorm && text.toLowerCase() === mpnNorm) {
      continue;
    }

    if (/^https?:\/\//iu.test(text)) {
      continue;
    }

    if (text.length > bestLength) {
      best = text;
      bestLength = text.length;
    }
  }

  return best;
}

/** CatalogKitFiles holds the best catalog asset per kit slot for one part. */
interface CatalogKitFiles {
  datasheet: ProjectPartKitFileRef | null;
  footprint: ProjectPartKitFileRef | null;
  model: ProjectPartKitFileRef | null;
}

/**
 * Reads catalog-backed datasheet, model, and footprint assets for project part kits.
 */
async function readCatalogKitFilesByPartId(
  databasePool: Pool,
  partIds: string[]
): Promise<Map<string, CatalogKitFiles>> {
  if (partIds.length === 0) {
    return new Map();
  }

  const result = await databasePool.query<DatabaseKitAssetRow>(
    `
      SELECT
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
        generation_method,
        generation_source_asset_id,
        validation_status,
        preview_status,
        preview_artifact_storage_key,
        preview_artifact_format,
        preview_artifact_generated_at,
        preview_artifact_source,
        asset_state,
        source_url,
        source_record_id,
        last_updated_at
      FROM assets
      WHERE part_id = ANY($1::text[])
        AND asset_type IN ('datasheet', 'footprint', 'three_d_model')
      ORDER BY asset_type ASC, last_updated_at DESC, id ASC
    `,
    [partIds]
  );

  const assetsByPartId = new Map<string, Asset[]>();

  for (const row of result.rows) {
    const asset = mapKitAssetRow(row);
    const existing = assetsByPartId.get(asset.partId) ?? [];
    existing.push(asset);
    assetsByPartId.set(asset.partId, existing);
  }

  const byPartId = new Map<string, CatalogKitFiles>();

  for (const partId of partIds) {
    const assets = assetsByPartId.get(partId) ?? [];
    byPartId.set(partId, {
      datasheet: catalogAssetToKitFileRef(partId, selectBestAvailableAsset(assets.filter((asset) => asset.assetType === "datasheet"))),
      footprint: catalogAssetToKitFileRef(partId, selectBestAvailableAsset(assets.filter((asset) => asset.assetType === "footprint"))),
      model: catalogAssetToKitFileRef(partId, selectBestAvailableAsset(assets.filter((asset) => asset.assetType === "three_d_model")))
    });
  }

  const revisionFiles = await readDatasheetRevisionKitFilesByPartId(databasePool, partIds);

  for (const [partId, datasheet] of revisionFiles) {
    const existing = byPartId.get(partId) ?? {
      datasheet: null,
      footprint: null,
      model: null
    };

    existing.datasheet ??= datasheet;
    byPartId.set(partId, existing);
  }

  return byPartId;
}

/** DatabaseKitAssetRow is the asset subset needed to rank kit file candidates. */
interface DatabaseKitAssetRow {
  asset_state: Asset["assetState"];
  asset_status: Asset["assetStatus"];
  asset_type: AssetType;
  availability_status: Asset["availabilityStatus"];
  export_status: Asset["exportStatus"];
  file_format: Asset["fileFormat"];
  file_hash: string | null;
  generation_method: string | null;
  generation_source_asset_id: string | null;
  id: string;
  last_updated_at: Date | string;
  license_mode: Asset["licenseMode"];
  part_id: string;
  preview_artifact_format: Asset["previewArtifactFormat"];
  preview_artifact_generated_at: Date | string | null;
  preview_artifact_source: Asset["previewArtifactSource"];
  preview_artifact_storage_key: string | null;
  preview_status: Asset["previewStatus"];
  provenance: Asset["provenance"];
  provider_id: string | null;
  review_status: Asset["reviewStatus"];
  source_record_id: string | null;
  source_url: string | null;
  storage_key: string | null;
  validation_status: Asset["validationStatus"];
}

/**
 * Maps one database asset row into the shared Asset type for kit ranking.
 */
function mapKitAssetRow(row: DatabaseKitAssetRow): Asset {
  return {
    assetState: row.asset_state,
    assetStatus: row.asset_status,
    assetType: row.asset_type,
    availabilityStatus: row.availability_status,
    exportStatus: row.export_status,
    fileFormat: row.file_format,
    fileHash: row.file_hash,
    generationMethod: row.generation_method,
    generationSourceAssetId: row.generation_source_asset_id,
    id: row.id,
    lastUpdatedAt: typeof row.last_updated_at === "string" ? row.last_updated_at : row.last_updated_at.toISOString(),
    licenseMode: row.license_mode,
    partId: row.part_id,
    previewArtifactFormat: row.preview_artifact_format,
    previewArtifactGeneratedAt: row.preview_artifact_generated_at
      ? typeof row.preview_artifact_generated_at === "string"
        ? row.preview_artifact_generated_at
        : row.preview_artifact_generated_at.toISOString()
      : null,
    previewArtifactSource: row.preview_artifact_source,
    previewArtifactStorageKey: row.preview_artifact_storage_key,
    previewStatus: row.preview_status,
    providerId: row.provider_id,
    provenance: row.provenance,
    reviewStatus: row.review_status,
    sourceRecordId: row.source_record_id,
    sourceUrl: row.source_url,
    storageKey: row.storage_key,
    validationStatus: row.validation_status
  };
}

/**
 * Converts the best ranked catalog asset for one kit slot into a file reference.
 */
function catalogAssetToKitFileRef(partId: string, asset: Asset | null): ProjectPartKitFileRef | null {
  if (!asset) {
    return null;
  }

  const slot = catalogAssetTypeToKitSlot(asset.assetType);

  if (!slot || (!asset.storageKey && !asset.sourceUrl)) {
    return null;
  }

  return buildCatalogKitFileRef(partId, asset.id, asset.storageKey, asset.sourceUrl, asset.fileFormat, slot);
}

/**
 * Reads the latest datasheet revision file asset per part (same path as the part detail page).
 */
async function readDatasheetRevisionKitFilesByPartId(
  databasePool: Pool,
  partIds: string[]
): Promise<Map<string, ProjectPartKitFileRef>> {
  if (partIds.length === 0) {
    return new Map();
  }

  const result = await databasePool.query<{
    file_asset_id: string;
    file_format: string | null;
    part_id: string;
    source_url: string | null;
    storage_key: string | null;
  }>(
    `
      SELECT DISTINCT ON (dr.part_id)
        dr.part_id,
        a.id AS file_asset_id,
        a.file_format,
        a.storage_key,
        a.source_url
      FROM datasheet_revisions dr
      INNER JOIN assets a ON a.id = dr.file_asset_id
      WHERE dr.part_id = ANY($1::text[])
        AND dr.file_asset_id IS NOT NULL
        AND (a.storage_key IS NOT NULL OR a.source_url IS NOT NULL)
      ORDER BY dr.part_id, dr.revision_date DESC NULLS LAST, dr.last_updated_at DESC
    `,
    [partIds]
  );

  const byPartId = new Map<string, ProjectPartKitFileRef>();

  for (const row of result.rows) {
    byPartId.set(
      row.part_id,
      buildCatalogKitFileRef(row.part_id, row.file_asset_id, row.storage_key, row.source_url, row.file_format, "datasheets")
    );
  }

  return byPartId;
}

/** CatalogPartContext carries catalog fallbacks when BOM metadata is empty. */
interface CatalogPartContext {
  note: string | null;
  partUrl: string | null;
}

/**
 * Reads catalog description and provider source URL for part kit metadata fallbacks.
 */
async function readCatalogPartContextByPartId(databasePool: Pool, partIds: string[]): Promise<Map<string, CatalogPartContext>> {
  if (partIds.length === 0) {
    return new Map();
  }

  const [partsResult, sourcesResult] = await Promise.all([
    databasePool.query<{ description: string | null; id: string }>(
      `
        SELECT id, description
        FROM parts
        WHERE id = ANY($1::text[])
      `,
      [partIds]
    ),
    databasePool.query<{ part_id: string; source_url: string | null }>(
      `
        SELECT DISTINCT ON (part_id)
          part_id,
          source_url
        FROM source_records
        WHERE part_id = ANY($1::text[])
          AND source_url IS NOT NULL
        ORDER BY part_id, source_last_imported_at DESC NULLS LAST, source_last_seen_at DESC, id ASC
      `,
      [partIds]
    )
  ]);

  const byPartId = new Map<string, CatalogPartContext>();

  for (const row of partsResult.rows) {
    byPartId.set(row.id, {
      note: normalizeOptionalText(row.description),
      partUrl: null
    });
  }

  for (const row of sourcesResult.rows) {
    const existing = byPartId.get(row.part_id) ?? { note: null, partUrl: null };
    existing.partUrl = normalizeOptionalText(row.source_url);
    byPartId.set(row.part_id, existing);
  }

  return byPartId;
}

/**
 * Maps catalog asset_type values to project kit file categories.
 */
function catalogAssetTypeToKitSlot(assetType: string): MirrorAssetCategory | null {
  if (assetType === "datasheet") {
    return "datasheets";
  }

  if (assetType === "three_d_model") {
    return "models";
  }

  if (assetType === "footprint") {
    return "footprints";
  }

  return null;
}

/**
 * Builds a catalog-backed kit file reference with a web download path.
 */
function buildCatalogKitFileRef(
  partId: string,
  assetId: string,
  storageKey: string | null,
  sourceUrl: string | null,
  fileFormat: string | null,
  category: MirrorAssetCategory
): ProjectPartKitFileRef {
  const name = storageKey
    ? storageKey.split("/").pop() ?? `${assetId}.${fileFormat ?? "bin"}`
    : sourceUrl
      ? sourceUrl.split("/").pop() ?? `${assetId}.${fileFormat ?? "bin"}`
      : `${assetId}.${fileFormat ?? "bin"}`;
  const downloadUrl = storageKey
    ? `/api/parts/${encodeURIComponent(partId)}/assets/${encodeURIComponent(assetId)}/download`
    : normalizeOptionalText(sourceUrl);

  return {
    assetId,
    category,
    downloadUrl: downloadUrl ?? undefined,
    fileFormat: fileFormat ?? undefined,
    name,
    relativePath: storageKey ?? sourceUrl ?? `catalog/${assetId}`,
    source: "catalog"
  };
}

/**
 * Fills missing kit slots from catalog assets when the project mirror has no file yet.
 */
function mergeCatalogAssetsIntoKit(kit: ProjectPartKit, catalog: CatalogKitFiles | undefined): void {
  if (!catalog) {
    return;
  }

  kit.datasheet = pickBetterKitFile(kit.datasheet, catalog.datasheet);
  kit.model = pickBetterKitFile(kit.model, catalog.model);
  kit.footprint = pickBetterKitFile(kit.footprint, catalog.footprint);
}

/**
 * Prefers a catalog-backed file for kit actions when both mirror and catalog copies exist.
 */
function pickBetterKitFile(
  mirror: ProjectPartKitFileRef | null,
  catalog: ProjectPartKitFileRef | null
): ProjectPartKitFileRef | null {
  if (catalog?.assetId || catalog?.downloadUrl) {
    return catalog;
  }

  return mirror ?? catalog;
}

/**
 * Reads BOM line descriptor and supplier URL for each part in a project.
 */
async function readBomMetadataByPartId(
  databasePool: Pool,
  projectId: string,
  catalogByMpn: Map<string, CatalogPartSummary>
): Promise<Map<string, { note: string | null; partUrl: string | null }>> {
  const result = await databasePool.query<{
    matched_part_id: string | null;
    raw_description: string | null;
    raw_mpn: string | null;
    raw_row_payload: Record<string, unknown> | null;
    raw_supplier_reference: string | null;
    updated_at: Date | string;
  }>(
    `
      SELECT matched_part_id, raw_mpn, raw_description, raw_supplier_reference, raw_row_payload, updated_at
      FROM bom_lines
      WHERE project_id = $1
      ORDER BY updated_at DESC, id ASC
    `,
    [projectId]
  );

  const metadataByPartId = new Map<string, { note: string | null; partUrl: string | null }>();

  for (const row of result.rows) {
    const mpn = row.raw_mpn?.trim();
    const partId = row.matched_part_id ?? (mpn ? catalogByMpn.get(normalizeMpnLookupKey(mpn))?.partId ?? null : null);

    if (!partId) {
      continue;
    }

    const payload = row.raw_row_payload && typeof row.raw_row_payload === "object" ? row.raw_row_payload : {};
    const resolved = {
      note: pickBomDescription(row.raw_description, payload, mpn ?? null),
      partUrl: pickBomSupplierUrl(row.raw_supplier_reference, payload)
    };
    const existing = metadataByPartId.get(partId);

    if (!existing) {
      metadataByPartId.set(partId, resolved);
      continue;
    }

    if (!existing.note) {
      existing.note = resolved.note;
    }

    if (!existing.partUrl) {
      existing.partUrl = resolved.partUrl;
    }
  }

  return metadataByPartId;
}

/**
 * Picks the best on-disk file for one kit slot.
 */
function pickKitFile(files: MirrorAssetFile[], category: MirrorAssetCategory): ProjectPartKitFileRef | null {
  const matches = files.filter((file) => file.category === category);

  if (matches.length === 0) {
    return null;
  }

  const preferred =
    category === "datasheets"
      ? matches.find((file) => file.name.toLowerCase().endsWith(".pdf")) ?? matches[0]
      : matches[0];

  if (!preferred) {
    return null;
  }

  return {
    category,
    name: preferred.name,
    relativePath: preferred.relativePath,
    source: "mirror"
  };
}

/**
 * Merges designators without duplicates.
 */
function mergeDesignators(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])];
}

/**
 * Trims optional text fields to null when empty.
 */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/** projectPartKitsPool is the lazily created Postgres pool for part kit routes. */
let projectPartKitsPool: Pool | null = null;

/**
 * Returns true when DATABASE_URL is configured for part kit persistence.
 */
function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Lazily creates the Postgres pool when DATABASE_URL exists.
 */
function getDatabasePool(): Pool {
  if (projectPartKitsPool) {
    return projectPartKitsPool;
  }

  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  projectPartKitsPool = new Pool({ connectionString });

  return projectPartKitsPool;
}
