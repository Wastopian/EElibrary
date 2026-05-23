/**
 * File header: Tests the API authorization chokepoint. requirePermission must grant or deny by the
 * actor's role per the shared role/permission policy, and requireAdmin must stay admin-only. These
 * run with the test-session shortcut disabled (NODE_ENV=production + no opt-in) so real token roles
 * are exercised rather than the deterministic test admin.
 */

import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import { SignJWT } from "jose";
import type { AppRole } from "@ee-library/shared/types";
import { isAuthError, requireAdmin, requirePermission } from "./auth";

const STRONG_SECRET = "auth-secret-padded-to-thirty-two-bytes-and-then-some";

/** Mints a real HS256 token for the given role signed against STRONG_SECRET. */
async function mintToken(role: AppRole): Promise<string> {
  const key = new TextEncoder().encode(STRONG_SECRET);

  return await new SignJWT({ sub: `user-${role}`, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

/** Builds a minimal request carrying a bearer token (or none). */
function requestWithToken(token: string | null): IncomingMessage {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return { headers } as unknown as IncomingMessage;
}

/** Runs body with the test-session shortcut disabled and a strong secret configured. */
function withRealAuth<T>(body: () => Promise<T>): Promise<T> {
  const previous = {
    AUTH_SECRET: process.env["AUTH_SECRET"],
    NODE_ENV: process.env.NODE_ENV,
    EE_LIBRARY_ALLOW_TEST_AUTH: process.env["EE_LIBRARY_ALLOW_TEST_AUTH"]
  };

  process.env["AUTH_SECRET"] = STRONG_SECRET;
  process.env.NODE_ENV = "production";
  delete process.env["EE_LIBRARY_ALLOW_TEST_AUTH"];

  return body().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("requirePermission grants when the role holds the capability", async () => {
  await withRealAuth(async () => {
    const result = await requirePermission(requestWithToken(await mintToken("viewer")), "catalog.read");

    assert.equal(isAuthError(result), false, "viewer should be allowed to read the catalog");
    assert.equal(isAuthError(result) ? null : result.role, "viewer");
  });
});

test("requirePermission denies with 403 when the role lacks the capability", async () => {
  await withRealAuth(async () => {
    const result = await requirePermission(requestWithToken(await mintToken("viewer")), "project.write");

    assert.equal(isAuthError(result), true, "viewer must not be able to write project memory");
    assert.equal(isAuthError(result) ? result.statusCode : null, 403);
    assert.equal(isAuthError(result) ? result.code : null, "FORBIDDEN");
  });
});

test("requirePermission lets a contributor write but not approve", async () => {
  await withRealAuth(async () => {
    const writeResult = await requirePermission(requestWithToken(await mintToken("contributor")), "project.write");
    const approveResult = await requirePermission(requestWithToken(await mintToken("contributor")), "part.approve");

    assert.equal(isAuthError(writeResult), false, "contributor should write project memory");
    assert.equal(isAuthError(approveResult), true, "contributor must not approve parts");
  });
});

test("requirePermission lets an approver approve but not administer", async () => {
  await withRealAuth(async () => {
    const approveResult = await requirePermission(requestWithToken(await mintToken("approver")), "part.approve");
    const adminResult = await requirePermission(requestWithToken(await mintToken("approver")), "governance.admin");

    assert.equal(isAuthError(approveResult), false, "approver should approve parts");
    assert.equal(isAuthError(adminResult), true, "approver must not hold governance.admin");
  });
});

test("requirePermission returns 401 when no token is present", async () => {
  await withRealAuth(async () => {
    const result = await requirePermission(requestWithToken(null), "catalog.read");

    assert.equal(isAuthError(result) ? result.statusCode : null, 401);
    assert.equal(isAuthError(result) ? result.code : null, "UNAUTHORIZED");
  });
});

test("requireAdmin stays admin-only and keeps its operator message", async () => {
  await withRealAuth(async () => {
    for (const role of ["viewer", "contributor", "approver", "user"] as AppRole[]) {
      const denied = await requireAdmin(requestWithToken(await mintToken(role)));
      assert.equal(isAuthError(denied) ? denied.statusCode : null, 403, `${role} must be denied admin`);
      assert.equal(isAuthError(denied) ? denied.message : null, "Admin role is required for this operation.");
    }

    const allowed = await requireAdmin(requestWithToken(await mintToken("admin")));
    assert.equal(isAuthError(allowed), false, "admin should pass requireAdmin");
  });
});
