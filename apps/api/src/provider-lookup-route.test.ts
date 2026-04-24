/**
 * File header: Tests the explicit provider lookup HTTP route with stubbed worker lookup results.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { SignJWT } from "jose";
import { setCatalogStorePoolForTests } from "./catalog-store";
import { setProviderPartLookupRunnerForTests } from "./provider-lookup-runner";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

test("POST /provider-lookups returns exact candidates with importAllowed false for anonymous requests", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_SECRET = "lookup-test-secret";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createConnectedPoolStub());
  setProviderPartLookupRunnerForTests(async () => [
    {
      manufacturerName: "Guangdong Fenghua Advanced Tech",
      matchConfidence: 1,
      matchType: "exact_provider_part_id",
      mpn: "RC-02W300JT",
      package: "0402",
      providerId: "jlcparts",
      providerPartKey: "C1091",
      sourceUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
    }
  ]);

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost("/provider-lookups", { query: "C1091" }, handleRequest);

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["X-EE-Operation"], "api-provider-lookup");
    assert.equal(Array.isArray(result.body.data), true);
    assert.equal(result.body.data[0]?.providerPartKey, "C1091");
    assert.equal(result.body.data[0]?.matchType, "exact_provider_part_id");
    assert.equal(result.body.data[0]?.matchConfidence, 1);
    assert.equal(result.body.data[0]?.importAllowed, false);
    assert.equal("source" in result.body, false);
  } finally {
    setCatalogStorePoolForTests(null);
    setProviderPartLookupRunnerForTests(null);
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

test("POST /provider-lookups returns importAllowed true for authenticated admin requests", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_SECRET = "lookup-test-secret";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createConnectedPoolStub());
  setProviderPartLookupRunnerForTests(async () => [
    {
      manufacturerName: "Texas Instruments",
      matchConfidence: 1,
      matchType: "exact_mpn",
      mpn: "TPS7A02DBVR",
      package: "SOT-23-5",
      providerId: "local-catalog",
      providerPartKey: "TPS7A02DBVR",
      sourceUrl: "https://www.ti.com/product/TPS7A02"
    }
  ]);

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost(
      "/provider-lookups",
      { query: "TPS7A02DBVR" },
      handleRequest,
      { authorization: await createBearerToken("lookup-test-secret", "admin") }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data[0]?.providerId, "local-catalog");
    assert.equal(result.body.data[0]?.importAllowed, true);
  } finally {
    setCatalogStorePoolForTests(null);
    setProviderPartLookupRunnerForTests(null);
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

/**
 * Invokes one POST API route through the real request handler.
 */
async function invokeApiPost(
  url: string,
  body: unknown,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const payload = JSON.stringify(body);
  const request = Readable.from([payload]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let responseHeaders: Record<string, string> = {};
  const response = {
    end(nextPayload: string) {
      responseBody = nextPayload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = { "content-type": "application/json", host: "localhost", ...headers };
  request.method = "POST";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Creates a connected-pool stub for route tests that only need database health to read as connected.
 */
function createConnectedPoolStub(): Pool {
  return {
    query: async () => ({ rows: [] })
  } as unknown as Pool;
}

/**
 * Creates a real HS256 bearer token so optional-session lookup can verify admin access without test-only auth bypasses.
 */
async function createBearerToken(secret: string, role: "admin" | "user"): Promise<string> {
  const jwt = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`test-${role}`)
    .sign(new TextEncoder().encode(secret));

  return `Bearer ${jwt}`;
}

/**
 * Restores environment variables touched by these route tests.
 */
function restoreEnv(previousAuthSecret: string | undefined, previousNodeEnv: string | undefined): void {
  if (previousAuthSecret === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = previousAuthSecret;
  }

  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
}
