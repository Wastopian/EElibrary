/**
 * File header: Tests the global where-used page against project usage and circuit dependency contracts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import WhereUsedPage from "./page";
import type { WhereUsedSearchResponse } from "@ee-library/shared/types";

/**
 * Verifies global part where-used renders confirmed project usage and block dependency context.
 */
test("where-used page renders part usage and circuit block dependencies", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/where-used") {
      assert.equal(url.searchParams.get("targetType"), "part");
      assert.equal(url.searchParams.get("q"), "TPS7A02DBVR");

      return jsonResponse({
        data: buildWhereUsedResponse(),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderWhereUsedPage({ q: "TPS7A02DBVR", targetType: "part" });

    assert.match(html, /Usage and dependency search/u);
    assert.match(html, /ALPHA/u);
    assert.match(html, /TPS7A02DBVR/u);
    assert.match(html, /Main LDO/u);
    assert.match(html, /Direct part usage/u);
    assert.match(html, /Trust boundary/u);
    assert.match(html, /href="\/projects\/project-alpha"/u);
    assert.match(html, /href="\/circuit-blocks\/cblock-alpha-power"/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies asset target shows an empty state when no export bundle records are found.
 */
test("where-used page renders empty state for supported asset target with no results", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/where-used") {
      return jsonResponse({
        data: {
          assetExports: [],
          boundary: "Where-used results are historical dependency and usage context only; they do not approve reuse, validate evidence, or unlock export.",
          circuitBlockDependencies: [],
          matchedCircuitBlocks: [],
          matchedParts: [],
          projectUsages: [],
          query: "asset-memory-ldo-symbol-ref",
          state: "empty",
          supportedTarget: true,
          targetType: "asset",
          unsupportedReason: null
        } satisfies WhereUsedSearchResponse,
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderWhereUsedPage({ q: "asset-memory-ldo-symbol-ref", targetType: "asset" });

    assert.match(html, /No where-used records found/u);
    assert.match(html, /asset-memory-ldo-symbol-ref/u);
    assert.doesNotMatch(html, /Main LDO/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Renders the where-used server component to static markup.
 */
async function renderWhereUsedPage(searchParams: { q?: string; targetType?: string }): Promise<string> {
  return renderToStaticMarkup(await WhereUsedPage({ searchParams: Promise.resolve(searchParams) }));
}

/**
 * Replaces global fetch with a tiny API handler for page tests.
 */
function mockFetch(handler: (url: URL) => Response): () => void {
  const originalFetch = global.fetch;

  global.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);

    return handler(url);
  }) as typeof fetch;

  return () => {
    global.fetch = originalFetch;
  };
}

/**
 * Builds a JSON response that mimics the API envelope.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}

/**
 * Builds the lightweight API health response used by the page header.
 */
function buildHealthResponse(database: "connected" | "not_configured" | "unavailable") {
  return {
    dependencies: {
      database,
      objectStorage: "local",
      queue: "not_connected_phase_0"
    },
    service: "api",
    status: "ok"
  };
}

/**
 * Builds a where-used fixture with one confirmed usage and one circuit block role.
 */
function buildWhereUsedResponse(): WhereUsedSearchResponse {
  return {
    assetExports: [],
    boundary: "Where-used results are historical dependency and usage context only; they do not approve reuse, validate evidence, or unlock export.",
    circuitBlockDependencies: [
      {
        blockPart: {
          circuitBlockId: "cblock-alpha-power",
          createdAt: "2026-04-30T00:10:00.000Z",
          id: "cbpart-alpha-power-ldo",
          isRequired: true,
          notes: "Use with reviewed output capacitor.",
          partId: "part-memory-ldo",
          quantity: 1,
          role: "Main LDO",
          substitutionPolicy: "exact_required",
          updatedAt: "2026-04-30T00:10:00.000Z"
        },
        circuitBlock: {
          blockKey: "ALPHA-POWER",
          blockType: "power",
          constraints: { note: "Keep near load" },
          createdAt: "2026-04-30T00:09:00.000Z",
          description: "Reusable LDO rail for memory tests.",
          id: "cblock-alpha-power",
          name: "Alpha power rail",
          owner: "hardware",
          reuseScope: "Fixture power rails only",
          status: "approved",
          updatedAt: "2026-04-30T00:09:00.000Z"
        },
        part: buildPartSummary()
      }
    ],
    matchedCircuitBlocks: [],
    matchedParts: [buildPartSummary()],
    projectUsages: [
      {
        blockPart: null,
        bomLine: {
          bomImportId: "bom-alpha-a",
          createdAt: "2026-04-30T00:04:00.000Z",
          designators: ["U1"],
          id: "line-alpha-1",
          instantiatedAt: null,
          instantiatedFromCircuitBlockId: null,
          instantiatedFromCircuitBlockPartId: null,
          matchConfidenceScore: 1,
          matchedPartId: "part-memory-ldo",
          matchStatus: "matched",
          projectId: "project-alpha",
          projectRevisionId: "rev-alpha-a",
          quantity: 1,
          rawDescription: "LDO regulator",
          rawManufacturer: "Texas Instruments",
          rawMpn: "TPS7A02DBVR",
          rawNotes: null,
          rawRowPayload: { row: 1 },
          rawSupplierReference: null,
          rowNumber: 1,
          updatedAt: "2026-04-30T00:04:00.000Z"
        },
        circuitBlock: null,
        part: buildPartSummary(),
        project: {
          createdAt: "2026-04-30T00:00:00.000Z",
          description: "Memory API test project",
          id: "project-alpha",
          name: "Alpha Controller",
          owner: "hardware",
          projectKey: "ALPHA",
          status: "active",
          updatedAt: "2026-04-30T00:01:00.000Z"
        },
        projectRevision: {
          createdAt: "2026-04-30T00:02:00.000Z",
          id: "rev-alpha-a",
          projectId: "project-alpha",
          releasedAt: null,
          revisionLabel: "A",
          revisionStatus: "draft",
          sourceReference: "alpha-a",
          updatedAt: "2026-04-30T00:02:00.000Z"
        },
        usage: {
          approvalSnapshot: { approvalStatus: "approved" },
          bomLineId: "line-alpha-1",
          createdAt: "2026-04-30T00:06:00.000Z",
          designators: ["U1"],
          id: "usage-alpha-u1",
          partId: "part-memory-ldo",
          projectId: "project-alpha",
          projectRevisionId: "rev-alpha-a",
          quantity: 1,
          readinessSnapshot: { readinessStatus: "blocked" },
          updatedAt: "2026-04-30T00:06:00.000Z",
          usageContext: "Main rail regulator",
          usageStatus: "proposed"
        }
      }
    ],
    query: "TPS7A02DBVR",
    state: "available",
    supportedTarget: true,
    targetType: "part",
    unsupportedReason: null
  };
}

/**
 * Builds the compact part summary reused by match, usage, and dependency rows.
 */
function buildPartSummary() {
  return {
    approvalStatus: "approved",
    blockerCount: 1,
    connectorClass: "non_connector",
    lifecycleStatus: "active",
    manufacturerName: "Texas Instruments",
    mpn: "TPS7A02DBVR",
    partId: "part-memory-ldo",
    readinessStatus: "needs_attention"
  } as const;
}
