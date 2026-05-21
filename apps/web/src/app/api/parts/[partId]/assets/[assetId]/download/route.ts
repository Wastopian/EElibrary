/**
 * File header: Proxies catalog asset downloads from the web app to the API service.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  proxyCatalogAssetDownload,
  resolveCatalogAssetContentDisposition,
  shouldPreferInlineDisplay
} from "@/lib/proxy-catalog-asset-download";

/**
 * Streams or redirects one catalog asset download through the authenticated API session.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ partId: string; assetId: string }> }
): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A signed-in session is required to download catalog assets."
        }
      },
      { status: 401 }
    );
  }

  const { partId, assetId } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  const result = await proxyCatalogAssetDownload(partId, assetId, searchParams);

  if (result.kind === "redirect") {
    const redirectUrl = new URL(result.location, request.url);

    if (shouldPreferInlineDisplay(searchParams)) {
      redirectUrl.searchParams.set("inline", "1");
    }

    return NextResponse.redirect(redirectUrl.toString());
  }

  if (result.kind === "stream") {
    const preferInline = shouldPreferInlineDisplay(searchParams);
    const headers = new Headers({ "Content-Type": result.contentType });
    const contentDisposition = resolveCatalogAssetContentDisposition(
      result.contentDisposition,
      result.contentType,
      preferInline
    );

    if (contentDisposition) {
      headers.set("Content-Disposition", contentDisposition);
    }

    return new NextResponse(result.body, { headers, status: 200 });
  }

  return new NextResponse(result.body, {
    headers: { "Content-Type": result.contentType },
    status: result.status
  });
}
