/**
 * File header: Tests Edge middleware auth-secret hardening without constructing Next requests.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readSessionSecret } from "./middleware";

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
