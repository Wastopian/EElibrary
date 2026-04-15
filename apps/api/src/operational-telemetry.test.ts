/**
 * File header: Tests lightweight API route instrumentation without changing payload truth.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { setCatalogStorePoolForTests } from "./catalog-store";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Verifies search and detail routes expose timing headers while preserving typed payloads.
 */
test("API route instrumentation adds timing headers without changing search and detail payloads", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSeedFallback = process.env.EE_LIBRARY_ALLOW_SEED_FALLBACK;

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_SEED_FALLBACK = "true";
  delete process.env.DATABASE_URL;
  setCatalogStorePoolForTests(null);

  try {
    const { handleRequest } = await import("./index");
    const searchResult = await invokeApiGet("/parts?q=TPS", handleRequest);
    const detailResult = await invokeApiGet("/parts/part-tps7a02dbvr", handleRequest);

    assert.equal(searchResult.statusCode, 200);
    assert.equal(searchResult.body.source, "seed_fallback");
    assert.equal(searchResult.headers["X-EE-Operation"], "api-search");
    assert.match(searchResult.headers["Server-Timing"] ?? "", /api-search;dur=/u);
    assert.match(searchResult.headers["Server-Timing"] ?? "", /catalog-resolve-search;dur=/u);
    assert.match(searchResult.headers["Server-Timing"] ?? "", /search-filter;dur=/u);
    assert.equal(searchResult.body.data.some((record: { part: { mpn: string } }) => record.part.mpn === "TPS7A02DBVR"), true);

    assert.equal(detailResult.statusCode, 200);
    assert.equal(detailResult.body.source, "seed_fallback");
    assert.equal(detailResult.headers["X-EE-Operation"], "api-part-detail");
    assert.match(detailResult.headers["Server-Timing"] ?? "", /api-part-detail;dur=/u);
    assert.match(detailResult.headers["Server-Timing"] ?? "", /catalog-resolve-detail;dur=/u);
    assert.match(detailResult.headers["Server-Timing"] ?? "", /detail-build;dur=/u);
    assert.equal(detailResult.body.data.record.part.mpn, "TPS7A02DBVR");
  } finally {
    setCatalogStorePoolForTests(null);

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    if (previousSeedFallback === undefined) {
      delete process.env.EE_LIBRARY_ALLOW_SEED_FALLBACK;
    } else {
      process.env.EE_LIBRARY_ALLOW_SEED_FALLBACK = previousSeedFallback;
    }
  }
});

/**
 * Invokes the API handler with a tiny in-memory GET request/response pair.
 */
async function invokeApiGet(url: string, handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const request = Readable.from([]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let headers: Record<string, string> = {};
  const response = {
    end(payload: string) {
      responseBody = payload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      headers = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = { host: "localhost" };
  request.method = "GET";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers,
    statusCode
  };
}
