/**
 * File header: Tests the Mouser provider adapter normalization without live provider calls.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mouserProviderAdapter } from "./providers/mouser-provider";
import type { RawProviderPayload } from "./provider-adapters";

/**
 * Verifies the adapter maps Mouser part, datasheet, attribute, and price-break payloads honestly.
 */
test("mouser provider normalizes part metadata and price breaks", () => {
  const normalized = mouserProviderAdapter.normalizeRawPart(buildRawPayload());

  assert.equal(normalized.manufacturer.name, "STMicroelectronics");
  assert.equal(normalized.part.mpn, "STM32G031K8T6");
  assert.equal(normalized.part.category, "ARM Microcontrollers - MCU");
  assert.equal(normalized.part.lifecycleStatus, "active");
  assert.equal(normalized.package.packageName, "LQFP-32");
  assert.equal(normalized.sourceRecord.providerId, "mouser");
  assert.equal(normalized.sourceRecord.providerPartKey, "511-STM32G031K8T6");
  assert.equal(normalized.sourceRecord.importStatus, "imported");
  assert.match(normalized.sourceRecord.sourceUrl ?? "", /mouser\.com/u);

  const datasheet = normalized.assets.find((asset) => asset.assetType === "datasheet");

  assert.ok(datasheet, "expected datasheet reference asset");
  assert.equal(datasheet.storageKey, null);
  assert.equal(normalized.datasheetRevisions[0]?.parseConfidence, 0);
  assert.equal(normalized.supplyOfferings.length, 1);
  assert.equal(normalized.supplyOfferings[0]?.supplierName, "Mouser");
  assert.equal(normalized.supplyOfferings[0]?.inventoryStatus, "in_stock");
  assert.equal(normalized.supplyOfferings[0]?.inventoryQuantity, 5_120);
  assert.equal(normalized.supplyOfferings[0]?.leadTimeDays, 28);
  assert.equal(normalized.supplyOfferings[0]?.moq, 1);
  assert.deepEqual(
    normalized.supplyOfferings[0]?.priceBreaks.map((priceBreak) => [priceBreak.minQuantity, priceBreak.unitPrice, priceBreak.currencyCode]),
    [
      [1, 2.31, "USD"],
      [10, 2.08, "USD"]
    ]
  );
});

/**
 * Confirms an unexpected provider id is rejected before normalization runs.
 */
test("mouser provider rejects a foreign raw payload", () => {
  assert.throws(() => mouserProviderAdapter.normalizeRawPart({ ...buildRawPayload(), providerId: "digikey" }), /Unexpected Mouser provider id/u);
});

/**
 * Builds a deterministic raw payload mirroring the Mouser part-number response subset.
 */
function buildRawPayload(): RawProviderPayload {
  return {
    fetchedAt: "2026-05-16T00:00:00.000Z",
    payload: {
      part: {
        AvailabilityInStock: "5120",
        Category: "ARM Microcontrollers - MCU",
        DataSheetUrl: "https://www.st.com/resource/en/datasheet/stm32g031k8.pdf",
        Description: "ARM Microcontrollers - MCU Mainstream Arm Cortex-M0+ MCU 64 Kbytes",
        LeadTime: "28 Days",
        LifecycleStatus: "Active",
        Manufacturer: "STMicroelectronics",
        ManufacturerPartNumber: "STM32G031K8T6",
        Min: "1",
        MouserPartNumber: "511-STM32G031K8T6",
        PriceBreaks: [
          { Currency: "USD", Price: "$2.31", Quantity: 1 },
          { Currency: "USD", Price: "$2.08", Quantity: 10 }
        ],
        ProductAttributes: [
          { AttributeName: "Package / Case", AttributeValue: "LQFP-32" },
          { AttributeName: "Supply Voltage", AttributeValue: "3.3 V" }
        ],
        ProductDetailUrl: "https://www.mouser.com/ProductDetail/STMicroelectronics/STM32G031K8T6"
      },
      request: { manufacturerName: null, mpn: "STM32G031K8T6" }
    },
    providerId: "mouser"
  };
}
