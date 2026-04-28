/**
 * File header: Tests for buildPartDetailViewModel and supporting tone helpers.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  assetStateLabel,
  assetStateTone,
  buildPartDetailViewModel,
  scoreTone,
  validationLabel,
  validationTone
} from "./detail-view-model";
import type {
  Asset,
  DatasheetRevision,
  Manufacturer,
  Package,
  Part,
  PartMetric,
  PartSearchRecord,
  SourceRecord
} from "./types";

const LAST_UPDATED_AT = "2026-04-26T00:00:00.000Z";

function makeManufacturer(): Manufacturer {
  return { aliases: ["TI"], id: "mfr-test", name: "Texas Instruments", website: "https://www.ti.com" };
}

function makePackage(): Package {
  return {
    bodyHeightMm: 1.45,
    bodyLengthMm: 2.9,
    bodyWidthMm: 1.6,
    id: "pkg-sot-23-5",
    packageName: "SOT-23-5",
    pinCount: 5,
    pitchMm: 0.95
  };
}

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    category: "Power management",
    id: "part-test",
    lastUpdatedAt: LAST_UPDATED_AT,
    lifecycleStatus: "active",
    manufacturerId: "mfr-test",
    mpn: "TPS7A02DBVR",
    packageId: "pkg-sot-23-5",
    trustScore: 0.82,
    ...overrides
  };
}

function makeSource(): SourceRecord {
  return {
    fetchedAt: LAST_UPDATED_AT,
    id: "source-test",
    lastUpdatedAt: LAST_UPDATED_AT,
    normalizedAt: LAST_UPDATED_AT,
    partId: "part-test",
    providerId: "test-provider",
    providerPartKey: "TPS7A02DBVR",
    rawPayload: { mpn: "TPS7A02DBVR" },
    sourceUrl: "https://www.ti.com/product/TPS7A02"
  };
}

function makeMetrics(): PartMetric[] {
  const base = {
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: null,
    minValue: null,
    partId: "part-test",
    sourceRecordId: "source-test",
    sourceRevisionId: "dsr-test"
  };
  return [
    { ...base, confidenceScore: 0.83, id: "metric-vmax", metricKey: "input_voltage_max", metricValue: 5.5, unit: "V" },
    { ...base, confidenceScore: 0.81, id: "metric-imax", metricKey: "output_current_max", metricValue: 0.2, unit: "A" },
    { ...base, confidenceScore: 0.6, id: "metric-quiescent", metricKey: "quiescent_current", metricValue: 0.000_025, unit: "A" }
  ];
}

function makeDatasheet(overrides: Partial<DatasheetRevision> = {}): DatasheetRevision {
  return {
    fileAssetId: "asset-test-datasheet",
    id: "dsr-test",
    lastUpdatedAt: LAST_UPDATED_AT,
    pageCount: 39,
    parseConfidence: 0.79,
    partId: "part-test",
    revisionDate: "2024-02-01",
    revisionLabel: "Rev. E",
    sourceRecordId: "source-test",
    ...overrides
  };
}

function makeAsset(overrides: Partial<Asset> & Pick<Asset, "id" | "assetType">): Asset {
  return {
    assetState: "missing",
    fileFormat: "unknown",
    fileHash: null,
    lastUpdatedAt: LAST_UPDATED_AT,
    licenseMode: "unknown",
    partId: "part-test",
    previewStatus: "not_available",
    providerId: "test-provider",
    sourceRecordId: "source-test",
    sourceUrl: null,
    storageKey: null,
    validationStatus: "not_validated",
    ...overrides
  };
}

function makeRecord(overrides: Partial<PartSearchRecord> = {}): PartSearchRecord {
  return {
    assets: [
      makeAsset({
        assetState: "referenced",
        fileFormat: "pdf",
        id: "asset-test-datasheet",
        assetType: "datasheet",
        licenseMode: "metadata_only",
        sourceUrl: "https://www.ti.com/lit/ds/symlink/tps7a02.pdf",
        validationStatus: "needs_review"
      })
    ],
    datasheetRevision: makeDatasheet(),
    lastUpdatedAt: LAST_UPDATED_AT,
    manufacturer: makeManufacturer(),
    metrics: makeMetrics(),
    package: makePackage(),
    part: makePart(),
    sources: [makeSource()],
    ...overrides
  };
}

test("identity exposes MPN, manufacturer, description, lifecycle, and trust tones", () => {
  const view = buildPartDetailViewModel(makeRecord());
  assert.equal(view.identity.mpn, "TPS7A02DBVR");
  assert.equal(view.identity.manufacturerName, "Texas Instruments");
  assert.equal(view.identity.category, "Power management");
  assert.equal(view.identity.packageName, "SOT-23-5");
  assert.equal(view.identity.lifecycleStatus, "active");
  assert.equal(view.identity.lifecycleLabel, "Active");
  assert.equal(view.identity.lifecycleTone, "verified");
  assert.equal(view.identity.trustScore, 0.82);
  assert.equal(view.identity.trustTone, "verified");
  assert.equal(view.identity.sourceCount, 1);
  assert.match(view.identity.description, /Power management/u);
  assert.match(view.identity.description, /SOT-23-5/u);
});

test("metrics are capped at 6 rows and sorted by confidence descending", () => {
  const manyMetrics: PartMetric[] = Array.from({ length: 10 }, (_, index) => ({
    confidenceScore: 0.5 + index * 0.05,
    id: `metric-${index}`,
    lastUpdatedAt: LAST_UPDATED_AT,
    maxValue: null,
    metricKey: `metric_${index}`,
    metricValue: index,
    minValue: null,
    partId: "part-test",
    sourceRecordId: "source-test",
    sourceRevisionId: "dsr-test",
    unit: "V"
  }));

  const view = buildPartDetailViewModel(makeRecord({ metrics: manyMetrics }));
  assert.equal(view.metrics.length, 6);
  for (let index = 1; index < view.metrics.length; index += 1) {
    assert.ok(
      view.metrics[index - 1]!.confidencePercent >= view.metrics[index]!.confidencePercent,
      "metrics must be sorted by confidence descending"
    );
  }
});

test("metrics rows include confidence percent and tone", () => {
  const view = buildPartDetailViewModel(makeRecord());
  const top = view.metrics[0]!;
  assert.equal(top.label, "Input Voltage Max");
  assert.match(top.value, /5\.5\s+V/u);
  assert.equal(top.confidencePercent, 83);
  assert.equal(top.confidenceTone, "verified");
});

test("datasheet action opens referenced URL when no captured file exists", () => {
  const view = buildPartDetailViewModel(makeRecord());
  assert.equal(view.datasheet.available, true);
  assert.equal(view.datasheet.fileBacked, false);
  assert.equal(view.datasheet.actionEnabled, true);
  assert.equal(view.datasheet.actionLabel, "Open referenced URL");
  assert.equal(view.datasheet.actionUrl, "https://www.ti.com/lit/ds/symlink/tps7a02.pdf");
  assert.equal(view.datasheet.actionOpensExternal, true);
  assert.equal(view.datasheet.parseConfidencePercent, 79);
  assert.equal(view.datasheet.revisionLabel, "Rev. E");
});

test("datasheet action downloads stored file when storageKey + fileHash present", () => {
  const record = makeRecord({
    assets: [
      makeAsset({
        assetState: "validated",
        fileFormat: "pdf",
        fileHash: "deadbeef",
        id: "asset-test-datasheet",
        assetType: "datasheet",
        licenseMode: "metadata_only",
        storageKey: "datasheets/tps7a02.pdf",
        validationStatus: "verified"
      })
    ]
  });
  const view = buildPartDetailViewModel(record);
  assert.equal(view.datasheet.fileBacked, true);
  assert.equal(view.datasheet.actionLabel, "Download datasheet");
  assert.equal(view.datasheet.actionUrl, "/storage/datasheets%2Ftps7a02.pdf");
  assert.equal(view.datasheet.actionOpensExternal, false);
});

test("datasheet block is disabled when no datasheet exists", () => {
  const record = makeRecord({ assets: [], datasheetRevision: null });
  const view = buildPartDetailViewModel(record);
  assert.equal(view.datasheet.available, false);
  assert.equal(view.datasheet.actionEnabled, false);
  assert.equal(view.datasheet.actionLabel, "No datasheet");
  assert.equal(view.datasheet.actionUrl, null);
});

test("CAD readiness fills in synthetic missing rows for symbol/footprint/3D when absent", () => {
  const view = buildPartDetailViewModel(makeRecord());
  assert.equal(view.cadReadiness.symbol.present, false);
  assert.equal(view.cadReadiness.symbol.state, "missing");
  assert.equal(view.cadReadiness.symbol.exportable, false);
  assert.equal(view.cadReadiness.footprint.present, false);
  assert.equal(view.cadReadiness.threeDModel.present, false);
  assert.equal(view.cadReadiness.exportableCount, 0);
  assert.equal(view.cadReadiness.allExportable, false);
});

test("CAD readiness reports exportable=true for validated downloadable assets", () => {
  const record = makeRecord({
    assets: [
      makeAsset({
        assetState: "validated",
        fileFormat: "step",
        fileHash: "abc123",
        id: "asset-test-3d",
        assetType: "three_d_model",
        licenseMode: "redistribution_allowed",
        storageKey: "cad/3d/test.step",
        validationStatus: "verified"
      })
    ]
  });

  const view = buildPartDetailViewModel(record);
  assert.equal(view.cadReadiness.threeDModel.exportable, true);
  assert.equal(view.cadReadiness.threeDModel.state, "validated");
  assert.equal(view.cadReadiness.exportableCount, 1);
});

test("issues include datasheet_not_downloaded with an Open referenced datasheet next-action", () => {
  const view = buildPartDetailViewModel(makeRecord());
  const issue = view.issues.find((entry) => entry.code === "datasheet_not_downloaded");
  assert.ok(issue, "expected datasheet_not_downloaded issue");
  assert.equal(issue?.next?.kind, "link");
  assert.equal(issue?.next?.label, "Open referenced datasheet");
  assert.equal(issue?.next?.href, "https://www.ti.com/lit/ds/symlink/tps7a02.pdf");
});

test("issues include missing_symbol/footprint/three_d_model with command next-actions", () => {
  const view = buildPartDetailViewModel(makeRecord());
  const codes = view.issues.map((issue) => issue.code);
  assert.ok(codes.includes("missing_symbol"));
  assert.ok(codes.includes("missing_footprint"));
  assert.ok(codes.includes("missing_three_d_model"));
  for (const code of ["missing_symbol", "missing_footprint", "missing_three_d_model"] as const) {
    const issue = view.issues.find((entry) => entry.code === code)!;
    assert.equal(issue.next?.kind, "command");
    assert.match(issue.next?.command ?? "", /worker/u);
  }
});

test("issues report missing_datasheet when no datasheet revision is recorded", () => {
  const record = makeRecord({ assets: [], datasheetRevision: null });
  const view = buildPartDetailViewModel(record);
  const codes = view.issues.map((issue) => issue.code);
  assert.ok(codes.includes("missing_datasheet"));
  assert.ok(!codes.includes("datasheet_not_downloaded"));
});

test("issues include lifecycle_risk for non-active lifecycle and low_trust_score for low scores", () => {
  const record = makeRecord({
    part: makePart({ lifecycleStatus: "obsolete", trustScore: 0.4 })
  });
  const view = buildPartDetailViewModel(record);
  const codes = view.issues.map((issue) => issue.code);
  assert.ok(codes.includes("lifecycle_risk"));
  assert.ok(codes.includes("low_trust_score"));
  assert.equal(view.identity.lifecycleTone, "danger");
  assert.equal(view.identity.trustTone, "danger");
});

test("issues include asset_validation_failed when any asset failed validation", () => {
  const record = makeRecord({
    assets: [
      makeAsset({
        assetState: "failed",
        id: "asset-test-broken",
        assetType: "datasheet",
        licenseMode: "metadata_only",
        validationStatus: "failed"
      })
    ],
    datasheetRevision: null
  });
  const view = buildPartDetailViewModel(record);
  const codes = view.issues.map((issue) => issue.code);
  assert.ok(codes.includes("asset_validation_failed"));
});

test("fullyReady is true only when all CAD assets are exportable AND a stored datasheet exists", () => {
  const buildAsset = (assetType: Asset["assetType"], idSuffix: string): Asset =>
    makeAsset({
      assetState: "validated",
      fileFormat: assetType === "three_d_model" ? "step" : assetType === "footprint" ? "kicad_mod" : assetType === "symbol" ? "kicad_sym" : "pdf",
      fileHash: "hash",
      id: `asset-test-${idSuffix}`,
      assetType,
      licenseMode: "redistribution_allowed",
      storageKey: `cad/${idSuffix}`,
      validationStatus: "verified"
    });
  const record = makeRecord({
    assets: [
      buildAsset("datasheet", "datasheet"),
      buildAsset("symbol", "symbol"),
      buildAsset("footprint", "footprint"),
      buildAsset("three_d_model", "3d")
    ]
  });
  const view = buildPartDetailViewModel(record);
  assert.equal(view.cadReadiness.allExportable, true);
  assert.equal(view.fullyReady, true);
});

test("scoreTone, assetStateTone, validationTone, and labels match expectations", () => {
  assert.equal(scoreTone(0.9), "verified");
  assert.equal(scoreTone(0.7), "review");
  assert.equal(scoreTone(0.3), "danger");

  assert.equal(assetStateTone("missing"), "neutral");
  assert.equal(assetStateTone("failed"), "danger");
  assert.equal(assetStateTone("validated"), "verified");

  assert.equal(validationTone("verified"), "verified");
  assert.equal(validationTone("failed"), "danger");

  assert.equal(assetStateLabel("missing"), "Missing");
  assert.equal(validationLabel("needs_review"), "Needs review");
});

test("provenance preserves provider and source URL fields per source record", () => {
  const view = buildPartDetailViewModel(makeRecord());
  assert.equal(view.provenance.length, 1);
  const row = view.provenance[0]!;
  assert.equal(row.providerId, "test-provider");
  assert.equal(row.providerPartKey, "TPS7A02DBVR");
  assert.equal(row.sourceUrl, "https://www.ti.com/product/TPS7A02");
});
