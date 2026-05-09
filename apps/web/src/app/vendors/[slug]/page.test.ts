/**
 * File header: Tests the vendor detail page rendering against the vendor API contract.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import VendorDetailPage from "./page";
import type { ProjectFolderEntry, Vendor, VendorDetailResponse } from "@ee-library/shared/types";

/**
 * Verifies the detail page surfaces vendor metadata, file/note counts, and the
 * workspace components when the vendor exists.
 */
test("vendor detail page renders vendor metadata and folder listings", async () => {
  const vendor = buildVendor({ slug: "jlcpcb", name: "JLCPCB", summary: "Low-cost prototype 1-4 layer." });
  const detail: VendorDetailResponse = {
    availability: "configured",
    rootPath: "/tmp/EE-Library/vendors",
    vendor,
    notes: [buildEntry("lead-time-observations.md")],
    files: [buildEntry("capability.pdf")],
    notesPath: "/tmp/EE-Library/vendors/pcb-fab/jlcpcb/notes",
    filesPath: "/tmp/EE-Library/vendors/pcb-fab/jlcpcb/files",
    message: null
  };

  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/vendors/jlcpcb") {
      return jsonResponse({ data: detail, source: "database" });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await render({ slug: "jlcpcb" });
    assert.match(html, /JLCPCB/u);
    assert.match(html, /Low-cost prototype 1-4 layer/u);
    assert.match(html, /lead-time-observations\.md/u);
    assert.match(html, /capability\.pdf/u);
    assert.match(html, /Notes and reference files/u);
    assert.match(html, /Workspace/u);
    assert.match(html, /Reference files/u);
    assert.match(html, /pcb-fab\/jlcpcb\/notes/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the detail page renders the calm "not found" panel when the vendor is missing.
 */
test("vendor detail page renders not-found state when the vendor does not exist", async () => {
  const detail: VendorDetailResponse = {
    availability: "configured",
    rootPath: "/tmp/EE-Library/vendors",
    vendor: null,
    notes: [],
    files: [],
    notesPath: null,
    filesPath: null,
    message: null
  };

  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/vendors/ghost") {
      return jsonResponse({ data: detail, source: "database" });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await render({ slug: "ghost" });
    assert.match(html, /find that supplier/u);
    assert.doesNotMatch(html, /\/vendors\/ghost/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the detail page renders the not-configured panel when the env var is disabled.
 */
test("vendor detail page renders not-configured state when the mirror is disabled", async () => {
  const detail: VendorDetailResponse = {
    availability: "not_configured",
    rootPath: null,
    vendor: null,
    notes: [],
    files: [],
    notesPath: null,
    filesPath: null,
    message: null
  };

  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/vendors/whatever") {
      return jsonResponse({ data: detail, source: "database" });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await render({ slug: "whatever" });
    assert.match(html, /supplier folder is not set up/iu);
  } finally {
    restoreFetch();
  }
});

/**
 * Renders the vendor detail server component to static markup with the supplied params.
 */
async function render(params: { slug: string }): Promise<string> {
  return renderToStaticMarkup(await VendorDetailPage({ params: Promise.resolve(params) }));
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
 * Builds one vendor record with calm defaults.
 */
function buildVendor(overrides: Partial<Vendor>): Vendor {
  return {
    slug: overrides.slug ?? "vendor",
    name: overrides.name ?? "Vendor",
    category: overrides.category ?? "pcb_fab",
    summary: overrides.summary ?? "",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-02T00:00:00.000Z"
  };
}

/**
 * Builds a folder entry payload representing a regular file.
 */
function buildEntry(name: string): ProjectFolderEntry {
  return {
    name,
    sizeBytes: 1024,
    modifiedAt: "2026-04-01T00:00:00.000Z",
    isFile: true
  };
}
