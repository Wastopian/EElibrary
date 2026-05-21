/**
 * File header: Proxies catalog preview-artifact downloads from the web app to the API service.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { proxyCatalogAssetDownload } from "@/lib/proxy-catalog-asset-download";

/**
 * Streams or redirects one preview-artifact download through the authenticated API session.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ partId: string; assetId: string }> }
): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A signed-in session is required to download preview artifacts."
        }
      },
      { status: 401 }
    );
  }

  const { partId, assetId } = await context.params;
  const result = await proxyCatalogAssetDownload(partId, assetId, new URLSearchParams(), "preview-artifact/download");

  if (result.kind === "redirect") {
    return NextResponse.redirect(result.location);
  }

  if (result.kind === "stream") {
    const headers = new Headers({ "Content-Type": result.contentType });

    if (result.contentDisposition) {
      headers.set("Content-Disposition", result.contentDisposition);
    }

    return new NextResponse(result.body, { headers, status: 200 });
  }

  return new NextResponse(result.body, {
    headers: { "Content-Type": result.contentType },
    status: result.status
  });
}
