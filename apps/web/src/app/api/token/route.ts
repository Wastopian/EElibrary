import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SignJWT } from "jose";

/**
 * Minimum byte length for AUTH_SECRET. Must match `apps/api/src/auth.ts` so the API service
 * accepts every token this route signs. A shorter secret is treated as misconfigured —
 * the previous `?? ""` fallback would silently sign tokens with a zero-byte key, and the
 * API would happily verify forged tokens signed against the same empty secret.
 */
const MIN_AUTH_SECRET_BYTES = 32;

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawSecret = process.env["AUTH_SECRET"];
  const encodedSecret = typeof rawSecret === "string" ? new TextEncoder().encode(rawSecret) : null;

  if (!encodedSecret || encodedSecret.byteLength < MIN_AUTH_SECRET_BYTES) {
    // Fail closed instead of issuing tokens against an empty or trivially-short HMAC key.
    // Surface a 503 so ops sees the misconfiguration immediately rather than discovering
    // it later via forged-token incident response.
    return NextResponse.json(
      { error: "AUTH_SECRET is not configured. Token issuance is disabled." },
      { status: 503 }
    );
  }

  const token = await new SignJWT({
    sub: session.user.id,
    role: session.user.role,
    orgId: session.user.orgId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30s")
    .sign(encodedSecret);

  return NextResponse.json({ token });
}
