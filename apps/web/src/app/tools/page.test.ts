/**
 * File header: Tests the dedicated engineering tools workspace rendering.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ToolsPage from "./page";

/**
 * Verifies the tools route ships real calculators with evidence-note boundaries.
 */
test("tools page renders calculator workbench and trust boundaries", () => {
  const html = renderToStaticMarkup(React.createElement(ToolsPage));

  assert.match(html, /Engineering tools/u);
  assert.match(html, /Calculators that leave a trail/u);
  assert.match(html, /Voltage divider/u);
  assert.match(html, /Pull-up edge/u);
  assert.match(html, /Power derating/u);
  assert.match(html, /Evidence note draft/u);
  assert.match(html, /No gate changes/u);
  assert.match(html, /does not approve a part/u);
  assert.match(html, /Attach evidence/u);
  assert.doesNotMatch(html, /toy demo/u);
});
