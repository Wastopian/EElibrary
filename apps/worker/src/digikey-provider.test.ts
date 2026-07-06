/**
 * File header: Tests the DigiKey provider adapter normalization without live provider calls.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { digikeyProviderAdapter } from "./providers/digikey-provider";
import type { RawProviderPayload } from "./provider-adapters";

/**
 * Verifies the adapter maps DigiKey product, datasheet, parameter, and pricing payloads honestly.
 */
test("digikey provider normalizes product metadata and packaging offers", () => {
  const normalized = digikeyProviderAdapter.normalizeRawPart(buildRawPayload());

  assert.equal(normalized.manufacturer.name, "Texas Instruments");
  assert.equal(normalized.part.mpn, "TPS7A0228PDBVR");
  assert.equal(normalized.part.category, "Linear Regulators");
  assert.equal(normalized.part.lifecycleStatus, "active");
  assert.equal(normalized.package.packageName, "SOT-23-5");
  assert.equal(normalized.sourceRecord.providerId, "digikey");
  assert.equal(normalized.sourceRecord.providerPartKey, "296-TPS7A0228PDBVRCT-ND");
  assert.equal(normalized.sourceRecord.importStatus, "imported");
  assert.match(normalized.sourceRecord.sourceUrl ?? "", /digikey\.com/u);

  const datasheet = normalized.assets.find((asset) => asset.assetType === "datasheet");

  assert.ok(datasheet, "expected datasheet reference asset");
  assert.equal(datasheet.storageKey, null);
  assert.equal(datasheet.fileHash, null);
  assert.equal(normalized.datasheetRevisions[0]?.parseConfidence, 0);
  assert.deepEqual(
    normalized.metrics.map((metric) => [metric.metricKey, metric.metricValue, metric.unit]),
    [["voltage_rating", 2.28, "V"]]
  );
  assert.equal(normalized.supplyOfferings.length, 1);
  assert.equal(normalized.supplyOfferings[0]?.supplierName, "DigiKey");
  assert.equal(normalized.supplyOfferings[0]?.inventoryStatus, "in_stock");
  assert.equal(normalized.supplyOfferings[0]?.inventoryQuantity, 18_452);
  assert.deepEqual(
    normalized.supplyOfferings[0]?.priceBreaks.map((priceBreak) => [priceBreak.minQuantity, priceBreak.unitPrice, priceBreak.currencyCode]),
    [
      [1, 0.41, "USD"],
      [100, 0.29, "USD"]
    ]
  );
});

/**
 * Confirms an unexpected provider id is rejected before normalization runs.
 */
test("digikey provider rejects a foreign raw payload", () => {
  assert.throws(() => digikeyProviderAdapter.normalizeRawPart({ ...buildRawPayload(), providerId: "octopart" }), /Unexpected DigiKey provider id/u);
});

/**
 * Verifies the full DigiKey parameter table is preserved as verbatim spec rows, even the parameters
 * the six-metric allowlist drops.
 */
test("digikey provider keeps the full parameter table as verbatim spec rows", () => {
  const normalized = digikeyProviderAdapter.normalizeRawPart(buildRawPayload());
  const specifications = normalized.specifications ?? [];

  assert.deepEqual(
    specifications.map((row) => [row.specKey, row.specValue, row.specGroup]),
    [
      ["Output Type", "Fixed", "parametric"],
      ["Voltage - Output (Min/Fixed)", "2.28V", "parametric"]
    ]
  );
});

/**
 * Builds a deterministic raw payload mirroring the DigiKey keyword response subset.
 */
function buildRawPayload(): RawProviderPayload {
  return {
    fetchedAt: "2026-05-16T00:00:00.000Z",
    payload: {
      product: {
        Category: { Name: "Linear Regulators" },
        DatasheetUrl: "https://www.ti.com/lit/ds/symlink/tps7a02.pdf",
        Description: { ProductDescription: "IC REG LINEAR 2.28V 200MA SOT23-5" },
        Manufacturer: { Name: "Texas Instruments" },
        ManufacturerProductNumber: "TPS7A0228PDBVR",
        Parameters: [
          { ParameterText: "Output Type", ValueText: "Fixed" },
          { ParameterText: "Voltage - Output (Min/Fixed)", ValueText: "2.28V" }
        ],
        ProductStatus: { Status: "Active" },
        ProductUrl: "https://www.digikey.com/en/products/detail/texas-instruments/TPS7A0228PDBVR/1234567",
        ProductVariations: [
          {
            DigiKeyProductNumber: "296-TPS7A0228PDBVRCT-ND",
            MinimumOrderQuantity: 1,
            PackageType: { Name: "SOT-23-5" },
            QuantityAvailableforPackageType: 18_452,
            StandardPricing: [
              { BreakQuantity: 1, UnitPrice: 0.41 },
              { BreakQuantity: 100, UnitPrice: 0.29 }
            ]
          }
        ],
        QuantityAvailable: 18_452
      },
      request: { manufacturerName: null, mpn: "TPS7A0228PDBVR" }
    },
    providerId: "digikey"
  };
}
