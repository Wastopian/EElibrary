/**
 * File header: Server-side render tests for PartDetailView. Drives the component with a
 * fixture record + buildPartDetailViewModel so we lock in identity, datasheet action,
 * CAD readiness, and "what's missing" copy without spinning up a full browser.
 */

import * as React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { buildPartDetailViewModel } from "@ee-library/shared";
import type {
  Asset,
  DatasheetRevision,
  PartSearchRecord
} from "@ee-library/shared";
import { PartDetailView } from "./PartDetailView";

const LAST_UPDATED_AT = "2026-04-26T00:00:00.000Z";

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

function makeRecord(overrides: Partial<PartSearchRecord> = {}): PartSearchRecord {
  return {
    assets: [
      makeAsset({
        assetState: "referenced",
        assetType: "datasheet",
        fileFormat: "pdf",
        id: "asset-test-datasheet",
        licenseMode: "metadata_only",
        sourceUrl: "https://www.ti.com/lit/ds/symlink/tps7a02.pdf",
        validationStatus: "needs_review"
      })
    ],
    datasheetRevision: makeDatasheet(),
    lastUpdatedAt: LAST_UPDATED_AT,
    manufacturer: { aliases: ["TI"], id: "mfr-test", name: "Texas Instruments", website: "https://www.ti.com" },
    metrics: [
      {
        confidenceScore: 0.83,
        id: "metric-vmax",
        lastUpdatedAt: LAST_UPDATED_AT,
        maxValue: null,
        metricKey: "input_voltage_max",
        metricValue: 5.5,
        minValue: null,
        partId: "part-test",
        sourceRecordId: "source-test",
        sourceRevisionId: "dsr-test",
        unit: "V"
      }
    ],
    package: {
      bodyHeightMm: 1.45,
      bodyLengthMm: 2.9,
      bodyWidthMm: 1.6,
      id: "pkg-sot-23-5",
      packageName: "SOT-23-5",
      pinCount: 5,
      pitchMm: 0.95
    },
    part: {
      category: "Power management",
      id: "part-test",
      lastUpdatedAt: LAST_UPDATED_AT,
      lifecycleStatus: "active",
      manufacturerId: "mfr-test",
      mpn: "TPS7A02DBVR",
      packageId: "pkg-sot-23-5",
      trustScore: 0.82
    },
    sources: [
      {
        fetchedAt: LAST_UPDATED_AT,
        id: "source-test",
        lastUpdatedAt: LAST_UPDATED_AT,
        normalizedAt: LAST_UPDATED_AT,
        partId: "part-test",
        providerId: "test-provider",
        providerPartKey: "TPS7A02DBVR",
        rawPayload: { mpn: "TPS7A02DBVR" },
        sourceUrl: "https://www.ti.com/product/TPS7A02"
      }
    ],
    ...overrides
  };
}

function renderHtml(record: PartSearchRecord): string {
  const viewModel = buildPartDetailViewModel(record);
  return renderToStaticMarkup(<PartDetailView viewModel={viewModel} />);
}

test("renders MPN, manufacturer, lifecycle, and key spec value", () => {
  const html = renderHtml(makeRecord());
  assert.match(html, /TPS7A02DBVR/u);
  assert.match(html, /Texas Instruments/u);
  assert.match(html, /Active/u);
  assert.match(html, /Input Voltage Max/u);
  assert.match(html, /5\.5\s*V/u);
});

test("renders datasheet open action linking to the referenced URL", () => {
  const html = renderHtml(makeRecord());
  assert.match(html, /Open referenced URL/u);
  assert.match(html, /href="https:\/\/www\.ti\.com\/lit\/ds\/symlink\/tps7a02\.pdf"/u);
  assert.match(html, /target="_blank"/u);
});

test("renders datasheet download action with /storage/ link when stored", () => {
  const record = makeRecord({
    assets: [
      makeAsset({
        assetState: "validated",
        assetType: "datasheet",
        fileFormat: "pdf",
        fileHash: "abc",
        id: "asset-test-datasheet",
        licenseMode: "metadata_only",
        storageKey: "datasheets/tps7a02.pdf",
        validationStatus: "verified"
      })
    ]
  });
  const html = renderHtml(record);
  assert.match(html, /Download datasheet/u);
  assert.match(html, /href="\/storage\/datasheets%2Ftps7a02\.pdf"/u);
});

test("renders three CAD readiness cards covering symbol, footprint, and 3D model", () => {
  const html = renderHtml(makeRecord());
  assert.match(html, /data-testid="cad-readiness-symbol"/u);
  assert.match(html, /data-testid="cad-readiness-footprint"/u);
  assert.match(html, /data-testid="cad-readiness-three_d_model"/u);
  assert.match(html, /0 of 3 CAD asset types are validated/u);
});

test("renders What's missing copy with command/link next-actions for the seeded fixture", () => {
  const html = renderHtml(makeRecord());
  assert.match(html, /What&#x27;s missing|What's missing/u);
  assert.match(html, /Datasheet referenced only/u);
  assert.match(html, /Open referenced datasheet/u);
  assert.match(html, /Symbol missing/u);
  assert.match(html, /Footprint missing/u);
  assert.match(html, /3D model missing/u);
  assert.match(html, /npm run dev:worker/u);
});

test("renders an empty-issues message when the part is fully ready", () => {
  const buildAsset = (assetType: Asset["assetType"], idSuffix: string, fileFormat: Asset["fileFormat"]): Asset =>
    makeAsset({
      assetState: "validated",
      assetType,
      fileFormat,
      fileHash: "hash",
      id: `asset-${idSuffix}`,
      licenseMode: "redistribution_allowed",
      storageKey: `cad/${idSuffix}`,
      validationStatus: "verified"
    });
  const record = makeRecord({
    assets: [
      buildAsset("datasheet", "datasheet", "pdf"),
      buildAsset("symbol", "symbol", "kicad_sym"),
      buildAsset("footprint", "footprint", "kicad_mod"),
      buildAsset("three_d_model", "3d", "step")
    ]
  });
  const html = renderHtml(record);
  assert.match(html, /No outstanding readiness issues/u);
  assert.match(html, /3 of 3 CAD asset types are validated/u);
});

test("renders provenance section with provider id and source URL anchor", () => {
  const html = renderHtml(makeRecord());
  assert.match(html, /test-provider/u);
  assert.match(html, /href="https:\/\/www\.ti\.com\/product\/TPS7A02"/u);
});

test("places engineer summary above provenance in the rendered output", () => {
  const html = renderHtml(makeRecord());
  const summaryIndex = html.indexOf("Engineer summary");
  const provenanceIndex = html.indexOf("Provenance");
  assert.notEqual(summaryIndex, -1);
  assert.notEqual(provenanceIndex, -1);
  assert.ok(summaryIndex < provenanceIndex, "engineer summary must render before provenance");
});

test("renders lifecycle_risk and low_trust_score copy when applicable", () => {
  const record = makeRecord({
    part: {
      ...makeRecord().part,
      lifecycleStatus: "obsolete",
      trustScore: 0.4
    }
  });
  const html = renderHtml(record);
  assert.match(html, /Lifecycle risk/u);
  assert.match(html, /Low trust score/u);
});
