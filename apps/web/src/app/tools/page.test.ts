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

  // Ohm's Law card — defaults to V + I known (5 V, 10 mA), so the result block
  // labels voltage and current as known and computes resistance and power.
  // The renderer HTML-escapes apostrophes, so match the entity form too.
  assert.match(html, /Ohm(?:'|&#x27;)s Law \+ Power/u);
  assert.match(html, /V = I × R · P = V × I/u);
  assert.match(html, /Voltage \(V\) — known/u);
  assert.match(html, /Current \(I\) — known/u);
  // 5 V / 10 mA -> 500 Ω, 50 mW.
  assert.match(html, /500 Ω/u);
  assert.match(html, /50 mW/u);

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

  // LED current-limit card — default 5 V / 2 V Vf / 20 mA -> 150 Ω, 60 mW resistor,
  // 40 mW LED, with the E96 1% suggestion row.
  assert.match(html, /LED current-limit resistor/u);
  assert.match(html, /R = \(Vsupply − Vf\) \/ I_LED/u);
  assert.match(html, /Series resistor/u);
  assert.match(html, /Voltage across resistor/u);
  assert.match(html, /Resistor dissipation/u);
  assert.match(html, /LED dissipation/u);
  assert.match(html, /150 Ω/u);
  assert.match(html, /60 mW/u);
  assert.match(html, /40 mW/u);

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
