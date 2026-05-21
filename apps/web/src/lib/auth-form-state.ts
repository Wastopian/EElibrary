/**
 * File header: Shared auth-form helpers for safe redirects, messages, and query handling.
 */

/** AuthNoticeTone names the visual treatment used by the sign-in and sign-up panels. */
export type AuthNoticeTone = "error" | "success";

/** AuthNotice carries operator-facing feedback without exposing raw provider errors. */
export interface AuthNotice {
  /** Message body gives the operator the next practical step. */
  body: string;
  /** Tone selects the CSS treatment and alert semantics for the notice. */
  tone: AuthNoticeTone;
  /** Title is the short bold summary shown at the top of the notice. */
  title: string;
}

/** AuthQueryValue mirrors the App Router search-param shape used by auth pages. */
export type AuthQueryValue = string | string[] | undefined;

/**
 * Resolves a local callback URL and rejects open-redirect or API callback targets.
 */
export function resolveSafeCallbackUrl(value: AuthQueryValue): string {
  const candidate = readFirstQueryValue(value);

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }

  const targetPath = candidate.split(/[?#]/u)[0] ?? "/";

  if (targetPath === "/api" || targetPath.startsWith("/api/") || targetPath === "/sign-in" || targetPath === "/sign-up") {
    return "/";
  }

  return candidate;
}

/**
 * Builds an auth-route URL while preserving a safe callback and optional notice flags.
 */
export function buildAuthRoutePath(
  pathname: "/sign-in" | "/sign-up",
  callbackUrl: string,
  params: Record<string, string> = {}
): string {
  const url = new URL(pathname, "https://ee-library.local");

  if (callbackUrl !== "/") {
    url.searchParams.set("callbackUrl", callbackUrl);
  }

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return `${url.pathname}${url.search}`;
}

/**
 * Maps sign-in search params into helpful, non-leaky form feedback.
 */
export function resolveSignInNotice(error: AuthQueryValue, notice: AuthQueryValue): AuthNotice | null {
  const noticeKey = readFirstQueryValue(notice);

  if (noticeKey === "account_created") {
    return {
      body: "Your account is ready. Sign in with the password you just set.",
      tone: "success",
      title: "Account created"
    };
  }

  if (noticeKey === "signed_out") {
    return {
      body: "Sign in again with the account you want to use. Use an admin account to open Admin and project-folder settings.",
      tone: "success",
      title: "Signed out"
    };
  }

  const errorKey = normalizeAuthErrorKey(readFirstQueryValue(error));

  if (errorKey === "invalid_credentials") {
    return {
      body: "Check the email and password, then try again. New operators can create an account below.",
      tone: "error",
      title: "Sign-in did not match an account"
    };
  }

  if (errorKey === "service_unavailable") {
    return {
      body: "The auth service could not reach the user database. Check local setup, then try again.",
      tone: "error",
      title: "Sign-in is temporarily unavailable"
    };
  }

  return null;
}

/**
 * Maps sign-up search params into clear recovery copy.
 */
export function resolveSignUpNotice(error: AuthQueryValue): AuthNotice | null {
  const errorKey = normalizeAuthErrorKey(readFirstQueryValue(error));

  if (errorKey === "account_exists") {
    return {
      body: "An account already exists for that email. Use sign in, or reset the local admin password from the setup scripts.",
      tone: "error",
      title: "Account already exists"
    };
  }

  if (errorKey === "invalid_email") {
    return {
      body: "Enter a valid engineering email address before creating the account.",
      tone: "error",
      title: "Email needs a second look"
    };
  }

  if (errorKey === "password_mismatch") {
    return {
      body: "Both password fields must match exactly.",
      tone: "error",
      title: "Passwords do not match"
    };
  }

  if (errorKey === "weak_password") {
    return {
      body: "Use at least 8 characters so the local credential store accepts the account.",
      tone: "error",
      title: "Password is too short"
    };
  }

  if (errorKey === "setup_required") {
    return {
      body: "The users table or database connection is not ready yet. Run the local setup or migration flow, then try again.",
      tone: "error",
      title: "Account storage is unavailable"
    };
  }

  return null;
}

/**
 * Detects Auth.js redirect URLs that represent a failed credentials attempt.
 */
export function readSignInRedirectError(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const redirectUrl = new URL(value, "https://ee-library.local");
    const error = redirectUrl.searchParams.get("error");

    return error ? normalizeAuthErrorKey(error) : null;
  } catch {
    return null;
  }
}

/**
 * Reads one required string field from auth form data and trims surrounding whitespace.
 */
export function readTrimmedFormString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reads one required password field without trimming possible intentional whitespace.
 */
export function readPasswordFormString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/**
 * Normalizes auth error keys from Auth.js and local form validation into stable UI states.
 */
function normalizeAuthErrorKey(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value === "CredentialsSignin") {
    return "invalid_credentials";
  }

  if (value === "CallbackRouteError" || value === "Configuration" || value === "MissingSecret") {
    return "service_unavailable";
  }

  return value;
}

/**
 * Reads the first query value from App Router search params.
 */
function readFirstQueryValue(value: AuthQueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
