-- File header: Records institutional engineering memory for reusable circuit blocks.
--
-- A "known risk" is an explicit, provenance-bearing note about something an engineering team
-- discovered the hard way about a reusable block: an erratum that bites under cold-start,
-- a current/temperature limitation that only emerged in qualification, a layout hazard that
-- needs to be repeated whenever the block is reused. These are the notes that public
-- component search engines fundamentally cannot reproduce; they are private engineering
-- memory and the entire reason a team uses an internal library instead of starting from
-- Octopart every time.
--
-- Honesty contract:
--   * A known risk records what was observed; it is NOT a part-approval decision.
--   * `severity` is the recording engineer's classification, not an automated score.
--   * Resolving a risk (`resolved_at IS NOT NULL`) preserves the original observation; the
--     row never disappears, so a project that reused the block while the risk was open can
--     still be audited.
--   * `severity = 'blocking'` unresolved rows feed the reusable-stage gate of the
--     reuse-readiness strip — the only way a known risk changes reuse readiness is by being
--     `blocking` AND unresolved. Lower severities are surfaced but never block reuse.

CREATE TABLE IF NOT EXISTS circuit_block_known_risks (
  id TEXT PRIMARY KEY,
  circuit_block_id TEXT NOT NULL REFERENCES circuit_blocks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'caution' CHECK (
    severity IN ('info', 'limitation', 'caution', 'blocking')
  ),
  recorded_by TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_notes TEXT,
  evidence_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Reject empty titles at the SQL boundary. The API normalizer trims first and refuses
  -- whitespace-only titles before we reach this check, so the database backstop is intentionally
  -- permissive about whitespace but never accepts the truly empty string.
  CHECK (title <> ''),
  CHECK ((resolved_at IS NULL AND resolved_by IS NULL) OR (resolved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_circuit_block_known_risks_block
  ON circuit_block_known_risks(circuit_block_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_circuit_block_known_risks_active
  ON circuit_block_known_risks(circuit_block_id, severity)
  WHERE resolved_at IS NULL;
