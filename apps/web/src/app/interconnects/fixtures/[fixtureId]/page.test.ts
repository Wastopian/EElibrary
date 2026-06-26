/**
 * File header: Tests the fixture detail authoring page renders header and ports.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import FixtureDetailPage from "./page";
import type { TestFixtureDetail } from "@ee-library/shared/types";

test("fixture detail page renders the authoring editor for a found fixture", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/test-fixtures/fixture-x") {
      return jsonResponse({ data: buildFixtureDetail(), source: "database" });
    }
    if (url.pathname === "/projects") {
      return jsonResponse({ data: { capabilities: [], projects: [], state: "available" }, source: "database" });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await FixtureDetailPage({ params: Promise.resolve({ fixtureId: "fixture-x" }) }));

    assert.match(html, /Fixture TFX-9/u);
    assert.match(html, /Changes are recorded memory only/u);
    assert.match(html, /Fixture details/u);
    assert.match(html, /Ports/u);
    assert.match(html, /J202/u);
    assert.match(html, /DUT port/u);
    assert.match(html, /Add a port/u);
    assert.match(html, /Save fixture details/u);
    assert.match(html, /Import ports/u);
  } finally {
    restoreFetch();
  }
});

test("fixture detail page renders an unavailable state when the fixture cannot be read", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/test-fixtures/fixture-missing") {
      return jsonResponse({ error: { code: "FIXTURE_NOT_FOUND", message: "Test fixture not found." } }, 404);
    }
    if (url.pathname === "/projects") {
      return jsonResponse({ data: { capabilities: [], projects: [], state: "available" }, source: "database" });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await FixtureDetailPage({ params: Promise.resolve({ fixtureId: "fixture-missing" }) }));

    assert.match(html, /Fixture unavailable/u);
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

/** Builds a representative fixture detail with one port. */
function buildFixtureDetail(): TestFixtureDetail {
  return {
    boundary: "Recording fixture memory keeps engineering history; it does not approve a part, validate an asset, prove a bench setup is safe, or unlock export. Status is recorded memory, not approval.",
    fixture: {
      createdAt: "2026-06-20T12:00:00.000Z",
      fixtureKey: "TFX-9",
      fixtureStatus: "draft",
      id: "fixture-x",
      owner: "Morgan",
      pinRowCount: 0,
      ports: [
        {
          cableAssemblyId: null,
          cableKey: null,
          connectorPart: { manufacturerName: null, mpn: null, partId: null },
          connectorRef: "J202",
          fixtureId: "fixture-x",
          id: "fixture-x-port-j202",
          matePart: { manufacturerName: null, mpn: null, partId: null },
          notes: null,
          portRole: "DUT port"
        }
      ],
      projectId: null,
      projectKey: null,
      projectName: null,
      provenance: "manual_internal",
      purpose: "Bring-up fixture",
      revisionLabel: "A",
      sourceDocumentRef: null,
      updatedAt: "2026-06-20T12:00:00.000Z"
    }
  };
}
