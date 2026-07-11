/**
 * File header: Tests the provider import HTTP route with a stubbed worker runner.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { SignJWT } from "jose";
import { setCatalogStorePoolForTests } from "./catalog-store";
import { setProviderImportRunnerForTests } from "./provider-import-runner";
import type { IncomingMessage, ServerResponse } from "node:http";

test("POST /imports/provider returns 400 for invalid bodies", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(null);

  try {
    const { handleRequest } = await import("./index");
    const nullBody = await invokeApiPost("/imports/provider", null, handleRequest);

    assert.equal(nullBody.statusCode, 400);
    assert.equal(nullBody.body.error.code, "INVALID_BODY");

    const missingLookup = await invokeApiPost("/imports/provider", { mpn: "", providerId: "jlcparts" }, handleRequest);

    assert.equal(missingLookup.statusCode, 400);
    assert.equal(missingLookup.body.error.code, "MISSING_LOOKUP");
  } finally {
    setCatalogStorePoolForTests(null);
    setProviderImportRunnerForTests(null);

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test("POST /imports/provider returns catalog envelope on successful import", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(null);
  setProviderImportRunnerForTests(async () => ({
    durationMs: 1,
    importStatus: "imported",
    outcome: "new_import",
    partId: "part-jlcparts-c1091",
    previousImportStatus: null,
    providerId: "jlcparts",
    providerPartKey: "C1091",
    requestedLookup: "C1091",
    sourceLastImportedAt: "2026-04-15T00:00:00.000Z",
    sourceLastSeenAt: "2026-04-15T00:00:00.000Z",
    timings: []
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost(
      "/imports/provider",
      { mpn: "RC-02W300JT", providerId: "jlcparts" },
      handleRequest
    );

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["X-EE-Operation"], "api-provider-import");
    assert.equal(result.body.source, "database");
    assert.equal(result.body.data.partId, "part-jlcparts-c1091");
    assert.equal(result.body.data.importStatus, "imported");
  } finally {
    setCatalogStorePoolForTests(null);
    setProviderImportRunnerForTests(null);

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test("POST /imports/provider runs the import in the authenticated admin org", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const authSecret = "provider-import-route-secret-padded-to-thirty-two-bytes";
  let capturedOrgId: string | null = null;

  process.env.AUTH_SECRET = authSecret;
  process.env.NODE_ENV = "test";
  delete process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  setCatalogStorePoolForTests(null);
  setProviderImportRunnerForTests(async (_adapterId, _request, orgId) => {
    capturedOrgId = orgId;

    return {
      durationMs: 1,
      importStatus: "imported",
      outcome: "new_import",
      partId: "part-jlcparts-c1091",
      previousImportStatus: null,
      providerId: "jlcparts",
      providerPartKey: "C1091",
      requestedLookup: "C1091",
      sourceLastImportedAt: "2026-04-15T00:00:00.000Z",
      sourceLastSeenAt: "2026-04-15T00:00:00.000Z",
      timings: []
    };
  });

  try {
    const { handleRequest } = await import("./index");
    const token = await createBearerToken(authSecret, "admin", "org-acme");
    const result = await invokeApiPost(
      "/imports/provider",
      { mpn: "RC-02W300JT", providerId: "jlcparts" },
      handleRequest,
      { authorization: `Bearer ${token}` }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(capturedOrgId, "org-acme");
  } finally {
    setCatalogStorePoolForTests(null);
    setProviderImportRunnerForTests(null);
    restoreEnv(previousAuthSecret, previousNodeEnv, previousTestAuth);
  }
});

test("POST /imports/provider returns 422 with calm copy when import fails", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(null);
  setProviderImportRunnerForTests(async () => {
    throw new Error("jlcparts metadata record not found for MISSING");
  });

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost("/imports/provider", { mpn: "MISSING", providerId: "jlcparts" }, handleRequest);

    assert.equal(result.statusCode, 422);
    assert.equal(result.body.error.code, "PROVIDER_IMPORT_FAILED");
    assert.match(result.body.error.message, /No matching catalog entry/u);
  } finally {
    setCatalogStorePoolForTests(null);
    setProviderImportRunnerForTests(null);

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

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
  let headers: Record<string, string> = {};
  const response = {
    end(nextPayload: string) {
      responseBody = nextPayload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      headers = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = { "content-type": "application/json", host: "localhost", ...headers };
  request.method = "POST";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers,
    statusCode
  };
}

/**
 * Mints a test bearer token with an explicit tenant claim.
 */
async function createBearerToken(secret: string, role: "admin" | "user", orgId: string): Promise<string> {
  const jwt = await new SignJWT({ role, orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`test-${role}`)
    .setIssuedAt()
    .sign(new TextEncoder().encode(secret));

  return jwt;
}

function restoreEnv(
  previousAuthSecret: string | undefined,
  previousNodeEnv: string | undefined,
  previousTestAuth: string | undefined
): void {
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

  if (previousTestAuth === undefined) {
    delete process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  } else {
    process.env.EE_LIBRARY_ALLOW_TEST_AUTH = previousTestAuth;
  }
}
