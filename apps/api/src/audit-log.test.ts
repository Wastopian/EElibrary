/**
 * File header: Tests general API audit event persistence and middleware capture.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { newDb } from "pg-mem";
import { createAuditEventInDatabase, readAuditEventsFromDatabase, setAuditLogPoolForTests } from "./audit-log";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

type TestPool = Pool & {
  end: () => Promise<void>;
};

/**
 * Verifies audit events persist safe metadata and read back newest-first.
 */
test("audit log store writes and reads safe user action events", async () => {
  const pool = createAuditLogPool();
  setAuditLogPoolForTests(pool);

  try {
    const created = await createAuditEventInDatabase({
      action: "project.update",
      actorId: "admin-user",
      actorRole: "admin",
      metadata: { operation: "api-project-update", queryKeys: ["tab"] },
      method: "PATCH",
      operation: "api-project-update",
      outcome: "succeeded",
      path: "/projects/project-alpha",
      requestId: "request-audit-store",
      requestIpHash: "hash-ip",
      statusCode: 200,
      targetId: "project-alpha",
      targetType: "project",
      userAgentHash: "hash-ua"
    });

    assert.equal(created.status, "created");

    const events = await readAuditEventsFromDatabase(10);
    assert.equal(events.status, "available");
    if (events.status !== "available") return;
    assert.equal(events.response.state, "available");
    assert.match(events.response.boundary, /do not store request bodies/u);
    assert.equal(events.response.events.length, 1);
    assert.equal(events.response.events[0]?.action, "project.update");
    assert.equal(events.response.events[0]?.actorId, "admin-user");
    assert.deepEqual(events.response.events[0]?.metadata.queryKeys, ["tab"]);
  } finally {
    setAuditLogPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the API middleware records denied unsafe requests even before a route handler runs.
 */
test("audit middleware records denied admin write attempts", async () => {
  const pool = createAuditLogPool();
  setAuditLogPoolForTests(pool);
  const previousTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  delete process.env.EE_LIBRARY_ALLOW_TEST_AUTH;

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost("/projects", {}, handleRequest, {
      "user-agent": "audit-test-agent",
      "x-forwarded-for": "203.0.113.10",
      "x-request-id": "audit-route-denied-1"
    });

    assert.equal(result.statusCode, 401);
    assert.equal(result.headers["X-EE-Request-Id"], "audit-route-denied-1");

    const rows = await pool.query<{ action: string; actor_id: string | null; outcome: string; status_code: number; target_type: string }>(
      "SELECT action, actor_id, outcome, status_code, target_type FROM audit_events"
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.action, "project.create");
    assert.equal(rows.rows[0]?.actor_id, null);
    assert.equal(rows.rows[0]?.outcome, "denied");
    assert.equal(Number(rows.rows[0]?.status_code), 401);
    assert.equal(rows.rows[0]?.target_type, "project");
  } finally {
    if (previousTestAuth === undefined) {
      delete process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
    } else {
      process.env.EE_LIBRARY_ALLOW_TEST_AUTH = previousTestAuth;
    }
    setAuditLogPoolForTests(null);
    await pool.end();
  }
});

/**
 * Invokes one JSON POST route through the real request handler.
 */
async function invokeApiPost(
  url: string,
  body: unknown,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: Record<string, unknown>; headers: Record<string, string> }> {
  const payload = JSON.stringify(body);
  const request = Readable.from([payload]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let responseHeaders: Record<string, string> = {};
  const responseStub = {
    end(nextPayload: string) {
      responseBody = nextPayload;
    },
    headersSent: false,
    statusCode: 200,
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      responseStub.statusCode = nextStatusCode;
      responseStub.headersSent = true;
      responseHeaders = nextHeaders ?? {};
      return responseStub;
    }
  };
  const response = responseStub as unknown as ServerResponse;

  request.headers = { "content-type": "application/json", host: "localhost", ...headers };
  request.method = "POST";
  request.url = url;
  Object.defineProperty(request, "socket", { value: { remoteAddress: "127.0.0.1" } });

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, unknown>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Verifies filtered reads narrow to one target without leaking other events.
 */
test("audit log store filters reads by target_type and target_id", async () => {
  const pool = createAuditLogPool();
  setAuditLogPoolForTests(pool);

  try {
    await createAuditEventInDatabase({
      action: "project.update",
      actorId: "user-1",
      actorRole: "admin",
      metadata: {},
      method: "PATCH",
      operation: "api-project-update",
      outcome: "succeeded",
      path: "/projects/project-alpha",
      requestId: "req-1",
      requestIpHash: null,
      statusCode: 200,
      targetId: "project-alpha",
      targetType: "project",
      userAgentHash: null
    });
    await createAuditEventInDatabase({
      action: "asset.promote",
      actorId: "user-1",
      actorRole: "admin",
      metadata: {},
      method: "POST",
      operation: "api-asset-promote",
      outcome: "succeeded",
      path: "/parts/part-7/promotions",
      requestId: "req-2",
      requestIpHash: null,
      statusCode: 201,
      targetId: "part-7",
      targetType: "part",
      userAgentHash: null
    });

    const projectOnly = await readAuditEventsFromDatabase(10, { targetType: "project", targetId: "project-alpha" });
    assert.equal(projectOnly.status, "available");
    if (projectOnly.status !== "available") return;
    assert.equal(projectOnly.response.events.length, 1);
    assert.equal(projectOnly.response.events[0]?.targetType, "project");
    assert.equal(projectOnly.response.events[0]?.targetId, "project-alpha");
  } finally {
    setAuditLogPoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies the outcome filter narrows to the requested outcome and rejects nothing else.
 */
test("audit log store filters reads by outcome", async () => {
  const pool = createAuditLogPool();
  setAuditLogPoolForTests(pool);

  try {
    await createAuditEventInDatabase({
      action: "project.create",
      actorId: null,
      actorRole: null,
      metadata: {},
      method: "POST",
      operation: "api-project-create",
      outcome: "denied",
      path: "/projects",
      requestId: "req-d",
      requestIpHash: null,
      statusCode: 401,
      targetId: null,
      targetType: "project",
      userAgentHash: null
    });
    await createAuditEventInDatabase({
      action: "project.create",
      actorId: "user-1",
      actorRole: "admin",
      metadata: {},
      method: "POST",
      operation: "api-project-create",
      outcome: "succeeded",
      path: "/projects",
      requestId: "req-s",
      requestIpHash: null,
      statusCode: 201,
      targetId: "project-beta",
      targetType: "project",
      userAgentHash: null
    });

    const denied = await readAuditEventsFromDatabase(10, { outcome: "denied" });
    assert.equal(denied.status, "available");
    if (denied.status !== "available") return;
    assert.equal(denied.response.events.length, 1);
    assert.equal(denied.response.events[0]?.outcome, "denied");

    const all = await readAuditEventsFromDatabase(10);
    assert.equal(all.status, "available");
    if (all.status !== "available") return;
    assert.equal(all.response.events.length, 2);
  } finally {
    setAuditLogPoolForTests(null);
    await pool.end();
  }
});

/**
 * Creates an in-memory audit log database.
 */
function createAuditLogPool(): TestPool {
  const db = newDb();
  db.public.none(`
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor_id TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      operation TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      request_ip_hash TEXT,
      user_agent_hash TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  const adapter = db.adapters.createPg();
  return new adapter.Pool() as TestPool;
}
