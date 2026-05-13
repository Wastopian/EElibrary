-- File header: Adds provider-neutral supply offering and price-break snapshots.
-- Supply data is intentionally source-record-linked commercial context. It does not
-- promote a part to approved, procurement-ready, or live distributor authority.

CREATE TABLE IF NOT EXISTS supply_offerings (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  provider_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  provider_part_key TEXT NOT NULL,
  provider_sku TEXT,
  inventory_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    inventory_status IN ('in_stock', 'out_of_stock', 'backorder', 'unknown')
  ),
  inventory_quantity INTEGER CHECK (inventory_quantity IS NULL OR inventory_quantity >= 0),
  moq INTEGER CHECK (moq IS NULL OR moq >= 1),
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  packaging TEXT,
  currency_code TEXT NOT NULL DEFAULT 'USD' CHECK (
    currency_code LIKE '___' AND currency_code = upper(currency_code)
  ),
  preferred_rank INTEGER CHECK (preferred_rank IS NULL OR preferred_rank >= 1),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supply_offerings_part
  ON supply_offerings(part_id, inventory_status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_supply_offerings_source_record
  ON supply_offerings(source_record_id);
CREATE INDEX IF NOT EXISTS idx_supply_offerings_provider_part
  ON supply_offerings(provider_id, provider_part_key, last_seen_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supply_offerings_provider_sku
  ON supply_offerings(part_id, provider_id, provider_part_key, provider_sku);

CREATE TABLE IF NOT EXISTS price_breaks (
  id TEXT PRIMARY KEY,
  supply_offering_id TEXT NOT NULL REFERENCES supply_offerings(id) ON DELETE CASCADE,
  min_quantity INTEGER NOT NULL CHECK (min_quantity >= 1),
  unit_price NUMERIC(18, 8) NOT NULL CHECK (unit_price >= 0),
  currency_code TEXT NOT NULL DEFAULT 'USD' CHECK (
    currency_code LIKE '___' AND currency_code = upper(currency_code)
  ),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supply_offering_id, min_quantity, currency_code, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_price_breaks_offering
  ON price_breaks(supply_offering_id, min_quantity, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_breaks_price
  ON price_breaks(currency_code, unit_price, min_quantity);
