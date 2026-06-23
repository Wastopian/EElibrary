/**
 * File header: Tests the interconnect workspace rendering against cable, fixture, and pin-map contracts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import InterconnectsPage from "./page";
import { buildInterconnectProjectOptions, filterInterconnectRecords } from "./InterconnectBrowser";
import type { InterconnectDashboardResponse } from "@ee-library/shared/types";

/**
 * Verifies the interconnect workspace renders cables, fixtures, pin rows, and safe boundary copy.
 */
test("interconnect workspace renders cable, fixture, and pin-map rows", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/interconnects") {
      return jsonResponse({
        data: buildInterconnectResponse(),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await InterconnectsPage());

    assert.match(html, /Cable and fixture memory/u);
    assert.match(html, /Find interconnect records/u);
    assert.match(html, /Search interconnects/u);
    assert.match(html, /All projects/u);
    assert.match(html, /Cable &amp; fixture status/u);
    assert.match(html, /Needs check only/u);
    assert.match(html, /CAB-DEMO-PMC-JST-PWR/u);
    assert.match(html, /TFX-DEMO-PMC-BRINGUP/u);
    assert.match(html, /J202 pin 47/u);
    assert.match(html, /RS422_TX\+/u);
    assert.match(html, /62%/u);
    assert.match(html, /where-used\?targetType=document&amp;q=J202/u);
    assert.match(html, /projects\/project-demo-pocket-mcu/u);
    assert.match(html, /What this page does not decide/u);
    assert.match(html, /Reuse still needs a human check/u);
  } finally {
    restoreFetch();
  }
});

/** Verifies client-side lookup can isolate signals and records needing another check. */
test("interconnect browser filters across record families and review state", () => {
  const response = buildInterconnectResponse();
  const signalMatches = filterInterconnectRecords(response, "RS422_TX+", false);
  const pinMatches = filterInterconnectRecords(response, "pin 47", false);
  const destinationPinMatches = filterInterconnectRecords(response, "J201 pin 47", false);
  const fixtureMatches = filterInterconnectRecords(response, "bring-up fixture", false);
  const needsCheck = filterInterconnectRecords(response, "", true);

  assert.equal(signalMatches.cables.length, 0);
  assert.equal(signalMatches.fixtures.length, 0);
  assert.equal(signalMatches.pinRows.length, 1);
  assert.equal(pinMatches.pinRows.length, 1);
  assert.equal(destinationPinMatches.pinRows.length, 1);
  assert.equal(fixtureMatches.fixtures.length, 1);
  assert.equal(needsCheck.cables.length, 1);
  assert.equal(needsCheck.fixtures.length, 1);
  assert.equal(needsCheck.pinRows.length, 1);
});

/** Verifies the project dropdown scopes every record family, including pin rows via their cable. */
test("interconnect browser filters by project across cables, fixtures, and pins", () => {
  const response = buildInterconnectResponse();

  const inProject = filterInterconnectRecords(response, "", false, { projectKey: "DEMO-POCKET-MCU" });
  assert.equal(inProject.cables.length, 1);
  assert.equal(inProject.fixtures.length, 1);
  assert.equal(inProject.pinRows.length, 1);

  const otherProject = filterInterconnectRecords(response, "", false, { projectKey: "SOME-OTHER-PROGRAM" });
  assert.equal(otherProject.cables.length, 0);
  assert.equal(otherProject.fixtures.length, 0);
  assert.equal(otherProject.pinRows.length, 0);
});

/** Verifies the status dropdown isolates cable and fixture records by recorded status. */
test("interconnect browser filters cables and fixtures by status", () => {
  const response = buildInterconnectResponse();

  const inReview = filterInterconnectRecords(response, "", false, { status: "in_review" });
  assert.equal(inReview.cables.length, 1);
  assert.equal(inReview.fixtures.length, 0);

  const restricted = filterInterconnectRecords(response, "", false, { status: "restricted" });
  assert.equal(restricted.cables.length, 0);
  assert.equal(restricted.fixtures.length, 1);

  const approved = filterInterconnectRecords(response, "", false, { status: "approved" });
  assert.equal(approved.cables.length, 0);
  assert.equal(approved.fixtures.length, 0);
});

/** Verifies the project options builder returns each distinct project present in the records. */
test("buildInterconnectProjectOptions lists distinct projects from records", () => {
  const options = buildInterconnectProjectOptions(buildInterconnectResponse());

  assert.equal(options.length, 1);
  assert.equal(options[0]?.key, "DEMO-POCKET-MCU");
  assert.match(options[0]?.label ?? "", /DEMO-POCKET-MCU/u);
});

/**
 * Verifies setup failures render recovery copy instead of demo rows.
 */
test("interconnect workspace renders setup guidance when the database is unavailable", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("not_configured"));
    }

    if (url.pathname === "/interconnects") {
      return jsonResponse(
        {
          error: {
            code: "DB_NOT_CONFIGURED",
            message: "Project memory database is not configured."
          }
        },
        503
      );
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = renderToStaticMarkup(await InterconnectsPage());

    assert.match(html, /catalog database is not connected yet/u);
    assert.match(html, /Cable and fixture memory needs the interconnect tables/u);
    assert.match(html, /DB_NOT_CONFIGURED/u);
    assert.doesNotMatch(html, /CAB-DEMO-PMC-JST-PWR/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Replaces global fetch with an interconnect page API handler.
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
 * Builds the lightweight API health response used by workspace tests.
 */
function buildHealthResponse(database: "connected" | "not_configured") {
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
 * Builds a representative interconnect dashboard response.
 */
function buildInterconnectResponse(): InterconnectDashboardResponse {
  return {
    boundary: "Interconnect records show what is on file for cables, fixture ports, and pin maps. They do not approve parts, prove a bench setup is safe, or make export files available.",
    cableAssemblies: [
      {
        assemblyStatus: "in_review",
        cableKey: "CAB-DEMO-PMC-JST-PWR",
        createdAt: "2026-05-16T12:00:00.000Z",
        description: "Demo battery harness from JST-PH to fixture port J202.",
        ends: [
          {
            backshellPart: buildUnknownPart(),
            cableAssemblyId: "cable-demo-pocket-mcu-jst-power",
            connectorPart: {
              manufacturerName: "JST",
              mpn: "JST-PH-2P-HSG",
              partId: "part-ci-jst-ph-housing"
            },
            connectorRef: "J1",
            endLabel: "A",
            id: "cable-demo-pocket-mcu-jst-power-end-a",
            matePart: {
              manufacturerName: "JST",
              mpn: "JST-PH-2P-MATE",
              partId: "part-ci-jst-ph-mate"
            },
            notes: "Catalog-matched JST-PH housing end."
          },
          {
            backshellPart: buildUnknownPart(),
            cableAssemblyId: "cable-demo-pocket-mcu-jst-power",
            connectorPart: buildUnknownPart(),
            connectorRef: "J202",
            endLabel: "B",
            id: "cable-demo-pocket-mcu-jst-power-end-b",
            matePart: buildUnknownPart(),
            notes: "Fixture-facing J202 end."
          }
        ],
        fixturePortCount: 1,
        id: "cable-demo-pocket-mcu-jst-power",
        owner: "demo-hardware",
        pinRowCount: 24,
        projectId: "project-demo-pocket-mcu",
        projectKey: "DEMO-POCKET-MCU",
        projectName: "Demo Pocket MCU",
        projectRevisionId: "rev-project-demo-pocket-mcu-r0-2",
        projectRevisionLabel: "R0.2",
        provenance: "project_file",
        revisionLabel: "R0.2",
        sourceDocumentRef: "demo-cable-cab-demo-pmc-jst-pwr-r0.2.csv",
        updatedAt: "2026-05-16T12:00:00.000Z"
      }
    ],
    fixtures: [
      {
        createdAt: "2026-05-16T12:00:00.000Z",
        fixtureKey: "TFX-DEMO-PMC-BRINGUP",
        fixtureStatus: "restricted",
        id: "fixture-demo-pocket-mcu-bringup",
        owner: "demo-lab",
        pinRowCount: 24,
        ports: [
          {
            cableAssemblyId: "cable-demo-pocket-mcu-jst-power",
            cableKey: "CAB-DEMO-PMC-JST-PWR",
            connectorPart: buildUnknownPart(),
            connectorRef: "J202",
            fixtureId: "fixture-demo-pocket-mcu-bringup",
            id: "fixture-demo-pocket-mcu-bringup-port-j202",
            matePart: buildUnknownPart(),
            notes: "Use only with the seeded R0.2 cable until bench review is complete.",
            portRole: "Battery harness input"
          }
        ],
        projectId: "project-demo-pocket-mcu",
        projectKey: "DEMO-POCKET-MCU",
        projectName: "Demo Pocket MCU",
        provenance: "project_file",
        purpose: "Demo bring-up fixture with J201 and J202 ports.",
        revisionLabel: "B",
        sourceDocumentRef: "demo-fixture-tfx-demo-pmc-bringup-ports.md",
        updatedAt: "2026-05-16T12:00:00.000Z"
      }
    ],
    pinMapRows: [
      {
        cableAssemblyId: "cable-demo-pocket-mcu-jst-power",
        cableEndId: "cable-demo-pocket-mcu-jst-power-end-b",
        cableKey: "CAB-DEMO-PMC-JST-PWR",
        confidenceScore: 0.62,
        connectorRef: "J202",
        destinationConnectorRef: "J201",
        destinationPinNumber: "47",
        endLabel: "B",
        evidenceAttachmentId: "evidence-demo-pocket-mcu-review-link",
        fixturePortId: "fixture-demo-pocket-mcu-bringup-port-j202",
        id: "pin-demo-pocket-mcu-j202-47",
        notes: "Known review item: Rev C and Rev D disagree on this pair.",
        pinNumber: "47",
        revisionLabel: "R0.2",
        signalName: "RS422_TX+",
        sourceDocumentRef: "demo-cable-cab-demo-pmc-jst-pwr-r0.2.csv",
        wireColor: "blue/white",
        wireGauge: 26
      }
    ],
    state: "available",
    summary: {
      approvedCableAssemblyCount: 0,
      cableAssemblyCount: 1,
      fixtureCount: 1,
      fixturePortCount: 1,
      lowConfidencePinRowCount: 2,
      pinMapRowCount: 24,
      restrictedRecordCount: 1
    }
  };
}

/**
 * Builds an unmatched part summary for connector refs not linked to a catalog part yet.
 */
function buildUnknownPart() {
  return {
    manufacturerName: null,
    mpn: null,
    partId: null
  };
}
