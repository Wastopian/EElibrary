/**
 * File header: Tests the normalized-parameter display formatters in catalog-runtime.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { formatParameterLabel, formatParameterUnit, formatParameterValue } from "./catalog-runtime";
import type { PartParameter } from "./types";

/**
 * Builds a PartParameter with sensible defaults for formatter tests.
 */
function buildParameter(overrides: Partial<PartParameter>): PartParameter {
  return {
    confidenceScore: 0.6,
    id: "param-x",
    isConflicted: false,
    lastUpdatedAt: "2026-07-09T00:00:00.000Z",
    paramKey: "resistance",
    partId: "part-x",
    partType: "resistor",
    sources: [],
    unit: "ohm",
    valueKind: "numeric",
    valueMax: null,
    valueMin: null,
    valueNumeric: 10_000,
    valueText: null,
    winningProviderId: "mouser",
    winningSourceRecordId: null,
    ...overrides
  };
}

/**
 * Verifies canonical unit codes are expanded for display.
 */
test("formatParameterUnit expands non-obvious unit codes", () => {
  assert.equal(formatParameterUnit("ppm_per_c"), "ppm/°C");
  assert.equal(formatParameterUnit("deg C"), "°C");
  assert.equal(formatParameterUnit("ohm"), "ohm");
  assert.equal(formatParameterUnit(null), "");
});

/**
 * Verifies numeric, range, and text parameter values render with their units.
 */
test("formatParameterValue renders each value kind with its unit", () => {
  assert.equal(formatParameterLabel("power_rating"), "Power Rating");
  assert.equal(formatParameterValue(buildParameter({ unit: "ohm", valueNumeric: 10_000 })), "10000 ohm");
  assert.equal(
    formatParameterValue(buildParameter({ paramKey: "operating_temperature_range", unit: "deg C", valueKind: "range", valueMax: 125, valueMin: -55, valueNumeric: null })),
    "-55 to 125 °C"
  );
  assert.equal(
    formatParameterValue(buildParameter({ paramKey: "package", unit: null, valueKind: "text", valueNumeric: null, valueText: "0603" })),
    "0603"
  );
});
