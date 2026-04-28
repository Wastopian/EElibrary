/**
 * File header: Tests for AUTH_SECRET generation and admin password hashing.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_SECRET_BYTE_LENGTH,
  generateAuthSecret,
  hashPassword,
  verifyPassword
} from "../lib/auth.mjs";

test("generateAuthSecret returns base64url-encoded value with sufficient entropy", () => {
  const a = generateAuthSecret();
  const b = generateAuthSecret();
  assert.notEqual(a, b);
  // base64url with no padding: 4 * ceil(n / 3) characters; for 48 bytes that is 64 chars.
  assert.ok(a.length >= 32, `expected at least 32 chars, got ${a.length}`);
  assert.match(a, /^[A-Za-z0-9_-]+$/u);
  // Encoded length matches the configured byte length.
  const decoded = Buffer.from(a, "base64url");
  assert.equal(decoded.length, AUTH_SECRET_BYTE_LENGTH);
});

test("hashPassword + verifyPassword round-trip succeeds and fails for wrong password", async () => {
  const hashed = await hashPassword("localdev-admin");
  assert.match(hashed, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/u);

  assert.equal(await verifyPassword("localdev-admin", hashed), true);
  assert.equal(await verifyPassword("wrong", hashed), false);
});

test("hashPassword rejects short inputs", async () => {
  await assert.rejects(() => hashPassword("short"), /at least 8 characters/u);
});

test("verifyPassword returns false for malformed hashes", async () => {
  assert.equal(await verifyPassword("anything", "not-a-real-hash"), false);
  assert.equal(await verifyPassword("anything", "scrypt$xx$yy"), false);
});
