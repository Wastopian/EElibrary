-- File header: Adds supplier identity and retirement metadata to commercial snapshots.
-- Retired rows remain auditable in storage, while read APIs show only active
-- provider-visible offers so stale distributor rows do not masquerade as current.

ALTER TABLE supply_offerings
  ADD COLUMN IF NOT EXISTS supplier_name TEXT;

ALTER TABLE supply_offerings
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

ALTER TABLE supply_offerings
  ADD COLUMN IF NOT EXISTS retirement_reason TEXT;

DROP INDEX IF EXISTS uq_supply_offerings_provider_sku;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supply_offerings_provider_supplier_sku
  ON supply_offerings(part_id, provider_id, provider_part_key, supplier_name, provider_sku);

CREATE INDEX IF NOT EXISTS idx_supply_offerings_active_part
  ON supply_offerings(part_id, inventory_status, last_seen_at DESC)
  WHERE retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_supply_offerings_active_stale
  ON supply_offerings(last_seen_at, provider_id, provider_part_key)
  WHERE retired_at IS NULL;
