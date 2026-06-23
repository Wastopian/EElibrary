/**
 * File header: Tests API-client token minting behavior that server actions depend on.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssetDownloadUrl,
  buildAssetPreviewArtifactDownloadUrl,
  buildExportBundleDownloadUrl,
  requestProviderImport,
  setApiClientServerCookieReaderForTests
} from "./api-client";

test("browser-facing file URLs use the same-origin API proxy during SSR", () => {
  assert.equal(buildAssetDownloadUrl("part/a", "asset b"), "/api-proxy/parts/part%2Fa/assets/asset%20b/download");
  assert.equal(
    buildAssetPreviewArtifactDownloadUrl("part/a", "asset b"),
    "/api-proxy/parts/part%2Fa/assets/asset%20b/preview-artifact/download"
  );
  assert.equal(buildExportBundleDownloadUrl("bundles/project one.zip"), "/api-proxy/storage/bundles%2Fproject%20one.zip");
  assert.equal(buildExportBundleDownloadUrl(null), null);
});

test("server-side API writes forward the current session cookie when minting an API token", async () => {
  const previousFetch = globalThis.fetch;
  const previousNextAuthUrl = process.env.NEXTAUTH_URL;
  const previousApiBaseUrl = process.env.EE_LIBRARY_API_BASE_URL;
  const sessionCookie = "authjs.session-token=server-action-session";
  let tokenRequestCookie: string | null = null;
  let importRequestAuthorization: string | null = null;

  process.env.NEXTAUTH_URL = "http://web.test";
  process.env.EE_LIBRARY_API_BASE_URL = "http://api.test";
  setApiClientServerCookieReaderForTests(() => sessionCookie);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());

    if (url.toString() === "http://web.test/api/token") {
      tokenRequestCookie = readHeader(init?.headers, "cookie");
      return tokenRequestCookie === sessionCookie
        ? jsonResponse({ token: "server-action-token" })
        : jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (url.toString() === "http://api.test/imports/provider") {
      importRequestAuthorization = readHeader(init?.headers, "authorization");
      return jsonResponse({
        data: {
          importStatus: "imported",
          outcome: "new_import",
          partId: "part-from-server-action",
          previousImportStatus: null,
          providerId: "local-catalog",
          providerPartKey: "TPS7A02",
          requestedLookup: "TPS7A02"
        },
        source: "database"
      });
    }

    throw new Error(`Unexpected API-client auth test fetch: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await requestProviderImport({
      datasheetUrl: null,
      manufacturerName: "Texas Instruments",
      mpn: "TPS7A02",
      providerId: "local-catalog",
      providerPartId: null,
      providerUrl: null
    });

    assert.equal(result.partId, "part-from-server-action");
    assert.equal(tokenRequestCookie, sessionCookie);
    assert.equal(importRequestAuthorization, "Bearer server-action-token");
  } finally {
    globalThis.fetch = previousFetch;
    setApiClientServerCookieReaderForTests(null);
    restoreOptionalEnv("NEXTAUTH_URL", previousNextAuthUrl);
    restoreOptionalEnv("EE_LIBRARY_API_BASE_URL", previousApiBaseUrl);
  }
});

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;

  if (headers instanceof Headers) {
    return headers.get(name);
  }

  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1] ?? null;
  }

  const record = headers as Record<string, string>;
  return record[name] ?? record[capitalizeHeaderName(name)] ?? null;
}

function capitalizeHeaderName(name: string): string {
  return name.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join("-");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}

function restoreOptionalEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
