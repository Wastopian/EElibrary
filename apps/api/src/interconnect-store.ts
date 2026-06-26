/**
 * File header: Reads cable assembly, fixture, and pin-map memory from Postgres for the API service.
 */

import { Pool } from "pg";
import { CatalogStoreError } from "./catalog-store";
import type {
  CableAssembly,
  CableAssemblyDetail,
  CableAssemblyEnd,
  CableAssemblyEndInput,
  CableAssemblyEndLabel,
  CableAssemblyCreateInput,
  CableAssemblyUpdateInput,
  CablePinMapRow,
  CablePinMapRowInput,
  CableRevisionCompareResponse,
  CableRevisionListResponse,
  CableEndDiff,
  CablePinRowDiff,
  FixtureRevisionCompareResponse,
  FixtureRevisionListResponse,
  FixturePortDiff,
  InterconnectCompareSummary,
  InterconnectFieldChange,
  InterconnectRevisionSummary,
  PinMapImportResponse,
  PinMapImportSummary,
  PortListImportResponse,
  FixturePort,
  FixturePortInput,
  InterconnectDashboardResponse,
  InterconnectProvenance,
  InterconnectRecordStatus,
  InterconnectPartSummary,
  TestFixture,
  TestFixtureCreateInput,
  TestFixtureDetail,
  TestFixtureUpdateInput,
  WhereUsedInterconnectHitRecord
} from "@ee-library/shared/types";

/** INTERCONNECT_BOUNDARY_COPY explains what this first workspace does and does not decide. */
export const INTERCONNECT_BOUNDARY_COPY =
  "Interconnect records show what is on file for cables, fixture ports, and pin maps. They do not approve parts, prove a bench setup is safe, or make export files available.";

/** InterconnectDashboardReadResult reports whether the interconnect dashboard can be read. */
export type InterconnectDashboardReadResult =
  | { status: "available"; response: InterconnectDashboardResponse }
  | { status: "not_configured" };

/** INTERCONNECT_CABLE_LIMIT caps the workstation list before edit/search flows exist. */
const INTERCONNECT_CABLE_LIMIT = 50;

/** INTERCONNECT_FIXTURE_LIMIT caps fixture rows for the first dashboard slice. */
const INTERCONNECT_FIXTURE_LIMIT = 50;

/** INTERCONNECT_PIN_ROW_LIMIT caps pin-map rows so a large harness does not overwhelm the page. */
const INTERCONNECT_PIN_ROW_LIMIT = 200;

/** LOW_CONFIDENCE_PIN_THRESHOLD names the score below which pin rows need another check. */
const LOW_CONFIDENCE_PIN_THRESHOLD = 0.75;

/** INTERCONNECT_WHERE_USED_LIMIT caps each interconnect where-used result set so a big harness stays readable. */
const INTERCONNECT_WHERE_USED_LIMIT = 100;

/** pool is initialized lazily so local tests do not require DATABASE_URL. */
let pool: Pool | null = null;

/** interconnectPoolOverride lets tests share a pg-mem pool without touching DATABASE_URL. */
let interconnectPoolOverride: Pool | null | undefined;

/**
 * Overrides the interconnect pool for tests.
 */
export function setInterconnectPoolForTests(databasePool: Pool | null): void {
  interconnectPoolOverride = databasePool;
}

/** DatabaseInterconnectSummaryRow is the aggregate count row used by the dashboard hero. */
interface DatabaseInterconnectSummaryRow {
  cable_assembly_count: string | number;
  fixture_count: string | number;
  fixture_port_count: string | number;
  pin_map_row_count: string | number;
  approved_cable_assembly_count: string | number;
  restricted_record_count: string | number;
  low_confidence_pin_row_count: string | number;
}

/** DatabaseCableAssemblyRow is one persisted cable assembly with joined project context. */
interface DatabaseCableAssemblyRow {
  id: string;
  cable_key: string;
  revision_label: string;
  assembly_status: InterconnectRecordStatus;
  project_id: string | null;
  project_key: string | null;
  project_name: string | null;
  project_revision_id: string | null;
  project_revision_label: string | null;
  owner: string | null;
  description: string | null;
  source_document_ref: string | null;
  provenance: InterconnectProvenance;
  pin_row_count: string | number;
  fixture_port_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseCableAssemblyEndRow is one cable end with optional connector, mate, and backshell parts. */
interface DatabaseCableAssemblyEndRow {
  id: string;
  cable_assembly_id: string;
  end_label: CableAssemblyEndLabel;
  connector_ref: string;
  connector_part_id: string | null;
  connector_mpn: string | null;
  connector_manufacturer_name: string | null;
  mate_part_id: string | null;
  mate_mpn: string | null;
  mate_manufacturer_name: string | null;
  backshell_part_id: string | null;
  backshell_mpn: string | null;
  backshell_manufacturer_name: string | null;
  notes: string | null;
}

/** DatabaseTestFixtureRow is one persisted bench fixture with joined project context. */
interface DatabaseTestFixtureRow {
  id: string;
  fixture_key: string;
  revision_label: string;
  fixture_status: InterconnectRecordStatus;
  project_id: string | null;
  project_key: string | null;
  project_name: string | null;
  owner: string | null;
  purpose: string | null;
  source_document_ref: string | null;
  provenance: InterconnectProvenance;
  port_count: string | number;
  pin_row_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseFixturePortRow is one fixture connector with optional mate and cable links. */
interface DatabaseFixturePortRow {
  id: string;
  fixture_id: string;
  connector_ref: string;
  connector_part_id: string | null;
  connector_mpn: string | null;
  connector_manufacturer_name: string | null;
  mate_part_id: string | null;
  mate_mpn: string | null;
  mate_manufacturer_name: string | null;
  cable_assembly_id: string | null;
  cable_key: string | null;
  port_role: string | null;
  notes: string | null;
}

/** DatabaseCablePinMapRow is one persisted pin mapping joined to its cable identity. */
interface DatabaseCablePinMapRow {
  id: string;
  cable_assembly_id: string;
  cable_key: string;
  revision_label: string;
  cable_end_id: string | null;
  fixture_port_id: string | null;
  end_label: CableAssemblyEndLabel;
  connector_ref: string;
  pin_number: string;
  signal_name: string;
  wire_color: string | null;
  wire_gauge: number | null;
  destination_connector_ref: string | null;
  destination_pin_number: string | null;
  confidence_score: string | number;
  evidence_attachment_id: string | null;
  source_document_ref: string | null;
  notes: string | null;
}

/**
 * Reads the first Area 2 dashboard from persisted cable, fixture, and pin-map rows.
 */
export async function readInterconnectDashboardFromDatabase(): Promise<InterconnectDashboardReadResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const [summaryResult, cableResult, fixtureResult, pinMapResult] = await Promise.all([
      databasePool.query<DatabaseInterconnectSummaryRow>(
        `
          SELECT
            (SELECT COUNT(*)::text FROM cable_assemblies) AS cable_assembly_count,
            (SELECT COUNT(*)::text FROM test_fixtures) AS fixture_count,
            (SELECT COUNT(*)::text FROM fixture_ports) AS fixture_port_count,
            (SELECT COUNT(*)::text FROM cable_pin_map_rows) AS pin_map_row_count,
            (SELECT COUNT(*)::text FROM cable_assemblies WHERE assembly_status = 'approved') AS approved_cable_assembly_count,
            (
              (SELECT COUNT(*) FROM cable_assemblies WHERE assembly_status = 'restricted') +
              (SELECT COUNT(*) FROM test_fixtures WHERE fixture_status = 'restricted')
            )::text AS restricted_record_count,
            (SELECT COUNT(*)::text FROM cable_pin_map_rows WHERE confidence_score < $1) AS low_confidence_pin_row_count
        `,
        [LOW_CONFIDENCE_PIN_THRESHOLD]
      ),
      databasePool.query<DatabaseCableAssemblyRow>(
        `
          SELECT
            ca.id,
            ca.cable_key,
            ca.revision_label,
            ca.assembly_status,
            ca.project_id,
            p.project_key,
            p.name AS project_name,
            ca.project_revision_id,
            pr.revision_label AS project_revision_label,
            ca.owner,
            ca.description,
            ca.source_document_ref,
            ca.provenance,
            COALESCE(pin_counts.pin_row_count, 0)::text AS pin_row_count,
            COALESCE(fixture_counts.fixture_port_count, 0)::text AS fixture_port_count,
            ca.created_at,
            ca.updated_at
          FROM cable_assemblies ca
          LEFT JOIN projects p ON p.id = ca.project_id
          LEFT JOIN project_revisions pr ON pr.id = ca.project_revision_id
          LEFT JOIN (
            SELECT cable_assembly_id, COUNT(*) AS pin_row_count
            FROM cable_pin_map_rows
            GROUP BY cable_assembly_id
          ) pin_counts ON pin_counts.cable_assembly_id = ca.id
          LEFT JOIN (
            SELECT cable_assembly_id, COUNT(*) AS fixture_port_count
            FROM fixture_ports
            WHERE cable_assembly_id IS NOT NULL
            GROUP BY cable_assembly_id
          ) fixture_counts ON fixture_counts.cable_assembly_id = ca.id
          ORDER BY ca.updated_at DESC, ca.cable_key ASC
          LIMIT $1
        `,
        [INTERCONNECT_CABLE_LIMIT]
      ),
      databasePool.query<DatabaseTestFixtureRow>(
        `
          SELECT
            tf.id,
            tf.fixture_key,
            tf.revision_label,
            tf.fixture_status,
            tf.project_id,
            p.project_key,
            p.name AS project_name,
            tf.owner,
            tf.purpose,
            tf.source_document_ref,
            tf.provenance,
            COALESCE(port_counts.port_count, 0)::text AS port_count,
            COALESCE(pin_counts.pin_row_count, 0)::text AS pin_row_count,
            tf.created_at,
            tf.updated_at
          FROM test_fixtures tf
          LEFT JOIN projects p ON p.id = tf.project_id
          LEFT JOIN (
            SELECT fixture_id, COUNT(*) AS port_count
            FROM fixture_ports
            GROUP BY fixture_id
          ) port_counts ON port_counts.fixture_id = tf.id
          LEFT JOIN (
            SELECT fp.fixture_id, COUNT(cpm.id) AS pin_row_count
            FROM fixture_ports fp
            LEFT JOIN cable_pin_map_rows cpm ON cpm.fixture_port_id = fp.id
            GROUP BY fp.fixture_id
          ) pin_counts ON pin_counts.fixture_id = tf.id
          ORDER BY tf.updated_at DESC, tf.fixture_key ASC
          LIMIT $1
        `,
        [INTERCONNECT_FIXTURE_LIMIT]
      ),
      databasePool.query<DatabaseCablePinMapRow>(
        `
          SELECT
            cpm.id,
            cpm.cable_assembly_id,
            ca.cable_key,
            ca.revision_label,
            cpm.cable_end_id,
            cpm.fixture_port_id,
            cpm.end_label,
            cpm.connector_ref,
            cpm.pin_number,
            cpm.signal_name,
            cpm.wire_color,
            cpm.wire_gauge,
            cpm.destination_connector_ref,
            cpm.destination_pin_number,
            cpm.confidence_score,
            cpm.evidence_attachment_id,
            cpm.source_document_ref,
            cpm.notes
          FROM cable_pin_map_rows cpm
          JOIN cable_assemblies ca ON ca.id = cpm.cable_assembly_id
          ORDER BY cpm.updated_at DESC, ca.cable_key ASC, cpm.connector_ref ASC, cpm.pin_number ASC
          LIMIT $1
        `,
        [INTERCONNECT_PIN_ROW_LIMIT]
      )
    ]);

    const cableRows = cableResult.rows;
    const fixtureRows = fixtureResult.rows;
    const cableIds = cableRows.map((row) => row.id);
    const fixtureIds = fixtureRows.map((row) => row.id);
    const [endRows, portRows] = await Promise.all([
      readCableAssemblyEnds(databasePool, cableIds),
      readFixturePorts(databasePool, fixtureIds)
    ]);
    const endsByCableId = groupBy(endRows, (row) => row.cable_assembly_id);
    const portsByFixtureId = groupBy(portRows, (row) => row.fixture_id);
    const summary = mapSummaryRow(summaryResult.rows[0] ?? buildEmptySummaryRow());
    const response: InterconnectDashboardResponse = {
      boundary: INTERCONNECT_BOUNDARY_COPY,
      cableAssemblies: cableRows.map((row) => mapCableAssemblyRow(row, endsByCableId.get(row.id) ?? [])),
      fixtures: fixtureRows.map((row) => mapTestFixtureRow(row, portsByFixtureId.get(row.id) ?? [])),
      pinMapRows: pinMapResult.rows.map(mapCablePinMapRow),
      state: summary.cableAssemblyCount + summary.fixtureCount + summary.pinMapRowCount > 0 ? "available" : "empty",
      summary
    };

    return { status: "available", response };
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/**
 * Reads cable ends only when cable rows exist, avoiding invalid empty-array queries.
 */
async function readCableAssemblyEnds(databasePool: Pool, cableIds: string[]): Promise<DatabaseCableAssemblyEndRow[]> {
  if (cableIds.length === 0) {
    return [];
  }

  const result = await databasePool.query<DatabaseCableAssemblyEndRow>(
    `
      SELECT
        cae.id,
        cae.cable_assembly_id,
        cae.end_label,
        cae.connector_ref,
        connector_part.id AS connector_part_id,
        connector_part.mpn AS connector_mpn,
        connector_manufacturer.name AS connector_manufacturer_name,
        mate_part.id AS mate_part_id,
        mate_part.mpn AS mate_mpn,
        mate_manufacturer.name AS mate_manufacturer_name,
        backshell_part.id AS backshell_part_id,
        backshell_part.mpn AS backshell_mpn,
        backshell_manufacturer.name AS backshell_manufacturer_name,
        cae.notes
      FROM cable_assembly_ends cae
      LEFT JOIN parts connector_part ON connector_part.id = cae.connector_part_id
      LEFT JOIN manufacturers connector_manufacturer ON connector_manufacturer.id = connector_part.manufacturer_id
      LEFT JOIN parts mate_part ON mate_part.id = cae.mate_part_id
      LEFT JOIN manufacturers mate_manufacturer ON mate_manufacturer.id = mate_part.manufacturer_id
      LEFT JOIN parts backshell_part ON backshell_part.id = cae.backshell_part_id
      LEFT JOIN manufacturers backshell_manufacturer ON backshell_manufacturer.id = backshell_part.manufacturer_id
      WHERE cae.cable_assembly_id = ANY($1::text[])
      ORDER BY cae.cable_assembly_id ASC,
        CASE cae.end_label WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 ELSE 5 END,
        cae.connector_ref ASC
    `,
    [cableIds]
  );

  return result.rows;
}

/**
 * Reads fixture ports only when fixture rows exist, avoiding invalid empty-array queries.
 */
async function readFixturePorts(databasePool: Pool, fixtureIds: string[]): Promise<DatabaseFixturePortRow[]> {
  if (fixtureIds.length === 0) {
    return [];
  }

  const result = await databasePool.query<DatabaseFixturePortRow>(
    `
      SELECT
        fp.id,
        fp.fixture_id,
        fp.connector_ref,
        connector_part.id AS connector_part_id,
        connector_part.mpn AS connector_mpn,
        connector_manufacturer.name AS connector_manufacturer_name,
        mate_part.id AS mate_part_id,
        mate_part.mpn AS mate_mpn,
        mate_manufacturer.name AS mate_manufacturer_name,
        fp.cable_assembly_id,
        ca.cable_key,
        fp.port_role,
        fp.notes
      FROM fixture_ports fp
      LEFT JOIN parts connector_part ON connector_part.id = fp.connector_part_id
      LEFT JOIN manufacturers connector_manufacturer ON connector_manufacturer.id = connector_part.manufacturer_id
      LEFT JOIN parts mate_part ON mate_part.id = fp.mate_part_id
      LEFT JOIN manufacturers mate_manufacturer ON mate_manufacturer.id = mate_part.manufacturer_id
      LEFT JOIN cable_assemblies ca ON ca.id = fp.cable_assembly_id
      WHERE fp.fixture_id = ANY($1::text[])
      ORDER BY fp.fixture_id ASC, fp.connector_ref ASC
    `,
    [fixtureIds]
  );

  return result.rows;
}

/** DatabasePinMapHitRow is one pin-map row joined to its cable identity for where-used search. */
interface DatabasePinMapHitRow {
  id: string;
  cable_key: string;
  revision_label: string;
  assembly_status: InterconnectRecordStatus;
  project_key: string | null;
  end_label: CableAssemblyEndLabel;
  connector_ref: string;
  pin_number: string;
  signal_name: string;
  destination_connector_ref: string | null;
  destination_pin_number: string | null;
  wire_color: string | null;
  wire_gauge: number | null;
  confidence_score: string | number;
}

/** DatabaseCableEndHitRow is one cable end joined to its cable identity for where-used search. */
interface DatabaseCableEndHitRow {
  id: string;
  cable_key: string;
  revision_label: string;
  assembly_status: InterconnectRecordStatus;
  project_key: string | null;
  end_label: CableAssemblyEndLabel;
  connector_ref: string;
}

/** DatabaseFixturePortHitRow is one fixture port joined to its fixture identity for where-used search. */
interface DatabaseFixturePortHitRow {
  id: string;
  fixture_key: string;
  revision_label: string;
  fixture_status: InterconnectRecordStatus;
  project_key: string | null;
  connector_ref: string;
  port_role: string | null;
}

/**
 * Searches persisted interconnect memory (cables, fixture ports, pin maps) for one free-text
 * identifier — a connector ref like `J202`, a cable or fixture key, a pin number, or a signal name.
 * Connector refs and pin numbers match exactly (case-insensitive); cable/fixture keys and signal
 * names match as substrings, using the `upper(...)` indexes added with the interconnect schema.
 *
 * This reads recorded wiring memory only. A returned row never approves a part, proves a bench
 * setup is safe, or unlocks export — the where-used workspace repeats that boundary.
 */
export async function searchInterconnectWhereUsed(databasePool: Pool, query: string): Promise<WhereUsedInterconnectHitRecord[]> {
  const normalizedQuery = query.trim();

  if (normalizedQuery.length === 0) {
    return [];
  }

  const [pinRows, endRows, portRows] = await Promise.all([
    databasePool.query<DatabasePinMapHitRow>(
      `
        SELECT
          cpm.id,
          ca.cable_key,
          ca.revision_label,
          ca.assembly_status,
          p.project_key,
          cpm.end_label,
          cpm.connector_ref,
          cpm.pin_number,
          cpm.signal_name,
          cpm.destination_connector_ref,
          cpm.destination_pin_number,
          cpm.wire_color,
          cpm.wire_gauge,
          cpm.confidence_score
        FROM cable_pin_map_rows cpm
        JOIN cable_assemblies ca ON ca.id = cpm.cable_assembly_id
        LEFT JOIN projects p ON p.id = ca.project_id
        WHERE upper(cpm.connector_ref) = upper($1)
           OR upper(cpm.destination_connector_ref) = upper($1)
           OR upper(cpm.pin_number) = upper($1)
           OR upper(cpm.signal_name) LIKE '%' || upper($1) || '%'
           OR upper(ca.cable_key) LIKE '%' || upper($1) || '%'
        ORDER BY ca.cable_key ASC, cpm.connector_ref ASC, cpm.pin_number ASC
        LIMIT $2
      `,
      [normalizedQuery, INTERCONNECT_WHERE_USED_LIMIT]
    ),
    databasePool.query<DatabaseCableEndHitRow>(
      `
        SELECT
          cae.id,
          ca.cable_key,
          ca.revision_label,
          ca.assembly_status,
          p.project_key,
          cae.end_label,
          cae.connector_ref
        FROM cable_assembly_ends cae
        JOIN cable_assemblies ca ON ca.id = cae.cable_assembly_id
        LEFT JOIN projects p ON p.id = ca.project_id
        WHERE upper(cae.connector_ref) = upper($1)
           OR upper(ca.cable_key) LIKE '%' || upper($1) || '%'
        ORDER BY ca.cable_key ASC,
          CASE cae.end_label WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 ELSE 5 END,
          cae.connector_ref ASC
        LIMIT $2
      `,
      [normalizedQuery, INTERCONNECT_WHERE_USED_LIMIT]
    ),
    databasePool.query<DatabaseFixturePortHitRow>(
      `
        SELECT
          fp.id,
          tf.fixture_key,
          tf.revision_label,
          tf.fixture_status,
          p.project_key,
          fp.connector_ref,
          fp.port_role
        FROM fixture_ports fp
        JOIN test_fixtures tf ON tf.id = fp.fixture_id
        LEFT JOIN projects p ON p.id = tf.project_id
        WHERE upper(fp.connector_ref) = upper($1)
           OR upper(tf.fixture_key) LIKE '%' || upper($1) || '%'
        ORDER BY tf.fixture_key ASC, fp.connector_ref ASC
        LIMIT $2
      `,
      [normalizedQuery, INTERCONNECT_WHERE_USED_LIMIT]
    )
  ]);

  return [
    ...pinRows.rows.map((row) => mapPinMapHitRow(row, normalizedQuery)),
    ...endRows.rows.map((row) => mapCableEndHitRow(row, normalizedQuery)),
    ...portRows.rows.map((row) => mapFixturePortHitRow(row, normalizedQuery))
  ];
}

/**
 * Maps one matched pin-map row into the shared where-used contract with plain match labels.
 */
function mapPinMapHitRow(row: DatabasePinMapHitRow, query: string): WhereUsedInterconnectHitRecord {
  const matchedLabels: string[] = [];
  if (equalsIgnoreCase(row.connector_ref, query)) matchedLabels.push(`Connector ref ${row.connector_ref}`);
  if (equalsIgnoreCase(row.destination_connector_ref, query)) matchedLabels.push(`Destination connector ${row.destination_connector_ref}`);
  if (equalsIgnoreCase(row.pin_number, query)) matchedLabels.push(`Pin ${row.pin_number}`);
  if (containsIgnoreCase(row.signal_name, query)) matchedLabels.push(`Signal ${row.signal_name}`);
  if (containsIgnoreCase(row.cable_key, query)) matchedLabels.push(`Cable ${row.cable_key}`);

  return {
    cableKey: row.cable_key,
    confidenceScore: toNumber(row.confidence_score),
    connectorRef: row.connector_ref,
    destinationConnectorRef: row.destination_connector_ref,
    destinationPinNumber: row.destination_pin_number,
    endLabel: row.end_label,
    fixtureKey: null,
    kind: "pin_map_row",
    matchedLabels,
    pinNumber: row.pin_number,
    projectKey: row.project_key,
    recordId: row.id,
    revisionLabel: row.revision_label,
    signalName: row.signal_name,
    status: row.assembly_status,
    wireColor: row.wire_color,
    wireGauge: row.wire_gauge
  };
}

/**
 * Maps one matched cable end into the shared where-used contract with plain match labels.
 */
function mapCableEndHitRow(row: DatabaseCableEndHitRow, query: string): WhereUsedInterconnectHitRecord {
  const matchedLabels: string[] = [];
  if (equalsIgnoreCase(row.connector_ref, query)) matchedLabels.push(`Connector ref ${row.connector_ref}`);
  if (containsIgnoreCase(row.cable_key, query)) matchedLabels.push(`Cable ${row.cable_key}`);

  return {
    cableKey: row.cable_key,
    confidenceScore: null,
    connectorRef: row.connector_ref,
    destinationConnectorRef: null,
    destinationPinNumber: null,
    endLabel: row.end_label,
    fixtureKey: null,
    kind: "cable_end",
    matchedLabels,
    pinNumber: null,
    projectKey: row.project_key,
    recordId: row.id,
    revisionLabel: row.revision_label,
    signalName: null,
    status: row.assembly_status,
    wireColor: null,
    wireGauge: null
  };
}

/**
 * Maps one matched fixture port into the shared where-used contract with plain match labels.
 */
function mapFixturePortHitRow(row: DatabaseFixturePortHitRow, query: string): WhereUsedInterconnectHitRecord {
  const matchedLabels: string[] = [];
  if (equalsIgnoreCase(row.connector_ref, query)) matchedLabels.push(`Connector ref ${row.connector_ref}`);
  if (containsIgnoreCase(row.fixture_key, query)) matchedLabels.push(`Fixture ${row.fixture_key}`);

  return {
    cableKey: null,
    confidenceScore: null,
    connectorRef: row.connector_ref,
    destinationConnectorRef: null,
    destinationPinNumber: null,
    endLabel: null,
    fixtureKey: row.fixture_key,
    kind: "fixture_port",
    matchedLabels,
    pinNumber: null,
    projectKey: row.project_key,
    recordId: row.id,
    revisionLabel: row.revision_label,
    signalName: null,
    status: row.fixture_status,
    wireColor: null,
    wireGauge: null
  };
}

/**
 * Compares two strings without case sensitivity, treating null as no match.
 */
function equalsIgnoreCase(value: string | null, query: string): boolean {
  return value !== null && value.toUpperCase() === query.toUpperCase();
}

/**
 * Checks whether a value contains the query as a case-insensitive substring, treating null as no match.
 */
function containsIgnoreCase(value: string | null, query: string): boolean {
  return value !== null && value.toUpperCase().includes(query.toUpperCase());
}

/**
 * Maps one aggregate row into the shared dashboard summary contract.
 */
function mapSummaryRow(row: DatabaseInterconnectSummaryRow) {
  return {
    approvedCableAssemblyCount: toNumber(row.approved_cable_assembly_count),
    cableAssemblyCount: toNumber(row.cable_assembly_count),
    fixtureCount: toNumber(row.fixture_count),
    fixturePortCount: toNumber(row.fixture_port_count),
    lowConfidencePinRowCount: toNumber(row.low_confidence_pin_row_count),
    pinMapRowCount: toNumber(row.pin_map_row_count),
    restrictedRecordCount: toNumber(row.restricted_record_count)
  };
}

/**
 * Builds an empty summary row for defensive mapping if Postgres returns no aggregate row.
 */
function buildEmptySummaryRow(): DatabaseInterconnectSummaryRow {
  return {
    approved_cable_assembly_count: 0,
    cable_assembly_count: 0,
    fixture_count: 0,
    fixture_port_count: 0,
    low_confidence_pin_row_count: 0,
    pin_map_row_count: 0,
    restricted_record_count: 0
  };
}

/**
 * Maps one cable assembly row and its child ends into the shared contract.
 */
function mapCableAssemblyRow(row: DatabaseCableAssemblyRow, endRows: DatabaseCableAssemblyEndRow[]): CableAssembly {
  return {
    assemblyStatus: row.assembly_status,
    cableKey: row.cable_key,
    createdAt: toIsoTimestamp(row.created_at),
    description: row.description,
    ends: endRows.map(mapCableAssemblyEndRow),
    fixturePortCount: toNumber(row.fixture_port_count),
    id: row.id,
    owner: row.owner,
    pinRowCount: toNumber(row.pin_row_count),
    projectId: row.project_id,
    projectKey: row.project_key,
    projectName: row.project_name,
    projectRevisionId: row.project_revision_id,
    projectRevisionLabel: row.project_revision_label,
    provenance: row.provenance,
    revisionLabel: row.revision_label,
    sourceDocumentRef: row.source_document_ref,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps one physical cable end into the shared contract.
 */
function mapCableAssemblyEndRow(row: DatabaseCableAssemblyEndRow): CableAssemblyEnd {
  return {
    backshellPart: mapPartSummary(row.backshell_part_id, row.backshell_mpn, row.backshell_manufacturer_name),
    cableAssemblyId: row.cable_assembly_id,
    connectorPart: mapPartSummary(row.connector_part_id, row.connector_mpn, row.connector_manufacturer_name),
    connectorRef: row.connector_ref,
    endLabel: row.end_label,
    id: row.id,
    matePart: mapPartSummary(row.mate_part_id, row.mate_mpn, row.mate_manufacturer_name),
    notes: row.notes
  };
}

/**
 * Maps one test fixture row and its child ports into the shared contract.
 */
function mapTestFixtureRow(row: DatabaseTestFixtureRow, portRows: DatabaseFixturePortRow[]): TestFixture {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    fixtureKey: row.fixture_key,
    fixtureStatus: row.fixture_status,
    id: row.id,
    owner: row.owner,
    pinRowCount: toNumber(row.pin_row_count),
    ports: portRows.map(mapFixturePortRow),
    projectId: row.project_id,
    projectKey: row.project_key,
    projectName: row.project_name,
    provenance: row.provenance,
    purpose: row.purpose,
    revisionLabel: row.revision_label,
    sourceDocumentRef: row.source_document_ref,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps one fixture port into the shared contract.
 */
function mapFixturePortRow(row: DatabaseFixturePortRow): FixturePort {
  return {
    cableAssemblyId: row.cable_assembly_id,
    cableKey: row.cable_key,
    connectorPart: mapPartSummary(row.connector_part_id, row.connector_mpn, row.connector_manufacturer_name),
    connectorRef: row.connector_ref,
    fixtureId: row.fixture_id,
    id: row.id,
    matePart: mapPartSummary(row.mate_part_id, row.mate_mpn, row.mate_manufacturer_name),
    notes: row.notes,
    portRole: row.port_role
  };
}

/**
 * Maps one pin-map row into the shared dashboard contract.
 */
function mapCablePinMapRow(row: DatabaseCablePinMapRow): CablePinMapRow {
  return {
    cableAssemblyId: row.cable_assembly_id,
    cableEndId: row.cable_end_id,
    cableKey: row.cable_key,
    confidenceScore: toNumber(row.confidence_score),
    connectorRef: row.connector_ref,
    destinationConnectorRef: row.destination_connector_ref,
    destinationPinNumber: row.destination_pin_number,
    endLabel: row.end_label,
    evidenceAttachmentId: row.evidence_attachment_id,
    fixturePortId: row.fixture_port_id,
    id: row.id,
    notes: row.notes,
    pinNumber: row.pin_number,
    revisionLabel: row.revision_label,
    signalName: row.signal_name,
    sourceDocumentRef: row.source_document_ref,
    wireColor: row.wire_color,
    wireGauge: row.wire_gauge
  };
}

/**
 * Maps optional part joins without pretending an unmatched connector reference is identified.
 */
function mapPartSummary(partId: string | null, mpn: string | null, manufacturerName: string | null): InterconnectPartSummary {
  return {
    manufacturerName,
    mpn,
    partId
  };
}

/**
 * Groups rows by a string key while preserving their original order inside each group.
 */
function groupBy<TValue>(rows: TValue[], readKey: (row: TValue) => string): Map<string, TValue[]> {
  const grouped = new Map<string, TValue[]>();

  for (const row of rows) {
    const key = readKey(row);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  return grouped;
}

/**
 * Lazily creates the Postgres pool when DATABASE_URL exists, unless a test override is set.
 */
function getInterconnectDatabasePool(): Pool | null {
  if (interconnectPoolOverride !== undefined) {
    return interconnectPoolOverride;
  }

  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  return pool;
}

/**
 * Converts stringified Postgres numerics into plain numbers for API responses.
 */
function toNumber(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Normalizes Postgres timestamps into ISO strings for the web app.
 */
function toIsoTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

/**
 * Converts low-level pg errors into the API's catalog-store error envelope.
 */
function toInterconnectStoreError(error: unknown): CatalogStoreError {
  if (error instanceof CatalogStoreError) {
    return error;
  }

  if (hasPgErrorCode(error, "42P01") || hasPgErrorCode(error, "42703")) {
    return new CatalogStoreError("schema_mismatch", "Interconnect memory tables do not match the API query contract.", error);
  }

  if (hasPgErrorCode(error, "ECONNREFUSED") || hasPgErrorCode(error, "ENOTFOUND")) {
    return new CatalogStoreError("database_unavailable", "Interconnect memory database is configured but unavailable.", error);
  }

  return new CatalogStoreError("query_failed", "Interconnect memory query failed.", error);
}

/**
 * Checks the pg error code without depending on pg's internal error classes.
 */
function hasPgErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

// ===========================================================================
// Cable assembly authoring (create / edit / retire)
//
// Honesty boundary: recording cable memory never approves a part, validates an
// asset, proves a bench setup is safe, or unlocks export. Status — including
// `approved` — is recorded engineering memory, not an approval gate.
// ===========================================================================

/** CABLE_AUTHORING_BOUNDARY is repeated on every cable mutation response. */
export const CABLE_AUTHORING_BOUNDARY =
  "Recording cable memory keeps engineering history; it does not approve a part, validate an asset, prove a bench setup is safe, or unlock export. Status is recorded memory, not approval.";

/** ALLOWED_INTERCONNECT_STATUSES lists every cable/fixture status the writer accepts. */
const ALLOWED_INTERCONNECT_STATUSES: InterconnectRecordStatus[] = ["draft", "in_review", "approved", "restricted", "retired"];

/** ALLOWED_END_LABELS lists every connector-end label the writer accepts. */
const ALLOWED_END_LABELS: CableAssemblyEndLabel[] = ["A", "B", "C", "D", "other"];

/** CableAssemblyDetailReadResult reports single-cable detail availability. */
export type CableAssemblyDetailReadResult =
  | { status: "available"; response: CableAssemblyDetail }
  | { status: "not_configured" }
  | { status: "not_found" };

/** CableAssemblyMutationResult is the shared outcome union for every cable write. */
export type CableAssemblyMutationResult =
  | { status: "created" | "updated" | "deleted"; response: CableAssemblyDetail }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string }
  | { status: "invalid"; code: string; message: string };

/** NormalizeResult carries either validated values or a friendly invalid reason. */
type NormalizeResult<TValue> = { ok: true; value: TValue } | { ok: false; code: string; message: string };

/** DatabaseCableEditableRow holds the raw editable header columns for merge-on-update. */
interface DatabaseCableEditableRow {
  cable_key: string;
  revision_label: string;
  assembly_status: InterconnectRecordStatus;
  project_id: string | null;
  project_revision_id: string | null;
  owner: string | null;
  description: string | null;
  source_document_ref: string | null;
}

/**
 * Reads one cable's full authoring detail: header (with ends) plus all pin-map rows.
 */
export async function readCableAssemblyDetailFromDatabase(cableId: string): Promise<CableAssemblyDetailReadResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const detail = await buildCableAssemblyDetail(databasePool, cableId);
    return detail ? { status: "available", response: detail } : { status: "not_found" };
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/**
 * Creates one cable assembly header from in-app authoring input.
 */
export async function createCableAssemblyInDatabase(input: CableAssemblyCreateInput): Promise<CableAssemblyMutationResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const normalized = normalizeCableHeader(
      {
        assemblyStatus: input.assemblyStatus ?? "draft",
        cableKey: input.cableKey,
        description: input.description,
        owner: input.owner,
        projectId: input.projectId,
        projectRevisionId: input.projectRevisionId,
        revisionLabel: input.revisionLabel,
        sourceDocumentRef: input.sourceDocumentRef
      }
    );

    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    const referenceError = await checkCableReferences(databasePool, normalized.value);
    if (referenceError) {
      return referenceError;
    }

    if (await cableKeyRevisionExists(databasePool, normalized.value.cableKey, normalized.value.revisionLabel, null)) {
      return {
        code: "DUPLICATE_CABLE_KEY",
        message: `A cable "${normalized.value.cableKey}" revision "${normalized.value.revisionLabel}" already exists. Use a different revision label.`,
        status: "invalid"
      };
    }

    const now = new Date();
    const cableId = buildInterconnectId("cable", normalized.value.cableKey);

    await databasePool.query(
      `
        INSERT INTO cable_assemblies (
          id, cable_key, revision_label, assembly_status, project_id, project_revision_id,
          owner, description, source_document_ref, provenance, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual_internal', $10, $10)
      `,
      [
        cableId,
        normalized.value.cableKey,
        normalized.value.revisionLabel,
        normalized.value.assemblyStatus,
        normalized.value.projectId,
        normalized.value.projectRevisionId,
        normalized.value.owner,
        normalized.value.description,
        normalized.value.sourceDocumentRef,
        now
      ]
    );

    return await respondWithDetail(databasePool, cableId, "created");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/**
 * Edits one cable assembly header. Provided fields are applied; nullable fields passed as
 * null are cleared; omitted fields are preserved. Setting status to `retired` soft-retires it.
 */
export async function updateCableAssemblyInDatabase(cableId: string, input: CableAssemblyUpdateInput): Promise<CableAssemblyMutationResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const existing = await readCableEditableRow(databasePool, cableId);
    if (!existing) {
      return { code: "CABLE_NOT_FOUND", message: "Cable assembly not found.", status: "not_found" };
    }

    const normalized = normalizeCableHeader({
      assemblyStatus: input.assemblyStatus === undefined ? existing.assembly_status : (input.assemblyStatus ?? existing.assembly_status),
      cableKey: input.cableKey === undefined ? existing.cable_key : input.cableKey,
      description: input.description === undefined ? existing.description : input.description,
      owner: input.owner === undefined ? existing.owner : input.owner,
      projectId: input.projectId === undefined ? existing.project_id : input.projectId,
      projectRevisionId: input.projectRevisionId === undefined ? existing.project_revision_id : input.projectRevisionId,
      revisionLabel: input.revisionLabel === undefined ? existing.revision_label : input.revisionLabel,
      sourceDocumentRef: input.sourceDocumentRef === undefined ? existing.source_document_ref : input.sourceDocumentRef
    });

    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    const referenceError = await checkCableReferences(databasePool, normalized.value);
    if (referenceError) {
      return referenceError;
    }

    if (await cableKeyRevisionExists(databasePool, normalized.value.cableKey, normalized.value.revisionLabel, cableId)) {
      return {
        code: "DUPLICATE_CABLE_KEY",
        message: `A cable "${normalized.value.cableKey}" revision "${normalized.value.revisionLabel}" already exists. Use a different revision label.`,
        status: "invalid"
      };
    }

    await databasePool.query(
      `
        UPDATE cable_assemblies
        SET cable_key = $2, revision_label = $3, assembly_status = $4, project_id = $5,
            project_revision_id = $6, owner = $7, description = $8, source_document_ref = $9, updated_at = $10
        WHERE id = $1
      `,
      [
        cableId,
        normalized.value.cableKey,
        normalized.value.revisionLabel,
        normalized.value.assemblyStatus,
        normalized.value.projectId,
        normalized.value.projectRevisionId,
        normalized.value.owner,
        normalized.value.description,
        normalized.value.sourceDocumentRef,
        new Date()
      ]
    );

    return await respondWithDetail(databasePool, cableId, "updated");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/**
 * Adds one connector end to a cable assembly.
 */
export async function createCableAssemblyEndInDatabase(cableId: string, input: CableAssemblyEndInput): Promise<CableAssemblyMutationResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await cableExists(databasePool, cableId))) {
      return { code: "CABLE_NOT_FOUND", message: "Cable assembly not found.", status: "not_found" };
    }

    const normalized = normalizeEndInput(input);
    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    const partError = await checkEndPartReferences(databasePool, normalized.value);
    if (partError) {
      return partError;
    }

    if (await cableEndExists(databasePool, cableId, normalized.value.endLabel, normalized.value.connectorRef, null)) {
      return {
        code: "DUPLICATE_CABLE_END",
        message: `End ${normalized.value.endLabel} already has connector ${normalized.value.connectorRef} on this cable.`,
        status: "invalid"
      };
    }

    const endId = buildInterconnectId("cable-end", `${cableId}-${normalized.value.endLabel}-${normalized.value.connectorRef}`);
    await databasePool.query(
      `
        INSERT INTO cable_assembly_ends (
          id, cable_assembly_id, end_label, connector_ref, connector_part_id, mate_part_id, backshell_part_id, notes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      `,
      [
        endId,
        cableId,
        normalized.value.endLabel,
        normalized.value.connectorRef,
        normalized.value.connectorPartId,
        normalized.value.matePartId,
        normalized.value.backshellPartId,
        normalized.value.notes,
        new Date()
      ]
    );

    await touchCable(databasePool, cableId);
    return await respondWithDetail(databasePool, cableId, "created");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/**
 * Edits one connector end on a cable assembly.
 */
export async function updateCableAssemblyEndInDatabase(cableId: string, endId: string, input: CableAssemblyEndInput): Promise<CableAssemblyMutationResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await cableEndBelongsToCable(databasePool, cableId, endId))) {
      return { code: "CABLE_END_NOT_FOUND", message: "Connector end not found on this cable.", status: "not_found" };
    }

    const normalized = normalizeEndInput(input);
    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    const partError = await checkEndPartReferences(databasePool, normalized.value);
    if (partError) {
      return partError;
    }

    if (await cableEndExists(databasePool, cableId, normalized.value.endLabel, normalized.value.connectorRef, endId)) {
      return {
        code: "DUPLICATE_CABLE_END",
        message: `End ${normalized.value.endLabel} already has connector ${normalized.value.connectorRef} on this cable.`,
        status: "invalid"
      };
    }

    await databasePool.query(
      `
        UPDATE cable_assembly_ends
        SET end_label = $3, connector_ref = $4, connector_part_id = $5, mate_part_id = $6, backshell_part_id = $7, notes = $8, updated_at = $9
        WHERE id = $2 AND cable_assembly_id = $1
      `,
      [
        cableId,
        endId,
        normalized.value.endLabel,
        normalized.value.connectorRef,
        normalized.value.connectorPartId,
        normalized.value.matePartId,
        normalized.value.backshellPartId,
        normalized.value.notes,
        new Date()
      ]
    );

    await touchCable(databasePool, cableId);
    return await respondWithDetail(databasePool, cableId, "updated");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/**
 * Deletes one connector end from a cable assembly. The parent cable's history is preserved.
 */
export async function deleteCableAssemblyEndInDatabase(cableId: string, endId: string): Promise<CableAssemblyMutationResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await cableEndBelongsToCable(databasePool, cableId, endId))) {
      return { code: "CABLE_END_NOT_FOUND", message: "Connector end not found on this cable.", status: "not_found" };
    }

    await databasePool.query("DELETE FROM cable_assembly_ends WHERE id = $1 AND cable_assembly_id = $2", [endId, cableId]);
    await touchCable(databasePool, cableId);
    return await respondWithDetail(databasePool, cableId, "deleted");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/**
 * Adds one pin-map row to a cable assembly.
 */
export async function createCablePinMapRowInDatabase(cableId: string, input: CablePinMapRowInput): Promise<CableAssemblyMutationResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await cableExists(databasePool, cableId))) {
      return { code: "CABLE_NOT_FOUND", message: "Cable assembly not found.", status: "not_found" };
    }

    const normalized = normalizePinRowInput(input);
    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    const rowId = buildInterconnectId("pin", `${cableId}-${normalized.value.connectorRef}-${normalized.value.pinNumber}`);
    await databasePool.query(
      `
        INSERT INTO cable_pin_map_rows (
          id, cable_assembly_id, cable_end_id, fixture_port_id, end_label, connector_ref, pin_number,
          signal_name, wire_color, wire_gauge, destination_connector_ref, destination_pin_number,
          confidence_score, source_document_ref, notes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
      `,
      [
        rowId,
        cableId,
        normalized.value.cableEndId,
        normalized.value.fixturePortId,
        normalized.value.endLabel,
        normalized.value.connectorRef,
        normalized.value.pinNumber,
        normalized.value.signalName,
        normalized.value.wireColor,
        normalized.value.wireGauge,
        normalized.value.destinationConnectorRef,
        normalized.value.destinationPinNumber,
        normalized.value.confidenceScore,
        normalized.value.sourceDocumentRef,
        normalized.value.notes,
        new Date()
      ]
    );

    await touchCable(databasePool, cableId);
    return await respondWithDetail(databasePool, cableId, "created");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/**
 * Edits one pin-map row on a cable assembly.
 */
export async function updateCablePinMapRowInDatabase(cableId: string, rowId: string, input: CablePinMapRowInput): Promise<CableAssemblyMutationResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await pinRowBelongsToCable(databasePool, cableId, rowId))) {
      return { code: "PIN_ROW_NOT_FOUND", message: "Pin-map row not found on this cable.", status: "not_found" };
    }

    const normalized = normalizePinRowInput(input);
    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    await databasePool.query(
      `
        UPDATE cable_pin_map_rows
        SET cable_end_id = $3, fixture_port_id = $4, end_label = $5, connector_ref = $6, pin_number = $7,
            signal_name = $8, wire_color = $9, wire_gauge = $10, destination_connector_ref = $11,
            destination_pin_number = $12, confidence_score = $13, source_document_ref = $14, notes = $15, updated_at = $16
        WHERE id = $2 AND cable_assembly_id = $1
      `,
      [
        cableId,
        rowId,
        normalized.value.cableEndId,
        normalized.value.fixturePortId,
        normalized.value.endLabel,
        normalized.value.connectorRef,
        normalized.value.pinNumber,
        normalized.value.signalName,
        normalized.value.wireColor,
        normalized.value.wireGauge,
        normalized.value.destinationConnectorRef,
        normalized.value.destinationPinNumber,
        normalized.value.confidenceScore,
        normalized.value.sourceDocumentRef,
        normalized.value.notes,
        new Date()
      ]
    );

    await touchCable(databasePool, cableId);
    return await respondWithDetail(databasePool, cableId, "updated");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/**
 * Deletes one pin-map row from a cable assembly.
 */
export async function deleteCablePinMapRowInDatabase(cableId: string, rowId: string): Promise<CableAssemblyMutationResult> {
  const databasePool = getInterconnectDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await pinRowBelongsToCable(databasePool, cableId, rowId))) {
      return { code: "PIN_ROW_NOT_FOUND", message: "Pin-map row not found on this cable.", status: "not_found" };
    }

    await databasePool.query("DELETE FROM cable_pin_map_rows WHERE id = $1 AND cable_assembly_id = $2", [rowId, cableId]);
    await touchCable(databasePool, cableId);
    return await respondWithDetail(databasePool, cableId, "deleted");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Builds a mutation success result by re-reading the cable detail after a write. */
async function respondWithDetail(databasePool: Pool, cableId: string, status: "created" | "updated" | "deleted"): Promise<CableAssemblyMutationResult> {
  const detail = await buildCableAssemblyDetail(databasePool, cableId);
  if (!detail) {
    throw new CatalogStoreError("query_failed", "Cable detail was missing immediately after a write.", new Error("missing_cable_detail_after_write"));
  }
  return { response: detail, status };
}

/** Reads one cable's header, ends, and pin rows into the shared detail contract. */
async function buildCableAssemblyDetail(databasePool: Pool, cableId: string): Promise<CableAssemblyDetail | null> {
  const cableRow = await readCableAssemblyRow(databasePool, cableId);
  if (!cableRow) {
    return null;
  }

  const [endRows, pinRows] = await Promise.all([
    readCableAssemblyEnds(databasePool, [cableId]),
    readCablePinMapRowsForCable(databasePool, cableId)
  ]);

  return {
    boundary: CABLE_AUTHORING_BOUNDARY,
    cable: mapCableAssemblyRow(cableRow, endRows),
    pinRows: pinRows.map(mapCablePinMapRow)
  };
}

/** Reads one cable header row with project context and child counts. */
async function readCableAssemblyRow(databasePool: Pool, cableId: string): Promise<DatabaseCableAssemblyRow | null> {
  const result = await databasePool.query<DatabaseCableAssemblyRow>(
    `
      SELECT
        ca.id, ca.cable_key, ca.revision_label, ca.assembly_status, ca.project_id,
        p.project_key, p.name AS project_name, ca.project_revision_id,
        pr.revision_label AS project_revision_label, ca.owner, ca.description, ca.source_document_ref, ca.provenance,
        COALESCE(pin_counts.pin_row_count, 0)::text AS pin_row_count,
        COALESCE(fixture_counts.fixture_port_count, 0)::text AS fixture_port_count,
        ca.created_at, ca.updated_at
      FROM cable_assemblies ca
      LEFT JOIN projects p ON p.id = ca.project_id
      LEFT JOIN project_revisions pr ON pr.id = ca.project_revision_id
      LEFT JOIN (
        SELECT cable_assembly_id, COUNT(*) AS pin_row_count FROM cable_pin_map_rows GROUP BY cable_assembly_id
      ) pin_counts ON pin_counts.cable_assembly_id = ca.id
      LEFT JOIN (
        SELECT cable_assembly_id, COUNT(*) AS fixture_port_count FROM fixture_ports WHERE cable_assembly_id IS NOT NULL GROUP BY cable_assembly_id
      ) fixture_counts ON fixture_counts.cable_assembly_id = ca.id
      WHERE ca.id = $1
      LIMIT 1
    `,
    [cableId]
  );

  return result.rows[0] ?? null;
}

/** Reads every pin-map row for one cable, joined to its cable identity. */
async function readCablePinMapRowsForCable(databasePool: Pool, cableId: string): Promise<DatabaseCablePinMapRow[]> {
  const result = await databasePool.query<DatabaseCablePinMapRow>(
    `
      SELECT
        cpm.id, cpm.cable_assembly_id, ca.cable_key, ca.revision_label, cpm.cable_end_id, cpm.fixture_port_id,
        cpm.end_label, cpm.connector_ref, cpm.pin_number, cpm.signal_name, cpm.wire_color, cpm.wire_gauge,
        cpm.destination_connector_ref, cpm.destination_pin_number, cpm.confidence_score,
        cpm.evidence_attachment_id, cpm.source_document_ref, cpm.notes
      FROM cable_pin_map_rows cpm
      JOIN cable_assemblies ca ON ca.id = cpm.cable_assembly_id
      WHERE cpm.cable_assembly_id = $1
      ORDER BY cpm.connector_ref ASC, cpm.pin_number ASC, cpm.signal_name ASC
    `,
    [cableId]
  );

  return result.rows;
}

/** Reads the raw editable header columns for merge-on-update, or null when the cable is gone. */
async function readCableEditableRow(databasePool: Pool, cableId: string): Promise<DatabaseCableEditableRow | null> {
  const result = await databasePool.query<DatabaseCableEditableRow>(
    `SELECT cable_key, revision_label, assembly_status, project_id, project_revision_id, owner, description, source_document_ref
     FROM cable_assemblies WHERE id = $1 LIMIT 1`,
    [cableId]
  );
  return result.rows[0] ?? null;
}

/** NormalizedCableHeader is the validated, persistable cable header. */
interface NormalizedCableHeader {
  cableKey: string;
  revisionLabel: string;
  assemblyStatus: InterconnectRecordStatus;
  projectId: string | null;
  projectRevisionId: string | null;
  owner: string | null;
  description: string | null;
  sourceDocumentRef: string | null;
}

/** Validates and normalizes a cable header from create or merged-update input. */
function normalizeCableHeader(input: {
  cableKey: string | null | undefined;
  revisionLabel: string | null | undefined;
  assemblyStatus: InterconnectRecordStatus;
  projectId: string | null | undefined;
  projectRevisionId: string | null | undefined;
  owner: string | null | undefined;
  description: string | null | undefined;
  sourceDocumentRef: string | null | undefined;
}): NormalizeResult<NormalizedCableHeader> {
  const cableKey = (input.cableKey ?? "").trim();
  if (!cableKey) {
    return { code: "INVALID_CABLE_KEY", message: "A cable needs a cable ID (for example CAB-100).", ok: false };
  }

  if (!ALLOWED_INTERCONNECT_STATUSES.includes(input.assemblyStatus)) {
    return { code: "INVALID_CABLE_STATUS", message: "Cable status must be draft, in review, approved, restricted, or retired.", ok: false };
  }

  const projectId = trimToNull(input.projectId);
  const projectRevisionId = trimToNull(input.projectRevisionId);
  if (projectRevisionId && !projectId) {
    return { code: "INVALID_CABLE_PROJECT", message: "Choose a project before linking a project revision.", ok: false };
  }

  return {
    ok: true,
    value: {
      assemblyStatus: input.assemblyStatus,
      cableKey,
      description: trimToNull(input.description),
      owner: trimToNull(input.owner),
      projectId,
      projectRevisionId,
      revisionLabel: (input.revisionLabel ?? "").trim() || "Working",
      sourceDocumentRef: trimToNull(input.sourceDocumentRef)
    }
  };
}

/** NormalizedEnd is the validated, persistable connector end. */
interface NormalizedEnd {
  endLabel: CableAssemblyEndLabel;
  connectorRef: string;
  connectorPartId: string | null;
  matePartId: string | null;
  backshellPartId: string | null;
  notes: string | null;
}

/** Validates and normalizes one connector-end input. */
function normalizeEndInput(input: CableAssemblyEndInput): NormalizeResult<NormalizedEnd> {
  if (!ALLOWED_END_LABELS.includes(input.endLabel)) {
    return { code: "INVALID_END_LABEL", message: "End must be A, B, C, D, or other.", ok: false };
  }

  const connectorRef = (input.connectorRef ?? "").trim();
  if (!connectorRef) {
    return { code: "INVALID_CONNECTOR_REF", message: "An end needs a connector reference (for example J202).", ok: false };
  }

  return {
    ok: true,
    value: {
      backshellPartId: trimToNull(input.backshellPartId),
      connectorPartId: trimToNull(input.connectorPartId),
      connectorRef,
      endLabel: input.endLabel,
      matePartId: trimToNull(input.matePartId),
      notes: trimToNull(input.notes)
    }
  };
}

/** NormalizedPinRow is the validated, persistable pin-map row. */
interface NormalizedPinRow {
  endLabel: CableAssemblyEndLabel;
  connectorRef: string;
  pinNumber: string;
  signalName: string;
  cableEndId: string | null;
  fixturePortId: string | null;
  wireColor: string | null;
  wireGauge: number | null;
  destinationConnectorRef: string | null;
  destinationPinNumber: string | null;
  confidenceScore: number;
  sourceDocumentRef: string | null;
  notes: string | null;
}

/** Validates and normalizes one pin-map row input. */
function normalizePinRowInput(input: CablePinMapRowInput): NormalizeResult<NormalizedPinRow> {
  if (!ALLOWED_END_LABELS.includes(input.endLabel)) {
    return { code: "INVALID_END_LABEL", message: "Pin rows need an end of A, B, C, D, or other.", ok: false };
  }

  const connectorRef = (input.connectorRef ?? "").trim();
  if (!connectorRef) {
    return { code: "INVALID_CONNECTOR_REF", message: "A pin row needs a connector reference (for example J202).", ok: false };
  }

  const pinNumber = (input.pinNumber ?? "").trim();
  if (!pinNumber) {
    return { code: "INVALID_PIN_NUMBER", message: "A pin row needs a pin number.", ok: false };
  }

  const signalName = (input.signalName ?? "").trim();
  if (!signalName) {
    return { code: "INVALID_SIGNAL_NAME", message: "A pin row needs a signal name.", ok: false };
  }

  let confidenceScore = 0.5;
  if (input.confidenceScore !== undefined && input.confidenceScore !== null) {
    if (!Number.isFinite(input.confidenceScore) || input.confidenceScore < 0 || input.confidenceScore > 1) {
      return { code: "INVALID_CONFIDENCE", message: "Confidence must be between 0 and 1.", ok: false };
    }
    confidenceScore = input.confidenceScore;
  }

  let wireGauge: number | null = null;
  if (input.wireGauge !== undefined && input.wireGauge !== null) {
    if (!Number.isInteger(input.wireGauge) || input.wireGauge <= 0) {
      return { code: "INVALID_WIRE_GAUGE", message: "Wire gauge must be a whole number above 0 (AWG).", ok: false };
    }
    wireGauge = input.wireGauge;
  }

  return {
    ok: true,
    value: {
      cableEndId: trimToNull(input.cableEndId),
      confidenceScore,
      connectorRef,
      destinationConnectorRef: trimToNull(input.destinationConnectorRef),
      destinationPinNumber: trimToNull(input.destinationPinNumber),
      endLabel: input.endLabel,
      fixturePortId: trimToNull(input.fixturePortId),
      notes: trimToNull(input.notes),
      pinNumber,
      signalName,
      sourceDocumentRef: trimToNull(input.sourceDocumentRef),
      wireColor: trimToNull(input.wireColor),
      wireGauge
    }
  };
}

/** Verifies optional project / project-revision references on a cable header exist. */
async function checkCableReferences(databasePool: Pool, header: NormalizedCableHeader): Promise<CableAssemblyMutationResult | null> {
  if (header.projectId && !(await rowExists(databasePool, "projects", header.projectId))) {
    return { code: "PROJECT_NOT_FOUND", message: "The linked project was not found.", status: "invalid" };
  }
  if (header.projectRevisionId && !(await rowExists(databasePool, "project_revisions", header.projectRevisionId))) {
    return { code: "PROJECT_REVISION_NOT_FOUND", message: "The linked project revision was not found.", status: "invalid" };
  }
  return null;
}

/** Verifies optional connector / mate / backshell part references on an end exist. */
async function checkEndPartReferences(databasePool: Pool, end: NormalizedEnd): Promise<CableAssemblyMutationResult | null> {
  for (const partId of [end.connectorPartId, end.matePartId, end.backshellPartId]) {
    if (partId && !(await rowExists(databasePool, "parts", partId))) {
      return { code: "PART_NOT_FOUND", message: `Linked part "${partId}" was not found in the catalog.`, status: "invalid" };
    }
  }
  return null;
}

/** Checks whether a (cable_key, revision_label) already exists, optionally excluding one id. */
async function cableKeyRevisionExists(databasePool: Pool, cableKey: string, revisionLabel: string, excludeId: string | null): Promise<boolean> {
  const result = await databasePool.query(
    "SELECT 1 FROM cable_assemblies WHERE cable_key = $1 AND revision_label = $2 AND ($3::text IS NULL OR id <> $3) LIMIT 1",
    [cableKey, revisionLabel, excludeId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Checks whether a duplicate end (cable, end_label, connector_ref) exists, excluding one id. */
async function cableEndExists(databasePool: Pool, cableId: string, endLabel: CableAssemblyEndLabel, connectorRef: string, excludeId: string | null): Promise<boolean> {
  const result = await databasePool.query(
    "SELECT 1 FROM cable_assembly_ends WHERE cable_assembly_id = $1 AND end_label = $2 AND connector_ref = $3 AND ($4::text IS NULL OR id <> $4) LIMIT 1",
    [cableId, endLabel, connectorRef, excludeId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Checks whether a cable exists. */
async function cableExists(databasePool: Pool, cableId: string): Promise<boolean> {
  return rowExists(databasePool, "cable_assemblies", cableId);
}

/** Checks whether an end belongs to the given cable. */
async function cableEndBelongsToCable(databasePool: Pool, cableId: string, endId: string): Promise<boolean> {
  const result = await databasePool.query("SELECT 1 FROM cable_assembly_ends WHERE id = $1 AND cable_assembly_id = $2 LIMIT 1", [endId, cableId]);
  return (result.rowCount ?? 0) > 0;
}

/** Checks whether a pin row belongs to the given cable. */
async function pinRowBelongsToCable(databasePool: Pool, cableId: string, rowId: string): Promise<boolean> {
  const result = await databasePool.query("SELECT 1 FROM cable_pin_map_rows WHERE id = $1 AND cable_assembly_id = $2 LIMIT 1", [rowId, cableId]);
  return (result.rowCount ?? 0) > 0;
}

/** Checks whether a row with the given id exists in a known table. */
async function rowExists(databasePool: Pool, table: "projects" | "project_revisions" | "parts" | "cable_assemblies" | "test_fixtures", id: string): Promise<boolean> {
  const result = await databasePool.query(`SELECT 1 FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Bumps a cable's updated_at so listings re-sort after a child write. */
async function touchCable(databasePool: Pool, cableId: string): Promise<void> {
  await databasePool.query("UPDATE cable_assemblies SET updated_at = $2 WHERE id = $1", [cableId, new Date()]);
}

/** Trims a value to a non-empty string or null. */
function trimToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Builds a deterministic-prefixed, collision-resistant interconnect record id. */
function buildInterconnectId(prefix: string, seed: string): string {
  const slug = seed.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48) || "record";
  return `${prefix}-${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===========================================================================
// Test fixture authoring (create / edit / retire)
//
// Mirrors cable authoring. Same honesty boundary: recording fixture memory never
// approves a part, validates an asset, proves a bench setup is safe, or unlocks export.
// ===========================================================================

/** FIXTURE_AUTHORING_BOUNDARY is repeated on every fixture mutation response. */
export const FIXTURE_AUTHORING_BOUNDARY =
  "Recording fixture memory keeps engineering history; it does not approve a part, validate an asset, prove a bench setup is safe, or unlock export. Status is recorded memory, not approval.";

/** TestFixtureDetailReadResult reports single-fixture detail availability. */
export type TestFixtureDetailReadResult =
  | { status: "available"; response: TestFixtureDetail }
  | { status: "not_configured" }
  | { status: "not_found" };

/** TestFixtureMutationResult is the shared outcome union for every fixture write. */
export type TestFixtureMutationResult =
  | { status: "created" | "updated" | "deleted"; response: TestFixtureDetail }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string }
  | { status: "invalid"; code: string; message: string };

/** DatabaseFixtureEditableRow holds the raw editable header columns for merge-on-update. */
interface DatabaseFixtureEditableRow {
  fixture_key: string;
  revision_label: string;
  fixture_status: InterconnectRecordStatus;
  project_id: string | null;
  owner: string | null;
  purpose: string | null;
  source_document_ref: string | null;
}

/** Reads one fixture's full authoring detail (header + ports). */
export async function readTestFixtureDetailFromDatabase(fixtureId: string): Promise<TestFixtureDetailReadResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const detail = await buildTestFixtureDetail(databasePool, fixtureId);
    return detail ? { status: "available", response: detail } : { status: "not_found" };
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Creates one test fixture header from in-app authoring input. */
export async function createTestFixtureInDatabase(input: TestFixtureCreateInput): Promise<TestFixtureMutationResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const normalized = normalizeFixtureHeader({
      fixtureKey: input.fixtureKey,
      fixtureStatus: input.fixtureStatus ?? "draft",
      owner: input.owner,
      projectId: input.projectId,
      purpose: input.purpose,
      revisionLabel: input.revisionLabel,
      sourceDocumentRef: input.sourceDocumentRef
    });
    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    const referenceError = await checkFixtureReferences(databasePool, normalized.value);
    if (referenceError) {
      return referenceError;
    }

    if (await fixtureKeyRevisionExists(databasePool, normalized.value.fixtureKey, normalized.value.revisionLabel, null)) {
      return {
        code: "DUPLICATE_FIXTURE_KEY",
        message: `A fixture "${normalized.value.fixtureKey}" revision "${normalized.value.revisionLabel}" already exists. Use a different revision label.`,
        status: "invalid"
      };
    }

    const now = new Date();
    const fixtureId = buildInterconnectId("fixture", normalized.value.fixtureKey);
    await databasePool.query(
      `
        INSERT INTO test_fixtures (
          id, fixture_key, revision_label, fixture_status, project_id, owner, purpose, source_document_ref, provenance, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual_internal', $9, $9)
      `,
      [
        fixtureId,
        normalized.value.fixtureKey,
        normalized.value.revisionLabel,
        normalized.value.fixtureStatus,
        normalized.value.projectId,
        normalized.value.owner,
        normalized.value.purpose,
        normalized.value.sourceDocumentRef,
        now
      ]
    );

    return await respondWithFixtureDetail(databasePool, fixtureId, "created");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Edits one test fixture header. Status → retired soft-retires it. */
export async function updateTestFixtureInDatabase(fixtureId: string, input: TestFixtureUpdateInput): Promise<TestFixtureMutationResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const existing = await readFixtureEditableRow(databasePool, fixtureId);
    if (!existing) {
      return { code: "FIXTURE_NOT_FOUND", message: "Test fixture not found.", status: "not_found" };
    }

    const normalized = normalizeFixtureHeader({
      fixtureKey: input.fixtureKey === undefined ? existing.fixture_key : input.fixtureKey,
      fixtureStatus: input.fixtureStatus === undefined ? existing.fixture_status : (input.fixtureStatus ?? existing.fixture_status),
      owner: input.owner === undefined ? existing.owner : input.owner,
      projectId: input.projectId === undefined ? existing.project_id : input.projectId,
      purpose: input.purpose === undefined ? existing.purpose : input.purpose,
      revisionLabel: input.revisionLabel === undefined ? existing.revision_label : input.revisionLabel,
      sourceDocumentRef: input.sourceDocumentRef === undefined ? existing.source_document_ref : input.sourceDocumentRef
    });
    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    const referenceError = await checkFixtureReferences(databasePool, normalized.value);
    if (referenceError) {
      return referenceError;
    }

    if (await fixtureKeyRevisionExists(databasePool, normalized.value.fixtureKey, normalized.value.revisionLabel, fixtureId)) {
      return {
        code: "DUPLICATE_FIXTURE_KEY",
        message: `A fixture "${normalized.value.fixtureKey}" revision "${normalized.value.revisionLabel}" already exists. Use a different revision label.`,
        status: "invalid"
      };
    }

    await databasePool.query(
      `
        UPDATE test_fixtures
        SET fixture_key = $2, revision_label = $3, fixture_status = $4, project_id = $5, owner = $6, purpose = $7, source_document_ref = $8, updated_at = $9
        WHERE id = $1
      `,
      [
        fixtureId,
        normalized.value.fixtureKey,
        normalized.value.revisionLabel,
        normalized.value.fixtureStatus,
        normalized.value.projectId,
        normalized.value.owner,
        normalized.value.purpose,
        normalized.value.sourceDocumentRef,
        new Date()
      ]
    );

    return await respondWithFixtureDetail(databasePool, fixtureId, "updated");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Adds one port to a test fixture. */
export async function createFixturePortInDatabase(fixtureId: string, input: FixturePortInput): Promise<TestFixtureMutationResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await rowExists(databasePool, "test_fixtures", fixtureId))) {
      return { code: "FIXTURE_NOT_FOUND", message: "Test fixture not found.", status: "not_found" };
    }

    const normalized = normalizePortInput(input);
    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    const referenceError = await checkPortReferences(databasePool, normalized.value);
    if (referenceError) {
      return referenceError;
    }

    if (await fixturePortExists(databasePool, fixtureId, normalized.value.connectorRef, null)) {
      return { code: "DUPLICATE_FIXTURE_PORT", message: `Connector ${normalized.value.connectorRef} already exists on this fixture.`, status: "invalid" };
    }

    const portId = buildInterconnectId("fixture-port", `${fixtureId}-${normalized.value.connectorRef}`);
    await databasePool.query(
      `
        INSERT INTO fixture_ports (
          id, fixture_id, connector_ref, connector_part_id, mate_part_id, cable_assembly_id, port_role, notes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      `,
      [
        portId,
        fixtureId,
        normalized.value.connectorRef,
        normalized.value.connectorPartId,
        normalized.value.matePartId,
        normalized.value.cableAssemblyId,
        normalized.value.portRole,
        normalized.value.notes,
        new Date()
      ]
    );

    await touchFixture(databasePool, fixtureId);
    return await respondWithFixtureDetail(databasePool, fixtureId, "created");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Edits one port on a test fixture. */
export async function updateFixturePortInDatabase(fixtureId: string, portId: string, input: FixturePortInput): Promise<TestFixtureMutationResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await fixturePortBelongsToFixture(databasePool, fixtureId, portId))) {
      return { code: "FIXTURE_PORT_NOT_FOUND", message: "Port not found on this fixture.", status: "not_found" };
    }

    const normalized = normalizePortInput(input);
    if (!normalized.ok) {
      return { code: normalized.code, message: normalized.message, status: "invalid" };
    }

    const referenceError = await checkPortReferences(databasePool, normalized.value);
    if (referenceError) {
      return referenceError;
    }

    if (await fixturePortExists(databasePool, fixtureId, normalized.value.connectorRef, portId)) {
      return { code: "DUPLICATE_FIXTURE_PORT", message: `Connector ${normalized.value.connectorRef} already exists on this fixture.`, status: "invalid" };
    }

    await databasePool.query(
      `
        UPDATE fixture_ports
        SET connector_ref = $3, connector_part_id = $4, mate_part_id = $5, cable_assembly_id = $6, port_role = $7, notes = $8, updated_at = $9
        WHERE id = $2 AND fixture_id = $1
      `,
      [
        fixtureId,
        portId,
        normalized.value.connectorRef,
        normalized.value.connectorPartId,
        normalized.value.matePartId,
        normalized.value.cableAssemblyId,
        normalized.value.portRole,
        normalized.value.notes,
        new Date()
      ]
    );

    await touchFixture(databasePool, fixtureId);
    return await respondWithFixtureDetail(databasePool, fixtureId, "updated");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Deletes one port from a test fixture. */
export async function deleteFixturePortInDatabase(fixtureId: string, portId: string): Promise<TestFixtureMutationResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await fixturePortBelongsToFixture(databasePool, fixtureId, portId))) {
      return { code: "FIXTURE_PORT_NOT_FOUND", message: "Port not found on this fixture.", status: "not_found" };
    }

    await databasePool.query("DELETE FROM fixture_ports WHERE id = $1 AND fixture_id = $2", [portId, fixtureId]);
    await touchFixture(databasePool, fixtureId);
    return await respondWithFixtureDetail(databasePool, fixtureId, "deleted");
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Builds a fixture mutation success result by re-reading the detail after a write. */
async function respondWithFixtureDetail(databasePool: Pool, fixtureId: string, status: "created" | "updated" | "deleted"): Promise<TestFixtureMutationResult> {
  const detail = await buildTestFixtureDetail(databasePool, fixtureId);
  if (!detail) {
    throw new CatalogStoreError("query_failed", "Fixture detail was missing immediately after a write.", new Error("missing_fixture_detail_after_write"));
  }
  return { response: detail, status };
}

/** Reads one fixture's header and ports into the shared detail contract. */
async function buildTestFixtureDetail(databasePool: Pool, fixtureId: string): Promise<TestFixtureDetail | null> {
  const fixtureRow = await readTestFixtureRow(databasePool, fixtureId);
  if (!fixtureRow) {
    return null;
  }

  const portRows = await readFixturePorts(databasePool, [fixtureId]);
  return {
    boundary: FIXTURE_AUTHORING_BOUNDARY,
    fixture: mapTestFixtureRow(fixtureRow, portRows)
  };
}

/** Reads one fixture header row with project context and child counts. */
async function readTestFixtureRow(databasePool: Pool, fixtureId: string): Promise<DatabaseTestFixtureRow | null> {
  const result = await databasePool.query<DatabaseTestFixtureRow>(
    `
      SELECT
        tf.id, tf.fixture_key, tf.revision_label, tf.fixture_status, tf.project_id,
        p.project_key, p.name AS project_name, tf.owner, tf.purpose, tf.source_document_ref, tf.provenance,
        COALESCE(port_counts.port_count, 0)::text AS port_count,
        COALESCE(pin_counts.pin_row_count, 0)::text AS pin_row_count,
        tf.created_at, tf.updated_at
      FROM test_fixtures tf
      LEFT JOIN projects p ON p.id = tf.project_id
      LEFT JOIN (
        SELECT fixture_id, COUNT(*) AS port_count FROM fixture_ports GROUP BY fixture_id
      ) port_counts ON port_counts.fixture_id = tf.id
      LEFT JOIN (
        SELECT fp.fixture_id, COUNT(cpm.id) AS pin_row_count
        FROM fixture_ports fp
        LEFT JOIN cable_pin_map_rows cpm ON cpm.fixture_port_id = fp.id
        GROUP BY fp.fixture_id
      ) pin_counts ON pin_counts.fixture_id = tf.id
      WHERE tf.id = $1
      LIMIT 1
    `,
    [fixtureId]
  );

  return result.rows[0] ?? null;
}

/** Reads the raw editable fixture header columns for merge-on-update. */
async function readFixtureEditableRow(databasePool: Pool, fixtureId: string): Promise<DatabaseFixtureEditableRow | null> {
  const result = await databasePool.query<DatabaseFixtureEditableRow>(
    `SELECT fixture_key, revision_label, fixture_status, project_id, owner, purpose, source_document_ref
     FROM test_fixtures WHERE id = $1 LIMIT 1`,
    [fixtureId]
  );
  return result.rows[0] ?? null;
}

/** NormalizedFixtureHeader is the validated, persistable fixture header. */
interface NormalizedFixtureHeader {
  fixtureKey: string;
  revisionLabel: string;
  fixtureStatus: InterconnectRecordStatus;
  projectId: string | null;
  owner: string | null;
  purpose: string | null;
  sourceDocumentRef: string | null;
}

/** Validates and normalizes a fixture header. */
function normalizeFixtureHeader(input: {
  fixtureKey: string | null | undefined;
  revisionLabel: string | null | undefined;
  fixtureStatus: InterconnectRecordStatus;
  projectId: string | null | undefined;
  owner: string | null | undefined;
  purpose: string | null | undefined;
  sourceDocumentRef: string | null | undefined;
}): NormalizeResult<NormalizedFixtureHeader> {
  const fixtureKey = (input.fixtureKey ?? "").trim();
  if (!fixtureKey) {
    return { code: "INVALID_FIXTURE_KEY", message: "A fixture needs a fixture ID (for example TFX-42).", ok: false };
  }
  if (!ALLOWED_INTERCONNECT_STATUSES.includes(input.fixtureStatus)) {
    return { code: "INVALID_FIXTURE_STATUS", message: "Fixture status must be draft, in review, approved, restricted, or retired.", ok: false };
  }

  return {
    ok: true,
    value: {
      fixtureKey,
      fixtureStatus: input.fixtureStatus,
      owner: trimToNull(input.owner),
      projectId: trimToNull(input.projectId),
      purpose: trimToNull(input.purpose),
      revisionLabel: (input.revisionLabel ?? "").trim() || "Working",
      sourceDocumentRef: trimToNull(input.sourceDocumentRef)
    }
  };
}

/** NormalizedPort is the validated, persistable fixture port. */
interface NormalizedPort {
  connectorRef: string;
  connectorPartId: string | null;
  matePartId: string | null;
  cableAssemblyId: string | null;
  portRole: string | null;
  notes: string | null;
}

/** Validates and normalizes one fixture-port input. */
function normalizePortInput(input: FixturePortInput): NormalizeResult<NormalizedPort> {
  const connectorRef = (input.connectorRef ?? "").trim();
  if (!connectorRef) {
    return { code: "INVALID_CONNECTOR_REF", message: "A port needs a connector reference (for example J202).", ok: false };
  }

  return {
    ok: true,
    value: {
      cableAssemblyId: trimToNull(input.cableAssemblyId),
      connectorPartId: trimToNull(input.connectorPartId),
      connectorRef,
      matePartId: trimToNull(input.matePartId),
      notes: trimToNull(input.notes),
      portRole: trimToNull(input.portRole)
    }
  };
}

/** Verifies optional project reference on a fixture header exists. */
async function checkFixtureReferences(databasePool: Pool, header: NormalizedFixtureHeader): Promise<TestFixtureMutationResult | null> {
  if (header.projectId && !(await rowExists(databasePool, "projects", header.projectId))) {
    return { code: "PROJECT_NOT_FOUND", message: "The linked project was not found.", status: "invalid" };
  }
  return null;
}

/** Verifies optional part and cable references on a fixture port exist. */
async function checkPortReferences(databasePool: Pool, port: NormalizedPort): Promise<TestFixtureMutationResult | null> {
  for (const partId of [port.connectorPartId, port.matePartId]) {
    if (partId && !(await rowExists(databasePool, "parts", partId))) {
      return { code: "PART_NOT_FOUND", message: `Linked part "${partId}" was not found in the catalog.`, status: "invalid" };
    }
  }
  if (port.cableAssemblyId && !(await rowExists(databasePool, "cable_assemblies", port.cableAssemblyId))) {
    return { code: "CABLE_NOT_FOUND", message: "The linked cable assembly was not found.", status: "invalid" };
  }
  return null;
}

/** Checks whether a (fixture_key, revision_label) already exists, optionally excluding one id. */
async function fixtureKeyRevisionExists(databasePool: Pool, fixtureKey: string, revisionLabel: string, excludeId: string | null): Promise<boolean> {
  const result = await databasePool.query(
    "SELECT 1 FROM test_fixtures WHERE fixture_key = $1 AND revision_label = $2 AND ($3::text IS NULL OR id <> $3) LIMIT 1",
    [fixtureKey, revisionLabel, excludeId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Checks whether a duplicate port (fixture, connector_ref) exists, excluding one id. */
async function fixturePortExists(databasePool: Pool, fixtureId: string, connectorRef: string, excludeId: string | null): Promise<boolean> {
  const result = await databasePool.query(
    "SELECT 1 FROM fixture_ports WHERE fixture_id = $1 AND connector_ref = $2 AND ($3::text IS NULL OR id <> $3) LIMIT 1",
    [fixtureId, connectorRef, excludeId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Checks whether a port belongs to the given fixture. */
async function fixturePortBelongsToFixture(databasePool: Pool, fixtureId: string, portId: string): Promise<boolean> {
  const result = await databasePool.query("SELECT 1 FROM fixture_ports WHERE id = $1 AND fixture_id = $2 LIMIT 1", [portId, fixtureId]);
  return (result.rowCount ?? 0) > 0;
}

/** Bumps a fixture's updated_at so listings re-sort after a child write. */
async function touchFixture(databasePool: Pool, fixtureId: string): Promise<void> {
  await databasePool.query("UPDATE test_fixtures SET updated_at = $2 WHERE id = $1", [fixtureId, new Date()]);
}

// ===========================================================================
// Cable revision compare (read-only)
//
// Diffs two revisions of the same cable key by connector ends and pin rows.
// A clean diff is recorded-memory context only; it never approves a part or unlocks export.
// ===========================================================================

/** CABLE_COMPARE_BOUNDARY is repeated on revision-compare reads. */
const CABLE_COMPARE_BOUNDARY =
  "Revision compare shows what changed in recorded cable memory between two revisions. It does not approve a part, validate an asset, prove a bench setup is safe, or unlock export.";

/** CableRevisionListReadResult reports sibling-revision availability for one cable. */
export type CableRevisionListReadResult =
  | { status: "available"; response: CableRevisionListResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** CableRevisionCompareReadResult reports revision-compare availability. */
export type CableRevisionCompareReadResult =
  | { status: "available"; response: CableRevisionCompareResponse }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** Reads every revision that shares this cable's cable_key, newest first. */
export async function readCableAssemblyRevisionsFromDatabase(cableId: string): Promise<CableRevisionListReadResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const cableKey = await readCableKey(databasePool, cableId);
    if (cableKey === null) {
      return { status: "not_found" };
    }

    const result = await databasePool.query<{ id: string; revision_label: string; assembly_status: InterconnectRecordStatus; updated_at: Date | string }>(
      `SELECT id, revision_label, assembly_status, updated_at FROM cable_assemblies WHERE cable_key = $1 ORDER BY updated_at DESC, revision_label ASC`,
      [cableKey]
    );

    const revisions: InterconnectRevisionSummary[] = result.rows.map((row) => ({
      id: row.id,
      revisionLabel: row.revision_label,
      status: row.assembly_status,
      updatedAt: toIsoTimestamp(row.updated_at)
    }));

    return { response: { cableKey, currentCableId: cableId, revisions }, status: "available" };
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Diffs two revisions of the same cable key by connector ends and pin rows. */
export async function readCableRevisionCompareFromDatabase(baseCableId: string, targetCableId: string): Promise<CableRevisionCompareReadResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const [base, target] = await Promise.all([
      buildCableAssemblyDetail(databasePool, baseCableId),
      buildCableAssemblyDetail(databasePool, targetCableId)
    ]);

    if (!base) {
      return { code: "CABLE_NOT_FOUND", message: "Base cable revision not found.", status: "not_found" };
    }
    if (!target) {
      return { code: "COMPARE_CABLE_NOT_FOUND", message: "The revision to compare against was not found.", status: "not_found" };
    }
    if (base.cable.cableKey !== target.cable.cableKey) {
      return { code: "CABLE_KEY_MISMATCH", message: "Revision compare only works between revisions of the same cable.", status: "not_found" };
    }

    const endDiffs = diffCableEnds(base, target);
    const pinRowDiffs = diffCablePinRows(base, target);

    return {
      response: {
        baseCableId,
        baseRevisionLabel: base.cable.revisionLabel,
        boundary: CABLE_COMPARE_BOUNDARY,
        cableKey: base.cable.cableKey,
        endDiffs,
        endSummary: summarizeDiffs(endDiffs.map((diff) => diff.kind), base.cable.ends.length),
        pinRowDiffs,
        pinRowSummary: summarizeDiffs(pinRowDiffs.map((diff) => diff.kind), base.pinRows.length),
        targetCableId,
        targetRevisionLabel: target.cable.revisionLabel
      },
      status: "available"
    };
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Reads one cable's cable_key, or null when the cable is gone. */
async function readCableKey(databasePool: Pool, cableId: string): Promise<string | null> {
  const result = await databasePool.query<{ cable_key: string }>("SELECT cable_key FROM cable_assemblies WHERE id = $1 LIMIT 1", [cableId]);
  return result.rows[0]?.cable_key ?? null;
}

/** Diffs connector ends between two cable revisions, keyed by end label. */
function diffCableEnds(base: CableAssemblyDetail, target: CableAssemblyDetail): CableEndDiff[] {
  const baseByLabel = new Map(base.cable.ends.map((end) => [end.endLabel, end]));
  const targetByLabel = new Map(target.cable.ends.map((end) => [end.endLabel, end]));
  const labels = [...new Set([...baseByLabel.keys(), ...targetByLabel.keys()])].sort();
  const diffs: CableEndDiff[] = [];

  for (const label of labels) {
    const baseEnd = baseByLabel.get(label) ?? null;
    const targetEnd = targetByLabel.get(label) ?? null;

    if (baseEnd && !targetEnd) {
      diffs.push({ changes: [], connectorRef: baseEnd.connectorRef, endLabel: label, kind: "removed" });
      continue;
    }
    if (!baseEnd && targetEnd) {
      diffs.push({ changes: [], connectorRef: targetEnd.connectorRef, endLabel: label, kind: "added" });
      continue;
    }
    if (baseEnd && targetEnd) {
      const changes = collectChanges([
        ["connector ref", baseEnd.connectorRef, targetEnd.connectorRef],
        ["connector part", baseEnd.connectorPart.mpn, targetEnd.connectorPart.mpn],
        ["mate part", baseEnd.matePart.mpn, targetEnd.matePart.mpn],
        ["backshell part", baseEnd.backshellPart.mpn, targetEnd.backshellPart.mpn],
        ["notes", baseEnd.notes, targetEnd.notes]
      ]);
      if (changes.length > 0) {
        diffs.push({ changes, connectorRef: targetEnd.connectorRef, endLabel: label, kind: "changed" });
      }
    }
  }

  return diffs;
}

/** Diffs pin rows between two cable revisions, keyed by connector ref + pin number. */
function diffCablePinRows(base: CableAssemblyDetail, target: CableAssemblyDetail): CablePinRowDiff[] {
  const keyOf = (row: CablePinMapRow): string => `${row.connectorRef.toUpperCase()}|${row.pinNumber.toUpperCase()}`;
  const baseByKey = new Map(base.pinRows.map((row) => [keyOf(row), row]));
  const targetByKey = new Map(target.pinRows.map((row) => [keyOf(row), row]));
  const keys = [...new Set([...baseByKey.keys(), ...targetByKey.keys()])].sort();
  const diffs: CablePinRowDiff[] = [];

  for (const key of keys) {
    const baseRow = baseByKey.get(key) ?? null;
    const targetRow = targetByKey.get(key) ?? null;
    const identity = (targetRow ?? baseRow)!;

    if (baseRow && !targetRow) {
      diffs.push({ changes: [], connectorRef: baseRow.connectorRef, kind: "removed", pinNumber: baseRow.pinNumber, signalName: baseRow.signalName });
      continue;
    }
    if (!baseRow && targetRow) {
      diffs.push({ changes: [], connectorRef: targetRow.connectorRef, kind: "added", pinNumber: targetRow.pinNumber, signalName: targetRow.signalName });
      continue;
    }
    if (baseRow && targetRow) {
      const changes = collectChanges([
        ["signal", baseRow.signalName, targetRow.signalName],
        ["end", baseRow.endLabel, targetRow.endLabel],
        ["wire color", baseRow.wireColor, targetRow.wireColor],
        ["wire gauge", baseRow.wireGauge === null ? null : String(baseRow.wireGauge), targetRow.wireGauge === null ? null : String(targetRow.wireGauge)],
        ["destination connector", baseRow.destinationConnectorRef, targetRow.destinationConnectorRef],
        ["destination pin", baseRow.destinationPinNumber, targetRow.destinationPinNumber],
        ["confidence", String(baseRow.confidenceScore), String(targetRow.confidenceScore)],
        ["notes", baseRow.notes, targetRow.notes]
      ]);
      if (changes.length > 0) {
        diffs.push({ changes, connectorRef: identity.connectorRef, kind: "changed", pinNumber: identity.pinNumber, signalName: targetRow.signalName });
      }
    }
  }

  return diffs;
}

/** Collects the fields that differ between two revisions into plain from/to changes. */
function collectChanges(pairs: Array<[string, string | null, string | null]>): InterconnectFieldChange[] {
  const changes: InterconnectFieldChange[] = [];
  for (const [field, from, to] of pairs) {
    if ((from ?? null) !== (to ?? null)) {
      changes.push({ field, from: from ?? null, to: to ?? null });
    }
  }
  return changes;
}

/** Summarizes diff kinds into added/removed/changed/unchanged counts. */
function summarizeDiffs(kinds: InterconnectDiffKindLocal[], baseCount: number): InterconnectCompareSummary {
  const added = kinds.filter((kind) => kind === "added").length;
  const removed = kinds.filter((kind) => kind === "removed").length;
  const changed = kinds.filter((kind) => kind === "changed").length;
  // Unchanged = base records that were not removed or changed.
  const unchanged = Math.max(0, baseCount - removed - changed);
  return { added, changed, removed, unchanged };
}

/** Local alias for the diff-kind union to keep the summary helper readable. */
type InterconnectDiffKindLocal = "added" | "removed" | "changed";

// ===========================================================================
// Cable pin-map import (bulk create from an uploaded spreadsheet)
//
// Imported rows are recorded memory only: they never approve the part or cable. Each carries the
// source filename and a sub-0.75 confidence so it surfaces in the "needs check" filter until reviewed.
// ===========================================================================

/** PIN_MAP_IMPORT_BOUNDARY is repeated on import responses. */
const PIN_MAP_IMPORT_BOUNDARY =
  "Imported pin rows are recorded memory only — they do not approve the part or cable, validate an asset, prove a bench setup is safe, or unlock export. Imported rows start below review confidence until an engineer checks them.";

/** IMPORTED_PIN_CONFIDENCE keeps imported rows under the needs-check threshold (0.75) until reviewed. */
const IMPORTED_PIN_CONFIDENCE = 0.5;

/** MAX_INVALID_SAMPLES caps how many per-row invalid reasons are returned to the operator. */
const MAX_INVALID_SAMPLES = 5;

/** PinMapImportResult reports bulk pin-map import availability. */
export type PinMapImportResult =
  | { status: "available"; response: PinMapImportResponse }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/**
 * Bulk-creates pin rows on one cable from imported rows, skipping duplicates (by connector ref +
 * pin number) and invalid rows. New rows carry the source filename and a sub-review confidence.
 */
export async function importCablePinMapRowsInDatabase(
  cableId: string,
  input: { sourceFilename: string; rows: CablePinMapRowInput[] }
): Promise<PinMapImportResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await cableExists(databasePool, cableId))) {
      return { code: "CABLE_NOT_FOUND", message: "Cable assembly not found.", status: "not_found" };
    }

    const existingKeys = await readCablePinRowKeys(databasePool, cableId);
    const seenInBatch = new Set<string>();
    const summary: PinMapImportSummary = { added: 0, invalidSamples: [], skippedDuplicate: 0, skippedInvalid: 0 };
    const inserts: NormalizedPinRow[] = [];

    for (const row of input.rows) {
      const normalized = normalizePinRowInput(row);
      if (!normalized.ok) {
        summary.skippedInvalid += 1;
        if (summary.invalidSamples.length < MAX_INVALID_SAMPLES) {
          summary.invalidSamples.push(normalized.message);
        }
        continue;
      }

      const key = `${normalized.value.connectorRef.toUpperCase()}|${normalized.value.pinNumber.toUpperCase()}`;
      if (existingKeys.has(key) || seenInBatch.has(key)) {
        summary.skippedDuplicate += 1;
        continue;
      }

      seenInBatch.add(key);
      inserts.push(normalized.value);
    }

    if (inserts.length > 0) {
      const client = await databasePool.connect();
      try {
        await client.query("BEGIN");
        const now = new Date();
        for (const value of inserts) {
          const rowId = buildInterconnectId("pin", `${cableId}-${value.connectorRef}-${value.pinNumber}`);
          await client.query(
            `
              INSERT INTO cable_pin_map_rows (
                id, cable_assembly_id, cable_end_id, fixture_port_id, end_label, connector_ref, pin_number,
                signal_name, wire_color, wire_gauge, destination_connector_ref, destination_pin_number,
                confidence_score, source_document_ref, notes, created_at, updated_at
              )
              VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
            `,
            [
              rowId,
              cableId,
              value.endLabel,
              value.connectorRef,
              value.pinNumber,
              value.signalName,
              value.wireColor,
              value.wireGauge,
              value.destinationConnectorRef,
              value.destinationPinNumber,
              IMPORTED_PIN_CONFIDENCE,
              input.sourceFilename,
              value.notes,
              now
            ]
          );
          summary.added += 1;
        }
        await client.query("UPDATE cable_assemblies SET updated_at = $2 WHERE id = $1", [cableId, now]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const detail = await buildCableAssemblyDetail(databasePool, cableId);
    if (!detail) {
      throw new CatalogStoreError("query_failed", "Cable detail was missing immediately after a pin-map import.", new Error("missing_cable_detail_after_import"));
    }

    return { response: { boundary: PIN_MAP_IMPORT_BOUNDARY, detail, summary }, status: "available" };
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Reads the existing (connector ref | pin number) keys for one cable's pin rows, upper-cased. */
async function readCablePinRowKeys(databasePool: Pool, cableId: string): Promise<Set<string>> {
  const result = await databasePool.query<{ connector_ref: string; pin_number: string }>(
    "SELECT connector_ref, pin_number FROM cable_pin_map_rows WHERE cable_assembly_id = $1",
    [cableId]
  );
  return new Set(result.rows.map((row) => `${row.connector_ref.toUpperCase()}|${row.pin_number.toUpperCase()}`));
}

// ===========================================================================
// Fixture port-list import (bulk create from an uploaded spreadsheet)
//
// Mirrors pin-map import. Imported ports are recorded memory only; they never approve the part or
// fixture. (Fixture ports carry no per-row confidence/source column, so the import action's
// provenance lives in the audit log.)
// ===========================================================================

/** PORT_LIST_IMPORT_BOUNDARY is repeated on port-list import responses. */
const PORT_LIST_IMPORT_BOUNDARY =
  "Imported ports are recorded memory only — they do not approve the part or fixture, validate an asset, prove a bench setup is safe, or unlock export.";

/** PortListImportResult reports bulk port-list import availability. */
export type PortListImportResult =
  | { status: "available"; response: PortListImportResponse }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/**
 * Bulk-creates ports on one fixture from imported rows, skipping duplicates (by connector ref) and
 * invalid rows. Reuses the per-row port validator and the same add/skip summary as pin-map import.
 */
export async function importFixturePortsInDatabase(
  fixtureId: string,
  input: { sourceFilename: string; rows: FixturePortInput[] }
): Promise<PortListImportResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await rowExists(databasePool, "test_fixtures", fixtureId))) {
      return { code: "FIXTURE_NOT_FOUND", message: "Test fixture not found.", status: "not_found" };
    }

    const existingKeys = await readFixturePortKeys(databasePool, fixtureId);
    const seenInBatch = new Set<string>();
    const summary: PinMapImportSummary = { added: 0, invalidSamples: [], skippedDuplicate: 0, skippedInvalid: 0 };
    const inserts: NormalizedPort[] = [];

    for (const row of input.rows) {
      const normalized = normalizePortInput(row);
      if (!normalized.ok) {
        summary.skippedInvalid += 1;
        if (summary.invalidSamples.length < MAX_INVALID_SAMPLES) {
          summary.invalidSamples.push(normalized.message);
        }
        continue;
      }

      const key = normalized.value.connectorRef.toUpperCase();
      if (existingKeys.has(key) || seenInBatch.has(key)) {
        summary.skippedDuplicate += 1;
        continue;
      }

      seenInBatch.add(key);
      inserts.push(normalized.value);
    }

    if (inserts.length > 0) {
      const client = await databasePool.connect();
      try {
        await client.query("BEGIN");
        const now = new Date();
        for (const value of inserts) {
          const portId = buildInterconnectId("fixture-port", `${fixtureId}-${value.connectorRef}`);
          await client.query(
            `
              INSERT INTO fixture_ports (
                id, fixture_id, connector_ref, connector_part_id, mate_part_id, cable_assembly_id, port_role, notes, created_at, updated_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
            `,
            [
              portId,
              fixtureId,
              value.connectorRef,
              value.connectorPartId,
              value.matePartId,
              value.cableAssemblyId,
              value.portRole,
              value.notes,
              now
            ]
          );
          summary.added += 1;
        }
        await client.query("UPDATE test_fixtures SET updated_at = $2 WHERE id = $1", [fixtureId, now]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const detail = await buildTestFixtureDetail(databasePool, fixtureId);
    if (!detail) {
      throw new CatalogStoreError("query_failed", "Fixture detail was missing immediately after a port-list import.", new Error("missing_fixture_detail_after_import"));
    }

    return { response: { boundary: PORT_LIST_IMPORT_BOUNDARY, detail, summary }, status: "available" };
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Reads the existing connector-ref keys for one fixture's ports, upper-cased. */
async function readFixturePortKeys(databasePool: Pool, fixtureId: string): Promise<Set<string>> {
  const result = await databasePool.query<{ connector_ref: string }>(
    "SELECT connector_ref FROM fixture_ports WHERE fixture_id = $1",
    [fixtureId]
  );
  return new Set(result.rows.map((row) => row.connector_ref.toUpperCase()));
}

// ===========================================================================
// Fixture revision compare (read-only)
//
// Mirrors cable revision compare: diffs two revisions of the same fixture key by ports.
// A clean diff is recorded-memory context only; it never approves a part or unlocks export.
// ===========================================================================

/** FIXTURE_COMPARE_BOUNDARY is repeated on fixture revision-compare reads. */
const FIXTURE_COMPARE_BOUNDARY =
  "Revision compare shows what changed in recorded fixture memory between two revisions. It does not approve a part, validate an asset, prove a bench setup is safe, or unlock export.";

/** FixtureRevisionListReadResult reports sibling-revision availability for one fixture. */
export type FixtureRevisionListReadResult =
  | { status: "available"; response: FixtureRevisionListResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** FixtureRevisionCompareReadResult reports fixture revision-compare availability. */
export type FixtureRevisionCompareReadResult =
  | { status: "available"; response: FixtureRevisionCompareResponse }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** Reads every revision that shares this fixture's fixture_key, newest first. */
export async function readTestFixtureRevisionsFromDatabase(fixtureId: string): Promise<FixtureRevisionListReadResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const fixtureKey = await readFixtureKey(databasePool, fixtureId);
    if (fixtureKey === null) {
      return { status: "not_found" };
    }

    const result = await databasePool.query<{ id: string; revision_label: string; fixture_status: InterconnectRecordStatus; updated_at: Date | string }>(
      `SELECT id, revision_label, fixture_status, updated_at FROM test_fixtures WHERE fixture_key = $1 ORDER BY updated_at DESC, revision_label ASC`,
      [fixtureKey]
    );

    const revisions: InterconnectRevisionSummary[] = result.rows.map((row) => ({
      id: row.id,
      revisionLabel: row.revision_label,
      status: row.fixture_status,
      updatedAt: toIsoTimestamp(row.updated_at)
    }));

    return { response: { currentFixtureId: fixtureId, fixtureKey, revisions }, status: "available" };
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Diffs two revisions of the same fixture key by ports. */
export async function readFixtureRevisionCompareFromDatabase(baseFixtureId: string, targetFixtureId: string): Promise<FixtureRevisionCompareReadResult> {
  const databasePool = getInterconnectDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const [base, target] = await Promise.all([
      buildTestFixtureDetail(databasePool, baseFixtureId),
      buildTestFixtureDetail(databasePool, targetFixtureId)
    ]);

    if (!base) {
      return { code: "FIXTURE_NOT_FOUND", message: "Base fixture revision not found.", status: "not_found" };
    }
    if (!target) {
      return { code: "COMPARE_FIXTURE_NOT_FOUND", message: "The revision to compare against was not found.", status: "not_found" };
    }
    if (base.fixture.fixtureKey !== target.fixture.fixtureKey) {
      return { code: "FIXTURE_KEY_MISMATCH", message: "Revision compare only works between revisions of the same fixture.", status: "not_found" };
    }

    const portDiffs = diffFixturePorts(base, target);

    return {
      response: {
        baseFixtureId,
        baseRevisionLabel: base.fixture.revisionLabel,
        boundary: FIXTURE_COMPARE_BOUNDARY,
        fixtureKey: base.fixture.fixtureKey,
        portDiffs,
        portSummary: summarizeDiffs(portDiffs.map((diff) => diff.kind), base.fixture.ports.length),
        targetFixtureId,
        targetRevisionLabel: target.fixture.revisionLabel
      },
      status: "available"
    };
  } catch (error) {
    throw toInterconnectStoreError(error);
  }
}

/** Reads one fixture's fixture_key, or null when the fixture is gone. */
async function readFixtureKey(databasePool: Pool, fixtureId: string): Promise<string | null> {
  const result = await databasePool.query<{ fixture_key: string }>("SELECT fixture_key FROM test_fixtures WHERE id = $1 LIMIT 1", [fixtureId]);
  return result.rows[0]?.fixture_key ?? null;
}

/** Diffs ports between two fixture revisions, keyed by connector ref. */
function diffFixturePorts(base: TestFixtureDetail, target: TestFixtureDetail): FixturePortDiff[] {
  const keyOf = (port: FixturePort): string => port.connectorRef.toUpperCase();
  const baseByKey = new Map(base.fixture.ports.map((port) => [keyOf(port), port]));
  const targetByKey = new Map(target.fixture.ports.map((port) => [keyOf(port), port]));
  const keys = [...new Set([...baseByKey.keys(), ...targetByKey.keys()])].sort();
  const diffs: FixturePortDiff[] = [];

  for (const key of keys) {
    const basePort = baseByKey.get(key) ?? null;
    const targetPort = targetByKey.get(key) ?? null;
    const identity = (targetPort ?? basePort)!;

    if (basePort && !targetPort) {
      diffs.push({ changes: [], connectorRef: basePort.connectorRef, kind: "removed" });
      continue;
    }
    if (!basePort && targetPort) {
      diffs.push({ changes: [], connectorRef: targetPort.connectorRef, kind: "added" });
      continue;
    }
    if (basePort && targetPort) {
      const changes = collectChanges([
        ["role", basePort.portRole, targetPort.portRole],
        ["cable", basePort.cableKey, targetPort.cableKey],
        ["matched part", basePort.connectorPart.mpn, targetPort.connectorPart.mpn],
        ["mate part", basePort.matePart.mpn, targetPort.matePart.mpn],
        ["notes", basePort.notes, targetPort.notes]
      ]);
      if (changes.length > 0) {
        diffs.push({ changes, connectorRef: identity.connectorRef, kind: "changed" });
      }
    }
  }

  return diffs;
}
