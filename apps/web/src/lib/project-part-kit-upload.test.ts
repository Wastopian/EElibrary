/**
 * File header: Tests part kit upload filename helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { suggestPartKitFilename } from "./project-part-kit-upload";

test("suggestPartKitFilename keeps the uploaded extension and sanitizes the MPN stem", () => {
  const file = { name: "package.step" } as File;

  assert.equal(suggestPartKitFilename("TPS7A02DBVR/Q1", file), "TPS7A02DBVR-Q1.step");
});
