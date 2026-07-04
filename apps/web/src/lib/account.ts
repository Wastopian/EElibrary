/**
 * File header: Pure account-management helpers (password change validation and notices).
 *
 * The account page's server action stays a thin DB wrapper around these, matching the sign-up
 * factoring: everything worth unit-testing lives here without a database harness.
 */

import { randomInt } from "node:crypto";

/** MIN_PASSWORD_LENGTH matches the sign-up form and the local credential store's expectation. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Crockford base32 without the ambiguous letters (I, L, O, U): a temporary password gets read aloud
 * or copied by hand between teammates, so it must survive that without a mistyped character.
 */
const TEMP_PASSWORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generates the readable one-time temporary password an admin hands to a locked-out teammate,
 * e.g. `temp-9DZC-V3VH-K2M4`. ~32^12 of entropy; the teammate should change it from their Account
 * page after signing in.
 */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];

  for (let group = 0; group < 3; group += 1) {
    let chars = "";

    for (let position = 0; position < 4; position += 1) {
      chars += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
    }

    groups.push(chars);
  }

  return `temp-${groups.join("-")}`;
}

/** PasswordChangeErrorCode names each rejection so the page can render targeted recovery copy. */
export type PasswordChangeErrorCode =
  | "current_password_required"
  | "weak_password"
  | "password_mismatch"
  | "password_unchanged";

/**
 * Validates a password-change submission before any database work. Returns null when acceptable.
 * The current-password CHECK (against the stored hash) happens in the action; this validates shape.
 */
export function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
): PasswordChangeErrorCode | null {
  if (currentPassword.length === 0) {
    return "current_password_required";
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return "weak_password";
  }

  if (newPassword !== confirmPassword) {
    return "password_mismatch";
  }

  if (newPassword === currentPassword) {
    return "password_unchanged";
  }

  return null;
}

/** AccountNotice is the account page's feedback shape (mirrors the auth pages' notices). */
export interface AccountNotice {
  tone: "error" | "success";
  title: string;
  body: string;
}

/**
 * Maps account page query flags to plain-language feedback. Codes only ever travel in the URL —
 * never the passwords themselves.
 */
export function resolveAccountNotice(error: string | undefined, notice: string | undefined): AccountNotice | null {
  if (notice === "password_changed") {
    return {
      body: "Use the new password the next time you sign in. Sessions on other devices stay signed in until they expire.",
      title: "Password changed",
      tone: "success"
    };
  }

  switch (error) {
    case "current_password_required":
      return { body: "Type your current password so we can confirm it is really you.", title: "Current password is required", tone: "error" };
    case "current_password_incorrect":
      return { body: "The current password did not match. Try again, or ask your admin to reset it if you have forgotten it.", title: "Current password did not match", tone: "error" };
    case "weak_password":
      return { body: `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`, title: "New password is too short", tone: "error" };
    case "password_mismatch":
      return { body: "Both new-password fields must match exactly.", title: "New passwords do not match", tone: "error" };
    case "password_unchanged":
      return { body: "The new password is the same as the current one. Pick a different password.", title: "Nothing would change", tone: "error" };
    case "setup_required":
      return { body: "The user database is not reachable right now. Try again, or check the System page.", title: "Account storage is unavailable", tone: "error" };
    default:
      return null;
  }
}
