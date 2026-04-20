import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SignJWT } from "jose";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = new TextEncoder().encode(process.env["AUTH_SECRET"] ?? "");
  const token = await new SignJWT({
    sub: session.user.id,
    role: session.user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30s")
    .sign(secret);

  return NextResponse.json({ token });
}
