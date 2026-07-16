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
  buildCompareAssetPreviewRows,
  buildCompareAssetTrustRows,
  buildCompareConnectorRows,
  buildCompareParameterRows,
  collectCompareParameterKeys,
  collectCompareMetricKeys,
  collectUncoveredCompareMetricKeys,
  formatUncoveredCompareMetricCell,
  shouldRenderConnectorCompareRows
} from "./part-compare";
import type { PartDetailResponse, PartParameter } from "@ee-library/shared/types";

function stubMetric(key: string, overrides: Partial<PartMetric> = {}): PartMetric {
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
    unit: "V",
    ...overrides
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

test("formatUncoveredCompareMetricCell returns dash when metric missing", () => {
  const detail = stubDetail("p1", [], [stubMetric("supply_voltage_max")]);
  assert.equal(formatUncoveredCompareMetricCell(detail, "missing_key"), "—");
});

function stubParameter(partId: string, paramKey: string, overrides: Partial<PartParameter> = {}): PartParameter {
  return {
    confidenceScore: 0.6,
    id: `pp-${partId}-${paramKey}`,
    isConflicted: false,
    lastUpdatedAt: "2026-07-09T00:00:00.000Z",
    paramKey,
    partId,
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

function stubDetail(partId: string, parameters: PartParameter[], metrics: PartMetric[] = []): PartDetailResponse {
  return { parameters, record: { metrics, part: { id: partId } } } as PartDetailResponse;
}

test("collectCompareParameterKeys unions parameter keys across details", () => {
  const keys = collectCompareParameterKeys([
    stubDetail("p1", [stubParameter("p1", "resistance"), stubParameter("p1", "tolerance", { unit: "%" })]),
    stubDetail("p2", [stubParameter("p2", "resistance")])
  ]);

  assert.ok(keys.includes("resistance") && keys.includes("tolerance"));
  assert.equal(keys.length, 2);
});

/**
 * Verifies metric de-duplication against the Specifications matrix: a metric key disappears only when
 * every part that has the metric also has a covering reconciled parameter, and survives while any part
 * still relies on it as its only display of the value.
 */
test("collectUncoveredCompareMetricKeys drops covered metrics but keeps a part's only display", () => {
  // Both parts have the resistance metric and a covering resistance parameter -> dropped; the
  // unregistered supply_voltage metric has no covering parameter anywhere -> kept.
  const fullyCovered = collectUncoveredCompareMetricKeys([
    stubDetail("p1", [stubParameter("p1", "resistance")], [stubMetric("resistance"), stubMetric("supply_voltage")]),
    stubDetail("p2", [stubParameter("p2", "resistance")], [stubMetric("resistance")])
  ]);

  assert.deepEqual(fullyCovered, ["supply_voltage"]);

  // p2 has the metric but no covering parameter -> the row must stay for p2's sake.
  const partiallyCovered = collectUncoveredCompareMetricKeys([
    stubDetail("p1", [stubParameter("p1", "resistance")], [stubMetric("resistance")]),
    stubDetail("p2", [], [stubMetric("resistance")])
  ]);

  assert.deepEqual(partiallyCovered, ["resistance"]);
});

test("formatUncoveredCompareMetricCell hides covered values in a row retained for another part", () => {
  const legacyResistance = stubMetric("resistance", { metricValue: 5_600, unit: "ohm" });
  const covered = stubDetail("p1", [stubParameter("p1", "resistance")], [legacyResistance]);
  const uncovered = stubDetail("p2", [], [legacyResistance]);

  assert.equal(formatUncoveredCompareMetricCell(covered, "resistance"), "—");
  assert.equal(formatUncoveredCompareMetricCell(uncovered, "resistance"), "5.6 kΩ");
});

test("buildCompareParameterRows renders typed values, an em dash when absent, and a conflict marker", () => {
  const rows = buildCompareParameterRows([
    stubDetail("p1", [stubParameter("p1", "resistance", { valueNumeric: 10_000 })]),
    stubDetail("p2", [stubParameter("p2", "resistance", { valueNumeric: 4_700, isConflicted: true })])
  ]);

  const resistanceRow = rows.find((row) => row.rowKey === "parameter:resistance");

  assert.ok(resistanceRow, "expected a resistance row");
  assert.equal(resistanceRow.label, "Resistance");
  assert.equal(resistanceRow.values[0]?.text, "10 kΩ");
  assert.equal(resistanceRow.values[0]?.tone, "info");
  assert.equal(resistanceRow.values[1]?.text, "4.7 kΩ · sources disagree");
  assert.equal(resistanceRow.values[1]?.tone, "review");
});

test("buildCompareParameterRows shows an em dash when a part lacks the parameter", () => {
  const rows = buildCompareParameterRows([
    stubDetail("p1", [stubParameter("p1", "resistance")]),
    stubDetail("p2", [])
  ]);

  const resistanceRow = rows.find((row) => row.rowKey === "parameter:resistance");

  assert.equal(resistanceRow?.values[1]?.text, "—");
  assert.equal(resistanceRow?.values[1]?.tone, "neutral");
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

/**
 * Verifies the side-by-side CAD preview rows render exactly the three CAD asset classes
 * (symbol / footprint / 3D model) in stable order, with one cell per compared part. A
 * missing asset class must surface a null `bestAsset` rather than a fabricated
 * placeholder so the renderer can show the gap honestly.
 */
test("buildCompareAssetPreviewRows emits one row per CAD class with stable cells per part", () => {
  const connector = getSeedRecord("part-te-215079-8");
  const regulator = getSeedRecord("part-tps7a02dbvr");
  const rows = buildCompareAssetPreviewRows([connector, regulator]);

  assert.deepEqual(
    rows.map((row) => row.rowKey),
    ["asset_preview:symbol", "asset_preview:footprint", "asset_preview:three_d_model"]
  );

  assert.deepEqual(
    rows.map((row) => row.assetType),
    ["symbol", "footprint", "three_d_model"]
  );

  for (const row of rows) {
    assert.equal(row.cells.length, 2, `expected one cell per record on row ${row.rowKey}`);
    assert.deepEqual(
      row.cells.map((cell) => cell.partId),
      [connector.part.id, regulator.part.id]
    );

    for (const cell of row.cells) {
      if (cell.bestAsset === null) {
        assert.equal(cell.previewState, null, `expected null preview state when no best asset on ${row.rowKey}`);
      } else {
        assert.ok(cell.previewState, `expected a preview state when a best asset exists on ${row.rowKey}`);
        assert.equal(cell.bestAsset.assetType, row.assetType, `cell asset type must match row asset type on ${row.rowKey}`);
      }
    }
  }
});

/**
 * Verifies the preview band is empty-safe: when called with no records it returns rows
 * with empty cell arrays, so the renderer can rely on a stable shape and choose to hide
 * the section using its own emptiness check rather than relying on a thrown error.
 */
test("buildCompareAssetPreviewRows returns empty cells when called with no records", () => {
  const rows = buildCompareAssetPreviewRows([]);

  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.cells.length, 0);
  }
});

function getSeedRecord(partId: string): PartSearchRecord {
  const record = getPartDetail(partId);
  assert.ok(record, `expected seed part ${partId}`);
  return record;
}
