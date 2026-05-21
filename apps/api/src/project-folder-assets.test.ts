/**
 * File header: Tests project mirror asset matching helpers.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPartLookupKeys,
  findMirrorAssetsForPart,
  indexMirrorAssetFiles,
  selectPartsListImportFile
} from "./project-folder-assets";

test("buildPartLookupKeys accepts slash, dash, underscore, and compact spellings", () => {
  const keys = buildPartLookupKeys("ABC/DEF-12");

  assert.equal(keys.includes("abcdef12"), true);
  assert.equal(keys.some((key) => key.includes("abc")), true);
});

test("selectPartsListImportFile prefers PL-style filenames", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ee-pl-pick-"));

  try {
    await mkdir(path.join(root, "parts-list"), { recursive: true });
    await writeFile(path.join(root, "parts-list", "archive.csv"), "old", "utf8");
    await writeFile(path.join(root, "parts-list", "project-pl.csv"), "Designator,MPN,Qty\nU1,ABC,1\n", "utf8");

    const selected = await selectPartsListImportFile(path.join(root, "parts-list"));

    assert.equal(selected?.name, "project-pl.csv");
    assert.equal(selected?.sourceFormat, "csv");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("indexMirrorAssetFiles matches part folders with slash-normalized MPN keys", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ee-asset-index-"));

  try {
    const projectRoot = path.join(root, "alpha");
    await mkdir(path.join(projectRoot, "datasheets", "ABC-DEF"), { recursive: true });
    await mkdir(path.join(projectRoot, "models"), { recursive: true });
    await mkdir(path.join(projectRoot, "footprints"), { recursive: true });
    await writeFile(path.join(projectRoot, "datasheets", "ABC-DEF", "datasheet.pdf"), "%PDF", "utf8");
    await writeFile(path.join(projectRoot, "models", "ABCDEF.stp"), "STEP", "utf8");
    await writeFile(path.join(projectRoot, "footprints", "ABC_DEF.kicad_mod"), "footprint", "utf8");

    const index = await indexMirrorAssetFiles(projectRoot);
    const matches = findMirrorAssetsForPart(index, buildPartLookupKeys("ABC/DEF"));

    assert.equal(matches.length, 3);
    assert.deepEqual(
      matches.map((file) => file.category).sort(),
      ["datasheets", "footprints", "models"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
