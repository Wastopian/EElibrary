/**
 * File header: Tests KiCad CAD byte ingestion. Pins the path-safety boundary (only files under the
 * configured root are read), the deterministic storage key, the per-asset ingest outcomes, and the
 * honesty contract that ingestion marks an asset downloaded/file-backed but never touches review,
 * validation, or export state.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  buildIngestedAssetStorageKey,
  ingestKicadAssetBytes,
  processKicadAssetByteIngestion,
  resolveKicadAssetReadPath,
  type KicadAssetIngestDeps,
  type KicadIngestCandidateRow
} from "./kicad-asset-ingestion";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { Pool } from "pg";

const ROOT = resolve("kicad-root-test");
const UNDER_ROOT = resolve(ROOT, "Resistor.pretty", "R_0402.kicad_mod");

/** Map-backed storage stub that records writes. */
function stubStorage(): FileStorageClient & { writes: Map<string, Buffer> } {
  const writes = new Map<string, Buffer>();
  return {
    writes,
    backend: "local" as const,
    async exists(key: string) {
      return writes.has(key);
    },
    async getDownloadUrl() {
      return null;
    },
    async read(key: string) {
      const value = writes.get(key);
      if (!value) throw new Error(`missing ${key}`);
      return value;
    },
    async write(key: string, content: Buffer) {
      writes.set(key, content);
    }
  };
}

function candidate(overrides: Partial<KicadIngestCandidateRow> = {}): KicadIngestCandidateRow {
  return {
    asset_type: "footprint",
    file_format: "kicad_mod",
    id: "asset-1",
    part_id: "part-1",
    source_url: UNDER_ROOT,
    ...overrides
  };
}

test("resolveKicadAssetReadPath accepts paths under the root and rejects everything else", () => {
  assert.equal(resolveKicadAssetReadPath(UNDER_ROOT, ROOT), UNDER_ROOT);
  assert.equal(resolveKicadAssetReadPath(resolve("somewhere-else", "x.kicad_mod"), ROOT), null);
  assert.equal(resolveKicadAssetReadPath("https://example.com/R.kicad_mod", ROOT), null);
  assert.equal(resolveKicadAssetReadPath("", ROOT), null);
});

test("buildIngestedAssetStorageKey is deterministic and uses the file extension", () => {
  assert.equal(buildIngestedAssetStorageKey(candidate()), "assets/part-1/footprint-asset-1.kicad_mod");
  assert.equal(
    buildIngestedAssetStorageKey(candidate({ asset_type: "three_d_model", file_format: "step", source_url: resolve(ROOT, "R.step") })),
    "assets/part-1/three_d_model-asset-1.step"
  );
});

test("ingestKicadAssetBytes stores bytes, hashes them, and persists the downloaded transition", async () => {
  const storage = stubStorage();
  const persisted: Array<{ assetId: string; storageKey: string; fileHash: string }> = [];
  const deps: KicadAssetIngestDeps = {
    readFile: async () => Buffer.from("(footprint \"R_0402\")\n", "utf8"),
    root: ROOT,
    storage,
    persist: async (assetId, storageKey, fileHash) => {
      persisted.push({ assetId, fileHash, storageKey });
    }
  };

  const outcome = await ingestKicadAssetBytes(deps, candidate());

  assert.equal(outcome.status, "ingested");
  assert.equal(storage.writes.has("assets/part-1/footprint-asset-1.kicad_mod"), true);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]!.fileHash.length, 64);
});

test("ingestKicadAssetBytes skips files outside the root without reading them", async () => {
  let readCalled = false;
  const deps: KicadAssetIngestDeps = {
    readFile: async () => {
      readCalled = true;
      return Buffer.from("x");
    },
    root: ROOT,
    storage: stubStorage(),
    persist: async () => {}
  };

  const outcome = await ingestKicadAssetBytes(deps, candidate({ source_url: resolve("evil", "passwd") }));

  assert.equal(outcome.status, "skipped");
  assert.equal(readCalled, false, "must not read a file outside the configured root");
});

test("ingestKicadAssetBytes skips on read failure and empty files without persisting", async () => {
  const persistCalls: string[] = [];
  const baseDeps: Omit<KicadAssetIngestDeps, "readFile"> = {
    root: ROOT,
    storage: stubStorage(),
    persist: async (assetId) => {
      persistCalls.push(assetId);
    }
  };

  const readFailed = await ingestKicadAssetBytes(
    { ...baseDeps, readFile: async () => { throw new Error("ENOENT"); } },
    candidate()
  );
  const empty = await ingestKicadAssetBytes({ ...baseDeps, readFile: async () => Buffer.alloc(0) }, candidate());

  assert.equal(readFailed.status, "skipped");
  assert.equal(empty.status, "skipped");
  assert.equal(persistCalls.length, 0);
});

test("processKicadAssetByteIngestion marks assets downloaded and never touches review/export (honesty)", async () => {
  let updateSql = "";
  const fakePool = {
    query: async (text: string, _values?: unknown[]) => {
      if (/^\s*SELECT/u.test(text)) {
        return { rows: [candidate()] };
      }
      updateSql = text;
      return { rows: [] };
    }
  } as unknown as Pool;

  const summary = await processKicadAssetByteIngestion(10, {
    pool: fakePool,
    readFile: async () => Buffer.from("(footprint \"R_0402\")\n"),
    root: ROOT,
    storage: stubStorage()
  });

  assert.equal(summary.processed.length, 1);
  assert.equal(summary.processed[0]!.status, "ingested");
  assert.match(updateSql, /availability_status = 'downloaded'/u);
  assert.doesNotMatch(updateSql, /export_status/u, "ingestion must not change export state");
  assert.doesNotMatch(updateSql, /review_status/u, "ingestion must not change review state");
  assert.doesNotMatch(updateSql, /verified_for_export/u);
});
