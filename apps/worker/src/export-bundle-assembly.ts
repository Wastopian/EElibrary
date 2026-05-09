/**
 * File header: Async worker for copying verified asset bytes into per-bundle storage paths.
 *
 * The API persists the export bundle manifest synchronously when an operator clicks Generate so the
 * audit record exists immediately. The actual asset-byte copy is moved here so storage I/O does not
 * block the API request. Each pending bundle's included assets are read from their source storage
 * keys and rewritten into a deterministic per-bundle prefix. Per-asset failures are surfaced as
 * structured `assembly_error` telemetry rather than buried in a free-text manifest warning, so an
 * operator can see exactly which asset failed and why.
 */

import { getWorkerDatabasePool } from "./catalog-repository";
import { buildUstarTarBuffer, gzipBufferDeterministic, type TarFileEntry } from "./tar-archive";
import type {
  ExportBundleAssemblyError,
  ExportBundleAssemblyErrorPhase,
  ExportBundleManifest
} from "@ee-library/shared/types";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

/** PendingExportBundleRow is the minimum bundle context the worker needs to assemble bytes. */
interface PendingExportBundleRow {
  id: string;
  project_id: string;
  manifest: ExportBundleManifest;
  assembly_attempt_count: number;
}

/** AssembledExportBundleResult reports one bundle's outcome for the assembly batch summary. */
export interface AssembledExportBundleResult {
  bundleId: string;
  status: "assembled" | "assembly_failed";
  assetsCopied: number;
  failure: ExportBundleAssemblyError | null;
  /** Storage key the assembled `.tar.gz` archive was written to, when assembly succeeded. */
  archiveStorageKey: string | null;
}

/** ExportBundleAssemblySummary is the batch outcome surface for the worker CLI. */
export interface ExportBundleAssemblySummary {
  processed: AssembledExportBundleResult[];
}

/**
 * Builds the deterministic storage prefix used to copy one bundle's verified asset bytes.
 *
 * Keeps the per-bundle path stable across regenerations of the same bundle id so the on-disk
 * layout is predictable for an archive download follow-on later.
 */
export function buildExportBundleAssetStorageKey(projectId: string, bundleId: string, bundlePath: string): string {
  return `export-bundles/${projectId}/${bundleId}/assets/${bundlePath}`;
}

/**
 * Builds the deterministic storage key for the single-archive `.tar.gz` download.
 *
 * Kept separate from the per-asset prefix so the archive can be served as one engineering-friendly
 * file without collapsing the per-asset directory tree the rest of the pipeline relies on.
 */
export function buildExportBundleArchiveStorageKey(projectId: string, bundleId: string): string {
  return `export-bundles/${projectId}/${bundleId}/bundle.tar.gz`;
}

/**
 * AssemblyPhaseError tags an underlying I/O failure with the assembly phase that produced it.
 */
class AssemblyPhaseError extends Error {
  readonly phase: ExportBundleAssemblyErrorPhase;

  constructor(phase: ExportBundleAssemblyErrorPhase, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.phase = phase;
  }
}

/**
 * Assembles one bundle's verified asset bytes, returning a per-bundle outcome with telemetry.
 *
 * Stops on the first asset failure rather than continuing through the manifest because partial
 * archives would be confusing to operators (the manifest still claims every asset is present).
 * Future work can choose to retry remaining assets after the failed one is fixed.
 */
export async function assembleSingleExportBundle(
  storage: FileStorageClient,
  bundle: PendingExportBundleRow
): Promise<AssembledExportBundleResult> {
  const manifest = bundle.manifest;

  if (manifest.includedAssets.length === 0) {
    return { archiveStorageKey: null, assetsCopied: 0, bundleId: bundle.id, failure: null, status: "assembled" };
  }

  let copied = 0;
  const archiveEntries: TarFileEntry[] = [];

  for (const includedAsset of manifest.includedAssets) {
    const destinationStorageKey = buildExportBundleAssetStorageKey(bundle.project_id, bundle.id, includedAsset.bundlePath);

    try {
      const sourceBytes = await readAssetBytes(storage, includedAsset.storageKey);
      await writeAssetBytes(storage, destinationStorageKey, sourceBytes);
      archiveEntries.push({ content: sourceBytes, path: includedAsset.bundlePath });
      copied += 1;
    } catch (error) {
      if (error instanceof AssemblyPhaseError) {
        return {
          archiveStorageKey: null,
          assetsCopied: copied,
          bundleId: bundle.id,
          failure: {
            failedAssetId: includedAsset.assetId,
            failedAt: new Date().toISOString(),
            failedBundlePath: includedAsset.bundlePath,
            message: error.message,
            phase: error.phase
          },
          status: "assembly_failed"
        };
      }

      const detail = error instanceof Error ? error.message : String(error);
      return {
        archiveStorageKey: null,
        assetsCopied: copied,
        bundleId: bundle.id,
        failure: {
          failedAssetId: includedAsset.assetId,
          failedAt: new Date().toISOString(),
          failedBundlePath: includedAsset.bundlePath,
          message: detail,
          phase: "unknown"
        },
        status: "assembly_failed"
      };
    }
  }

  // Embed the manifest alongside the assets so an extracted bundle is self-describing without
  // needing to query the API. Identical includedAssets ordering keeps the archive deterministic.
  archiveEntries.push({
    content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    path: "manifest.json"
  });

  const archiveStorageKey = buildExportBundleArchiveStorageKey(bundle.project_id, bundle.id);
  try {
    const tarBuffer = buildUstarTarBuffer(archiveEntries);
    const gzipBuffer = await gzipBufferDeterministic(tarBuffer);
    await storage.write(archiveStorageKey, gzipBuffer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      archiveStorageKey: null,
      assetsCopied: copied,
      bundleId: bundle.id,
      failure: {
        failedAssetId: null,
        failedAt: new Date().toISOString(),
        failedBundlePath: archiveStorageKey,
        message: detail,
        phase: "write_asset"
      },
      status: "assembly_failed"
    };
  }

  return { archiveStorageKey, assetsCopied: copied, bundleId: bundle.id, failure: null, status: "assembled" };
}

/**
 * Reads one asset's source bytes via storage, tagging any failure as `fetch_asset` for telemetry.
 */
async function readAssetBytes(storage: FileStorageClient, sourceStorageKey: string): Promise<Buffer> {
  try {
    return await storage.read(sourceStorageKey);
  } catch (error) {
    throw new AssemblyPhaseError("fetch_asset", error);
  }
}

/**
 * Writes one asset's bytes via storage, tagging any failure as `write_asset` for telemetry.
 */
async function writeAssetBytes(storage: FileStorageClient, destinationStorageKey: string, payload: Buffer): Promise<void> {
  try {
    await storage.write(destinationStorageKey, payload);
  } catch (error) {
    throw new AssemblyPhaseError("write_asset", error);
  }
}

/**
 * Reads up to `limit` pending bundles, copies each bundle's verified asset bytes via storage, and
 * persists the per-bundle status transition with structured failure telemetry on errors.
 */
export async function processPendingExportBundleAssembly(
  limit: number,
  storage: FileStorageClient
): Promise<ExportBundleAssemblySummary> {
  const databasePool = getWorkerDatabasePool();

  const pendingRows = await databasePool.query<{
    id: string;
    project_id: string;
    manifest: unknown;
    assembly_attempt_count: number | string;
  }>(
    `SELECT id, project_id, manifest, assembly_attempt_count
       FROM export_bundles
       WHERE assembly_status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1`,
    [Math.max(1, limit)]
  );

  const processed: AssembledExportBundleResult[] = [];

  for (const row of pendingRows.rows) {
    const bundle: PendingExportBundleRow = {
      assembly_attempt_count: Number(row.assembly_attempt_count ?? 0),
      id: row.id,
      manifest: row.manifest as ExportBundleManifest,
      project_id: row.project_id
    };

    const outcome = await assembleSingleExportBundle(storage, bundle);
    const completedAt = new Date();

    if (outcome.status === "assembled") {
      await databasePool.query(
        `UPDATE export_bundles
            SET assembly_status = 'assembled',
                assembly_error = NULL,
                assembly_completed_at = $2,
                assembly_attempt_count = assembly_attempt_count + 1,
                archive_storage_key = $3
          WHERE id = $1`,
        [bundle.id, completedAt, outcome.archiveStorageKey]
      );
    } else {
      await databasePool.query(
        `UPDATE export_bundles
            SET assembly_status = 'assembly_failed',
                assembly_error = $2::jsonb,
                assembly_completed_at = $3,
                assembly_attempt_count = assembly_attempt_count + 1
          WHERE id = $1`,
        [bundle.id, JSON.stringify(outcome.failure), completedAt]
      );
    }

    processed.push(outcome);
  }

  return { processed };
}
