/**
 * File header: Reads cable assembly, fixture, and pin-map memory from Postgres for the API service.
 */

import { Pool } from "pg";
import { CatalogStoreError } from "./catalog-store";
import type {
  CableAssembly,
  CableAssemblyEnd,
  CableAssemblyEndLabel,
  CablePinMapRow,
  FixturePort,
  InterconnectDashboardResponse,
  InterconnectProvenance,
  InterconnectRecordStatus,
  InterconnectPartSummary,
  TestFixture,
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
