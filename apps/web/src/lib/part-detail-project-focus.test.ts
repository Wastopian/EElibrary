/**
 * File header: Tests project-focused part detail query helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectFocusKitHref, normalizeProjectContextId } from "./part-detail-project-focus";

test("normalizeProjectContextId reads a single project query param", () => {
  assert.equal(normalizeProjectContextId({ project: "project-alpha" }), "project-alpha");
  assert.equal(normalizeProjectContextId({ project: "  " }), null);
  assert.equal(normalizeProjectContextId({}), null);
});

test("buildProjectFocusKitHref links back to the project parts section", () => {
  assert.equal(buildProjectFocusKitHref("project-alpha"), "/projects/project-alpha#project-usage-heading");
});
