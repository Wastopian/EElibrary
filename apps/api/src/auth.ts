import type { IncomingMessage } from "node:http";
import { jwtVerify } from "jose";

export interface ApiSession {
  sub: string;
  role: "admin" | "user";
}

/** verifyBearerToken checks the Authorization header and returns the decoded session or null. */
export async function verifyBearerToken(
  authHeader: string | undefined
): Promise<ApiSession | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const secret = new TextEncoder().encode(process.env["AUTH_SECRET"] ?? "");

  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    const role = payload["role"];

    if (
      typeof payload.sub !== "string" ||
      (role !== "admin" && role !== "user")
    ) {
      return null;
    }

    return { sub: payload.sub, role };
  } catch {
    return null;
  }
}

/** requireAuth returns the session or an HTTP error descriptor for unauthenticated requests. */
export async function requireAuth(
  request: IncomingMessage
): Promise<ApiSession | { statusCode: number; code: string; message: string }> {
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
