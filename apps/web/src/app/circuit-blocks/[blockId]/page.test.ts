/**
 * File header: Tests the circuit block detail page against linked part and evidence contracts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CircuitBlockDetailPage from "./page";
import type { CircuitBlockDetailResponse, FollowUpListResponse } from "@ee-library/shared/types";

/**
 * Verifies circuit block detail renders linked part readiness and evidence boundaries.
 */
test("circuit block detail renders part roles and evidence without overriding readiness", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/circuit-blocks/cblock-alpha-power") {
      return jsonResponse({
        data: buildCircuitBlockDetailResponse(),
        source: "database"
      });
    }

    if (url.pathname === "/circuit-blocks/cblock-alpha-power/follow-ups") {
      return jsonResponse({
        data: buildCircuitBlockFollowUpsResponse("cblock-alpha-power"),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderCircuitBlockDetailPage("cblock-alpha-power");

    assert.match(html, /Alpha power rail/u);
    assert.match(html, /ALPHA-POWER/u);
    assert.match(html, /Edit circuit block/u);
    assert.match(html, /Save circuit block/u);
    assert.match(html, /Main LDO/u);
    assert.match(html, /TPS7A02DBVR/u);
    assert.match(html, /needs_attention/u);
    assert.match(html, /Exact required/u);
    assert.match(html, /Save/u);
    assert.match(html, /Add part role/u);
    assert.match(html, /Follow-up work/u);
    assert.match(html, /Main LDO needs reuse readiness review/u);
    assert.match(html, /Attach circuit evidence/u);
    assert.match(html, /Circuit review/u);
    assert.match(html, /does not approve the block/u);
    assert.match(html, /Next workspaces/u);
    assert.match(html, /Open where-used for ALPHA-POWER/u);
    assert.match(html, /Pick a project to instantiate/u);
    assert.match(html, /See all power blocks/u);
    assert.match(html, /Known risks/u);
    assert.match(html, /No known risks recorded/u);
    assert.match(html, /Recording or resolving a known risk does not approve/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies the known-risks section renders active and resolved rows with severity badges and
 * surfaces the unresolved-blocking-risk gate in the reuse-readiness strip detail copy.
 */
test("circuit block detail renders known risks with severity badges and gates on unresolved blocking risks", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/circuit-blocks/cblock-alpha-power") {
      const fixture = buildCircuitBlockDetailResponse();
      fixture.knownRisks = [
        {
          circuitBlockId: "cblock-alpha-power",
          createdAt: "2026-05-01T12:00:00.000Z",
          detail: "Output cap > 22uF caused VIN dip on Bravo Rev B.",
          evidenceUrl: null,
          id: "cbrisk-alpha-inrush",
          recordedAt: "2026-05-01T12:00:00.000Z",
          recordedBy: "gerry@hardware",
          resolutionNotes: null,
          resolvedAt: null,
          resolvedBy: null,
          severity: "blocking",
          title: "Silicon RevG erratum",
          updatedAt: "2026-05-01T12:00:00.000Z"
        },
        {
          circuitBlockId: "cblock-alpha-power",
          createdAt: "2026-04-20T08:00:00.000Z",
          detail: "Old observation, no longer applies after layout fix.",
          evidenceUrl: null,
          id: "cbrisk-alpha-resolved",
          recordedAt: "2026-04-20T08:00:00.000Z",
          recordedBy: "gerry@hardware",
          resolutionNotes: "Resolved in Bravo Rev C layout.",
          resolvedAt: "2026-04-30T09:00:00.000Z",
          resolvedBy: "gerry@hardware",
          severity: "caution",
          title: "Original inrush note",
          updatedAt: "2026-04-30T09:00:00.000Z"
        }
      ];
      fixture.summary.activeKnownRiskCount = 1;
      fixture.summary.activeBlockingRiskCount = 1;
      return jsonResponse({ data: fixture, source: "database" });
    }

    if (url.pathname === "/circuit-blocks/cblock-alpha-power/follow-ups") {
      return jsonResponse({
        data: buildCircuitBlockFollowUpsResponse("cblock-alpha-power"),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderCircuitBlockDetailPage("cblock-alpha-power");

    assert.match(html, /Known risks/u);
    assert.match(html, /Silicon RevG erratum/u);
    assert.match(html, /Blocking/u);
    assert.match(html, /Resolved \(1\)/u);
    assert.match(html, /Original inrush note/u);
    assert.match(html, /unresolved blocking risk/iu);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies a missing circuit block returns Next.js not-found behavior.
 */
test("circuit block detail returns not found when the API returns 404", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/circuit-blocks/cblock-missing") {
      return jsonResponse(
        {
          error: {
            code: "CIRCUIT_BLOCK_NOT_FOUND",
            message: "Circuit block not found."
          }
        },
        404
      );
    }

    if (url.pathname === "/circuit-blocks/cblock-missing/follow-ups") {
      return jsonResponse(
        {
          error: {
            code: "CIRCUIT_BLOCK_NOT_FOUND",
            message: "Circuit block not found."
          }
        },
        404
      );
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    await assert.rejects(async () => {
      await CircuitBlockDetailPage({ params: Promise.resolve({ blockId: "cblock-missing" }) });
    }, /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND|not.?found/iu);
  } finally {
    restoreFetch();
  }
});

/**
 * Renders the circuit block detail server component to static markup.
 */
async function renderCircuitBlockDetailPage(blockId: string): Promise<string> {
  return renderToStaticMarkup(await CircuitBlockDetailPage({ params: Promise.resolve({ blockId }) }));
}

/**
 * Replaces global fetch with a circuit block detail API handler.
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
 * Builds a circuit block follow-up fixture from a required role readiness gap.
 */
function buildCircuitBlockFollowUpsResponse(circuitBlockId: string): FollowUpListResponse {
  return {
    followUps: [
      {
        assignedTo: null,
        createdAt: "2026-05-02T12:00:00.000Z",
        detail: "Required role \"Main LDO\" uses TPS7A02DBVR and still has readiness=needs_attention, blockers=1.",
        evidenceAttachmentIds: [],
        id: "followup-cblock-alpha-power-main-ldo",
        nextAction: "Resolve linked part approval/readiness blockers or attach supporting circuit evidence.",
        resolutionNotes: null,
        resolvedAt: null,
        severity: "review",
        sourceFindingId: `${circuitBlockId}:circuit-gap:cbpart-alpha-power-ldo`,
        sourceInputs: ["Main LDO: TPS7A02DBVR, readiness=needs_attention, blockers=1."],
        sourceType: "circuit_block_gap",
        status: "open",
        targetId: circuitBlockId,
        targetType: "circuit_block",
        title: "Main LDO needs reuse readiness review",
        updatedAt: "2026-05-02T12:10:00.000Z"
      }
    ],
    state: "available",
    summary: {
      dangerCount: 0,
      dismissedCount: 0,
      inProgressCount: 0,
      openCount: 1,
      resolvedCount: 0,
      reviewCount: 1,
      totalCount: 1
    },
    targetId: circuitBlockId,
    targetType: "circuit_block"
  };
}

/**
 * Builds a circuit block detail fixture with one readiness gap and one evidence row.
 */
function buildCircuitBlockDetailResponse(): CircuitBlockDetailResponse {
  const circuitBlock = {
    blockKey: "ALPHA-POWER",
    blockType: "power" as const,
    constraints: { note: "Keep near the load." },
    createdAt: "2026-05-01T12:00:00.000Z",
    description: "Reusable LDO rail.",
    id: "cblock-alpha-power",
    name: "Alpha power rail",
    owner: "Hardware",
    reuseScope: "Fixture power rails",
    status: "approved" as const,
    updatedAt: "2026-05-01T13:00:00.000Z"
  };

  return {
    boundary: "Circuit blocks preserve reusable design knowledge; linked part approval, readiness, validation, and export status remain independent.",
    circuitBlock,
    evidence: [
      {
        createdAt: "2026-05-01T12:30:00.000Z",
        evidenceType: "link",
        fileHash: null,
        id: "evidence-cblock-review",
        mimeType: null,
        notes: null,
        provenance: "manual_internal",
        reviewStatus: "unreviewed",
        sourceUrl: "https://example.test/circuit-review",
        storageKey: null,
        targetId: "cblock-alpha-power",
        targetType: "circuit_block",
        title: "Circuit review",
        updatedAt: "2026-05-01T12:30:00.000Z",
        uploadedBy: "test-admin"
      }
    ],
    parts: [
      {
        blockPart: {
          circuitBlockId: "cblock-alpha-power",
          createdAt: "2026-05-01T12:10:00.000Z",
          id: "cbpart-alpha-power-ldo",
          isRequired: true,
          notes: "Use with reviewed output capacitor.",
          partId: "part-memory-ldo",
          quantity: 1,
          role: "Main LDO",
          substitutionPolicy: "exact_required",
          updatedAt: "2026-05-01T12:10:00.000Z"
        },
        part: {
          approvalStatus: "approved",
          blockerCount: 1,
          connectorClass: "non_connector",
          lifecycleStatus: "active",
          manufacturerName: "Texas Instruments",
          mpn: "TPS7A02DBVR",
          partId: "part-memory-ldo",
          readinessStatus: "needs_attention"
        }
      }
    ],
    instantiations: [],
    knownRisks: [],
    projectDependencies: [],
    state: "available",
    summary: {
      activeBlockingRiskCount: 0,
      activeKnownRiskCount: 0,
      approvedPartCount: 1,
      circuitBlock,
      evidenceAttachmentCount: 1,
      lifecycleRiskCount: 0,
      optionalPartCount: 0,
      projectUsageCount: 1,
      readinessGapCount: 1,
      requiredPartCount: 1,
      strictSubstitutionCount: 0,
      totalPartCount: 1
    }
  };
}
