/**
 * File header: Smoke-tests incremental SQL migration safety against an old schema simulation.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { newDb } from "pg-mem";

/** hardeningMigrationSql loads the real incremental migration under test. */
const hardeningMigrationSql = readFileSync(new URL("../../../infra/postgres/003_connector_intelligence_hardening.sql", import.meta.url), "utf8");

/** assetPipelineMigrationSql loads the Phase 3A asset lookup migration under test. */
const assetPipelineMigrationSql = readFileSync(new URL("../../../infra/postgres/004_phase3a_asset_pipeline.sql", import.meta.url), "utf8");

/** generationRequestMigrationSql loads the Phase 3B generation request migration under test. */
const generationRequestMigrationSql = readFileSync(new URL("../../../infra/postgres/005_phase3b_generation_requests.sql", import.meta.url), "utf8");

/** reviewRecordsMigrationSql loads the Phase 4A review record migration under test. */
const reviewRecordsMigrationSql = readFileSync(new URL("../../../infra/postgres/006_phase4a_review_records.sql", import.meta.url), "utf8");

/** oldPhase2SchemaSql models a database created before connector hardening columns and tables existed. */
const oldPhase2SchemaSql = `
  CREATE TABLE manufacturers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}',
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
    manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id),
    category TEXT NOT NULL,
    lifecycle_status TEXT NOT NULL,
    package_id TEXT NOT NULL REFERENCES packages(id),
    trust_score NUMERIC NOT NULL CHECK (trust_score >= 0 AND trust_score <= 1),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (manufacturer_id, mpn)
  );

  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    part_id TEXT NOT NULL REFERENCES parts(id),
    asset_type TEXT NOT NULL,
    file_format TEXT NOT NULL,
    storage_key TEXT,
    file_hash TEXT,
    provider_id TEXT,
    license_mode TEXT NOT NULL,
    validation_status TEXT NOT NULL,
    preview_status TEXT NOT NULL,
    asset_state TEXT NOT NULL DEFAULT 'missing',
    source_url TEXT,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE datasheet_revisions (
    id TEXT PRIMARY KEY,
    part_id TEXT NOT NULL REFERENCES parts(id),
    revision_label TEXT NOT NULL,
    revision_date DATE,
    page_count INTEGER,
    file_asset_id TEXT REFERENCES assets(id),
    parse_confidence NUMERIC NOT NULL CHECK (parse_confidence >= 0 AND parse_confidence <= 1),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE part_metrics (
    id TEXT PRIMARY KEY,
    part_id TEXT NOT NULL REFERENCES parts(id),
    metric_key TEXT NOT NULL,
    metric_value NUMERIC,
    unit TEXT NOT NULL,
    min_value NUMERIC,
    max_value NUMERIC,
    confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    source_revision_id TEXT NOT NULL REFERENCES datasheet_revisions(id),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (part_id, metric_key, source_revision_id)
  );
`;

/**
 * Verifies the hardening migration upgrades old schemas and preserves conservative asset trust.
 */
test("connector hardening migration upgrades old schemas safely", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-test', 'Test Manufacturer', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-test', 'Test Package', 2, 1.27, 2, 3, 4);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-a', 'A', 'mfr-test', 'Connector', 'active', 'pkg-test', 0.8);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-b', 'B', 'mfr-test', 'Connector', 'active', 'pkg-test', 0.8);
    INSERT INTO assets (id, part_id, asset_type, file_format, storage_key, file_hash, provider_id, license_mode, validation_status, preview_status)
    VALUES ('asset-a-step', 'part-a', 'three_d_model', 'step', 'cad/a.step', 'sha256:a', 'old-provider', 'redistribution_allowed', 'verified', 'ready');
    INSERT INTO datasheet_revisions (id, part_id, revision_label, revision_date, page_count, file_asset_id, parse_confidence)
    VALUES ('dsr-a', 'part-a', 'Rev A', '2026-01-01', 1, 'asset-a-step', 0.8);
  `);

  db.public.none(hardeningMigrationSql);
  db.public.none(assetPipelineMigrationSql);
  db.public.none(`
    INSERT INTO connector_families (id, name, series, description) VALUES ('cf-test', 'Test Family', 'Test Series', 'Test connector family');
    UPDATE parts SET connector_family_id = 'cf-test' WHERE id = 'part-a';
    INSERT INTO mate_relations (id, part_id, mate_part_id, relationship_type, confidence_score, source_revision_id, notes)
    VALUES ('mate-a-b', 'part-a', 'part-b', 'best_mate', 0.9, 'dsr-a', 'old schema smoke test');
    INSERT INTO generation_workflows (id, part_id, target_asset_type, source_datasheet_revision_id, source_asset_id, generation_status, confidence_score, output_asset_id)
    VALUES ('gen-a-step', 'part-a', 'three_d_model', 'dsr-a', NULL, 'ready', 0.8, 'asset-a-step');
  `);
  db.public.none(generationRequestMigrationSql);
  db.public.none(reviewRecordsMigrationSql);
  db.public.none(`
    INSERT INTO generation_requests (id, part_id, target_asset_type, source_datasheet_revision_id, source_asset_id, request_status, requested_at, requested_by, workflow_id)
    VALUES ('genreq-a-step', 'part-a', 'three_d_model', 'dsr-a', NULL, 'requested', '2026-04-13T00:00:00.000Z', 'smoke-test', 'gen-a-step');
    INSERT INTO review_records (id, part_id, target_type, asset_id, generation_workflow_id, outcome, reviewer, notes, reviewed_at)
    VALUES ('review-a-step', 'part-a', 'asset', 'asset-a-step', NULL, 'approved', 'smoke-test', 'migration smoke review', '2026-04-13T00:00:00.000Z');
  `);

  const asset = db.public.one(`SELECT asset_state, asset_status, provenance FROM assets WHERE id = 'asset-a-step'`);
  const datasheet = db.public.one(`SELECT pin_table_status FROM datasheet_revisions WHERE id = 'dsr-a'`);
  const part = db.public.one(`SELECT connector_family_id FROM parts WHERE id = 'part-a'`);
  const relation = db.public.one(`SELECT relationship_type FROM mate_relations WHERE id = 'mate-a-b'`);
  const workflow = db.public.one(`SELECT generation_status FROM generation_workflows WHERE id = 'gen-a-step'`);
  const request = db.public.one(`SELECT request_status FROM generation_requests WHERE id = 'genreq-a-step'`);
  const review = db.public.one(`SELECT outcome FROM review_records WHERE id = 'review-a-step'`);

  assert.deepEqual(asset, { asset_state: "validated", asset_status: "validated", provenance: "manual_internal" });
  assert.equal(datasheet.pin_table_status, "not_available");
  assert.equal(part.connector_family_id, "cf-test");
  assert.equal(relation.relationship_type, "best_mate");
  assert.equal(workflow.generation_status, "available_to_request");
  assert.equal(request.request_status, "requested");
  assert.equal(review.outcome, "approved");
});
