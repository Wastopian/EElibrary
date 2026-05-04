/**
 * File header: Tests homepage local boot rendering for setup and explicit seed modes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getSearchFacetsFromRecords } from "@ee-library/shared/catalog-runtime";
import { getAllPartRecords } from "@ee-library/shared/search";
import { importUiCopy } from "../lib/import-ui-copy";
import RootPage from "./page";

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
    assert.match(html, /Backend unavailable/u);
    assert.match(html, /EE_LIBRARY_ALLOW_SEED_FALLBACK/u);
    assert.match(html, /No catalog records are shown here/u);
    assert.match(html, new RegExp(importUiCopy.catalogAcquisitionUnavailableSetup, "u"));
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

    // Honest seed-mode framing — the page must label seed data clearly, not as DB-backed.
    assert.match(html, /Local seed mode/u);
    assert.match(html, /Deterministic seed examples/u);
    assert.match(html, /not DB-backed catalog data/u);

    // Core quick-check workspace surfaces stay visible even when DB is missing.
    assert.match(html, /Catalog workbench/u);
    assert.match(html, /MPN, manufacturer, provider id, or keyword/u);
    assert.match(html, /Provider or datasheet lookup context/u);
    assert.match(html, /Provider part reference/u);
    assert.match(html, /Provider URL/u);
    assert.match(html, /0430250200/u);

    // Filter rail, results panel, and catalog presentation modes render in seed mode.
    assert.match(html, /Refine results/u);
    assert.match(html, /Import by MPN/u);
    assert.match(html, /CAD files for export/u);
    assert.match(html, /List/u);
    assert.match(html, /Table/u);

    // A representative seed MPN must surface — confirms records flow through render.
    assert.match(html, /TPS7A02DBVR/u);

    // Negative: do not render the legacy "Provider-neutral API" header.
    assert.doesNotMatch(html, /Provider-neutral API/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies a query renders an explanation-first quick readiness result from catalog data.
 */
test("homepage renders quick readiness result from matched catalog record", async () => {
  const records = getAllPartRecords();
  const facets = getSearchFacetsFromRecords(records);
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

    if (url.pathname === "/parts/facets") {
      return jsonResponse({
        data: facets,
        source: "database"
      });
    }

    return jsonResponse({
      data: records.filter((record) => record.part.mpn === "TPS7A02DBVR"),
      pagination: {
        page: 1,
        pageSize: 20,
        sort: "mpn_asc",
        totalPages: 1,
        totalRecords: 1
      },
      source: "database"
    });
  });

  try {
    const html = await renderHomepage({ q: "TPS7A02DBVR" });

    // Quick readiness panel: headline blocker + bundle truth.
    assert.match(html, /Blocked/u);
    assert.match(html, /Export bundle: partial bundle/u);

    // Result-action surfaces. The admin link renders as "Open admin queue" (lowercase q),
    // so the test now matches the actual rendered text instead of an outdated capitalized label.
    assert.match(html, /Open Full Record/u);
    assert.match(html, /Clear/u);
    assert.match(html, /View in Queue/u);
    assert.match(html, /Open admin queue/u);

    // Active-filter pill summary.
    assert.match(html, /Current filters/u);
    assert.match(html, /Query: TPS7A02DBVR/u);

    // Identity confirmation and source row badges.
    assert.match(html, /Identity confirmed/u);
    assert.match(html, /source row/u);

    // Generated-CAD truth surface — partial-readiness state must say generated CAD needs review.
    assert.match(html, /generated CAD/iu);

    // Negative: don't accidentally claim the part is "approved" when it isn't.
    assert.doesNotMatch(html, /approved part/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies connector quick readiness results elevate mating-part context near the top triage result.
 */
test("homepage renders connector mating preview from stored buildable set data", async () => {
  const records = getAllPartRecords();
  const connectorRecord = records.find((record) => record.part.mpn === "215079-8");

  assert.ok(connectorRecord, "expected connector seed record");

  const facets = getSearchFacetsFromRecords([connectorRecord]);
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

    if (url.pathname === "/parts/facets") {
      return jsonResponse({ data: facets, source: "database" });
    }

    return jsonResponse({
      data: [connectorRecord],
      pagination: {
        page: 1,
        pageSize: 20,
        sort: "mpn_asc",
        totalPages: 1,
        totalRecords: 1
      },
      source: "database"
    });
  });

  try {
    const html = await renderHomepage({ q: connectorRecord.part.mpn });

    assert.match(html, /Mating Parts/u);
    assert.match(html, /Best mate/u);
    assert.match(html, /Required accessories/u);
    assert.match(html, /Connector/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies an ambiguous quick readiness query lists candidates instead of choosing silently.
 */
test("homepage renders ambiguous quick readiness state from multiple matches", async () => {
  const records = getAllPartRecords().slice(0, 2);
  const facets = getSearchFacetsFromRecords(records);
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

    if (url.pathname === "/parts/facets") {
      return jsonResponse({ data: facets, source: "database" });
    }

    return jsonResponse({
      data: records,
      pagination: {
        page: 1,
        pageSize: 20,
        sort: "mpn_asc",
        totalPages: 1,
        totalRecords: 2
      },
      source: "database"
    });
  });

  try {
    const html = await renderHomepage({ q: "connector" });

    assert.match(html, /Ambiguous match/u);
    assert.match(html, /2 catalog records matched/u);
    assert.match(html, /Open the correct part/u);
    assert.doesNotMatch(html, /Readiness Checks/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies partial readiness data is explicit when backend records lack key families.
 */
test("homepage renders partial readiness data state from incomplete record", async () => {
  const [baseRecord] = getAllPartRecords();

  assert.ok(baseRecord, "expected seed record");

  const partialRecord = {
    ...structuredClone(baseRecord),
    assets: [],
    datasheetRevision: null,
    metrics: [],
    sources: []
  };
  const facets = getSearchFacetsFromRecords([partialRecord]);
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

    if (url.pathname === "/parts/facets") {
      return jsonResponse({ data: facets, source: "database" });
    }

    return jsonResponse({
      data: [partialRecord],
      pagination: {
        page: 1,
        pageSize: 20,
        sort: "mpn_asc",
        totalPages: 1,
        totalRecords: 1
      },
      source: "database"
    });
  });

  try {
    const html = await renderHomepage({ q: partialRecord.part.mpn });

    assert.match(html, /partial readiness data/u);
    assert.match(html, /missing source provenance, normalized metrics, asset records, datasheet revision metadata/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies no-match state remains explicit and does not fabricate readiness.
 */
test("homepage renders direct exact-MPN import CTA for DB-backed concrete no-match queries", async () => {
  const records = getAllPartRecords();
  const facets = getSearchFacetsFromRecords(records);
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

    if (url.pathname === "/parts/facets") {
      return jsonResponse({ data: facets, source: "database" });
    }

    return jsonResponse({
      data: [],
      pagination: {
        page: 1,
        pageSize: 20,
        sort: "mpn_asc",
        totalPages: 1,
        totalRecords: 0
      },
      source: "database"
    });
  });

  try {
    const html = await renderHomepage({ q: "TPS7A02DBVR-999" });

    assert.match(html, /Part not found/u);
    assert.match(html, /will not create a readiness answer without backend data/u);
    assert.match(html, new RegExp(importUiCopy.catalogAcquisitionLead, "u"));
    assert.match(html, new RegExp(importUiCopy.catalogAcquisitionNote, "u"));
    assert.match(html, new RegExp(importUiCopy.buttonAcquireNoMatch, "u"));
    assert.doesNotMatch(html, new RegExp(importUiCopy.buttonSearchProviders, "u"));
    assert.doesNotMatch(html, /Readiness Checks/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies numeric-only MPN lookups still expose direct no-match acquisition when the catalog has no row yet.
 */
test("homepage shows direct import CTA for numeric-only no-match lookups", async () => {
  const records = getAllPartRecords();
  const facets = getSearchFacetsFromRecords(records);
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

    if (url.pathname === "/parts/facets") {
      return jsonResponse({ data: facets, source: "database" });
    }

    return jsonResponse({
      data: [],
      pagination: {
        page: 1,
        pageSize: 20,
        sort: "mpn_asc",
        totalPages: 1,
        totalRecords: 0
      },
      source: "database"
    });
  });

  try {
    const html = await renderHomepage({ q: "0430250200" });

    assert.match(html, /Part not found/u);
    assert.match(html, new RegExp(importUiCopy.buttonAcquireNoMatch, "u"));
    assert.doesNotMatch(html, new RegExp(importUiCopy.buttonSearchProviders, "u"));
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies package-style misses stay honest instead of exposing a live-search style acquisition CTA.
 */
test("homepage keeps catalog acquisition unavailable for package-style no-match queries", async () => {
  const records = getAllPartRecords();
  const facets = getSearchFacetsFromRecords(records);
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

    if (url.pathname === "/parts/facets") {
      return jsonResponse({ data: facets, source: "database" });
    }

    return jsonResponse({
      data: [],
      pagination: {
        page: 1,
        pageSize: 20,
        sort: "mpn_asc",
        totalPages: 1,
        totalRecords: 0
      },
      source: "database"
    });
  });

  try {
    const html = await renderHomepage({ q: "QFN-16" });

    assert.match(html, /Part not found/u);
    assert.match(html, new RegExp(importUiCopy.unavailableLead, "u"));
    assert.match(html, /does not run live provider search for generic keywords/u);
    assert.doesNotMatch(html, new RegExp(importUiCopy.buttonAcquireNoMatch, "u"));
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies normal homepage search does not auto-run provider lookup or provider import during server render.
 */
test("homepage does not automatically call provider lookup or import during normal catalog search", async () => {
  const records = getAllPartRecords();
  const facets = getSearchFacetsFromRecords(records);
  const requestedPaths: string[] = [];
  const restoreFetch = mockFetch((url) => {
    requestedPaths.push(url.pathname);

    if (url.pathname === "/provider-lookups") {
      throw new Error("provider lookup should not run during initial search render");
    }

    if (url.pathname === "/imports/provider") {
      throw new Error("provider import should not run during initial search render");
    }

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

    if (url.pathname === "/parts/facets") {
      return jsonResponse({ data: facets, source: "database" });
    }

    return jsonResponse({
      data: [],
      pagination: {
        page: 1,
        pageSize: 20,
        sort: "mpn_asc",
        totalPages: 1,
        totalRecords: 0
      },
      source: "database"
    });
  });

  try {
    await renderHomepage({ q: "TPS7A02DBVR-999" });

    assert.deepEqual(requestedPaths, ["/health", "/parts/facets", "/parts"]);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies seed-mode no-match states keep catalog acquisition honest instead of implying DB-backed import availability.
 */
test("homepage keeps catalog acquisition unavailable when no-match runs in seed fallback", async () => {
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
      data: [],
      pagination: {
        page: 1,
        pageSize: 20,
        sort: "mpn_asc",
        totalPages: 1,
        totalRecords: 0
      },
      source: "seed_fallback",
      warnings: [warning]
    });
  });

  try {
    const html = await renderHomepage({ q: "TPS7A02DBVR-999" });

    assert.match(html, /Part not found/u);
    assert.match(html, new RegExp(importUiCopy.unavailableLead, "u"));
    assert.match(html, /local seed examples/u);
    assert.doesNotMatch(html, new RegExp(importUiCopy.buttonAcquireNoMatch, "u"));
  } finally {
    restoreFetch();
  }
});

/**
 * Renders the server component with empty search params.
 */
async function renderHomepage(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await RootPage({ searchParams: Promise.resolve(searchParams) }));
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
