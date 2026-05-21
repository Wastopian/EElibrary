/**
 * File header: Proxies project part kit updates from the web app to the catalog API service.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getApiBaseUrl } from "@/lib/api-client";
import { getServerApiAuthHeaders } from "@/lib/server-api-auth";
import type { ProjectPartKitUpdateInput } from "@ee-library/shared/types";

/**
 * Updates BOM-linked part kit fields and optionally runs mirror ingest for one part.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; partId: string }> }
): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A signed-in session is required to update project part kits."
        }
      },
      { status: 401 }
    );
  }

  const { projectId, partId } = await context.params;
  const body = (await request.json()) as ProjectPartKitUpdateInput;
  const apiBase = getApiBaseUrl().replace(/\/$/u, "");
  const authHeaders = await getServerApiAuthHeaders();
  const response = await fetch(
    `${apiBase}/projects/${encodeURIComponent(projectId)}/part-kits/${encodeURIComponent(partId)}`,
    {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      method: "PATCH"
    }
  );

  const rawBody = await response.text();

  return new NextResponse(rawBody, {
    headers: { "Content-Type": "application/json" },
    status: response.status
  });
}
