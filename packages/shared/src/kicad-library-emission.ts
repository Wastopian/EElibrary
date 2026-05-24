/**
 * File header: KiCad library emission orchestration shared by the API (inline download) and the
 * worker (CLI). Selects a project's verified, file-backed KiCad assets, groups one KiCad-format pick
 * per part, reads bytes via the storage client, runs the deterministic emitter, copies 3D model
 * bytes, and packages a single drop-in `.kicad-lib.tar.gz`.
 *
 * This is **packaging**, not generation: only `export_status = 'verified_for_export'` assets with
 * stored bytes are included, so the trust boundary (imported ≠ approved ≠ export-ready, generated ≠
 * official) is preserved end to end.
 *
 * Lives in shared (with a structural pool type, no `pg` dependency) so both services consume the same
 * logic without crossing the web/api/worker boundary. The worker layers `emitKicadLibraryForProject`
 * on top with its own pool/storage defaults; the API calls these functions with its own pool/storage.
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";
import { emitKicadLibrary, type KicadEmissionPart, type KicadEmissionResult } from "./kicad-library";
import { buildUstarTarBuffer, gzipBufferDeterministic, type TarFileEntry } from "./tar-archive";
import type { FileStorageClient } from "./file-storage";

/**
 * KicadQueryablePool is the minimal query surface this module needs. Both the API's and the worker's
 * `pg` Pool satisfy it structurally, so shared does not depend on `pg`.
 */
export interface KicadQueryablePool {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

/** KicadAssetRow is one verified, file-backed CAD asset row for a project's part. */
export interface KicadAssetRow {
  part_id: string;
  part_mpn: string;
  manufacturer_name: string | null;
  asset_id: string;
  asset_type: "footprint" | "symbol" | "three_d_model";
  file_format: string;
  storage_key: string;
}

/** KicadPartAssetSelection is the deterministic per-part pick of KiCad-format assets. */
export interface KicadPartAssetSelection {
  partId: string;
  mpn: string;
  manufacturer: string | null;
  symbol: { assetId: string; storageKey: string } | null;
  footprint: { assetId: string; storageKey: string } | null;
  model3d: { assetId: string; storageKey: string; fileName: string } | null;
}

/** KicadLibraryEmissionSummary is the operator-facing outcome of one emission run. */
export interface KicadLibraryEmissionSummary {
  status: "emitted" | "empty";
  storageKey: string | null;
  archiveSha256: string | null;
  includedPartCount: number;
  omittedPartCount: number;
  symbolCount: number;
  footprintCount: number;
  modelCount: number;
}

/** AssembledKicadLibrary is the packaged archive plus its emission result for telemetry. */
export interface AssembledKicadLibrary {
  archive: Buffer;
  archiveSha256: string;
  result: KicadEmissionResult;
}

/** Canonical KiCad source formats per asset class. glb/gltf are preview-only and excluded. */
const SYMBOL_FORMAT = "kicad_sym";
const FOOTPRINT_FORMAT = "kicad_mod";
const MODEL_FORMAT = "step";

/**
 * Groups verified asset rows into one KiCad-format pick per part.
 *
 * Pure and deterministic: rows are sorted by part then asset id, the first KiCad-format asset of each
 * class wins, and parts are returned sorted by mpn then part id. Parts that have verified CAD rows but
 * no KiCad-format asset are still returned (with all-null picks) so the emitter can report them as
 * omitted rather than silently dropping them.
 */
export function groupKicadAssetRows(rows: KicadAssetRow[]): KicadPartAssetSelection[] {
  const byPart = new Map<string, KicadPartAssetSelection>();
  const sorted = [...rows].sort(
    (first, second) => first.part_id.localeCompare(second.part_id) || first.asset_id.localeCompare(second.asset_id)
  );

  for (const row of sorted) {
    let selection = byPart.get(row.part_id);
    if (!selection) {
      selection = {
        footprint: null,
        manufacturer: row.manufacturer_name,
        model3d: null,
        mpn: row.part_mpn,
        partId: row.part_id,
        symbol: null
      };
      byPart.set(row.part_id, selection);
    }

    if (row.asset_type === "symbol" && row.file_format === SYMBOL_FORMAT && !selection.symbol) {
      selection.symbol = { assetId: row.asset_id, storageKey: row.storage_key };
    } else if (row.asset_type === "footprint" && row.file_format === FOOTPRINT_FORMAT && !selection.footprint) {
      selection.footprint = { assetId: row.asset_id, storageKey: row.storage_key };
    } else if (row.asset_type === "three_d_model" && row.file_format === MODEL_FORMAT && !selection.model3d) {
      selection.model3d = { assetId: row.asset_id, fileName: basename(row.storage_key), storageKey: row.storage_key };
    }
  }

  return [...byPart.values()].sort(
    (first, second) => first.mpn.localeCompare(second.mpn) || first.partId.localeCompare(second.partId)
  );
}

/**
 * Reads asset bytes, runs the emitter, copies 3D model bytes, and packages everything into one
 * deterministic `.tar.gz`. Storage-bound but database-free, so it is unit-testable with a stub client.
 */
export async function assembleKicadLibrary(
  storage: FileStorageClient,
  selections: KicadPartAssetSelection[],
  options: { libraryName: string; generatedAt?: string | undefined }
): Promise<AssembledKicadLibrary> {
  const parts: KicadEmissionPart[] = [];
  const modelStorageKeyByAssetId = new Map<string, string>();

  for (const selection of selections) {
    const part: KicadEmissionPart = {
      manufacturer: selection.manufacturer,
      mpn: selection.mpn,
      partId: selection.partId
    };

    if (selection.symbol) {
      const bytes = await storage.read(selection.symbol.storageKey);
      part.symbol = { assetId: selection.symbol.assetId, content: bytes.toString("utf8") };
    }
    if (selection.footprint) {
      const bytes = await storage.read(selection.footprint.storageKey);
      part.footprint = { assetId: selection.footprint.assetId, content: bytes.toString("utf8") };
    }
    if (selection.model3d) {
      part.model3d = { assetId: selection.model3d.assetId, fileName: selection.model3d.fileName };
      modelStorageKeyByAssetId.set(selection.model3d.assetId, selection.model3d.storageKey);
    }

    parts.push(part);
  }

  const result = emitKicadLibrary({ generatedAt: options.generatedAt, libraryName: options.libraryName, parts });

  const entries: TarFileEntry[] = result.textFiles.map((file) => ({
    content: Buffer.from(file.content, "utf8"),
    path: file.path
  }));

  for (const ref of result.modelRefs) {
    const storageKey = modelStorageKeyByAssetId.get(ref.assetId);
    if (!storageKey) {
      continue;
    }
    entries.push({ content: await storage.read(storageKey), path: ref.path });
  }

  entries.sort((first, second) => first.path.localeCompare(second.path));

  const tar = buildUstarTarBuffer(entries);
  const archive = await gzipBufferDeterministic(tar);
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");

  return { archive, archiveSha256, result };
}

/**
 * Builds the deterministic storage key for a project's emitted KiCad library archive.
 */
export function buildKicadLibraryStorageKey(projectId: string, libraryName: string): string {
  return `kicad-libraries/${projectId}/${libraryName}.kicad-lib.tar.gz`;
}

/**
 * Reads a project's verified, file-backed CAD assets (symbol/footprint/3D) for confirmed part usages,
 * optionally scoped to one revision label. Mirrors the export-bundle selection so KiCad emission and
 * the generic bundle agree on what "verified for export" means.
 */
export async function selectProjectKicadAssetRows(
  pool: KicadQueryablePool,
  projectId: string,
  revisionLabel?: string
): Promise<KicadAssetRow[]> {
  const usageFilter = revisionLabel ? "AND pr.revision_label = $2" : "";
  const usageParams: unknown[] = revisionLabel ? [projectId, revisionLabel] : [projectId];

  const used = await pool.query<{ part_id: string }>(
    `SELECT DISTINCT ppu.part_id
       FROM project_part_usages ppu
       JOIN project_revisions pr ON pr.id = ppu.project_revision_id
       WHERE ppu.project_id = $1 ${usageFilter}`,
    usageParams
  );

  const partIds = used.rows.map((row) => row.part_id);
  if (partIds.length === 0) {
    return [];
  }

  const placeholders = partIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await pool.query<KicadAssetRow>(
    `SELECT a.part_id, p.mpn AS part_mpn, m.name AS manufacturer_name,
            a.id AS asset_id, a.asset_type, a.file_format, a.storage_key
       FROM assets a
       JOIN parts p ON p.id = a.part_id
       JOIN manufacturers m ON m.id = p.manufacturer_id
       WHERE a.part_id IN (${placeholders})
         AND a.asset_type IN ('symbol', 'footprint', 'three_d_model')
         AND a.export_status = 'verified_for_export'
         AND a.storage_key IS NOT NULL`,
    partIds
  );

  return rows.rows;
}

/**
 * Emits a KiCad library for one project end to end given a pool and storage client: query verified
 * assets, group, package, and write the archive to storage. Returns an `empty` summary (no archive
 * written) when the project has no verified file-backed CAD assets so callers can surface an honest
 * "nothing to export yet" state. Shared by the worker CLI and the API route.
 */
export async function emitKicadLibraryForProjectWithDeps(
  pool: KicadQueryablePool,
  storage: FileStorageClient,
  projectId: string,
  options: { revisionLabel?: string | undefined; generatedAt?: string | undefined } = {}
): Promise<KicadLibraryEmissionSummary> {
  const rows = await selectProjectKicadAssetRows(pool, projectId, options.revisionLabel);
  const selections = groupKicadAssetRows(rows);

  const hasUsableAsset = selections.some((selection) => selection.symbol || selection.footprint || selection.model3d);
  if (!hasUsableAsset) {
    return {
      archiveSha256: null,
      footprintCount: 0,
      includedPartCount: 0,
      modelCount: 0,
      omittedPartCount: 0,
      status: "empty",
      storageKey: null,
      symbolCount: 0
    };
  }

  const assembled = await assembleKicadLibrary(storage, selections, {
    generatedAt: options.generatedAt,
    libraryName: projectId
  });

  const storageKey = buildKicadLibraryStorageKey(projectId, assembled.result.libraryName);
  await storage.write(storageKey, assembled.archive);

  const symbolCount = assembled.result.includedParts.reduce((total, part) => total + part.symbolNames.length, 0);
  const footprintCount = assembled.result.includedParts.filter((part) => part.footprintFile).length;

  return {
    archiveSha256: assembled.archiveSha256,
    footprintCount,
    includedPartCount: assembled.result.includedParts.length,
    modelCount: assembled.result.modelRefs.length,
    omittedPartCount: assembled.result.omittedParts.length,
    status: "emitted",
    storageKey,
    symbolCount
  };
}
