/**
 * File header: Tests the cable detail authoring page renders header, ends, and pin rows.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CableDetailPage from "./page";
import type { CableAssemblyDetail } from "@ee-library/shared/types";

/**
 * Verifies the cable detail page renders the editor with header, ends, and pin rows.
 */
test("cable detail page renders the authoring editor for a found cable", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/cable-assemblies/cable-x") {
      return jsonResponse({ data: buildCableDetail(), source: "database" });
    }
    if (url.pathname === "/projects") {
      return jsonResponse({ data: { capabilities: [], projects: [], state: "available" }, source: "database" });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await CableDetailPage({ params: Promise.resolve({ cableId: "cable-x" }) }));

    assert.match(html, /Cable CAB-9/u);
    assert.match(html, /Changes are recorded memory only/u);
    assert.match(html, /Cable details/u);
    assert.match(html, /Connector ends/u);
    assert.match(html, /End A: J1/u);
    assert.match(html, /Pin map/u);
    assert.match(html, /CAN_H/u);
    assert.match(html, /Save cable details/u);
    assert.match(html, /Add a connector end/u);
    assert.match(html, /Add a pin row/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies an unreadable cable renders an honest unavailable state, not invented rows.
 */
test("cable detail page renders an unavailable state when the cable cannot be read", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/cable-assemblies/cable-missing") {
      return jsonResponse({ error: { code: "CABLE_NOT_FOUND", message: "Cable assembly not found." } }, 404);
    }
    if (url.pathname === "/projects") {
      return jsonResponse({ data: { capabilities: [], projects: [], state: "available" }, source: "database" });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await CableDetailPage({ params: Promise.resolve({ cableId: "cable-missing" }) }));

    assert.match(html, /Cable unavailable/u);
    assert.doesNotMatch(html, /Pin map/u);
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

/** Builds a representative cable detail with one end and one pin row. */
function buildCableDetail(): CableAssemblyDetail {
  return {
    boundary: "Recording cable memory keeps engineering history; it does not approve a part, validate an asset, prove a bench setup is safe, or unlock export. Status is recorded memory, not approval.",
    cable: {
      assemblyStatus: "draft",
      cableKey: "CAB-9",
      createdAt: "2026-06-20T12:00:00.000Z",
      description: "Test harness",
      ends: [
        {
          backshellPart: { manufacturerName: null, mpn: null, partId: null },
          cableAssemblyId: "cable-x",
          connectorPart: { manufacturerName: null, mpn: null, partId: null },
          connectorRef: "J1",
          endLabel: "A",
          id: "cable-x-end-a",
          matePart: { manufacturerName: null, mpn: null, partId: null },
          notes: null
        }
      ],
      fixturePortCount: 0,
      id: "cable-x",
      owner: "Dana",
      pinRowCount: 1,
      projectId: null,
      projectKey: null,
      projectName: null,
      projectRevisionId: null,
      projectRevisionLabel: null,
      provenance: "manual_internal",
      revisionLabel: "A",
      sourceDocumentRef: null,
      updatedAt: "2026-06-20T12:00:00.000Z"
    },
    pinRows: [
      {
        cableAssemblyId: "cable-x",
        cableEndId: "cable-x-end-a",
        cableKey: "CAB-9",
        confidenceScore: 0.62,
        connectorRef: "J1",
        destinationConnectorRef: null,
        destinationPinNumber: null,
        endLabel: "A",
        evidenceAttachmentId: null,
        fixturePortId: null,
        id: "pin-x-1",
        notes: null,
        pinNumber: "1",
        revisionLabel: "A",
        signalName: "CAN_H",
        sourceDocumentRef: null,
        wireColor: "blue",
        wireGauge: 24
      }
    ]
  };
}
