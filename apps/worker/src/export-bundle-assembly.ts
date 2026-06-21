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

import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, type KeyObject } from "node:crypto";
import { getWorkerDatabasePool } from "./catalog-repository";
import { buildUstarTarBuffer, gzipBufferDeterministic, type TarFileEntry } from "./tar-archive";
import type {
  ExportBundleAssemblyError,
  ExportBundleAssemblyErrorPhase,
  ExportBundleManifest,
  ExportBundleSignatureStatus
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
  /** Hex SHA-256 of the assembled `.tar.gz` archive bytes, when assembly succeeded. */
  archiveSha256: string | null;
  /** Hex SHA-256 of the embedded manifest.json body, when assembly succeeded. */
  manifestSha256: string | null;
  /**
   * Cryptographic provenance state for the assembled archive. `unsigned` when no signing key is
   * configured at assembly time; `signed` when an Ed25519 key is configured and the worker
   * produced a detached signature alongside the archive.
   */
  signatureStatus: ExportBundleSignatureStatus;
  /** Signature algorithm identifier (`ed25519`); null when unsigned. */
  signatureAlgorithm: string | null;
  /** Hex SHA-256 of the public verification key; null when unsigned. */
  signaturePublicKeyFingerprint: string | null;
  /** Storage key for the detached `.sig` payload; null when unsigned. */
  signatureStorageKey: string | null;
  /** ISO timestamp the bundle was signed at; null when unsigned. */
  signatureSignedAt: string | null;
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
 * Builds the deterministic storage key for the detached Ed25519 signature of the assembled
 * archive. Kept beside the archive so an auditor can fetch both files from the same path.
 */
export function buildExportBundleSignatureStorageKey(projectId: string, bundleId: string): string {
  return `export-bundles/${projectId}/${bundleId}/bundle.tar.gz.sig`;
}

/**
 * Builds the deterministic storage key for the standalone hex SHA-256 record. The hash is also
 * persisted on the bundle row in the database for auditor-friendly read paths; the storage-side
 * record lets a downstream consumer verify the archive without round-tripping the database.
 */
export function buildExportBundleArchiveSha256StorageKey(projectId: string, bundleId: string): string {
  return `export-bundles/${projectId}/${bundleId}/bundle.tar.gz.sha256`;
}

/**
 * BundleSigningKeyMaterial bundles the parsed Ed25519 private and public key plus the public-key
 * fingerprint so the signing path does not have to redo PEM parsing per bundle.
 */
interface BundleSigningKeyMaterial {
  privateKey: KeyObject;
  publicKeyFingerprint: string;
}

/**
 * Reads the optional Ed25519 signing key from `EE_LIBRARY_BUNDLE_SIGNING_KEY` (or the supplied
 * override) and parses it into a usable key object plus the SHA-256 fingerprint of the matching
 * public key. Returns null when no key is configured so the assembly path can stay `unsigned`
 * by default without ever silently failing.
 *
 * The fingerprint is the hex SHA-256 of the DER-encoded SubjectPublicKeyInfo for the public
 * key. That keeps it stable across PEM newline differences and aligns with what a downstream
 * verifier could compute from the same public key.
 */
export function readBundleSigningKeyMaterial(rawKey?: string | null): BundleSigningKeyMaterial | null {
  const pem = (rawKey ?? process.env["EE_LIBRARY_BUNDLE_SIGNING_KEY"] ?? "").trim();
  if (pem.length === 0) {
    return null;
  }

  try {
    const privateKey = createPrivateKey(pem);
    // Refuse non-Ed25519 keys explicitly so a misconfigured PEM does not silently switch
    // algorithm behind the operator's back. Ed25519 is the only supported algorithm because
    // it has no parameter selection (no curve choice, no hash choice) -- preventing one of the
    // most common signing-misuse footguns.
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error(`Bundle signing key must be Ed25519 (got ${String(privateKey.asymmetricKeyType)}).`);
    }
    const publicKey = createPublicKey(privateKey);
    const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
    const publicKeyFingerprint = createHash("sha256").update(publicKeyDer).digest("hex");
    return { privateKey, publicKeyFingerprint };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse EE_LIBRARY_BUNDLE_SIGNING_KEY: ${detail}`);
  }
}

/**
 * Signs the supplied archive hash (hex SHA-256) with the configured Ed25519 key and returns the
 * raw signature bytes. The signature is over the lowercase hex SHA-256 string of the archive --
 * not over the archive itself -- so an auditor can verify with only the hash without
 * re-downloading the full bundle.
 */
function signArchiveHash(archiveSha256Hex: string, keyMaterial: BundleSigningKeyMaterial): Buffer {
  return cryptoSign(null, Buffer.from(archiveSha256Hex, "utf8"), keyMaterial.privateKey);
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
  bundle: PendingExportBundleRow,
  options: { signingKey?: BundleSigningKeyMaterial | null } = {}
): Promise<AssembledExportBundleResult> {
  const manifest = bundle.manifest;
  const unsignedDefaults = buildUnsignedCryptographicDefaults();

  if (manifest.includedAssets.length === 0) {
    return {
      ...unsignedDefaults,
      archiveStorageKey: null,
      assetsCopied: 0,
      bundleId: bundle.id,
      failure: null,
      status: "assembled"
    };
  }

  let copied = 0;
  const archiveEntries: TarFileEntry[] = [];
  const manifestPathFailure = validateIncludedAssetBundlePaths(manifest);

  if (manifestPathFailure) {
    return {
      ...unsignedDefaults,
      archiveStorageKey: null,
      assetsCopied: 0,
      bundleId: bundle.id,
      failure: manifestPathFailure,
      status: "assembly_failed"
    };
  }

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
          ...unsignedDefaults,
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
        ...unsignedDefaults,
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
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");

  archiveEntries.push({ content: manifestBytes, path: "manifest.json" });
  // Embed the manifest's own SHA-256 inside the archive so an extracted bundle can be verified
  // even when only the archive is downloaded. The standalone .sha256 sidecar (written below)
  // covers the archive itself; the archive's own hash cannot be embedded inside itself because
  // doing so would change the archive's hash.
  archiveEntries.push({
    content: Buffer.from(`${manifestSha256}  manifest.json\n`, "utf8"),
    path: "manifest.json.sha256"
  });

  const archiveStorageKey = buildExportBundleArchiveStorageKey(bundle.project_id, bundle.id);
  let gzipBuffer: Buffer;
  try {
    const tarBuffer = buildUstarTarBuffer(archiveEntries);
    gzipBuffer = await gzipBufferDeterministic(tarBuffer);
    await storage.write(archiveStorageKey, gzipBuffer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...unsignedDefaults,
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

  const archiveSha256 = createHash("sha256").update(gzipBuffer).digest("hex");

  // Write the standalone hex-SHA-256 sidecar next to the archive so a downstream consumer can
  // verify the archive without round-tripping through the database. Honesty discipline: if this
  // sidecar write fails the archive write already succeeded, so we surface the failure rather
  // than rolling back -- but we never claim signed when we have not produced a signature.
  const sha256StorageKey = buildExportBundleArchiveSha256StorageKey(bundle.project_id, bundle.id);
  try {
    await storage.write(sha256StorageKey, Buffer.from(`${archiveSha256}  bundle.tar.gz\n`, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...unsignedDefaults,
      archiveStorageKey,
      assetsCopied: copied,
      bundleId: bundle.id,
      failure: {
        failedAssetId: null,
        failedAt: new Date().toISOString(),
        failedBundlePath: sha256StorageKey,
        message: `Archive hash sidecar write failed: ${detail}`,
        phase: "write_asset"
      },
      status: "assembly_failed"
    };
  }

  let signatureFields: {
    signatureStatus: ExportBundleSignatureStatus;
    signatureAlgorithm: string | null;
    signaturePublicKeyFingerprint: string | null;
    signatureStorageKey: string | null;
    signatureSignedAt: string | null;
  } = {
    signatureAlgorithm: null,
    signaturePublicKeyFingerprint: null,
    signatureSignedAt: null,
    signatureStatus: "unsigned",
    signatureStorageKey: null
  };

  if (options.signingKey) {
    const signedAt = new Date().toISOString();
    const signature = signArchiveHash(archiveSha256, options.signingKey);
    const signatureStorageKey = buildExportBundleSignatureStorageKey(bundle.project_id, bundle.id);
    try {
      await storage.write(signatureStorageKey, signature);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        archiveSha256,
        archiveStorageKey,
        assetsCopied: copied,
        bundleId: bundle.id,
        failure: {
          failedAssetId: null,
          failedAt: new Date().toISOString(),
          failedBundlePath: signatureStorageKey,
          message: `Signature write failed: ${detail}`,
          phase: "write_asset"
        },
        manifestSha256,
        signatureAlgorithm: null,
        signaturePublicKeyFingerprint: null,
        signatureSignedAt: null,
        signatureStatus: "unsigned",
        signatureStorageKey: null,
        status: "assembly_failed"
      };
    }
    signatureFields = {
      signatureAlgorithm: "ed25519",
      signaturePublicKeyFingerprint: options.signingKey.publicKeyFingerprint,
      signatureSignedAt: signedAt,
      signatureStatus: "signed",
      signatureStorageKey
    };
  }

  return {
    archiveSha256,
    archiveStorageKey,
    assetsCopied: copied,
    bundleId: bundle.id,
    failure: null,
    manifestSha256,
    status: "assembled",
    ...signatureFields
  };
}

/**
 * Rejects legacy or hand-edited manifests whose archive paths would overwrite each other or extract
 * outside the bundle directory. New API-created manifests sanitize paths before persistence; this
 * worker guard prevents older pending rows from silently assembling corrupt archives.
 */
function validateIncludedAssetBundlePaths(manifest: ExportBundleManifest): ExportBundleAssemblyError | null {
  const seenPaths = new Map<string, string>();

  for (const includedAsset of manifest.includedAssets) {
    const unsafeReason = getUnsafeBundlePathReason(includedAsset.bundlePath);
    if (unsafeReason) {
      return {
        failedAssetId: includedAsset.assetId,
        failedAt: new Date().toISOString(),
        failedBundlePath: includedAsset.bundlePath,
        message: `Export bundle manifest contains an unsafe asset path (${unsafeReason}). Regenerate the bundle before assembly.`,
        phase: "unknown"
      };
    }

    const previousAssetId = seenPaths.get(includedAsset.bundlePath);
    if (previousAssetId) {
      return {
        failedAssetId: includedAsset.assetId,
        failedAt: new Date().toISOString(),
        failedBundlePath: includedAsset.bundlePath,
        message: `Export bundle manifest maps multiple assets to ${includedAsset.bundlePath} (${previousAssetId}, ${includedAsset.assetId}). Regenerate the bundle before assembly.`,
        phase: "unknown"
      };
    }

    seenPaths.set(includedAsset.bundlePath, includedAsset.assetId);
  }

  return null;
}

/** Returns a concise reason when a manifest path is unsafe for storage or archive extraction. */
function getUnsafeBundlePathReason(bundlePath: string): string | null {
  if (bundlePath.length === 0) return "empty path";
  if (bundlePath.startsWith("/") || bundlePath.startsWith("\\")) return "absolute path";
  if (bundlePath.includes("\0")) return "NUL byte";

  const segments = bundlePath.split(/[\\/]/u);
  if (segments.some((segment) => segment.length === 0)) return "empty path segment";
  if (segments.some((segment) => segment === "." || segment === "..")) return "relative path segment";

  return null;
}

/**
 * Returns the unsigned default cryptographic-provenance fields used on assembly failure paths
 * and on bundles that have no included assets. Centralizes the defaults so future additions
 * (e.g. a deterministic timestamp counter, a chain-of-custody field) only need to be added in
 * one place rather than smeared across every early-return branch.
 */
function buildUnsignedCryptographicDefaults(): {
  archiveSha256: null;
  manifestSha256: null;
  signatureStatus: ExportBundleSignatureStatus;
  signatureAlgorithm: null;
  signaturePublicKeyFingerprint: null;
  signatureStorageKey: null;
  signatureSignedAt: null;
} {
  return {
    archiveSha256: null,
    manifestSha256: null,
    signatureAlgorithm: null,
    signaturePublicKeyFingerprint: null,
    signatureSignedAt: null,
    signatureStatus: "unsigned",
    signatureStorageKey: null
  };
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

  // Read the signing key once per batch so a misconfigured PEM raises a single error during
  // worker startup rather than re-parsing per bundle. Returns null when no key is configured so
  // the assembly path stays `unsigned` by default -- the operator must explicitly opt in.
  const signingKey = readBundleSigningKeyMaterial();

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

    const outcome = await assembleSingleExportBundle(storage, bundle, { signingKey });
    const completedAt = new Date();

    if (outcome.status === "assembled") {
      await databasePool.query(
        `UPDATE export_bundles
            SET assembly_status = 'assembled',
                assembly_error = NULL,
                assembly_completed_at = $2,
                assembly_attempt_count = assembly_attempt_count + 1,
                archive_storage_key = $3,
                archive_sha256 = $4,
                manifest_sha256 = $5,
                signature_status = $6,
                signature_algorithm = $7,
                signature_public_key_fingerprint = $8,
                signature_storage_key = $9,
                signature_signed_at = $10
          WHERE id = $1`,
        [
          bundle.id,
          completedAt,
          outcome.archiveStorageKey,
          outcome.archiveSha256,
          outcome.manifestSha256,
          outcome.signatureStatus,
          outcome.signatureAlgorithm,
          outcome.signaturePublicKeyFingerprint,
          outcome.signatureStorageKey,
          outcome.signatureSignedAt
        ]
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
