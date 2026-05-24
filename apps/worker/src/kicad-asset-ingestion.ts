/**
 * File header: Ingests CAD asset bytes from the local KiCad library index into storage.
 *
 * The KiCad provider discovers `.kicad_sym` / `.kicad_mod` / `.step` files and records them as
 * **references** (`source_url` = the file path, `storage_key` = NULL). Downstream features
 * (export bundles, KiCad library emission, the compare preview band) only use *file-backed* assets,
 * so those references are dead weight until their bytes are stored.
 *
 * This job reads the referenced bytes (guarded so only files under the configured KiCad root are read),
 * writes them to storage, and marks the asset `downloaded` + file-backed with a content hash. It does
 * **not** touch review, validation, or export state: ingestion makes an asset *available and
 * checkable*, never *trusted for export*. The existing file-grounded validators and the review →
 * verified-for-export promotion still gate everything. Provenance stays `trusted_external` (a curated
 * public library), never `official`.
 */

import { createHash } from "node:crypto";
import { readFile as fsReadFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { getWorkerDatabasePool } from "./catalog-repository";
import { getWorkerStorageClient } from "./file-storage";
import { readKicadLibraryRoot } from "./providers/kicad-provider";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { Pool } from "pg";

/** KicadIngestCandidateRow is one referenced KiCad CAD asset awaiting byte ingestion. */
export interface KicadIngestCandidateRow {
  id: string;
  part_id: string;
  asset_type: string;
  file_format: string;
  source_url: string;
}

/** KicadAssetIngestOutcome reports one asset's ingestion result for the batch summary. */
export type KicadAssetIngestOutcome =
  | { assetId: string; status: "ingested"; storageKey: string; fileHash: string; bytes: number }
  | { assetId: string; status: "skipped"; reason: string };

/** KicadAssetIngestionSummary groups processed assets for the CLI / daemon. */
export interface KicadAssetIngestionSummary {
  processed: KicadAssetIngestOutcome[];
}

/** KicadAssetIngestDeps are the injectable side effects so the per-asset logic is unit-testable. */
export interface KicadAssetIngestDeps {
  readFile: (path: string) => Promise<Buffer>;
  storage: FileStorageClient;
  root: string;
  /** Persists the downloaded/file-backed transition. Implementations must NOT change review/export state. */
  persist: (assetId: string, storageKey: string, fileHash: string, resolvedPath: string) => Promise<void>;
}

/**
 * Resolves a referenced KiCad file path, returning it only when it actually lives under the configured
 * KiCad root. This is the security boundary: an asset's `source_url` is untrusted input, so a path that
 * escapes the root (or a non-filesystem URL like an `http(s)://` reference) is refused rather than read.
 */
export function resolveKicadAssetReadPath(sourceUrl: string, root: string): string | null {
  if (!sourceUrl || /^[a-z]+:\/\//iu.test(sourceUrl)) {
    return null;
  }

  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(sourceUrl);

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    return null;
  }

  return resolvedPath;
}

/**
 * Builds the deterministic storage key the ingested bytes are written to. Stable per asset so a
 * re-ingest overwrites in place rather than orphaning copies.
 */
export function buildIngestedAssetStorageKey(row: KicadIngestCandidateRow): string {
  const ext = (extname(row.source_url).replace(/^\./u, "") || row.file_format || "bin").toLowerCase();
  return `assets/${row.part_id}/${row.asset_type}-${row.id}.${ext}`;
}

/**
 * Ingests one referenced KiCad CAD asset's bytes. Reads the file (guarded by path safety), writes it to
 * storage, hashes it, and persists the downloaded/file-backed transition. Any read/write failure is
 * returned as a `skipped` outcome with a reason rather than thrown, so one bad file does not abort the
 * batch and the operator sees exactly which asset was skipped and why.
 */
export async function ingestKicadAssetBytes(
  deps: KicadAssetIngestDeps,
  row: KicadIngestCandidateRow
): Promise<KicadAssetIngestOutcome> {
  const path = resolveKicadAssetReadPath(row.source_url, deps.root);
  if (!path) {
    return { assetId: row.id, reason: "Referenced file is not under the configured KICAD_LIBRARY_ROOT.", status: "skipped" };
  }

  let bytes: Buffer;
  try {
    bytes = await deps.readFile(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { assetId: row.id, reason: `Read failed: ${detail}`, status: "skipped" };
  }

  if (bytes.length === 0) {
    return { assetId: row.id, reason: "Referenced file is empty.", status: "skipped" };
  }

  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const storageKey = buildIngestedAssetStorageKey(row);

  try {
    await deps.storage.write(storageKey, bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { assetId: row.id, reason: `Storage write failed: ${detail}`, status: "skipped" };
  }

  await deps.persist(row.id, storageKey, fileHash, path);

  return { assetId: row.id, bytes: bytes.length, fileHash, status: "ingested", storageKey };
}

/**
 * Selects referenced KiCad CAD assets and ingests their bytes. Database, storage, fs, and the root are
 * injectable for tests; in production they default to the worker environment.
 *
 * Honesty contract enforced by the UPDATE below: it sets only `storage_key`, `file_hash`, and the
 * downloaded availability columns. It never writes `review_status`, `validation_status`, or
 * `export_status`, so an ingested asset still has to pass the file-grounded validators and the explicit
 * verified-for-export promotion before any export or KiCad library emission will include it.
 */
export async function processKicadAssetByteIngestion(
  limit: number,
  options: { pool?: Pool; storage?: FileStorageClient; root?: string; readFile?: (path: string) => Promise<Buffer> } = {}
): Promise<KicadAssetIngestionSummary> {
  const pool = options.pool ?? getWorkerDatabasePool();
  const storage = options.storage ?? getWorkerStorageClient();
  const root = options.root ?? readKicadLibraryRoot();
  const readFile = options.readFile ?? ((path: string) => fsReadFile(path));

  const candidates = await pool.query<KicadIngestCandidateRow>(
    `SELECT id, part_id, asset_type, file_format, source_url
       FROM assets
       WHERE storage_key IS NULL
         AND source_url IS NOT NULL
         AND provider_id = 'kicad'
         AND asset_type IN ('footprint', 'symbol', 'three_d_model')
         AND file_format IN ('kicad_mod', 'kicad_sym', 'step')
       ORDER BY last_updated_at ASC
       LIMIT $1`,
    [Math.max(1, limit)]
  );

  const deps: KicadAssetIngestDeps = {
    readFile,
    root,
    storage,
    persist: async (assetId, storageKey, fileHash, resolvedPath) => {
      await pool.query(
        `UPDATE assets
            SET storage_key = $1,
                file_hash = $2,
                source_url = $3,
                availability_status = 'downloaded',
                asset_status = 'downloaded',
                asset_state = 'downloaded',
                last_updated_at = now()
          WHERE id = $4`,
        [storageKey, fileHash, resolvedPath, assetId]
      );
    }
  };

  const processed: KicadAssetIngestOutcome[] = [];
  for (const row of candidates.rows) {
    processed.push(await ingestKicadAssetBytes(deps, row));
  }

  return { processed };
}
