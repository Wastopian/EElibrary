-- File header: Records part-level private engineering memory the public catalogs cannot reproduce.
--
-- A "part engineering record" is the durable institutional answer to the questions an internal
-- library exists to answer and a public aggregator (Octopart/Nexar, DigiKey, Mouser) never can:
--   * outcome              — "did it work, or did it bite us?" (the part's real track record)
--   * harness_mate_verified— "which connector actually mated correctly in the real harness?"
--   * cad_physical_verified— "which CAD model was checked against the physical part?"
--   * dependency           — "which test fixture, board, cable, or program depended on it?"
--   * decision_blocked     — "why was this restricted/blocked, and what mistake must we not repeat?"
--   * note                 — free-form tribal knowledge a curator wants the next engineer to see
--
-- Honesty contract (carried over from circuit_block_known_risks):
--   * A record states what an engineer observed/decided; it is NOT a part-approval decision and
--     never changes approval_status, validation_status, review_status, or export_status.
--   * `severity` and `outcome` are the recording engineer's classification, not automated scores.
--   * Resolving a record (`resolved_at IS NOT NULL`) preserves the original observation; the row
--     is never deleted, so a project that reused the part while the record was open stays auditable.
--   * Optional links (`related_asset_id`, `datasheet_revision_id`) make "which footprint did we
--     trust / which datasheet revision did we design from" answerable without inventing certainty;
--     they ON DELETE SET NULL so removing an asset never erases the engineering memory.

CREATE TABLE IF NOT EXISTS part_engineering_records (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  record_kind TEXT NOT NULL CHECK (
    record_kind IN ('outcome', 'harness_mate_verified', 'cad_physical_verified', 'dependency', 'decision_blocked', 'note')
  ),
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'info' CHECK (
    severity IN ('info', 'limitation', 'caution', 'blocking')
  ),
  -- Engineer's verdict for outcome / verification records; NULL for note/dependency/decision rows.
  outcome TEXT CHECK (
    outcome IS NULL OR outcome IN ('worked', 'worked_with_caveats', 'bit_us', 'not_verified')
  ),
  -- Which trusted footprint/symbol/3D asset this record is about (Q5 / Q8). SET NULL on asset delete.
  related_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  -- Which datasheet revision the team designed from (Q6). SET NULL on revision delete.
  datasheet_revision_id TEXT REFERENCES datasheet_revisions(id) ON DELETE SET NULL,
  -- Counterpart connector MPN actually mated in the real harness (Q7).
  related_mpn TEXT,
  -- Test fixture / board / cable / program identifier that depended on this part (Q9).
  depended_on_by TEXT,
  recorded_by TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_notes TEXT,
  evidence_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Reject empty titles at the SQL boundary. The API normalizer trims first and refuses
  -- whitespace-only titles, so this database backstop only ever rejects the truly empty string.
  CHECK (title <> ''),
  CHECK ((resolved_at IS NULL AND resolved_by IS NULL) OR (resolved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_part_engineering_records_part
  ON part_engineering_records(part_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_part_engineering_records_open
  ON part_engineering_records(part_id, record_kind)
  WHERE resolved_at IS NULL;
