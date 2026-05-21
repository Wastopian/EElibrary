/**
 * File header: Builds API bearer headers for server actions and RSC fetches.
 */

import { headers } from "next/headers";

/**
 * Fetches a short-lived API token using the current browser session cookies.
 */
export async function getServerApiAuthHeaders(): Promise<Record<string, string>> {
  if (process.env.NODE_ENV === "test" || process.env.EE_LIBRARY_ALLOW_TEST_AUTH === "1") {
    return { Authorization: "Bearer test-admin-token" };
  }

  let cookieHeader: string | null = null;

  try {
    cookieHeader = (await headers()).get("cookie");
  } catch {
    cookieHeader = null;
  }

  const base = process.env["NEXTAUTH_URL"] ?? "http://localhost:3000";
  const response = await fetch(`${base}/api/token`, {
    cache: "no-store",
    headers: cookieHeader ? { cookie: cookieHeader } : {}
  });

  if (!response.ok) {
    return {};
  }

  const body = (await response.json()) as { token?: unknown };

  return typeof body.token === "string" && body.token.length > 0 ? { Authorization: `Bearer ${body.token}` } : {};
}
