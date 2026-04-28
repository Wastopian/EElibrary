/**
 * File header: Tests the JLCPCB/LCSC structured metadata provider adapter.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { jlcpartsProviderAdapter } from "./providers/jlcparts-provider";
import type { RawProviderPayload } from "./provider-adapters";

/**
 * Verifies the adapter maps a real jlcparts row shape into canonical records honestly.
 */
test("jlcparts provider normalizes structured metadata without implying CAD availability", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(buildRawPayload());

  assert.equal(normalized.manufacturer.name, "Guangdong Fenghua Advanced Tech");
  assert.deepEqual(normalized.manufacturer.aliases, ["FH", "FH(Guangdong Fenghua Advanced Tech)"]);
  assert.equal(normalized.part.mpn, "RC-02W300JT");
  assert.equal(normalized.part.category, "Resistors / Chip Resistor - Surface Mount");
  assert.equal(normalized.part.lifecycleStatus, "active");
  assert.equal(normalized.package.packageName, "0402");
  assert.equal(normalized.package.pinCount, 2);
  assert.equal(normalized.sourceRecord.providerId, "jlcparts");
  assert.equal(normalized.sourceRecord.providerPartKey, "C1091");
  assert.equal(normalized.sourceRecord.importStatus, "imported");
  assert.equal(normalized.sourceRecord.sourceLastImportedAt, "2026-04-12T06:57:40.000Z");
  assert.equal(normalized.sourceRecord.sourceLastSeenAt, "2026-04-12T06:57:40.000Z");
  assert.match(normalized.sourceRecord.sourceUrl ?? "", /lcsc\.com\/product-detail/u);
  assert.equal(normalized.extractionSignals.find((signal) => signal.signalType === "package_mechanical_dimensions")?.extractionStatus, "needs_review");
  assert.equal(normalized.extractionSignals.find((signal) => signal.signalType === "pin_table")?.extractionStatus, "not_available");
  assert.equal(normalized.extractionSignals.find((signal) => signal.signalType === "mechanical_drawing")?.extractionStatus, "not_available");

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
 * Verifies exact provider lookup returns one provider-neutral candidate row for a supported provider part id.
 */
test("jlcparts provider returns exact candidate rows for supported lookups", async () => {
  const rawPayload = buildRawPayload();
  const payload = rawPayload.payload as {
    component: {
      attributes: Record<string, unknown>;
      datasheet: string | null;
      description: string;
      img: string | null;
      joints: number | null;
      lcsc: string;
      mfr: string;
      price: unknown;
      url: string | null;
    };
  };
  const restoreFetch = mockFetch((url) => {
    if (url.pathname.endsWith("/index.json")) {
      return jsonResponse({
        categories: {
          Resistors: {
            "Chip Resistor - Surface Mount": {
              datahash: "hash",
              sourcename: "ResistorsChip_Resistor___Surface_Mount",
              stockhash: "stock-hash"
            }
          }
        },
        created: "2026-04-12T06:57:40+00:00"
      });
    }

    if (url.pathname.endsWith("/ResistorsChip_Resistor___Surface_Mount.json.gz")) {
      return new Response(
        gzipSync(
          Buffer.from(
            JSON.stringify({
              components: [
                [
                  payload.component.attributes,
                  payload.component.datasheet,
                  payload.component.description,
                  payload.component.img,
                  payload.component.joints,
                  payload.component.lcsc,
                  payload.component.mfr,
                  payload.component.price,
                  payload.component.url
                ]
              ],
              schema: ["attributes", "datasheet", "description", "img", "joints", "lcsc", "mfr", "price", "url"]
            })
          )
        )
      );
    }

    throw new Error(`Unexpected URL: ${url.toString()}`);
  });

  try {
    const candidates = await jlcpartsProviderAdapter.findExactPartCandidates({ query: "C1091" });

    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0], {
      manufacturerName: "Guangdong Fenghua Advanced Tech",
      matchConfidence: 1,
      matchType: "exact_provider_part_id",
      mpn: "RC-02W300JT",
      package: "0402",
      providerId: "jlcparts",
      providerPartKey: "C1091",
      sourceUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
    });
  } finally {
    restoreFetch();
  }
});

test("jlcparts provider extracts numeric pitch and body dimensions from structured attributes", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(buildRawPayload({
    "Pitch": buildNumberAttribute(0.5),
    "Body Length": buildNumberAttribute(3.2),
    "Body Width": buildNumberAttribute(1.6),
    "Height (Max)": buildNumberAttribute(0.35)
  }));

  assert.equal(normalized.package.pitchMm, 0.5);
  assert.equal(normalized.package.bodyLengthMm, 3.2);
  assert.equal(normalized.package.bodyWidthMm, 1.6);
  assert.equal(normalized.package.bodyHeightMm, 0.35);
});

test("jlcparts provider extracts string mm dimensions from structured attributes", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(buildRawPayload({
    "Pitch": buildStringAttribute("0.5mm"),
    "Body Length": buildStringAttribute("3.2mm"),
    "Body Width": buildStringAttribute("1.6mm"),
    "Height (Max)": buildStringAttribute("0.35mm")
  }));

  assert.equal(normalized.package.pitchMm, 0.5);
  assert.equal(normalized.package.bodyLengthMm, 3.2);
  assert.equal(normalized.package.bodyWidthMm, 1.6);
  assert.equal(normalized.package.bodyHeightMm, 0.35);
});

test("jlcparts provider converts mil and inch dimension strings to mm", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(buildRawPayload({
    "Pitch": buildStringAttribute("19.685mil"),
    "Body Length": buildStringAttribute("0.126in"),
    "Body Width": buildStringAttribute("0.063in")
  }));

  assert.ok(Math.abs((normalized.package.pitchMm ?? 0) - 0.5) < 0.001, `expected ~0.5mm pitch, got ${normalized.package.pitchMm}`);
  assert.ok(Math.abs((normalized.package.bodyLengthMm ?? 0) - 3.2) < 0.1, `expected ~3.2mm length, got ${normalized.package.bodyLengthMm}`);
  assert.ok(Math.abs((normalized.package.bodyWidthMm ?? 0) - 1.6) < 0.1, `expected ~1.6mm width, got ${normalized.package.bodyWidthMm}`);
});

test("jlcparts provider falls back to Body Height when Height (Max) is absent", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(buildRawPayload({
    "Body Height": buildNumberAttribute(1.2)
  }));

  assert.equal(normalized.package.bodyHeightMm, 1.2);
});

test("jlcparts provider returns null dimensions when attributes are absent", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(buildRawPayload({}));

  assert.equal(normalized.package.pitchMm, null);
  assert.equal(normalized.package.bodyLengthMm, null);
  assert.equal(normalized.package.bodyWidthMm, null);
  assert.equal(normalized.package.bodyHeightMm, null);
});

test("jlcparts provider builds a normalized description from category, key attributes, and package", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(buildRawPayload());

  assert.equal(normalized.part.description, "Resistors 30Ω (0402)");
});

test("jlcparts provider includes tolerance and power in the normalized description when available", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(
    buildRawPayload({
      Tolerance: buildStringAttribute("±1%"),
      Power: buildStringAttribute("0.1W")
    })
  );

  assert.equal(normalized.part.description, "Resistors 30Ω 1% 0.1W (0402)");
});

test("jlcparts provider falls back to MPN in the description when engineering attributes are sparse", () => {
  const normalized = jlcpartsProviderAdapter.normalizeRawPart(
    buildSparsePayload({
      categoryName: "Linear Regulators",
      subcategoryName: "Linear Regulators",
      mfr: "TPS7A02DBVR",
      packageName: "SOT-23-5"
    })
  );

  assert.equal(normalized.part.description, "Linear Regulators TPS7A02DBVR (SOT-23-5)");
});

/**
 * Builds a raw payload using the public jlcparts category-row schema for C1091.
 * Extra attributes are merged on top of the base component attributes.
 */
function buildRawPayload(extraAttributes: Record<string, unknown> = {}): RawProviderPayload {
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
          Type: buildStringAttribute("Thick Film Resistors"),
          ...extraAttributes
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

/**
 * Builds the common provider attribute envelope for a numeric value (e.g. length in mm).
 */
function buildNumberAttribute(value: number) {
  return {
    format: "${default}",
    primary: "default",
    values: {
      default: [value, "length"]
    }
  };
}

/**
 * Builds a raw payload with no engineering attributes so description synthesis
 * exercises the MPN-fallback path used by ICs and parts with sparse provider data.
 */
function buildSparsePayload({
  categoryName,
  subcategoryName,
  mfr,
  packageName
}: {
  categoryName: string;
  subcategoryName: string;
  mfr: string;
  packageName: string;
}): RawProviderPayload {
  return {
    fetchedAt: "2026-04-12T06:57:40.000Z",
    payload: {
      categoryName,
      categorySourceName: "Sparse_Fixture",
      component: {
        attributes: {
          Manufacturer: buildStringAttribute("Texas Instruments"),
          Package: buildStringAttribute(packageName),
          Status: buildStringAttribute("Active")
        },
        datasheet: null,
        description: "Sparse provider description used only as a fallback.",
        img: null,
        joints: 5,
        lcsc: "C-SPARSE-1",
        mfr,
        price: [],
        url: null
      },
      indexCreatedAt: "2026-04-12T06:57:40+00:00",
      subcategoryName
    },
    providerId: "jlcparts"
  };
}

/**
 * Replaces global fetch for one adapter test and returns a restore callback.
 */
function mockFetch(handler: (url: URL) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

/**
 * Builds a JSON response for mocked provider fetches.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}
