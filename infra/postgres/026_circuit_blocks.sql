-- File header: Adds structured circuit block memory for reusable engineering knowledge.
-- Circuit blocks group part roles, constraints, and evidence without overriding part approval or export readiness.

CREATE TABLE IF NOT EXISTS circuit_blocks (
  id TEXT PRIMARY KEY,
  block_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  block_type TEXT NOT NULL DEFAULT 'other' CHECK (
    block_type IN ('power', 'mcu_support', 'interface', 'protection', 'connector_set', 'sensor_front_end', 'other')
  ),
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'in_review', 'approved', 'restricted', 'deprecated')
  ),
  reuse_scope TEXT NOT NULL DEFAULT '',
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_circuit_blocks_block_key
  ON circuit_blocks(block_key);

CREATE INDEX IF NOT EXISTS idx_circuit_blocks_status_updated_at
  ON circuit_blocks(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_circuit_blocks_type_status
  ON circuit_blocks(block_type, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS circuit_block_parts (
  id TEXT PRIMARY KEY,
  circuit_block_id TEXT NOT NULL REFERENCES circuit_blocks(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL REFERENCES parts(id),
  role TEXT NOT NULL,
  quantity NUMERIC,
  is_required BOOLEAN NOT NULL DEFAULT true,
  substitution_policy TEXT NOT NULL DEFAULT 'exact_required' CHECK (
    substitution_policy IN ('exact_required', 'approved_alternate_allowed', 'equivalent_allowed', 'do_not_substitute')
  ),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (circuit_block_id, part_id, role),
  CHECK (quantity IS NULL OR quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_circuit_block_parts_block_required
  ON circuit_block_parts(circuit_block_id, is_required, role);

CREATE INDEX IF NOT EXISTS idx_circuit_block_parts_part
  ON circuit_block_parts(part_id, circuit_block_id);

ALTER TABLE evidence_attachments
  DROP CONSTRAINT IF EXISTS evidence_attachments_target_type_check;

ALTER TABLE evidence_attachments
  DROP CONSTRAINT IF EXISTS evidence_attachments_constraint_1;

ALTER TABLE evidence_attachments
  ADD CONSTRAINT evidence_attachments_target_type_check CHECK (
    target_type IN ('part', 'asset', 'project', 'bom_import', 'bom_line', 'project_part_usage', 'risk_finding', 'circuit_block', 'circuit_block_part')
  );
