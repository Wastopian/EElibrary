/**
 * File header: Tests catalog search page rendering for setup, ready, filter, and quick-check states.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getAllPartRecords } from "@ee-library/shared/search";
import SearchPage from "./page";
import type { PartSearchRecord, SearchFacets, SearchPagination } from "@ee-library/shared/types";

test("catalog page renders setup guidance when API returns DB_NOT_CONFIGURED", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("not_configured"));
    }

    return jsonResponse(
      { error: { code: "DB_NOT_CONFIGURED", message: "Catalog database is not configured." } },
      503
    );
  });

  try {
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({}) }));

    assert.match(html, /Quick part readiness check unavailable/u);
    assert.match(html, /DB_NOT_CONFIGURED/u);
    assert.match(html, /catalog database is not connected yet/u);
    assert.match(html, /Search will be available after setup/u);
    assert.match(html, /Finish setup to search parts/u);
    assert.doesNotMatch(html, /Filter the readiness catalog/u);
  } finally {
    restoreFetch();
  }
});

test("catalog page renders compact filter bar and explanation-first list results for mocked DB-backed response", async () => {
  const records = getAllPartRecords();
  const record = records[0];

  assert.ok(record, "expected at least one seed record");

  const restoreFetch = mockFetch(buildReadyFetchHandler([record]));

  try {
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({}) }));

    assert.match(html, /Refine results/u);
    assert.match(html, /Search results/u);
    assert.match(html, /1 matches/u);
    assert.match(html, /Live catalog/u);
    assert.match(html, /Catalog workbench/u);
    assert.match(html, /File status/u);
    assert.match(html, /Verification steps/u);
    assert.match(html, /Connector intelligence/u);
    assert.match(html, /Rows per page/u);
    assert.match(html, /First time here\?/u);
    assert.match(html, /Catalog first-run checklist/u);
    assert.doesNotMatch(html, /<details class="catalog-getting-started" open="">/u);
  } finally {
    restoreFetch();
  }
});

test("catalog page collapses first-run guidance when active search context exists", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(record, "expected seed TPS7A02DBVR part");

  const restoreFetch = mockFetch(buildReadyFetchHandler([record], { totalRecords: 1 }));

  try {
    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ q: record.part.mpn }) })
    );

    assert.match(html, /Catalog workbench/u);
    assert.match(html, /Current filters/u);
    assert.match(html, /Query: TPS7A02DBVR/u);
    assert.doesNotMatch(html, /Your engineering memory for parts/u);
    assert.doesNotMatch(html, /site-intro__path/u);
    assert.doesNotMatch(html, /<details class="catalog-getting-started" open="">/u);
  } finally {
    restoreFetch();
  }
});

test("catalog page shows active filter pills when lifecycle and sort params are set", async () => {
  const records = getAllPartRecords();
  const record = records[0];

  assert.ok(record, "expected at least one seed record");

  const restoreFetch = mockFetch(buildReadyFetchHandler([record]));

  try {
    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ lifecycleStatus: "active", sort: "trust_desc" }) })
    );

    assert.match(html, /Current filters/u);
    assert.match(html, /Lifecycle: Active/u);
    assert.match(html, /Sort: Trust score/u);
  } finally {
    restoreFetch();
  }
});

test("catalog page renders category facet options with counts and reflects an active category filter", async () => {
  const records = getAllPartRecords();
  const record = records[0];

  assert.ok(record, "expected at least one seed record");

  const facets: SearchFacets = {
    approvalStatuses: [],
    categories: ["Connectors / USB", "Resistors / Chip Resistor"],
    connectorClasses: [],
    counts: {
      approvalStatuses: { approved: 0, not_applicable: 0, not_requested: 0, pending_review: 0 },
      cadAvailability: { any: 5, available: 1, unavailable: 4 },
      categories: { "Connectors / USB": 3, "Resistors / Chip Resistor": 2 },
      connectorClasses: { accessory: 0, cable: 0, connector: 0, non_connector: 0, tooling: 0 },
      lifecycleStatuses: { active: 0, not_recommended: 0, obsolete: 0, unknown: 0 },
      manufacturers: {},
      packages: {},
      readinessStatuses: { blocked: 0, needs_attention: 0, ready_for_export_review: 0, unknown: 0 }
    },
    lifecycleStatuses: [],
    manufacturers: [],
    packages: [],
    readinessStatuses: []
  };

  const pagination = buildPagination(1);
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname.startsWith("/parts/facets")) {
      return jsonResponse({ data: facets, source: "database" });
    }

    return jsonResponse({ data: [record], source: "database", pagination });
  });

  try {
    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ category: "Connectors / USB" }) })
    );

    assert.match(html, /Connectors \/ USB \(3\)/u);
    assert.match(html, /Resistors \/ Chip Resistor \(2\)/u);
    assert.match(html, /Category: Connectors \/ USB/u);
  } finally {
    restoreFetch();
  }
});

test("catalog page shows idle quick-check panel when no query is provided", async () => {
  const records = getAllPartRecords();
  const record = records[0];

  assert.ok(record, "expected at least one seed record");

  const restoreFetch = mockFetch(buildReadyFetchHandler([record]));

  try {
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({}) }));

    assert.match(html, /Find a part to check/u);
    assert.doesNotMatch(html, /Open Full Record/u);
  } finally {
    restoreFetch();
  }
});

test("catalog page shows matched quick-check result when exactly one record matches the query", async () => {
  const records = getAllPartRecords();
  const record = records.find((candidate) => candidate.part.id === "part-tps7a02dbvr");

  assert.ok(record, "expected seed TPS7A02DBVR part");

  const restoreFetch = mockFetch(buildReadyFetchHandler([record], { totalRecords: 1 }));

  try {
    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ q: record.part.mpn }) })
    );

    assert.match(html, new RegExp(record.part.mpn, "u"));
    assert.match(html, /Open Full Record/u);
    assert.match(html, /Readiness Checks/u);
    assert.doesNotMatch(html, /Find a part to check/u);
    assert.doesNotMatch(html, /Part not found/u);
  } finally {
    restoreFetch();
  }
});

test("catalog page shows no-match state with provider lookup panel for concrete MPN query", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname.startsWith("/parts/facets")) {
      return jsonResponse({ data: buildEmptyFacets(), source: "database" });
    }

    return jsonResponse({ data: [], source: "database", pagination: buildPagination(0) });
  });

  try {
    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ q: "TPS7A02DBVR" }) })
    );

    assert.match(html, /Part not found/u);
    assert.match(html, /TPS7A02DBVR/u);
    assert.match(html, /Import exact part number/u);
    assert.match(html, /Import this exact part number/u);
  } finally {
    restoreFetch();
  }
});

test("catalog page shows no-match state without provider lookup for generic keyword query", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname.startsWith("/parts/facets")) {
      return jsonResponse({ data: buildEmptyFacets(), source: "database" });
    }

    return jsonResponse({ data: [], source: "database", pagination: buildPagination(0) });
  });

  try {
    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ q: "voltage regulator" }) })
    );

    assert.match(html, /Part not found/u);
    assert.match(html, /Catalog acquisition is unavailable here/u);
    assert.doesNotMatch(html, /Import exact part number/u);
  } finally {
    restoreFetch();
  }
});

test("catalog page shows ambiguous match when multiple records match the query", async () => {
  const allRecords = getAllPartRecords();
  const records = allRecords.slice(0, 2);

  assert.equal(records.length, 2, "expected at least 2 seed records");

  const restoreFetch = mockFetch(buildReadyFetchHandler(records, { totalRecords: 2 }));

  try {
    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ q: "resistor" }) })
    );

    assert.match(html, /Multiple matches/u);
    assert.match(html, /2 catalog records matched/u);
    assert.doesNotMatch(html, /Find a part to check/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Builds a mock fetch handler for the "ready" happy path with optional pagination overrides.
 */
function buildReadyFetchHandler(
  records: PartSearchRecord[],
  paginationOverrides?: Partial<SearchPagination>
): (url: URL) => Response {
  const pagination = buildPagination(records.length, paginationOverrides);

  return (url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname.startsWith("/parts/facets")) {
      return jsonResponse({ data: buildEmptyFacets(), source: "database" });
    }

    return jsonResponse({ data: records, source: "database", pagination });
  };
}

/**
 * Builds a minimal API health response payload.
 */
function buildHealthResponse(database: "connected" | "not_configured" | "unavailable") {
  return {
    dependencies: {
      database,
      objectStorage: "not_connected_phase_0",
      queue: "not_connected_phase_0"
    },
    service: "api",
    status: "ok"
  };
}

/**
 * Builds an empty SearchFacets object for tests that do not exercise facet rendering.
 */
function buildEmptyFacets(): SearchFacets {
  return {
    approvalStatuses: [],
    categories: [],
    connectorClasses: [],
    lifecycleStatuses: [],
    manufacturers: [],
    packages: [],
    readinessStatuses: []
  };
}

/**
 * Builds a SearchPagination object for test API responses.
 */
function buildPagination(totalRecords: number, overrides?: Partial<SearchPagination>): SearchPagination {
  return {
    page: 1,
    pageSize: 20,
    sort: "mpn_asc",
    totalPages: Math.max(1, Math.ceil(totalRecords / 20)),
    totalRecords,
    ...overrides
  };
}

/**
 * Replaces global fetch for catalog API calls and returns a restore callback.
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
