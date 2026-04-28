/**
 * File header: Auth helpers for AUTH_SECRET generation and admin password hashing.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/** Length in bytes of a generated AUTH_SECRET. 32 bytes encoded as base64url is well above the 32-char floor. */
export const AUTH_SECRET_BYTE_LENGTH = 48;

/** scrypt cost parameters tuned for a developer laptop. */
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Generates a cryptographically random AUTH_SECRET encoded as base64url.
 */
export function generateAuthSecret() {
  return randomBytes(AUTH_SECRET_BYTE_LENGTH).toString("base64url");
}

/**
 * Hashes an admin password with scrypt and a per-record random salt.
 * The returned string is `scrypt$<salt-hex>$<derived-hex>` so it can be stored as a single column.
 */
export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);

  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verifies a password against a previously hashed value produced by hashPassword.
 * Returns false on any malformed input rather than throwing.
 */
export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") {
    return false;
  }

  const parts = encoded.split("$");

  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  if (!/^[0-9a-f]+$/iu.test(parts[1]) || !/^[0-9a-f]+$/iu.test(parts[2])) {
    return false;
  }

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");

  if (salt.length === 0 || expected.length !== SCRYPT_KEY_LENGTH) {
    return false;
  }

  const derived = await scrypt(password, salt, expected.length, SCRYPT_OPTIONS);

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
