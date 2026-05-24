/**
 * File header: Restores a portable engineering-memory archive (the inverse of
 * `engineering-memory-archive.ts`).
 *
 * This is the careful half of the data-ownership round trip. Its honesty contract:
 *  - It **never silently overwrites**. Every row insert uses `ON CONFLICT DO NOTHING`, so a row that
 *    already exists (by primary key / unique constraint) is left exactly as it is, and the operator is
 *    told how many rows were skipped. Restore is therefore safe to run against a populated database —
 *    it can only *add* missing rows, never mutate existing ones.
 *  - It **refuses a schema mismatch** by default (the archive's migration version must equal the
 *    target's), because importing rows shaped for a different schema would fail or corrupt typing.
 *  - It is **transactional**: all inserts happen in one transaction that rolls back on any error.
 *  - It supports **--dry-run**: validate and plan without writing anything.
 *
 * The primary use case is disaster recovery into a fresh, migrated database of the same version.
 */

import { gunzipBuffer, readUstarEntries, type TarFileEntry } from "@ee-library/shared/tar-archive";
import { getWorkerDatabasePool } from "./catalog-repository";
import { getWorkerStorageClient } from "./file-storage";
import type { EngineeringMemoryArchiveManifest } from "./engineering-memory-archive";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

/** ColumnKind classifies how a value must be coerced before it is bound to an INSERT parameter. */
export type ColumnKind = "jsonb" | "array" | "scalar";

/** RestoreClient is the minimal transactional query surface (pg PoolClient satisfies it). */
export interface RestoreClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
}

/** RestorePool is the minimal pool surface used here (pg Pool satisfies it). */
export interface RestorePool {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  connect(): Promise<RestoreClient>;
}

/** ParsedArchive is the indexed content of a restore archive. */
export interface ParsedArchive {
  manifest: EngineeringMemoryArchiveManifest;
  /** table name -> rows */
  tableRows: Map<string, Record<string, unknown>[]>;
  /** archive path (storage/NNNNNN) -> file bytes */
  storageContent: Map<string, Buffer>;
}

/** EngineeringMemoryRestoreSummary is the operator-facing outcome of one restore. */
export interface EngineeringMemoryRestoreSummary {
  status: "restored" | "dry_run" | "incompatible";
  reason?: string;
  tablesProcessed: number;
  rowsInserted: number;
  rowsSkipped: number;
  storageWritten: number;
  storageSkipped: number;
  tableOrder: string[];
}

/**
 * Indexes raw archive entries into a manifest, per-table rows, and storage file bytes. Throws when
 * the archive is missing its manifest so a truncated/foreign archive fails loudly rather than
 * importing a partial dataset.
 */
export function indexArchiveEntries(entries: TarFileEntry[]): ParsedArchive {
  const manifestEntry = entries.find((entry) => entry.path === "manifest.json");
  if (!manifestEntry) {
    throw new Error("Archive is missing manifest.json — not an engineering-memory archive.");
  }

  const manifest = JSON.parse(manifestEntry.content.toString("utf8")) as EngineeringMemoryArchiveManifest;
  const tableRows = new Map<string, Record<string, unknown>[]>();
  const storageContent = new Map<string, Buffer>();

  for (const entry of entries) {
    if (entry.path.startsWith("database/") && entry.path.endsWith(".json")) {
      const parsed = JSON.parse(entry.content.toString("utf8")) as { table: string; rows: Record<string, unknown>[] };
      tableRows.set(parsed.table, Array.isArray(parsed.rows) ? parsed.rows : []);
    } else if (entry.path.startsWith("storage/")) {
      storageContent.set(entry.path, entry.content);
    }
  }

  return { manifest, storageContent, tableRows };
}

/**
 * Reads + decompresses a `.tar.gz` archive buffer into its indexed content.
 */
export async function parseEngineeringMemoryArchive(archive: Buffer): Promise<ParsedArchive> {
  const tar = await gunzipBuffer(archive);
  return indexArchiveEntries(readUstarEntries(tar));
}

/** ManifestCompatibility reports whether an archive may be restored into the target. */
export type ManifestCompatibility = { ok: true } | { ok: false; reason: string };

/**
 * Validates that an archive can be restored into a target at `targetSchemaVersion`. The format
 * version must be understood and the schema (migration) version must match unless explicitly
 * overridden, because rows shaped for a different schema cannot be inserted faithfully.
 */
export function validateManifestCompatibility(
  manifest: EngineeringMemoryArchiveManifest,
  targetSchemaVersion: string | null,
  options: { allowSchemaMismatch?: boolean | undefined } = {}
): ManifestCompatibility {
  if (manifest.formatVersion !== 1) {
    return { ok: false, reason: `Unsupported archive format version ${manifest.formatVersion}.` };
  }

  if (!options.allowSchemaMismatch && manifest.schemaVersion !== targetSchemaVersion) {
    return {
      ok: false,
      reason: `Schema version mismatch: archive is "${manifest.schemaVersion ?? "unknown"}", target is "${targetSchemaVersion ?? "unknown"}". Migrate the target to the same version or pass --allow-schema-mismatch.`
    };
  }

  return { ok: true };
}

/**
 * Topologically sorts tables so a referenced (parent) table is restored before any table that
 * references it. Self-references are ignored. Ties break alphabetically for deterministic order, and
 * any tables left in a cycle are appended in alphabetical order (a one-transaction restore will still
 * surface a genuine FK violation as an error rather than corrupting data).
 */
export function topoSortTables(tables: string[], foreignKeyEdges: { parent: string; child: string }[]): string[] {
  const present = new Set(tables);
  const dependencies = new Map<string, Set<string>>();
  for (const table of tables) {
    dependencies.set(table, new Set());
  }

  for (const edge of foreignKeyEdges) {
    if (edge.parent === edge.child) {
      continue;
    }
    if (present.has(edge.parent) && present.has(edge.child)) {
      dependencies.get(edge.child)!.add(edge.parent);
    }
  }

  const ordered: string[] = [];
  const placed = new Set<string>();

  while (ordered.length < tables.length) {
    const ready = tables
      .filter((table) => !placed.has(table) && [...dependencies.get(table)!].every((parent) => placed.has(parent)))
      .sort((first, second) => first.localeCompare(second));

    if (ready.length === 0) {
      // Cycle (or unsatisfiable dependency) — append the rest alphabetically and let the DB decide.
      const remaining = tables.filter((table) => !placed.has(table)).sort((first, second) => first.localeCompare(second));
      ordered.push(...remaining);
      break;
    }

    for (const table of ready) {
      ordered.push(table);
      placed.add(table);
    }
  }

  return ordered;
}

/** CoercedRow is one row reduced to the columns present in the target table, with bound values. */
export interface CoercedRow {
  columns: string[];
  values: unknown[];
}

/**
 * Coerces one dumped row into the columns the target table actually has, converting each value for
 * its column kind: jsonb is stringified (so both objects and arrays round-trip as JSON rather than a
 * Postgres array literal), array columns keep their JS array, and scalars pass through (Postgres casts
 * the JSON-dumped strings back to numeric/timestamp/etc.). Columns absent from the target are dropped.
 */
export function coerceRowForInsert(
  row: Record<string, unknown>,
  targetColumns: Map<string, ColumnKind>
): CoercedRow {
  const columns: string[] = [];
  const values: unknown[] = [];

  for (const [column, value] of Object.entries(row)) {
    const kind = targetColumns.get(column);
    if (!kind) {
      continue;
    }
    columns.push(column);
    if (value === null || value === undefined) {
      values.push(null);
    } else if (kind === "jsonb") {
      values.push(JSON.stringify(value));
    } else {
      values.push(value);
    }
  }

  return { columns, values };
}

/**
 * Builds an insert that never overwrites: `ON CONFLICT DO NOTHING` skips any row whose primary key or
 * unique constraint already exists. Identifiers are double-quoted; they come from the database schema,
 * not user input.
 */
export function buildInsertSql(table: string, columns: string[]): string {
  const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  return `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
}

/**
 * Restores an engineering-memory archive into the target database + storage.
 *
 * Database, storage, and the archive buffer are injected so the orchestration is testable. Reads
 * (schema version, FK edges, column types) use the pool; inserts run in one transaction on a single
 * client. Storage files are written only when absent (never overwritten).
 */
export async function importEngineeringMemoryArchive(options: {
  archive: Buffer;
  pool?: RestorePool;
  storage?: FileStorageClient;
  dryRun?: boolean;
  allowSchemaMismatch?: boolean;
}): Promise<EngineeringMemoryRestoreSummary> {
  const pool = options.pool ?? (getWorkerDatabasePool() as unknown as RestorePool);
  const storage = options.storage ?? getWorkerStorageClient();

  const parsed = await parseEngineeringMemoryArchive(options.archive);

  const targetSchemaVersion = await readTargetSchemaVersion(pool);
  const compatibility = validateManifestCompatibility(parsed.manifest, targetSchemaVersion, {
    allowSchemaMismatch: options.allowSchemaMismatch
  });

  if (!compatibility.ok) {
    return {
      reason: compatibility.reason,
      rowsInserted: 0,
      rowsSkipped: 0,
      status: "incompatible",
      storageSkipped: 0,
      storageWritten: 0,
      tableOrder: [],
      tablesProcessed: 0
    };
  }

  const dumpedTables = [...parsed.tableRows.keys()];
  const foreignKeyEdges = await readForeignKeyEdges(pool);
  const columnTypes = await readColumnTypes(pool);
  const tableOrder = topoSortTables(dumpedTables, foreignKeyEdges);

  if (options.dryRun) {
    return {
      rowsInserted: 0,
      rowsSkipped: dumpedTables.reduce((total, table) => total + (parsed.tableRows.get(table)?.length ?? 0), 0),
      status: "dry_run",
      storageSkipped: 0,
      storageWritten: parsed.manifest.storage.included.length,
      tableOrder,
      tablesProcessed: tableOrder.length
    };
  }

  let rowsInserted = 0;
  let rowsSkipped = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of tableOrder) {
      const targetColumns = columnTypes.get(table);
      const rows = parsed.tableRows.get(table) ?? [];
      if (!targetColumns || rows.length === 0) {
        continue;
      }

      for (const row of rows) {
        const coerced = coerceRowForInsert(row, targetColumns);
        if (coerced.columns.length === 0) {
          rowsSkipped += 1;
          continue;
        }
        const result = await client.query(buildInsertSql(table, coerced.columns), coerced.values);
        const inserted = result.rowCount ?? 0;
        rowsInserted += inserted;
        rowsSkipped += 1 - inserted;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let storageWritten = 0;
  let storageSkipped = 0;
  for (const file of parsed.manifest.storage.included) {
    const content = parsed.storageContent.get(file.archivePath);
    if (!content) {
      storageSkipped += 1;
      continue;
    }
    if (await storage.exists(file.key)) {
      storageSkipped += 1;
      continue;
    }
    await storage.write(file.key, content);
    storageWritten += 1;
  }

  return {
    rowsInserted,
    rowsSkipped,
    status: "restored",
    storageSkipped,
    storageWritten,
    tableOrder,
    tablesProcessed: tableOrder.length
  };
}

/**
 * Reads the target database's latest applied migration as its schema version, or null when the
 * bookkeeping table is absent.
 */
async function readTargetSchemaVersion(pool: RestorePool): Promise<string | null> {
  try {
    const result = await pool.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1`
    );
    return result.rows[0]?.filename ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads foreign-key edges (referenced parent -> referencing child) from the public schema.
 */
async function readForeignKeyEdges(pool: RestorePool): Promise<{ parent: string; child: string }[]> {
  const result = await pool.query<{ child: string; parent: string }>(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
  );
  return result.rows.map((row) => ({ child: row.child, parent: row.parent }));
}

/**
 * Reads per-table column kinds from information_schema so values can be coerced correctly.
 */
async function readColumnTypes(pool: RestorePool): Promise<Map<string, Map<string, ColumnKind>>> {
  const result = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'`
  );

  const byTable = new Map<string, Map<string, ColumnKind>>();
  for (const row of result.rows) {
    let columns = byTable.get(row.table_name);
    if (!columns) {
      columns = new Map();
      byTable.set(row.table_name, columns);
    }
    columns.set(row.column_name, classifyColumnKind(row.data_type));
  }
  return byTable;
}

/**
 * Maps an information_schema data type to the coercion kind used by {@link coerceRowForInsert}.
 */
function classifyColumnKind(dataType: string): ColumnKind {
  if (dataType === "jsonb" || dataType === "json") {
    return "jsonb";
  }
  if (dataType === "ARRAY") {
    return "array";
  }
  return "scalar";
}
