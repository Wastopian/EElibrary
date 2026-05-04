/**
 * File header: Tests the circuit block library page against reusable circuit API contracts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CircuitBlocksPage from "./page";
import type { CircuitBlockListResponse } from "@ee-library/shared/types";

/**
 * Verifies persisted circuit blocks render as a navigable reusable circuit library.
 */
test("circuit blocks page renders persisted block summaries and creation path", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/circuit-blocks") {
      return jsonResponse({
        data: buildCircuitBlockListResponse(),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderCircuitBlocksPage();

    assert.match(html, /Reusable circuit blocks/u);
    assert.match(html, /ALPHA-POWER/u);
    assert.match(html, /Alpha power rail/u);
    assert.match(html, /Readiness gaps/u);
    assert.match(html, /Create circuit block/u);
    assert.match(html, /Block state/u);
    assert.match(html, /Approved blocks can still contain parts/u);
    assert.match(html, /href="\/circuit-blocks\/cblock-alpha-power"/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies configured but empty circuit block memory stays honest.
 */
test("circuit blocks page renders an empty persisted library state", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/circuit-blocks") {
      return jsonResponse({
        data: {
          circuitBlocks: [],
          state: "empty"
        } satisfies CircuitBlockListResponse,
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderCircuitBlocksPage();

    assert.match(html, /No circuit blocks yet/u);
    assert.match(html, /Create a block/u);
    assert.doesNotMatch(html, /ALPHA-POWER/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Renders the circuit blocks server component to static markup.
 */
async function renderCircuitBlocksPage(): Promise<string> {
  return renderToStaticMarkup(await CircuitBlocksPage());
}

/**
 * Replaces global fetch with a circuit block API handler for page tests.
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

/**
 * Builds the lightweight API health response for circuit block page tests.
 */
function buildHealthResponse(database: "connected" | "not_configured") {
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
 * Builds the reusable circuit block list fixture.
 */
function buildCircuitBlockListResponse(): CircuitBlockListResponse {
  return {
    circuitBlocks: [
      {
        approvedPartCount: 1,
        circuitBlock: {
          blockKey: "ALPHA-POWER",
          blockType: "power",
          constraints: { note: "Keep near the load." },
          createdAt: "2026-05-01T12:00:00.000Z",
          description: "Reusable LDO rail.",
          id: "cblock-alpha-power",
          name: "Alpha power rail",
          owner: "Hardware",
          reuseScope: "Fixture power rails",
          status: "approved",
          updatedAt: "2026-05-01T13:00:00.000Z"
        },
        evidenceAttachmentCount: 1,
        lifecycleRiskCount: 0,
        optionalPartCount: 0,
        projectUsageCount: 1,
        readinessGapCount: 1,
        requiredPartCount: 1,
        strictSubstitutionCount: 0,
        totalPartCount: 1
      }
    ],
    state: "available"
  };
}
