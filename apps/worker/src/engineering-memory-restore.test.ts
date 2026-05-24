/**
 * File header: Tests engineering-memory restore. Pins the honesty-critical pieces: schema-version
 * gating, FK-ordered table sorting, value coercion (jsonb stringified vs arrays vs scalars), the
 * never-overwrite INSERT, and the orchestrator (incompatible / dry-run / restored) with a fake pool —
 * plus an export→parse round trip so the writer and reader agree.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildUstarTarBuffer, gzipBufferDeterministic } from "@ee-library/shared/tar-archive";
import { exportEngineeringMemoryArchive } from "./engineering-memory-archive";
import {
  buildInsertSql,
  coerceRowForInsert,
  importEngineeringMemoryArchive,
  indexArchiveEntries,
  parseEngineeringMemoryArchive,
  topoSortTables,
  validateManifestCompatibility,
  type ColumnKind,
  type EngineeringMemoryRestoreSummary,
  type RestoreClient,
  type RestorePool
} from "./engineering-memory-restore";
import type { EngineeringMemoryArchiveManifest } from "./engineering-memory-archive";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

const SCHEMA = "044_user_roles_rbac.sql";

function manifest(overrides: Partial<EngineeringMemoryArchiveManifest> = {}): EngineeringMemoryArchiveManifest {
  return {
    database: { tables: [], totalRows: 0 },
    formatVersion: 1,
    generatedAt: "2026-05-23T00:00:00.000Z",
    note: "test",
    schemaVersion: SCHEMA,
    storage: { included: [], missing: [] },
    ...overrides
  };
}

test("validateManifestCompatibility enforces format + schema version, with an override", () => {
  assert.equal(validateManifestCompatibility(manifest(), SCHEMA).ok, true);
  assert.equal(validateManifestCompatibility(manifest({ formatVersion: 2 }), SCHEMA).ok, false);
  assert.equal(validateManifestCompatibility(manifest(), "001_core.sql").ok, false);
  assert.equal(validateManifestCompatibility(manifest(), "001_core.sql", { allowSchemaMismatch: true }).ok, true);
});

test("topoSortTables orders parents before children and ignores self-edges", () => {
  const order = topoSortTables(
    ["assets", "parts", "manufacturers"],
    [
      { child: "assets", parent: "parts" },
      { child: "parts", parent: "manufacturers" },
      { child: "parts", parent: "parts" }
    ]
  );
  assert.ok(order.indexOf("manufacturers") < order.indexOf("parts"));
  assert.ok(order.indexOf("parts") < order.indexOf("assets"));
});

test("coerceRowForInsert stringifies jsonb, keeps arrays, drops unknown columns", () => {
  const columns = new Map<string, ColumnKind>([
    ["id", "scalar"],
    ["metadata", "jsonb"],
    ["designators", "array"]
  ]);
  const coerced = coerceRowForInsert({ designators: ["R1", "R2"], extra: "drop me", id: "p1", metadata: { a: 1 } }, columns);

  assert.deepEqual(coerced.columns.sort(), ["designators", "id", "metadata"]);
  const metadataValue = coerced.values[coerced.columns.indexOf("metadata")];
  assert.equal(metadataValue, JSON.stringify({ a: 1 }));
  const designatorsValue = coerced.values[coerced.columns.indexOf("designators")];
  assert.deepEqual(designatorsValue, ["R1", "R2"]);
});

test("buildInsertSql never overwrites", () => {
  const sql = buildInsertSql("parts", ["id", "mpn"]);
  assert.match(sql, /INSERT INTO "parts" \("id", "mpn"\) VALUES \(\$1, \$2\)/u);
  assert.match(sql, /ON CONFLICT DO NOTHING/u);
});

test("indexArchiveEntries throws without a manifest", () => {
  assert.throws(() => indexArchiveEntries([{ content: Buffer.from("{}"), path: "database/parts.json" }]), /manifest/u);
});

/** Builds a small valid restore archive buffer (manifest + two tables + one storage file). */
async function buildTestArchive(): Promise<Buffer> {
  const archiveManifest = manifest({
    database: { tables: [{ name: "assets", rowCount: 1 }, { name: "parts", rowCount: 1 }], totalRows: 2 },
    storage: { included: [{ archivePath: "storage/000000", bytes: 11, key: "assets/x.kicad_mod", sha256: "abc" }], missing: [] }
  });
  const entries = [
    { content: Buffer.from(`${JSON.stringify(archiveManifest)}\n`), path: "manifest.json" },
    { content: Buffer.from(JSON.stringify({ rowCount: 1, rows: [{ id: "p1", metadata: { a: 1 }, mpn: "R" }], table: "parts" })), path: "database/parts.json" },
    { content: Buffer.from(JSON.stringify({ rowCount: 1, rows: [{ id: "a1", part_id: "p1", storage_key: "assets/x.kicad_mod" }], table: "assets" })), path: "database/assets.json" },
    { content: Buffer.from("(footprint)"), path: "storage/000000" }
  ];
  return gzipBufferDeterministic(buildUstarTarBuffer(entries));
}

/** Storage stub where nothing exists yet, recording writes. */
function stubStorage(): FileStorageClient & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    backend: "local" as const,
    async exists() {
      return false;
    },
    async getDownloadUrl() {
      return null;
    },
    async read() {
      throw new Error("not used");
    },
    async write(key: string) {
      writes.push(key);
    }
  };
}

/** Builds a fake pool answering the restore reads and recording transactional inserts. */
function fakePool(schemaVersion: string | null): { pool: RestorePool; inserts: { sql: string; values: unknown[] }[] } {
  const inserts: { sql: string; values: unknown[] }[] = [];
  const client: RestoreClient = {
    release() {},
    async query(text: string, values?: unknown[]) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/u.test(text)) {
        return { rowCount: null, rows: [] };
      }
      inserts.push({ sql: text, values: values ?? [] });
      return { rowCount: 1, rows: [] };
    }
  };
  const pool: RestorePool = {
    async connect() {
      return client;
    },
    async query<T>(text: string) {
      if (/schema_migrations/u.test(text)) {
        return { rows: (schemaVersion ? [{ filename: schemaVersion }] : []) as T[] };
      }
      if (/FOREIGN KEY/u.test(text)) {
        return { rows: [{ child: "assets", parent: "parts" }] as T[] };
      }
      if (/information_schema\.columns/u.test(text)) {
        return {
          rows: [
            { column_name: "id", data_type: "text", table_name: "parts" },
            { column_name: "mpn", data_type: "text", table_name: "parts" },
            { column_name: "metadata", data_type: "jsonb", table_name: "parts" },
            { column_name: "id", data_type: "text", table_name: "assets" },
            { column_name: "part_id", data_type: "text", table_name: "assets" },
            { column_name: "storage_key", data_type: "text", table_name: "assets" }
          ] as T[]
        };
      }
      return { rows: [] as T[] };
    }
  };
  return { inserts, pool };
}

test("importEngineeringMemoryArchive refuses a schema mismatch and writes nothing", async () => {
  const { pool, inserts } = fakePool("001_core.sql");
  const summary = await importEngineeringMemoryArchive({ archive: await buildTestArchive(), pool, storage: stubStorage() });

  assert.equal(summary.status, "incompatible");
  assert.equal(inserts.length, 0);
});

test("importEngineeringMemoryArchive dry-run validates and plans without inserting", async () => {
  const { pool, inserts } = fakePool(SCHEMA);
  const summary: EngineeringMemoryRestoreSummary = await importEngineeringMemoryArchive({
    archive: await buildTestArchive(),
    dryRun: true,
    pool,
    storage: stubStorage()
  });

  assert.equal(summary.status, "dry_run");
  assert.equal(summary.rowsInserted, 0);
  assert.equal(inserts.length, 0);
  assert.deepEqual(summary.tableOrder, ["parts", "assets"]);
});

test("importEngineeringMemoryArchive restores in FK order, stringifies jsonb, and never overwrites", async () => {
  const { pool, inserts } = fakePool(SCHEMA);
  const storage = stubStorage();
  const summary = await importEngineeringMemoryArchive({ archive: await buildTestArchive(), pool, storage });

  assert.equal(summary.status, "restored");
  assert.equal(summary.rowsInserted, 2);
  assert.equal(summary.storageWritten, 1);
  assert.deepEqual(storage.writes, ["assets/x.kicad_mod"]);

  // parts must be inserted before assets (FK order).
  const insertTables = inserts.map((entry) => /INSERT INTO "([^"]+)"/u.exec(entry.sql)?.[1]);
  assert.ok(insertTables.indexOf("parts") < insertTables.indexOf("assets"));
  // every insert is non-destructive.
  assert.ok(inserts.every((entry) => /ON CONFLICT DO NOTHING/u.test(entry.sql)));
  // the jsonb metadata value was bound as a JSON string, not a JS object.
  const partsInsert = inserts.find((entry) => /INSERT INTO "parts"/u.test(entry.sql))!;
  assert.ok(partsInsert.values.includes(JSON.stringify({ a: 1 })));
});

test("export then parse round-trips the manifest and table rows", async () => {
  const exportPool = {
    query: async (text: string) => {
      if (/information_schema\.tables/u.test(text)) return { rows: [{ table_name: "parts" }] };
      if (/schema_migrations/u.test(text)) return { rows: [{ filename: SCHEMA }] };
      if (/FROM "parts"/u.test(text)) return { rows: [{ id: "p1", mpn: "R" }] };
      return { rows: [] };
    }
  };
  let archive: Buffer = Buffer.alloc(0);
  await exportEngineeringMemoryArchive({
    generatedAt: "2026-05-23T00:00:00.000Z",
    outPath: "/tmp/x.tar.gz",
    pool: exportPool as never,
    storage: stubStorage(),
    writeFile: async (_p, content) => {
      archive = content;
    }
  });

  const parsed = await parseEngineeringMemoryArchive(archive);
  assert.equal(parsed.manifest.schemaVersion, SCHEMA);
  assert.deepEqual(parsed.tableRows.get("parts"), [{ id: "p1", mpn: "R" }]);
});
