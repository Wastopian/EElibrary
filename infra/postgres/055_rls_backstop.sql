-- File header: Tenant isolation, Increment 5. Row-Level Security backstop.
--
-- Increments 2-4 scoped every team-data table by org_id at the app layer and activated real
-- multi-tenancy. This adds the database-level backstop: a policy on every scoped table so Postgres
-- itself filters rows by the acting org, and a forgotten `WHERE org_id = ...` in future application
-- SQL can no longer leak across tenants.
--
-- Contract:
--   * The API opens one transaction per request and runs
--       SELECT set_config('app.current_org', <orgId or ''>, true)
--     on it (apps/api/src/request-db.ts). Policies compare org_id to that GUC. An anonymous request
--     sets '' (matches nothing) and a connection that never set the GUC sees nothing: fail closed.
--   * Trusted non-request paths -- the worker (whose job claim is legitimately cross-org and which
--     derives/preserves org per job), migrations, and operator scripts -- connect with
--     `options: -c app.rls_bypass=on` and are exempt. Only someone already executing SQL can set a
--     GUC, so this does not weaken the backstop against application query bugs. A separate non-owner
--     database role is a documented future tightening.
--   * FORCE ROW LEVEL SECURITY because the app connects as the table owner (owners bypass plain
--     ENABLE). Idempotent: DROP POLICY IF EXISTS + CREATE POLICY (CREATE POLICY has no IF NOT EXISTS);
--     production applies migrations on every deploy and CI asserts a second db:migrate is a no-op.
--
-- Excluded on purpose:
--   * users, organizations -- the web app must read them BEFORE a tenant is known (sign-in, sign-up,
--     invite lookup); auth is the chicken-and-egg exception.
--   * audit_events -- org-agnostic operational log written on its own pool, including after failed
--     requests when the request transaction has already aborted.
--   * Reference taxonomies (manufacturers, packages, connector_families, connector_family_conflicts)
--     -- global by design, no org_id.

ALTER TABLE accessory_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE accessory_requirements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accessory_requirements_tenant_isolation ON accessory_requirements;
CREATE POLICY accessory_requirements_tenant_isolation ON accessory_requirements
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE asset_promotion_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_promotion_audits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_promotion_audits_tenant_isolation ON asset_promotion_audits;
CREATE POLICY asset_promotion_audits_tenant_isolation ON asset_promotion_audits
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE asset_validation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_validation_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_validation_records_tenant_isolation ON asset_validation_records;
CREATE POLICY asset_validation_records_tenant_isolation ON asset_validation_records
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assets_tenant_isolation ON assets;
CREATE POLICY assets_tenant_isolation ON assets
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE bom_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bom_imports_tenant_isolation ON bom_imports;
CREATE POLICY bom_imports_tenant_isolation ON bom_imports
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bom_lines_tenant_isolation ON bom_lines;
CREATE POLICY bom_lines_tenant_isolation ON bom_lines
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE cable_assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE cable_assemblies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cable_assemblies_tenant_isolation ON cable_assemblies;
CREATE POLICY cable_assemblies_tenant_isolation ON cable_assemblies
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE cable_assembly_ends ENABLE ROW LEVEL SECURITY;
ALTER TABLE cable_assembly_ends FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cable_assembly_ends_tenant_isolation ON cable_assembly_ends;
CREATE POLICY cable_assembly_ends_tenant_isolation ON cable_assembly_ends
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE cable_compatibilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cable_compatibilities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cable_compatibilities_tenant_isolation ON cable_compatibilities;
CREATE POLICY cable_compatibilities_tenant_isolation ON cable_compatibilities
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE cable_pin_map_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE cable_pin_map_rows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cable_pin_map_rows_tenant_isolation ON cable_pin_map_rows;
CREATE POLICY cable_pin_map_rows_tenant_isolation ON cable_pin_map_rows
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE circuit_block_instantiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE circuit_block_instantiations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS circuit_block_instantiations_tenant_isolation ON circuit_block_instantiations;
CREATE POLICY circuit_block_instantiations_tenant_isolation ON circuit_block_instantiations
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE circuit_block_known_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE circuit_block_known_risks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS circuit_block_known_risks_tenant_isolation ON circuit_block_known_risks;
CREATE POLICY circuit_block_known_risks_tenant_isolation ON circuit_block_known_risks
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE circuit_block_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE circuit_block_parts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS circuit_block_parts_tenant_isolation ON circuit_block_parts;
CREATE POLICY circuit_block_parts_tenant_isolation ON circuit_block_parts
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE circuit_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE circuit_blocks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS circuit_blocks_tenant_isolation ON circuit_blocks;
CREATE POLICY circuit_blocks_tenant_isolation ON circuit_blocks
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE companion_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companion_recommendations_tenant_isolation ON companion_recommendations;
CREATE POLICY companion_recommendations_tenant_isolation ON companion_recommendations
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE datasheet_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasheet_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS datasheet_revisions_tenant_isolation ON datasheet_revisions;
CREATE POLICY datasheet_revisions_tenant_isolation ON datasheet_revisions
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE document_acl_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_acl_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_acl_entries_tenant_isolation ON document_acl_entries;
CREATE POLICY document_acl_entries_tenant_isolation ON document_acl_entries
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE document_redlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_redlines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_redlines_tenant_isolation ON document_redlines;
CREATE POLICY document_redlines_tenant_isolation ON document_redlines
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE document_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_revisions_tenant_isolation ON document_revisions;
CREATE POLICY document_revisions_tenant_isolation ON document_revisions
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE evidence_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_attachments_tenant_isolation ON evidence_attachments;
CREATE POLICY evidence_attachments_tenant_isolation ON evidence_attachments
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE export_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_bundles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS export_bundles_tenant_isolation ON export_bundles;
CREATE POLICY export_bundles_tenant_isolation ON export_bundles
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE fixture_ports ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixture_ports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixture_ports_tenant_isolation ON fixture_ports;
CREATE POLICY fixture_ports_tenant_isolation ON fixture_ports
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE follow_up_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS follow_up_records_tenant_isolation ON follow_up_records;
CREATE POLICY follow_up_records_tenant_isolation ON follow_up_records
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS generation_requests_tenant_isolation ON generation_requests;
CREATE POLICY generation_requests_tenant_isolation ON generation_requests
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE generation_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_workflows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS generation_workflows_tenant_isolation ON generation_workflows;
CREATE POLICY generation_workflows_tenant_isolation ON generation_workflows
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE mate_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mate_relations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mate_relations_tenant_isolation ON mate_relations;
CREATE POLICY mate_relations_tenant_isolation ON mate_relations
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE part_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_approvals_tenant_isolation ON part_approvals;
CREATE POLICY part_approvals_tenant_isolation ON part_approvals
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE part_engineering_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_engineering_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_engineering_records_tenant_isolation ON part_engineering_records;
CREATE POLICY part_engineering_records_tenant_isolation ON part_engineering_records
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE part_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_issues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_issues_tenant_isolation ON part_issues;
CREATE POLICY part_issues_tenant_isolation ON part_issues
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE part_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_metrics_tenant_isolation ON part_metrics;
CREATE POLICY part_metrics_tenant_isolation ON part_metrics
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE part_readiness_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_readiness_summaries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_readiness_summaries_tenant_isolation ON part_readiness_summaries;
CREATE POLICY part_readiness_summaries_tenant_isolation ON part_readiness_summaries
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE part_risk_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_risk_flags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_risk_flags_tenant_isolation ON part_risk_flags;
CREATE POLICY part_risk_flags_tenant_isolation ON part_risk_flags
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE part_source_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_source_reconciliations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_source_reconciliations_tenant_isolation ON part_source_reconciliations;
CREATE POLICY part_source_reconciliations_tenant_isolation ON part_source_reconciliations
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE part_substitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_substitutions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS part_substitutions_tenant_isolation ON part_substitutions;
CREATE POLICY part_substitutions_tenant_isolation ON part_substitutions
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parts_tenant_isolation ON parts;
CREATE POLICY parts_tenant_isolation ON parts
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE price_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_breaks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_breaks_tenant_isolation ON price_breaks;
CREATE POLICY price_breaks_tenant_isolation ON price_breaks
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE project_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_document_extractions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_document_extractions_tenant_isolation ON project_document_extractions;
CREATE POLICY project_document_extractions_tenant_isolation ON project_document_extractions
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE project_part_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_part_usages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_part_usages_tenant_isolation ON project_part_usages;
CREATE POLICY project_part_usages_tenant_isolation ON project_part_usages
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE project_revision_approval_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_revision_approval_gates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_revision_approval_gates_tenant_isolation ON project_revision_approval_gates;
CREATE POLICY project_revision_approval_gates_tenant_isolation ON project_revision_approval_gates
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE project_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_revisions_tenant_isolation ON project_revisions;
CREATE POLICY project_revisions_tenant_isolation ON project_revisions
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_tenant_isolation ON projects;
CREATE POLICY projects_tenant_isolation ON projects
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE provider_acquisition_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_acquisition_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_acquisition_jobs_tenant_isolation ON provider_acquisition_jobs;
CREATE POLICY provider_acquisition_jobs_tenant_isolation ON provider_acquisition_jobs
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE review_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_records_tenant_isolation ON review_records;
CREATE POLICY review_records_tenant_isolation ON review_records
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE similar_part_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE similar_part_relations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS similar_part_relations_tenant_isolation ON similar_part_relations;
CREATE POLICY similar_part_relations_tenant_isolation ON similar_part_relations
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE source_extraction_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_extraction_signals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_extraction_signals_tenant_isolation ON source_extraction_signals;
CREATE POLICY source_extraction_signals_tenant_isolation ON source_extraction_signals
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_records_tenant_isolation ON source_records;
CREATE POLICY source_records_tenant_isolation ON source_records
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE supply_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_offerings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supply_offerings_tenant_isolation ON supply_offerings;
CREATE POLICY supply_offerings_tenant_isolation ON supply_offerings
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

ALTER TABLE test_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_fixtures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS test_fixtures_tenant_isolation ON test_fixtures;
CREATE POLICY test_fixtures_tenant_isolation ON test_fixtures
  USING (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR org_id = current_setting('app.current_org', true));

