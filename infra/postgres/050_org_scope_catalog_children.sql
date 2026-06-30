-- File header: Tenant isolation, Increment 2c. Gives every part-attached catalog child table its own
-- org_id, backfilled from its parent part, so the catalog data model is ready for the future
-- Row-Level Security backstop and no child row is tenant-less. Increment 2b already made every catalog
-- read flow through an org-scoped parts query, so these children were already isolated by association;
-- this migration is RLS-readiness + write-hygiene, not a leak fix.
--
-- connector_family_conflicts stays GLOBAL (a family-level taxonomy), as do manufacturers / packages /
-- connector_families. The cross-part relations (mate/accessory/cable/similar/companion) reference two
-- parts but are owned by their part_id part, so they take that part's org.
--
-- Idempotent: production applies migrations on every deploy and CI asserts a second db:migrate reports
-- no pending work.

-- 1) Add org_id to every part-attached child table.
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE datasheet_revisions ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE document_revisions ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE document_acl_entries ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE document_redlines ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE part_metrics ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE mate_relations ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE accessory_requirements ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE cable_compatibilities ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE similar_part_relations ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE companion_recommendations ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE generation_workflows ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE generation_requests ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE review_records ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE source_extraction_signals ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE asset_validation_records ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE asset_promotion_audits ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE part_readiness_summaries ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE part_approvals ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE part_issues ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE part_source_reconciliations ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE part_risk_flags ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE supply_offerings ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE price_breaks ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);

-- 2) Backfill the direct part_id children from their parent part.
UPDATE source_records c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE assets c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE datasheet_revisions c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE document_revisions c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE part_metrics c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE mate_relations c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE accessory_requirements c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE cable_compatibilities c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE similar_part_relations c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE companion_recommendations c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE generation_workflows c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE generation_requests c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE review_records c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE source_extraction_signals c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE asset_validation_records c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE asset_promotion_audits c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE part_readiness_summaries c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE part_approvals c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE part_issues c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE part_source_reconciliations c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE part_risk_flags c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;
UPDATE supply_offerings c SET org_id = p.org_id FROM parts p WHERE p.id = c.part_id AND c.org_id IS NULL;

-- 3) Backfill the indirect children from their immediate parent (after the parent is backfilled above).
UPDATE price_breaks pb SET org_id = so.org_id FROM supply_offerings so WHERE so.id = pb.supply_offering_id AND pb.org_id IS NULL;
UPDATE document_acl_entries ace SET org_id = dr.org_id FROM document_revisions dr WHERE dr.id = ace.document_revision_id AND ace.org_id IS NULL;
UPDATE document_redlines rl SET org_id = dr.org_id FROM document_revisions dr WHERE dr.id = rl.document_revision_id AND rl.org_id IS NULL;

-- 4) Any rows whose parent was itself null (orphans) fall back to the shared default org.
UPDATE source_records SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE assets SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE datasheet_revisions SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE document_revisions SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE document_acl_entries SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE document_redlines SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE part_metrics SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE mate_relations SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE accessory_requirements SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE cable_compatibilities SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE similar_part_relations SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE companion_recommendations SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE generation_workflows SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE generation_requests SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE review_records SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE source_extraction_signals SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE asset_validation_records SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE asset_promotion_audits SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE part_readiness_summaries SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE part_approvals SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE part_issues SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE part_source_reconciliations SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE part_risk_flags SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE supply_offerings SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE price_breaks SET org_id = 'org-default' WHERE org_id IS NULL;

-- 5) Index org_id on every scoped child table.
CREATE INDEX IF NOT EXISTS source_records_org_id_idx ON source_records (org_id);
CREATE INDEX IF NOT EXISTS assets_org_id_idx ON assets (org_id);
CREATE INDEX IF NOT EXISTS datasheet_revisions_org_id_idx ON datasheet_revisions (org_id);
CREATE INDEX IF NOT EXISTS document_revisions_org_id_idx ON document_revisions (org_id);
CREATE INDEX IF NOT EXISTS document_acl_entries_org_id_idx ON document_acl_entries (org_id);
CREATE INDEX IF NOT EXISTS document_redlines_org_id_idx ON document_redlines (org_id);
CREATE INDEX IF NOT EXISTS part_metrics_org_id_idx ON part_metrics (org_id);
CREATE INDEX IF NOT EXISTS mate_relations_org_id_idx ON mate_relations (org_id);
CREATE INDEX IF NOT EXISTS accessory_requirements_org_id_idx ON accessory_requirements (org_id);
CREATE INDEX IF NOT EXISTS cable_compatibilities_org_id_idx ON cable_compatibilities (org_id);
CREATE INDEX IF NOT EXISTS similar_part_relations_org_id_idx ON similar_part_relations (org_id);
CREATE INDEX IF NOT EXISTS companion_recommendations_org_id_idx ON companion_recommendations (org_id);
CREATE INDEX IF NOT EXISTS generation_workflows_org_id_idx ON generation_workflows (org_id);
CREATE INDEX IF NOT EXISTS generation_requests_org_id_idx ON generation_requests (org_id);
CREATE INDEX IF NOT EXISTS review_records_org_id_idx ON review_records (org_id);
CREATE INDEX IF NOT EXISTS source_extraction_signals_org_id_idx ON source_extraction_signals (org_id);
CREATE INDEX IF NOT EXISTS asset_validation_records_org_id_idx ON asset_validation_records (org_id);
CREATE INDEX IF NOT EXISTS asset_promotion_audits_org_id_idx ON asset_promotion_audits (org_id);
CREATE INDEX IF NOT EXISTS part_readiness_summaries_org_id_idx ON part_readiness_summaries (org_id);
CREATE INDEX IF NOT EXISTS part_approvals_org_id_idx ON part_approvals (org_id);
CREATE INDEX IF NOT EXISTS part_issues_org_id_idx ON part_issues (org_id);
CREATE INDEX IF NOT EXISTS part_source_reconciliations_org_id_idx ON part_source_reconciliations (org_id);
CREATE INDEX IF NOT EXISTS part_risk_flags_org_id_idx ON part_risk_flags (org_id);
CREATE INDEX IF NOT EXISTS supply_offerings_org_id_idx ON supply_offerings (org_id);
CREATE INDEX IF NOT EXISTS price_breaks_org_id_idx ON price_breaks (org_id);
