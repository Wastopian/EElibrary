/**
 * File header: Tests the Octopart/Nexar provider adapter without live provider calls.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { octopartProviderAdapter, resetOctopartProviderAuthCacheForTests } from "./providers/octopart-provider";
import type { RawProviderPayload } from "./provider-adapters";

/**
 * Verifies the adapter maps Nexar part, datasheet, spec, and seller offer payloads honestly.
 */
test("octopart provider normalizes Nexar part metadata and seller offers", () => {
  const normalized = octopartProviderAdapter.normalizeRawPart(buildRawPayload());

  assert.equal(normalized.manufacturer.name, "Texas Instruments");
  assert.equal(normalized.part.mpn, "SN74S74N");
  assert.equal(normalized.part.category, "Integrated Circuits / Logic / Flip Flops");
  assert.equal(normalized.part.lifecycleStatus, "active");
  assert.equal(normalized.package.packageName, "SOIC-14");
  assert.equal(normalized.package.pinCount, 14);
  assert.equal(normalized.sourceRecord.providerId, "octopart");
  assert.equal(normalized.sourceRecord.providerPartKey, "octopart-123");
  assert.equal(normalized.sourceRecord.importStatus, "imported");
  assert.match(normalized.sourceRecord.sourceUrl ?? "", /octopart\.com/u);

  const datasheet = normalized.assets.find((asset) => asset.assetType === "datasheet");

  assert.ok(datasheet, "expected datasheet reference asset");
  assert.equal(datasheet.availabilityStatus, "referenced");
  assert.equal(datasheet.exportStatus, "not_exportable");
  assert.equal(datasheet.storageKey, null);
  assert.equal(datasheet.fileHash, null);
  assert.equal(normalized.datasheetRevisions[0]?.parseConfidence, 0);
  assert.equal(normalized.extractionSignals.find((signal) => signal.signalType === "package_mechanical_dimensions")?.extractionStatus, "needs_review");
  assert.deepEqual(
    normalized.metrics.map((metric) => [metric.metricKey, metric.metricValue, metric.unit]),
    [
      ["resistance", 10_000, "ohm"],
      ["voltage_rating", 5, "V"],
      ["frequency", 25_000_000, "Hz"]
    ]
  );
  assert.equal(normalized.supplyOfferings.length, 2);
  assert.equal(normalized.supplyOfferings[0]?.providerId, "octopart");
  assert.equal(normalized.supplyOfferings[0]?.providerSku, "Digi-Key SKU 296-6501-1-ND");
  assert.equal(normalized.supplyOfferings[0]?.inventoryStatus, "in_stock");
  assert.equal(normalized.supplyOfferings[0]?.inventoryQuantity, 423);
  assert.deepEqual(
    normalized.supplyOfferings[0]?.priceBreaks.map((priceBreak) => [priceBreak.minQuantity, priceBreak.unitPrice, priceBreak.currencyCode]),
    [
      [1, 0.42, "USD"],
      [100, 0.31, "USD"]
    ]
  );
  assert.equal(normalized.supplyOfferings[1]?.inventoryStatus, "backorder");
  assert.equal(normalized.supplyOfferings[1]?.leadTimeDays, 28);
});

/**
 * Verifies optional exact provider lookup skips Octopart when credentials are absent.
 */
test("octopart provider lookup returns no candidates when credentials are not configured", async () => {
  const restoreEnv = withOctopartEnv({});

  try {
    const candidates = await octopartProviderAdapter.findExactPartCandidates({ query: "SN74S74N" });

    assert.deepEqual(candidates, []);
  } finally {
    restoreEnv();
  }
});

/**
 * Verifies exact MPN lookup posts to Nexar GraphQL with a bearer token and maps one candidate.
 */
test("octopart provider returns exact candidate rows from mocked Nexar GraphQL", async () => {
  const restoreEnv = withOctopartEnv({ NEXAR_ACCESS_TOKEN: "test-token" });
  const restoreFetch = mockFetch((url, init) => {
    assert.equal(url.toString(), "https://api.nexar.com/graphql");
    assert.equal(init?.method, "POST");
    assert.equal(readHeader(init?.headers, "Authorization"), "Bearer test-token");
    assert.ok(typeof init?.body === "string");
    const body = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };

    assert.match(body.query, /supSearchMpn/u);
    assert.equal(body.variables.mpn, "SN74S74N");

    return jsonResponse({
      data: {
        supSearchMpn: {
          hits: 1,
          results: [
            {
              description: "Dual D-type positive-edge-triggered flip-flops.",
              part: buildNexarPart()
            }
          ]
        }
      }
    });
  });

  try {
    const candidates = await octopartProviderAdapter.findExactPartCandidates({ manufacturerName: "Texas Instruments", query: "SN74S74N" });

    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0], {
      manufacturerName: "Texas Instruments",
      matchConfidence: 1,
      matchType: "exact_mpn",
      mpn: "SN74S74N",
      package: "SOIC-14",
      providerId: "octopart",
      providerPartKey: "octopart-123",
      sourceUrl: "https://octopart.com/sn74s74n-texas-instruments-123"
    });
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

/**
 * Verifies OAuth client credentials are exchanged for a cached access token before GraphQL.
 */
test("octopart provider fetchRawPart obtains a Nexar token from client credentials", async () => {
  const restoreEnv = withOctopartEnv({
    NEXAR_CLIENT_ID: "client-id",
    NEXAR_CLIENT_SECRET: "client-secret"
  });
  const seenUrls: string[] = [];
  const restoreFetch = mockFetch((url, init) => {
    seenUrls.push(url.toString());

    if (url.toString() === "https://identity.nexar.com/connect/token") {
      assert.equal(init?.method, "POST");
      assert.equal(readHeader(init?.headers, "Content-Type"), "application/x-www-form-urlencoded");
      assert.ok(init?.body instanceof URLSearchParams);
      assert.equal(init.body.get("grant_type"), "client_credentials");
      assert.equal(init.body.get("client_id"), "client-id");
      assert.equal(init.body.get("client_secret"), "client-secret");
      assert.equal(init.body.get("scope"), "supply.domain");

      return jsonResponse({ access_token: "oauth-token", expires_in: 3600 });
    }

    assert.equal(url.toString(), "https://api.nexar.com/graphql");
    assert.equal(readHeader(init?.headers, "Authorization"), "Bearer oauth-token");
    assert.ok(typeof init?.body === "string");
    assert.match(init.body, /supParts/u);

    return jsonResponse({
      data: {
        supParts: [buildNexarPart()]
      }
    });
  });

  try {
    const rawPayload = await octopartProviderAdapter.fetchRawPart({ providerPartId: "octopart-123" });

    assert.equal(rawPayload.providerId, "octopart");
    assert.deepEqual(seenUrls, ["https://identity.nexar.com/connect/token", "https://api.nexar.com/graphql"]);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

/**
 * Builds a raw provider payload using a compact Nexar response fixture.
 */
function buildRawPayload(): RawProviderPayload {
  return {
    fetchedAt: "2026-05-12T12:00:00.000Z",
    payload: {
      hits: 1,
      part: buildNexarPart(),
      request: {
        manufacturerName: "Texas Instruments",
        mode: "mpn",
        mpn: "SN74S74N",
        providerPartId: null
      },
      resultDescription: "Dual D-type positive-edge-triggered flip-flops."
    },
    providerId: "octopart"
  };
}

/**
 * Builds the compact raw Nexar part fixture used by tests.
 */
function buildNexarPart() {
  return {
    bestDatasheet: {
      name: "SN74S74N datasheet",
      url: "https://datasheet.octopart.com/SN74S74N-Texas-Instruments-datasheet.pdf"
    },
    category: {
      id: "logic",
      name: "Flip Flops",
      path: ["Integrated Circuits", "Logic", "Flip Flops"]
    },
    id: "octopart-123",
    manufacturer: {
      homepageUrl: "https://www.ti.com",
      id: "ti",
      name: "Texas Instruments"
    },
    mpn: "SN74S74N",
    name: "SN74S74N",
    octopartUrl: "https://octopart.com/sn74s74n-texas-instruments-123",
    sellers: [
      {
        company: {
          id: "digikey",
          name: "Digi-Key"
        },
        isAuthorized: true,
        offers: [
          {
            factoryLeadDays: null,
            inventoryLevel: 423,
            moq: 1,
            onOrderQuantity: null,
            orderMultiple: 1,
            packaging: "Cut Tape",
            prices: [
              { convertedCurrency: "USD", convertedPrice: 0.42, currency: "EUR", price: 0.38, quantity: 1 },
              { currency: "USD", price: 0.31, quantity: 100 }
            ],
            sku: "296-6501-1-ND"
          }
        ]
      },
      {
        company: {
          id: "mouser",
          name: "Mouser"
        },
        isAuthorized: true,
        offers: [
          {
            factoryLeadDays: 28,
            inventoryLevel: null,
            moq: 250,
            onOrderQuantity: 1000,
            orderMultiple: 250,
            packaging: "Tube",
            prices: [],
            sku: "595-SN74S74N"
          }
        ]
      }
    ],
    shortDescription: "Dual D-type positive-edge-triggered flip-flops.",
    specs: [
      buildSpec("case_package", "Package / Case", "SOIC-14"),
      buildSpec("lifecycle_status", "Lifecycle Status", "Active"),
      buildSpec("resistance", "Resistance", "10 kOhm"),
      buildSpec("supply_voltage", "Supply Voltage", "5 V"),
      buildSpec("frequency", "Frequency", "25 MHz")
    ]
  };
}

/**
 * Builds one raw Nexar spec fixture.
 */
function buildSpec(shortname: string, name: string, displayValue: string) {
  return {
    attribute: {
      id: shortname,
      name,
      shortname
    },
    displayValue
  };
}

/**
 * Temporarily replaces Octopart/Nexar-related environment variables for one test.
 */
function withOctopartEnv(next: Record<string, string>): () => void {
  const keys = ["NEXAR_ACCESS_TOKEN", "NEXAR_CLIENT_ID", "NEXAR_CLIENT_SECRET", "NEXAR_GRAPHQL_URL", "NEXAR_TOKEN_URL"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(next)) {
    process.env[key] = value;
  }

  resetOctopartProviderAuthCacheForTests();

  return () => {
    for (const key of keys) {
      const value = previous.get(key);

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    resetOctopartProviderAuthCacheForTests();
  };
}

/**
 * Replaces global fetch for one adapter test and returns a restore callback.
 */
function mockFetch(handler: (url: URL, init?: RequestInit) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url, init);
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

/**
 * Reads one header value from a HeadersInit shape.
 */
function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) {
    return null;
  }

  return new Headers(headers).get(name);
}
