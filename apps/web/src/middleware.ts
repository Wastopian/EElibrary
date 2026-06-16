/**
 * File header: Protects authenticated workspace routes with Edge-safe JWT role checks.
 */

import { getToken } from "next-auth/jwt";
import { SignJWT } from "jose";
import { NextResponse, type NextRequest } from "next/server";

/** AppRole mirrors the narrow role values embedded by the NextAuth JWT callback. */
type AppRole = "admin" | "user";

/** Must match the API token verifier so the proxy fails closed on weak secrets. */
const MIN_AUTH_SECRET_BYTES = 32;

/**
 * Redirects non-authenticated users to sign-in and keeps non-admin users out of admin routes.
 */
export default async function middleware(request: NextRequest) {
  const token = await readSessionToken(request);

  if (!token) {
    return NextResponse.redirect(buildSignInRedirect(request));
  }

  if (request.nextUrl.pathname.startsWith("/admin") && readAppRole(token.role) !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (request.nextUrl.pathname.startsWith("/api-proxy/")) {
    return buildApiProxyResponse(request, token);
  }

  return NextResponse.next();
}

/**
 * Builds a sign-in URL that returns the operator to the workspace they tried to open.
 */
function buildSignInRedirect(request: NextRequest): URL {
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return signIn;
}

/**
 * Reads the Auth.js JWT without importing the server auth module that depends on DB and Node APIs.
 */
async function readSessionToken(request: NextRequest): Promise<Record<string, unknown> | null> {
  const secret = process.env["AUTH_SECRET"] ?? process.env["NEXTAUTH_SECRET"];

  if (!secret) {
    return null;
  }

  try {
    return await getToken({
      req: request,
      secret,
      secureCookie: request.nextUrl.protocol === "https:"
    });
  } catch {
    return null;
  }
}

/**
 * Narrows untrusted JWT role claims before making an admin routing decision.
 */
function readAppRole(value: unknown): AppRole | null {
  return value === "admin" || value === "user" ? value : null;
}

/**
 * Adds the short-lived Bearer token the private API expects. Browser links can only carry
 * the Auth.js cookie, so the same-origin proxy bridges that cookie session to API auth.
 */
async function buildApiProxyResponse(request: NextRequest, token: Record<string, unknown>): Promise<NextResponse> {
  const sub = typeof token.sub === "string" ? token.sub : null;
  const role = readAppRole(token.role);
  const secret = readApiAuthSecret();

  if (!sub || !role) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "A valid session token is required." } }, { status: 401 });
  }

  if (!secret) {
    return NextResponse.json(
      { error: { code: "AUTH_SECRET_NOT_CONFIGURED", message: "API proxy authentication is not configured." } },
      { status: 503 }
    );
  }

  const apiToken = await new SignJWT({ role, sub })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30s")
    .sign(secret);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("authorization", `Bearer ${apiToken}`);

  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

/**
 * Reads the shared API/Web auth secret using the same minimum length as the API.
 */
function readApiAuthSecret(): Uint8Array | null {
  const raw = process.env["AUTH_SECRET"];
  if (typeof raw !== "string") {
    return null;
  }

  const encoded = new TextEncoder().encode(raw);
  return encoded.byteLength >= MIN_AUTH_SECRET_BYTES ? encoded : null;
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/api-proxy/:path*",
    "/catalog/:path*",
    "/circuit-blocks/:path*",
    "/compare/:path*",
    "/connector-sets/:path*",
    "/evidence/:path*",
    "/parts/:path*",
    "/projects/:path*",
    "/system/:path*",
    "/vendors/:path*",
    "/where-used/:path*"
  ],
};
