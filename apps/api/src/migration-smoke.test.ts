/**
 * File header: Smoke-tests incremental SQL migration safety against an old schema simulation.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DataType, newDb } from "pg-mem";

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

/** projectBomMemoryMigrationSql loads the migration 024 project and BOM memory migration under test. */
const projectBomMemoryMigrationSql = readFileSync(new URL("../../../infra/postgres/024_project_bom_memory.sql", import.meta.url), "utf8");

/** projectHealthEvidenceMigrationSql loads the migration 025 project evidence migration under test. */
const projectHealthEvidenceMigrationSql = readFileSync(new URL("../../../infra/postgres/025_project_health_evidence.sql", import.meta.url), "utf8");

/** circuitBlocksMigrationSql loads the migration 026 circuit block migration under test. */
const circuitBlocksMigrationSql = readFileSync(new URL("../../../infra/postgres/026_circuit_blocks.sql", import.meta.url), "utf8");

/** followUpRecordsMigrationSql loads the migration 027 follow-up records migration under test. */
const followUpRecordsMigrationSql = readFileSync(new URL("../../../infra/postgres/027_follow_up_records.sql", import.meta.url), "utf8");

/** supplyOfferingsMigrationSql loads the migration 036 supply offering snapshot migration under test. */
const supplyOfferingsMigrationSql = readFileSync(new URL("../../../infra/postgres/036_supply_offerings.sql", import.meta.url), "utf8");

/** supplyOfferSupplierRefreshMigrationSql loads the migration 037 supplier and retirement metadata migration. */
const supplyOfferSupplierRefreshMigrationSql = readFileSync(new URL("../../../infra/postgres/037_supply_offer_supplier_refresh.sql", import.meta.url), "utf8");

/** circuitBlockKnownRisksMigrationSql loads the migration 038 known-risk memory migration under test. */
const circuitBlockKnownRisksMigrationSql = readFileSync(new URL("../../../infra/postgres/038_circuit_block_known_risks.sql", import.meta.url), "utf8");

/** exportBundleCryptographicProvenanceMigrationSql loads the migration 039 archive-hash + signature migration under test. */
const exportBundleCryptographicProvenanceMigrationSql = readFileSync(new URL("../../../infra/postgres/039_export_bundle_cryptographic_provenance.sql", import.meta.url), "utf8");

/** assetPreviewArtifactsMigrationSql loads the migration 040 derived-preview-artifact columns under test. */
const assetPreviewArtifactsMigrationSql = readFileSync(new URL("../../../infra/postgres/040_asset_preview_artifacts.sql", import.meta.url), "utf8");

/** partEngineeringRecordsMigrationSql loads the migration 041 part engineering-memory migration under test. */
const partEngineeringRecordsMigrationSql = readFileSync(new URL("../../../infra/postgres/041_part_engineering_records.sql", import.meta.url), "utf8");

/** partEngineeringRecordDraftsMigrationSql loads the migration 042 passive-capture draft migration under test. */
const partEngineeringRecordDraftsMigrationSql = readFileSync(new URL("../../../infra/postgres/042_part_engineering_record_drafts.sql", import.meta.url), "utf8");

/** scaleIndexesMigrationSql loads the migration 043 pure-additive scale indexes under test. */
const scaleIndexesMigrationSql = readFileSync(new URL("../../../infra/postgres/043_scale_indexes.sql", import.meta.url), "utf8");

/** interconnectMemoryMigrationSql loads the migration 044 cable and fixture memory tables under test. */
const interconnectMemoryMigrationSql = readFileSync(new URL("../../../infra/postgres/044_interconnect_memory.sql", import.meta.url), "utf8");

/** projectDocumentExtractionsMigrationSql loads migration 045 background document reading under test. */
const projectDocumentExtractionsMigrationSql = readFileSync(new URL("../../../infra/postgres/045_project_document_extractions.sql", import.meta.url), "utf8");

/** projectDocumentExtractionPreviewsMigrationSql loads migration 046 compact source previews under test. */
const projectDocumentExtractionPreviewsMigrationSql = readFileSync(new URL("../../../infra/postgres/046_project_document_extraction_previews.sql", import.meta.url), "utf8");

/** exportBundlesMigrationSql loads the original migration 028 export-bundles table under test. */
const exportBundlesMigrationSql = readFileSync(new URL("../../../infra/postgres/028_export_bundles.sql", import.meta.url), "utf8");

/** exportBundleAssemblyMigrationSql loads the migration 031 worker-assembly columns under test. */
const exportBundleAssemblyMigrationSql = readFileSync(new URL("../../../infra/postgres/031_export_bundle_assembly.sql", import.meta.url), "utf8");

/** exportBundleArchiveKeyMigrationSql loads the migration 032 archive_storage_key migration under test. */
const exportBundleArchiveKeyMigrationSql = readFileSync(new URL("../../../infra/postgres/032_export_bundle_archive_key.sql", import.meta.url), "utf8");

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
 * Verifies the project/BOM memory migration creates durable project, BOM row,
 * and confirmed-usage tables while keeping weak rows out of usage history.
 */
test("project/BOM memory migration preserves row truth and confirmed usage only", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-memory', 'Memory Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-memory', 'SOT-23-5', 5, 0.95, 2.9, 1.6, 1.1);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-memory-ldo', 'TPS7A02DBVR', 'mfr-memory', 'Power management', 'active', 'pkg-memory', 0.8);
  `);

  applyMigrationSql(db, projectBomMemoryMigrationSql);

  db.public.none(`
    INSERT INTO projects (id, project_key, name, description, owner, status)
    VALUES ('project-alpha', 'ALPHA', 'Alpha Controller', 'Memory migration smoke project', 'hardware', 'active');

    INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference)
    VALUES ('rev-alpha-a', 'project-alpha', 'A', 'draft', 'alpha-a');

    INSERT INTO bom_imports (id, project_id, project_revision_id, source_filename, source_format, import_status, column_mapping, import_summary, imported_by)
    VALUES (
      'bom-alpha-a',
      'project-alpha',
      'rev-alpha-a',
      'alpha-bom.csv',
      'csv',
      'mapped',
      '{"mpn":"Manufacturer Part Number","quantity":"Qty"}'::jsonb,
      '{"rowCount":2}'::jsonb,
      'smoke-test'
    );

    INSERT INTO bom_lines (
      id,
      bom_import_id,
      project_id,
      project_revision_id,
      row_number,
      designators,
      quantity,
      raw_mpn,
      raw_manufacturer,
      raw_description,
      raw_row_payload,
      matched_part_id,
      match_status,
      match_confidence_score
    )
    VALUES
      ('line-alpha-1', 'bom-alpha-a', 'project-alpha', 'rev-alpha-a', 1, '{"U1"}', 1, 'TPS7A02DBVR', 'Texas Instruments', 'LDO regulator', '{"row":1}'::jsonb, 'part-memory-ldo', 'matched', 1),
      ('line-alpha-2', 'bom-alpha-a', 'project-alpha', 'rev-alpha-a', 2, '{"R1"}', 1, 'RC-UNKNOWN', 'Unknown', 'Weak resistor row', '{"row":2}'::jsonb, NULL, 'weak_match', 0.4);

    INSERT INTO project_part_usages (
      id,
      project_id,
      project_revision_id,
      bom_line_id,
      part_id,
      usage_context,
      designators,
      quantity,
      usage_status,
      approval_snapshot,
      readiness_snapshot
    )
    VALUES (
      'usage-alpha-u1',
      'project-alpha',
      'rev-alpha-a',
      'line-alpha-1',
      'part-memory-ldo',
      'Main rail regulator',
      '{"U1"}',
      1,
      'proposed',
      '{"approvalStatus":"not_requested"}'::jsonb,
      '{"readinessStatus":"blocked"}'::jsonb
    );
  `);

  const lineCounts = db.public.one(`
    SELECT
      COUNT(*)::int AS total_lines,
      SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END)::int AS matched_lines,
      SUM(CASE WHEN match_status = 'weak_match' THEN 1 ELSE 0 END)::int AS weak_lines
    FROM bom_lines
  `);
  const usage = db.public.one(`
    SELECT
      p.project_key,
      pr.revision_label,
      u.part_id,
      u.designators,
      u.usage_status
    FROM project_part_usages u
    JOIN projects p ON p.id = u.project_id
    JOIN project_revisions pr ON pr.id = u.project_revision_id
    WHERE u.id = 'usage-alpha-u1'
  `);

  assert.deepEqual(lineCounts, { matched_lines: 1, total_lines: 2, weak_lines: 1 });
  assert.deepEqual(usage, {
    designators: ["U1"],
    part_id: "part-memory-ldo",
    project_key: "ALPHA",
    revision_label: "A",
    usage_status: "proposed",
  });

  assert.throws(
    () => db.public.none(`INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, match_status) VALUES ('line-bad-status', 'bom-alpha-a', 'project-alpha', 'rev-alpha-a', 3, 'confirmed_guess')`),
    /check/i
  );

  assert.match(projectBomMemoryMigrationSql, /CREATE TABLE IF NOT EXISTS projects/u);
  assert.match(projectBomMemoryMigrationSql, /CREATE TABLE IF NOT EXISTS project_revisions/u);
  assert.match(projectBomMemoryMigrationSql, /CREATE TABLE IF NOT EXISTS bom_imports/u);
  assert.match(projectBomMemoryMigrationSql, /CREATE TABLE IF NOT EXISTS bom_lines/u);
  assert.match(projectBomMemoryMigrationSql, /CREATE TABLE IF NOT EXISTS project_part_usages/u);
  assert.match(projectBomMemoryMigrationSql, /CREATE INDEX IF NOT EXISTS idx_project_part_usages_part/u);

  const idempotentUsageCount = db.public.one(`SELECT COUNT(*)::int AS usage_count FROM project_part_usages`);
  assert.equal(idempotentUsageCount.usage_count, 1);
});

/**
 * Verifies evidence attachment migration stores metadata without approval/export side effects.
 */
test("project health evidence migration preserves attachment metadata and review state", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  applyMigrationSql(db, projectBomMemoryMigrationSql);
  applyMigrationSql(db, projectHealthEvidenceMigrationSql);

  db.public.none(`
    INSERT INTO evidence_attachments (id, target_type, target_id, evidence_type, title, source_url, provenance, review_status, uploaded_by)
    VALUES ('evidence-alpha-link', 'project', 'project-alpha', 'link', 'Design review', 'https://example.test/review', 'manual_internal', 'unreviewed', 'smoke-test');
  `);

  const evidence = db.public.one(`SELECT target_type, evidence_type, title, source_url, review_status FROM evidence_attachments WHERE id = 'evidence-alpha-link'`);

  assert.deepEqual(evidence, {
    evidence_type: "link",
    review_status: "unreviewed",
    source_url: "https://example.test/review",
    target_type: "project",
    title: "Design review",
  });
  assert.throws(
    () => db.public.none(`INSERT INTO evidence_attachments (id, target_type, target_id, evidence_type, title) VALUES ('evidence-bad', 'project', 'project-alpha', 'link', 'Missing URL')`),
    /check/i
  );
  assert.match(projectHealthEvidenceMigrationSql, /CREATE TABLE IF NOT EXISTS evidence_attachments/u);
});

/**
 * Verifies circuit block migration stores reusable block roles and circuit evidence targets.
 */
test("circuit block migration preserves reusable part roles and evidence targets", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-memory', 'Memory Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-memory', 'SOT-23-5', 5, 0.95, 2.9, 1.6, 1.1);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-memory-ldo', 'TPS7A02DBVR', 'mfr-memory', 'Power management', 'active', 'pkg-memory', 0.8);
  `);
  applyMigrationSql(db, projectBomMemoryMigrationSql);
  applyMigrationSql(db, projectHealthEvidenceMigrationSql);
  applyMigrationSql(db, circuitBlocksMigrationSql);

  db.public.none(`
    INSERT INTO circuit_blocks (id, block_key, name, description, block_type, owner, status, reuse_scope, constraints)
    VALUES ('cblock-power', 'POWER-LDO', 'LDO rail', 'Reusable regulator rail.', 'power', 'hardware', 'approved', 'Sensor boards', '{"vin":"5V"}'::jsonb);

    INSERT INTO circuit_block_parts (id, circuit_block_id, part_id, role, quantity, is_required, substitution_policy, notes)
    VALUES ('cbpart-power-ldo', 'cblock-power', 'part-memory-ldo', 'Main regulator', 1, true, 'exact_required', 'Keep close to load.');

    INSERT INTO evidence_attachments (id, target_type, target_id, evidence_type, title, source_url)
    VALUES ('evidence-cblock-review', 'circuit_block', 'cblock-power', 'link', 'Circuit review', 'https://example.test/circuit-review');
  `);

  const role = db.public.one(`
    SELECT
      cb.block_key,
      cb.status,
      cbp.role,
      cbp.is_required,
      cbp.substitution_policy
    FROM circuit_block_parts cbp
    JOIN circuit_blocks cb ON cb.id = cbp.circuit_block_id
    WHERE cbp.id = 'cbpart-power-ldo'
  `);
  const evidence = db.public.one(`SELECT target_type, title FROM evidence_attachments WHERE id = 'evidence-cblock-review'`);

  assert.deepEqual(role, {
    block_key: "POWER-LDO",
    is_required: true,
    role: "Main regulator",
    status: "approved",
    substitution_policy: "exact_required",
  });
  assert.deepEqual(evidence, {
    target_type: "circuit_block",
    title: "Circuit review",
  });
  assert.throws(
    () => db.public.none(`INSERT INTO circuit_block_parts (id, circuit_block_id, part_id, role, quantity) VALUES ('cbpart-bad', 'cblock-power', 'part-memory-ldo', 'Bad quantity', 0)`),
    /check/i
  );
  assert.match(circuitBlocksMigrationSql, /CREATE TABLE IF NOT EXISTS circuit_blocks/u);
  assert.match(circuitBlocksMigrationSql, /CREATE TABLE IF NOT EXISTS circuit_block_parts/u);
});

/**
 * Verifies migration 039 layers cleanly on top of the existing export-bundle columns and
 * preserves the honesty discipline that an unsigned bundle stays `unsigned`. Specifically:
 *
 *   - `archive_sha256` and `manifest_sha256` add as nullable text columns so legacy assembled
 *     bundles survive the migration without a backfill (they read as null and the API surface
 *     reports them as "not recorded" instead of inventing a hash).
 *   - `signature_status` defaults to `'unsigned'` (NOT NULL) so a freshly-inserted bundle row
 *     can never claim verified state without explicit signing path action.
 *   - The new CHECK constraint accepts only the three documented values so a corrupted column
 *     write fails loudly rather than letting the UI render an unknown state as verified.
 *   - The migration is idempotent under repeat application (production runs migrations on
 *     every deploy and `IF NOT EXISTS` guards must stay correct after the first apply).
 */
test("export bundle cryptographic provenance migration adds nullable hashes and a CHECK-guarded signature status", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  applyMigrationSql(db, projectBomMemoryMigrationSql);
  applyMigrationSql(db, exportBundlesMigrationSql);
  applyMigrationSql(db, exportBundleAssemblyMigrationSql);
  applyMigrationSql(db, exportBundleArchiveKeyMigrationSql);

  // Seed a legacy bundle row before migration 039 so the ADD COLUMNs get exercised against
  // existing rows the same way they would in production.
  db.public.none(`
    INSERT INTO projects (id, project_key, name, description, owner, status)
    VALUES ('project-bundle', 'BUNDLE', 'Bundle Project', 'Crypto provenance smoke test', 'hardware', 'active');

    INSERT INTO export_bundles (id, project_id, bundle_format, manifest, part_count, included_asset_count, omitted_asset_count, warning_count)
    VALUES ('ebundle-legacy', 'project-bundle', 'neutral', '{"includedAssets":[]}'::jsonb, 0, 0, 0, 0);
  `);

  applyMigrationSql(db, exportBundleCryptographicProvenanceMigrationSql);

  // Legacy row should expose the new columns as readable (hashes default to null, which is the
  // honest "not recorded" state the API surface must report). pg-mem does not backfill NOT
  // NULL DEFAULT on ADD COLUMN the way real Postgres does, so we check the column shape rather
  // than asserting the default on a pre-existing row -- the API store's
  // normalizeExportBundleSignatureStatus helper is responsible for treating the unknown raw
  // value as `unsigned`.
  const legacy = db.public.one(`
    SELECT archive_sha256, manifest_sha256, signature_algorithm, signature_storage_key
    FROM export_bundles WHERE id = 'ebundle-legacy'
  `);
  assert.deepEqual(legacy, {
    archive_sha256: null,
    manifest_sha256: null,
    signature_algorithm: null,
    signature_storage_key: null
  });

  // A bundle inserted AFTER migration 039 with no explicit signature_status must take the
  // documented `'unsigned'` default. This is the contract that protects the UI from rendering
  // an absent signature as audit-grade.
  db.public.none(`
    INSERT INTO export_bundles (
      id, project_id, bundle_format, manifest, part_count, included_asset_count, omitted_asset_count, warning_count
    )
    VALUES (
      'ebundle-fresh', 'project-bundle', 'neutral', '{"includedAssets":[]}'::jsonb, 0, 0, 0, 0
    )
  `);
  const fresh = db.public.one(`SELECT signature_status FROM export_bundles WHERE id = 'ebundle-fresh'`);
  assert.deepEqual(fresh, { signature_status: "unsigned" });

  // A newly-assembled-and-signed bundle should be storable with the documented `signed` value
  // and the matching algorithm/fingerprint columns.
  db.public.none(`
    INSERT INTO export_bundles (
      id, project_id, bundle_format, manifest, part_count, included_asset_count, omitted_asset_count, warning_count,
      assembly_status, archive_sha256, manifest_sha256,
      signature_status, signature_algorithm, signature_public_key_fingerprint, signature_storage_key, signature_signed_at
    )
    VALUES (
      'ebundle-signed', 'project-bundle', 'neutral', '{"includedAssets":[]}'::jsonb, 0, 0, 0, 0,
      'assembled',
      'a'::text, 'b'::text,
      'signed', 'ed25519', 'fp-deadbeef', 'export-bundles/project-bundle/ebundle-signed/bundle.tar.gz.sig', '2026-05-13T12:00:00.000Z'
    )
  `);
  const signed = db.public.one(`SELECT signature_status, signature_algorithm FROM export_bundles WHERE id = 'ebundle-signed'`);
  assert.deepEqual(signed, { signature_algorithm: "ed25519", signature_status: "signed" });

  // The CHECK constraint must reject any value outside the three documented states. An attacker
  // (or a buggy writer) inserting `verified` would otherwise let the UI render unverified
  // bytes as audit-grade, which is exactly the failure mode this column exists to prevent.
  assert.throws(
    () => db.public.none(`
      INSERT INTO export_bundles (
        id, project_id, bundle_format, manifest, part_count, included_asset_count, omitted_asset_count, warning_count,
        signature_status
      )
      VALUES (
        'ebundle-invalid-status', 'project-bundle', 'neutral', '{"includedAssets":[]}'::jsonb, 0, 0, 0, 0,
        'verified'
      )
    `),
    /check/i
  );

  // Re-applying 039 must be a no-op — production runs migrations on every deploy and the
  // ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS guards must stay correct after the
  // first apply. We exercise idempotency on a fresh pg-mem instance because pg-mem's CREATE
  // CONSTRAINT semantics differ from Postgres' (it raises on the second add); the production
  // migration uses DROP-then-ADD so it is safe to replay.
  const replayDb = newDb();
  replayDb.public.none(oldPhase2SchemaSql);
  applyMigrationSql(replayDb, projectBomMemoryMigrationSql);
  applyMigrationSql(replayDb, exportBundlesMigrationSql);
  applyMigrationSql(replayDb, exportBundleAssemblyMigrationSql);
  applyMigrationSql(replayDb, exportBundleArchiveKeyMigrationSql);
  applyMigrationSql(replayDb, exportBundleCryptographicProvenanceMigrationSql);
  applyMigrationSql(replayDb, exportBundleCryptographicProvenanceMigrationSql);

  assert.match(exportBundleCryptographicProvenanceMigrationSql, /ADD COLUMN IF NOT EXISTS archive_sha256/u);
  assert.match(exportBundleCryptographicProvenanceMigrationSql, /ADD COLUMN IF NOT EXISTS signature_status/u);
  assert.match(exportBundleCryptographicProvenanceMigrationSql, /export_bundles_signature_status_check/u);
});

/**
 * Verifies the asset preview-artifact migration adds nullable derived-bytes columns and rejects
 * undocumented artifact formats / sources via CHECK constraints.
 *
 * The constraint enforcement is exactly what protects the inline previewer from rendering bytes
 * the browser cannot understand: only formats explicitly listed in the constraint may land in
 * the preview channel, so a misconfigured writer cannot smuggle a STEP file into the path the
 * UI treats as "ready to render."
 */
test("asset preview artifact migration adds nullable artifact channel with format and source guards", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  applyMigrationSql(db, assetPreviewArtifactsMigrationSql);

  // Seed a part + asset row so we exercise INSERT and the CHECK constraints behave under real data.
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website)
      VALUES ('mfr-preview', 'Preview Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm)
      VALUES ('pkg-preview', 'SO-8', 8, 1.27, 5.0, 4.0, 1.5);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score)
      VALUES ('part-preview', 'PREVIEW-1', 'mfr-preview', 'IC', 'active', 'pkg-preview', 0.9);

    INSERT INTO assets (
      id, part_id, asset_type, file_format, storage_key, file_hash, provider_id, license_mode,
      validation_status, preview_status
    )
    VALUES (
      'asset-preview-step', 'part-preview', 'three_d_model', 'step', 'cad/preview/model.step', NULL, NULL,
      'redistribution_allowed', 'needs_review', 'pending'
    );
  `);

  // Default state: a freshly migrated row exposes the artifact channel as null in every column.
  const beforeArtifact = db.public.one(`
    SELECT preview_artifact_storage_key, preview_artifact_format, preview_artifact_source
    FROM assets WHERE id = 'asset-preview-step'
  `);
  assert.deepEqual(beforeArtifact, {
    preview_artifact_storage_key: null,
    preview_artifact_format: null,
    preview_artifact_source: null
  });

  // A converter writing a real glTF artifact should be storable with the documented format /
  // source pair so the read path can render the derived bytes inline.
  db.public.none(`
    UPDATE assets
    SET preview_artifact_storage_key = 'cad/preview/model.glb',
        preview_artifact_format = 'glb',
        preview_artifact_source = 'converter_step_to_gltf',
        preview_artifact_generated_at = '2026-05-13T12:00:00.000Z',
        preview_status = 'ready'
    WHERE id = 'asset-preview-step'
  `);
  const afterArtifact = db.public.one(`
    SELECT preview_artifact_format, preview_artifact_source, preview_status
    FROM assets WHERE id = 'asset-preview-step'
  `);
  assert.deepEqual(afterArtifact, {
    preview_artifact_format: "glb",
    preview_artifact_source: "converter_step_to_gltf",
    preview_status: "ready"
  });

  // The format CHECK must reject any value outside the documented embeddable list. A buggy
  // writer attempting to mark a STEP file as a directly-renderable artifact must fail loudly --
  // otherwise the UI would attempt to render bytes the browser cannot decode.
  assert.throws(
    () =>
      db.public.none(
        `UPDATE assets SET preview_artifact_format = 'step' WHERE id = 'asset-preview-step'`
      ),
    /check/i
  );

  // The source CHECK must reject undocumented provenance values so the audit trail (which
  // operator generated the preview, and how) cannot be silently bypassed.
  assert.throws(
    () =>
      db.public.none(
        `UPDATE assets SET preview_artifact_source = 'screenshot_export' WHERE id = 'asset-preview-step'`
      ),
    /check/i
  );

  // Re-applying 040 must be a no-op so production redeploys do not crash on the second migration
  // pass. The migration uses ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT
  // so a fresh pg-mem instance must accept the script twice in a row.
  const replayDb = newDb();
  replayDb.public.none(oldPhase2SchemaSql);
  applyMigrationSql(replayDb, assetPreviewArtifactsMigrationSql);
  applyMigrationSql(replayDb, assetPreviewArtifactsMigrationSql);

  assert.match(assetPreviewArtifactsMigrationSql, /ADD COLUMN IF NOT EXISTS preview_artifact_storage_key/u);
  assert.match(assetPreviewArtifactsMigrationSql, /ADD COLUMN IF NOT EXISTS preview_artifact_format/u);
  assert.match(assetPreviewArtifactsMigrationSql, /assets_preview_artifact_format_check/u);
  assert.match(assetPreviewArtifactsMigrationSql, /assets_preview_artifact_source_check/u);
});

/**
 * Verifies the known-risk memory migration layers cleanly on top of circuit blocks and
 * preserves provenance fields (recorded_by/recorded_at, severity, resolved_at) so engineering
 * memory survives `circuit_blocks` updates without ever implying the linked part is approved.
 */
test("circuit block known risk migration preserves engineering memory provenance", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-memory', 'Memory Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-memory', 'SOT-23-5', 5, 0.95, 2.9, 1.6, 1.1);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-memory-ldo', 'TPS7A02DBVR', 'mfr-memory', 'Power management', 'active', 'pkg-memory', 0.8);
  `);
  applyMigrationSql(db, projectBomMemoryMigrationSql);
  applyMigrationSql(db, projectHealthEvidenceMigrationSql);
  applyMigrationSql(db, circuitBlocksMigrationSql);
  applyMigrationSql(db, circuitBlockKnownRisksMigrationSql);

  db.public.none(`
    INSERT INTO circuit_blocks (id, block_key, name, description, block_type, owner, status, reuse_scope, constraints)
    VALUES ('cblock-known-risks', 'POWER-LDO-RISKS', 'LDO rail with risks', 'Reusable regulator rail.', 'power', 'hardware', 'approved', 'Sensor boards', '{}'::jsonb);

    INSERT INTO circuit_block_known_risks (id, circuit_block_id, title, detail, severity, recorded_by, recorded_at)
    VALUES (
      'risk-inrush',
      'cblock-known-risks',
      'Inrush spike on cold start',
      'Output cap > 22µF caused VIN dip on Bravo Rev B. Recommend slow-start resistor.',
      'caution',
      'gerry@hardware',
      '2026-04-30T12:00:00.000Z'
    );

    INSERT INTO circuit_block_known_risks (id, circuit_block_id, title, severity)
    VALUES ('risk-erratum', 'cblock-known-risks', 'Silicon RevG erratum', 'blocking');
  `);

  const inrush = db.public.one(`
    SELECT severity, recorded_by, resolved_at FROM circuit_block_known_risks WHERE id = 'risk-inrush'
  `);
  const blockingActive = db.public.one(`
    SELECT COUNT(*)::int AS active_blocking
    FROM circuit_block_known_risks
    WHERE circuit_block_id = 'cblock-known-risks'
      AND severity = 'blocking'
      AND resolved_at IS NULL
  `);

  assert.deepEqual(inrush, { severity: "caution", recorded_by: "gerry@hardware", resolved_at: null });
  assert.equal(blockingActive.active_blocking, 1);

  assert.throws(
    () =>
      db.public.none(
        `INSERT INTO circuit_block_known_risks (id, circuit_block_id, title, severity) VALUES ('risk-bad', 'cblock-known-risks', 'Bad severity', 'critical')`
      ),
    /check/i
  );
  assert.throws(
    () =>
      db.public.none(
        `INSERT INTO circuit_block_known_risks (id, circuit_block_id, title, severity) VALUES ('risk-empty-title', 'cblock-known-risks', '', 'caution')`
      ),
    /check/i
  );
  assert.throws(
    () =>
      db.public.none(
        `INSERT INTO circuit_block_known_risks (id, circuit_block_id, title, severity, resolved_at, resolved_by) VALUES ('risk-bad-resolution', 'cblock-known-risks', 'Resolved without timestamp', 'caution', NULL, 'gerry@hardware')`
      ),
    /check/i
  );

  assert.match(circuitBlockKnownRisksMigrationSql, /CREATE TABLE IF NOT EXISTS circuit_block_known_risks/u);
  assert.match(circuitBlockKnownRisksMigrationSql, /idx_circuit_block_known_risks_active/u);
});

/**
 * Verifies the part engineering-memory migration persists typed private truth, preserves resolved
 * rows, and enforces kind/severity/empty-title/resolution CHECK constraints at the SQL boundary.
 */
test("part engineering records migration preserves private engineering memory provenance", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-memory', 'Memory Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-memory', 'SOT-23-5', 5, 0.95, 2.9, 1.6, 1.1);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-memory-ldo', 'TPS7A02DBVR', 'mfr-memory', 'Power management', 'active', 'pkg-memory', 0.8);
  `);
  applyMigrationSql(db, partEngineeringRecordsMigrationSql);

  db.public.none(`
    INSERT INTO part_engineering_records (id, part_id, record_kind, title, detail, severity, outcome, recorded_by, recorded_at)
    VALUES ('perec-outcome', 'part-memory-ldo', 'outcome', 'Bit us: cold-start droop', 'VOUT drooped on Bravo Rev B.', 'caution', 'bit_us', 'gerry@hardware', '2026-04-30T12:00:00.000Z');

    INSERT INTO part_engineering_records (id, part_id, record_kind, title, related_mpn)
    VALUES ('perec-mate', 'part-memory-ldo', 'harness_mate_verified', 'Mated correctly in Falcon harness', 'DF13-4P-1.25H');
  `);

  const openCount = db.public.one(`
    SELECT COUNT(*)::int AS open FROM part_engineering_records WHERE part_id = 'part-memory-ldo' AND resolved_at IS NULL
  `);
  assert.equal(openCount.open, 2);

  assert.throws(
    () => db.public.none(`INSERT INTO part_engineering_records (id, part_id, record_kind, title) VALUES ('perec-bad-kind', 'part-memory-ldo', 'not_a_kind', 'Bad kind')`),
    /check/i
  );
  assert.throws(
    () => db.public.none(`INSERT INTO part_engineering_records (id, part_id, record_kind, title, severity) VALUES ('perec-bad-sev', 'part-memory-ldo', 'note', 'Bad severity', 'critical')`),
    /check/i
  );
  assert.throws(
    () => db.public.none(`INSERT INTO part_engineering_records (id, part_id, record_kind, title) VALUES ('perec-empty', 'part-memory-ldo', 'note', '')`),
    /check/i
  );
  assert.throws(
    () => db.public.none(`INSERT INTO part_engineering_records (id, part_id, record_kind, title, resolved_at, resolved_by) VALUES ('perec-bad-res', 'part-memory-ldo', 'note', 'Resolved without timestamp', NULL, 'gerry@hardware')`),
    /check/i
  );

  assert.match(partEngineeringRecordsMigrationSql, /CREATE TABLE IF NOT EXISTS part_engineering_records/u);
  assert.match(partEngineeringRecordsMigrationSql, /idx_part_engineering_records_open/u);
});

/**
 * Verifies the passive-capture draft migration adds proposed/confirmed/dismissed state with safe
 * defaults (existing rows stay confirmed/manual), enforces draft CHECK constraints, and that the
 * deterministic auto-draft id de-dupes via ON CONFLICT DO NOTHING.
 */
test("part engineering record drafts migration adds review state without disturbing existing memory", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-memory', 'Memory Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-memory', 'SOT-23-5', 5, 0.95, 2.9, 1.6, 1.1);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-memory-ldo', 'TPS7A02DBVR', 'mfr-memory', 'Power management', 'active', 'pkg-memory', 0.8);
  `);
  applyMigrationSql(db, partEngineeringRecordsMigrationSql);
  applyMigrationSql(db, partEngineeringRecordDraftsMigrationSql);

  // Real Postgres backfills `ADD COLUMN NOT NULL DEFAULT` onto pre-existing rows (so legacy
  // hand-entered records stay durable confirmed/manual memory). pg-mem does not emulate that
  // backfill, so that guarantee is verified by `npm run migrations` against real Postgres; here
  // we assert the column DEFAULT applies to new inserts, which pg-mem does emulate.
  db.public.none(`
    INSERT INTO part_engineering_records (id, part_id, record_kind, title)
    VALUES ('perec-default', 'part-memory-ldo', 'note', 'Default-source note');
  `);
  const defaulted = db.public.one(`SELECT draft_status, draft_source FROM part_engineering_records WHERE id = 'perec-default'`);
  assert.deepEqual(defaulted, { draft_status: "confirmed", draft_source: "manual" });

  db.public.none(`
    INSERT INTO part_engineering_records (id, part_id, record_kind, title, draft_status, draft_source, trigger_ref)
    VALUES ('perec-auto-1', 'part-memory-ldo', 'decision_blocked', 'Substitute approved', 'proposed', 'auto_substitution', 'psub-xyz');
  `);
  db.public.none(`
    INSERT INTO part_engineering_records (id, part_id, record_kind, title, draft_status, draft_source)
    VALUES ('perec-auto-1', 'part-memory-ldo', 'decision_blocked', 'Duplicate attempt', 'proposed', 'auto_substitution')
    ON CONFLICT (id) DO NOTHING;
  `);
  const autoCount = db.public.one(`SELECT COUNT(*)::int AS n FROM part_engineering_records WHERE id = 'perec-auto-1'`);
  assert.equal(autoCount.n, 1, "deterministic auto-draft id de-dupes via ON CONFLICT DO NOTHING");

  assert.throws(
    () => db.public.none(`INSERT INTO part_engineering_records (id, part_id, record_kind, title, draft_status) VALUES ('perec-bad-ds', 'part-memory-ldo', 'note', 'bad', 'maybe')`),
    /check/i
  );
  assert.throws(
    () => db.public.none(`INSERT INTO part_engineering_records (id, part_id, record_kind, title, draft_source) VALUES ('perec-bad-src', 'part-memory-ldo', 'note', 'bad', 'auto_guess')`),
    /check/i
  );

  assert.match(partEngineeringRecordDraftsMigrationSql, /ADD COLUMN IF NOT EXISTS draft_status/u);
  assert.match(partEngineeringRecordDraftsMigrationSql, /idx_part_engineering_records_proposed/u);
});

/**
 * Verifies the scale-index migration applies cleanly on top of the engineering-memory tables and
 * declares the partial confirmed/open index plus trigram URL indexes. The trigram GIN DDL is
 * stripped by the pg-mem rewriter (no pg_trgm), so it is asserted on the SQL text; the partial
 * btree must actually apply (pg-mem supports partial btree) and stay query-safe and idempotent.
 */
test("scale-index migration adds the confirmed/open and source-url indexes idempotently", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-scale', 'Scale Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-scale', 'SOT-23-5', 5, 0.95, 2.9, 1.6, 1.1);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-scale-ldo', 'TPS7A02DBVR', 'mfr-scale', 'Power management', 'active', 'pkg-scale', 0.8);
  `);
  applyMigrationSql(db, partEngineeringRecordsMigrationSql);
  applyMigrationSql(db, partEngineeringRecordDraftsMigrationSql);
  applyMigrationSql(db, scaleIndexesMigrationSql);
  // Re-applying is a no-op (CREATE INDEX IF NOT EXISTS); migrations must stay idempotent.
  applyMigrationSql(db, scaleIndexesMigrationSql);

  db.public.none(`
    INSERT INTO part_engineering_records (id, part_id, record_kind, title, draft_status)
    VALUES ('perec-open', 'part-scale-ldo', 'outcome', 'Bit us', 'confirmed');
    INSERT INTO part_engineering_records (id, part_id, record_kind, title, draft_status, resolved_at, resolved_by)
    VALUES ('perec-done', 'part-scale-ldo', 'outcome', 'Resolved', 'confirmed', now(), 'gerry');
  `);

  const openRows = db.public.many(`
    SELECT id FROM part_engineering_records
    WHERE part_id = 'part-scale-ldo' AND draft_status = 'confirmed' AND resolved_at IS NULL
  `);
  assert.deepEqual(openRows.map((row) => row.id), ["perec-open"]);

  assert.match(scaleIndexesMigrationSql, /CREATE INDEX IF NOT EXISTS idx_part_engineering_records_confirmed_open\s+ON part_engineering_records\(part_id, recorded_at DESC\)\s+WHERE draft_status = 'confirmed' AND resolved_at IS NULL/u);
  assert.match(scaleIndexesMigrationSql, /idx_source_records_source_url_trgm[\s\S]*gin_trgm_ops/u);
  assert.match(scaleIndexesMigrationSql, /idx_assets_datasheet_source_url_trgm[\s\S]*gin_trgm_ops[\s\S]*WHERE asset_type = 'datasheet'/u);
});

/**
 * Verifies follow-up records persist assignable work without changing source readiness tables.
 */
test("follow-up records migration preserves assignable workflow state", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  applyMigrationSql(db, projectBomMemoryMigrationSql);
  applyMigrationSql(db, projectHealthEvidenceMigrationSql);
  applyMigrationSql(db, circuitBlocksMigrationSql);
  applyMigrationSql(db, followUpRecordsMigrationSql);

  db.public.none(`
    INSERT INTO follow_up_records (id, target_type, target_id, source_type, source_finding_id, title, detail, next_action, severity, status, assigned_to, source_inputs, evidence_attachment_ids, resolution_notes)
    VALUES (
      'followup-alpha-cad',
      'project',
      'project-alpha',
      'bom_health',
      'project-alpha:bom-health:missing_verified_cad',
      'Missing CAD',
      'One matched row is missing verified CAD.',
      'Review asset evidence.',
      'review',
      'in_progress',
      'hardware',
      '["U1: missing CAD"]'::jsonb,
      '["evidence-alpha-link"]'::jsonb,
      'Assigned for review.'
    );
  `);

  const followUp = db.public.one(`SELECT target_type, source_type, status, assigned_to, severity FROM follow_up_records WHERE id = 'followup-alpha-cad'`);

  assert.deepEqual(followUp, {
    assigned_to: "hardware",
    severity: "review",
    source_type: "bom_health",
    status: "in_progress",
    target_type: "project",
  });
  assert.throws(
    () => db.public.none(`INSERT INTO follow_up_records (id, target_type, target_id, source_type, source_finding_id, title, detail, next_action, severity, status) VALUES ('followup-bad', 'part', 'part-a', 'bom_health', 'bad', 'Bad', 'Bad', 'Bad', 'review', 'open')`),
    /check/i
  );
  assert.match(followUpRecordsMigrationSql, /CREATE TABLE IF NOT EXISTS follow_up_records/u);
});

/**
 * Verifies supply-offering migration keeps commercial snapshots source-linked and constrained.
 */
test("supply offering migration preserves provider-specific commercial snapshots", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-supply', 'Supply Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-supply', 'SOT-23-5', 5, 0.95, 2.9, 1.6, 1.1);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-supply-ldo', 'TPS7A02DBVR', 'mfr-supply', 'Power management', 'active', 'pkg-supply', 0.8);
  `);
  applyMigrationSql(db, hardeningMigrationSql);
  applyMigrationSql(db, providerImportHardeningMigrationSql);
  applyMigrationSql(db, supplyOfferingsMigrationSql);
  applyMigrationSql(db, supplyOfferSupplierRefreshMigrationSql);

  db.public.none(`
    INSERT INTO source_records (id, provider_id, provider_part_key, part_id, source_url, fetched_at, raw_payload, normalized_at)
    VALUES ('source-supply-1', 'octopart', 'TPS7A02DBVR', 'part-supply-ldo', 'https://example.test/supply', '2026-05-11T00:00:00.000Z', '{"mpn":"TPS7A02DBVR"}'::jsonb, '2026-05-11T00:01:00.000Z');

    INSERT INTO supply_offerings (
      id,
      part_id,
      provider_id,
      source_record_id,
      provider_part_key,
      supplier_name,
      provider_sku,
      inventory_status,
      inventory_quantity,
      moq,
      lead_time_days,
      packaging,
      currency_code,
      preferred_rank,
      last_seen_at,
      retired_at,
      retirement_reason
    )
    VALUES (
      'offer-supply-1',
      'part-supply-ldo',
      'octopart',
      'source-supply-1',
      'TPS7A02DBVR',
      'Digi-Key',
      'SKU-123',
      'in_stock',
      250,
      1,
      3,
      'Tape and reel',
      'USD',
      1,
      '2026-05-11T00:02:00.000Z',
      NULL,
      NULL
    ), (
      'offer-supply-retired',
      'part-supply-ldo',
      'octopart',
      'source-supply-1',
      'TPS7A02DBVR',
      'Old Seller',
      'OLD-SKU',
      'in_stock',
      999,
      1,
      1,
      'Tube',
      'USD',
      2,
      '2026-05-11T00:02:00.000Z',
      '2026-05-12T00:02:00.000Z',
      'missing_from_latest_provider_snapshot'
    );

    INSERT INTO price_breaks (id, supply_offering_id, min_quantity, unit_price, currency_code, captured_at)
    VALUES ('price-supply-1', 'offer-supply-1', 100, 0.42, 'USD', '2026-05-11T00:02:00.000Z');
  `);

  const joined = db.public.one(`
    SELECT
      so.provider_id,
      so.supplier_name,
      so.source_record_id,
      so.inventory_status,
      pb.min_quantity,
      pb.unit_price::float AS unit_price
    FROM supply_offerings so
    JOIN price_breaks pb ON pb.supply_offering_id = so.id
    WHERE so.id = 'offer-supply-1'
  `);

  assert.deepEqual(joined, {
    inventory_status: "in_stock",
    min_quantity: 100,
    provider_id: "octopart",
    supplier_name: "Digi-Key",
    source_record_id: "source-supply-1",
    unit_price: 0.42,
  });
  const activeOffers = db.public.one(`SELECT COUNT(*)::int AS active_count FROM supply_offerings WHERE retired_at IS NULL`);
  assert.equal(activeOffers.active_count, 1);
  assert.throws(
    () => db.public.none(`INSERT INTO supply_offerings (id, part_id, provider_id, source_record_id, provider_part_key, inventory_status) VALUES ('offer-bad-status', 'part-supply-ldo', 'octopart', 'source-supply-1', 'BAD', 'maybe')`),
    /check/i
  );
  assert.throws(
    () => db.public.none(`INSERT INTO price_breaks (id, supply_offering_id, min_quantity, unit_price, currency_code) VALUES ('price-bad-negative', 'offer-supply-1', 1, -0.1, 'USD')`),
    /check/i
  );
  assert.match(supplyOfferingsMigrationSql, /CREATE TABLE IF NOT EXISTS supply_offerings/u);
  assert.match(supplyOfferingsMigrationSql, /CREATE TABLE IF NOT EXISTS price_breaks/u);
  assert.match(supplyOfferingsMigrationSql, /source_record_id TEXT NOT NULL REFERENCES source_records/u);
  assert.match(supplyOfferSupplierRefreshMigrationSql, /ADD COLUMN IF NOT EXISTS supplier_name/u);
  assert.match(supplyOfferSupplierRefreshMigrationSql, /ADD COLUMN IF NOT EXISTS retired_at/u);
});

/**
 * Verifies interconnect memory tables preserve cable, fixture, and pin-map relationships.
 */
test("interconnect memory migration preserves cable and fixture pin context", () => {
  const db = newDb();

  db.public.none(oldPhase2SchemaSql);
  db.public.none(`
    INSERT INTO manufacturers (id, name, aliases, website) VALUES ('mfr-interconnect', 'Interconnect Test', '{}', NULL);
    INSERT INTO packages (id, package_name, pin_count, pitch_mm, body_length_mm, body_width_mm, body_height_mm) VALUES ('pkg-d38999', 'D38999 shell', 55, NULL, NULL, NULL, NULL);
    INSERT INTO parts (id, mpn, manufacturer_id, category, lifecycle_status, package_id, trust_score) VALUES ('part-interconnect-j202', 'D38999-J202', 'mfr-interconnect', 'Connector', 'active', 'pkg-d38999', 0.8);
  `);
  applyMigrationSql(db, projectBomMemoryMigrationSql);
  applyMigrationSql(db, projectHealthEvidenceMigrationSql);
  applyMigrationSql(db, interconnectMemoryMigrationSql);

  db.public.none(`
    INSERT INTO projects (id, project_key, name, description, status)
    VALUES ('project-interconnect', 'INT', 'Interconnect Rig', '', 'active');

    INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference)
    VALUES ('revision-interconnect-d', 'project-interconnect', 'D', 'released', 'Cable drawing D');

    INSERT INTO cable_assemblies (id, cable_key, revision_label, assembly_status, project_id, project_revision_id, owner, description, source_document_ref, provenance)
    VALUES ('cable-int-100', 'INT-100', 'D', 'approved', 'project-interconnect', 'revision-interconnect-d', 'Dana', 'Fixture cable.', 'INT-100-D.xlsx', 'project_file');

    INSERT INTO cable_assembly_ends (id, cable_assembly_id, end_label, connector_ref, connector_part_id, mate_part_id, backshell_part_id, notes)
    VALUES ('cable-int-100-a', 'cable-int-100', 'A', 'J202', 'part-interconnect-j202', NULL, NULL, 'Fixture end.');

    INSERT INTO test_fixtures (id, fixture_key, revision_label, fixture_status, project_id, owner, purpose, source_document_ref, provenance)
    VALUES ('fixture-int-1', 'TFX-INT', 'B', 'restricted', 'project-interconnect', 'Morgan', 'DUT fixture.', 'TFX-INT-B.pdf', 'project_file');

    INSERT INTO fixture_ports (id, fixture_id, connector_ref, connector_part_id, mate_part_id, cable_assembly_id, port_role, notes)
    VALUES ('fixture-int-1-j202', 'fixture-int-1', 'J202', 'part-interconnect-j202', NULL, 'cable-int-100', 'DUT port', 'Rev D only.');

    INSERT INTO cable_pin_map_rows (id, cable_assembly_id, cable_end_id, fixture_port_id, end_label, connector_ref, pin_number, signal_name, wire_color, wire_gauge, destination_connector_ref, destination_pin_number, confidence_score, source_document_ref, notes)
    VALUES ('pin-int-j202-47', 'cable-int-100', 'cable-int-100-a', 'fixture-int-1-j202', 'A', 'J202', '47', 'RS422_TX+', 'blue', 24, 'J201', '12', 0.62, 'INT-100-D.xlsx', 'Copied from cable spreadsheet.');
  `);

  const joined = db.public.one(`
    SELECT
      ca.cable_key,
      tf.fixture_key,
      fp.connector_ref,
      cpm.pin_number,
      cpm.signal_name,
      cpm.confidence_score::float AS confidence_score
    FROM cable_pin_map_rows cpm
    JOIN cable_assemblies ca ON ca.id = cpm.cable_assembly_id
    JOIN fixture_ports fp ON fp.id = cpm.fixture_port_id
    JOIN test_fixtures tf ON tf.id = fp.fixture_id
    WHERE cpm.id = 'pin-int-j202-47'
  `);

  assert.deepEqual(joined, {
    cable_key: "INT-100",
    confidence_score: 0.62,
    connector_ref: "J202",
    fixture_key: "TFX-INT",
    pin_number: "47",
    signal_name: "RS422_TX+",
  });
  assert.throws(
    () => db.public.none(`INSERT INTO cable_assemblies (id, cable_key, revision_label, assembly_status) VALUES ('cable-bad-status', 'BAD', 'A', 'maybe')`),
    /check/i
  );
  assert.throws(
    () => db.public.none(`INSERT INTO cable_pin_map_rows (id, cable_assembly_id, end_label, connector_ref, pin_number, signal_name, confidence_score) VALUES ('pin-bad-score', 'cable-int-100', 'A', 'J202', '1', 'BAD', 1.5)`),
    /check/i
  );
  assert.match(interconnectMemoryMigrationSql, /CREATE TABLE IF NOT EXISTS cable_assemblies/u);
  assert.match(interconnectMemoryMigrationSql, /CREATE TABLE IF NOT EXISTS cable_pin_map_rows/u);
  assert.match(interconnectMemoryMigrationSql, /CREATE INDEX IF NOT EXISTS idx_cable_pin_map_rows_pin/u);
});

test("project document extraction migration preserves progress and source locations", () => {
  const db = newDb();

  /**
   * pg-mem omits PostgreSQL's jsonb_typeof function, so register the behavior
   * needed by the production migration's JSON-array constraint.
   */
  db.public.registerFunction({
    args: [DataType.jsonb],
    implementation: (value: unknown) => {
      if (Array.isArray(value)) return "array";
      if (value === null) return "null";
      return typeof value === "object" ? "object" : typeof value;
    },
    name: "jsonb_typeof",
    returns: DataType.text
  });

  db.public.none(oldPhase2SchemaSql);
  applyMigrationSql(db, projectBomMemoryMigrationSql);
  applyMigrationSql(db, projectDocumentExtractionsMigrationSql);
  applyMigrationSql(db, projectDocumentExtractionPreviewsMigrationSql);

  db.public.none(`
    INSERT INTO projects (id, project_key, name, description, status)
    VALUES ('project-docs', 'DOCS', 'Document Project', '', 'active');

    INSERT INTO project_document_extractions (
      id,
      project_id,
      project_key,
      relative_path,
      filename,
      extraction_format,
      extractor_version,
      source_fingerprint,
      source_size_bytes,
      extraction_status,
      progress_percent,
      progress_message,
      source_unit_count,
      extracted_character_count,
      extracted_text,
      extracted_segments
    )
    VALUES (
      'extract-docs-j202',
      'project-docs',
      'DOCS',
      'old/J202-test.pdf',
      'J202-test.pdf',
      'pdf',
      'project-document-reader-v1',
      'fingerprint-j202',
      2048,
      'succeeded',
      100,
      'Text ready from 2 source sections.',
      2,
      41,
      'Connector J202 pin 47 carries RS422_TX+.',
      '[{"label":"Page 2","text":"Connector J202 pin 47 carries RS422_TX+.","textPreview":"Connector J202 pin 47 carries RS422_TX+."}]'::jsonb
    );
  `);

  const extraction = db.public.one(`
    SELECT
      extraction_format,
      extraction_status,
      progress_percent,
      source_unit_count,
      extracted_segments->0->>'label' AS source_label,
      source_location_previews
    FROM project_document_extractions
    WHERE id = 'extract-docs-j202'
  `);

  assert.deepEqual(extraction, {
    extraction_format: "pdf",
    extraction_status: "succeeded",
    progress_percent: 100,
    source_label: "Page 2",
    source_location_previews: [],
    source_unit_count: 2
  });
  assert.throws(
    () => db.public.none(`
      INSERT INTO project_document_extractions (
        id, project_id, project_key, relative_path, filename, extraction_format,
        extractor_version, source_fingerprint, source_size_bytes, extraction_status,
        progress_percent, progress_message
      )
      VALUES (
        'extract-bad-progress', 'project-docs', 'DOCS', 'bad.pdf', 'bad.pdf', 'pdf',
        'v1', 'bad', 1, 'queued', 101, 'bad'
      )
    `),
    /check/i
  );
  assert.match(projectDocumentExtractionsMigrationSql, /CREATE TABLE IF NOT EXISTS project_document_extractions/u);
  assert.match(projectDocumentExtractionsMigrationSql, /idx_project_document_extractions_queue/u);
  assert.match(projectDocumentExtractionPreviewsMigrationSql, /source_location_previews/u);
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
