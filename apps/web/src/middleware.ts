/**
 * File header: Protects authenticated workspace routes with Edge-safe JWT role checks.
 */

import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

/** AppRole mirrors the narrow role values embedded by the NextAuth JWT callback. */
type AppRole = "admin" | "user";

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
