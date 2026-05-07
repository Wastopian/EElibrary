/**
 * File header: Tests the compare workspace route states against catalog detail API failures.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompareNoPartsRecovery } from "../../components/CompareRecoveryStates";
import ComparePage from "./page";

/**
 * Verifies first-run compare guidance sends operators to normal workspaces instead of URL editing.
 */
test("compare empty recovery points users to catalog and projects", () => {
  const html = renderToStaticMarkup(React.createElement(CompareNoPartsRecovery));

  assert.match(html, /No parts selected/u);
  assert.match(html, /Find parts in Catalog/u);
  assert.match(html, /Open project BOMs/u);
  assert.doesNotMatch(html, /URL query string/u);
  assert.doesNotMatch(html, /\?parts/u);
});

/**
 * Verifies catalog setup failures render as setup guidance instead of an empty comparison.
 */
test("compare page renders setup guidance when detail records are unavailable", async () => {
  const restoreFetch = mockFetch((url) => {
    if (/^\/parts\/[^/]+$/u.test(url.pathname)) {
      return jsonResponse(
        {
          error: {
            code: "DB_NOT_CONFIGURED",
            message: "Catalog database is not configured."
          }
        },
        503
      );
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await ComparePage({ searchParams: Promise.resolve({ parts: "part-tps7a02dbvr" }) }));

    assert.match(html, /Part comparison/u);
    assert.match(html, /Connect the catalog database/u);
    assert.match(html, /Compare unavailable/u);
    assert.match(html, /DB_NOT_CONFIGURED/u);
    assert.doesNotMatch(html, /No matching parts found/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Replaces global fetch with a small compare API handler.
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
