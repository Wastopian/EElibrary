/**
 * File header: Tests the root route renders the projects dashboard (same as /projects).
 * Catalog homepage behavior lives in catalog/page.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import RootPage from "./page";
import type { ProjectListResponse } from "@ee-library/shared/types";

/**
 * Verifies the site root renders the project memory dashboard instead of the catalog workbench.
 */
test("homepage renders the projects dashboard at the root route", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse({
        dependencies: {
          database: "connected",
          objectStorage: "not_connected_phase_0",
          queue: "not_connected_phase_0"
        },
        service: "api",
        status: "ok"
      });
    }

    if (url.pathname === "/projects") {
      return jsonResponse({
        data: {
          capabilities: [],
          projects: [],
          state: "empty"
        } satisfies ProjectListResponse,
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await RootPage({ searchParams: Promise.resolve({}) }));

    assert.match(html, /Project memory/u);
    assert.match(html, /Start your first project/u);
    assert.match(html, /Create project/u);
    assert.doesNotMatch(html, /Filter the readiness catalog/u);
    assert.doesNotMatch(html, /Quick part readiness check/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Replaces global fetch for one test and returns a restore callback.
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
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}
