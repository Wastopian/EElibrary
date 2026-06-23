/**
 * File header: Tests the new-cable authoring page renders the create form with project options.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import NewCablePage from "./page";

/**
 * Verifies the new-cable page renders the create form, boundary copy, and project options.
 */
test("new cable page renders the create form with a project picker", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/projects") {
      return jsonResponse({
        data: {
          capabilities: [],
          projects: [{ bomImportCount: 0, latestActivityAt: "2026-06-20T12:00:00.000Z", project: { createdAt: "2026-06-20T12:00:00.000Z", description: "", id: "project-alpha", name: "Alpha", owner: "hw", projectKey: "ALPHA", status: "active", updatedAt: "2026-06-20T12:00:00.000Z" }, revisionCount: 1, usageCount: 0 }],
          state: "available"
        },
        source: "database"
      });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await NewCablePage());

    assert.match(html, /New cable assembly/u);
    assert.match(html, /Engineering memory only/u);
    assert.match(html, /Cable ID/u);
    assert.match(html, /Create cable/u);
    assert.match(html, /ALPHA — Alpha/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the page still renders when the project list cannot be read.
 */
test("new cable page degrades to no project options when projects are unavailable", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/projects") {
      return jsonResponse({ error: { code: "DB_NOT_CONFIGURED", message: "unavailable" } }, 503);
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await NewCablePage());

    assert.match(html, /New cable assembly/u);
    assert.match(html, /No project/u);
  } finally {
    restoreFetch();
  }
});

/** Replaces global fetch with a tiny handler for the page test. */
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

/** Builds a JSON Response with stable headers for the API client. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });
}
