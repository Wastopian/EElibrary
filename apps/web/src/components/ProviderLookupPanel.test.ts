/**
 * File header: Tests exact provider lookup candidate acquisition helpers, status copy, and API routing.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiClientError, fetchProviderAcquisitionJob, requestProviderAcquisitionJob } from "../lib/api-client";
import { importUiCopy } from "../lib/import-ui-copy";
import {
  ProviderLookupCandidateJobStatus,
  ProviderLookupPanelView,
  buildProviderCandidateImportInput,
  buildProviderAcquisitionJobCreateInput,
  isPendingCandidateAcquisition,
  isQueueAcquisitionButtonDisabled,
  resolveProviderAcquisitionRequestFailure,
  resolveProviderAcquisitionTrackingState
} from "./ProviderLookupPanel";
import type {
  ProviderAcquisitionJob,
  ProviderAcquisitionJobDetailResponse,
  ProviderLookupCandidate
} from "@ee-library/shared/types";

test("provider lookup candidate acquisition uses provider part keys without overloading the MPN", () => {
  const candidate = buildProviderCandidate();
  const input = buildProviderAcquisitionJobCreateInput(candidate, "RC-02W300JT");

  assert.deepEqual(input, {
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    matchConfidence: 1,
    matchType: "exact_provider_part_id",
    mpn: "RC-02W300JT",
    package: "0402",
    providerId: "jlcparts",
    providerPartKey: "C1091",
    requestedLookup: "RC-02W300JT",
    sourceUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
  });
});

test("provider lookup direct import uses selected candidate identity without making engineers retype provider details", () => {
  const candidate = buildProviderCandidate();
  const input = buildProviderCandidateImportInput(candidate);

  assert.deepEqual(input, {
    datasheetUrl: null,
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    mpn: "RC-02W300JT",
    providerId: "jlcparts",
    providerPartId: "C1091",
    providerUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
  });
});

test("provider lookup candidate acquisition status renders queued, running, succeeded, and failed states clearly", () => {
  const queuedHtml = renderToStaticMarkup(
    React.createElement(ProviderLookupCandidateJobStatus, {
      state: resolveProviderAcquisitionTrackingState("jlcparts:C1091", buildProviderJobDetail("queued"), "/?q=RC-02W300JT")
    })
  );
  const runningHtml = renderToStaticMarkup(
    React.createElement(ProviderLookupCandidateJobStatus, {
      state: resolveProviderAcquisitionTrackingState("jlcparts:C1091", buildProviderJobDetail("running"), "/?q=RC-02W300JT")
    })
  );
  const succeededHtml = renderToStaticMarkup(
    React.createElement(ProviderLookupCandidateJobStatus, {
      state: resolveProviderAcquisitionTrackingState("jlcparts:C1091", buildProviderJobDetail("succeeded", { partId: "part-jlcparts-c1091" }), "/?q=RC-02W300JT")
    })
  );
  const failedHtml = renderToStaticMarkup(
    React.createElement(ProviderLookupCandidateJobStatus, {
      state: resolveProviderAcquisitionTrackingState("jlcparts:C1091", buildProviderJobDetail("failed", { errorMessage: "No matching catalog entry was found for that lookup." }), "/?q=RC-02W300JT")
    })
  );

  assert.match(queuedHtml, new RegExp(importUiCopy.providerAcquisitionQueued, "u"));
  assert.match(runningHtml, new RegExp(importUiCopy.providerAcquisitionRunning, "u"));
  assert.match(succeededHtml, new RegExp(importUiCopy.providerAcquisitionSucceeded, "u"));
  assert.match(succeededHtml, new RegExp(importUiCopy.linkOpenPart, "u"));
  assert.match(failedHtml, /No matching catalog entry was found for that lookup/u);
});

test("provider lookup candidate acquisition success without partId does not guess a route", () => {
  const succeededWithoutPart = resolveProviderAcquisitionTrackingState(
    "jlcparts:C1091",
    buildProviderJobDetail("succeeded", { partId: null }),
    "/?q=RC-02W300JT"
  );

  assert.equal(succeededWithoutPart.kind, "succeeded");
  if (succeededWithoutPart.kind !== "succeeded") {
    throw new Error("expected succeeded state");
  }

  assert.deepEqual(succeededWithoutPart.action, {
    href: "/?q=RC-02W300JT",
    kind: "refresh_search"
  });
});

test("rendered provider lookup panel direct mode imports selected candidates instead of queueing jobs", () => {
  const candidates = [buildProviderCandidate()];
  const idleHtml = renderToStaticMarkup(
    React.createElement(ProviderLookupPanelView, {
      acquisitionState: { kind: "idle" },
      importMode: "direct",
      onQueueAcquisition: () => undefined,
      onRunDirectImport: () => undefined,
      onRunLookup: () => undefined,
      status: { candidates, kind: "candidates" }
    })
  );
  const succeededHtml = renderToStaticMarkup(
    React.createElement(ProviderLookupPanelView, {
      acquisitionState: {
        action: { href: "/parts/part-jlcparts-c1091", kind: "open_part" },
        candidateKey: "jlcparts:C1091",
        kind: "succeeded"
      },
      importMode: "direct",
      onQueueAcquisition: () => undefined,
      onRunDirectImport: () => undefined,
      onRunLookup: () => undefined,
      status: { candidates, kind: "candidates" }
    })
  );

  assert.match(idleHtml, new RegExp(importUiCopy.buttonImportCandidate, "u"));
  assert.doesNotMatch(idleHtml, new RegExp(importUiCopy.buttonQueueAcquisition, "u"));
  assert.match(succeededHtml, new RegExp(importUiCopy.successLead, "u"));
  assert.doesNotMatch(succeededHtml, new RegExp(importUiCopy.providerAcquisitionSucceeded, "u"));
});

test("provider lookup candidates remain disabled when import is unavailable", () => {
  assert.equal(isQueueAcquisitionButtonDisabled(false, { kind: "idle" }), true);
  assert.equal(isQueueAcquisitionButtonDisabled(true, { candidateKey: "jlcparts:C1091", kind: "creating" }), true);
  assert.equal(isQueueAcquisitionButtonDisabled(true, { kind: "idle" }, true), true);
  assert.equal(isQueueAcquisitionButtonDisabled(true, { kind: "idle" }), false);
  assert.equal(isPendingCandidateAcquisition({ candidateKey: "jlcparts:C1091", kind: "queued", detail: buildProviderJobDetail("queued") }), true);
  assert.equal(isPendingCandidateAcquisition({ kind: "idle" }), false);
});

test("provider acquisition request failures keep unavailable states explicit", () => {
  const unavailable = resolveProviderAcquisitionRequestFailure(
    "jlcparts:C1091",
    new ApiClientError("Provider acquisition job", 403, "FORBIDDEN", "Admin role is required for this operation.")
  );

  assert.equal(unavailable.kind, "unavailable");
  assert.match(unavailable.message, /admin sign-in/i);
});

test("requestProviderAcquisitionJob posts to the acquisition job route instead of the sync import route", async () => {
  const restoreFetch = mockFetch((url, init) => {
    assert.equal(url.pathname, "/provider-acquisition-jobs");
    assert.equal(init?.method, "POST");
    assert.ok(typeof init?.body === "string");
    assert.doesNotMatch(init?.body as string, /"providerPartId"/u);
    assert.match(init?.body as string, /"providerPartKey":"C1091"/u);

    return jsonResponse({
      data: buildProviderJobDetail("queued")
    }, 202);
  });

  try {
    const result = await requestProviderAcquisitionJob(
      buildProviderAcquisitionJobCreateInput(buildProviderCandidate(), "RC-02W300JT")
    );

    assert.equal(result.job.id, "acqjob-jlcparts-c1091");
    assert.equal(result.job.jobStatus, "queued");
  } finally {
    restoreFetch();
  }
});

test("fetchProviderAcquisitionJob polls the acquisition status route", async () => {
  const restoreFetch = mockFetch((url, init) => {
    assert.equal(url.pathname, "/provider-acquisition-jobs/acqjob-jlcparts-c1091");
    assert.equal(init?.method, undefined);

    return jsonResponse({
      data: buildProviderJobDetail("running")
    });
  });

  try {
    const result = await fetchProviderAcquisitionJob("acqjob-jlcparts-c1091");

    assert.equal(result.job.jobStatus, "running");
    assert.equal(result.events[0]?.eventType, "running");
  } finally {
    restoreFetch();
  }
});

test("rendered provider lookup panel view shows one active acquisition lock until terminal success", () => {
  const candidates = [buildProviderCandidate(), buildSecondProviderCandidate()];
  const creatingHtml = renderToStaticMarkup(
    React.createElement(ProviderLookupPanelView, {
      acquisitionState: { candidateKey: "jlcparts:C1091", kind: "creating" },
      onQueueAcquisition: () => undefined,
      onRunLookup: () => undefined,
      status: { candidates, kind: "candidates" }
    })
  );
  const runningHtml = renderToStaticMarkup(
    React.createElement(ProviderLookupPanelView, {
      acquisitionState: resolveProviderAcquisitionTrackingState("jlcparts:C1091", buildProviderJobDetail("running"), "/?q=RC-02W300JT"),
      onQueueAcquisition: () => undefined,
      onRunLookup: () => undefined,
      status: { candidates, kind: "candidates" }
    })
  );
  const succeededHtml = renderToStaticMarkup(
    React.createElement(ProviderLookupPanelView, {
      acquisitionState: resolveProviderAcquisitionTrackingState("jlcparts:C1091", buildProviderJobDetail("succeeded", { partId: "part-jlcparts-c1091" }), "/?q=RC-02W300JT"),
      onQueueAcquisition: () => undefined,
      onRunLookup: () => undefined,
      status: { candidates, kind: "candidates" }
    })
  );

  assert.match(creatingHtml, new RegExp(importUiCopy.providerAcquisitionActiveLead, "u"));
  assert.match(creatingHtml, /jlcparts \/ C1091/u);
  assert.match(creatingHtml, new RegExp(importUiCopy.providerAcquisitionActiveBadge, "u"));
  assert.equal(countDisabledButtons(creatingHtml), 2);
  assert.match(runningHtml, new RegExp(importUiCopy.providerAcquisitionRunning, "u"));
  assert.equal(countDisabledButtons(runningHtml), 2);
  assert.doesNotMatch(succeededHtml, new RegExp(importUiCopy.providerAcquisitionActiveLead, "u"));
  assert.match(succeededHtml, new RegExp(importUiCopy.providerAcquisitionSucceeded, "u"));
  assert.equal(countDisabledButtons(succeededHtml), 0);
});

test("rendered provider lookup panel view releases the acquisition lock after failure", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProviderLookupPanelView, {
      acquisitionState: {
        candidateKey: "jlcparts:C1091",
        detail: buildProviderJobDetail("failed", { errorMessage: "No matching catalog entry was found for that lookup." }),
        kind: "failed",
        message: "No matching catalog entry was found for that lookup."
      },
      onQueueAcquisition: () => undefined,
      onRunLookup: () => undefined,
      status: { candidates: [buildProviderCandidate(), buildSecondProviderCandidate()], kind: "candidates" }
    })
  );

  assert.doesNotMatch(html, new RegExp(importUiCopy.providerAcquisitionActiveLead, "u"));
  assert.match(html, /No matching catalog entry was found for that lookup/u);
  assert.equal(countDisabledButtons(html), 0);
});

/**
 * Builds one provider-neutral exact-match candidate row for lookup/acquisition tests.
 */
function buildProviderCandidate(): ProviderLookupCandidate {
  return {
    importAllowed: true,
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    matchConfidence: 1,
    matchType: "exact_provider_part_id",
    mpn: "RC-02W300JT",
    package: "0402",
    providerId: "jlcparts",
    providerPartKey: "C1091",
    sourceUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html"
  };
}

/**
 * Builds a second candidate row so rendered panel tests can verify the one-active-job lock across multiple buttons.
 */
function buildSecondProviderCandidate(): ProviderLookupCandidate {
  return {
    importAllowed: true,
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    matchConfidence: 1,
    matchType: "exact_mpn",
    mpn: "RC-03W100JT",
    package: "0603",
    providerId: "jlcparts",
    providerPartKey: "C2040",
    sourceUrl: "https://lcsc.com/product-detail/example-second"
  };
}

/**
 * Builds one provider acquisition job detail payload for client status tests.
 */
function buildProviderJobDetail(
  jobStatus: ProviderAcquisitionJob["jobStatus"],
  overrides: Partial<ProviderAcquisitionJob> = {}
): ProviderAcquisitionJobDetailResponse {
  const job: ProviderAcquisitionJob = {
    completedAt: jobStatus === "queued" || jobStatus === "running" ? null : "2026-04-24T12:00:05.000Z",
    errorCode: jobStatus === "failed" ? "PROVIDER_IMPORT_FAILED" : null,
    errorMessage: jobStatus === "failed" ? importUiCopy.providerAcquisitionFailed : null,
    id: "acqjob-jlcparts-c1091",
    importOutcome: jobStatus === "succeeded" ? "new_import" : null,
    jobStatus,
    lastUpdatedAt: "2026-04-24T12:00:05.000Z",
    manufacturerName: "Guangdong Fenghua Advanced Tech",
    matchConfidence: 1,
    matchType: "exact_provider_part_id",
    mpn: "RC-02W300JT",
    orgId: "org-default",
    package: "0402",
    partId: jobStatus === "succeeded" ? "part-jlcparts-c1091" : null,
    previousImportStatus: null,
    providerId: "jlcparts",
    providerPartKey: "C1091",
    requestedAt: "2026-04-24T12:00:00.000Z",
    requestedBy: "admin-user",
    requestedLookup: "RC-02W300JT",
    sourceUrl: "https://lcsc.com/product-detail/Chip-Resistor---Surface-Mount_FH-Guangdong-Fenghua-Advanced-Tech-RC-02W300JT_C1091.html",
    startedAt: jobStatus === "queued" ? null : "2026-04-24T12:00:01.000Z",
    ...overrides
  };

  return {
    events: [
      {
        createdAt: "2026-04-24T12:00:01.000Z",
        detail: null,
        eventType: jobStatus,
        id: `acqevent-${jobStatus}`,
        jobId: job.id,
        message: `Acquisition job ${jobStatus}.`
      }
    ],
    job
  };
}

/**
 * Replaces global fetch for one API client test and returns a restore callback.
 */
function mockFetch(handler: (url: URL, init?: RequestInit) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

/**
 * Builds a JSON response with stable headers for the web API client.
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
 * Counts disabled buttons in server-rendered markup so panel-lock tests can stay lightweight.
 */
function countDisabledButtons(html: string): number {
  return html.match(/<button[^>]*disabled=""/gu)?.length ?? 0;
}
