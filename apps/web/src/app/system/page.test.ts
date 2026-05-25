/**
 * File header: Tests the system health workspace against the shared health response contract.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import SystemPage from "./page";
import type { SystemHealthResponse } from "@ee-library/shared";

/**
 * Verifies system health renders service and queue states as an intentional workspace.
 */
test("system page renders health summary, worker warning, and queue recovery", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/system/health") {
      return jsonResponse(buildSystemHealth({
        acquisitionPending: 3,
        bundleAssemblyPending: 2,
        enrichmentFailed: 1,
        objectStorageStatus: "not_configured",
        workerStatus: "offline"
      }));
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await SystemPage());

    assert.match(html, /Is everything running/u);
    assert.match(html, /API ok/u);
    assert.match(html, /Database Connected/u);
    assert.match(html, /Object storage/u);
    assert.match(html, /Not configured/u);
    assert.match(html, /Worker daemon is offline/u);
    assert.match(html, /Acquisition/u);
    assert.match(html, /Enrichment/u);
    assert.match(html, /Export bundle assembly/u);
    assert.match(html, /Needs review/u);
    assert.match(html, /Open Admin queues/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies transport failures render API-down recovery instead of fake service states.
 */
test("system page renders API unavailable recovery when health cannot be fetched", async () => {
  const restoreFetch = mockFetch(() => {
    throw new Error("api down");
  });

  try {
    const html = renderToStaticMarkup(await SystemPage());

    assert.match(html, /API health unavailable/u);
    assert.match(html, /system\/health/u);
    assert.match(html, /Open health endpoint/u);
    assert.match(html, /Return to Catalog/u);
    assert.doesNotMatch(html, /Database Connected/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Replaces global fetch with a system-health API handler.
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
 * Builds a system health fixture with overridable worker, storage, and queue states.
 */
function buildSystemHealth({
  acquisitionFailed = 0,
  acquisitionPending = 0,
  bundleAssemblyFailed = 0,
  bundleAssemblyPending = 0,
  enrichmentFailed = 0,
  enrichmentPending = 0,
  objectStorageStatus = "connected",
  workerStatus = "online"
}: {
  acquisitionFailed?: number;
  acquisitionPending?: number;
  bundleAssemblyFailed?: number;
  bundleAssemblyPending?: number;
  enrichmentFailed?: number;
  enrichmentPending?: number;
  objectStorageStatus?: SystemHealthResponse["objectStorage"]["status"];
  workerStatus?: SystemHealthResponse["worker"]["status"];
} = {}): SystemHealthResponse {
  return {
    api: { status: "ok" },
    database: { status: "connected" },
    objectStorage: { status: objectStorageStatus },
    queues: {
      acquisition: {
        failed: acquisitionFailed,
        pending: acquisitionPending
      },
      enrichment: {
        failed: enrichmentFailed,
        pending: enrichmentPending
      },
      exportBundleAssembly: {
        failed: bundleAssemblyFailed,
        pending: bundleAssemblyPending
      }
    },
    worker: {
      lastSeenAt: workerStatus === "online" ? "2026-05-06T12:00:00.000Z" : null,
      staleAfterSeconds: 30,
      status: workerStatus
    }
  };
}
