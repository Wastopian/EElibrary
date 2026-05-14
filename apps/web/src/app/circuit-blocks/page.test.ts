/**
 * File header: Tests the reusable circuit block library page renders filters, reuse-readiness
 * badges, and honest empty states for engineering teams scanning the library.
 *
 * The page must:
 *   - Forward filter searchParams to the API as query parameters.
 *   - Surface a Reuse-readiness verdict per row that mirrors the detail strip.
 *   - Distinguish "no blocks yet" from "no blocks match these filters" so engineers know
 *     whether to clear filters or seed the library.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CircuitBlocksPage from "./page";
import type {
  CircuitBlock,
  CircuitBlockListFilters,
  CircuitBlockListResponse,
  CircuitBlockSummary
} from "@ee-library/shared/types";

/**
 * Verifies the library page renders the full library, a reuse-readiness verdict per row,
 * and a snapshot strip with the ready / blocked counts when no filters are applied.
 */
test("circuit block library renders reuse-readiness column for every row", async () => {
  const captured: { url?: URL } = {};
  const restoreFetch = mockFetch((url) => {
    captured.url = url;
    if (url.pathname === "/circuit-blocks") {
      return jsonResponse({
        data: buildCircuitBlockListResponse({
          circuitBlocks: [buildAlphaSummary(), buildBetaSummary()],
          filters: nullFilters()
        }),
        source: "database"
      });
    }
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse());
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderCircuitBlocksPage({});

    assert.equal(captured.url?.searchParams.size, 0, "no filters means no query params");
    assert.match(html, /ALPHA-POWER/u);
    assert.match(html, /BETA-USB/u);
    assert.match(html, /Ready to reuse/u);
    assert.match(html, /Blocked at parts ready/u);
    assert.match(html, /All circuit blocks/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies filter searchParams are forwarded to the API and reflected in the UI.
 */
test("circuit block library forwards filter searchParams to the API", async () => {
  const captured: { url?: URL } = {};
  const restoreFetch = mockFetch((url) => {
    captured.url = url;
    if (url.pathname === "/circuit-blocks") {
      return jsonResponse({
        data: buildCircuitBlockListResponse({
          circuitBlocks: [buildAlphaSummary()],
          filters: {
            blockType: "power",
            owner: null,
            query: "alpha",
            reuseReadiness: null,
            status: null
          }
        }),
        source: "database"
      });
    }
    return jsonResponse(buildHealthResponse());
  });

  try {
    const html = await renderCircuitBlocksPage({ q: "alpha", type: "power" });

    assert.equal(captured.url?.searchParams.get("q"), "alpha");
    assert.equal(captured.url?.searchParams.get("type"), "power");
    assert.match(html, /Filtered library/u);
    assert.match(html, /ALPHA-POWER/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the empty state distinguishes "no library yet" from "no matches for current filters".
 */
test("circuit block library shows filter-aware empty state when nothing matches", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/circuit-blocks") {
      return jsonResponse({
        data: buildCircuitBlockListResponse({
          circuitBlocks: [],
          filters: {
            blockType: null,
            owner: null,
            query: null,
            reuseReadiness: "reusable",
            status: null
          },
          state: "empty"
        }),
        source: "database"
      });
    }
    return jsonResponse(buildHealthResponse());
  });

  try {
    const html = await renderCircuitBlocksPage({ readiness: "reusable" });

    assert.match(html, /No blocks match these filters/u);
    assert.match(html, /Clear the search/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies an empty library (no filters, no rows) still reads as "no circuit blocks yet".
 */
test("circuit block library shows seed empty state when no filters and no rows", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/circuit-blocks") {
      return jsonResponse({
        data: buildCircuitBlockListResponse({
          circuitBlocks: [],
          filters: nullFilters(),
          state: "empty"
        }),
        source: "database"
      });
    }
    return jsonResponse(buildHealthResponse());
  });

  try {
    const html = await renderCircuitBlocksPage({});

    assert.match(html, /No circuit blocks yet/u);
    assert.match(html, /Create a block below/u);
  } finally {
    restoreFetch();
  }
});

async function renderCircuitBlocksPage(searchParams: Record<string, string | string[] | undefined>): Promise<string> {
  return renderToStaticMarkup(await CircuitBlocksPage({ searchParams: Promise.resolve(searchParams) }));
}

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}

function nullFilters(): CircuitBlockListFilters {
  return {
    blockType: null,
    owner: null,
    query: null,
    reuseReadiness: null,
    status: null
  };
}

function buildCircuitBlockListResponse(input: {
  circuitBlocks: CircuitBlockSummary[];
  filters: CircuitBlockListFilters;
  state?: "available" | "empty";
}): CircuitBlockListResponse {
  return {
    circuitBlocks: input.circuitBlocks,
    filters: input.filters,
    state: input.state ?? (input.circuitBlocks.length > 0 ? "available" : "empty")
  };
}

function buildHealthResponse() {
  return {
    dependencies: { database: "connected" as const, objectStorage: "connected", queue: "connected" },
    service: "ee-api",
    status: "ok"
  };
}

/**
 * Returns a summary whose headline collapses to "Ready to reuse" — every required role
 * approved and no readiness gaps.
 */
function buildAlphaSummary(): CircuitBlockSummary {
  return {
    activeBlockingRiskCount: 0,
    activeKnownRiskCount: 0,
    approvedPartCount: 1,
    circuitBlock: buildBlock({
      blockKey: "ALPHA-POWER",
      blockType: "power",
      name: "Alpha power rail",
      reuseScope: "Memory test rails",
      status: "approved"
    }),
    evidenceAttachmentCount: 1,
    lifecycleRiskCount: 0,
    optionalPartCount: 0,
    projectUsageCount: 1,
    readinessGapCount: 0,
    requiredPartCount: 1,
    strictSubstitutionCount: 0,
    totalPartCount: 1
  };
}

/**
 * Returns a summary whose headline collapses to "Blocked at parts ready" — one required
 * role still has a readiness gap on the linked part.
 */
function buildBetaSummary(): CircuitBlockSummary {
  return {
    activeBlockingRiskCount: 0,
    activeKnownRiskCount: 0,
    approvedPartCount: 0,
    circuitBlock: buildBlock({
      blockKey: "BETA-USB",
      blockType: "protection",
      name: "USB input protection",
      reuseScope: "USB device ports",
      status: "approved"
    }),
    evidenceAttachmentCount: 0,
    lifecycleRiskCount: 0,
    optionalPartCount: 0,
    projectUsageCount: 0,
    readinessGapCount: 1,
    requiredPartCount: 1,
    strictSubstitutionCount: 0,
    totalPartCount: 1
  };
}

function buildBlock(input: Partial<CircuitBlock> & { blockKey: string; blockType: CircuitBlock["blockType"]; status: CircuitBlock["status"] }): CircuitBlock {
  return {
    blockKey: input.blockKey,
    blockType: input.blockType,
    constraints: {},
    createdAt: "2026-05-01T12:00:00.000Z",
    description: "Reusable block fixture.",
    id: `cblock-${input.blockKey.toLowerCase()}`,
    name: input.name ?? input.blockKey,
    owner: "Hardware",
    reuseScope: input.reuseScope ?? "Memory test scope",
    status: input.status,
    updatedAt: "2026-05-01T13:00:00.000Z"
  };
}
