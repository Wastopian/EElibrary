/**
 * File header: Tests shared distributor normalization helpers (unit parsing and spec-row assembly).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { assembleNormalizedPart, buildSpecificationRows, parseEngineeringNumber, slugify } from "./providers/distributor-normalize";

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

/**
 * Verifies scientific notation (JLC String(1e-7) and provider "1.0E-7 F") keeps the exponent instead of
 * truncating to the mantissa and storing Farads off by orders of magnitude.
 */
test("parseEngineeringNumber preserves scientific-notation exponents", () => {
  const close = (raw: string, unit: Parameters<typeof parseEngineeringNumber>[1], expected: number) => {
    const value = parseEngineeringNumber(raw, unit) ?? NaN;
    assert.ok(Math.abs(value - expected) <= Math.abs(expected) * 1e-9, `${raw} -> ${value}, expected ~${expected}`);
  };

  close("1e-7", "F", 1e-7);
  close("1E-7", "F", 1e-7);
  close("4.7e-6", "F", 4.7e-6);
  close("1.0E-7 F", "F", 1e-7);
  close(String(1e-7), "F", 1e-7);
  close(String(2.2e-12), "F", 2.2e-12);
});

/**
 * Verifies a lead-free "+" suffix stays in the part id. MAX232CPE and MAX232CPE+ are different
 * orderable parts; stripping "+" made the second import overwrite the first.
 */
test("slugify keeps a lead-free plus suffix distinct from the base MPN", () => {
  assert.equal(slugify("MAX232CPE"), "max232cpe");
  assert.equal(slugify("MAX232CPE+"), "max232cpeplus");
  assert.equal(slugify("RC0603FR-0710KL"), "rc0603fr-0710kl");

  const plain = assembleNormalizedPart(minimalPartInput("MAX232CPE"));
  const leadFree = assembleNormalizedPart(minimalPartInput("MAX232CPE+"));

  assert.equal(plain.part.id, "part-digikey-maxim-integrated-max232cpe");
  assert.equal(leadFree.part.id, "part-digikey-maxim-integrated-max232cpeplus");
  assert.equal(leadFree.part.mpn, "MAX232CPE+");
  assert.notEqual(plain.part.id, leadFree.part.id);
});

/**
 * Builds the smallest assembleNormalizedPart input that still produces a stable part id.
 */
function minimalPartInput(mpn: string) {
  return {
    category: "Interface",
    datasheetUrl: null,
    description: mpn,
    fetchedAt: "2026-11-20T00:00:00.000Z",
    lifecycleStatus: "active" as const,
    manufacturerName: "Maxim Integrated",
    manufacturerWebsite: null,
    metrics: [],
    mpn,
    packageName: "PDIP-16",
    pinCount: 16,
    providerId: "digikey",
    providerPartKey: `dk-${mpn}`,
    rawPayload: { mpn },
    sourceUrl: "https://www.digikey.com",
    supplyOfferings: [],
    trustScore: 0.66
  };
}
