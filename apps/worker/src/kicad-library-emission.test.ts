/**
 * File header: Tests the worker-side KiCad library emission seams that do not need a database:
 * deterministic per-part asset grouping and the storage-bound packaging (asset byte reads, emitter
 * invocation, tar.gz assembly). The pure emitter content is covered by the shared emitter tests.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  assembleKicadLibrary,
  buildKicadLibraryStorageKey,
  groupKicadAssetRows,
  type KicadAssetRow,
  type KicadPartAssetSelection
} from "./kicad-library-emission";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

const SYMBOL_LIB = `(kicad_symbol_lib (version 20211014) (generator kicad)
  (symbol "R_0402" (property "Reference" "R" (at 0 0 0)))
)
`;
const FOOTPRINT = `(footprint "R_0402" (layer "F.Cu") (pad "1" smd roundrect (at -0.48 0)))\n`;

/** Builds an in-memory storage client seeded with the supplied key→content map. */
function stubStorage(seed: Record<string, Buffer | string>): FileStorageClient & { reads: string[] } {
  const store = new Map<string, Buffer>();
  for (const [key, value] of Object.entries(seed)) {
    store.set(key, typeof value === "string" ? Buffer.from(value, "utf8") : value);
  }
  const reads: string[] = [];
  return {
    backend: "local" as const,
    reads,
    async exists(storageKey: string) {
      return store.has(storageKey);
    },
    async getDownloadUrl() {
      return null;
    },
    async read(storageKey: string) {
      reads.push(storageKey);
      const value = store.get(storageKey);
      if (!value) {
        throw new Error(`missing key ${storageKey}`);
      }
      return value;
    },
    async write(storageKey: string, content: Buffer) {
      store.set(storageKey, content);
    }
  };
}

function assetRow(overrides: Partial<KicadAssetRow> & Pick<KicadAssetRow, "part_id" | "asset_id" | "asset_type" | "file_format" | "storage_key">): KicadAssetRow {
  return {
    manufacturer_name: "Yageo",
    part_mpn: "RES-1",
    ...overrides
  };
}

test("groupKicadAssetRows picks one KiCad-format asset of each class per part", () => {
  const rows: KicadAssetRow[] = [
    assetRow({ asset_id: "a-sym", asset_type: "symbol", file_format: "kicad_sym", part_id: "p1", storage_key: "s.kicad_sym" }),
    assetRow({ asset_id: "a-fp", asset_type: "footprint", file_format: "kicad_mod", part_id: "p1", storage_key: "f.kicad_mod" }),
    assetRow({ asset_id: "a-3d", asset_type: "three_d_model", file_format: "step", part_id: "p1", storage_key: "models/r.step" })
  ];

  const groups = groupKicadAssetRows(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.symbol?.assetId, "a-sym");
  assert.equal(groups[0]!.footprint?.assetId, "a-fp");
  assert.equal(groups[0]!.model3d?.assetId, "a-3d");
  assert.equal(groups[0]!.model3d?.fileName, "r.step");
});

test("groupKicadAssetRows keeps a part with only non-KiCad CAD so it can be reported as omitted", () => {
  const rows: KicadAssetRow[] = [
    assetRow({ asset_id: "a-dxf", asset_type: "footprint", file_format: "dxf", part_id: "p1", storage_key: "f.dxf" })
  ];
  const groups = groupKicadAssetRows(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.symbol, null);
  assert.equal(groups[0]!.footprint, null);
  assert.equal(groups[0]!.model3d, null);
});

test("assembleKicadLibrary reads asset bytes, emits the tree, and packages a deterministic archive", async () => {
  const storage = stubStorage({
    "f.kicad_mod": FOOTPRINT,
    "models/r.step": "ISO-10303-21; STEP CONTENT",
    "s.kicad_sym": SYMBOL_LIB
  });

  const selections: KicadPartAssetSelection[] = [
    {
      footprint: { assetId: "a-fp", storageKey: "f.kicad_mod" },
      manufacturer: "Yageo",
      model3d: { assetId: "a-3d", fileName: "r.step", storageKey: "models/r.step" },
      mpn: "RES-1",
      partId: "p1",
      symbol: { assetId: "a-sym", storageKey: "s.kicad_sym" }
    }
  ];

  const assembled = await assembleKicadLibrary(storage, selections, { libraryName: "proj" });

  assert.equal(assembled.result.includedParts.length, 1);
  assert.equal(assembled.result.omittedParts.length, 0);
  assert.equal(assembled.archiveSha256.length, 64);
  // The model bytes were fetched from storage.
  assert.ok(storage.reads.includes("models/r.step"));

  // The archive (ustar inside gzip) carries the expected library tree paths.
  const tar = gunzipSync(assembled.archive).toString("binary");
  for (const expected of ["symbols/proj.kicad_sym", "footprints/proj.pretty/RES-1.kicad_mod", "3dmodels/r.step", "sym-lib-table", "fp-lib-table", "README.md"]) {
    assert.ok(tar.includes(expected), `archive should contain ${expected}`);
  }
});

test("assembleKicadLibrary is deterministic for identical input", async () => {
  const seed = { "f.kicad_mod": FOOTPRINT, "s.kicad_sym": SYMBOL_LIB };
  const selections: KicadPartAssetSelection[] = [
    {
      footprint: { assetId: "a-fp", storageKey: "f.kicad_mod" },
      manufacturer: "Yageo",
      model3d: null,
      mpn: "RES-1",
      partId: "p1",
      symbol: { assetId: "a-sym", storageKey: "s.kicad_sym" }
    }
  ];

  const first = await assembleKicadLibrary(stubStorage(seed), selections, { libraryName: "proj" });
  const second = await assembleKicadLibrary(stubStorage(seed), selections, { libraryName: "proj" });
  assert.equal(first.archiveSha256, second.archiveSha256);
});

test("buildKicadLibraryStorageKey is deterministic and namespaced by project", () => {
  assert.equal(
    buildKicadLibraryStorageKey("project-demo", "project-demo"),
    "kicad-libraries/project-demo/project-demo.kicad-lib.tar.gz"
  );
});
