/**
 * File header: Proxies catalog asset download requests through the web app to the API service.
 */

import {
  buildFileContentDisposition,
  isInlineBrowserContentType,
} from "@ee-library/shared/file-display";
import { getApiBaseUrl } from "./api-client";
import { getServerApiAuthHeaders } from "./server-api-auth";

/** ProxyCatalogAssetDownloadResult is the outcome of one proxied asset download request. */
export type ProxyCatalogAssetDownloadResult =
  | { kind: "redirect"; location: string }
  | { kind: "stream"; body: ReadableStream<Uint8Array>; contentType: string; contentDisposition: string | null }
  | { kind: "error"; status: number; body: string; contentType: string };

/**
 * Returns true when the browser should display the file instead of downloading it.
 * Open links omit `attachment=1`; download links include it.
 */
export function shouldPreferInlineDisplay(searchParams: URLSearchParams): boolean {
  return searchParams.get("attachment") !== "1" && searchParams.get("attachment") !== "true";
}

/**
 * Parses a filename from an upstream Content-Disposition header when present.
 */
export function readFilenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }

  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/iu.exec(contentDisposition);

  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1].replace(/"/gu, "").trim());
  } catch {
    return match[1].replace(/"/gu, "").trim();
  }
}

/**
 * Sets Content-Disposition for the browser response based on open vs download intent.
 */
export function resolveCatalogAssetContentDisposition(
  upstream: string | null,
  contentType: string,
  preferInline: boolean
): string {
  const filename = readFilenameFromContentDisposition(upstream) ?? "file";

  if (preferInline && isInlineBrowserContentType(contentType)) {
    return buildFileContentDisposition(filename, true);
  }

  if (!preferInline) {
    return buildFileContentDisposition(filename, false);
  }

  return upstream ?? buildFileContentDisposition(filename, false);
}

/** @deprecated Use isInlineBrowserContentType from @ee-library/shared/file-display. */
export function isViewableCatalogContentType(contentType: string): boolean {
  return isInlineBrowserContentType(contentType);
}

/**
 * Fetches one catalog asset download path from the API and returns a browser-safe response shape.
 */
export async function proxyCatalogAssetDownload(
  partId: string,
  assetId: string,
  searchParams: URLSearchParams,
  downloadPathSuffix: "download" | "preview-artifact/download" = "download"
): Promise<ProxyCatalogAssetDownloadResult> {
  const apiBase = getApiBaseUrl().replace(/\/$/u, "");
  const authHeaders = await getServerApiAuthHeaders();
  const query = searchParams.toString();
  const downloadUrl = `${apiBase}/parts/${encodeURIComponent(partId)}/assets/${encodeURIComponent(assetId)}/${downloadPathSuffix}${query ? `?${query}` : ""}`;
  const initial = await fetch(downloadUrl, {
    cache: "no-store",
    headers: authHeaders,
    redirect: "manual"
  });

  if (initial.status >= 300 && initial.status < 400) {
    const location = initial.headers.get("location");

    if (!location) {
      return {
        body: "Asset download redirect was missing a location header.",
        contentType: "text/plain",
        kind: "error",
        status: 502
      };
    }

    if (/^https?:\/\//iu.test(location)) {
      const resolvedLocation = rewriteApiStorageRedirectToStream(location, apiBase, partId, assetId, downloadPathSuffix, searchParams);
      const fetchTarget = resolvedLocation ?? location;
      const resolved = await fetch(fetchTarget, {
        cache: "no-store",
        headers: authHeaders,
        redirect: "follow"
      });

      if (!resolved.ok || !resolved.body) {
        const body = await resolved.text();
        return {
          body,
          contentType: resolved.headers.get("content-type") ?? "application/json",
          kind: "error",
          status: resolved.status
        };
      }

      return {
        body: resolved.body,
        contentDisposition: resolved.headers.get("content-disposition"),
        contentType: resolved.headers.get("content-type") ?? "application/octet-stream",
        kind: "stream"
      };
    }

    return { kind: "redirect", location };
  }

  if (!initial.ok) {
    const body = await initial.text();
    return {
      body,
      contentType: initial.headers.get("content-type") ?? "application/json",
      kind: "error",
      status: initial.status
    };
  }

  if (!initial.body) {
    return {
      body: "Asset download returned an empty body.",
      contentType: "text/plain",
      kind: "error",
      status: 502
    };
  }

  return {
    body: initial.body,
    contentDisposition: initial.headers.get("content-disposition"),
    contentType: initial.headers.get("content-type") ?? "application/octet-stream",
    kind: "stream"
  };
}

/**
 * Rewrites legacy storage redirects into the authenticated asset download route so the
 * browser never opens an API-only /storage URL without a session token.
 */
function rewriteApiStorageRedirectToStream(
  location: string,
  apiBase: string,
  partId: string,
  assetId: string,
  downloadPathSuffix: "download" | "preview-artifact/download",
  searchParams: URLSearchParams
): string | null {
  try {
    const target = new URL(location);
    const base = new URL(`${apiBase}/`);

    if (target.origin !== base.origin || !target.pathname.startsWith("/storage/")) {
      return null;
    }

    const query = searchParams.toString();

    return `${apiBase}/parts/${encodeURIComponent(partId)}/assets/${encodeURIComponent(assetId)}/${downloadPathSuffix}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}
