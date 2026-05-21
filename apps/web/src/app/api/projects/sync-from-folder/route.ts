/**
 * File header: Proxies project folder sync from the web app to the catalog API service.
 *
 * Server actions call this same-origin route so folder sync never hits the Next.js page
 * router (which would return HTTP 405). The handler forwards the session to the API on
 * EE_LIBRARY_API_BASE_URL, which defaults to port 4000.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getApiBaseUrl } from "@/lib/api-client";
import { getServerApiAuthHeaders } from "@/lib/server-api-auth";

/**
 * Reconciles on-disk project folders through the catalog API and returns the API envelope.
 */
export async function POST(): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A signed-in session is required to sync project folders."
        }
      },
      { status: 401 }
    );
  }

  const apiBase = getApiBaseUrl().replace(/\/$/u, "");
  const authHeaders = await getServerApiAuthHeaders();
  const response = await fetch(`${apiBase}/projects/sync-from-folder`, {
    body: "{}",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders
    },
    method: "POST"
  });

  const rawBody = await response.text();

  return new NextResponse(rawBody, {
    headers: { "Content-Type": "application/json" },
    status: response.status
  });
}
