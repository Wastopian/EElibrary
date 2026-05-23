/**
 * File header: Verifies API bearer tokens and provides a deterministic test-only session path.
 */

import type { IncomingMessage } from "node:http";
import { jwtVerify } from "jose";
import { isAppRole, type AppRole } from "@ee-library/shared/types";

export interface ApiSession {
  sub: string;
  role: AppRole;
}

/** apiSessionRequestKey stores the verified session on the current request for audit middleware. */
const apiSessionRequestKey = Symbol.for("ee-library.api.session");

/** AuditedIncomingMessage is an IncomingMessage that may carry a verified API session. */
type AuditedIncomingMessage = IncomingMessage & {
  [apiSessionRequestKey]?: ApiSession;
};

/**
 * Minimum byte length for AUTH_SECRET. HS256 nominally accepts any length but a 32-byte
 * (256-bit) secret matches the underlying SHA-256 block and is the smallest length that
 * resists offline brute-force at any plausible scale. Anything shorter is treated as
 * misconfigured and refused, instead of silently signing or verifying with a weak key.
 */
const MIN_AUTH_SECRET_BYTES = 32;

/**
 * Reads the AUTH_SECRET environment variable and returns it as a Uint8Array, or null when
 * the value is missing or shorter than {@link MIN_AUTH_SECRET_BYTES}. The legacy
 * `?? ""` fallback used to coerce missing AUTH_SECRET into an empty HMAC key, which would
 * happily verify any token signed with an empty secret. This explicit length check refuses
 * that path so a misconfigured deploy fails closed instead of granting admin to anyone.
 */
export function readAuthSecret(env: NodeJS.ProcessEnv = process.env): Uint8Array | null {
  const raw = env["AUTH_SECRET"];

  if (typeof raw !== "string") {
    return null;
  }

  const encoded = new TextEncoder().encode(raw);

  return encoded.byteLength >= MIN_AUTH_SECRET_BYTES ? encoded : null;
}

/**
 * Returns a deterministic admin session only when both `NODE_ENV === "test"` and the
 * explicit opt-in env var is set. Requiring a second flag prevents a misconfigured prod
 * deploy that accidentally inherits `NODE_ENV=test` from silently granting admin to every
 * request, which is exactly the failure mode the previous unconditional bypass had.
 */
function readTestSession(env: NodeJS.ProcessEnv = process.env): ApiSession | null {
  if (env.NODE_ENV !== "test" || env["EE_LIBRARY_ALLOW_TEST_AUTH"] !== "1") {
    return null;
  }

  return {
    role: "admin",
    sub: "test-admin"
  };
}

/** verifyBearerToken checks the Authorization header and returns the decoded session or null. */
export async function verifyBearerToken(
  authHeader: string | undefined
): Promise<ApiSession | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const secret = readAuthSecret();

  if (!secret) {
    // Fail closed: refuse every token when AUTH_SECRET is missing or too short, instead of
    // verifying against an empty key. Logging once here would be helpful for ops triage but
    // would also leak through every unauthenticated request, so the failure is silent on
    // the verify path and is meant to be caught by the startup-time configuration check.
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    const role = payload["role"];

    if (typeof payload.sub !== "string" || !isAppRole(role)) {
      return null;
    }

    return { sub: payload.sub, role };
  } catch {
    return null;
  }
}

/**
 * Asserts that AUTH_SECRET is present and long enough at process boot. Production deploys
 * should call this once during startup so the process refuses to listen on the network when
 * the secret is missing — matching the "fail fast on missing config" pattern used by
 * DATABASE_URL elsewhere in the API.
 */
export function assertAuthSecretConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env["EE_LIBRARY_ALLOW_TEST_AUTH"] === "1" && env.NODE_ENV === "test") {
    return;
  }

  if (!readAuthSecret(env)) {
    throw new Error(
      `AUTH_SECRET is required and must be at least ${MIN_AUTH_SECRET_BYTES} bytes. ` +
        `Generate one with \`openssl rand -hex 32\` and add it to the deployment environment.`
    );
  }
}

/** requireAuth returns the session or an HTTP error descriptor for unauthenticated requests. */
export async function requireAuth(
  request: IncomingMessage
): Promise<ApiSession | { statusCode: number; code: string; message: string }> {
  const testSession = readTestSession();

  if (testSession) {
    rememberRequestSession(request, testSession);
    return testSession;
  }

  const session = await verifyBearerToken(
    request.headers["authorization"] as string | undefined
  );

  if (!session) {
    return {
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "A valid session token is required.",
    };
  }

  rememberRequestSession(request, session);

  return session;
}

/** readOptionalSession returns a verified session when one is present without changing anonymous lookup flows. */
export async function readOptionalSession(request: IncomingMessage): Promise<ApiSession | null> {
  const session = await verifyBearerToken(request.headers["authorization"] as string | undefined);

  if (session) {
    rememberRequestSession(request, session);
  }

  return session;
}

/** requireAdmin returns the session or an HTTP error descriptor for non-admin requests. */
export async function requireAdmin(
  request: IncomingMessage
): Promise<ApiSession | { statusCode: number; code: string; message: string }> {
  const result = await requireAuth(request);

  if ("statusCode" in result) return result;

  if (result.role !== "admin") {
    return {
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Admin role is required for this operation.",
    };
  }

  return result;
}

/** isAuthError narrows the result of requireAuth/requireAdmin to an error shape. */
export function isAuthError(
  result: ApiSession | { statusCode: number; code: string; message: string }
): result is { statusCode: number; code: string; message: string } {
  return "statusCode" in result;
}

/**
 * Reads the session already verified during request handling for audit logging.
 */
export function readSessionFromRequest(request: IncomingMessage): ApiSession | null {
  return (request as AuditedIncomingMessage)[apiSessionRequestKey] ?? null;
}

/**
 * Stores the verified session on the request without changing route handler signatures.
 */
function rememberRequestSession(request: IncomingMessage, session: ApiSession): void {
  (request as AuditedIncomingMessage)[apiSessionRequestKey] = session;
}
