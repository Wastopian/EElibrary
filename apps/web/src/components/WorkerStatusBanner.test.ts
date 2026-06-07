/**
 * File header: Tests WorkerStatusBanner rendering for worker and queued-job diagnostics.
 */

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkerStatusBanner } from "./WorkerStatusBanner";
import type { SystemHealthResponse } from "@ee-library/shared";

test("WorkerStatusBanner renders offline worker warning with pending queue counts", () => {
  const html = renderToStaticMarkup(
    React.createElement(WorkerStatusBanner, {
      apiBaseUrl: "http://127.0.0.1:4000",
      databaseUrlConfigured: true,
      health: buildHealth({
        acquisitionPending: 2,
        workerStatus: "offline"
      }),
      isLocalDev: true
    })
  );

  assert.match(html, /Worker daemon is offline/u);
  assert.match(html, /Imports: 2 pending, 0 failed/u);
  assert.match(html, /waiting for a worker/u);
});

test("WorkerStatusBanner renders queue failure diagnostics while worker is online", () => {
  const html = renderToStaticMarkup(
    React.createElement(WorkerStatusBanner, {
      apiBaseUrl: "http://127.0.0.1:4000",
      databaseUrlConfigured: true,
      health: buildHealth({
        enrichmentFailed: 1,
        workerStatus: "online"
      }),
      isLocalDev: true
    })
  );

  assert.match(html, /Background provider work has failures/u);
  assert.match(html, /Background updates: 0 pending, 1 failed/u);
  assert.match(html, /operations:worker/u);
});

test("WorkerStatusBanner stays quiet when services and queues are healthy", () => {
  const html = renderToStaticMarkup(
    React.createElement(WorkerStatusBanner, {
      apiBaseUrl: "http://127.0.0.1:4000",
      databaseUrlConfigured: true,
      health: buildHealth({ workerStatus: "online" }),
      isLocalDev: true
    })
  );

  assert.equal(html, "");
});

/**
 * Builds a minimal health payload for banner rendering tests.
 */
function buildHealth({
  acquisitionFailed = 0,
  acquisitionPending = 0,
  enrichmentFailed = 0,
  enrichmentPending = 0,
  workerStatus
}: {
  acquisitionFailed?: number;
  acquisitionPending?: number;
  enrichmentFailed?: number;
  enrichmentPending?: number;
  workerStatus: SystemHealthResponse["worker"]["status"];
}): SystemHealthResponse {
  return {
    api: { status: "ok" },
    database: { status: "connected" },
    objectStorage: { status: "connected" },
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
        failed: 0,
        pending: 0
      }
    },
    worker: {
      lastSeenAt: workerStatus === "online" ? "2026-04-26T00:00:00.000Z" : null,
      staleAfterSeconds: 30,
      status: workerStatus
    }
  };
}
