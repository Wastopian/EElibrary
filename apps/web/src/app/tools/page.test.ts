/**
 * File header: Tests that the /tools workspace renders both calculator cards.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ToolsPage from "./page";

/**
 * Verifies both calculator cards render with their headings, formulas, and inputs.
 */
test("tools page renders the voltage divider and RC time constant calculator cards", () => {
  const html = renderToStaticMarkup(ToolsPage());

  assert.match(html, /Engineering calculators/u);

  // Voltage divider card — defaults to "compute Vout" mode, so the result block
  // shows Vout, divider current, dissipated power, and the ratio.
  assert.match(html, /Voltage divider/u);
  assert.match(html, /Vout = Vin × R2 \/ \(R1 \+ R2\)/u);
  assert.match(html, /Compute Vout/u);
  assert.match(html, /Solve for a resistor/u);
  assert.match(html, /Divider current/u);
  assert.match(html, /Power dissipated/u);
  assert.match(html, /Ratio \(Vout \/ Vin\)/u);
  // Default 5V / 10kΩ / 10kΩ pair must surface a clean 2.5 V Vout.
  assert.match(html, /2\.5 V/u);

  // RC time constant card.
  assert.match(html, /RC time constant/u);
  assert.match(html, /τ = R × C/u);
  assert.match(html, /To ~63% \(1τ\)/u);
  assert.match(html, /To ~95% \(3τ\)/u);
  assert.match(html, /To ~99% \(5τ\)/u);
  assert.match(html, /Low-pass cutoff/u);

  // Honest framing — no "approval" or "verified for export" copy here.
  assert.doesNotMatch(html, /promote/iu);
  assert.doesNotMatch(html, /verified for export/iu);
});
