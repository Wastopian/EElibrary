/**
 * File header: Tests password-change validation and account-page notice mapping.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { generateTemporaryPassword, MIN_PASSWORD_LENGTH, resolveAccountNotice, validatePasswordChange } from "./account";

test("validatePasswordChange accepts a well-formed change", () => {
  assert.equal(validatePasswordChange("old-password", "new-password-1", "new-password-1"), null);
});

test("validatePasswordChange rejects each malformed shape with a specific code", () => {
  assert.equal(validatePasswordChange("", "new-password-1", "new-password-1"), "current_password_required");
  assert.equal(validatePasswordChange("old-password", "short", "short"), "weak_password");
  assert.equal(validatePasswordChange("old-password", "new-password-1", "different-1"), "password_mismatch");
  assert.equal(validatePasswordChange("same-password", "same-password", "same-password"), "password_unchanged");
});

test("generateTemporaryPassword is readable, long enough, and distinct across calls", () => {
  const first = generateTemporaryPassword();

  // temp- prefix + three 4-char groups from the ambiguity-free alphabet (no I, L, O, U).
  assert.match(first, /^temp(-[0-9A-HJ-NP-TV-Z]{4}){3}$/u);
  assert.ok(first.length >= MIN_PASSWORD_LENGTH, "a temporary password satisfies the sign-in minimum");

  const batch = new Set(Array.from({ length: 20 }, () => generateTemporaryPassword()));
  assert.equal(batch.size, 20, "20 generated passwords are all different");
});

test("resolveAccountNotice maps codes to plain-language copy and ignores unknown flags", () => {
  assert.equal(resolveAccountNotice(undefined, "password_changed")?.tone, "success");
  assert.match(resolveAccountNotice("current_password_incorrect", undefined)?.body ?? "", /did not match/u);
  assert.match(resolveAccountNotice("weak_password", undefined)?.body ?? "", /8 characters/u);
  assert.match(resolveAccountNotice("password_unchanged", undefined)?.body ?? "", /different password/u);
  assert.equal(resolveAccountNotice("bogus_code", undefined), null);
  assert.equal(resolveAccountNotice(undefined, undefined), null);
});
