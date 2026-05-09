/**
 * Tests metric union logic, asset-class readiness rows, and connector-depth rows
 * for the compare workspace.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getPartDetail } from "@ee-library/shared/search";
import type { PartMetric, PartSearchRecord } from "@ee-library/shared/types";
import {
  buildCompareAssetClassRows,
  buildCompareAssetTrustRows,
  buildCompareConnectorRows,
  collectCompareMetricKeys,
  formatCompareMetricCell,
  shouldRenderConnectorCompareRows
} from "./part-compare";

function stubMetric(key: string): PartMetric {
  return {
    confidenceScore: 1,
    id: `m-${key}`,
    lastUpdatedAt: new Date().toISOString(),
    maxValue: null,
    metricKey: key,
    metricValue: 1,
    minValue: null,
    partId: "p",
    sourceRecordId: null,
    sourceRevisionId: "sr",
    unit: "V"
  };
}

function stubRecord(metrics: PartMetric[]): PartSearchRecord {
  return { metrics } as PartSearchRecord;
}

test("collectCompareMetricKeys unions keys across records", () => {
  const keys = collectCompareMetricKeys([
    stubRecord([stubMetric("supply_voltage_max"), stubMetric("quiescent_current")]),
    stubRecord([stubMetric("supply_voltage_max")])
  ]);

  assert.ok(keys.includes("supply_voltage_max"));
  assert.ok(keys.includes("quiescent_current"));
  assert.equal(keys.length, 2);
});

test("formatCompareMetricCell returns dash when metric missing", () => {
  const record = stubRecord([stubMetric("supply_voltage_max")]);
  assert.equal(formatCompareMetricCell(record, "missing_key"), "—");
});

/**
 * Verifies the asset-class readiness rows are emitted in canonical engineering order
 * and that a missing asset class renders "Missing" rather than disappearing.
 */
test("buildCompareAssetClassRows emits one row per asset class with honest missing cells", () => {
  const connector = getSeedRecord("part-te-215079-8");
  const regulator = getSeedRecord("part-tps7a02dbvr");
  const rows = buildCompareAssetClassRows([connector, regulator]);

  assert.deepEqual(
    rows.map((row) => row.rowKey),
    ["asset_class:symbol", "asset_class:footprint", "asset_class:three_d_model", "asset_class:datasheet", "asset_class:mechanical_drawing"]
  );

  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(row.values.length, 2, `expected one cell per record on row ${row.rowKey}`);
    assert.deepEqual(
      row.values.map((value) => value.partId),
      [connector.part.id, regulator.part.id]
    );
  }

  const footprintRow = rows.find((row) => row.rowKey === "asset_class:footprint");
  assert.ok(footprintRow);
  const regulatorFootprintCell = footprintRow.values.find((value) => value.partId === regulator.part.id);
  assert.ok(regulatorFootprintCell);
  assert.equal(regulatorFootprintCell.text, "Missing");
  assert.equal(regulatorFootprintCell.tone, "neutral");
});

/**
 * Verifies the connector-depth section only renders when at least one part is a connector.
 */
test("shouldRenderConnectorCompareRows only triggers when connector context exists", () => {
  const connector = getSeedRecord("part-te-215079-8");
  const regulator = getSeedRecord("part-tps7a02dbvr");

  assert.equal(shouldRenderConnectorCompareRows([connector]), true);
  assert.equal(shouldRenderConnectorCompareRows([regulator]), false);
  assert.equal(shouldRenderConnectorCompareRows([connector, regulator]), true);
  assert.equal(shouldRenderConnectorCompareRows([]), false);
});

/**
 * Verifies connector-depth rows render an em dash on non-connector parts and
 * stay scannable in the mixed-compare case.
 */
test("buildCompareConnectorRows renders connector data and an em dash on non-connector parts", () => {
  const connector = getSeedRecord("part-te-215079-8");
  const regulator = getSeedRecord("part-tps7a02dbvr");
  const rows = buildCompareConnectorRows([connector, regulator]);

  assert.deepEqual(
    rows.map((row) => row.rowKey),
    [
      "connector:class",
      "connector:best_mate",
      "connector:alternate_mates",
      "connector:required_accessories",
      "connector:family_conflicts",
      "connector:confidence"
    ]
  );

  for (const row of rows) {
    const regulatorCell = row.values.find((value) => value.partId === regulator.part.id);
    assert.ok(regulatorCell, `expected regulator cell on ${row.rowKey}`);

    if (row.rowKey === "connector:class") {
      assert.equal(regulatorCell.text, "Not a connector");
    } else {
      assert.equal(regulatorCell.text, "—", `expected em dash on ${row.rowKey} for non-connector part`);
    }

    const connectorCell = row.values.find((value) => value.partId === connector.part.id);
    assert.ok(connectorCell, `expected connector cell on ${row.rowKey}`);
    assert.notEqual(connectorCell.text, "—", `expected real value on ${row.rowKey} for connector part`);
  }
});

/**
 * Verifies the connector confidence cell tracks the persisted overall score, not approval state.
 */
test("buildCompareConnectorRows surfaces persisted mating confidence verbatim", () => {
  const connector = getSeedRecord("part-te-215079-8");
  const rows = buildCompareConnectorRows([connector]);
  const confidenceRow = rows.find((row) => row.rowKey === "connector:confidence");
  assert.ok(confidenceRow);
  const cell = confidenceRow.values[0];
  assert.ok(cell);

  const expectedScore = connector.buildableMatingSet.confidenceBreakdown.overallScore;
  if (expectedScore === null) {
    assert.equal(cell.text, "Not scored");
  } else {
    assert.equal(cell.text, `${Math.round(expectedScore * 100)}%`);
  }
});

/**
 * Verifies per-asset trust rows render one row per engineering class and keep stage text explicit.
 */
test("buildCompareAssetTrustRows emits explicit per-asset trust-stage cells", () => {
  const connector = getSeedRecord("part-te-215079-8");
  const regulator = getSeedRecord("part-tps7a02dbvr");
  const rows = buildCompareAssetTrustRows([connector, regulator]);

  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((row) => row.rowKey),
    [
      "asset_trust:symbol",
      "asset_trust:footprint",
      "asset_trust:three_d_model",
      "asset_trust:datasheet",
      "asset_trust:mechanical_drawing"
    ]
  );

  const symbolRow = rows.find((row) => row.rowKey === "asset_trust:symbol");
  assert.ok(symbolRow);
  assert.equal(symbolRow.values.length, 2);
  assert.ok(symbolRow.values.every((value) => value.text.length > 0));
});

function getSeedRecord(partId: string): PartSearchRecord {
  const record = getPartDetail(partId);
  assert.ok(record, `expected seed part ${partId}`);
  return record;
}
