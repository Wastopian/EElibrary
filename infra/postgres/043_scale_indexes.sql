-- File header: Scale indexes for the hottest read paths at many-thousands of parts/projects.
--
-- These are pure-additive indexes (no data or behavior change) targeting the three seq-scan
-- hot spots an audit found would degrade past low-thousands of parts:
--
--   1. Confirmed/open engineering-memory lookups. Every catalog search row-set
--      (ENGINEERING_MEMORY_WARNING_ROWS_SQL), the project overlap panel
--      (readPriorEngineeringMemoryWarnings), and signed-bundle provenance
--      (buildExportBundlePartProvenance) filter
--      `draft_status='confirmed' AND resolved_at IS NULL` for a set of part ids.
--      Migration 041's index is (part_id, recorded_at DESC) with no draft_status,
--      and 042's partial index targets `draft_status='proposed'` — the opposite of
--      this hot path. Without this index every search re-scans all of a part's
--      records and re-filters in the executor.
--
--   2/3. Free-text catalog search LIKEs over source URLs. buildSearchSqlFilter emits
--      `lower(coalesce(sr.source_url,'')) LIKE $n` and a datasheet-asset
--      `lower(coalesce(a.source_url,'')) LIKE $n` subquery. Migration 019 added
--      trigram indexes for mpn/category/manufacturer/package/provider_part_key but
--      not source_url, so these two predicates are the last remaining sequential
--      scans of source_records and assets in free-text search.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Confirmed, unresolved engineering memory by part (the catalog/overlap/bundle hot path).
CREATE INDEX IF NOT EXISTS idx_part_engineering_records_confirmed_open
  ON part_engineering_records(part_id, recorded_at DESC)
  WHERE draft_status = 'confirmed' AND resolved_at IS NULL;

-- 2. Free-text search over provider/source URLs.
CREATE INDEX IF NOT EXISTS idx_source_records_source_url_trgm
  ON source_records USING GIN (lower(coalesce(source_url, '')) gin_trgm_ops);

-- 3. Free-text search over datasheet asset URLs (only datasheet rows are probed).
CREATE INDEX IF NOT EXISTS idx_assets_datasheet_source_url_trgm
  ON assets USING GIN (lower(coalesce(source_url, '')) gin_trgm_ops)
  WHERE asset_type = 'datasheet';
