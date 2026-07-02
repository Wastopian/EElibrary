-- File header: Tenant isolation, Increment 2e. Scopes the last still-global app domains so every
-- team-data table carries org_id: circuit blocks (+ parts/known-risks/instantiations), evidence
-- attachments, follow-up records, part engineering memory, part substitutions, revision approval
-- gates, export bundles, and project document extractions. After this the whole app is tenant-isolated
-- at the app layer; only the RLS backstop and org-on-signup remain.
--
-- Most of these are read only through an already-scoped project/part gate (partition-by-association);
-- the genuine leaks were the standalone circuit-block reads (list/detail/where-used) and the evidence
-- vault, which the store now filters by org. This migration gives every table its own org_id so writes
-- stamp it and the RLS backstop can enforce it.
--
-- Idempotent: production applies migrations on every deploy and CI asserts a second db:migrate reports
-- no pending work.

-- 1) Add org_id to every remaining table.
ALTER TABLE circuit_blocks ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE circuit_block_parts ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE circuit_block_known_risks ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE circuit_block_instantiations ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE evidence_attachments ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE follow_up_records ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE part_engineering_records ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE project_revision_approval_gates ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE export_bundles ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE part_substitutions ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE project_document_extractions ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);

-- 2) Backfill. circuit_blocks / evidence / follow-ups are standalone or polymorphic → default org;
-- everything else derives from its single clear parent (which the earlier increments already backfilled).
UPDATE circuit_blocks SET org_id = 'org-default' WHERE org_id IS NULL;

UPDATE circuit_block_parts c SET org_id = b.org_id FROM circuit_blocks b WHERE b.id = c.circuit_block_id AND c.org_id IS NULL;
UPDATE circuit_block_known_risks c SET org_id = b.org_id FROM circuit_blocks b WHERE b.id = c.circuit_block_id AND c.org_id IS NULL;
UPDATE circuit_block_instantiations i SET org_id = p.org_id FROM projects p WHERE p.id = i.project_id AND i.org_id IS NULL;
UPDATE project_revision_approval_gates g SET org_id = p.org_id FROM projects p WHERE p.id = g.project_id AND g.org_id IS NULL;
UPDATE export_bundles e SET org_id = p.org_id FROM projects p WHERE p.id = e.project_id AND e.org_id IS NULL;
UPDATE project_document_extractions d SET org_id = p.org_id FROM projects p WHERE p.id = d.project_id AND d.org_id IS NULL;
UPDATE part_engineering_records r SET org_id = p.org_id FROM parts p WHERE p.id = r.part_id AND r.org_id IS NULL;
UPDATE part_substitutions s SET org_id = p.org_id FROM parts p WHERE p.id = s.original_part_id AND s.org_id IS NULL;

-- Standalone / polymorphic tables and any remaining orphans → the shared default org.
UPDATE evidence_attachments SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE follow_up_records SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE circuit_block_parts SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE circuit_block_known_risks SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE circuit_block_instantiations SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE project_revision_approval_gates SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE export_bundles SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE project_document_extractions SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE part_engineering_records SET org_id = 'org-default' WHERE org_id IS NULL;
UPDATE part_substitutions SET org_id = 'org-default' WHERE org_id IS NULL;

-- 3) Per-tenant identity for circuit blocks: the global block_key uniqueness (uq_circuit_blocks_block_key
-- from 026) becomes per-tenant so the same block_key can exist once per team.
DROP INDEX IF EXISTS uq_circuit_blocks_block_key;
CREATE UNIQUE INDEX IF NOT EXISTS circuit_blocks_org_block_key_unique ON circuit_blocks (org_id, block_key);

-- 4) Index org_id on every scoped table.
CREATE INDEX IF NOT EXISTS circuit_blocks_org_id_idx ON circuit_blocks (org_id);
CREATE INDEX IF NOT EXISTS circuit_block_parts_org_id_idx ON circuit_block_parts (org_id);
CREATE INDEX IF NOT EXISTS circuit_block_known_risks_org_id_idx ON circuit_block_known_risks (org_id);
CREATE INDEX IF NOT EXISTS circuit_block_instantiations_org_id_idx ON circuit_block_instantiations (org_id);
CREATE INDEX IF NOT EXISTS evidence_attachments_org_id_idx ON evidence_attachments (org_id);
CREATE INDEX IF NOT EXISTS follow_up_records_org_id_idx ON follow_up_records (org_id);
CREATE INDEX IF NOT EXISTS part_engineering_records_org_id_idx ON part_engineering_records (org_id);
CREATE INDEX IF NOT EXISTS project_revision_approval_gates_org_id_idx ON project_revision_approval_gates (org_id);
CREATE INDEX IF NOT EXISTS export_bundles_org_id_idx ON export_bundles (org_id);
CREATE INDEX IF NOT EXISTS part_substitutions_org_id_idx ON part_substitutions (org_id);
CREATE INDEX IF NOT EXISTS project_document_extractions_org_id_idx ON project_document_extractions (org_id);
