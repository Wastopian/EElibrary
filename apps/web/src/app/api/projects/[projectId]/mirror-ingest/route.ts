/**
 * File header: Proxies per-project mirror ingest from the web app to the catalog API service.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getApiBaseUrl } from "@/lib/api-client";
import { getServerApiAuthHeaders } from "@/lib/server-api-auth";

/**
 * Registers missing BOM parts and mirror assets for one project through the catalog API.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A signed-in session is required to register parts from the project folder."
        }
      },
      { status: 401 }
    );
  }

  const { projectId } = await context.params;
  const apiBase = getApiBaseUrl().replace(/\/$/u, "");
  const authHeaders = await getServerApiAuthHeaders();
  const response = await fetch(`${apiBase}/projects/${encodeURIComponent(projectId)}/mirror-ingest`, {
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
