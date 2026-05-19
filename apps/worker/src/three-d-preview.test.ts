/**
 * File header: Tests STEP→glTF preview-artifact generation honesty discipline.
 *
 * Three branches covered:
 *   - Converter unconfigured ⇒ assets stay untouched (no fake preview bytes, no DB row change).
 *   - Converter present + storage write succeeds ⇒ artifact channel populated and `preview_status`
 *     promotes to `ready`. Source asset's review/validation/export status MUST stay unchanged.
 *   - Converter throws ⇒ row reports `conversion_failed` with bounded telemetry; no DB write.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { setWorkerRepositoryPoolForTests } from "./catalog-repository";
import { processPendingThreeDPreviewJobs, setThreeDPreviewConverter } from "./three-d-preview";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by 3D preview tests. */
type TestPool = Pool & {
  end: () => Promise<void>;
};

/**
 * Builds an in-memory storage client that lets tests pre-seed source bytes and observe writes.
 */
function buildMemoryStorage(seed: Record<string, Buffer> = {}): FileStorageClient & { writes: Map<string, Buffer> } {
  const reads = new Map<string, Buffer>(Object.entries(seed));
  const writes = new Map<string, Buffer>();
  return {
    backend: "local",
    async exists(storageKey: string): Promise<boolean> {
      return reads.has(storageKey) || writes.has(storageKey);
    },
    async getDownloadUrl(storageKey: string): Promise<string | null> {
      return `memory://${storageKey}`;
    },
    async read(storageKey: string): Promise<Buffer> {
      const buf = writes.get(storageKey) ?? reads.get(storageKey);
      if (!buf) {
        throw new Error(`Memory storage miss: ${storageKey}`);
      }
      return buf;
    },
    async write(storageKey: string, content: Buffer): Promise<void> {
      writes.set(storageKey, content);
    },
    writes
  };
}

/**
 * Verifies the converter-unavailable branch leaves preview-artifact columns untouched and never
 * marks `preview_status = 'ready'` -- the daemon must not advertise rendering bytes that cannot
 * be produced by the current configuration.
 */
test("processPendingThreeDPreviewJobs is a no-op when no converter is configured", async () => {
  const pool = createThreeDPreviewPool();
  setWorkerRepositoryPoolForTests(pool);
  setThreeDPreviewConverter(null);

  try {
    const storage = buildMemoryStorage({ "cad/part-step/model.step": Buffer.from("step-bytes") });
    const summary = await processPendingThreeDPreviewJobs(10, storage);

    assert.equal(summary.processed.length, 1);
    assert.equal(summary.processed[0]?.status, "skipped_converter_unavailable");
    assert.equal(summary.processed[0]?.artifactStorageKey, null);
    assert.equal(storage.writes.size, 0);

    const row = await pool.query<{
      preview_status: string;
      preview_artifact_storage_key: string | null;
      preview_artifact_format: string | null;
      preview_artifact_source: string | null;
      review_status: string;
      export_status: string;
    }>(
      `SELECT preview_status, preview_artifact_storage_key, preview_artifact_format, preview_artifact_source, review_status, export_status
         FROM assets WHERE id = 'asset-step'`
    );
    assert.deepEqual(row.rows[0], {
      preview_status: "pending",
      preview_artifact_storage_key: null,
      preview_artifact_format: null,
      preview_artifact_source: null,
      review_status: "not_reviewed",
      export_status: "not_exportable"
    });
  } finally {
    setThreeDPreviewConverter(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies a successful conversion writes the derived bytes to the deterministic artifact key,
 * promotes `preview_status = 'ready'`, and leaves the source asset's trust columns alone.
 */
test("processPendingThreeDPreviewJobs writes derived artifact and promotes preview_status only", async () => {
  const pool = createThreeDPreviewPool();
  setWorkerRepositoryPoolForTests(pool);
  setThreeDPreviewConverter({
    async convertStepToGltf({ stepBytes }) {
      return { bytes: Buffer.concat([Buffer.from("glb:"), stepBytes]), format: "glb" };
    }
  });

  try {
    const storage = buildMemoryStorage({ "cad/part-step/model.step": Buffer.from("step-bytes") });
    const summary = await processPendingThreeDPreviewJobs(10, storage);

    assert.equal(summary.processed.length, 1);
    assert.equal(summary.processed[0]?.status, "converted");
    assert.equal(summary.processed[0]?.artifactStorageKey, "previews/three_d/part-step/asset-step.glb");
    assert.equal(summary.processed[0]?.artifactFormat, "glb");
    assert.equal(storage.writes.get("previews/three_d/part-step/asset-step.glb")?.toString("utf8"), "glb:step-bytes");

    const row = await pool.query<{
      preview_status: string;
      preview_artifact_storage_key: string | null;
      preview_artifact_format: string | null;
      preview_artifact_source: string | null;
      review_status: string;
      export_status: string;
      validation_status: string;
    }>(
      `SELECT preview_status, preview_artifact_storage_key, preview_artifact_format, preview_artifact_source, review_status, export_status, validation_status
         FROM assets WHERE id = 'asset-step'`
    );
    assert.deepEqual(row.rows[0], {
      preview_status: "ready",
      preview_artifact_storage_key: "previews/three_d/part-step/asset-step.glb",
      preview_artifact_format: "glb",
      preview_artifact_source: "converter_step_to_gltf",
      review_status: "not_reviewed",
      export_status: "not_exportable",
      validation_status: "needs_review"
    });
  } finally {
    setThreeDPreviewConverter(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies converter failure surfaces telemetry without persisting partial preview state.
 */
test("processPendingThreeDPreviewJobs reports converter failure without DB writes", async () => {
  const pool = createThreeDPreviewPool();
  setWorkerRepositoryPoolForTests(pool);
  setThreeDPreviewConverter({
    async convertStepToGltf() {
      throw new Error("STEP topology rejected");
    }
  });

  try {
    const storage = buildMemoryStorage({ "cad/part-step/model.step": Buffer.from("step-bytes") });
    const summary = await processPendingThreeDPreviewJobs(10, storage);

    assert.equal(summary.processed.length, 1);
    assert.equal(summary.processed[0]?.status, "conversion_failed");
    assert.equal(summary.processed[0]?.failureReason, "converter_failed");
    assert.match(summary.processed[0]?.failureMessage ?? "", /STEP topology rejected/u);
    assert.equal(storage.writes.size, 0);

    const row = await pool.query<{
      preview_status: string;
      preview_artifact_storage_key: string | null;
    }>(
      `SELECT preview_status, preview_artifact_storage_key FROM assets WHERE id = 'asset-step'`
    );
    assert.deepEqual(row.rows[0], { preview_status: "pending", preview_artifact_storage_key: null });
  } finally {
    setThreeDPreviewConverter(null);
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Builds an in-memory schema with one STEP three_d_model asset waiting for a derived preview.
 */
function createThreeDPreviewPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      file_format TEXT NOT NULL,
      storage_key TEXT,
      file_hash TEXT,
      provider_id TEXT,
      license_mode TEXT NOT NULL,
      provenance TEXT NOT NULL,
      availability_status TEXT NOT NULL,
      review_status TEXT NOT NULL,
      export_status TEXT NOT NULL,
      asset_status TEXT NOT NULL,
      generation_method TEXT,
      generation_source_asset_id TEXT,
      validation_status TEXT NOT NULL,
      preview_status TEXT NOT NULL,
      preview_artifact_storage_key TEXT,
      preview_artifact_format TEXT,
      preview_artifact_generated_at TIMESTAMPTZ,
      preview_artifact_source TEXT,
      asset_state TEXT NOT NULL,
      source_url TEXT,
      source_record_id TEXT,
      last_updated_at TIMESTAMPTZ NOT NULL
    );

    INSERT INTO assets (
      id, part_id, asset_type, file_format, storage_key, file_hash, provider_id, license_mode, provenance,
      availability_status, review_status, export_status, asset_status, generation_method,
      generation_source_asset_id, validation_status, preview_status, asset_state, source_url, source_record_id,
      last_updated_at
    )
    VALUES (
      'asset-step', 'part-step', 'three_d_model', 'step', 'cad/part-step/model.step', 'sha256:test',
      NULL, 'redistribution_allowed', 'manual_internal', 'downloaded', 'not_reviewed', 'not_exportable',
      'downloaded', NULL, NULL, 'needs_review', 'pending', 'downloaded', NULL, NULL, '2026-05-13T00:00:00.000Z'
    );
  `);

  const adapter = db.adapters.createPg();
  return new adapter.Pool() as TestPool;
}
