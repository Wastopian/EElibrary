/**
 * File header: Exports the entire EE Library engineering memory into one portable, deterministic
 * `.tar.gz` snapshot — the "you own your data" backup.
 *
 * It dumps every public database table to JSON and copies the storage files those tables reference
 * (any `*_storage_key` value) into the archive, alongside a manifest recording the format version,
 * schema (migration) version, per-table row counts, and per-file hashes. This is a **faithful raw
 * snapshot**: nothing is altered, provenance is preserved verbatim, and the manifest names exactly
 * what is and is not included (referenced files that are missing on disk are recorded, not hidden).
 *
 * Restore (`import-engineering-memory`) is a separate, later command — it carries the risky conflict
 * policy (never silently overwrite a row with different provenance), so it is intentionally not bundled
 * with this read-only export.
 */

import { createHash } from "node:crypto";
import { writeFile as fsWriteFile } from "node:fs/promises";
import { buildUstarTarBuffer, gzipBufferDeterministic, type TarFileEntry } from "@ee-library/shared/tar-archive";
import { getWorkerDatabasePool } from "./catalog-repository";
import { getWorkerStorageClient } from "./file-storage";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

/** ENGINEERING_MEMORY_ARCHIVE_FORMAT_VERSION versions the archive layout so a future restore can branch. */
export const ENGINEERING_MEMORY_ARCHIVE_FORMAT_VERSION = 1;

/** ArchiveTableSummary records one dumped table. */
export interface ArchiveTableSummary {
  name: string;
  rowCount: number;
}

/** ArchiveStorageFile records one storage file copied into the archive. */
export interface ArchiveStorageFile {
  key: string;
  archivePath: string;
  sha256: string;
  bytes: number;
}

/** EngineeringMemoryArchiveManifest is the self-describing index embedded in the archive. */
export interface EngineeringMemoryArchiveManifest {
  formatVersion: number;
  generatedAt: string;
  schemaVersion: string | null;
  database: { tables: ArchiveTableSummary[]; totalRows: number };
  storage: { included: ArchiveStorageFile[]; missing: string[] };
  note: string;
}

/** EngineeringMemoryArchiveSummary is the operator-facing outcome of one export. */
export interface EngineeringMemoryArchiveSummary {
  outPath: string;
  archiveSha256: string;
  tableCount: number;
  totalRows: number;
  storageFilesIncluded: number;
  storageFilesMissing: number;
}

/** QueryablePool is the minimal query surface used here; the worker's pg Pool satisfies it. */
interface QueryablePool {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Serializes one table's rows to a deterministic JSON document. Rows are sorted by their canonical
 * JSON string so the output is byte-identical regardless of the order Postgres returns them in,
 * which keeps the archive hash stable for identical data.
 */
export function serializeTableDump(table: string, rows: Record<string, unknown>[]): string {
  const serializedRows = rows.map((row) => JSON.stringify(row)).sort((first, second) => (first < second ? -1 : first > second ? 1 : 0));
  const body = serializedRows.map((row) => JSON.parse(row) as Record<string, unknown>);
  return `${JSON.stringify({ rowCount: body.length, rows: body, table }, null, 2)}\n`;
}

/**
 * Collects the distinct storage keys referenced by a set of rows. Any column whose name is or ends
 * with `storage_key` (covering `archive_storage_key`, `signature_storage_key`,
 * `preview_artifact_storage_key`, …) and holds a non-empty string is treated as a storage reference.
 */
export function collectStorageKeysFromRows(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if ((column === "storage_key" || column.endsWith("_storage_key")) && typeof value === "string" && value.length > 0) {
        keys.add(value);
      }
    }
  }
  return [...keys].sort((first, second) => first.localeCompare(second));
}

/**
 * Builds the archive manifest from the collected table and storage summaries.
 */
export function buildEngineeringMemoryManifest(input: {
  generatedAt: string;
  schemaVersion: string | null;
  tables: ArchiveTableSummary[];
  storageIncluded: ArchiveStorageFile[];
  storageMissing: string[];
}): EngineeringMemoryArchiveManifest {
  return {
    database: {
      tables: input.tables,
      totalRows: input.tables.reduce((total, table) => total + table.rowCount, 0)
    },
    formatVersion: ENGINEERING_MEMORY_ARCHIVE_FORMAT_VERSION,
    generatedAt: input.generatedAt,
    note: "Portable EE Library engineering-memory snapshot. Faithful raw dump — provenance preserved, no rows altered. Restore with the (planned) import-engineering-memory command, which surfaces provenance conflicts rather than overwriting silently.",
    schemaVersion: input.schemaVersion,
    storage: { included: input.storageIncluded, missing: input.storageMissing }
  };
}

/**
 * Exports the full engineering memory to a portable `.tar.gz` at `outPath`.
 *
 * Database, storage, the file writer, and the timestamp are injectable so the orchestration is
 * unit-testable without a real database or filesystem.
 */
export async function exportEngineeringMemoryArchive(options: {
  outPath: string;
  pool?: QueryablePool;
  storage?: FileStorageClient;
  generatedAt?: string;
  writeFile?: (path: string, content: Buffer) => Promise<void>;
}): Promise<EngineeringMemoryArchiveSummary> {
  const pool = options.pool ?? (getWorkerDatabasePool() as unknown as QueryablePool);
  const storage = options.storage ?? getWorkerStorageClient();
  const writeFile = options.writeFile ?? ((path: string, content: Buffer) => fsWriteFile(path, content));
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const tableNamesResult = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
  );

  const entries: TarFileEntry[] = [];
  const tableSummaries: ArchiveTableSummary[] = [];
  const referencedStorageKeys = new Set<string>();

  for (const { table_name: tableName } of tableNamesResult.rows) {
    // Table names come from information_schema (not user input) and are quoted to be safe.
    const rowsResult = await pool.query<Record<string, unknown>>(`SELECT * FROM "${tableName}"`);
    const rows = rowsResult.rows;

    entries.push({ content: Buffer.from(serializeTableDump(tableName, rows), "utf8"), path: `database/${tableName}.json` });
    tableSummaries.push({ name: tableName, rowCount: rows.length });

    for (const key of collectStorageKeysFromRows(rows)) {
      referencedStorageKeys.add(key);
    }
  }

  const schemaVersion = await readSchemaVersion(pool);

  const storageIncluded: ArchiveStorageFile[] = [];
  const storageMissing: string[] = [];
  let storageIndex = 0;

  for (const key of [...referencedStorageKeys].sort((first, second) => first.localeCompare(second))) {
    let bytes: Buffer | null = null;
    try {
      if (await storage.exists(key)) {
        bytes = await storage.read(key);
      }
    } catch {
      bytes = null;
    }

    if (!bytes) {
      storageMissing.push(key);
      continue;
    }

    // Index-mapped short path avoids the ustar 100-byte name limit for long storage keys; the
    // manifest maps each archive path back to its original storage key for restore.
    const archivePath = `storage/${String(storageIndex).padStart(6, "0")}`;
    storageIndex += 1;
    entries.push({ content: bytes, path: archivePath });
    storageIncluded.push({ archivePath, bytes: bytes.length, key, sha256: createHash("sha256").update(bytes).digest("hex") });
  }

  const manifest = buildEngineeringMemoryManifest({
    generatedAt,
    schemaVersion,
    storageIncluded,
    storageMissing,
    tables: tableSummaries
  });

  entries.push({ content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), path: "manifest.json" });
  entries.sort((first, second) => first.path.localeCompare(second.path));

  const tar = buildUstarTarBuffer(entries);
  const archive = await gzipBufferDeterministic(tar);
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");

  await writeFile(options.outPath, archive);

  return {
    archiveSha256,
    outPath: options.outPath,
    storageFilesIncluded: storageIncluded.length,
    storageFilesMissing: storageMissing.length,
    tableCount: tableSummaries.length,
    totalRows: manifest.database.totalRows
  };
}

/**
 * Reads the latest applied migration filename as the archive's schema version, or null when the
 * bookkeeping table is absent (e.g. a pre-migration database).
 */
async function readSchemaVersion(pool: QueryablePool): Promise<string | null> {
  try {
    const result = await pool.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1`
    );
    return result.rows[0]?.filename ?? null;
  } catch {
    return null;
  }
}
