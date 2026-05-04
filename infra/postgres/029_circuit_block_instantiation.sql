-- 029_circuit_block_instantiation: Records when a project BOM was generated from a reusable circuit block.
--
-- Each circuit block instantiation creates a synthetic bom_import scoped to a project revision.
-- The bom_lines created from instantiation reference back to the originating block and block-part rows
-- so future revision compares can show "this part came from circuit block X" alongside hand-imported rows.

CREATE TABLE IF NOT EXISTS circuit_block_instantiations (
  id TEXT PRIMARY KEY,
  circuit_block_id TEXT NOT NULL REFERENCES circuit_blocks(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  project_revision_id TEXT NOT NULL REFERENCES project_revisions(id),
  bom_import_id TEXT NOT NULL REFERENCES bom_imports(id),
  include_optional BOOLEAN NOT NULL DEFAULT false,
  designator_prefix TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_circuit_block_instantiations_block
  ON circuit_block_instantiations(circuit_block_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_circuit_block_instantiations_project_revision
  ON circuit_block_instantiations(project_id, project_revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_circuit_block_instantiations_bom_import
  ON circuit_block_instantiations(bom_import_id);

-- BOM lines remember which block / block-part role they were instantiated from. Hand-imported BOM rows
-- leave these columns NULL so they remain backwards-compatible with prior CSV/XLSX intake flows.
ALTER TABLE bom_lines
  ADD COLUMN IF NOT EXISTS instantiated_from_circuit_block_id TEXT REFERENCES circuit_blocks(id),
  ADD COLUMN IF NOT EXISTS instantiated_from_circuit_block_part_id TEXT REFERENCES circuit_block_parts(id),
  ADD COLUMN IF NOT EXISTS instantiated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bom_lines_instantiated_from_block
  ON bom_lines(instantiated_from_circuit_block_id, project_id, project_revision_id)
  WHERE instantiated_from_circuit_block_id IS NOT NULL;
