/**
 * File header: Protects authenticated workspace routes with Edge-safe JWT role checks.
 */

import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirects non-authenticated users to sign-in. Authorization (which role may do what) is enforced
 * authoritatively at the API boundary, not here — this Edge middleware only checks that a session
 * exists. See apps/api/src/auth.ts.
 */
export default async function middleware(request: NextRequest) {
  const token = await readSessionToken(request);

  if (!token) {
    return NextResponse.redirect(buildSignInRedirect(request));
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

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
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
