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
  process.env.AUTH_SECRET = "lookup-test-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createConnectedPoolStub());
  setProviderPartLookupRunnerForTests(async () => ({
    candidates: [
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
    ],
    failures: []
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost("/provider-lookups", { query: "C1091" }, handleRequest);

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["X-EE-Operation"], "api-provider-lookup");
    assert.equal(Array.isArray(result.body.data.candidates), true);
    assert.equal(result.body.data.candidates[0]?.providerPartKey, "C1091");
    assert.equal(result.body.data.candidates[0]?.matchType, "exact_provider_part_id");
    assert.equal(result.body.data.candidates[0]?.matchConfidence, 1);
    assert.equal(result.body.data.candidates[0]?.importAllowed, false);
    assert.deepEqual(result.body.data.providerFailures, []);
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
  process.env.AUTH_SECRET = "lookup-test-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createConnectedPoolStub());
  setProviderPartLookupRunnerForTests(async () => ({
    candidates: [
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
    ],
    failures: []
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost(
      "/provider-lookups",
      { query: "TPS7A02DBVR" },
      handleRequest,
      { authorization: await createBearerToken("lookup-test-secret-padded-to-thirty-two-bytes-min", "admin") }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.candidates[0]?.providerId, "local-catalog");
    assert.equal(result.body.data.candidates[0]?.importAllowed, true);
  } finally {
    setCatalogStorePoolForTests(null);
    setProviderPartLookupRunnerForTests(null);
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

test("POST /provider-lookups still answers with working-provider candidates and calm notes when one provider fails", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_SECRET = "lookup-test-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createConnectedPoolStub());
  setProviderPartLookupRunnerForTests(async () => ({
    candidates: [
      {
        manufacturerName: "Guangdong Fenghua Advanced Tech",
        matchConfidence: 1,
        matchType: "exact_provider_part_id",
        mpn: "RC-02W300JT",
        package: "0402",
        providerId: "jlcparts",
        providerPartKey: "C1091",
        sourceUrl: null
      }
    ],
    failures: [
      {
        message: "Unable to fetch DigiKey access token (401)",
        providerId: "digikey",
        providerName: "DigiKey"
      }
    ]
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost("/provider-lookups", { query: "RC-02W300JT" }, handleRequest);

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.candidates.length, 1);
    assert.equal(result.body.data.candidates[0]?.providerId, "jlcparts");
    assert.equal(result.body.data.providerFailures.length, 1);
    assert.equal(result.body.data.providerFailures[0]?.providerId, "digikey");
    assert.equal(result.body.data.providerFailures[0]?.providerName, "DigiKey");
    assert.equal(result.body.data.providerFailures[0]?.message, "DigiKey did not answer — check credentials.");
  } finally {
    setCatalogStorePoolForTests(null);
    setProviderPartLookupRunnerForTests(null);
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

test("POST /provider-lookups keeps an all-failure lookup honest instead of reading as not found anywhere", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_SECRET = "lookup-test-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createConnectedPoolStub());
  setProviderPartLookupRunnerForTests(async () => ({
    candidates: [],
    failures: [
      {
        message: "Unable to fetch Mouser response (503)",
        providerId: "mouser",
        providerName: "Mouser"
      }
    ]
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost("/provider-lookups", { query: "RC-02W300JT" }, handleRequest);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.data.candidates, []);
    assert.equal(result.body.data.providerFailures[0]?.message, "Mouser did not answer — check network access and try again.");
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
