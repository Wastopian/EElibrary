/**
 * File header: Tests deterministic provider payload normalization helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssetState, normalizeLifecycleStatus, normalizeMetricUnit, normalizeNullableNumber } from "./index";

/**
 * Verifies common provider lifecycle spellings map to canonical lifecycle values.
 */
test("normalizeLifecycleStatus maps known provider lifecycle strings", () => {
  assert.equal(normalizeLifecycleStatus("Active"), "active");
  assert.equal(normalizeLifecycleStatus("NRND"), "not_recommended");
  assert.equal(normalizeLifecycleStatus("obsolete"), "obsolete");
  assert.equal(normalizeLifecycleStatus(undefined), "unknown");
});

/**
 * Verifies provider unit spellings map to the internal unit policy.
 */
test("normalizeMetricUnit maps provider unit spellings", () => {
  assert.equal(normalizeMetricUnit("volts"), "V");
  assert.equal(normalizeMetricUnit("millimeters"), "mm");
  assert.equal(normalizeMetricUnit("degrees c"), "deg C");
});

/**
 * Verifies unsupported units fail loudly instead of becoming uncertain data.
 */
test("normalizeMetricUnit rejects unsupported provider unit strings", () => {
  assert.throws(() => normalizeMetricUnit("parsecs"), /Unsupported metric unit/u);
});

/**
 * Verifies nullable numeric normalization preserves unknown values.
 */
test("normalizeNullableNumber preserves null and parses numeric strings", () => {
  assert.equal(normalizeNullableNumber(null), null);
  assert.equal(normalizeNullableNumber(undefined), null);
  assert.equal(normalizeNullableNumber("5.5"), 5.5);
});

/**
 * Verifies asset state text maps into the internal state machine.
 */
test("normalizeAssetState maps known asset state strings", () => {
  assert.equal(normalizeAssetState("referenced"), "referenced");
  assert.equal(normalizeAssetState("validated"), "validated");
  assert.equal(normalizeAssetState("not-a-state"), "missing");
});
