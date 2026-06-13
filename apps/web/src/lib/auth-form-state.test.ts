/**
 * File header: Tests auth-form redirect hardening and friendly notice mapping.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthRoutePath,
  readSignInRedirectError,
  resolveSafeCallbackUrl,
  resolveSignInNotice,
  resolveSignUpNotice
} from "./auth-form-state";

/**
 * Verifies callback URLs stay app-local and cannot target API routes or auth pages.
 */
test("resolveSafeCallbackUrl accepts only safe workspace callbacks", () => {
  assert.equal(resolveSafeCallbackUrl("/catalog?q=relay"), "/catalog?q=relay");
  assert.equal(resolveSafeCallbackUrl("https://example.com/phish"), "/");
  assert.equal(resolveSafeCallbackUrl("//example.com/phish"), "/");
  assert.equal(resolveSafeCallbackUrl("/api/token"), "/");
  assert.equal(resolveSafeCallbackUrl("/api?token=1"), "/");
  assert.equal(resolveSafeCallbackUrl("/sign-in"), "/");
  assert.equal(resolveSafeCallbackUrl("/sign-in?error=CredentialsSignin"), "/");
  assert.equal(resolveSafeCallbackUrl("/sign-up"), "/");
  assert.equal(resolveSafeCallbackUrl("/sign-up?error=weak_password"), "/");
});

/**
 * Verifies auth route builders preserve safe callbacks and page-local flags.
 */
test("buildAuthRoutePath preserves callback and notice params", () => {
  assert.equal(
    buildAuthRoutePath("/sign-up", "/projects?status=active", { error: "weak_password" }),
    "/sign-up?callbackUrl=%2Fprojects%3Fstatus%3Dactive&error=weak_password"
  );
  assert.equal(buildAuthRoutePath("/sign-in", "/", { notice: "account_created" }), "/sign-in?notice=account_created");
});

/**
 * Verifies Auth.js redirect failures are normalized before reaching the UI.
 */
test("readSignInRedirectError normalizes Auth.js credential and service failures", () => {
  assert.equal(readSignInRedirectError("/sign-in?error=CredentialsSignin"), "invalid_credentials");
  assert.equal(readSignInRedirectError("/sign-in?error=CallbackRouteError"), "service_unavailable");
  assert.equal(readSignInRedirectError("/catalog"), null);
});

/**
 * Verifies sign-in notices explain both invalid credentials and successful account creation.
 */
test("resolveSignInNotice returns friendly sign-in copy", () => {
  const invalid = resolveSignInNotice("CredentialsSignin", undefined);
  const created = resolveSignInNotice(undefined, "account_created");

  assert.equal(invalid?.tone, "error");
  assert.match(invalid?.body ?? "", /create an account/u);
  assert.equal(created?.tone, "success");
  assert.match(created?.title ?? "", /Account created/u);
});

/**
 * Verifies sign-up validation states render specific recovery guidance.
 */
test("resolveSignUpNotice returns field-specific recovery copy", () => {
  assert.match(resolveSignUpNotice("account_exists")?.body ?? "", /already exists/u);
  assert.match(resolveSignUpNotice("password_mismatch")?.body ?? "", /match exactly/u);
  assert.match(resolveSignUpNotice("setup_required")?.body ?? "", /database connection/u);
  assert.match(resolveSignUpNotice("invite_mismatch")?.body ?? "", /invite code/u);
  assert.equal(resolveSignUpNotice(undefined), null);
});
