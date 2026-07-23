/**
 * File header: Tests engineering-value parsing and multi-source reconciliation for normalized parameters.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { formatBareEngineeringNumber, formatEngineeringValue, parseBareEngineeringNumber, parseEngineeringValue, reconcileParameterSources, type ParameterContribution } from "./parameter-normalize";
import type { CanonicalParameterDef } from "./parameter-registry";

const RESISTANCE: CanonicalParameterDef = { label: "Resistance", metricKeys: [], paramKey: "resistance", specKeyPatterns: ["resistance"], unit: "ohm", valueKind: "numeric" };
const TOLERANCE: CanonicalParameterDef = { label: "Tolerance", metricKeys: [], paramKey: "tolerance", specKeyPatterns: ["tolerance"], unit: "%", valueKind: "numeric" };
const POWER: CanonicalParameterDef = { label: "Power", metricKeys: [], paramKey: "power_rating", specKeyPatterns: ["power"], unit: "W", valueKind: "numeric" };
const CAPACITANCE: CanonicalParameterDef = { label: "Capacitance", metricKeys: [], paramKey: "capacitance", specKeyPatterns: ["capacitance"], unit: "F", valueKind: "numeric" };
const TEMP_RANGE: CanonicalParameterDef = { label: "Operating Temperature Range", metricKeys: [], paramKey: "operating_temperature_range", specKeyPatterns: ["operating temperature"], unit: "deg C", valueKind: "range" };
const CURRENT: CanonicalParameterDef = { label: "Output Current", metricKeys: [], paramKey: "output_current", specKeyPatterns: ["output current"], unit: "A", valueKind: "numeric" };
const FREQUENCY: CanonicalParameterDef = { label: "Clock Frequency", metricKeys: [], paramKey: "clock_frequency", specKeyPatterns: ["clock frequency"], unit: "Hz", valueKind: "numeric" };
const MEMORY: CanonicalParameterDef = { label: "Flash Size", metricKeys: [], paramKey: "flash_size", specKeyPatterns: ["flash"], unit: "B", valueKind: "numeric" };
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
 * Verifies the attached-prefix forms providers actually send ("200mA", "64MHz") and the byte unit for
 * memory sizes parse into base units — the vocabulary the MCU/regulator registry entries rely on.
 */
test("parseEngineeringValue handles attached prefixes and memory sizes", () => {
  const numeric = (raw: string, def: CanonicalParameterDef): number | null => {
    const parsed = parseEngineeringValue(raw, def);

    return parsed?.kind === "numeric" ? parsed.value : null;
  };

  assert.equal(numeric("200mA", CURRENT), 0.2, "attached milli prefix");
  assert.equal(numeric("200 mA", CURRENT), 0.2);
  const quiescent = numeric("25 nA", CURRENT);
  assert.ok(quiescent !== null && Math.abs(quiescent - 25e-9) <= 1e-18);
  assert.equal(numeric("64MHz", FREQUENCY), 64_000_000, "attached MHz");
  assert.equal(numeric("64 MHz", FREQUENCY), 64_000_000);
  assert.equal(numeric("32 kHz", FREQUENCY), 32_000);
  assert.equal(numeric("64 Kbytes", MEMORY), 64_000, "spelled-out kilobytes");
  assert.equal(numeric("64KB", MEMORY), 64_000, "attached KB");
  assert.equal(numeric("1 MB", MEMORY), 1_000_000);
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
 * Verifies base-unit values render in the engineering notation an EE reads, the display inverse of
 * parseBareEngineeringNumber ("10 kΩ", "100 nF", "1%"), across the registry's canonical units.
 */
test("formatEngineeringValue renders base-unit values in engineering notation", () => {
  assert.equal(formatEngineeringValue(10_000, "ohm"), "10 kΩ");
  assert.equal(formatEngineeringValue(4_700, "ohm"), "4.7 kΩ");
  assert.equal(formatEngineeringValue(220, "ohm"), "220 Ω");
  assert.equal(formatEngineeringValue(0.05, "ohm"), "50 mΩ");
  assert.equal(formatEngineeringValue(1_000_000, "ohm"), "1 MΩ");
  assert.equal(formatEngineeringValue(100e-9, "F"), "100 nF");
  assert.equal(formatEngineeringValue(4.7e-6, "F"), "4.7 µF");
  assert.equal(formatEngineeringValue(0.1, "W"), "100 mW");
  assert.equal(formatEngineeringValue(50, "V"), "50 V");
  assert.equal(formatEngineeringValue(1, "%"), "1%");
  assert.equal(formatEngineeringValue(0.5, "%"), "0.5%");
  assert.equal(formatEngineeringValue(125, "deg C"), "125 °C");
  assert.equal(formatEngineeringValue(100, "ppm_per_c"), "100 ppm/°C");
  assert.equal(formatEngineeringValue(64_000, "B"), "64 kB");
  assert.equal(formatEngineeringValue(64_000_000, "Hz"), "64 MHz");
  assert.equal(formatEngineeringValue(0, "ohm"), "0 Ω");
  assert.equal(formatEngineeringValue(42, null), "42");

  // Round-trip: what the formatter prints, the filter parser reads back to the same base value.
  assert.equal(parseBareEngineeringNumber("10k"), 10_000);
  assert.equal(formatEngineeringValue(parseBareEngineeringNumber("4.7k") ?? Number.NaN, "ohm"), "4.7 kΩ");
});

/**
 * Verifies the unit-less shorthand formatter emits exactly what parseBareEngineeringNumber accepts,
 * so facet-derived placeholders are always typeable back into the filter inputs.
 */
test("formatBareEngineeringNumber emits parser-compatible shorthand", () => {
  assert.equal(formatBareEngineeringNumber(10_000), "10k");
  assert.equal(formatBareEngineeringNumber(1_000_000), "1M");
  assert.equal(formatBareEngineeringNumber(0.1), "100m");
  assert.equal(formatBareEngineeringNumber(4.7e-6), "4.7µ");
  assert.equal(formatBareEngineeringNumber(220), "220");
  assert.equal(formatBareEngineeringNumber(-55), "-55");
  assert.equal(formatBareEngineeringNumber(0), "0");

  for (const value of [10_000, 1_000_000, 0.1, 4.7e-6, 220, 100e-9]) {
    const shorthand = formatBareEngineeringNumber(value);
    const parsed = parseBareEngineeringNumber(shorthand);

    assert.ok(parsed !== null && Math.abs(parsed - value) <= Math.abs(value) * 1e-9, `round-trip failed for ${value} -> "${shorthand}" -> ${parsed}`);
  }
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

test("parseEngineeringValue parses DigiKey memory sizes including the bare-K 'N K x 8' form", () => {
  const FLASH: CanonicalParameterDef = { label: "Flash Size", metricKeys: [], paramKey: "flash_size", specKeyPatterns: ["flash"], unit: "B", valueKind: "numeric" };
  const RAM: CanonicalParameterDef = { label: "RAM Size", metricKeys: [], paramKey: "ram_size", specKeyPatterns: ["ram"], unit: "B", valueKind: "numeric" };
  const numeric = (raw: string, def: CanonicalParameterDef): number | null => {
    const parsed = parseEngineeringValue(raw, def);
    return parsed?.kind === "numeric" ? parsed.value : null;
  };

  // The bug this covers: "8K x 8" previously read as a wrong 8 bytes.
  assert.equal(numeric("8K x 8", RAM), 8_000);
  assert.equal(numeric("64K x 8", FLASH), 64_000);
  // The verbose DigiKey flash form still resolves via the kb branch.
  assert.equal(numeric("64KB (64K x 8)", FLASH), 64_000);
  assert.equal(numeric("256 Kbytes", FLASH), 256_000);
  assert.equal(numeric("2M x 8", FLASH), 2_000_000);
});
