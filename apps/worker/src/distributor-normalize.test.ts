/**
 * File header: Tests shared distributor normalization helpers (unit parsing and spec-row assembly).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecificationRows, parseEngineeringNumber } from "./providers/distributor-normalize";

/**
 * Verifies ohm prefixes parse across plural, attached, and case-sensitive forms so a real provider
 * value like "10 kOhms" is never stored as 10 ohms.
 */
test("parseEngineeringNumber resolves ohm prefixes for plural, attached, and cased provider forms", () => {
  assert.equal(parseEngineeringNumber("10 kOhms", "ohm"), 10_000);
  assert.equal(parseEngineeringNumber("10kOhms", "ohm"), 10_000);
  assert.equal(parseEngineeringNumber("4.7 kOhm", "ohm"), 4_700);
  assert.equal(parseEngineeringNumber("1 MOhm", "ohm"), 1_000_000);
  assert.equal(parseEngineeringNumber("2.2 MOhms", "ohm"), 2_200_000);
  assert.equal(parseEngineeringNumber("50 mOhm", "ohm"), 0.05);
  assert.equal(parseEngineeringNumber("100 Ohms", "ohm"), 100);
});

/**
 * Confirms the other unit families still parse their standard prefixes.
 */
test("parseEngineeringNumber resolves farad and henry prefixes", () => {
  const closeTo = (actual: number | null, expected: number) => {
    assert.ok(actual !== null && Math.abs(actual - expected) <= Math.abs(expected) * 1e-9, `${actual} not close to ${expected}`);
  };

  closeTo(parseEngineeringNumber("4.7 uF", "F"), 4.7e-6);
  closeTo(parseEngineeringNumber("100 nF", "F"), 100e-9);
  closeTo(parseEngineeringNumber("10 nH", "H"), 10e-9);
});

/**
 * Verifies spec rows dedupe repeated labels, join their values, and get deterministic, provider-scoped ids.
 */
test("buildSpecificationRows dedupes repeated labels and builds deterministic ids", () => {
  const rows = buildSpecificationRows("mouser", "603-RC0603FR-0710KL", "part-x", "source-x", "2026-05-16T00:00:00.000Z", [
    { specGroup: "parametric", specKey: "Packaging", specValue: "Cut Tape (CT)" },
    { specGroup: "parametric", specKey: "Packaging", specValue: "Reel" },
    { specGroup: "parametric", specKey: "Packaging", specValue: "Reel" },
    { specGroup: "compliance", specKey: "RoHS Status", specValue: "RoHS Compliant" },
    { specGroup: "parametric", specKey: "  ", specValue: "ignored" }
  ]);

  assert.equal(rows.length, 2, "repeated Packaging collapses and the blank-key row is dropped");

  const packaging = rows.find((row) => row.specKey === "Packaging");

  assert.equal(packaging?.specValue, "Cut Tape (CT) / Reel", "duplicate values are not repeated");
  assert.equal(packaging?.id, "spec-mouser-603-rc0603fr-0710kl-packaging");
  assert.equal(packaging?.partId, "part-x");
  assert.equal(packaging?.sourceRecordId, "source-x");
});

test("parseEngineeringNumber scales attached sub-unit prefixes and leading-dot decimals", () => {
  const close = (raw: string, unit: Parameters<typeof parseEngineeringNumber>[1], expected: number) => {
    const value = parseEngineeringNumber(raw, unit) ?? NaN;
    assert.ok(Math.abs(value - expected) <= Math.abs(expected) * 1e-9, `${raw} -> ${value}, expected ~${expected}`);
  };
  // Attached F/H prefixes (the digit->letter seam a leading \b never matched) and leading-dot values.
  close("1uF", "F", 1e-6);
  close("100nF", "F", 1e-7);
  close(".1UF", "F", 1e-7);
  close("2.2uF", "F", 2.2e-6);
  close("4.7uH", "H", 4.7e-6);
  // Attached V/A/Hz forms scale too.
  close("16V", "V", 16);
  close("200mA", "A", 0.2);
  close("64MHz", "Hz", 64_000_000);
});
