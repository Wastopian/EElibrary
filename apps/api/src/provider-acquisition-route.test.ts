/**
 * File header: Tests the provider acquisition job HTTP routes against an in-memory Postgres adapter.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { SignJWT } from "jose";
import { newDb } from "pg-mem";
import { setCatalogStorePoolForTests } from "./catalog-store";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by provider acquisition route tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the route test releases it. */
  end: () => Promise<void>;
};

test("POST /provider-acquisition-jobs requires admin auth outside the test-session shortcut", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const pool = createProviderAcquisitionPool();
  process.env.AUTH_SECRET = "acquisition-route-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(pool);

  try {
    const { handleRequest } = await import("./index");
    process.env.NODE_ENV = "production";
    const result = await invokeApiRequest("/provider-acquisition-jobs", "POST", buildProviderAcquisitionBody(), handleRequest);

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error.code, "UNAUTHORIZED");
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

test("GET /provider-acquisition-jobs/:jobId requires admin auth outside the test-session shortcut", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const pool = createProviderAcquisitionPool();
  process.env.AUTH_SECRET = "acquisition-route-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(pool);

  try {
    const { handleRequest } = await import("./index");
    process.env.NODE_ENV = "production";
    const result = await invokeApiRequest("/provider-acquisition-jobs/acqjob-jlcparts-c1091", "GET", undefined, handleRequest);

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error.code, "UNAUTHORIZED");
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

test("POST /provider-acquisition-jobs returns DB_NOT_CONFIGURED honestly", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_SECRET = "acquisition-route-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(null);

  try {
    const { handleRequest } = await import("./index");
    process.env.NODE_ENV = "production";
    const result = await invokeApiRequest(
      "/provider-acquisition-jobs",
      "POST",
      buildProviderAcquisitionBody(),
      handleRequest,
      { authorization: await createBearerToken("acquisition-route-secret-padded-to-thirty-two-bytes-min", "admin") }
    );

    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.code, "DB_NOT_CONFIGURED");
  } finally {
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

test("POST /provider-acquisition-jobs persists one queued job and queued event", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const pool = createProviderAcquisitionPool();
  process.env.AUTH_SECRET = "acquisition-route-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(pool);

  try {
    const { handleRequest } = await import("./index");
    process.env.NODE_ENV = "production";
    const result = await invokeApiRequest(
      "/provider-acquisition-jobs",
      "POST",
      buildProviderAcquisitionBody(),
      handleRequest,
      { authorization: await createBearerToken("acquisition-route-secret-padded-to-thirty-two-bytes-min", "admin") }
    );
    const jobRows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM provider_acquisition_jobs");
    const eventRows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM provider_acquisition_job_events");

    assert.equal(result.statusCode, 202);
    assert.equal(result.headers["X-EE-Operation"], "api-provider-acquisition-job-create");
    assert.equal(result.body.source, "database");
    assert.equal(result.body.data.job.jobStatus, "queued");
    assert.equal(result.body.data.events[0]?.eventType, "queued");
    assert.equal(jobRows.rows[0]?.count, "1");
    assert.equal(eventRows.rows[0]?.count, "1");
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

test("POST /provider-acquisition-jobs dedupes active jobs for the same provider key", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const pool = createProviderAcquisitionPool();
  process.env.AUTH_SECRET = "acquisition-route-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(pool);

  try {
    const { handleRequest } = await import("./index");
    process.env.NODE_ENV = "production";
    const headers = { authorization: await createBearerToken("acquisition-route-secret-padded-to-thirty-two-bytes-min", "admin") };
    const first = await invokeApiRequest("/provider-acquisition-jobs", "POST", buildProviderAcquisitionBody(), handleRequest, headers);
    const second = await invokeApiRequest("/provider-acquisition-jobs", "POST", buildProviderAcquisitionBody(), handleRequest, headers);
    const jobRows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM provider_acquisition_jobs");
    const eventRows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM provider_acquisition_job_events");

    assert.equal(first.body.data.job.id, second.body.data.job.id);
    assert.equal(jobRows.rows[0]?.count, "1");
    assert.equal(eventRows.rows[0]?.count, "1");
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

test("GET /provider-acquisition-jobs/:jobId returns the job and events", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const pool = createProviderAcquisitionPool();
  process.env.AUTH_SECRET = "acquisition-route-secret-padded-to-thirty-two-bytes-min";
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(pool);

  try {
    const { handleRequest } = await import("./index");
    process.env.NODE_ENV = "production";
    const headers = { authorization: await createBearerToken("acquisition-route-secret-padded-to-thirty-two-bytes-min", "admin") };
    const created = await invokeApiRequest("/provider-acquisition-jobs", "POST", buildProviderAcquisitionBody(), handleRequest, headers);
    const jobId = created.body.data.job.id as string;
    const read = await invokeApiRequest(`/provider-acquisition-jobs/${jobId}`, "GET", undefined, handleRequest, headers);

    assert.equal(read.statusCode, 200);
    assert.equal(read.headers["X-EE-Operation"], "api-provider-acquisition-job-read");
    assert.equal(read.body.data.job.id, jobId);
    assert.equal(read.body.data.events.length, 1);
    assert.equal(read.body.data.events[0]?.eventType, "queued");
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

/**
 * Invokes one real API route with a small JSON or empty request body.
 */
async function invokeApiRequest(
  url: string,
  method: "GET" | "POST",
  body: unknown,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const request = Readable.from(payload ? [payload] : []) as IncomingMessage;
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
  request.method = method;
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Builds one exact-match provider candidate body for acquisition route tests.
 */
function buildProviderAcquisitionBody() {
  return {
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    matchConfidence: 1,
    matchType: "exact_provider_part_id",
    mpn: "RC-02W300JT",
    package: "0402",
    providerId: "jlcparts",
    providerPartKey: "C1091",
    requestedLookup: "RC-02W300JT",
    sourceUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
  };
}

/**
 * Creates a minimal in-memory schema for provider acquisition route persistence tests.
 */
function createProviderAcquisitionPool(): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE parts (id TEXT PRIMARY KEY);
    CREATE TABLE provider_acquisition_jobs (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_part_key TEXT NOT NULL,
      requested_lookup TEXT NOT NULL,
      manufacturer_name TEXT,
      mpn TEXT,
      package_name TEXT,
      source_url TEXT,
      match_type TEXT NOT NULL,
      match_confidence NUMERIC NOT NULL,
      job_status TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL,
      part_id TEXT REFERENCES parts(id),
      import_outcome TEXT,
      previous_import_status TEXT,
      error_code TEXT,
      error_message TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE provider_acquisition_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES provider_acquisition_jobs(id),
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      detail JSONB,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE UNIQUE INDEX uq_provider_acquisition_jobs_active_provider_part
      ON provider_acquisition_jobs (provider_id, provider_part_key)
      WHERE job_status IN ('queued', 'running');
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Creates a real HS256 bearer token so admin-only route behavior can be tested without shortcuts.
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
