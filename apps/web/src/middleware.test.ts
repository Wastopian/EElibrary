/**
 * File header: Tests middleware secret validation and live-role authorization with signed cookies.
 */

import assert from "node:assert/strict";
import test from "node:test";
import middleware, { readSessionSecret, shouldPreserveIncomingBearer } from "./middleware";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { jwtVerify } from "jose";
import { Pool } from "pg";

const STRONG_SECRET = "session-secret-padded-to-thirty-two-bytes";

/**
 * Verifies the route guard uses the same fail-closed secret floor as API bearer tokens.
 */
test("readSessionSecret refuses missing, empty, and short AUTH_SECRET values", () => {
  assert.equal(readSessionSecret({}), null);
  assert.equal(readSessionSecret({ AUTH_SECRET: "" }), null);
  assert.equal(readSessionSecret({ AUTH_SECRET: "too-short" }), null);
});

/**
 * Verifies a weak AUTH_SECRET is not hidden by a stronger legacy fallback.
 */
test("readSessionSecret does not fall back when AUTH_SECRET is explicitly weak", () => {
  assert.equal(readSessionSecret({ AUTH_SECRET: "too-short", NEXTAUTH_SECRET: STRONG_SECRET }), null);
});

/**
 * Verifies strong current and legacy secrets remain supported.
 */
test("readSessionSecret accepts strong AUTH_SECRET or legacy NEXTAUTH_SECRET", () => {
  assert.equal(readSessionSecret({ AUTH_SECRET: STRONG_SECRET }), STRONG_SECRET);
  assert.equal(readSessionSecret({ NEXTAUTH_SECRET: STRONG_SECRET }), STRONG_SECRET);
});

/**
 * Regression: api-client attaches a Bearer from /api/token (live DB role). The proxy must not
 * overwrite it with the stale cookie claim after an admin demotes the member.
 */
test("shouldPreserveIncomingBearer keeps client-minted API tokens", () => {
  assert.equal(shouldPreserveIncomingBearer("Bearer live-role-token"), true);
  assert.equal(shouldPreserveIncomingBearer("Bearer  spaced-ok"), true);
  assert.equal(shouldPreserveIncomingBearer(null), false);
  assert.equal(shouldPreserveIncomingBearer(""), false);
  assert.equal(shouldPreserveIncomingBearer("Basic nope"), false);
  assert.equal(shouldPreserveIncomingBearer("Bearer"), false);
  assert.equal(shouldPreserveIncomingBearer("Bearer "), false);
});

/** Signed stale cookies must never restore an old role through direct API links or admin routes. */
test("middleware uses the live role and fails closed for deleted accounts and database errors", async (context) => {
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = STRONG_SECRET;
  let rows: string[][] = [["org-current", "user"]];
  let databaseUnavailable = false;
  context.mock.method(Pool.prototype, "query", async () => {
    if (databaseUnavailable) throw new Error("Database unavailable");
    // Drizzle requests array-mode rows in the selected org_id, role order.
    return { rows };
  });
  try {
    const cookie = await encode({
      secret: STRONG_SECRET,
      salt: "authjs.session-token",
      token: { sub: "member-1", role: "admin", orgId: "org-old" }
    });
    const request = (path: string) => new NextRequest(`http://localhost:3000${path}`, {
      headers: { cookie: `authjs.session-token=${cookie}` }
    });
    const proxy = await middleware(request("/api-proxy/storage/example.pdf"));
    const authorization = proxy.headers.get("x-middleware-request-authorization");
    assert.ok(authorization);
    assert.ok(authorization.startsWith("Bearer "));
    const { payload } = await jwtVerify(authorization.slice(7), new TextEncoder().encode(STRONG_SECRET));
    assert.equal(payload.role, "user");
    assert.equal(payload.orgId, "org-current");
    assert.equal((await middleware(request("/admin"))).headers.get("location"), "http://localhost:3000/");

    rows = [];
    assert.equal((await middleware(request("/api-proxy/projects"))).status, 401);
    databaseUnavailable = true;
    assert.equal((await middleware(request("/api-proxy/projects"))).status, 503);
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});
