/**
 * File header: Tests homepage local boot rendering for setup and explicit seed modes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getSearchFacetsFromRecords } from "@ee-library/shared/catalog-runtime";
import { getAllPartRecords } from "@ee-library/shared/search";
import SearchPage from "./page";

/**
 * Verifies the homepage renders setup instructions instead of crashing when DB is missing.
 */
test("homepage renders actionable setup state when DB is not configured and seed fallback is disabled", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse({
        dependencies: {
          database: "not_configured",
          objectStorage: "not_connected_phase_0",
          queue: "not_connected_phase_0"
        },
        service: "api",
        status: "ok"
      });
    }

    return jsonResponse(
      {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Catalog database is not configured. Set EE_LIBRARY_ALLOW_SEED_FALLBACK=true only for local development seed data."
        }
      },
      503
    );
  });

  try {
    const html = await renderHomepage();

    assert.match(html, /Connect Postgres or enable local seed mode/u);
    assert.match(html, /EE_LIBRARY_ALLOW_SEED_FALLBACK/u);
    assert.match(html, /No catalog records are shown here/u);
    assert.doesNotMatch(html, /matched records/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies explicit seed fallback renders useful sample catalog content with honest labels.
 */
test("homepage renders seed-mode catalog without implying DB-backed data", async () => {
  const records = getAllPartRecords();
  const facets = getSearchFacetsFromRecords(records);
  const warning = "Catalog database is not configured. Seed fallback is explicitly enabled for local development.";
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse({
        dependencies: {
          database: "not_configured",
          objectStorage: "not_connected_phase_0",
          queue: "not_connected_phase_0"
        },
        service: "api",
        status: "ok"
      });
    }

    if (url.pathname === "/parts/facets") {
      return jsonResponse({
        data: facets,
        source: "seed_fallback",
        warnings: [warning]
      });
    }

    return jsonResponse({
      data: records,
      source: "seed_fallback",
      warnings: [warning]
    });
  });

  try {
    const html = await renderHomepage();

    assert.match(html, /Local seed mode/u);
    assert.match(html, /deterministic local examples/u);
    assert.match(html, /not DB-backed catalog data/u);
    assert.match(html, /TPS7A02DBVR/u);
    assert.doesNotMatch(html, /Provider-neutral API/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Renders the server component with empty search params.
 */
async function renderHomepage(): Promise<string> {
  return renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({}) }));
}

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
