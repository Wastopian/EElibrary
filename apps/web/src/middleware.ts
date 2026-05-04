import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  if (!req.auth) {
    const signIn = new URL("/sign-in", req.url);
    signIn.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }

  if (req.nextUrl.pathname.startsWith("/admin") && req.auth.user.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
