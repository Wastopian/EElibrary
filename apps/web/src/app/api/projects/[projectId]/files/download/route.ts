/**
 * File header: Proxies on-disk project mirror file downloads through the web app.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getApiBaseUrl } from "@/lib/api-client";
import { resolveCatalogAssetContentDisposition, shouldPreferInlineDisplay } from "@/lib/proxy-catalog-asset-download";
import { getServerApiAuthHeaders } from "@/lib/server-api-auth";

/**
 * Streams one project mirror file (datasheet, model, or footprint) from the API host.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A signed-in session is required to open project files."
        }
      },
      { status: 401 }
    );
  }

  const { projectId } = await context.params;
  const incoming = new URL(request.url);
  const relativePath = incoming.searchParams.get("relativePath")?.trim() ?? "";

  if (!relativePath) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PROJECT_FILE_PATH",
          message: "Project file download requires a relativePath query parameter."
        }
      },
      { status: 400 }
    );
  }

  const apiBase = getApiBaseUrl().replace(/\/$/u, "");
  const authHeaders = await getServerApiAuthHeaders();
  const apiUrl = new URL(`${apiBase}/projects/${encodeURIComponent(projectId)}/files/download`);
  apiUrl.searchParams.set("relativePath", relativePath);

  if (incoming.searchParams.get("attachment") === "1" || incoming.searchParams.get("attachment") === "true") {
    apiUrl.searchParams.set("attachment", "1");
  }

  const apiResponse = await fetch(apiUrl.toString(), {
    cache: "no-store",
    headers: authHeaders
  });

  if (!apiResponse.ok || !apiResponse.body) {
    const body = await apiResponse.text();

    return new NextResponse(body, {
      headers: { "Content-Type": apiResponse.headers.get("content-type") ?? "application/json" },
      status: apiResponse.status
    });
  }

  const contentType = apiResponse.headers.get("content-type") ?? "application/octet-stream";
  const preferInline = shouldPreferInlineDisplay(incoming.searchParams);
  const headers = new Headers({ "Content-Type": contentType });
  const contentDisposition = resolveCatalogAssetContentDisposition(
    apiResponse.headers.get("content-disposition"),
    contentType,
    preferInline
  );

  if (contentDisposition) {
    headers.set("Content-Disposition", contentDisposition);
  }

  return new NextResponse(apiResponse.body, { headers, status: 200 });
}
