/**
 * File header: Tests provider-neutral supply offering snapshot reads and route wiring.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { newDb } from "pg-mem";
import { readPartSupplyOffersFromDatabase, setSupplyOfferPoolForTests } from "./supply-offers";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by supply-offer tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after each test releases it. */
  end: () => Promise<void>;
};

/**
 * Verifies supply-offer reads preserve source provenance, price tiers, summary counts, and freshness.
 */
test("readPartSupplyOffersFromDatabase returns source-linked commercial snapshots", async () => {
  const pool = createSupplyOfferPool();
  setSupplyOfferPoolForTests(pool);

  try {
    await seedSupplyOffers(pool);

    const result = await readPartSupplyOffersFromDatabase("part-alpha");

    assert.equal(result.status, "available");
    if (result.status !== "available") return;

    assert.equal(result.response.state, "available");
    assert.equal(result.response.boundary.includes("not live distributor availability"), true);
    assert.equal(result.response.summary.offerCount, 2);
    assert.equal(result.response.summary.inStockOfferCount, 1);
    assert.equal(result.response.summary.staleOfferCount, 1);
    assert.deepEqual(result.response.summary.lowestUnitPrice, {
      currencyCode: "USD",
      minQuantity: 100,
      offeringId: "offer-alpha-future",
      providerId: "octopart",
      supplierName: "Digi-Key",
      unitPrice: 0.39
    });
    assert.equal(result.response.offers[0]?.sourceRecordId, "source-alpha-future");
    assert.equal(result.response.offers[0]?.sourceUrl, "https://example.test/future");
    assert.equal(result.response.offers[0]?.supplierName, "Digi-Key");
    assert.equal(result.response.offers[0]?.priceBreaks.length, 2);
  } finally {
    setSupplyOfferPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies empty part-scoped supply reads do not invent offers.
 */
test("readPartSupplyOffersFromDatabase returns empty state when no offers exist", async () => {
  const pool = createSupplyOfferPool();
  setSupplyOfferPoolForTests(pool);

  try {
    await seedPart(pool, "part-empty");

    const result = await readPartSupplyOffersFromDatabase("part-empty");

    assert.equal(result.status, "available");
    if (result.status !== "available") return;
    assert.equal(result.response.state, "empty");
    assert.deepEqual(result.response.offers, []);
    assert.equal(result.response.summary.lowestUnitPrice, null);
  } finally {
    setSupplyOfferPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the HTTP route exposes the supply-offer operation and envelope.
 */
test("GET /parts/:partId/supply-offers returns supply snapshots", async () => {
  const pool = createSupplyOfferPool();
  setSupplyOfferPoolForTests(pool);

  try {
    await seedSupplyOffers(pool);

    const { handleRequest } = await import("./index");
    const response = await invokeApiGet("/parts/part-alpha/supply-offers", handleRequest);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["X-EE-Operation"], "api-part-supply-offers");
    assert.equal(response.body.data.partId, "part-alpha");
    assert.equal(response.body.data.offers.length, 2);
  } finally {
    setSupplyOfferPoolForTests(null);
    await pool.end();
  }
});

/**
 * Seeds a part plus one fresh and one stale commercial snapshot.
 */
async function seedSupplyOffers(pool: Pool): Promise<void> {
  await seedPart(pool, "part-alpha");
  await pool.query(`
    INSERT INTO source_records (id, provider_id, provider_part_key, part_id, source_url, fetched_at, raw_payload, normalized_at, source_last_seen_at, source_last_imported_at, import_status, last_updated_at)
    VALUES
      ('source-alpha-future', 'octopart', 'ABC-123', 'part-alpha', 'https://example.test/future', '2099-01-01T00:00:00.000Z', '{"mpn":"ABC"}'::jsonb, '2099-01-01T00:01:00.000Z', '2099-01-02T00:00:00.000Z', '2099-01-02T00:01:00.000Z', 'imported', '2099-01-02T00:01:00.000Z'),
      ('source-alpha-stale', 'local-catalog', 'ABC-LOCAL', 'part-alpha', 'https://example.test/stale', '2020-01-01T00:00:00.000Z', '{"mpn":"ABC"}'::jsonb, '2020-01-01T00:01:00.000Z', '2020-01-02T00:00:00.000Z', '2020-01-02T00:01:00.000Z', 'imported', '2020-01-02T00:01:00.000Z');

    INSERT INTO supply_offerings (
      id,
      part_id,
      provider_id,
      source_record_id,
      provider_part_key,
      supplier_name,
      provider_sku,
      inventory_status,
      inventory_quantity,
      moq,
      lead_time_days,
      packaging,
      currency_code,
      preferred_rank,
      last_seen_at,
      retired_at,
      retirement_reason,
      created_at,
      updated_at
    )
    VALUES
      ('offer-alpha-future', 'part-alpha', 'octopart', 'source-alpha-future', 'ABC-123', 'Digi-Key', 'SKU-123', 'in_stock', 1250, 1, 3, 'Tape and reel', 'USD', 1, '2099-01-02T00:00:00.000Z', NULL, NULL, '2099-01-02T00:00:00.000Z', '2099-01-02T00:00:00.000Z'),
      ('offer-alpha-stale', 'part-alpha', 'local-catalog', 'source-alpha-stale', 'ABC-LOCAL', NULL, NULL, 'unknown', NULL, NULL, NULL, NULL, 'USD', 2, '2020-01-02T00:00:00.000Z', NULL, NULL, '2020-01-02T00:00:00.000Z', '2020-01-02T00:00:00.000Z'),
      ('offer-alpha-retired', 'part-alpha', 'octopart', 'source-alpha-future', 'ABC-123', 'Old Seller', 'OLD-SKU', 'in_stock', 9999, 1, 1, 'Tube', 'USD', 3, '2099-01-02T00:00:00.000Z', '2099-01-03T00:00:00.000Z', 'missing_from_latest_provider_snapshot', '2099-01-02T00:00:00.000Z', '2099-01-03T00:00:00.000Z');

    INSERT INTO price_breaks (id, supply_offering_id, min_quantity, unit_price, currency_code, captured_at)
    VALUES
      ('price-alpha-1', 'offer-alpha-future', 1, 0.55, 'USD', '2099-01-02T00:00:00.000Z'),
      ('price-alpha-100', 'offer-alpha-future', 100, 0.39, 'USD', '2099-01-02T00:00:00.000Z');
  `);
}

/**
 * Seeds the minimum canonical part row needed for supply-offer reads.
 */
async function seedPart(pool: Pool, partId: string): Promise<void> {
  await pool.query("INSERT INTO parts (id) VALUES ($1)", [partId]);
}

/**
 * Creates an in-memory catalog/supply-offer database.
 */
function createSupplyOfferPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE parts (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE source_records (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_part_key TEXT NOT NULL,
      part_id TEXT REFERENCES parts(id),
      source_url TEXT,
      fetched_at TIMESTAMPTZ NOT NULL,
      raw_payload JSONB NOT NULL,
      normalized_at TIMESTAMPTZ,
      source_last_seen_at TIMESTAMPTZ NOT NULL,
      source_last_imported_at TIMESTAMPTZ,
      import_status TEXT NOT NULL DEFAULT 'imported',
      import_error_details TEXT,
      last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE supply_offerings (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL REFERENCES parts(id),
      provider_id TEXT NOT NULL,
      source_record_id TEXT NOT NULL REFERENCES source_records(id),
      provider_part_key TEXT NOT NULL,
      supplier_name TEXT,
      provider_sku TEXT,
      inventory_status TEXT NOT NULL DEFAULT 'unknown',
      inventory_quantity INTEGER,
      moq INTEGER,
      lead_time_days INTEGER,
      packaging TEXT,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      preferred_rank INTEGER,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      retired_at TIMESTAMPTZ,
      retirement_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE price_breaks (
      id TEXT PRIMARY KEY,
      supply_offering_id TEXT NOT NULL REFERENCES supply_offerings(id) ON DELETE CASCADE,
      min_quantity INTEGER NOT NULL,
      unit_price NUMERIC(18, 8) NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const adapter = db.adapters.createPg();
  return new adapter.Pool() as TestPool;
}

/**
 * Invokes the API handler with a tiny in-memory GET request/response pair.
 */
async function invokeApiGet(
  url: string,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const request = Readable.from([]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let responseHeaders: Record<string, string> = {};
  const response = {
    end(payload: string) {
      responseBody = payload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = { host: "localhost" };
  request.method = "GET";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers: responseHeaders,
    statusCode
  };
}
