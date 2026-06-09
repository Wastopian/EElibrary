/**
 * File header: Tests the pure /tools calculation helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRcTimeConstant,
  computeVoltageDivider,
  formatEngineering,
  pickEngineeringPrefix,
  solveVoltageDividerResistor
} from "./calculations";

/**
 * Verifies the voltage divider returns Vout, current, and power for a simple 5 V / 10 kΩ / 10 kΩ pair.
 */
test("voltage divider computes Vout, current, and power for a 5V / 10k / 10k pair", () => {
  const result = computeVoltageDivider({ vin: 5, r1: 10_000, r2: 10_000 });

  assert.ok(typeof result === "object", "expected a result object");
  if (typeof result !== "object") {
    return;
  }

  assert.equal(result.vout, 2.5);
  assert.equal(result.ratio, 0.5);
  assert.equal(result.current, 5 / 20_000);
  assert.equal(result.power, 5 * (5 / 20_000));
});

/**
 * Verifies the divider rejects invalid inputs with plain-language messages.
 */
test("voltage divider rejects invalid inputs with plain-language error strings", () => {
  assert.equal(computeVoltageDivider({ vin: Number.NaN, r1: 10, r2: 10 }), "Enter a number in every field.");
  assert.equal(computeVoltageDivider({ vin: 5, r1: -1, r2: 10 }), "Resistance cannot be negative.");
  assert.equal(computeVoltageDivider({ vin: 5, r1: 0, r2: 0 }), "Both resistors are zero. Set at least one resistor to a positive value.");
});

/**
 * Verifies the inverse solver returns the partner resistor for a target Vout.
 */
test("solveVoltageDividerResistor returns the partner resistor for a target Vout", () => {
  // 5V -> 3.3V with R1 = 10 kΩ should need R2 ≈ 19.41 kΩ.
  const r2 = solveVoltageDividerResistor(5, 3.3, 10_000, "r1");
  assert.ok(typeof r2 === "number");
  if (typeof r2 !== "number") {
    return;
  }
  assert.ok(Math.abs(r2 - 19_411.7647) < 0.5, `expected ~19411 Ω, got ${r2}`);

  // 5V -> 2.5V with R2 = 10 kΩ should need R1 = 10 kΩ.
  const r1 = solveVoltageDividerResistor(5, 2.5, 10_000, "r2");
  assert.equal(r1, 10_000);
});

/**
 * Verifies the inverse solver rejects impossible passive-divider requests.
 */
test("solveVoltageDividerResistor rejects impossible passive-divider requests", () => {
  assert.equal(solveVoltageDividerResistor(5, 6, 10_000, "r1"), "Vout must be less than Vin for a passive divider.");
  assert.equal(solveVoltageDividerResistor(5, 5, 10_000, "r1"), "Vout cannot equal Vin in a passive divider — R2 would be infinite.");
  assert.equal(solveVoltageDividerResistor(0, 1, 10_000, "r1"), "Vin cannot be zero when solving for a resistor.");
});

/**
 * Verifies the RC time constant returns tau and settling-time multiples.
 */
test("RC time constant returns tau and 1τ / 3τ / 5τ settling times", () => {
  const result = computeRcTimeConstant({ resistanceOhms: 1_000, capacitanceFarads: 1e-6 });

  assert.ok(typeof result === "object");
  if (typeof result !== "object") {
    return;
  }

  // R = 1 kΩ, C = 1 µF -> tau = 1 ms.
  assert.equal(result.tau, 0.001);
  assert.equal(result.toSixtyThreePercent, 0.001);
  assert.equal(result.toNinetyFivePercent, 0.003);
  assert.equal(result.toNinetyNinePercent, 0.005);
  // Cutoff = 1 / (2π × 1ms) ≈ 159.15 Hz.
  assert.ok(Math.abs(result.cutoffFrequencyHz - 159.1549) < 0.01, `expected ~159.15 Hz, got ${result.cutoffFrequencyHz}`);
});

/**
 * Verifies the RC time constant rejects non-positive resistance and capacitance.
 */
test("RC time constant rejects non-positive resistance and capacitance", () => {
  assert.equal(computeRcTimeConstant({ resistanceOhms: 0, capacitanceFarads: 1e-6 }), "Resistance and capacitance must both be positive.");
  assert.equal(computeRcTimeConstant({ resistanceOhms: 1_000, capacitanceFarads: -1e-6 }), "Resistance and capacitance must both be positive.");
  assert.equal(computeRcTimeConstant({ resistanceOhms: Number.NaN, capacitanceFarads: 1e-6 }), "Enter a number in both fields.");
});

/**
 * Verifies engineering prefix selection lands the coefficient in [1, 1000) for common values.
 */
test("pickEngineeringPrefix lands the coefficient in [1, 1000) for representative values", () => {
  assert.deepEqual(pickEngineeringPrefix(0), { coefficient: 0, prefix: "", multiplier: 1 });
  assert.equal(pickEngineeringPrefix(12_345).prefix, "k");
  assert.equal(pickEngineeringPrefix(12_345).coefficient, 12.345);
  assert.equal(pickEngineeringPrefix(0.000_022).prefix, "µ");
  assert.equal(pickEngineeringPrefix(2_500_000).prefix, "M");
  assert.equal(pickEngineeringPrefix(0.001).prefix, "m");
});

/**
 * Verifies the engineering formatter produces readable strings with sensible precision.
 */
test("formatEngineering produces readable engineering strings with the unit appended", () => {
  assert.equal(formatEngineering(0, "Ω"), "0 Ω");
  assert.equal(formatEngineering(12_345, "Ω"), "12.3 kΩ");
  assert.equal(formatEngineering(0.000_022, "F"), "22 µF");
  assert.equal(formatEngineering(0.001, "s"), "1 ms");
  assert.equal(formatEngineering(159.1549, "Hz"), "159 Hz");
});
