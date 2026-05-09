/**
 * File header: Tests the vendor notebook list page rendering against the vendor API contract.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import VendorsPage from "./page";
import type { Vendor, VendorListResponse, VendorSummary } from "@ee-library/shared/types";

/**
 * Verifies a configured vendor notebook with no records renders the empty state and
 * surfaces the "Add vendor" call to action so engineers know what to do next.
 */
test("vendors page renders the empty state when no vendors exist", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/vendors") {
      return jsonResponse({
        data: buildVendorListResponse([]),
        source: "database"
      });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderVendorsPage();
    assert.match(html, /Who we use/u);
    assert.match(html, /No suppliers yet/u);
    assert.match(html, /Add your first supplier/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies persisted vendor summaries render as navigable rows grouped by category.
 */
test("vendors page renders persisted vendor summaries grouped by category", async () => {
  const summaries: VendorSummary[] = [
    {
      vendor: buildVendor({ slug: "jlcpcb", name: "JLCPCB", category: "pcb_fab", summary: "Low-cost prototype 1-4 layer." }),
      noteCount: 2,
      fileCount: 1
    },
    {
      vendor: buildVendor({ slug: "acme-sheet", name: "Acme Sheet Metal", category: "sheet_metal", summary: "Tight bend tolerances." }),
      noteCount: 0,
      fileCount: 3
    }
  ];

  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/vendors") {
      return jsonResponse({
        data: buildVendorListResponse(summaries),
        source: "database"
      });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderVendorsPage();
    assert.match(html, /Who we use/u);
    assert.match(html, /Your suppliers/u);
    assert.match(html, /JLCPCB/u);
    assert.match(html, /Low-cost prototype 1-4 layer/u);
    assert.match(html, /Acme Sheet Metal/u);
    assert.match(html, /Tight bend tolerances/u);
    assert.match(html, /href="\/vendors\/jlcpcb"/u);
    assert.match(html, /href="\/vendors\/acme-sheet"/u);
    assert.match(html, /PCB fab/u);
    assert.match(html, /Sheet metal/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the page renders a calm not-configured state when the env var is disabled.
 */
test("vendors page renders not-configured state when the mirror is disabled", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/vendors") {
      return jsonResponse({
        data: {
          availability: "not_configured",
          rootPath: null,
          vendors: [],
          message: null
        } satisfies VendorListResponse,
        source: "database"
      });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderVendorsPage();
    assert.match(html, /Supplier list is not set up/u);
    assert.match(html, /EE_LIBRARY_VENDOR_NOTES_ROOT/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Renders the vendor dashboard server component to static markup.
 */
async function renderVendorsPage(): Promise<string> {
  return renderToStaticMarkup(await VendorsPage());
}

/**
 * Replaces global fetch with a vendor API handler for the duration of one test.
 */
function mockFetch(handler: (url: URL) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

/**
 * Builds a JSON Response with stable headers for the API client.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}

/**
 * Builds a typed vendor list response for the test fetch handler.
 */
function buildVendorListResponse(vendors: VendorSummary[]): VendorListResponse {
  return {
    availability: "configured",
    rootPath: "/tmp/EE-Library/vendors",
    vendors,
    message: null
  };
}

/**
 * Builds one vendor record with calm defaults so tests stay focused on behavior.
 */
function buildVendor(overrides: Partial<Vendor>): Vendor {
  return {
    slug: overrides.slug ?? "vendor",
    name: overrides.name ?? "Vendor",
    category: overrides.category ?? "other",
    summary: overrides.summary ?? "",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-02T00:00:00.000Z"
  };
}
