/**
 * File header: Tests AUTH_SECRET hardening — empty/too-short secrets must fail closed,
 * the test-mode admin shortcut must require an explicit opt-in, and the boot-time check
 * must throw on misconfiguration. The previous `?? ""` fallback would accept HS256 tokens
 * forged against an empty key; these tests pin that fix.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import { assertAuthSecretConfigured, readAuthSecret, verifyBearerToken } from "./auth";

const STRONG_SECRET = "auth-secret-padded-to-thirty-two-bytes-and-then-some";
const SHORT_SECRET = "too-short";

/**
 * Mints an HS256 token signed against any string secret, including weak/empty ones, so the
 * test can prove that the verifier refuses to accept them when AUTH_SECRET is unset or short.
 */
async function mintTokenWithSecret(secret: string, role: "admin" | "user" = "admin"): Promise<string> {
  const key = new TextEncoder().encode(secret);

  return await new SignJWT({ sub: "attacker", role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

/**
 * Wraps an env override so the global process.env is restored even if the test fails mid-way.
 */
function withEnv<T>(overrides: Record<string, string | undefined>, body: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};

  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];

    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }

  return body().finally(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  });
}

test("readAuthSecret returns null when AUTH_SECRET is unset", () => {
  const result = readAuthSecret({ });

  assert.equal(result, null);
});

test("readAuthSecret returns null when AUTH_SECRET is empty", () => {
  const result = readAuthSecret({ AUTH_SECRET: "" });

  assert.equal(result, null);
});

test("readAuthSecret returns null when AUTH_SECRET is shorter than 32 bytes", () => {
  const result = readAuthSecret({ AUTH_SECRET: SHORT_SECRET });

  assert.equal(result, null);
});

test("readAuthSecret returns the encoded bytes when AUTH_SECRET is at least 32 bytes", () => {
  const result = readAuthSecret({ AUTH_SECRET: STRONG_SECRET });

  assert.ok(result instanceof Uint8Array, "expected encoded secret");
  assert.ok(result.byteLength >= 32, "expected at least 32 bytes");
});

test("verifyBearerToken rejects every token when AUTH_SECRET is unset", async () => {
  // jose refuses to sign with a zero-length key, so simulate the unset-secret threat with a
  // 1-byte signing key — the legacy `?? ""` fallback would have happily verified this. The
  // hardened verifier must refuse it because AUTH_SECRET is unset on the verify side.
  await withEnv({ AUTH_SECRET: undefined, NODE_ENV: "production", EE_LIBRARY_ALLOW_TEST_AUTH: undefined }, async () => {
    const forged = await mintTokenWithSecret("x", "admin");
    const result = await verifyBearerToken(`Bearer ${forged}`);

    assert.equal(result, null, "missing AUTH_SECRET must reject every incoming token");
  });
});

test("verifyBearerToken rejects a token forged against a short AUTH_SECRET when the env var is too short", async () => {
  await withEnv({ AUTH_SECRET: SHORT_SECRET, NODE_ENV: "production", EE_LIBRARY_ALLOW_TEST_AUTH: undefined }, async () => {
    const forged = await mintTokenWithSecret(SHORT_SECRET, "admin");
    const result = await verifyBearerToken(`Bearer ${forged}`);

    assert.equal(result, null, "short AUTH_SECRET must be treated as misconfigured, not weakly verified");
  });
});

test("verifyBearerToken accepts a properly-signed token when AUTH_SECRET is configured", async () => {
  await withEnv({ AUTH_SECRET: STRONG_SECRET, NODE_ENV: "production", EE_LIBRARY_ALLOW_TEST_AUTH: undefined }, async () => {
    const valid = await mintTokenWithSecret(STRONG_SECRET, "user");
    const result = await verifyBearerToken(`Bearer ${valid}`);

    assert.ok(result, "expected a session for a valid token");
    assert.equal(result.role, "user");
    assert.equal(result.sub, "attacker");
  });
});

test("assertAuthSecretConfigured throws when AUTH_SECRET is unset", () => {
  assert.throws(
    () => assertAuthSecretConfigured({ NODE_ENV: "production" }),
    /AUTH_SECRET is required/u
  );
});

test("assertAuthSecretConfigured throws when AUTH_SECRET is too short", () => {
  assert.throws(
    () => assertAuthSecretConfigured({ NODE_ENV: "production", AUTH_SECRET: SHORT_SECRET }),
    /at least 32 bytes/u
  );
});

test("assertAuthSecretConfigured passes when AUTH_SECRET is at least 32 bytes", () => {
  assertAuthSecretConfigured({ NODE_ENV: "production", AUTH_SECRET: STRONG_SECRET });
});

test("assertAuthSecretConfigured allows missing secret only when both NODE_ENV=test and EE_LIBRARY_ALLOW_TEST_AUTH=1 are set", () => {
  // The test runner sets both flags, which is what makes the existing test admin shortcut
  // safe. A misconfigured prod deploy that inherits NODE_ENV=test cannot accidentally
  // bypass the secret check unless it ALSO sets the explicit opt-in flag.
  assertAuthSecretConfigured({ NODE_ENV: "test", EE_LIBRARY_ALLOW_TEST_AUTH: "1" });

  assert.throws(
    () => assertAuthSecretConfigured({ NODE_ENV: "test" }),
    /AUTH_SECRET is required/u,
    "NODE_ENV=test alone must not satisfy the secret check"
  );

  assert.throws(
    () => assertAuthSecretConfigured({ EE_LIBRARY_ALLOW_TEST_AUTH: "1" }),
    /AUTH_SECRET is required/u,
    "EE_LIBRARY_ALLOW_TEST_AUTH alone must not satisfy the secret check"
  );
});
