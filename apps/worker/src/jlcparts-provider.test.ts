/**
 * File header: Tests the JLCPCB/LCSC structured metadata provider adapter.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { jlcpartsProviderAdapter } from "./providers/jlcparts-provider";
import type { RawProviderPayload } from "./provider-adapters";

/**
 * Verifies the adapter maps a real jlcparts row shape into canonical records honestly.
 */
test("jlcparts provider normalizes structured metadata without implying CAD availability", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(buildRawPayload());

  assert.equal(normalized.manufacturer.name, "FH(Guangdong Fenghua Advanced Tech)");
  assert.equal(normalized.part.mpn, "RC-02W300JT");
  assert.equal(normalized.part.category, "Chip Resistor - Surface Mount");
  assert.equal(normalized.part.lifecycleStatus, "active");
  assert.equal(normalized.package.packageName, "0402");
  assert.equal(normalized.package.pinCount, 2);
  assert.equal(normalized.sourceRecord.providerId, "jlcparts");
  assert.equal(normalized.sourceRecord.providerPartKey, "C1091");
  assert.match(normalized.sourceRecord.sourceUrl ?? "", /lcsc\.com\/product-detail/u);

  const datasheet = normalized.assets.find((asset) => asset.assetType === "datasheet");

  assert.ok(datasheet, "expected datasheet reference asset");
  assert.equal(datasheet.availabilityStatus, "referenced");
  assert.equal(datasheet.exportStatus, "not_exportable");
  assert.equal(datasheet.storageKey, null);
  assert.equal(datasheet.fileHash, null);
  assert.equal(normalized.assets.some((asset) => asset.assetType === "footprint" || asset.assetType === "symbol" || asset.assetType === "three_d_model"), false);
  assert.equal(normalized.datasheetRevisions[0]?.parseConfidence, 0);
  assert.equal(normalized.datasheetRevisions[0]?.pinTableStatus, "not_available");
  assert.deepEqual(
    normalized.metrics.map((metric) => [metric.metricKey, metric.metricValue, metric.minValue, metric.maxValue, metric.unit]),
    [
      ["resistance", 30, null, null, "ohm"],
      ["overload_voltage_max", 50, null, null, "V"],
      ["operating_temperature_range", null, -55, 155, "deg C"]
    ]
  );
});

/**
 * Builds a raw payload using the public jlcparts category-row schema for C1091.
 */
function buildRawPayload(): RawProviderPayload {
  return {
    fetchedAt: "2026-04-12T06:57:40.000Z",
    payload: {
      categoryName: "Resistors",
      categorySourceName: "ResistorsChip_Resistor___Surface_Mount",
      component: {
        attributes: {
          "Basic/Extended": buildStringAttribute("Extended"),
          Manufacturer: buildStringAttribute("FH(Guangdong Fenghua Advanced Tech)"),
          "Operating temperature range": buildStringAttribute("-55℃~+155℃"),
          "Overload voltage (max)": buildStringAttribute("50V"),
          Package: buildStringAttribute("0402"),
          Resistance: {
            format: "${resistance}",
            primary: "resistance",
            values: {
              resistance: [30, "resistance"]
            }
          },
          Status: buildStringAttribute("Active"),
          Type: buildStringAttribute("Thick Film Resistors")
        },
        datasheet: "https://www.lcsc.com/datasheet/lcsc_datasheet_2411121005_FH--Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.pdf",
        description: "-55℃~+155℃ 30Ω 50V 62.5mW Thick Film Resistor ±200ppm/℃ ±5% 0402 Chip Resistor - Surface Mount ROHS",
        img: "20221227_FH--Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091_front.jpg",
        joints: 2,
        lcsc: "C1091",
        mfr: "RC-02W300JT",
        price: [],
        url: "Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT"
      },
      indexCreatedAt: "2026-04-12T06:57:40+00:00",
      subcategoryName: "Chip Resistor - Surface Mount"
    },
    providerId: "jlcparts"
  };
}

/**
 * Builds the common provider attribute envelope for a string value.
 */
function buildStringAttribute(value: string) {
  return {
    format: "${default}",
    primary: "default",
    values: {
      default: [value, "string"]
    }
  };
}
