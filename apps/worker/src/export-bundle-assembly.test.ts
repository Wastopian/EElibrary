/**
 * File header: Tests the worker-side export bundle asset-byte assembly path and failure telemetry.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { gunzipSync } from "node:zlib";
import { createHash, generateKeyPairSync } from "node:crypto";
import { setWorkerRepositoryPoolForTests } from "./catalog-repository";
import {
  assembleSingleExportBundle,
  buildExportBundleArchiveSha256StorageKey,
  buildExportBundleArchiveStorageKey,
  buildExportBundleAssetStorageKey,
  buildExportBundleSignatureStorageKey,
  processPendingExportBundleAssembly,
  readBundleSigningKeyMaterial
} from "./export-bundle-assembly";
import {
  readBundleVerificationKeyMaterial,
  verifyAssembledExportBundle
} from "./export-bundle-verification";
import type { ExportBundleManifest } from "@ee-library/shared/types";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { Pool } from "pg";

/** TestPool extends the pg-mem Pool with the .end() shape repository tests rely on. */
type TestPool = Pool & { end: () => Promise<void> };

const TEST_PROJECT_ID = "project-test";
const TEST_BUNDLE_ID = "ebundle-test";

/**
 * Builds a deterministic export bundle manifest with two verified assets for the assembly tests.
 */
function buildTestManifest(overrides: Partial<ExportBundleManifest> = {}): ExportBundleManifest {
  return {
    bundleFormat: "neutral",
    bundleId: TEST_BUNDLE_ID,
    generatedAt: "2026-05-07T10:00:00.000Z",
    includedAssets: [
      {
        assetId: "asset-1",
        assetType: "footprint",
        bundlePath: "C0805/footprint.kicad_mod",
        fileFormat: "kicad_mod",
        fileHash: null,
        manufacturerName: "Yageo",
        partId: "part-1",
        partMpn: "C0805",
        provenance: "official",
        storageKey: "assets/part-1/footprint.kicad_mod"
      },
      {
        assetId: "asset-2",
        assetType: "symbol",
        bundlePath: "C0805/symbol.lib",
        fileFormat: "kicad_sym",
        fileHash: null,
        manufacturerName: "Yageo",
        partId: "part-1",
        partMpn: "C0805",
        provenance: "official",
        storageKey: "assets/part-1/symbol.lib"
      }
    ],
    controlSummary: {
      highestAccessLevel: null,
      itarControlledCount: 0,
      restrictedCount: 0
    },
    controlledAssets: [],
    omissions: [],
    projectId: TEST_PROJECT_ID,
    revisionLabel: null,
    warnings: [],
    ...overrides
  };
}

/**
 * Builds a memory-backed FileStorageClient pre-populated with verified asset bytes.
 */
function createMemoryStorageClient(initial: Record<string, Buffer>): {
  storage: FileStorageClient;
  writes: Record<string, Buffer>;
} {
  const writes: Record<string, Buffer> = {};
  const reads = new Map<string, Buffer>(Object.entries(initial));

  const storage: FileStorageClient = {
    backend: "local",
    async exists(key) { return reads.has(key) || key in writes; },
    async getDownloadUrl() { return null; },
    async read(key) {
      // Reads must see previously written bytes so verification tests can re-read what
      // assembly just wrote (archive, signature sidecar, etc). Writes win over the seeded
      // initial reads -- production storage has the same semantics.
      if (key in writes) {
        return writes[key]!;
      }

      const value = reads.get(key);

      if (!value) {
        throw new Error(`storage key not found: ${key}`);
      }

      return value;
    },
    async write(key, content) {
      writes[key] = content;
    }
  };

  return { storage, writes };
}

/**
 * Creates a pg-mem pool seeded with one pending export bundle row matching the supplied manifest.
 */
async function createPendingExportBundlesPool(manifest: ExportBundleManifest): Promise<TestPool> {
  const db = newDb();

  db.public.none(`
    CREATE TABLE export_bundles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_label TEXT,
      bundle_format TEXT NOT NULL,
      storage_key TEXT,
      archive_storage_key TEXT,
      manifest JSONB NOT NULL,
      part_count INTEGER NOT NULL DEFAULT 0,
      included_asset_count INTEGER NOT NULL DEFAULT 0,
      omitted_asset_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      assembly_status TEXT NOT NULL DEFAULT 'not_required',
      assembly_error JSONB,
      assembly_completed_at TIMESTAMPTZ,
      assembly_attempt_count INTEGER NOT NULL DEFAULT 0,
      archive_sha256 TEXT,
      manifest_sha256 TEXT,
      signature_status TEXT NOT NULL DEFAULT 'unsigned',
      signature_algorithm TEXT,
      signature_public_key_fingerprint TEXT,
      signature_storage_key TEXT,
      signature_signed_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();
  const pool = new MemoryPool() as TestPool;

  await pool.query(
    `INSERT INTO export_bundles (id, project_id, bundle_format, manifest, included_asset_count,
                                 assembly_status, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, 'pending', '2026-05-07T10:00:00Z')`,
    [manifest.bundleId, manifest.projectId, manifest.bundleFormat, JSON.stringify(manifest), manifest.includedAssets.length]
  );

  return pool;
}

/**
 * Verifies one bundle's verified asset bytes are copied into the deterministic per-bundle prefix.
 */
test("assembleSingleExportBundle copies each included asset's bytes to its per-bundle path", async () => {
  const manifest = buildTestManifest();
  const { storage, writes } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)"),
    "assets/part-1/symbol.lib": Buffer.from("(symbol)")
  });

  const result = await assembleSingleExportBundle(storage, {
    assembly_attempt_count: 0,
    id: TEST_BUNDLE_ID,
    manifest,
    project_id: TEST_PROJECT_ID
  });

  assert.equal(result.status, "assembled");
  assert.equal(result.assetsCopied, 2);
  assert.equal(result.failure, null);

  const expectedFootprintKey = buildExportBundleAssetStorageKey(TEST_PROJECT_ID, TEST_BUNDLE_ID, "C0805/footprint.kicad_mod");
  const expectedSymbolKey = buildExportBundleAssetStorageKey(TEST_PROJECT_ID, TEST_BUNDLE_ID, "C0805/symbol.lib");

  assert.ok(writes[expectedFootprintKey], "footprint bytes were written to the per-bundle path");
  assert.equal(writes[expectedFootprintKey].toString("utf8"), "(footprint)");
  assert.ok(writes[expectedSymbolKey], "symbol bytes were written to the per-bundle path");
  assert.equal(writes[expectedSymbolKey].toString("utf8"), "(symbol)");

  const expectedArchiveKey = buildExportBundleArchiveStorageKey(TEST_PROJECT_ID, TEST_BUNDLE_ID);
  assert.equal(result.archiveStorageKey, expectedArchiveKey);
  assert.ok(writes[expectedArchiveKey], "single-archive .tar.gz was written to the deterministic path");

  // The archive must contain the manifest entry plus every included asset, gunzip-able with the
  // standard library so engineers can extract it with any common tool.
  const tarBytes = gunzipSync(writes[expectedArchiveKey]);
  assert.ok(tarBytes.includes(Buffer.from("manifest.json")), "archive embeds the manifest.json entry");
  assert.ok(tarBytes.includes(Buffer.from("C0805/footprint.kicad_mod")), "archive embeds the footprint asset entry");
  assert.ok(tarBytes.includes(Buffer.from("C0805/symbol.lib")), "archive embeds the symbol asset entry");
});

/**
 * Verifies a bundle with zero included assets short-circuits to assembled without storage I/O.
 */
test("assembleSingleExportBundle returns assembled with zero assets when nothing is included", async () => {
  const manifest = buildTestManifest({ includedAssets: [] });
  const { storage, writes } = createMemoryStorageClient({});

  const result = await assembleSingleExportBundle(storage, {
    assembly_attempt_count: 0,
    id: TEST_BUNDLE_ID,
    manifest,
    project_id: TEST_PROJECT_ID
  });

  assert.equal(result.status, "assembled");
  assert.equal(result.assetsCopied, 0);
  assert.equal(Object.keys(writes).length, 0);
});

/**
 * Verifies a missing source asset is reported as fetch_asset failure with structured telemetry.
 */
test("assembleSingleExportBundle reports fetch_asset failure when the source asset is missing", async () => {
  const manifest = buildTestManifest();
  const { storage } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)")
    // symbol bytes intentionally absent so the second copy fails on read
  });

  const result = await assembleSingleExportBundle(storage, {
    assembly_attempt_count: 0,
    id: TEST_BUNDLE_ID,
    manifest,
    project_id: TEST_PROJECT_ID
  });

  assert.equal(result.status, "assembly_failed");
  assert.equal(result.assetsCopied, 1);
  assert.ok(result.failure);
  assert.equal(result.failure?.phase, "fetch_asset");
  assert.equal(result.failure?.failedAssetId, "asset-2");
  assert.equal(result.failure?.failedBundlePath, "C0805/symbol.lib");
  assert.match(result.failure?.message ?? "", /storage key not found/u);
});

/**
 * Verifies a write failure is reported as write_asset failure rather than fetch_asset.
 */
test("assembleSingleExportBundle classifies destination write failures as write_asset", async () => {
  const manifest = buildTestManifest({ includedAssets: [buildTestManifest().includedAssets[0]!] });
  const sourceBytes = Buffer.from("(footprint)");
  const storage: FileStorageClient = {
    backend: "local",
    async exists() { return true; },
    async getDownloadUrl() { return null; },
    async read() { return sourceBytes; },
    async write() { throw new Error("disk full"); }
  };

  const result = await assembleSingleExportBundle(storage, {
    assembly_attempt_count: 0,
    id: TEST_BUNDLE_ID,
    manifest,
    project_id: TEST_PROJECT_ID
  });

  assert.equal(result.status, "assembly_failed");
  assert.equal(result.failure?.phase, "write_asset");
  assert.equal(result.failure?.message, "disk full");
});

/**
 * Verifies the batch entrypoint persists assembled state and increments the attempt count.
 */
test("processPendingExportBundleAssembly persists assembled state and bumps attempt count", async () => {
  const manifest = buildTestManifest();
  const pool = await createPendingExportBundlesPool(manifest);
  setWorkerRepositoryPoolForTests(pool);
  const { storage } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)"),
    "assets/part-1/symbol.lib": Buffer.from("(symbol)")
  });

  try {
    const summary = await processPendingExportBundleAssembly(10, storage);

    assert.equal(summary.processed.length, 1);
    assert.equal(summary.processed[0]?.status, "assembled");

    const row = await pool.query<{
      assembly_status: string;
      assembly_error: unknown;
      assembly_attempt_count: number | string;
      archive_storage_key: string | null;
    }>(
      "SELECT assembly_status, assembly_error, assembly_attempt_count, archive_storage_key FROM export_bundles WHERE id = $1",
      [TEST_BUNDLE_ID]
    );

    assert.equal(row.rows[0]?.assembly_status, "assembled");
    assert.equal(row.rows[0]?.assembly_error, null);
    assert.equal(Number(row.rows[0]?.assembly_attempt_count), 1);
    assert.equal(row.rows[0]?.archive_storage_key, buildExportBundleArchiveStorageKey(TEST_PROJECT_ID, TEST_BUNDLE_ID));
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the batch entrypoint persists assembly_error telemetry on failure.
 */
test("processPendingExportBundleAssembly writes structured assembly_error telemetry on failure", async () => {
  const manifest = buildTestManifest();
  const pool = await createPendingExportBundlesPool(manifest);
  setWorkerRepositoryPoolForTests(pool);
  const { storage } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)")
    // symbol bytes intentionally absent
  });

  try {
    const summary = await processPendingExportBundleAssembly(10, storage);

    assert.equal(summary.processed[0]?.status, "assembly_failed");

    const row = await pool.query<{
      assembly_status: string;
      assembly_error: unknown;
    }>(
      "SELECT assembly_status, assembly_error FROM export_bundles WHERE id = $1",
      [TEST_BUNDLE_ID]
    );

    assert.equal(row.rows[0]?.assembly_status, "assembly_failed");

    const persisted = row.rows[0]?.assembly_error as Record<string, unknown> | null;
    assert.ok(persisted, "assembly_error JSONB is persisted on failure");
    assert.equal(persisted?.phase, "fetch_asset");
    assert.equal(persisted?.failedAssetId, "asset-2");
    assert.equal(persisted?.failedBundlePath, "C0805/symbol.lib");
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Generates a fresh Ed25519 keypair as PEM strings for signing/verification tests. Keys are
 * generated per test so no shared state leaks between cases and the tests never embed a
 * checked-in private key.
 */
function generateEd25519PemPair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

/**
 * Verifies the assembly path records both archive and manifest SHA-256 hashes, writes the
 * standalone .sha256 sidecar, and stays `unsigned` when no signing key is supplied.
 *
 * This is the contract that protects the audit trail: a deployment without a signing key still
 * gets a deterministic hash on every assembled bundle, so an auditor can recompute the hash
 * locally and compare it to the persisted value -- they just do not get a signature.
 */
test("assembleSingleExportBundle records archive + manifest SHA-256 and writes the .sha256 sidecar even when unsigned", async () => {
  const manifest = buildTestManifest();
  const { storage, writes } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)"),
    "assets/part-1/symbol.lib": Buffer.from("(symbol)")
  });

  const result = await assembleSingleExportBundle(storage, {
    assembly_attempt_count: 0,
    id: TEST_BUNDLE_ID,
    manifest,
    project_id: TEST_PROJECT_ID
  });

  assert.equal(result.status, "assembled");
  assert.equal(result.signatureStatus, "unsigned");
  assert.equal(result.signatureAlgorithm, null);
  assert.equal(result.signatureStorageKey, null);
  assert.equal(result.signatureSignedAt, null);

  // Hashes must be recorded on the result so the worker can persist them in one query.
  assert.match(result.archiveSha256 ?? "", /^[0-9a-f]{64}$/u);
  assert.match(result.manifestSha256 ?? "", /^[0-9a-f]{64}$/u);

  const archiveKey = buildExportBundleArchiveStorageKey(TEST_PROJECT_ID, TEST_BUNDLE_ID);
  const archiveBytes = writes[archiveKey];
  assert.ok(archiveBytes, "archive bytes were written");

  const recomputedArchiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  assert.equal(result.archiveSha256, recomputedArchiveSha256, "archive hash matches the bytes on disk");

  // The standalone sidecar is the deterministic file an auditor downloads alongside the
  // archive. The format must be the canonical `<hex>  bundle.tar.gz\n` so existing sha256sum
  // tooling can verify against it.
  const sidecarKey = buildExportBundleArchiveSha256StorageKey(TEST_PROJECT_ID, TEST_BUNDLE_ID);
  const sidecarBytes = writes[sidecarKey];
  assert.ok(sidecarBytes, "the .sha256 sidecar was written next to the archive");
  assert.equal(sidecarBytes.toString("utf8"), `${recomputedArchiveSha256}  bundle.tar.gz\n`);

  // The embedded manifest.json.sha256 entry inside the archive must match the manifest hash
  // so an extracted bundle is self-verifying.
  const tarBytes = gunzipSync(archiveBytes);
  assert.ok(tarBytes.includes(Buffer.from("manifest.json.sha256")), "embedded manifest hash entry is present");
  assert.ok(tarBytes.includes(Buffer.from(result.manifestSha256!)), "embedded manifest hash matches the recorded value");
});

/**
 * Verifies the assembly path actually signs the archive when an Ed25519 signing key is supplied,
 * and that the recorded fingerprint matches the SHA-256 of the public key's DER SubjectPublicKeyInfo.
 */
test("assembleSingleExportBundle signs the archive hash with the supplied Ed25519 key and persists the public-key fingerprint", async () => {
  const { privatePem, publicPem } = generateEd25519PemPair();
  const signingKey = readBundleSigningKeyMaterial(privatePem);
  assert.ok(signingKey, "signing key parses from PEM");

  const manifest = buildTestManifest();
  const { storage, writes } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)"),
    "assets/part-1/symbol.lib": Buffer.from("(symbol)")
  });

  const result = await assembleSingleExportBundle(
    storage,
    {
      assembly_attempt_count: 0,
      id: TEST_BUNDLE_ID,
      manifest,
      project_id: TEST_PROJECT_ID
    },
    { signingKey }
  );

  assert.equal(result.status, "assembled");
  assert.equal(result.signatureStatus, "signed");
  assert.equal(result.signatureAlgorithm, "ed25519");
  assert.equal(
    result.signatureStorageKey,
    buildExportBundleSignatureStorageKey(TEST_PROJECT_ID, TEST_BUNDLE_ID),
    "signature is written next to the archive at the deterministic path"
  );
  assert.equal(result.signaturePublicKeyFingerprint, signingKey.publicKeyFingerprint);
  assert.match(result.signatureSignedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);

  // The signature file must exist and be non-empty; verifying the signature is exercised by
  // the verification-helper tests below so we don't duplicate the verify call here.
  const signatureBytes = writes[result.signatureStorageKey!];
  assert.ok(signatureBytes && signatureBytes.length > 0, "signature bytes were written to storage");

  // Round-trip: a verification key built from the matching public PEM should validate the
  // signature when `verifyAssembledExportBundle` is called against the same storage.
  const verificationKey = readBundleVerificationKeyMaterial(publicPem);
  assert.ok(verificationKey);
  assert.equal(verificationKey.publicKeyFingerprint, signingKey.publicKeyFingerprint);
});

/**
 * Verifies the verifier returns `unsigned` for a never-signed bundle without inventing a hash.
 */
test("verifyAssembledExportBundle returns unsigned for a never-signed bundle and does not invent a hash", async () => {
  const { storage } = createMemoryStorageClient({});
  const outcome = await verifyAssembledExportBundle(storage, {
    archiveSha256: null,
    archiveStorageKey: null,
    id: "ebundle-manifest-only",
    signatureAlgorithm: null,
    signaturePublicKeyFingerprint: null,
    signatureStatus: "unsigned",
    signatureStorageKey: null
  });

  assert.equal(outcome.status, "unsigned");
  assert.equal(outcome.recomputedArchiveSha256, null);
  assert.equal(outcome.reason, null);
});

/**
 * Verifies the verifier confirms the archive hash and the Ed25519 signature on a freshly
 * assembled bundle, returning `signed` with a `verifiedAt` timestamp -- the only audit-grade
 * outcome the UI may render as "verified".
 */
test("verifyAssembledExportBundle returns signed when the archive hash matches and the Ed25519 signature verifies", async () => {
  const { privatePem, publicPem } = generateEd25519PemPair();
  const signingKey = readBundleSigningKeyMaterial(privatePem);
  const verificationKey = readBundleVerificationKeyMaterial(publicPem);
  assert.ok(signingKey && verificationKey);

  const manifest = buildTestManifest();
  const { storage } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)"),
    "assets/part-1/symbol.lib": Buffer.from("(symbol)")
  });

  const assembled = await assembleSingleExportBundle(
    storage,
    { assembly_attempt_count: 0, id: TEST_BUNDLE_ID, manifest, project_id: TEST_PROJECT_ID },
    { signingKey }
  );

  const outcome = await verifyAssembledExportBundle(
    storage,
    {
      archiveSha256: assembled.archiveSha256,
      archiveStorageKey: assembled.archiveStorageKey,
      id: TEST_BUNDLE_ID,
      signatureAlgorithm: assembled.signatureAlgorithm,
      signaturePublicKeyFingerprint: assembled.signaturePublicKeyFingerprint,
      signatureStatus: assembled.signatureStatus,
      signatureStorageKey: assembled.signatureStorageKey
    },
    { now: () => new Date("2026-05-13T12:00:00.000Z"), verificationKey }
  );

  assert.equal(outcome.status, "signed");
  assert.equal(outcome.reason, null);
  assert.equal(outcome.recomputedArchiveSha256, assembled.archiveSha256);
  assert.equal(outcome.verifiedAt, "2026-05-13T12:00:00.000Z");
});

/**
 * Verifies that mutating the archive bytes after assembly is detected as `archive_hash_mismatch`,
 * not silently accepted as still-valid. This is the central honesty-discipline guarantee: a
 * tampered (or accidentally-corrupted) archive must surface a structured failure reason.
 */
test("verifyAssembledExportBundle returns verification_failed with archive_hash_mismatch when the archive bytes change", async () => {
  const { privatePem, publicPem } = generateEd25519PemPair();
  const signingKey = readBundleSigningKeyMaterial(privatePem);
  const verificationKey = readBundleVerificationKeyMaterial(publicPem);
  assert.ok(signingKey && verificationKey);

  const manifest = buildTestManifest();
  const { storage } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)"),
    "assets/part-1/symbol.lib": Buffer.from("(symbol)")
  });

  const assembled = await assembleSingleExportBundle(
    storage,
    { assembly_attempt_count: 0, id: TEST_BUNDLE_ID, manifest, project_id: TEST_PROJECT_ID },
    { signingKey }
  );

  // Overwrite the archive in place with different bytes. The verifier must detect this even
  // though the recorded SHA-256 column has not changed.
  await storage.write(assembled.archiveStorageKey!, Buffer.from("tampered-bytes"));

  const outcome = await verifyAssembledExportBundle(
    storage,
    {
      archiveSha256: assembled.archiveSha256,
      archiveStorageKey: assembled.archiveStorageKey,
      id: TEST_BUNDLE_ID,
      signatureAlgorithm: assembled.signatureAlgorithm,
      signaturePublicKeyFingerprint: assembled.signaturePublicKeyFingerprint,
      signatureStatus: assembled.signatureStatus,
      signatureStorageKey: assembled.signatureStorageKey
    },
    { verificationKey }
  );

  assert.equal(outcome.status, "verification_failed");
  assert.equal(outcome.reason, "archive_hash_mismatch");
  // We surface the recomputed hash so the persisted row can carry the new value alongside the
  // recorded one for forensics.
  assert.match(outcome.recomputedArchiveSha256 ?? "", /^[0-9a-f]{64}$/u);
  assert.notEqual(outcome.recomputedArchiveSha256, assembled.archiveSha256);
});

/**
 * Verifies that a bundle signed with key A and verified against key B fails with an explicit
 * fingerprint-mismatch reason. This protects against the "I rotated keys but forgot the old
 * fingerprint" failure mode where naive verification would silently mark old bundles as
 * unverifiable without naming the cause.
 */
test("verifyAssembledExportBundle returns verification_key_fingerprint_mismatch when the verification key does not match the recorded fingerprint", async () => {
  const signerKey = readBundleSigningKeyMaterial(generateEd25519PemPair().privatePem);
  const otherVerifierKey = readBundleVerificationKeyMaterial(generateEd25519PemPair().publicPem);
  assert.ok(signerKey && otherVerifierKey);

  const manifest = buildTestManifest();
  const { storage } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)"),
    "assets/part-1/symbol.lib": Buffer.from("(symbol)")
  });
  const assembled = await assembleSingleExportBundle(
    storage,
    { assembly_attempt_count: 0, id: TEST_BUNDLE_ID, manifest, project_id: TEST_PROJECT_ID },
    { signingKey: signerKey }
  );

  const outcome = await verifyAssembledExportBundle(
    storage,
    {
      archiveSha256: assembled.archiveSha256,
      archiveStorageKey: assembled.archiveStorageKey,
      id: TEST_BUNDLE_ID,
      signatureAlgorithm: assembled.signatureAlgorithm,
      signaturePublicKeyFingerprint: assembled.signaturePublicKeyFingerprint,
      signatureStatus: assembled.signatureStatus,
      signatureStorageKey: assembled.signatureStorageKey
    },
    { verificationKey: otherVerifierKey }
  );

  assert.equal(outcome.status, "verification_failed");
  assert.equal(outcome.reason, "verification_key_fingerprint_mismatch");
});

/**
 * Verifies that a signed bundle with no verification key configured surfaces the dedicated
 * `verification_key_unavailable` reason instead of pretending the bundle is unsigned. The
 * caller (UI, admin route) is then free to render "Configure verification key to re-verify".
 */
test("verifyAssembledExportBundle returns verification_key_unavailable for a signed bundle when no verification key is configured", async () => {
  const signerKey = readBundleSigningKeyMaterial(generateEd25519PemPair().privatePem);
  assert.ok(signerKey);

  const manifest = buildTestManifest();
  const { storage } = createMemoryStorageClient({
    "assets/part-1/footprint.kicad_mod": Buffer.from("(footprint)"),
    "assets/part-1/symbol.lib": Buffer.from("(symbol)")
  });
  const assembled = await assembleSingleExportBundle(
    storage,
    { assembly_attempt_count: 0, id: TEST_BUNDLE_ID, manifest, project_id: TEST_PROJECT_ID },
    { signingKey: signerKey }
  );

  const outcome = await verifyAssembledExportBundle(storage, {
    archiveSha256: assembled.archiveSha256,
    archiveStorageKey: assembled.archiveStorageKey,
    id: TEST_BUNDLE_ID,
    signatureAlgorithm: assembled.signatureAlgorithm,
    signaturePublicKeyFingerprint: assembled.signaturePublicKeyFingerprint,
    signatureStatus: assembled.signatureStatus,
    signatureStorageKey: assembled.signatureStorageKey
  });

  assert.equal(outcome.status, "verification_failed");
  assert.equal(outcome.reason, "verification_key_unavailable");
  assert.equal(outcome.recomputedArchiveSha256, assembled.archiveSha256);
});
