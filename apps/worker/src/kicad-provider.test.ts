/**
 * File header: Tests the local KiCad CAD index adapter against a temporary library tree.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { kicadProviderAdapter } from "./providers/kicad-provider";

/**
 * Verifies the adapter groups same-stem CAD files and normalizes them as reference-only assets.
 */
test("kicad provider indexes a local library group and normalizes honest CAD references", async () => {
  const root = await mkdtemp(join(tmpdir(), "kicad-index-"));
  const previousRoot = process.env.KICAD_LIBRARY_ROOT;
  process.env.KICAD_LIBRARY_ROOT = root;

  try {
    const prettyDir = join(root, "MyLib.pretty");
    await mkdir(prettyDir, { recursive: true });
    await writeFile(join(prettyDir, "Conn_01x04.kicad_mod"), "(footprint \"Conn_01x04\")\n");
    await writeFile(join(prettyDir, "Conn_01x04.step"), "ISO-10303-21;\n");
    await writeFile(join(root, "Symbols.kicad_sym"), "(kicad_symbol_lib)\n");

    const requests = await kicadProviderAdapter.listAvailablePartRequests();
    const indexedKeys = requests.map((request) => request.providerPartId);

    assert.ok(indexedKeys.includes("Conn_01x04"), "expected the footprint group to be enumerated");
    assert.ok(indexedKeys.includes("Symbols"), "expected the symbol library to be enumerated");

    const rawPayload = await kicadProviderAdapter.fetchRawPart({ providerPartId: "conn_01x04" });
    const normalized = kicadProviderAdapter.normalizeRawPart(rawPayload);

    assert.equal(normalized.sourceRecord.providerId, "kicad");
    assert.equal(normalized.part.mpn, "Conn_01x04");
    assert.equal(normalized.manufacturer.name, "KiCad public library");
    assert.equal(normalized.package.packageName, "MyLib.pretty");
    assert.equal(normalized.part.lifecycleStatus, "unknown");
    assert.equal(normalized.datasheetRevisions[0]?.parseConfidence, 0);

    const assetTypes = normalized.assets.map((asset) => asset.assetType).sort();

    assert.deepEqual(assetTypes, ["footprint", "three_d_model"]);

    for (const asset of normalized.assets) {
      assert.equal(asset.storageKey, null, "indexed CAD references are not stored locally");
      assert.equal(asset.validationStatus, "not_validated", "indexed CAD references are never auto-validated");
    }
  } finally {
    if (previousRoot === undefined) {
      delete process.env.KICAD_LIBRARY_ROOT;
    } else {
      process.env.KICAD_LIBRARY_ROOT = previousRoot;
    }

    await rm(root, { force: true, recursive: true });
  }
});

/**
 * Confirms a missing root yields a clean no-match instead of throwing.
 */
test("kicad provider returns no candidates when the library root is absent", async () => {
  const previousRoot = process.env.KICAD_LIBRARY_ROOT;
  process.env.KICAD_LIBRARY_ROOT = join(tmpdir(), "kicad-index-does-not-exist-eelib");

  try {
    const candidates = await kicadProviderAdapter.findExactPartCandidates({ query: "Anything" });

    assert.deepEqual(candidates, []);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.KICAD_LIBRARY_ROOT;
    } else {
      process.env.KICAD_LIBRARY_ROOT = previousRoot;
    }
  }
});
