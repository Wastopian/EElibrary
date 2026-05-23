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
    assert.match(html, /Linked-part metrics/u);
    assert.match(html, /Output Current Max/u);
    assert.match(html, /0.2 A/u);
    assert.match(html, /81% min/u);
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
 * Verifies the page degrades to an empty metric state when an older API omits metricRollup.
 */
test("circuit block detail tolerates legacy responses without a metric rollup", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/circuit-blocks/cblock-alpha-power") {
      const fixture = buildCircuitBlockDetailResponse();
      delete (fixture as Partial<CircuitBlockDetailResponse>).metricRollup;
      return jsonResponse({
        data: fixture,
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

    assert.match(html, /Linked-part metrics/u);
    assert.match(html, /No linked-part metrics/u);
    assert.match(html, /unavailable from this API response/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies reuse history shows whether a past project still matches the current pattern.
 */
test("circuit block detail renders instantiation current-pattern drift", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/circuit-blocks/cblock-alpha-power") {
      const fixture = buildCircuitBlockDetailResponse();
      fixture.instantiations = [
        {
          bomImport: {
            columnMapping: {},
            createdAt: "2026-05-02T12:00:00.000Z",
            id: "bominst-alpha",
            importStatus: "processed",
            importSummary: {},
            importedBy: "test-admin",
            projectId: "project-alpha",
            projectRevisionId: "rev-alpha-a",
            sourceFilename: "Circuit block: Alpha power rail",
            sourceFormat: "manual",
            storageKey: null,
            updatedAt: "2026-05-02T12:00:00.000Z"
          },
          instantiatedBomLineCount: 1,
          instantiation: {
            bomImportId: "bominst-alpha",
            circuitBlockId: "cblock-alpha-power",
            createdAt: "2026-05-02T12:00:00.000Z",
            createdBy: "test-admin",
            designatorPrefix: "U",
            id: "cbinst-alpha",
            includeOptional: false,
            notes: null,
            projectId: "project-alpha",
            projectRevisionId: "rev-alpha-a"
          },
          patternDrift: {
            currentRoleCount: 2,
            instantiatedRoleCount: 1,
            items: [
              {
                currentCircuitBlockPartId: "cbpart-alpha-power-cap",
                currentPartId: "part-output-cap",
                currentPartMpn: "GRM188R61E106KA73D",
                detail: "Output capacitor (GRM188R61E106KA73D) is in the current pattern but not in this project instantiation.",
                instantiatedBomLineId: null,
                instantiatedPartId: null,
                instantiatedPartMpn: null,
                kind: "missing_current_role",
                role: "Output capacitor",
                severity: "drift"
              }
            ],
            status: "drifted"
          },
          project: {
            createdAt: "2026-05-01T00:00:00.000Z",
            description: "Fixture project.",
            id: "project-alpha",
            name: "Alpha Controller",
            owner: "Hardware",
            projectKey: "ALPHA",
            status: "active",
            updatedAt: "2026-05-01T00:00:00.000Z"
          },
          revision: {
            createdAt: "2026-05-01T00:00:00.000Z",
            id: "rev-alpha-a",
            projectId: "project-alpha",
            releasedAt: null,
            revisionLabel: "A",
            revisionStatus: "draft",
            sourceReference: "alpha-a",
            updatedAt: "2026-05-01T00:00:00.000Z"
          }
        }
      ];
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

    assert.match(html, /Current pattern/u);
    assert.match(html, /Drifted/u);
    assert.match(html, /1 difference across 1\/2 scoped roles/u);
    assert.match(html, /Output capacitor/u);
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
    metricRollup: {
      boundary: "Linked-part metrics are a read-only datasheet rollup with source confidence. They do not approve the circuit block, approve linked parts, validate assets, or unlock export.",
      entries: [
        {
          averageConfidenceScore: 0.81,
          coverageStatus: "complete",
          coveredOptionalRoleCount: 0,
          coveredRequiredRoleCount: 1,
          metricKey: "output_current_max",
          minConfidenceScore: 0.81,
          missingOptionalRoles: [],
          missingRequiredRoles: [],
          optionalRoleCount: 0,
          requiredRoleCount: 1,
          unit: "A",
          values: [
            {
              blockPartId: "cbpart-alpha-power-ldo",
              isRequired: true,
              manufacturerName: "Texas Instruments",
              metric: {
                confidenceScore: 0.81,
                id: "metric-memory-ldo-output-current",
                lastUpdatedAt: "2026-05-01T12:20:00.000Z",
                maxValue: null,
                metricKey: "output_current_max",
                metricValue: 0.2,
                minValue: null,
                partId: "part-memory-ldo",
                sourceRecordId: "source-memory-ldo",
                sourceRevisionId: "dsr-memory-ldo-a",
                unit: "A"
              },
              mpn: "TPS7A02DBVR",
              partId: "part-memory-ldo",
              quantity: 1,
              role: "Main LDO"
            }
          ]
        }
      ],
      metricCount: 1,
      rolesWithAnyMetricCount: 1,
      state: "available",
      totalRoleCount: 1
    },
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
