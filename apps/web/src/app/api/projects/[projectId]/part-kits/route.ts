/**
 * File header: Proxies project part kit listing from the web app to the catalog API service.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getApiBaseUrl } from "@/lib/api-client";
import { getServerApiAuthHeaders } from "@/lib/server-api-auth";

/**
 * Lists part kits for one project (BOM metadata, mirror files, and catalog assets).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A signed-in session is required to read project part kits."
        }
      },
      { status: 401 }
    );
  }

  const { projectId } = await context.params;
  const apiBase = getApiBaseUrl().replace(/\/$/u, "");
  const authHeaders = await getServerApiAuthHeaders();
  const response = await fetch(`${apiBase}/projects/${encodeURIComponent(projectId)}/part-kits`, {
    cache: "no-store",
    headers: authHeaders
  });

  const rawBody = await response.text();

  return new NextResponse(rawBody, {
    headers: { "Content-Type": "application/json" },
    status: response.status
  });
}
