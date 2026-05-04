ALTER TABLE parts ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_parts_description_trgm
  ON parts USING GIN (lower(description) gin_trgm_ops);
