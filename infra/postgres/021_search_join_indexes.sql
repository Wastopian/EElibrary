-- File header: Adds part_id indexes on the two LEFT-JOINed readiness/approval tables and a
-- connector_family_id index on parts. Without these, every search query that touches
-- part_readiness_summaries or part_approvals does a full table scan per matched part.
-- At 600k+ parts these joins dominate query time for filtered searches.

-- Enables nested-loop joins when few parts match a WHERE filter (the common case for
-- specific MPN/manufacturer searches). Hash join still wins for broad unfiltered scans;
-- Postgres picks the better plan automatically with these indexes present.
CREATE INDEX IF NOT EXISTS idx_part_readiness_summaries_part_id
  ON part_readiness_summaries(part_id);

CREATE INDEX IF NOT EXISTS idx_part_approvals_part_id
  ON part_approvals(part_id);

-- connector_family_id is not covered by any existing index on parts, so filtering
-- or joining on it (e.g., "show only connectors in this family") forces a seq scan.
CREATE INDEX IF NOT EXISTS idx_parts_connector_family_id
  ON parts(connector_family_id)
  WHERE connector_family_id IS NOT NULL;
