/**
 * File header: Tests worker draft-generation output linkage and trust boundaries.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { generateDraftAssetsForPendingRequests } from "./draft-generation";
import type { Pool, PoolClient } from "pg";

/** TestPool is the pg-mem pool shape used by draft-generation integration tests. */
type TestPool = Pool & {
  /** Closes the in-memory database pool. */
  end: () => Promise<void>;
};

/**
 * Verifies footprint and symbol requests create generated, review-required, non-exportable drafts.
 */
test("generateDraftAssetsForPendingRequests creates review-required footprint and symbol draft assets", async () => {
  const pool = createDraftGenerationPool();
  const client = await pool.connect();

  try {
    await seedDraftGenerationData(client);
  } finally {
    client.release();
  }

  try {
    const summary = await generateDraftAssetsForPendingRequests(pool, { generatedAt: "2026-04-15T00:00:00.000Z" });
    const verifyClient = await pool.connect();

    try {
      const assets = await verifyClient.query<{
        asset_type: string;
        availability_status: string;
        export_status: string;
        file_format: string;
        file_hash: string;
        generation_method: string;
        id: string;
        provenance: string;
        review_status: string;
        storage_key: string;
        validation_status: string;
      }>("SELECT id, asset_type, file_format, storage_key, file_hash, provenance, availability_status, review_status, export_status, validation_status, generation_method FROM assets ORDER BY id ASC");
      const workflows = await verifyClient.query<{ generation_status: string; id: string; output_asset_id: string; target_asset_type: string }>("SELECT id, target_asset_type, generation_status, output_asset_id FROM generation_workflows ORDER BY id ASC");
      const requests = await verifyClient.query<{ id: string; request_status: string; workflow_id: string }>("SELECT id, request_status, workflow_id FROM generation_requests ORDER BY id ASC");

      assert.equal(summary.processed, 2);
      assert.equal(summary.generated.length, 2);
      assert.deepEqual(summary.skipped, []);
      assert.deepEqual(
        assets.rows.map((asset) => [asset.asset_type, asset.file_format, asset.provenance, asset.review_status, asset.export_status, asset.validation_status]),
        [
          ["footprint", "kicad_mod", "generated", "review_required", "not_exportable", "needs_review"],
          ["symbol", "kicad_sym", "generated", "review_required", "not_exportable", "needs_review"]
        ]
      );
      assert.ok(assets.rows.every((asset) => asset.availability_status === "downloaded"));
      assert.ok(assets.rows.every((asset) => asset.file_hash.startsWith("sha256:")));
      assert.ok(assets.rows.every((asset) => asset.storage_key.startsWith("generated/drafts/")));
      assert.deepEqual(
        workflows.rows.map((workflow) => [workflow.target_asset_type, workflow.generation_status, workflow.output_asset_id]),
        [
          ["footprint", "review_required", "asset-draft-part-footprint-footprint"],
          ["symbol", "review_required", "asset-draft-part-symbol-symbol"]
        ]
      );
      assert.deepEqual(
        requests.rows.map((request) => [request.id, request.request_status, request.workflow_id]),
        [
          ["request-footprint", "review_required", "gen-part-footprint-footprint"],
          ["request-symbol", "review_required", "gen-part-symbol-symbol"]
        ]
      );
    } finally {
      verifyClient.release();
    }
  } finally {
    await pool.end();
  }
});

/**
 * Verifies skipped requests are reported without creating fake generated outputs.
 */
test("generateDraftAssetsForPendingRequests skips incomplete source material without fake success", async () => {
  const pool = createDraftGenerationPool();
  const client = await pool.connect();

  try {
    await seedPartRows(client, {
      bodyLengthMm: null,
      bodyWidthMm: null,
      id: "part-incomplete",
      mpn: "INCOMPLETE-1",
      packageId: "pkg-incomplete",
      pinCount: 8,
      pitchMm: 0.5
    });
    await client.query(
      `
        INSERT INTO source_extraction_signals (id, part_id, source_record_id, datasheet_revision_id, asset_id, signal_type, extraction_status, confidence_score, extraction_source, notes, last_updated_at)
        VALUES ('sig-incomplete-package', 'part-incomplete', 'source-incomplete', NULL, NULL, 'package_mechanical_dimensions', 'available', 0.8, 'provider_structured_metadata', NULL, '2026-04-15T00:00:00.000Z')
      `
    );
    await client.query(
      `
        INSERT INTO generation_requests (id, part_id, target_asset_type, source_datasheet_revision_id, source_asset_id, request_status, requested_at, requested_by, workflow_id, last_updated_at)
        VALUES ('request-incomplete', 'part-incomplete', 'footprint', NULL, NULL, 'requested', '2026-04-15T00:00:00.000Z', 'local-dev', NULL, '2026-04-15T00:00:00.000Z')
      `
    );
  } finally {
    client.release();
  }

  try {
    const summary = await generateDraftAssetsForPendingRequests(pool, { generatedAt: "2026-04-15T00:00:00.000Z" });
    const verifyClient = await pool.connect();

    try {
      const assetCount = await verifyClient.query<{ count: string }>("SELECT count(*)::text AS count FROM assets");

      assert.equal(summary.processed, 1);
      assert.equal(summary.generated.length, 0);
      assert.equal(summary.skipped[0]?.reason, "Package body dimensions are incomplete.");
      assert.equal(assetCount.rows[0]?.count, "0");
    } finally {
      verifyClient.release();
    }
  } finally {
    await pool.end();
  }
});

/**
 * Creates a minimal in-memory schema for draft-generation pipeline tests.
 */
function createDraftGenerationPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE manufacturers (id TEXT PRIMARY KEY, name TEXT, aliases TEXT[], website TEXT);
    CREATE TABLE packages (id TEXT PRIMARY KEY, package_name TEXT, pin_count INTEGER, pitch_mm NUMERIC, body_length_mm NUMERIC, body_width_mm NUMERIC, body_height_mm NUMERIC);
    CREATE TABLE parts (id TEXT PRIMARY KEY, mpn TEXT, manufacturer_id TEXT, category TEXT, lifecycle_status TEXT, package_id TEXT, connector_family_id TEXT, trust_score NUMERIC, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_records (id TEXT PRIMARY KEY, provider_id TEXT, provider_part_key TEXT, part_id TEXT, source_url TEXT, fetched_at TIMESTAMPTZ, raw_payload JSONB, normalized_at TIMESTAMPTZ, source_last_seen_at TIMESTAMPTZ, source_last_imported_at TIMESTAMPTZ, import_status TEXT, import_error_details TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE assets (id TEXT PRIMARY KEY, part_id TEXT, asset_type TEXT, file_format TEXT, storage_key TEXT, file_hash TEXT, provider_id TEXT, license_mode TEXT, provenance TEXT, availability_status TEXT, review_status TEXT, export_status TEXT, asset_status TEXT, generation_method TEXT, generation_source_asset_id TEXT, validation_status TEXT, preview_status TEXT, preview_artifact_storage_key TEXT, preview_artifact_format TEXT, preview_artifact_generated_at TIMESTAMPTZ, preview_artifact_source TEXT, asset_state TEXT, source_url TEXT, source_record_id TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE source_extraction_signals (id TEXT PRIMARY KEY, part_id TEXT, source_record_id TEXT, datasheet_revision_id TEXT, asset_id TEXT, signal_type TEXT, extraction_status TEXT, confidence_score NUMERIC, extraction_source TEXT, notes TEXT, last_updated_at TIMESTAMPTZ);
    CREATE TABLE generation_workflows (id TEXT PRIMARY KEY, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, generation_status TEXT, confidence_score NUMERIC, output_asset_id TEXT);
    CREATE TABLE generation_requests (id TEXT PRIMARY KEY, part_id TEXT, target_asset_type TEXT, source_datasheet_revision_id TEXT, source_asset_id TEXT, request_status TEXT, requested_at TIMESTAMPTZ, requested_by TEXT, workflow_id TEXT, last_updated_at TIMESTAMPTZ);
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Seeds two requestable parts, one for footprint drafts and one for symbol drafts.
 */
async function seedDraftGenerationData(client: PoolClient): Promise<void> {
  await seedPartRows(client, {
    bodyLengthMm: 3,
    bodyWidthMm: 1.7,
    id: "part-footprint",
    mpn: "FOOTPRINT-1",
    packageId: "pkg-footprint",
    pinCount: 5,
    pitchMm: 0.95
  });
  await seedPartRows(client, {
    bodyLengthMm: 4,
    bodyWidthMm: 4,
    id: "part-symbol",
    mpn: "SYMBOL-1",
    packageId: "pkg-symbol",
    pinCount: 8,
    pitchMm: 0.5
  });
  await client.query(
    `
      INSERT INTO source_extraction_signals (id, part_id, source_record_id, datasheet_revision_id, asset_id, signal_type, extraction_status, confidence_score, extraction_source, notes, last_updated_at)
      VALUES
        ('sig-footprint-package', 'part-footprint', 'source-footprint', NULL, NULL, 'package_mechanical_dimensions', 'available', 0.86, 'provider_structured_metadata', NULL, '2026-04-15T00:00:00.000Z'),
        ('sig-symbol-pin-table', 'part-symbol', 'source-symbol', NULL, NULL, 'pin_table', 'available', 0.91, 'provider_structured_metadata', NULL, '2026-04-15T00:00:00.000Z')
    `
  );
  await client.query(
    `
      INSERT INTO generation_requests (id, part_id, target_asset_type, source_datasheet_revision_id, source_asset_id, request_status, requested_at, requested_by, workflow_id, last_updated_at)
      VALUES
        ('request-footprint', 'part-footprint', 'footprint', NULL, NULL, 'requested', '2026-04-15T00:00:00.000Z', 'local-dev', NULL, '2026-04-15T00:00:00.000Z'),
        ('request-symbol', 'part-symbol', 'symbol', NULL, NULL, 'requested', '2026-04-15T00:00:00.000Z', 'local-dev', NULL, '2026-04-15T00:00:00.000Z')
    `
  );
}

/** SeedPartInput carries the normalized package values needed by draft generation. */
interface SeedPartInput {
  /** Part id. */
  id: string;
  /** MPN. */
  mpn: string;
  /** Package id. */
  packageId: string;
  /** Pin count. */
  pinCount: number;
  /** Pin pitch in millimeters. */
  pitchMm: number;
  /** Body length in millimeters. */
  bodyLengthMm: number | null;
  /** Body width in millimeters. */
  bodyWidthMm: number | null;
}

/**
 * Seeds one canonical part with a package and source row.
 */
async function seedPartRows(client: PoolClient, input: SeedPartInput): Promise<void> {
  await client.query("INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-test', 'Test Manufacturer', '{}', NULL) ON CONFLICT (id) DO NOTHING");
  await client.query(
    `
      INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm)
      VALUES ($1, $2, $3, $4, $5, $6, NULL)
    `,
    [input.packageId, input.packageId, input.pinCount, input.pitchMm, input.bodyLengthMm, input.bodyWidthMm]
  );
  await client.query(
    `
      INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, connector_family_id, trust_score, last_updated_at)
      VALUES ($1, $2, 'mfr-test', 'Integrated Circuits', 'active', $3, NULL, 0.7, '2026-04-15T00:00:00.000Z')
    `,
    [input.id, input.mpn, input.packageId]
  );
  await client.query(
    `
      INSERT INTO source_records (id, provider_id, provider_part_key, part_id, source_url, fetched_at, raw_payload, normalized_at, source_last_seen_at, source_last_imported_at, import_status, import_error_details, last_updated_at)
      VALUES ($1, 'test-provider', $2, $3, NULL, '2026-04-15T00:00:00.000Z', '{}', '2026-04-15T00:00:00.000Z', '2026-04-15T00:00:00.000Z', '2026-04-15T00:00:00.000Z', 'imported', NULL, '2026-04-15T00:00:00.000Z')
    `,
    [`source-${input.id.replace("part-", "")}`, input.mpn, input.id]
  );
}
