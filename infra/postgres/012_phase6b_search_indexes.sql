-- File header: Adds low-risk indexes for SQL-backed Phase 6B search and pagination.

-- Search filters and stable MPN sorting start from canonical part identity.
CREATE INDEX IF NOT EXISTS idx_parts_search_mpn_id ON parts(mpn, id);

-- Common filter combinations include manufacturer, category, package, lifecycle, and stable MPN order.
CREATE INDEX IF NOT EXISTS idx_parts_search_filters ON parts(manufacturer_id, category, package_id, lifecycle_status, mpn, id);

-- Recently-updated and trust-score sorts keep deterministic tie-breaks by MPN and id.
CREATE INDEX IF NOT EXISTS idx_parts_search_updated ON parts(last_updated_at DESC, mpn ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_parts_search_trust ON parts(trust_score DESC, mpn ASC, id ASC);

-- CAD availability filters check verified file-backed CAD evidence without scanning every asset row.
CREATE INDEX IF NOT EXISTS idx_assets_search_cad_export ON assets(part_id, asset_type, availability_status, export_status, validation_status);
