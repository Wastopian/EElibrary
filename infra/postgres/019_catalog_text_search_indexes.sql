-- File header: Enables trigram text search for efficient leading-wildcard LIKE queries at catalog scale.
--
-- Without these indexes every free-text search does a sequential scan of all rows in parts,
-- manufacturers, packages, and source_records. At 600k+ parts that is 2-10 seconds per query.
-- With GIN trigram indexes the same queries resolve in ~10ms regardless of catalog size.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Parts: MPN is the primary engineer lookup field ("LM358", "STM32F4", "C0402").
CREATE INDEX IF NOT EXISTS idx_parts_mpn_trgm
  ON parts USING GIN (lower(mpn) gin_trgm_ops);

-- Parts: category drives browse and filter ("Resistors / Chip Resistor", "Connectors / USB").
CREATE INDEX IF NOT EXISTS idx_parts_category_trgm
  ON parts USING GIN (lower(category) gin_trgm_ops);

-- Manufacturers: searched in every free-text query ("Texas Instruments", "Molex", "FH").
CREATE INDEX IF NOT EXISTS idx_manufacturers_name_trgm
  ON manufacturers USING GIN (lower(name) gin_trgm_ops);

-- Packages: searched for form-factor lookups ("SOT-23", "0402", "QFP-64").
CREATE INDEX IF NOT EXISTS idx_packages_package_name_trgm
  ON packages USING GIN (lower(package_name) gin_trgm_ops);

-- Connector families: searched when the text query might match a connector series name.
CREATE INDEX IF NOT EXISTS idx_connector_families_name_trgm
  ON connector_families USING GIN (lower(name) gin_trgm_ops);

-- Source records: LCSC code lookups ("C1091", "C2040") resolve through provider_part_key.
CREATE INDEX IF NOT EXISTS idx_source_records_provider_part_key_trgm
  ON source_records USING GIN (lower(provider_part_key) gin_trgm_ops);

-- Manufacturers aliases array: enables trigram search over each alias element.
-- gin_trgm_ops on array columns requires unnesting; handled at query time via ILIKE ANY(aliases).
-- B-tree index on aliases for exact-array contains is sufficient for the current filter path.
CREATE INDEX IF NOT EXISTS idx_manufacturers_aliases
  ON manufacturers USING GIN (aliases);
