/**
 * File header: Tests part kit upload filename helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildUploadedPartKitFileRef, partKitSlotToCategory, suggestPartKitFilename } from "./project-part-kit-upload";

test("suggestPartKitFilename keeps the uploaded extension and sanitizes the MPN stem", () => {
  const file = { name: "package.step" } as File;

  assert.equal(suggestPartKitFilename("TPS7A02DBVR/Q1", file), "TPS7A02DBVR-Q1.step");
});

test("partKitSlotToCategory maps symbol and drawing slots to project folders", () => {
  assert.equal(partKitSlotToCategory("symbol"), "symbols");
  assert.equal(partKitSlotToCategory("mechanical_drawing"), "mechanical_drawings");
});

test("buildUploadedPartKitFileRef preserves symbol file format", () => {
  assert.deepEqual(buildUploadedPartKitFileRef("symbol", "TPS7A02DBVR.kicad_sym"), {
    category: "symbols",
    fileFormat: "kicad_sym",
    name: "TPS7A02DBVR.kicad_sym",
    relativePath: "symbols/TPS7A02DBVR.kicad_sym",
    source: "mirror"
  });
});

test("buildUploadedPartKitFileRef uses the physical drawing folder name", () => {
  assert.equal(
    buildUploadedPartKitFileRef("mechanical_drawing", "TPS7A02DBVR.dxf").relativePath,
    "mechanical-drawings/TPS7A02DBVR.dxf"
  );
});
