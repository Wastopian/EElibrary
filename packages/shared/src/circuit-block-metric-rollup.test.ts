/**
 * File header: Tests read-only circuit-block metric rollups from linked part metrics.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildCircuitBlockMetricRollup, CIRCUIT_BLOCK_METRIC_ROLLUP_BOUNDARY } from "./circuit-block-metric-rollup";
import type { CircuitBlockPartRecord, MetricUnit, PartMetric } from "./types";

/**
 * Verifies duplicate part metrics collapse to the best confidence row before rollup.
 */
test("circuit block metric rollup groups linked-part metrics with confidence and coverage", () => {
  const parts = [
    buildPartRole("cbpart-ldo", "part-ldo", "Main LDO", "TPS7A02DBVR", true),
    buildPartRole("cbpart-cap", "part-cap", "Output capacitor", "GRM188R71C104KA01D", true),
    buildPartRole("cbpart-test", "part-test", "Test header", "TSW-102-07-G-S", false)
  ];

  const rollup = buildCircuitBlockMetricRollup(parts, [
    buildMetric("metric-ldo-output-old", "part-ldo", "output_current_max", "A", 0.15, 0.62, "2026-04-01T00:00:00.000Z"),
    buildMetric("metric-ldo-output-new", "part-ldo", "output_current_max", "A", 0.2, 0.81, "2026-05-01T00:00:00.000Z"),
    buildMetric("metric-ldo-vin", "part-ldo", "input_voltage_max", "V", 5.5, 0.9, "2026-05-01T00:00:00.000Z"),
    buildMetric("metric-cap-value", "part-cap", "capacitance", "F", 0.0000001, 0.76, "2026-05-01T00:00:00.000Z"),
    buildMetric("metric-test-vin", "part-test", "input_voltage_max", "V", 6, 0.7, "2026-05-01T00:00:00.000Z")
  ]);

  const outputCurrent = rollup.entries.find((entry) => entry.metricKey === "output_current_max");
  const inputVoltage = rollup.entries.find((entry) => entry.metricKey === "input_voltage_max");

  assert.equal(rollup.state, "available");
  assert.equal(rollup.metricCount, 3);
  assert.equal(rollup.totalRoleCount, 3);
  assert.equal(rollup.rolesWithAnyMetricCount, 3);
  assert.equal(rollup.boundary, CIRCUIT_BLOCK_METRIC_ROLLUP_BOUNDARY);
  assert.equal(outputCurrent?.values[0]?.metric.id, "metric-ldo-output-new");
  assert.equal(outputCurrent?.coverageStatus, "partial");
  assert.deepEqual(outputCurrent?.missingRequiredRoles, ["Output capacitor (GRM188R71C104KA01D)"]);
  assert.deepEqual(outputCurrent?.missingOptionalRoles, ["Test header (TSW-102-07-G-S)"]);
  assert.equal(outputCurrent?.minConfidenceScore, 0.81);
  assert.equal(inputVoltage?.values.length, 2);
  assert.equal(inputVoltage?.minConfidenceScore, 0.7);
  assert.equal(inputVoltage?.averageConfidenceScore, 0.8);
});

/**
 * Verifies empty metric inputs still preserve role counts and the trust boundary.
 */
test("circuit block metric rollup reports empty state without inventing metrics", () => {
  const parts = [buildPartRole("cbpart-ldo", "part-ldo", "Main LDO", "TPS7A02DBVR", true)];
  const rollup = buildCircuitBlockMetricRollup(parts, []);

  assert.equal(rollup.state, "empty");
  assert.equal(rollup.metricCount, 0);
  assert.equal(rollup.totalRoleCount, 1);
  assert.equal(rollup.rolesWithAnyMetricCount, 0);
  assert.deepEqual(rollup.entries, []);
  assert.match(rollup.boundary, /do not approve/u);
});

/**
 * Builds a linked circuit-block part role fixture.
 */
function buildPartRole(
  blockPartId: string,
  partId: string,
  role: string,
  mpn: string,
  isRequired: boolean
): CircuitBlockPartRecord {
  return {
    blockPart: {
      circuitBlockId: "cblock-alpha",
      createdAt: "2026-05-01T00:00:00.000Z",
      id: blockPartId,
      isRequired,
      notes: null,
      partId,
      quantity: 1,
      role,
      substitutionPolicy: "exact_required",
      updatedAt: "2026-05-01T00:00:00.000Z"
    },
    part: {
      approvalStatus: "approved",
      blockerCount: 0,
      connectorClass: "non_connector",
      lifecycleStatus: "active",
      manufacturerName: "Fixture Manufacturer",
      mpn,
      partId,
      readinessStatus: "ready_for_export_review"
    }
  };
}

/**
 * Builds a normalized datasheet metric fixture.
 */
function buildMetric(
  id: string,
  partId: string,
  metricKey: string,
  unit: MetricUnit,
  metricValue: number,
  confidenceScore: number,
  lastUpdatedAt: string
): PartMetric {
  return {
    confidenceScore,
    id,
    lastUpdatedAt,
    maxValue: null,
    metricKey,
    metricValue,
    minValue: null,
    partId,
    sourceRecordId: `source-${id}`,
    sourceRevisionId: `revision-${id}`,
    unit
  };
}
