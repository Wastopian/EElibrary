-- File header: Adds first-class interconnect memory for cable assemblies, fixtures, and pin maps.
-- This foundation keeps connector/cable/test-fixture knowledge queryable without treating
-- recorded wiring notes as approval, physical validation, or export readiness.

CREATE TABLE IF NOT EXISTS cable_assemblies (
  id TEXT PRIMARY KEY,
  cable_key TEXT NOT NULL,
  revision_label TEXT NOT NULL DEFAULT 'Working',
  assembly_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    assembly_status IN ('draft', 'in_review', 'approved', 'restricted', 'retired')
  ),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  project_revision_id TEXT REFERENCES project_revisions(id) ON DELETE SET NULL,
  owner TEXT,
  description TEXT,
  source_document_ref TEXT,
  provenance TEXT NOT NULL DEFAULT 'manual_internal' CHECK (
    provenance IN ('manual_internal', 'project_file', 'bom_import', 'connector_catalog')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cable_key, revision_label)
);

CREATE INDEX IF NOT EXISTS idx_cable_assemblies_project
  ON cable_assemblies(project_id, project_revision_id);
CREATE INDEX IF NOT EXISTS idx_cable_assemblies_status
  ON cable_assemblies(assembly_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS cable_assembly_ends (
  id TEXT PRIMARY KEY,
  cable_assembly_id TEXT NOT NULL REFERENCES cable_assemblies(id) ON DELETE CASCADE,
  end_label TEXT NOT NULL CHECK (end_label IN ('A', 'B', 'C', 'D', 'other')),
  connector_ref TEXT NOT NULL,
  connector_part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  mate_part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  backshell_part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cable_assembly_id, end_label, connector_ref)
);

CREATE INDEX IF NOT EXISTS idx_cable_assembly_ends_cable
  ON cable_assembly_ends(cable_assembly_id, end_label);
CREATE INDEX IF NOT EXISTS idx_cable_assembly_ends_connector_part
  ON cable_assembly_ends(connector_part_id);
CREATE INDEX IF NOT EXISTS idx_cable_assembly_ends_connector_ref
  ON cable_assembly_ends(upper(connector_ref));

CREATE TABLE IF NOT EXISTS test_fixtures (
  id TEXT PRIMARY KEY,
  fixture_key TEXT NOT NULL,
  revision_label TEXT NOT NULL DEFAULT 'Working',
  fixture_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    fixture_status IN ('draft', 'in_review', 'approved', 'restricted', 'retired')
  ),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  owner TEXT,
  purpose TEXT,
  source_document_ref TEXT,
  provenance TEXT NOT NULL DEFAULT 'manual_internal' CHECK (
    provenance IN ('manual_internal', 'project_file', 'bom_import', 'connector_catalog')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fixture_key, revision_label)
);

CREATE INDEX IF NOT EXISTS idx_test_fixtures_project
  ON test_fixtures(project_id);
CREATE INDEX IF NOT EXISTS idx_test_fixtures_status
  ON test_fixtures(fixture_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS fixture_ports (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES test_fixtures(id) ON DELETE CASCADE,
  connector_ref TEXT NOT NULL,
  connector_part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  mate_part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  cable_assembly_id TEXT REFERENCES cable_assemblies(id) ON DELETE SET NULL,
  port_role TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fixture_id, connector_ref)
);

CREATE INDEX IF NOT EXISTS idx_fixture_ports_fixture
  ON fixture_ports(fixture_id);
CREATE INDEX IF NOT EXISTS idx_fixture_ports_connector_part
  ON fixture_ports(connector_part_id);
CREATE INDEX IF NOT EXISTS idx_fixture_ports_connector_ref
  ON fixture_ports(upper(connector_ref));
CREATE INDEX IF NOT EXISTS idx_fixture_ports_cable
  ON fixture_ports(cable_assembly_id);

CREATE TABLE IF NOT EXISTS cable_pin_map_rows (
  id TEXT PRIMARY KEY,
  cable_assembly_id TEXT NOT NULL REFERENCES cable_assemblies(id) ON DELETE CASCADE,
  cable_end_id TEXT REFERENCES cable_assembly_ends(id) ON DELETE SET NULL,
  fixture_port_id TEXT REFERENCES fixture_ports(id) ON DELETE SET NULL,
  end_label TEXT NOT NULL CHECK (end_label IN ('A', 'B', 'C', 'D', 'other')),
  connector_ref TEXT NOT NULL,
  pin_number TEXT NOT NULL,
  signal_name TEXT NOT NULL,
  wire_color TEXT,
  wire_gauge INTEGER CHECK (wire_gauge IS NULL OR wire_gauge > 0),
  destination_connector_ref TEXT,
  destination_pin_number TEXT,
  confidence_score NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  evidence_attachment_id TEXT REFERENCES evidence_attachments(id) ON DELETE SET NULL,
  source_document_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cable_pin_map_rows_cable
  ON cable_pin_map_rows(cable_assembly_id, end_label, connector_ref);
CREATE INDEX IF NOT EXISTS idx_cable_pin_map_rows_signal
  ON cable_pin_map_rows(upper(signal_name));
CREATE INDEX IF NOT EXISTS idx_cable_pin_map_rows_pin
  ON cable_pin_map_rows(upper(connector_ref), upper(pin_number));
CREATE INDEX IF NOT EXISTS idx_cable_pin_map_rows_fixture_port
  ON cable_pin_map_rows(fixture_port_id);
