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
 * Verifies product attributes become verbatim spec rows and an MCU description with no anchored
 * values (this one truncates before "of Flash") emits nothing — no tolerance/power rows, no invented
 * metrics, no guessed sizes.
 */
test("mouser provider keeps product attributes as spec rows and invents nothing from anchorless descriptions", () => {
  const normalized = mouserProviderAdapter.normalizeRawPart(buildRawPayload());
  const specifications = normalized.specifications ?? [];

  assert.deepEqual(
    specifications.filter((row) => row.specGroup === "parametric").map((row) => [row.specKey, row.specValue]),
    [
      ["Package / Case", "LQFP-32"],
      ["Supply Voltage", "3.3 V"]
    ]
  );
  assert.ok(!specifications.some((row) => row.specKey === "Tolerance"), "no tolerance row for a microcontroller");
  assert.ok(!specifications.some((row) => row.specKey === "Power Rating"), "no power row for a microcontroller");
  assert.ok(!normalized.metrics.some((metric) => metric.metricKey === "resistance"), "no invented resistance metric");
});

/**
 * Verifies the MCU and regulator description parsing against the live Mouser descriptions captured
 * on 2026-07-16, and that a numbers-free diode description emits nothing. Values must sit next to
 * their anchor word (Flash/RAM/CPU-frequency, output/quiescent current) — never bare numbers.
 */
test("mouser provider parses MCU and regulator description specs conservatively", () => {
  const parametricRows = (category: string, description: string) => {
    const payload = buildRawPayload();
    const part = (payload.payload as { part: Record<string, unknown> }).part;
    part["Category"] = category;
    part["Description"] = description;
    part["ProductAttributes"] = [];
    const normalized = mouserProviderAdapter.normalizeRawPart(payload);

    return {
      metrics: normalized.metrics,
      rows: (normalized.specifications ?? []).filter((row) => row.specGroup === "parametric").map((row) => [row.specKey, row.specValue])
    };
  };

  const mcu = parametricRows("ARM Microcontrollers - MCU", "ARM Microcontrollers - MCU Mainstream Arm Cortex-M0+ MCU 64 Kbytes of Flash 8 Kbytes RAM, 64 MHz CPU, 2x USART");

  assert.deepEqual(mcu.rows, [
    ["Flash Size", "64 Kbytes"],
    ["RAM Size", "8 Kbytes"],
    ["Clock Frequency", "64 MHz"]
  ]);
  assert.equal(mcu.metrics.length, 0, "description parsing emits verbatim spec rows, not metrics");

  const ldo = parametricRows("LDO Voltage Regulators", "LDO Voltage Regulators 200mA nanopower-IQ ( 25 nA) low-dropout");

  assert.deepEqual(ldo.rows, [
    ["Output Current", "200mA"],
    ["Quiescent Current", "25 nA"]
  ]);

  // A regulator without IQ language must not read a small current as quiescent.
  const plainLdo = parametricRows("LDO Voltage Regulators", "LDO Voltage Regulators 300mA low-dropout regulator");

  assert.deepEqual(plainLdo.rows, [["Output Current", "300mA"]]);

  const diode = parametricRows("Small Signal Switching Diodes", "Small Signal Switching Diodes SURFACE MOUNT FAST SWITCHING DIODE");

  assert.deepEqual(diode.rows, [], "a numbers-free description yields no parametric rows");
});

/**
 * Verifies the full passive path: description-parsed electrical value feeds Key metrics, tolerance and
 * power become spec rows, repeated Packaging attributes collapse to one row, and RoHS, lifecycle,
 * weight, and compliance fields are captured under honest groups.
 */
test("mouser provider parses passive description specs and captures commercial and compliance rows", () => {
  const normalized = mouserProviderAdapter.normalizeRawPart(buildResistorRawPayload());
  const specifications = normalized.specifications ?? [];
  const byKey = (specKey: string) => specifications.find((row) => row.specKey === specKey);

  const resistance = normalized.metrics.find((metric) => metric.metricKey === "resistance");

  assert.ok(resistance, "expected a resistance metric parsed from the description");
  assert.equal(resistance.metricValue, 10_000, "10kOhms must normalize to 10000 ohms");

  assert.equal(byKey("Tolerance")?.specValue, "1%");
  assert.equal(byKey("Tolerance")?.specGroup, "parametric");
  assert.equal(byKey("Power Rating")?.specValue, "1/10W");

  const packaging = specifications.filter((row) => row.specKey === "Packaging");

  assert.equal(packaging.length, 1, "three Packaging attributes must collapse into one row");
  assert.equal(packaging[0]?.specValue, "Cut Tape (CT) / Reel / Digi-Reel®");

  assert.equal(byKey("RoHS Status")?.specGroup, "compliance");
  assert.equal(byKey("ECCN")?.specGroup, "compliance");
  assert.equal(byKey("Lifecycle Status")?.specGroup, "commercial");
  assert.equal(byKey("Factory Stock")?.specValue, "0");
  assert.equal(byKey("Unit Weight (kg)")?.specGroup, "physical");
});

/**
 * Builds a deterministic raw payload mirroring a Mouser chip-resistor response, where electrical
 * specs live in the description and attributes carry only packaging variants.
 */
function buildResistorRawPayload(): RawProviderPayload {
  return {
    fetchedAt: "2026-05-16T00:00:00.000Z",
    payload: {
      part: {
        AvailabilityInStock: "0",
        Category: "Resistors / Chip Resistor - Surface Mount",
        DataSheetUrl: "https://www.yageo.com/upload/media/product/RC0603.pdf",
        Description: "Thick Film Resistors - SMD General Purpose Chip Resistor 0603, 10kOhms, 1%, 1/10W",
        FactoryStock: "0",
        LeadTime: "63 Days",
        LifecycleStatus: "Active",
        Manufacturer: "YAGEO",
        ManufacturerPartNumber: "RC0603FR-0710KL",
        Min: "1",
        MouserPartNumber: "603-RC0603FR-0710KL",
        ProductAttributes: [
          { AttributeName: "Packaging", AttributeValue: "Cut Tape (CT)" },
          { AttributeName: "Packaging", AttributeValue: "Reel" },
          { AttributeName: "Packaging", AttributeValue: "Digi-Reel®" },
          { AttributeName: "Standard Pack Qty", AttributeValue: "10000" }
        ],
        ProductCompliance: [
          { ComplianceName: "ECCN", ComplianceValue: "EAR99" },
          { ComplianceName: "HTSUS", ComplianceValue: "8533.21.0060" }
        ],
        ProductDetailUrl: "https://www.mouser.com/ProductDetail/YAGEO/RC0603FR-0710KL",
        ROHSStatus: "RoHS Compliant",
        UnitWeightKg: "0.00002"
      },
      request: { manufacturerName: null, mpn: "RC0603FR-0710KL" }
    },
    providerId: "mouser"
  };
}

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

/**
 * Verifies the capacitor passive path against the real Mouser description form ".1UF 16V 10% 0603":
 * leading-dot + uppercase electrical value normalizes, and the capacitor voltage rating is captured.
 */
test("mouser provider parses a capacitor description including leading-dot value and voltage rating", () => {
  const payload = buildResistorRawPayload();
  const part = (payload.payload as { part: Record<string, unknown> }).part;
  part.Category = "Capacitors / Multilayer Ceramic Capacitors MLCC - SMD/SMT";
  part.Description = "Multilayer Ceramic Capacitors MLCC - SMD/SMT .1UF 16V 10% 0603";
  part.ManufacturerPartNumber = "GRM188R71C104KA01D";

  const normalized = mouserProviderAdapter.normalizeRawPart(payload);
  const capacitance = normalized.metrics.find((metric) => metric.metricKey === "capacitance");

  assert.ok(capacitance, "expected a capacitance metric parsed from the description");
  // ".1UF" is 0.1 µF = 1e-7 F; the leading dot and uppercase prefix must both be handled.
  assert.ok(Math.abs(capacitance.metricValue - 1e-7) <= 1e-16, `capacitance ${capacitance.metricValue} should be ~1e-7 F`);

  const voltage = (normalized.specifications ?? []).find((row) => row.specKey === "Voltage Rating");
  assert.equal(voltage?.specValue, "16V", "the capacitor voltage rating is captured from the description");
});
