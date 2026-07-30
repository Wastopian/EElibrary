import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readLiveSessionRole } from "@/lib/live-session-role";
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

  // Mint from the live users.role row, not the JWT cookie claim. Demotion writes the DB immediately;
  // trusting the cookie here would keep issuing admin API tokens until the demoted member re-signs in.
  let live;
  try {
    live = await readLiveSessionRole(session.user.id);
  } catch {
    return NextResponse.json({ error: "Unable to verify your account right now." }, { status: 503 });
  }

  if (!live) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await new SignJWT({
    sub: session.user.id,
    role: live.role,
    orgId: live.orgId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30s")
    .sign(encodedSecret);

  return NextResponse.json({ token });
}
