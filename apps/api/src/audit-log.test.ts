/**
 * File header: Tests audit-log helper utilities — context construction, payload bounding,
 * and recording resilience. Reading and writing against a real database is covered by the
 * route smoke tests; the helper tests here are pure-function focused.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { __resetAuditPoolForTests, buildAuditContextFromRequest, recordAuditEvent } from "./audit-log";

/**
 * Constructs a minimal IncomingMessage suitable for header-based context tests.
 */
function makeRequest(headers: Record<string, string | string[]>, url = "/projects", remoteAddress = "10.0.0.5"): IncomingMessage {
  const socket = new Socket();
  // Pretend the socket has a remote address so context can fall back to it.
  Object.defineProperty(socket, "remoteAddress", { value: remoteAddress, configurable: true });
  const request = new IncomingMessage(socket);
  request.url = url;
  for (const [key, value] of Object.entries(headers)) {
    request.headers[key.toLowerCase()] = value;
  }
  return request;
}

test("buildAuditContextFromRequest reads identity from the verified session, not headers", () => {
  const request = makeRequest({
    "x-actor-user-id": "spoofed-user",
    "x-actor-email": "spoofed@example.com",
    "x-actor-role": "admin",
    "x-request-id": "req-123",
    "user-agent": "test-agent/1.0"
  });

  const context = buildAuditContextFromRequest(request, { sub: "real-user", role: "user" });

  assert.equal(context.actorUserId, "real-user");
  assert.equal(context.actorRole, "user");
  // Email is intentionally NOT trusted from headers — only the session is honored.
  assert.equal(context.actorEmail, undefined);
  assert.equal(context.requestId, "req-123");
  assert.equal(context.actorUserAgent, "test-agent/1.0");
  assert.equal(context.actorIp, "10.0.0.5");
  assert.equal(context.route, "/projects");
});

test("buildAuditContextFromRequest reads forwarded IP when X-Forwarded-For is present", () => {
  const request = makeRequest({
    "x-forwarded-for": "203.0.113.7, 10.0.0.5"
  });

  const context = buildAuditContextFromRequest(request, null);

  assert.equal(context.actorIp, "203.0.113.7");
});

test("buildAuditContextFromRequest produces an anonymous context when session is null", () => {
  const request = makeRequest({});
  const context = buildAuditContextFromRequest(request, null);

  assert.equal(context.actorUserId, undefined);
  assert.equal(context.actorRole, undefined);
  assert.equal(context.actorEmail, undefined);
});

test("recordAuditEvent never throws when DATABASE_URL is missing", async () => {
  const previous = process.env["DATABASE_URL"];
  delete process.env["DATABASE_URL"];
  __resetAuditPoolForTests();

  try {
    // Should resolve, not throw, even though there is no pool to write to.
    await recordAuditEvent(
      { actorEmail: "alice@example.com" },
      {
        action: "project.create",
        entityType: "project",
        entityId: "proj-test",
        resultStatus: "success"
      }
    );
  } finally {
    if (previous !== undefined) {
      process.env["DATABASE_URL"] = previous;
    }
    __resetAuditPoolForTests();
  }
});
