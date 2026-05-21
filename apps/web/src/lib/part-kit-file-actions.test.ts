/**
 * File header: Tests kit file open/download detection for non-standard filenames.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildKitFileActions, isViewableKitFile } from "./part-kit-file-actions";
import type { ProjectPartKitFileRef } from "@ee-library/shared/types";

const catalogDatasheet: ProjectPartKitFileRef = {
  assetId: "asset-ds-1",
  category: "datasheets",
  downloadUrl: "/api/parts/part-1/assets/asset-ds-1/download",
  fileFormat: "pdf",
  name: "cbj3157-pdf",
  relativePath: "catalog/asset-ds-1",
  source: "catalog"
};

test("isViewableKitFile treats datasheet slot files without .pdf extension as openable", () => {
  assert.equal(isViewableKitFile("datasheet", catalogDatasheet), true);
});

test("buildKitFileActions offers open and download for catalog datasheets", () => {
  const actions = buildKitFileActions(catalogDatasheet, "part-1", "project-1", "datasheet");

  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.label, "Open PDF");
  assert.match(actions[0]?.href ?? "", /\/download$/u);
  assert.equal(actions[1]?.label, "Download PDF");
  assert.match(actions[1]?.href ?? "", /attachment=1/u);
});

test("buildKitFileActions offers download only for STEP models", () => {
  const model: ProjectPartKitFileRef = {
    assetId: "asset-3d-1",
    category: "models",
    downloadUrl: "/api/parts/part-1/assets/asset-3d-1/download",
    fileFormat: "step",
    name: "cbj3157-stp",
    relativePath: "catalog/asset-3d-1",
    source: "catalog"
  };

  const actions = buildKitFileActions(model, "part-1", "project-1", "model");

  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.label, "Download STEP");
});
