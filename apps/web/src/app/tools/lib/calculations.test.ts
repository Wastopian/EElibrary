/**
 * File header: Tests the pure /tools calculation helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeLedCurrentLimit,
  computeRcTimeConstant,
  computeVoltageDivider,
  formatEngineering,
  nearestE96Pair,
  pickEngineeringPrefix,
  solveOhmsLaw,
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

/**
 * Verifies the nearest-E96 helper returns lower and upper standard values that bracket the target.
 */
test("nearestE96Pair brackets a target resistance with the closest E96 1% values", () => {
  const around19k = nearestE96Pair(19_411);
  assert.ok(around19k);
  if (!around19k) {
    return;
  }
  // 19.1 kΩ and 19.6 kΩ bracket 19.411 kΩ in the standard E96 decade.
  assert.equal(around19k.lower, 19_100);
  assert.equal(around19k.upper, 19_600);

  const exact10k = nearestE96Pair(10_000);
  assert.ok(exact10k);
  if (!exact10k) {
    return;
  }
  assert.equal(exact10k.lower, 10_000);
  assert.equal(exact10k.upper, 10_000);

  assert.equal(nearestE96Pair(0), null);
  assert.equal(nearestE96Pair(Number.NaN), null);
  assert.equal(nearestE96Pair(-100), null);
});

/**
 * Verifies Ohm's law solves the remaining quantities given any two of {V, I, R, P}.
 */
test("solveOhmsLaw derives the missing pair for every two-known combination", () => {
  // V + I -> R, P
  const fromVI = solveOhmsLaw({ quantity: "voltage", value: 5 }, { quantity: "current", value: 0.01 });
  assert.ok(typeof fromVI === "object");
  if (typeof fromVI === "object") {
    assert.equal(fromVI.resistance, 500);
    assert.equal(fromVI.power, 0.05);
  }

  // V + R -> I, P
  const fromVR = solveOhmsLaw({ quantity: "voltage", value: 12 }, { quantity: "resistance", value: 6 });
  assert.ok(typeof fromVR === "object");
  if (typeof fromVR === "object") {
    assert.equal(fromVR.current, 2);
    assert.equal(fromVR.power, 24);
  }

  // V + P -> I, R
  const fromVP = solveOhmsLaw({ quantity: "voltage", value: 12 }, { quantity: "power", value: 24 });
  assert.ok(typeof fromVP === "object");
  if (typeof fromVP === "object") {
    assert.equal(fromVP.current, 2);
    assert.equal(fromVP.resistance, 6);
  }

  // I + R -> V, P
  const fromIR = solveOhmsLaw({ quantity: "current", value: 0.5 }, { quantity: "resistance", value: 10 });
  assert.ok(typeof fromIR === "object");
  if (typeof fromIR === "object") {
    assert.equal(fromIR.voltage, 5);
    assert.equal(fromIR.power, 2.5);
  }

  // I + P -> V, R
  const fromIP = solveOhmsLaw({ quantity: "current", value: 2 }, { quantity: "power", value: 8 });
  assert.ok(typeof fromIP === "object");
  if (typeof fromIP === "object") {
    assert.equal(fromIP.voltage, 4);
    assert.equal(fromIP.resistance, 2);
  }

  // R + P -> V, I (square-root case)
  const fromRP = solveOhmsLaw({ quantity: "resistance", value: 4 }, { quantity: "power", value: 9 });
  assert.ok(typeof fromRP === "object");
  if (typeof fromRP === "object") {
    assert.equal(fromRP.current, 1.5);
    assert.equal(fromRP.voltage, 6);
  }
});

/**
 * Verifies Ohm's law rejects inconsistent or undetermined input combinations.
 */
test("solveOhmsLaw rejects duplicate quantities, negatives, and undetermined cases", () => {
  assert.equal(
    solveOhmsLaw({ quantity: "voltage", value: 5 }, { quantity: "voltage", value: 6 }),
    "Pick two different quantities to solve from."
  );
  assert.equal(
    solveOhmsLaw({ quantity: "voltage", value: Number.NaN }, { quantity: "current", value: 1 }),
    "Enter a number in both fields."
  );
  assert.equal(
    solveOhmsLaw({ quantity: "voltage", value: -1 }, { quantity: "current", value: 1 }),
    "All values must be zero or positive."
  );
  assert.equal(
    solveOhmsLaw({ quantity: "voltage", value: 5 }, { quantity: "current", value: 0 }),
    "Current is 0, so resistance cannot be determined."
  );
  assert.equal(
    solveOhmsLaw({ quantity: "resistance", value: 0 }, { quantity: "power", value: 1 }),
    "Resistance is 0, so voltage and current cannot be determined from power alone."
  );
});

/**
 * Verifies the LED current-limit calculator returns resistor R, resistor dissipation, and LED dissipation.
 */
test("computeLedCurrentLimit returns the series resistor, its dissipation, and the LED dissipation", () => {
  // 5V supply, 2V Vf red LED, 20mA target -> 150Ω, 60mW resistor dissipation, 40mW LED.
  const result = computeLedCurrentLimit({ supplyVoltageVolts: 5, forwardVoltageVolts: 2, forwardCurrentAmps: 0.02 });

  assert.ok(typeof result === "object");
  if (typeof result !== "object") {
    return;
  }

  assert.equal(result.resistanceOhms, 150);
  assert.equal(result.voltageAcrossResistorVolts, 3);
  // Floating point can drift; allow tiny tolerance.
  assert.ok(Math.abs(result.resistorPowerWatts - 0.06) < 1e-9);
  assert.ok(Math.abs(result.ledPowerWatts - 0.04) < 1e-9);
});

/**
 * Verifies the LED current-limit calculator rejects invalid configurations with plain-language errors.
 */
test("computeLedCurrentLimit rejects invalid configurations with plain-language errors", () => {
  assert.equal(
    computeLedCurrentLimit({ supplyVoltageVolts: Number.NaN, forwardVoltageVolts: 2, forwardCurrentAmps: 0.02 }),
    "Enter a number in every field."
  );
  assert.equal(
    computeLedCurrentLimit({ supplyVoltageVolts: 5, forwardVoltageVolts: 2, forwardCurrentAmps: 0 }),
    "Supply voltage and LED forward voltage must be zero or positive, and the LED current must be positive."
  );
  assert.equal(
    computeLedCurrentLimit({ supplyVoltageVolts: 2, forwardVoltageVolts: 3.3, forwardCurrentAmps: 0.02 }),
    "Supply voltage must be higher than the LED forward voltage, or the LED will not light."
  );
});
