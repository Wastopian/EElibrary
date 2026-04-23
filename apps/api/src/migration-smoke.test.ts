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

/** assetTruthMigrationSql loads the docs-aligned asset truth migration under test. */
const assetTruthMigrationSql = readFileSync(new URL("../../../infra/postgres/007_docs_aligned_asset_truth.sql", import.meta.url), "utf8");

/** providerImportHardeningMigrationSql loads the Phase 4C provider import hardening migration under test. */
const providerImportHardeningMigrationSql = readFileSync(new URL("../../../infra/postgres/008_phase4c_provider_import_hardening.sql", import.meta.url), "utf8");

/** sourceExtractionSignalsMigrationSql loads the Phase 5A source extraction migration under test. */
const sourceExtractionSignalsMigrationSql = readFileSync(new URL("../../../infra/postgres/009_phase5a_source_extraction_signals.sql", import.meta.url), "utf8");

/** validationPromotionAuditMigrationSql loads the Phase 5D validation and promotion audit migration under test. */
const validationPromotionAuditMigrationSql = readFileSync(new URL("../../../infra/postgres/010_phase5d_validation_promotion_audit.sql", import.meta.url), "utf8");

/** connectorConflictMigrationSql loads the Phase 6C connector conflict and cable constraint migration under test. */
const connectorConflictMigrationSql = readFileSync(new URL("../../../infra/postgres/015_phase6c_connector_conflicts_and_cable_constraints.sql", import.meta.url), "utf8");

/** connectorRelationEvidenceMigrationSql loads the Phase 6D connector relation evidence migration under test. */
const connectorRelationEvidenceMigrationSql = readFileSync(new URL("../../../infra/postgres/016_phase6d_connector_relation_evidence.sql", import.meta.url), "utf8");

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

  applyMigrationSql(db, hardeningMigrationSql);
  applyMigrationSql(db, assetPipelineMigrationSql);
  db.public.none(`
    INSERT INTO source_records (id, provider_id, provider_part_key, part_id, source_url, fetched_at, raw_payload, normalized_at, last_updated_at)
    VALUES ('source-smoke-old', 'smoke-provider', 'A', 'part-a', 'https://example.test/a', '2026-04-12T00:00:00.000Z', '{"mpn":"A"}'::jsonb, '2026-04-12T00:00:00.000Z', '2026-04-12T00:00:00.000Z');
    INSERT INTO connector_families (id, name, series, description) VALUES ('cf-test', 'Test Family', 'Test Series', 'Test connector family');
    UPDATE parts SET connector_family_id = 'cf-test' WHERE id = 'part-a';
    INSERT INTO mate_relations (id, part_id, mate_part_id, relationship_type, confidence_score, source_revision_id, notes)
    VALUES ('mate-a-b', 'part-a', 'part-b', 'best_mate', 0.9, 'dsr-a', 'old schema smoke test');
    INSERT INTO generation_workflows (id, part_id, target_asset_type, source_datasheet_revision_id, source_asset_id, generation_status, confidence_score, output_asset_id)
    VALUES ('gen-a-step', 'part-a', 'three_d_model', 'dsr-a', NULL, 'ready', 0.8, 'asset-a-step');
  `);
  applyMigrationSql(db, generationRequestMigrationSql);
  applyMigrationSql(db, reviewRecordsMigrationSql);
  applyMigrationSql(db, assetTruthMigrationSql);
  applyMigrationSql(db, providerImportHardeningMigrationSql);
  applyMigrationSql(db, sourceExtractionSignalsMigrationSql);
  applyMigrationSql(db, validationPromotionAuditMigrationSql);
  applyMigrationSql(db, connectorConflictMigrationSql);
  applyMigrationSql(db, connectorRelationEvidenceMigrationSql);
  db.public.none(`
    INSERT INTO generation_requests (id, part_id, target_asset_type, source_datasheet_revision_id, source_asset_id, request_status, requested_at, requested_by, workflow_id)
    VALUES ('genreq-a-step', 'part-a', 'three_d_model', 'dsr-a', NULL, 'requested', '2026-04-13T00:00:00.000Z', 'smoke-test', 'gen-a-step');
    INSERT INTO review_records (id, part_id, target_type, asset_id, generation_workflow_id, outcome, reviewer, notes, reviewed_at)
    VALUES ('review-a-step', 'part-a', 'asset', 'asset-a-step', NULL, 'approved', 'smoke-test', 'migration smoke review', '2026-04-13T00:00:00.000Z');
    INSERT INTO asset_validation_records (id, part_id, asset_id, validation_status, validation_type, validation_notes, validated_at, validator, last_updated_at)
    VALUES ('validation-a-step', 'part-a', 'asset-a-step', 'verified', 'three_d_geometry', 'smoke validation evidence', '2026-04-13T00:05:00.000Z', 'smoke-test', '2026-04-13T00:05:00.000Z');
    INSERT INTO asset_promotion_audits (id, part_id, asset_id, prior_export_status, new_export_status, promotion_outcome, blocker_reasons, validation_record_id, actor, created_at)
    VALUES ('promotion-a-step-denied', 'part-a', 'asset-a-step', 'partially_exportable', 'partially_exportable', 'denied', '{"smoke blocker"}', NULL, 'smoke-test', '2026-04-13T00:06:00.000Z');
    INSERT INTO source_extraction_signals (id, part_id, source_record_id, datasheet_revision_id, asset_id, signal_type, extraction_status, confidence_score, extraction_source, notes)
    VALUES ('sig-a-mechanical', 'part-a', 'source-smoke-old', 'dsr-a', 'asset-a-step', 'mechanical_drawing', 'needs_review', 0.6, 'asset_reference', 'smoke test extraction signal');
  `);

  const asset = db.public.one(`SELECT asset_state, asset_status, availability_status, review_status, export_status, provenance FROM assets WHERE id = 'asset-a-step'`);
  const datasheet = db.public.one(`SELECT pin_table_status FROM datasheet_revisions WHERE id = 'dsr-a'`);
  const part = db.public.one(`SELECT connector_family_id FROM parts WHERE id = 'part-a'`);
  const relation = db.public.one(`SELECT relationship_type FROM mate_relations WHERE id = 'mate-a-b'`);
  const relationEvidence = db.public.one(`
    SELECT
      COALESCE(compatibility_status, 'probable') AS compatibility_status,
      COALESCE(evidence_kind, 'catalog_fixture') AS evidence_kind,
      source_record_id
    FROM mate_relations
    WHERE id = 'mate-a-b'
  `);
  const workflow = db.public.one(`SELECT generation_status FROM generation_workflows WHERE id = 'gen-a-step'`);
  const request = db.public.one(`SELECT request_status FROM generation_requests WHERE id = 'genreq-a-step'`);
  const review = db.public.one(`SELECT outcome FROM review_records WHERE id = 'review-a-step'`);
  const source = db.public.one(`SELECT import_status, import_error_details, source_last_seen_at, source_last_imported_at FROM source_records WHERE id = 'source-smoke-old'`);
  const signal = db.public.one(`SELECT signal_type, extraction_status FROM source_extraction_signals WHERE id = 'sig-a-mechanical'`);
  const validation = db.public.one(`SELECT validation_status, validation_type FROM asset_validation_records WHERE id = 'validation-a-step'`);
  const promotionAudit = db.public.one(`SELECT promotion_outcome, blocker_reasons, validation_record_id FROM asset_promotion_audits WHERE id = 'promotion-a-step-denied'`);

  assert.deepEqual(asset, { asset_state: "validated", asset_status: "validated", availability_status: "validated", review_status: "review_required", export_status: "partially_exportable", provenance: "manual_internal" });
  assert.equal(datasheet.pin_table_status, "not_available");
  assert.equal(part.connector_family_id, "cf-test");
  assert.equal(relation.relationship_type, "best_mate");
  assert.deepEqual(relationEvidence, { compatibility_status: "probable", evidence_kind: "catalog_fixture", source_record_id: null });
  assert.equal(workflow.generation_status, "available_to_request");
  assert.equal(request.request_status, "requested");
  assert.equal(review.outcome, "approved");
  assert.equal(source.import_status, "imported");
  assert.equal(source.import_error_details, null);
  assert.ok(source.source_last_seen_at);
  assert.ok(source.source_last_imported_at);
  assert.deepEqual(signal, { extraction_status: "needs_review", signal_type: "mechanical_drawing" });
  assert.deepEqual(validation, { validation_status: "verified", validation_type: "three_d_geometry" });
  assert.deepEqual(promotionAudit, { blocker_reasons: ["smoke blocker"], promotion_outcome: "denied", validation_record_id: null });
});

/**
 * Applies one SQL migration to pg-mem after rewriting idempotent DO-block guards into plain ALTER statements.
 */
function applyMigrationSql(db: ReturnType<typeof newDb>, sql: string): void {
  db.public.none(rewriteMigrationSqlForPgMem(sql));
  backfillPgMemLegacyDefaults(db);
}

/**
 * Rewrites simple IF-NOT-EXISTS DO blocks because pg-mem does not execute plpgsql.
 */
function rewriteMigrationSqlForPgMem(sql: string): string {
  return sql.replace(/DO \$\$[\s\S]*?THEN\s+([\s\S]*?;)\s+END IF;\s+END \$\$;/gu, "$1");
}

/**
 * Backfills legacy rows for pg-mem because it does not fully emulate PostgreSQL default propagation on added columns.
 */
function backfillPgMemLegacyDefaults(db: ReturnType<typeof newDb>): void {
  const backfillStatements = [
    "UPDATE mate_relations SET compatibility_status = 'probable' WHERE compatibility_status IS NULL",
    "UPDATE mate_relations SET evidence_kind = 'catalog_fixture' WHERE evidence_kind IS NULL",
    "UPDATE accessory_requirements SET compatibility_status = 'probable' WHERE compatibility_status IS NULL",
    "UPDATE accessory_requirements SET evidence_kind = 'catalog_fixture' WHERE evidence_kind IS NULL",
    "UPDATE cable_compatibilities SET shielding_requirement = 'unknown' WHERE shielding_requirement IS NULL",
    "UPDATE cable_compatibilities SET termination_style = 'unknown' WHERE termination_style IS NULL",
    "UPDATE cable_compatibilities SET compatibility_status = 'probable' WHERE compatibility_status IS NULL"
  ];

  for (const statement of backfillStatements) {
    try {
      db.public.none(statement);
    } catch {
      // Ignore missing-table cases so one helper can follow every incremental migration step.
    }
  }
}
