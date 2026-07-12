/**
 * File header: Tests the conservative heuristic datasheet parameter extractor.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { extractDatasheetParameters } from "./datasheet-extract";

/**
 * Verifies passive datasheet text yields the expected canonical parameters in base units.
 */
test("extractDatasheetParameters reads passive parameters from datasheet text", () => {
  const text = [
    "YAGEO RC0603 Thick Film Chip Resistor",
    "Resistance: 10 kOhm",
    "Tolerance: ±1%",
    "Power Rating: 0.1 W",
    "Temperature Coefficient: ±100 ppm/°C"
  ].join("\n");

  const extracted = extractDatasheetParameters(text, "resistor");
  const byKey = new Map(extracted.map((entry) => [entry.paramKey, entry.typed]));
  const numeric = (key: string): number | null => {
    const typed = byKey.get(key);

    return typed?.kind === "numeric" ? typed.value : null;
  };

  assert.equal(numeric("resistance"), 10_000);
  assert.equal(numeric("tolerance"), 1);
  assert.equal(numeric("power_rating"), 0.1);
  // Package is a text param and is intentionally not extracted from datasheet prose.
  assert.equal(byKey.has("package"), false);
});

/**
 * Verifies the extractor stays silent on text without recognizable label/value pairs.
 */
test("extractDatasheetParameters emits nothing for junk text", () => {
  assert.deepEqual(extractDatasheetParameters("The quick brown fox jumps over the lazy dog.", "resistor"), []);
  assert.deepEqual(extractDatasheetParameters("", "capacitor"), []);
});

/**
 * Verifies isolated-word matching so labels inside other words do not trigger false extractions.
 */
test("extractDatasheetParameters requires isolated labels", () => {
  // "increase" contains "case" but must not be read as a package/case value; resistor has no case param
  // anyway, and this guards the boundary logic used by every label.
  const extracted = extractDatasheetParameters("A gradual increase 47 in temperature.", "resistor");

  assert.deepEqual(extracted, []);
});

/**
 * Verifies capacitor dielectric (enum) extraction from a datasheet line.
 */
test("extractDatasheetParameters reads a capacitor dielectric enum", () => {
  const extracted = extractDatasheetParameters("Capacitance 100 nF Dielectric X7R", "capacitor");
  const dielectric = extracted.find((entry) => entry.paramKey === "dielectric")?.typed;

  assert.equal(dielectric?.kind, "enum");
  assert.equal(dielectric && dielectric.kind === "enum" ? dielectric.text : null, "X7R");
});
