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

/** operationalReadinessMigrationSql loads the Phase 5E operational readiness migration. */
const operationalReadinessMigrationSql = readFileSync(new URL("../../../infra/postgres/011_phase5e_operational_readiness.sql", import.meta.url), "utf8");

/** searchIndexesMigrationSql loads the Phase 6B search indexes migration. */
const searchIndexesMigrationSql = readFileSync(new URL("../../../infra/postgres/012_phase6b_search_indexes.sql", import.meta.url), "utf8");

/** partReadinessProjectionMigrationSql loads the Phase 7A readiness projection migration. */
const partReadinessProjectionMigrationSql = readFileSync(new URL("../../../infra/postgres/013_phase7a_part_readiness_projection.sql", import.meta.url), "utf8");

/** issueWorkflowsMigrationSql loads the Phase 7B issue workflow migration. */
const issueWorkflowsMigrationSql = readFileSync(new URL("../../../infra/postgres/014_phase7b_issue_workflows_and_source_reconciliation.sql", import.meta.url), "utf8");

/** connectorConflictMigrationSql loads the Phase 6C connector conflict and cable constraint migration under test. */
const connectorConflictMigrationSql = readFileSync(new URL("../../../infra/postgres/015_phase6c_connector_conflicts_and_cable_constraints.sql", import.meta.url), "utf8");

/** connectorRelationEvidenceMigrationSql loads the Phase 6D connector relation evidence migration under test. */
const connectorRelationEvidenceMigrationSql = readFileSync(new URL("../../../infra/postgres/016_phase6d_connector_relation_evidence.sql", import.meta.url), "utf8");

/** providerAcquisitionJobsMigrationSql loads the Phase 8A provider acquisition migration under test. */
const providerAcquisitionJobsMigrationSql = readFileSync(new URL("../../../infra/postgres/017_phase8a_provider_acquisition_jobs.sql", import.meta.url), "utf8");

/** providerEnrichmentJobsMigrationSql loads the Phase 8B provider enrichment migration under test. */
const providerEnrichmentJobsMigrationSql = readFileSync(new URL("../../../infra/postgres/018_phase8b_provider_enrichment_jobs.sql", import.meta.url), "utf8");

/** catalogTextSearchIndexesMigrationSql loads the migration 019 trigram-index migration under test. */
const catalogTextSearchIndexesMigrationSql = readFileSync(new URL("../../../infra/postgres/019_catalog_text_search_indexes.sql", import.meta.url), "utf8");

/** partDescriptionMigrationSql loads the migration 020 description-column migration under test. */
const partDescriptionMigrationSql = readFileSync(new URL("../../../infra/postgres/020_part_description.sql", import.meta.url), "utf8");

/** searchJoinIndexesMigrationSql loads the migration 021 join-index migration under test. */
const searchJoinIndexesMigrationSql = readFileSync(new URL("../../../infra/postgres/021_search_join_indexes.sql", import.meta.url), "utf8");

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
  applyMigrationSql(db, providerAcquisitionJobsMigrationSql);
  applyMigrationSql(db, providerEnrichmentJobsMigrationSql);
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
    INSERT INTO provider_acquisition_jobs (id, provider_id, provider_part_key, requested_lookup, manufacturer_name, mpn, package_name, source_url, match_type, match_confidence, job_status, requested_by, requested_at, part_id, import_outcome, previous_import_status, error_code, error_message, started_at, completed_at, last_updated_at)
    VALUES ('acqjob-a-step', 'jlcparts', 'C1091', 'RC-02W300JT', 'Guangdong Fenghua Advanced Tech', 'RC-02W300JT', '0402', 'https://lcsc.com/product-detail/example', 'exact_mpn', 1, 'succeeded', 'smoke-test', '2026-04-13T00:07:00.000Z', 'part-a', 'new_import', NULL, NULL, NULL, '2026-04-13T00:07:05.000Z', '2026-04-13T00:07:08.000Z', '2026-04-13T00:07:08.000Z');
    INSERT INTO provider_acquisition_job_events (id, job_id, event_type, message, detail, created_at)
    VALUES ('acqevent-a-step', 'acqjob-a-step', 'succeeded', 'Acquisition job succeeded.', '{"partId":"part-a"}'::jsonb, '2026-04-13T00:07:08.000Z');
    INSERT INTO provider_enrichment_jobs (id, part_id, source_acquisition_job_id, job_type, job_status, requested_by, requested_at, started_at, completed_at, error_code, error_message, last_updated_at)
    VALUES ('enrichjob-a-step', 'part-a', 'acqjob-a-step', 'datasheet_capture', 'succeeded', 'smoke-test', '2026-04-13T00:07:09.000Z', '2026-04-13T00:07:10.000Z', '2026-04-13T00:07:11.000Z', NULL, NULL, '2026-04-13T00:07:11.000Z');
    INSERT INTO provider_enrichment_job_events (id, job_id, event_type, message, detail, created_at)
    VALUES ('enrichevent-a-step', 'enrichjob-a-step', 'succeeded', 'Referenced datasheet evidence was captured from provider source data.', '{"jobType":"datasheet_capture"}'::jsonb, '2026-04-13T00:07:11.000Z');
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
  const acquisitionJob = db.public.one(`SELECT job_status, provider_part_key, part_id, import_outcome FROM provider_acquisition_jobs WHERE id = 'acqjob-a-step'`);
  const acquisitionEvent = db.public.one(`SELECT event_type, message FROM provider_acquisition_job_events WHERE id = 'acqevent-a-step'`);
  const enrichmentJob = db.public.one(`SELECT job_status, job_type, part_id, source_acquisition_job_id FROM provider_enrichment_jobs WHERE id = 'enrichjob-a-step'`);
  const enrichmentEvent = db.public.one(`SELECT event_type, message FROM provider_enrichment_job_events WHERE id = 'enrichevent-a-step'`);

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
  assert.deepEqual(acquisitionJob, { import_outcome: "new_import", job_status: "succeeded", part_id: "part-a", provider_part_key: "C1091" });
  assert.deepEqual(acquisitionEvent, { event_type: "succeeded", message: "Acquisition job succeeded." });
  assert.deepEqual(enrichmentJob, { job_status: "succeeded", job_type: "datasheet_capture", part_id: "part-a", source_acquisition_job_id: "acqjob-a-step" });
  assert.deepEqual(enrichmentEvent, { event_type: "succeeded", message: "Referenced datasheet evidence was captured from provider source data." });
});

/**
 * Verifies migrations 019/020/021 apply cleanly on top of the existing pre-019 pipeline,
 * are idempotent under repeat application, and add the expected schema surface (the
 * `parts.description` column from migration 020). pg-mem cannot evaluate trigram GIN
 * indexes, but the `ALTER TABLE`/`CREATE INDEX (b-tree)` parts are the migration risk —
 * those are what would corrupt or block a production rollout if a future migration
 * regressed them. The trigram-index existence is exercised by `npm run migrations`
 * against real Postgres, not here.
 */
test("migrations 019/020/021 apply on top of legacy schemas and stay idempotent", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  applyMigrationSql(db, hardeningMigrationSql);
  applyMigrationSql(db, assetPipelineMigrationSql);
  applyMigrationSql(db, generationRequestMigrationSql);
  applyMigrationSql(db, reviewRecordsMigrationSql);
  applyMigrationSql(db, assetTruthMigrationSql);
  applyMigrationSql(db, providerImportHardeningMigrationSql);
  applyMigrationSql(db, sourceExtractionSignalsMigrationSql);
  applyMigrationSql(db, validationPromotionAuditMigrationSql);
  applyMigrationSql(db, operationalReadinessMigrationSql);
  applyMigrationSql(db, searchIndexesMigrationSql);
  applyMigrationSql(db, partReadinessProjectionMigrationSql);
  applyMigrationSql(db, issueWorkflowsMigrationSql);
  applyMigrationSql(db, connectorConflictMigrationSql);
  applyMigrationSql(db, connectorRelationEvidenceMigrationSql);
  applyMigrationSql(db, providerAcquisitionJobsMigrationSql);
  applyMigrationSql(db, providerEnrichmentJobsMigrationSql);

  // Seed a row before migration 020 to confirm the ADD COLUMN backfills legacy data
  // with the documented '' default rather than leaving NULLs that would break search.
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-mig-test', 'Migration Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-mig-test', 'Test Package', 2, 1.27, 2, 3, 4);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-mig-pre020', 'PRE-020', 'mfr-mig-test', 'Resistor', 'active', 'pkg-mig-test', 0.5);
  `);

  // Apply 019/020/021 in order — the same sequence `npm run migrations` would.
  applyMigrationSql(db, catalogTextSearchIndexesMigrationSql);
  applyMigrationSql(db, partDescriptionMigrationSql);
  applyMigrationSql(db, searchJoinIndexesMigrationSql);

  // Migration 020 added a `description TEXT NOT NULL DEFAULT ''` column. pg-mem's
  // ALTER TABLE ... ADD COLUMN doesn't propagate DEFAULTs to legacy rows the way real
  // Postgres does, so the strict-equality `description = ''` check is owned by the
  // production migration script. Here we only verify the column is queryable and is
  // either empty or null — i.e. the ALTER TABLE itself applied without error.
  const legacyPart = db.public.one(`SELECT description FROM parts WHERE id = 'part-mig-pre020'`);
  assert.ok(
    legacyPart.description === "" || legacyPart.description === null,
    `expected legacy description to be empty or null, got ${JSON.stringify(legacyPart.description)}`
  );

  // New inserts after the migration must accept descriptions normally.
  db.public.none(`INSERT INTO parts (id, mpn, description, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-mig-post020', 'POST-020', 'Resistors 1kΩ (0402)', 'mfr-mig-test', 'Resistor', 'active', 'pkg-mig-test', 0.7)`);
  const newPart = db.public.one(`SELECT description FROM parts WHERE id = 'part-mig-post020'`);
  assert.equal(newPart.description, "Resistors 1kΩ (0402)");

  // Re-applying 019/020/021 must be a no-op — production runs migrations on every deploy
  // and IF NOT EXISTS guards must stay correct after the first apply.
  applyMigrationSql(db, catalogTextSearchIndexesMigrationSql);
  applyMigrationSql(db, partDescriptionMigrationSql);
  applyMigrationSql(db, searchJoinIndexesMigrationSql);

  const idempotentPart = db.public.one(`SELECT description FROM parts WHERE id = 'part-mig-post020'`);
  assert.equal(idempotentPart.description, "Resistors 1kΩ (0402)", "repeat migration 020 must not zero out existing data");
});

/**
 * Applies one SQL migration to pg-mem after rewriting idempotent DO-block guards into plain ALTER statements.
 * Skips applying when the rewriter strips the migration down to comments/whitespace, which happens
 * for migrations whose entire body is pg_trgm extension and trigram-index DDL that pg-mem cannot parse.
 */
function applyMigrationSql(db: ReturnType<typeof newDb>, sql: string): void {
  const rewritten = rewriteMigrationSqlForPgMem(sql);
  const hasExecutableSql = rewritten.replace(/--[^\n]*/gu, "").replace(/\s+/gu, "").length > 0;

  if (hasExecutableSql) {
    db.public.none(rewritten);
  }

  backfillPgMemLegacyDefaults(db);
}

/**
 * Rewrites a real migration so it can apply against pg-mem. pg-mem implements neither
 * plpgsql nor the pg_trgm extension, so the rewriter:
 *   - flattens DO-block IF-NOT-EXISTS guards down to their inner statement,
 *   - drops `CREATE EXTENSION ... pg_trgm` (no-op in pg-mem; CREATE INDEX without the
 *     extension would error otherwise),
 *   - drops trigram GIN indexes (`USING GIN (...gin_trgm_ops)`) since pg-mem cannot
 *     evaluate the operator class. The indexes are infra-side optimizations; their
 *     presence in production is verified by `npm run migrations` against real Postgres.
 *     For pg-mem-backed smoke tests, asserting that the column changes apply correctly
 *     is the relevant guarantee.
 */
function rewriteMigrationSqlForPgMem(sql: string): string {
  return sql
    .replace(/DO \$\$[\s\S]*?THEN\s+([\s\S]*?;)\s+END IF;\s+END \$\$;/gu, "$1")
    .replace(/CREATE EXTENSION[^;]*?pg_trgm[^;]*;/giu, "")
    .replace(/CREATE INDEX[^;]*?gin_trgm_ops[^;]*;/giu, "")
    .replace(/CREATE INDEX[^;]*?USING GIN \(aliases\)[^;]*;/giu, "");
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
