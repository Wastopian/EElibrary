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
    assert.match(html, /Query examples/u);
    assert.match(html, /Part id/u);
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
          documentHits: [],
          interconnectHits: [],
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
    assert.match(html, /Search the owning part id or MPN instead of an asset id/u);
    assert.doesNotMatch(html, /Main LDO/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies document target renders project-file hits without implying document approval.
 */
test("where-used page renders project document clue hits", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/where-used") {
      assert.equal(url.searchParams.get("targetType"), "document");
      assert.equal(url.searchParams.get("q"), "Which test procedure uses connector J202?");

      return jsonResponse({
        data: buildDocumentWhereUsedResponse(),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderWhereUsedPage({ q: "Which test procedure uses connector J202?", targetType: "document" });

    assert.match(html, /Project document hits/u);
    assert.match(html, /Document hits/u);
    assert.match(html, /J202-test-procedure-rev-d\.md/u);
    assert.match(html, /Connector: J202/u);
    assert.match(html, /Type: Test procedure/u);
    assert.match(html, /Copy to Notes/u);
    assert.match(html, /href="\/projects\/project-alpha#project-files-heading"/u);
    assert.match(html, /Document search reads current project file maps/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the interconnect target renders cable, fixture, and pin-map hits with its trust boundary.
 */
test("where-used page renders cable and fixture interconnect hits", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/where-used") {
      assert.equal(url.searchParams.get("targetType"), "interconnect");
      assert.equal(url.searchParams.get("q"), "J202");

      return jsonResponse({
        data: buildInterconnectWhereUsedResponse(),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderWhereUsedPage({ q: "J202", targetType: "interconnect" });

    assert.match(html, /Cable, fixture, and pin-map hits/u);
    assert.match(html, /Cable\/fixture hits/u);
    assert.match(html, /CAB-100/u);
    assert.match(html, /TFX-42/u);
    assert.match(html, /RS422_TX\+/u);
    assert.match(html, /Connector ref J202/u);
    assert.match(html, /Pin map row/u);
    assert.match(html, /Fixture port/u);
    assert.match(html, /href="\/interconnects"/u);
    assert.match(html, /Interconnect search reads recorded cable, fixture, and pin-map memory/u);
    assert.doesNotMatch(html, /No confirmed project usage/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies first-run recovery points users to visible workspaces instead of hidden query tricks.
 */
test("where-used page renders first-run recovery actions when project memory is connected", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderWhereUsedPage({});

    assert.match(html, /Start with a saved part or project/u);
    assert.match(html, /Find parts in Catalog/u);
    assert.match(html, /Open project BOMs/u);
    assert.match(html, /Browse connector sets/u);
    assert.doesNotMatch(html, /URL/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies unavailable project memory does not claim target backing before a search.
 */
test("where-used page renders setup state without backed-target counts when database is unavailable", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("not_configured"));
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderWhereUsedPage({});

    assert.match(html, /Connect project memory/u);
    assert.match(html, /Connect project memory to search where things are used/u);
    assert.match(html, /DB_NOT_CONFIGURED/u);
    assert.match(html, /Backed now/u);
    assert.match(html, />DB</u);
    assert.doesNotMatch(html, /<strong>5<\/strong>/u);
    assert.doesNotMatch(html, /Query examples/u);
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
    documentHits: [],
    interconnectHits: [],
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
 * Builds a where-used fixture with one document-map clue hit.
 */
function buildDocumentWhereUsedResponse(): WhereUsedSearchResponse {
  return {
    assetExports: [],
    boundary: "Where-used results are historical dependency and usage context only; they do not approve reuse, validate evidence, or unlock export.",
    circuitBlockDependencies: [],
    interconnectHits: [],
    documentHits: [
      {
        document: {
          confidenceScore: 0.93,
          currentCategory: null,
          documentType: "test_procedure",
          extraction: null,
          filename: "J202-test-procedure-rev-d.md",
          id: "doc-bob-drop-old-tests-j202-test-procedure-rev-d-md",
          modifiedAt: "2026-06-16T13:08:00.000Z",
          needsAttention: true,
          outsideStandardFolders: true,
          parentFolder: "Bob-drop/old-tests",
          reason: "Test procedure wording found.",
          relativePath: "Bob-drop/old-tests/J202-test-procedure-rev-d.md",
          signals: {
            cableKeys: ["CAB-DEMO-PMC-JST-PWR"],
            connectorRefs: ["J202"],
            fixtureKeys: ["TFX-DEMO-PMC-BRINGUP"],
            pinRefs: ["47"],
            revisionLabels: ["Rev D"],
            signalNames: ["RS422_TX+"]
          },
          sizeBytes: 228,
          sortPlan: {
            action: "move_to_standard_folder",
            reason: "This looks like a test procedure outside the standard folders.",
            sourceRelativePath: "Bob-drop/old-tests/J202-test-procedure-rev-d.md",
            targetCategory: "notes",
            targetFolderLabel: "Notes",
            targetRelativePath: "notes/J202-test-procedure-rev-d.md"
          },
          suggestedCategory: "notes"
        },
        matchedLabels: ["Connector: J202", "Type: Test procedure"],
        project: {
          createdAt: "2026-06-16T12:00:00.000Z",
          description: "Demo project",
          id: "project-alpha",
          name: "Alpha Controller",
          owner: "hardware",
          projectKey: "ALPHA",
          status: "active",
          updatedAt: "2026-06-16T12:00:00.000Z"
        }
      }
    ],
    matchedCircuitBlocks: [],
    matchedParts: [],
    projectUsages: [],
    query: "Which test procedure uses connector J202?",
    state: "available",
    supportedTarget: true,
    targetType: "document",
    unsupportedReason: null
  };
}

/**
 * Builds an interconnect where-used response with one pin-map, one cable-end, and one fixture-port hit.
 */
function buildInterconnectWhereUsedResponse(): WhereUsedSearchResponse {
  return {
    assetExports: [],
    boundary: "Where-used results are historical dependency and usage context only; they do not approve reuse, validate evidence, or unlock export.",
    circuitBlockDependencies: [],
    documentHits: [],
    interconnectHits: [
      {
        cableKey: "CAB-100",
        confidenceScore: 0.62,
        connectorRef: "J202",
        destinationConnectorRef: "J201",
        destinationPinNumber: "12",
        endLabel: "A",
        fixtureKey: null,
        kind: "pin_map_row",
        matchedLabels: ["Connector ref J202"],
        pinNumber: "47",
        projectKey: "ALPHA",
        recordId: "pin-row-j202-47",
        revisionLabel: "D",
        signalName: "RS422_TX+",
        status: "approved",
        wireColor: "blue",
        wireGauge: 24
      },
      {
        cableKey: "CAB-100",
        confidenceScore: null,
        connectorRef: "J202",
        destinationConnectorRef: null,
        destinationPinNumber: null,
        endLabel: "A",
        fixtureKey: null,
        kind: "cable_end",
        matchedLabels: ["Connector ref J202"],
        pinNumber: null,
        projectKey: "ALPHA",
        recordId: "cable-cab-100-end-a",
        revisionLabel: "D",
        signalName: null,
        status: "approved",
        wireColor: null,
        wireGauge: null
      },
      {
        cableKey: null,
        confidenceScore: null,
        connectorRef: "J202",
        destinationConnectorRef: null,
        destinationPinNumber: null,
        endLabel: null,
        fixtureKey: "TFX-42",
        kind: "fixture_port",
        matchedLabels: ["Connector ref J202"],
        pinNumber: null,
        projectKey: "ALPHA",
        recordId: "fixture-tfx-42-port-j202",
        revisionLabel: "B",
        signalName: null,
        status: "restricted",
        wireColor: null,
        wireGauge: null
      }
    ],
    matchedCircuitBlocks: [],
    matchedParts: [],
    projectUsages: [],
    query: "J202",
    state: "available",
    supportedTarget: true,
    targetType: "interconnect",
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
