/**
 * File header: Tests the scratchpad engineering tools that power the /tools workspace.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { calculatePowerDerating, calculatePullupEdge, calculateVoltageDivider } from "./engineering-tools";

/**
 * Verifies the divider helper computes nominal and tolerance-bound outputs.
 */
test("calculateVoltageDivider reports the expected 1% divider tolerance window", () => {
  const result = calculateVoltageDivider({
    bottomResistanceOhms: 10_000,
    bottomTolerancePercent: 1,
    inputVoltage: 5,
    loadResistanceOhms: null,
    topResistanceOhms: 10_000,
    topTolerancePercent: 1
  });

  assert.equal(result.inputIssues.length, 0);
  assert.equal(result.tone, "verified");
  assert.equal(result.nominalOutputVoltage, 2.5);
  assert.equal(result.minOutputVoltage, 2.475);
  assert.equal(result.maxOutputVoltage, 2.525);
  assert.match(result.evidenceNote, /voltage divider check/u);
  assert.match(result.evidenceNote, /Boundary: scratchpad math only/u);
});

/**
 * Verifies the divider helper marks heavy loading as a review/danger signal.
 */
test("calculateVoltageDivider flags loaded dividers that shift the output", () => {
  const result = calculateVoltageDivider({
    bottomResistanceOhms: 10_000,
    bottomTolerancePercent: 1,
    inputVoltage: 3.3,
    loadResistanceOhms: 10_000,
    topResistanceOhms: 10_000,
    topTolerancePercent: 1
  });

  assert.equal(result.tone, "danger");
  assert.ok(result.loadErrorPercent !== null && result.loadErrorPercent < -20);
  assert.match(result.evidenceNote, /Load: 10 kohm/u);
});

/**
 * Verifies pull-up timing uses the 2.2RC rise-time approximation and exposes sink current.
 */
test("calculatePullupEdge reports rise time and low-level sink current", () => {
  const result = calculatePullupEdge({
    busCapacitancePicofarads: 100,
    pullupResistanceOhms: 4_700,
    riseTimeLimitMicroseconds: 1.2,
    supplyVoltage: 3.3
  });

  assert.equal(result.inputIssues.length, 0);
  assert.equal(result.tone, "review");
  assert.ok(result.timeConstantMicroseconds !== null && Math.abs(result.timeConstantMicroseconds - 0.47) < 0.0001);
  assert.ok(result.riseTimeMicroseconds !== null && Math.abs(result.riseTimeMicroseconds - 1.034) < 0.0001);
  assert.ok(result.lowLevelCurrentMilliamps !== null && result.lowLevelCurrentMilliamps < 1);
  assert.match(result.evidenceNote, /pull-up edge check/u);
});

/**
 * Verifies power derating reports dissipation and thermal margin without approving the part.
 */
test("calculatePowerDerating reports derated allowance and estimated junction temperature", () => {
  const result = calculatePowerDerating({
    ambientCelsius: 25,
    deratingTargetPercent: 50,
    loadCurrentAmps: 0.1,
    maxJunctionCelsius: 125,
    packagePowerRatingWatts: 0.5,
    thermalResistanceCPerWatt: 100,
    voltageDropVolts: 2
  });

  assert.equal(result.inputIssues.length, 0);
  assert.equal(result.tone, "verified");
  assert.equal(result.powerWatts, 0.2);
  assert.equal(result.allowedPowerWatts, 0.25);
  assert.equal(result.estimatedJunctionCelsius, 45);
  assert.equal(result.thermalMarginCelsius, 80);
  assert.match(result.evidenceNote, /power derating check/u);
  assert.match(result.boundary, /Scratchpad only/u);
});

/**
 * Verifies invalid inputs return an honest non-result instead of a misleading zero.
 */
test("engineering calculators return input issues for invalid values", () => {
  const result = calculatePowerDerating({
    ambientCelsius: Number.NaN,
    deratingTargetPercent: 50,
    loadCurrentAmps: 0,
    maxJunctionCelsius: 125,
    packagePowerRatingWatts: 0.5,
    thermalResistanceCPerWatt: 100,
    voltageDropVolts: 2
  });

  assert.equal(result.tone, "danger");
  assert.match(result.headline, /Enter positive/u);
  assert.ok(result.inputIssues.length >= 2);
  assert.match(result.evidenceNote, /inputs are incomplete or invalid/u);
});
