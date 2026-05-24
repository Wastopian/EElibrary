/**
 * File header: Tests the portable engineering-memory archive export. Pins deterministic table
 * serialization, storage-key collection across `*_storage_key` columns, the manifest shape, and the
 * end-to-end archive assembly (database dumps + referenced storage files + manifest) with injected
 * pool/storage/writeFile — including the honest recording of referenced-but-missing storage files.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  buildEngineeringMemoryManifest,
  collectStorageKeysFromRows,
  exportEngineeringMemoryArchive,
  serializeTableDump
} from "./engineering-memory-archive";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

test("serializeTableDump is deterministic regardless of row order", () => {
  const a = serializeTableDump("parts", [{ id: "2" }, { id: "1" }]);
  const b = serializeTableDump("parts", [{ id: "1" }, { id: "2" }]);
  assert.equal(a, b);
  assert.match(a, /"rowCount": 2/u);
  assert.match(a, /"table": "parts"/u);
});

test("collectStorageKeysFromRows picks every *_storage_key column and dedupes", () => {
  const keys = collectStorageKeysFromRows([
    { archive_storage_key: "bundles/a.tar.gz", id: "1", storage_key: "assets/x.kicad_mod" },
    { id: "2", signature_storage_key: "bundles/a.tar.gz.sig", storage_key: "assets/x.kicad_mod" },
    { id: "3", storage_key: null, other_column: "not-a-key" }
  ]);

  assert.deepEqual(keys, ["assets/x.kicad_mod", "bundles/a.tar.gz", "bundles/a.tar.gz.sig"]);
});

test("buildEngineeringMemoryManifest totals rows and records schema version", () => {
  const manifest = buildEngineeringMemoryManifest({
    generatedAt: "2026-05-23T00:00:00.000Z",
    schemaVersion: "044_user_roles_rbac.sql",
    storageIncluded: [{ archivePath: "storage/000000", bytes: 10, key: "assets/x", sha256: "abc" }],
    storageMissing: ["assets/missing"],
    tables: [{ name: "parts", rowCount: 3 }, { name: "projects", rowCount: 2 }]
  });

  assert.equal(manifest.database.totalRows, 5);
  assert.equal(manifest.schemaVersion, "044_user_roles_rbac.sql");
  assert.equal(manifest.storage.missing[0], "assets/missing");
  assert.equal(manifest.formatVersion, 1);
});

/** Storage stub seeded with a subset of keys; reads throw for unseeded keys. */
function stubStorage(seed: Record<string, string>): FileStorageClient {
  const store = new Map<string, Buffer>(Object.entries(seed).map(([key, value]) => [key, Buffer.from(value, "utf8")]));
  return {
    backend: "local" as const,
    async exists(key: string) {
      return store.has(key);
    },
    async getDownloadUrl() {
      return null;
    },
    async read(key: string) {
      const value = store.get(key);
      if (!value) throw new Error(`missing ${key}`);
      return value;
    },
    async write(key: string, content: Buffer) {
      store.set(key, content);
    }
  };
}

test("exportEngineeringMemoryArchive dumps tables, copies present storage files, and records missing ones", async () => {
  const fakePool = {
    query: async (text: string) => {
      if (/information_schema\.tables/u.test(text)) {
        return { rows: [{ table_name: "assets" }, { table_name: "parts" }] };
      }
      if (/schema_migrations/u.test(text)) {
        return { rows: [{ filename: "044_user_roles_rbac.sql" }] };
      }
      if (/FROM "assets"/u.test(text)) {
        return { rows: [{ id: "a1", storage_key: "assets/present.kicad_mod" }, { id: "a2", storage_key: "assets/missing.kicad_mod" }] };
      }
      if (/FROM "parts"/u.test(text)) {
        return { rows: [{ id: "p1", mpn: "RES-1" }] };
      }
      return { rows: [] };
    }
  };

  let writtenPath: string | null = null;
  let writtenBytes = 0;
  const summary = await exportEngineeringMemoryArchive({
    generatedAt: "2026-05-23T00:00:00.000Z",
    outPath: "/tmp/ee-backup.tar.gz",
    pool: fakePool as never,
    storage: stubStorage({ "assets/present.kicad_mod": "(footprint)" }),
    writeFile: async (path, content) => {
      writtenPath = path;
      writtenBytes = content.length;
    }
  });

  assert.equal(summary.tableCount, 2);
  assert.equal(summary.totalRows, 3);
  assert.equal(summary.storageFilesIncluded, 1);
  assert.equal(summary.storageFilesMissing, 1);
  assert.equal(summary.archiveSha256.length, 64);
  assert.equal(writtenPath, "/tmp/ee-backup.tar.gz");
  assert.ok(writtenBytes > 0, "archive bytes should be written to the out path");
});

test("exportEngineeringMemoryArchive writes a self-describing archive tree", async () => {
  const fakePool = {
    query: async (text: string) => {
      if (/information_schema\.tables/u.test(text)) return { rows: [{ table_name: "parts" }] };
      if (/schema_migrations/u.test(text)) return { rows: [{ filename: "001_core_schema.sql" }] };
      if (/FROM "parts"/u.test(text)) return { rows: [{ id: "p1" }] };
      return { rows: [] };
    }
  };

  let archive: Buffer = Buffer.alloc(0);
  await exportEngineeringMemoryArchive({
    generatedAt: "2026-05-23T00:00:00.000Z",
    outPath: "/tmp/ee.tar.gz",
    pool: fakePool as never,
    storage: stubStorage({}),
    writeFile: async (_path, content) => {
      archive = content;
    }
  });

  const tar = gunzipSync(archive).toString("binary");
  assert.ok(tar.includes("manifest.json"), "archive should contain a manifest");
  assert.ok(tar.includes("database/parts.json"), "archive should contain the table dump");
});
