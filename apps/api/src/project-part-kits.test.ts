/**
 * File header: Tests project part kit lookup key matching helpers used by the kit list API.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { pickBomDescription, pickBomSupplierUrl } from "./project-part-kits";
import { buildPartLookupKeys, findMirrorAssetsForPart, indexMirrorAssetFiles } from "./project-folder-assets";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

test("pickBomSupplierUrl reads http URLs from unmapped payload cells", () => {
  const url = pickBomSupplierUrl(null, {
    "Part Number": "TPS7A02DBVR",
    "Vendor link": "https://www.digikey.com/en/products/detail/example/123"
  });

  assert.equal(url, "https://www.digikey.com/en/products/detail/example/123");
});

test("pickBomDescription reads long text from unmapped payload cells", () => {
  const description = pickBomDescription(null, {
    MPN: "TPS7A02DBVR",
    Notes: "250mA LDO regulator, SOT-23-5"
  }, "TPS7A02DBVR");

  assert.equal(description, "250mA LDO regulator, SOT-23-5");
});

test("list part kits finds datasheet and model files by flexible MPN folder names", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ee-part-kit-"));
  const datasheets = path.join(root, "datasheets");
  const models = path.join(root, "models");

  await mkdir(datasheets, { recursive: true });
  await mkdir(models, { recursive: true });
  await writeFile(path.join(datasheets, "TPS7A02DBVR.pdf"), "%PDF-1.4");
  await writeFile(path.join(models, "TPS7A02DBVR.step"), "solid");

  const index = await indexMirrorAssetFiles(root);
  const matches = findMirrorAssetsForPart(index, buildPartLookupKeys("TPS7A02DBVR"));

  assert.equal(matches.length, 2);
  assert.ok(matches.some((file) => file.category === "datasheets"));
  assert.ok(matches.some((file) => file.category === "models"));
});
