/**
 * File header: Tests the file-grounded asset validation jobs (footprint geometry +
 * symbol pin-count cross-check) for honest decisions and persisted evidence rows.
 *
 * Key honesty invariants exercised:
 *   - `verified` only when every assertion passes against real package metadata or a
 *     high-confidence pin-table extraction signal.
 *   - `needs_review` when the upstream evidence the validator would cite is missing
 *     or low-confidence (no package pin count, no datasheet pin-table, etc).
 *   - `failed` for decisive contradictions (pad count != pin count, pads outside body
 *     envelope, parsed pin counts that disagree with the datasheet).
 *   - The asset row's review/export/availability status is never mutated; only the
 *     `asset_validation_records` table receives writes.
 *   - Re-runs upsert into the same record id so historical evidence stays a single row
 *     per (validator, asset) pair.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { setWorkerRepositoryPoolForTests } from "./catalog-repository";
import {
  countKicadSymbolPins,
  decideFootprintGeometryStatus,
  decideSymbolPinCountStatus,
  parseKicadFootprint,
  processFootprintGeometryValidations,
  processSymbolPinCountValidations
} from "./asset-validation-jobs";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by validation tests. */
type TestPool = Pool & {
  end: () => Promise<void>;
};

/**
 * A two-pad SOT-23 style footprint with both pads inside a small body envelope.
 * Coordinates are in mm; the ±1.0 mm extents fit comfortably within the seeded 3x3 mm body.
 */
const SOT23_TWO_PAD_FOOTPRINT = `
(module sot23 (layer F.Cu)
  (pad "1" smd rect (at -1.0 0.5) (size 0.6 0.7) (layers F.Cu F.Mask))
  (pad "2" smd rect (at 1.0 -0.5) (size 0.6 0.7) (layers F.Cu F.Mask))
)
`;

/**
 * A footprint whose pad lies way outside the seeded 3x3 mm body envelope -- the bbox
 * check should fail the decision.
 */
const PAD_OUTSIDE_ENVELOPE_FOOTPRINT = `
(module bad (layer F.Cu)
  (pad "1" smd rect (at -10.0 0) (size 0.6 0.7) (layers F.Cu F.Mask))
  (pad "2" smd rect (at 10.0 0) (size 0.6 0.7) (layers F.Cu F.Mask))
)
`;

/**
 * A symbol with three pins. Each pin uses the canonical KiCad symbol form
 * `(pin TYPE STYLE (at X Y ANGLE) ...)` so the regex counts them correctly.
 */
const THREE_PIN_SYMBOL = `
(symbol "u1"
  (pin power_in line (at -2.54 0 0) (length 2.54) (name "VCC") (number "1"))
  (pin output line (at 2.54 0 180) (length 2.54) (name "OUT") (number "2"))
  (pin power_in line (at 0 -2.54 90) (length 2.54) (name "GND") (number "3"))
)
`;

/**
 * Verifies the kicad_mod parser counts pads and extracts pad centers correctly.
 */
test("parseKicadFootprint extracts pad count and centers from a kicad_mod source", () => {
  const parsed = parseKicadFootprint(SOT23_TWO_PAD_FOOTPRINT);

  assert.equal(parsed.padCount, 2);
  assert.deepEqual(parsed.pads, [
    { xMm: -1.0, yMm: 0.5 },
    { xMm: 1.0, yMm: -0.5 }
  ]);
});

/**
 * Verifies the kicad_sym pin counter counts only `(pin TYPE STYLE (at ...)` openings.
 */
test("countKicadSymbolPins counts only pin definitions, not pin_names blocks", () => {
  const symbolWithPinNames = `
    (symbol "u" (pin_names (offset 1.016)) (pin_numbers hide)
      (pin power_in line (at -2.54 0 0) (length 2.54) (name "VCC") (number "1"))
      (pin output line (at 2.54 0 180) (length 2.54) (name "OUT") (number "2"))
    )
  `;

  assert.equal(countKicadSymbolPins(symbolWithPinNames), 2);
  assert.equal(countKicadSymbolPins(THREE_PIN_SYMBOL), 3);
});

/**
 * Verifies the footprint decision returns `verified` when pad count matches the
 * package pin count and the pad bounding box fits within the body envelope.
 */
test("decideFootprintGeometryStatus returns verified when pads match package metadata", () => {
  const parsed = parseKicadFootprint(SOT23_TWO_PAD_FOOTPRINT);
  const decision = decideFootprintGeometryStatus(parsed, {
    asset_id: "asset-fp-ok",
    body_length_mm: 3,
    body_width_mm: 3,
    file_format: "kicad_mod",
    package_pin_count: 2,
    part_id: "part-fp-ok",
    storage_key: "cad/fp/ok.kicad_mod"
  });

  assert.equal(decision.status, "verified");
  assert.match(decision.notes, /matches package pin count = 2/u);
});

/**
 * Verifies the footprint decision returns `failed` for a clear pad count mismatch.
 */
test("decideFootprintGeometryStatus returns failed when pad count != package pin count", () => {
  const parsed = parseKicadFootprint(SOT23_TWO_PAD_FOOTPRINT);
  const decision = decideFootprintGeometryStatus(parsed, {
    asset_id: "asset-fp-bad",
    body_length_mm: 3,
    body_width_mm: 3,
    file_format: "kicad_mod",
    package_pin_count: 8,
    part_id: "part-fp-bad",
    storage_key: "cad/fp/bad.kicad_mod"
  });

  assert.equal(decision.status, "failed");
  assert.match(decision.notes, /Parsed pad count = 2 but the part's package records pin_count = 8/u);
});

/**
 * Verifies the footprint decision returns `failed` when pads sit outside the package
 * body envelope by more than the slack tolerance.
 */
test("decideFootprintGeometryStatus returns failed when pads sit outside the body envelope", () => {
  const parsed = parseKicadFootprint(PAD_OUTSIDE_ENVELOPE_FOOTPRINT);
  const decision = decideFootprintGeometryStatus(parsed, {
    asset_id: "asset-fp-bbox",
    body_length_mm: 3,
    body_width_mm: 3,
    file_format: "kicad_mod",
    package_pin_count: 2,
    part_id: "part-fp-bbox",
    storage_key: "cad/fp/bbox.kicad_mod"
  });

  assert.equal(decision.status, "failed");
  assert.match(decision.notes, /exceeds the package body envelope/u);
});

/**
 * Verifies the footprint decision returns `needs_review` when the package pin count
 * is missing, since the validator cannot verify parity without that ground truth.
 */
test("decideFootprintGeometryStatus returns needs_review when package metadata is missing", () => {
  const parsed = parseKicadFootprint(SOT23_TWO_PAD_FOOTPRINT);
  const decision = decideFootprintGeometryStatus(parsed, {
    asset_id: "asset-fp-no-pin-count",
    body_length_mm: 3,
    body_width_mm: 3,
    file_format: "kicad_mod",
    package_pin_count: null,
    part_id: "part-fp-no-pin-count",
    storage_key: "cad/fp/no-pin-count.kicad_mod"
  });

  assert.equal(decision.status, "needs_review");
  assert.match(decision.notes, /Package pin count is not recorded/u);
});

/**
 * Verifies the symbol decision returns `verified` when the symbol's pin count matches
 * a high-confidence datasheet extraction.
 */
test("decideSymbolPinCountStatus returns verified on a confident match", () => {
  const decision = decideSymbolPinCountStatus(3, {
    asset_id: "asset-sym-ok",
    file_format: "kicad_sym",
    part_id: "part-sym-ok",
    pin_table_confidence: 0.92,
    pin_table_pin_count: 3,
    storage_key: "cad/sym/ok.kicad_sym"
  });

  assert.equal(decision.status, "verified");
  assert.match(decision.notes, /matches the datasheet pin-table extraction/u);
});

/**
 * Verifies the symbol decision returns `failed` on a confident pin-count mismatch.
 */
test("decideSymbolPinCountStatus returns failed on a confident mismatch", () => {
  const decision = decideSymbolPinCountStatus(8, {
    asset_id: "asset-sym-bad",
    file_format: "kicad_sym",
    part_id: "part-sym-bad",
    pin_table_confidence: 0.92,
    pin_table_pin_count: 3,
    storage_key: "cad/sym/bad.kicad_sym"
  });

  assert.equal(decision.status, "failed");
  assert.match(decision.notes, /Symbol pin count = 8 but the datasheet pin-table extraction/u);
});

/**
 * Verifies the symbol decision returns `needs_review` when the extraction confidence
 * is below the cross-check threshold.
 */
test("decideSymbolPinCountStatus returns needs_review when extraction confidence is too low", () => {
  const decision = decideSymbolPinCountStatus(3, {
    asset_id: "asset-sym-low",
    file_format: "kicad_sym",
    part_id: "part-sym-low",
    pin_table_confidence: 0.5,
    pin_table_pin_count: 3,
    storage_key: "cad/sym/low.kicad_sym"
  });

  assert.equal(decision.status, "needs_review");
  assert.match(decision.notes, /Cross-check requires a high-confidence extraction/u);
});

/**
 * Verifies the footprint validator end-to-end: reads stored bytes, decides, and persists
 * exactly one `asset_validation_records` row per asset, without touching the asset's
 * review/export/availability status.
 */
test("processFootprintGeometryValidations persists one validation row and never moves trust state", async () => {
  const pool = createValidationPool();
  setWorkerRepositoryPoolForTests(pool);

  try {
    const storage = buildMemoryStorage({
      "cad/fp/asset-fp-pass.kicad_mod": Buffer.from(SOT23_TWO_PAD_FOOTPRINT),
      "cad/fp/asset-fp-fail.kicad_mod": Buffer.from(PAD_OUTSIDE_ENVELOPE_FOOTPRINT)
    });

    const summary = await processFootprintGeometryValidations(10, storage, new Date("2026-05-13T12:00:00.000Z"));

    const passOutcome = summary.processed.find((row) => row.assetId === "asset-fp-pass");
    const failOutcome = summary.processed.find((row) => row.assetId === "asset-fp-fail");
    assert.ok(passOutcome);
    assert.ok(failOutcome);
    assert.equal(passOutcome.recordedStatus, "verified");
    assert.equal(failOutcome.recordedStatus, "failed");

    const records = await pool.query<{
      id: string;
      asset_id: string;
      validation_status: string;
      validation_type: string;
      validator: string;
    }>(
      `SELECT id, asset_id, validation_status, validation_type, validator
         FROM asset_validation_records
         ORDER BY id ASC`
    );
    assert.equal(records.rows.length, 2);
    assert.deepEqual(records.rows.find((row) => row.asset_id === "asset-fp-pass"), {
      id: "validation:footprint_geometry:asset-fp-pass",
      asset_id: "asset-fp-pass",
      validation_status: "verified",
      validation_type: "footprint_geometry",
      validator: "generated:footprint_geometry_v1"
    });
    assert.deepEqual(records.rows.find((row) => row.asset_id === "asset-fp-fail"), {
      id: "validation:footprint_geometry:asset-fp-fail",
      asset_id: "asset-fp-fail",
      validation_status: "failed",
      validation_type: "footprint_geometry",
      validator: "generated:footprint_geometry_v1"
    });

    // Re-running must upsert into the same row -- historical evidence stays one row per
    // (validator, asset) pair, never duplicates.
    await processFootprintGeometryValidations(10, storage, new Date("2026-05-13T13:00:00.000Z"));
    const second = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM asset_validation_records`
    );
    assert.equal(second.rows[0]?.count, "2");

    // Critically: the asset rows themselves are unchanged. The validator must never
    // promote review_status / export_status / availability_status as a side effect.
    const assetRows = await pool.query<{
      id: string;
      review_status: string;
      export_status: string;
      availability_status: string;
    }>(
      `SELECT id, review_status, export_status, availability_status
         FROM assets WHERE id IN ('asset-fp-pass', 'asset-fp-fail')
         ORDER BY id ASC`
    );
    for (const row of assetRows.rows) {
      assert.equal(row.review_status, "not_reviewed", `${row.id} review_status must stay untouched`);
      assert.equal(row.export_status, "not_exportable", `${row.id} export_status must stay untouched`);
      assert.equal(row.availability_status, "downloaded", `${row.id} availability_status must stay untouched`);
    }
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the symbol validator end-to-end against the seeded high-confidence pin-table
 * signal: a matching parsed pin count surfaces `verified`, an unmatched count surfaces
 * `failed`, and trust state on the asset is never moved.
 */
test("processSymbolPinCountValidations persists evidence rows without moving trust state", async () => {
  const pool = createValidationPool();
  setWorkerRepositoryPoolForTests(pool);

  try {
    const storage = buildMemoryStorage({
      "cad/sym/asset-sym-pass.kicad_sym": Buffer.from(THREE_PIN_SYMBOL),
      "cad/sym/asset-sym-fail.kicad_sym": Buffer.from(`(symbol "x" (pin output line (at 0 0 0) (length 2.54) (name "A") (number "1")))`)
    });

    const summary = await processSymbolPinCountValidations(10, storage, new Date("2026-05-13T12:00:00.000Z"));

    const passOutcome = summary.processed.find((row) => row.assetId === "asset-sym-pass");
    const failOutcome = summary.processed.find((row) => row.assetId === "asset-sym-fail");
    assert.ok(passOutcome);
    assert.ok(failOutcome);
    assert.equal(passOutcome.recordedStatus, "verified");
    assert.equal(failOutcome.recordedStatus, "failed");

    const records = await pool.query<{
      id: string;
      asset_id: string;
      validation_status: string;
      validation_type: string;
      validator: string;
    }>(
      `SELECT id, asset_id, validation_status, validation_type, validator
         FROM asset_validation_records
         ORDER BY id ASC`
    );
    assert.equal(records.rows.length, 2);
    for (const row of records.rows) {
      assert.equal(row.validation_type, "symbol_pin_mapping");
      assert.equal(row.validator, "generated:symbol_pin_mapping_v1");
    }

    const assetRows = await pool.query<{
      id: string;
      review_status: string;
      export_status: string;
    }>(
      `SELECT id, review_status, export_status
         FROM assets WHERE id IN ('asset-sym-pass', 'asset-sym-fail')
         ORDER BY id ASC`
    );
    for (const row of assetRows.rows) {
      assert.equal(row.review_status, "not_reviewed", `${row.id} review_status must stay untouched`);
      assert.equal(row.export_status, "not_exportable", `${row.id} export_status must stay untouched`);
    }
  } finally {
    setWorkerRepositoryPoolForTests(null);
    await pool.end();
  }
});

/**
 * Builds an in-memory storage client mirroring the pattern used by the 3D preview tests.
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
 * Creates a pg-mem pool seeded with parts/packages/assets/source_extraction_signals/
 * asset_validation_records sufficient for the validation jobs to read candidates and
 * upsert evidence. The asset rows are intentionally `not_reviewed` and `not_exportable`
 * so trust-state mutation tests can assert that nothing moves them.
 */
function createValidationPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE manufacturers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      aliases TEXT[] NOT NULL,
      website TEXT
    );
    CREATE TABLE packages (
      id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL,
      pin_count INTEGER,
      pitch_mm NUMERIC,
      body_length_mm NUMERIC,
      body_width_mm NUMERIC,
      body_height_mm NUMERIC
    );
    CREATE TABLE parts (
      id TEXT PRIMARY KEY,
      mpn TEXT NOT NULL,
      manufacturer_id TEXT NOT NULL,
      category TEXT NOT NULL,
      lifecycle_status TEXT NOT NULL,
      package_id TEXT,
      trust_score NUMERIC NOT NULL
    );
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
    CREATE TABLE source_extraction_signals (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      source_record_id TEXT,
      datasheet_revision_id TEXT,
      asset_id TEXT,
      signal_type TEXT NOT NULL,
      extraction_status TEXT NOT NULL,
      confidence_score NUMERIC NOT NULL,
      extraction_source TEXT NOT NULL,
      notes TEXT,
      last_updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE asset_validation_records (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_type TEXT NOT NULL,
      validation_notes TEXT,
      validated_at TIMESTAMPTZ NOT NULL,
      validator TEXT NOT NULL,
      last_updated_at TIMESTAMPTZ NOT NULL
    );

    INSERT INTO manufacturers (id, name, aliases, website) VALUES
      ('mfr-test', 'Test Mfr', '{}', NULL);

    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES
      ('pkg-2pin-3x3', 'SOT-23', 2, 1.27, 3, 3, 1.5);

    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES
      ('part-fp-pass', 'FP-PASS', 'mfr-test', 'IC', 'active', 'pkg-2pin-3x3', 0.5),
      ('part-fp-fail', 'FP-FAIL', 'mfr-test', 'IC', 'active', 'pkg-2pin-3x3', 0.5),
      ('part-sym-pass', 'SYM-PASS', 'mfr-test', 'IC', 'active', 'pkg-2pin-3x3', 0.5),
      ('part-sym-fail', 'SYM-FAIL', 'mfr-test', 'IC', 'active', 'pkg-2pin-3x3', 0.5);

    INSERT INTO assets (
      id, part_id, asset_type, file_format, storage_key, file_hash, provider_id, license_mode, provenance,
      availability_status, review_status, export_status, asset_status, generation_method,
      generation_source_asset_id, validation_status, preview_status, asset_state, source_url, source_record_id,
      last_updated_at
    ) VALUES
      ('asset-fp-pass', 'part-fp-pass', 'footprint', 'kicad_mod', 'cad/fp/asset-fp-pass.kicad_mod',
        NULL, NULL, 'redistribution_allowed', 'manual_internal', 'downloaded', 'not_reviewed',
        'not_exportable', 'downloaded', NULL, NULL, 'not_validated', 'not_available', 'downloaded',
        NULL, NULL, '2026-05-13T00:00:00.000Z'),
      ('asset-fp-fail', 'part-fp-fail', 'footprint', 'kicad_mod', 'cad/fp/asset-fp-fail.kicad_mod',
        NULL, NULL, 'redistribution_allowed', 'manual_internal', 'downloaded', 'not_reviewed',
        'not_exportable', 'downloaded', NULL, NULL, 'not_validated', 'not_available', 'downloaded',
        NULL, NULL, '2026-05-13T00:00:00.000Z'),
      ('asset-sym-pass', 'part-sym-pass', 'symbol', 'kicad_sym', 'cad/sym/asset-sym-pass.kicad_sym',
        NULL, NULL, 'redistribution_allowed', 'manual_internal', 'downloaded', 'not_reviewed',
        'not_exportable', 'downloaded', NULL, NULL, 'not_validated', 'not_available', 'downloaded',
        NULL, NULL, '2026-05-13T00:00:00.000Z'),
      ('asset-sym-fail', 'part-sym-fail', 'symbol', 'kicad_sym', 'cad/sym/asset-sym-fail.kicad_sym',
        NULL, NULL, 'redistribution_allowed', 'manual_internal', 'downloaded', 'not_reviewed',
        'not_exportable', 'downloaded', NULL, NULL, 'not_validated', 'not_available', 'downloaded',
        NULL, NULL, '2026-05-13T00:00:00.000Z');

    -- High-confidence pin-table extraction signals matched to part-sym-pass / part-sym-fail.
    -- The validator parses 'pin_count=N' out of the notes column to compare against the
    -- symbol's parsed pin count. part-sym-pass expects 3 pins (matches THREE_PIN_SYMBOL);
    -- part-sym-fail also expects 3 pins (mismatch against the 1-pin symbol seeded above).
    INSERT INTO source_extraction_signals (
      id, part_id, source_record_id, datasheet_revision_id, asset_id, signal_type,
      extraction_status, confidence_score, extraction_source, notes, last_updated_at
    ) VALUES
      ('sig-sym-pass', 'part-sym-pass', NULL, NULL, NULL, 'pin_table',
        'available', 0.92, 'datasheet_metadata', 'pin_count=3 from datasheet header',
        '2026-05-13T00:00:00.000Z'),
      ('sig-sym-fail', 'part-sym-fail', NULL, NULL, NULL, 'pin_table',
        'available', 0.92, 'datasheet_metadata', 'pin_count=3 from datasheet header',
        '2026-05-13T00:00:00.000Z');
  `);

  const adapter = db.adapters.createPg();
  return new adapter.Pool() as TestPool;
}
