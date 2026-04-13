-- File header: Adds Phase 3A asset pipeline lookup indexes for part detail and generation workflows.

-- Part detail reads group assets by part and asset class.
CREATE INDEX IF NOT EXISTS idx_assets_part_id_asset_type ON assets(part_id, asset_type);

-- Generation options are resolved by part and target asset class.
CREATE INDEX IF NOT EXISTS idx_generation_workflows_part_id_target_asset_type ON generation_workflows(part_id, target_asset_type);
