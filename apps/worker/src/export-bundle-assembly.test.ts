/**
 * File header: Tests the worker-side export bundle asset-byte assembly path and failure telemetry.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { gunzipSync } from "node:zlib";
import { setWorkerRepositoryPoolForTests } from "./catalog-repository";
import { assembleSingleExportBundle, buildExportBundleArchiveStorageKey, buildExportBundleAssetStorageKey, processPendingExportBundleAssembly } from "./export-bundle-assembly";
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
