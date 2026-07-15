/**
 * File header: Tests engineering-value parsing and multi-source reconciliation for normalized parameters.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseBareEngineeringNumber, parseEngineeringValue, reconcileParameterSources, type ParameterContribution } from "./parameter-normalize";
import type { CanonicalParameterDef } from "./parameter-registry";

const RESISTANCE: CanonicalParameterDef = { label: "Resistance", metricKeys: [], paramKey: "resistance", specKeyPatterns: ["resistance"], unit: "ohm", valueKind: "numeric" };
const TOLERANCE: CanonicalParameterDef = { label: "Tolerance", metricKeys: [], paramKey: "tolerance", specKeyPatterns: ["tolerance"], unit: "%", valueKind: "numeric" };
const POWER: CanonicalParameterDef = { label: "Power", metricKeys: [], paramKey: "power_rating", specKeyPatterns: ["power"], unit: "W", valueKind: "numeric" };
const CAPACITANCE: CanonicalParameterDef = { label: "Capacitance", metricKeys: [], paramKey: "capacitance", specKeyPatterns: ["capacitance"], unit: "F", valueKind: "numeric" };
const TEMP_RANGE: CanonicalParameterDef = { label: "Operating Temperature Range", metricKeys: [], paramKey: "operating_temperature_range", specKeyPatterns: ["operating temperature"], unit: "deg C", valueKind: "range" };
const DIELECTRIC: CanonicalParameterDef = { enumValues: ["C0G", "X7R", "X5R"], label: "Dielectric", metricKeys: [], paramKey: "dielectric", specKeyPatterns: ["dielectric"], unit: null, valueKind: "enum" };
const PACKAGE: CanonicalParameterDef = { label: "Package", metricKeys: [], paramKey: "package", specKeyPatterns: ["package"], unit: null, valueKind: "text" };

/**
 * Verifies numeric parsing handles SI prefixes across plural/attached/cased forms and unit families.
 */
test("parseEngineeringValue normalizes numeric values into canonical base units", () => {
  const numeric = (raw: string, def: CanonicalParameterDef): number | null => {
    const parsed = parseEngineeringValue(raw, def);

    return parsed?.kind === "numeric" ? parsed.value : null;
  };

  assert.equal(numeric("10kOhms", RESISTANCE), 10_000);
  assert.equal(numeric("10 kOhms", RESISTANCE), 10_000);
  assert.equal(numeric("1 MOhm", RESISTANCE), 1_000_000);
  assert.equal(numeric("50 mOhm", RESISTANCE), 0.05);
  assert.equal(numeric("100 Ohms", RESISTANCE), 100);
  assert.equal(numeric("±1%", TOLERANCE), 1);
  assert.equal(numeric("1/10W", POWER), 0.1);
  assert.equal(numeric("250mW", POWER), 0.25);
  assert.equal(numeric("0.25 W", POWER), 0.25);

  const cap = parseEngineeringValue("100 nF", CAPACITANCE);

  assert.ok(cap?.kind === "numeric" && Math.abs(cap.value - 100e-9) <= 1e-18);
});

/**
 * Verifies unit-less filter inputs parse SI prefixes, case-sensitively for milli vs mega.
 */
test("parseBareEngineeringNumber resolves unit-less SI prefixes for filter inputs", () => {
  assert.equal(parseBareEngineeringNumber("1k"), 1_000);
  assert.equal(parseBareEngineeringNumber("4.7k"), 4_700);
  assert.equal(parseBareEngineeringNumber("10M"), 10_000_000);
  assert.equal(parseBareEngineeringNumber("10m"), 0.01);
  assert.equal(parseBareEngineeringNumber("220"), 220);
  assert.equal(parseBareEngineeringNumber("4.7u"), 4.7e-6);
  assert.equal(parseBareEngineeringNumber("1000"), 1_000);
  assert.equal(parseBareEngineeringNumber("abc"), null);
  assert.equal(parseBareEngineeringNumber("10kOhm"), null, "a trailing unit is rejected; this parser is unit-less");
});

/**
 * Verifies range, enum, and text kinds parse into their canonical shapes.
 */
test("parseEngineeringValue handles range, enum, and text kinds", () => {
  const range = parseEngineeringValue("-55°C ~ +125°C", TEMP_RANGE);

  assert.deepEqual(range, { kind: "range", max: 125, min: -55, unit: "deg C" });
  assert.deepEqual(parseEngineeringValue("±10% X7R", DIELECTRIC), { kind: "enum", text: "X7R", unit: null });
  assert.deepEqual(parseEngineeringValue("0603", PACKAGE), { kind: "text", text: "0603", unit: null });
  assert.equal(parseEngineeringValue("   ", PACKAGE), null);
});

/**
 * Builds a numeric contribution helper for reconciliation tests.
 */
function numericContribution(providerId: string, value: number, confidence: number): ParameterContribution {
  return { confidence, providerId, rawSpecKey: "Resistance", rawValue: String(value), sourceRecordId: `source-${providerId}`, typed: { kind: "numeric", unit: "ohm", value } };
}

/**
 * Verifies reconciliation picks a winner by trust order and flags no conflict when sources agree.
 */
test("reconcileParameterSources agrees within tolerance and ranks by provider trust", () => {
  const reconciled = reconcileParameterSources([
    numericContribution("mouser", 10_050, 0.6),
    numericContribution("digikey", 10_000, 0.6)
  ]);

  assert.ok(reconciled);
  assert.equal(reconciled.winningProviderId, "digikey", "digikey outranks mouser at equal confidence");
  assert.equal(reconciled.valueNumeric, 10_000);
  assert.equal(reconciled.isConflicted, false, "0.5% apart is within tolerance");
  assert.equal(reconciled.sources.length, 2);
  assert.ok(reconciled.sources.every((source) => source.agreesWithWinner));
});

/**
 * Verifies higher confidence beats trust order, and divergent values flag a conflict.
 */
test("reconcileParameterSources prefers confidence and flags divergence", () => {
  const byConfidence = reconcileParameterSources([
    numericContribution("jlcparts", 10_000, 0.9),
    numericContribution("digikey", 10_000, 0.6)
  ]);

  assert.equal(byConfidence?.winningProviderId, "jlcparts", "higher confidence wins over trust order");

  const conflicted = reconcileParameterSources([
    numericContribution("digikey", 10_000, 0.6),
    numericContribution("mouser", 12_000, 0.6)
  ]);

  assert.ok(conflicted);
  assert.equal(conflicted.winningProviderId, "digikey");
  assert.equal(conflicted.valueNumeric, 10_000);
  assert.equal(conflicted.isConflicted, true, "20% apart is a conflict");
  assert.equal(conflicted.sources.find((source) => source.providerId === "mouser")?.agreesWithWinner, false);
});

/**
 * Verifies the "corroborate, don't override" policy: an unreviewed datasheet value (modest confidence)
 * does not beat a distributor, but fills gaps and is promoted once its confidence is raised by review.
 */
test("reconcileParameterSources treats an unreviewed datasheet as corroborating, not overriding", () => {
  // Datasheet below distributor confidence: distributor stays the winner; the divergent datasheet
  // value flags a conflict for review rather than silently replacing good data.
  const contested = reconcileParameterSources([
    numericContribution("digikey", 10_000, 0.6),
    numericContribution("datasheet", 9_000, 0.5)
  ]);

  assert.equal(contested?.winningProviderId, "digikey", "distributor keeps the shown value");
  assert.equal(contested?.valueNumeric, 10_000);
  assert.equal(contested?.isConflicted, true, "the divergent datasheet value flags a conflict");

  // Datasheet as the only source fills a gap.
  const soleSource = reconcileParameterSources([numericContribution("datasheet", 9_000, 0.5)]);
  assert.equal(soleSource?.winningProviderId, "datasheet");
  assert.equal(soleSource?.valueNumeric, 9_000);

  // A reviewed datasheet (confidence raised above the distributor) wins.
  const reviewed = reconcileParameterSources([
    numericContribution("digikey", 10_000, 0.6),
    numericContribution("datasheet", 9_000, 0.9)
  ]);
  assert.equal(reviewed?.winningProviderId, "datasheet");
});
