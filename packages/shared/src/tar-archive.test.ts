/**
 * File header: Round-trip tests for the ustar writer/reader and gzip/gunzip helpers. The restore
 * path depends on readUstarEntries being the exact inverse of buildUstarTarBuffer, so the round trip
 * (including through gzip) is pinned here.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUstarTarBuffer,
  gunzipBuffer,
  gzipBufferDeterministic,
  readUstarEntries,
  type TarFileEntry
} from "./tar-archive";

const ENTRIES: TarFileEntry[] = [
  { content: Buffer.from("(footprint \"R_0402\")\n", "utf8"), path: "footprints/lib.pretty/R.kicad_mod" },
  { content: Buffer.from(JSON.stringify({ rows: [{ id: "1" }] }), "utf8"), path: "database/parts.json" },
  { content: Buffer.from([0, 1, 2, 3, 255, 128]), path: "storage/000000" }
];

test("readUstarEntries is the exact inverse of buildUstarTarBuffer", () => {
  const tar = buildUstarTarBuffer(ENTRIES);
  const read = readUstarEntries(tar);

  assert.equal(read.length, ENTRIES.length);
  for (const original of ENTRIES) {
    const found = read.find((entry) => entry.path === original.path);
    assert.ok(found, `expected ${original.path} in the read entries`);
    assert.ok(found.content.equals(original.content), `content mismatch for ${original.path}`);
  }
});

test("entries survive a gzip -> gunzip -> read round trip", async () => {
  const tar = buildUstarTarBuffer(ENTRIES);
  const gz = await gzipBufferDeterministic(tar);
  const ungz = await gunzipBuffer(gz);
  const read = readUstarEntries(ungz);

  assert.equal(read.length, ENTRIES.length);
  assert.ok(read.find((e) => e.path === "database/parts.json")?.content.equals(ENTRIES[1]!.content));
});

test("readUstarEntries handles content whose length is an exact block multiple", () => {
  const exact: TarFileEntry = { content: Buffer.alloc(512, 7), path: "storage/000001" };
  const read = readUstarEntries(buildUstarTarBuffer([exact]));
  assert.equal(read.length, 1);
  assert.ok(read[0]!.content.equals(exact.content));
});

test("readUstarEntries returns nothing for an empty archive", () => {
  assert.deepEqual(readUstarEntries(buildUstarTarBuffer([])), []);
});
