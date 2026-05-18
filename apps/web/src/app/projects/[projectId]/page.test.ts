/**
 * File header: Tests the project memory detail rendering against read-only API responses.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProjectDetailPage from "./page";
import type { FollowUpListResponse, ProjectBomHealthResponse, ProjectDetailResponse, ProjectEvidenceAttachmentsResponse, ProjectMemoryCapability, ProjectOverlapPanelResponse, ProjectSummary } from "@ee-library/shared/types";

/**
 * Verifies persisted project detail data renders revisions, BOM imports, and confirmed usage.
 */
test("project detail renders persisted project memory sections", async () => {
  const response = buildProjectDetailResponse();
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/projects/project-alpha") {
      return jsonResponse({
        data: response,
        source: "database"
      });
    }

    if (url.pathname === "/projects/project-alpha/bom-health") {
      return jsonResponse({
        data: buildProjectBomHealthResponse("project-alpha"),
        source: "database"
      });
    }

    if (url.pathname === "/projects/project-alpha/evidence") {
      return jsonResponse({
        data: buildProjectEvidenceResponse("project-alpha"),
        source: "database"
      });
    }

    if (url.pathname === "/projects/project-alpha/follow-ups") {
      return jsonResponse({
        data: buildProjectFollowUpsResponse("project-alpha"),
        source: "database"
      });
    }

    if (url.pathname === "/projects/project-alpha/overlap") {
      return jsonResponse({
        data: buildProjectOverlapResponse("project-alpha"),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderProjectDetailPage("project-alpha");

    assert.match(html, /Motor controller alpha/u);
    assert.match(html, /Prior project overlap/u);
    assert.match(html, /Beta Build/u);
    assert.match(html, /Main LDO/u);
    assert.match(html, /Parts in this project/u);
    assert.match(html, /Upload parts list/u);
    assert.match(html, /Advanced project tools/u);
    assert.match(html, /Project summary/u);
    assert.match(html, /Project first-run checklist/u);
    assert.match(html, /Actionable next steps/u);
    assert.match(html, /Upload next BOM revision/u);
    assert.match(html, /Triage BOM health findings/u);
    assert.match(html, /Next project workspaces/u);
    assert.match(html, /Compare used parts/u);
    assert.match(html, /Search where-used/u);
    assert.match(html, /Attach project evidence/u);
    assert.match(html, /Use circuit blocks/u);
    assert.match(html, /Install\/export files/u);
    assert.match(html, /Edit project memory/u);
    assert.match(html, /Save project/u);
    assert.match(html, /Save revision/u);
    assert.match(html, /Revisions/u);
    assert.match(html, /Rev A/u);
    assert.match(html, /Released/u);
    assert.match(html, /BOM imports/u);
    assert.match(html, /Upload mapped BOM/u);
    assert.match(html, /Upload a CSV or XLSX file to preview rows/u);
    assert.match(html, /alpha-bom.csv/u);
    assert.match(html, /Processed/u);
    assert.match(html, /Match rows/u);
    assert.match(html, /Confirmed usage/u);
    assert.match(html, /part-tps7a02dbvr/u);
    assert.match(html, /U1/u);
    assert.match(html, /BOM health and risk/u);
    assert.match(html, /Missing verified CAD\/export assets/u);
    assert.match(html, /referenced CAD alone does not unlock export/u);
    assert.match(html, /Follow-up work/u);
    assert.match(html, /Refresh from computed gaps/u);
    assert.match(html, /CAD evidence follow-up/u);
    assert.match(html, /Evidence attachments/u);
    assert.match(html, /Design review link/u);
    assert.match(html, /Evidence is provenance/u);
    assert.match(html, /Available now/u);
    assert.match(html, /Capability state/u);
    assert.doesNotMatch(html, /No capabilities reported/u);
    assert.doesNotMatch(html, /BOM health dashboard is planned/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies project detail empty child collections stay clear about planned workflows.
 */
test("project detail renders empty child sections honestly", async () => {
  const baseResponse = buildProjectDetailResponse();
  const response: ProjectDetailResponse = {
    ...baseResponse,
    bomImports: [],
    revisions: [],
    summary: {
      ...baseResponse.summary,
      bomImportCount: 0,
      revisionCount: 0,
      usageCount: 0
    },
    usages: []
  };
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/projects/project-alpha") {
      return jsonResponse({
        data: response,
        source: "database"
      });
    }

    if (url.pathname === "/projects/project-alpha/bom-health") {
      return jsonResponse({
        data: buildEmptyProjectBomHealthResponse("project-alpha"),
        source: "database"
      });
    }

    if (url.pathname === "/projects/project-alpha/evidence") {
      return jsonResponse({
        data: {
          attachments: [],
          projectId: "project-alpha",
          state: "empty"
        } satisfies ProjectEvidenceAttachmentsResponse,
        source: "database"
      });
    }

    if (url.pathname === "/projects/project-alpha/follow-ups") {
      return jsonResponse({
        data: buildEmptyProjectFollowUpsResponse("project-alpha"),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderProjectDetailPage("project-alpha");

    assert.match(html, /No revisions yet/u);
    assert.match(html, /Project first-run checklist/u);
    assert.match(html, /Actionable next steps/u);
    assert.match(html, /Upload first BOM/u);
    assert.match(html, /Match imported BOM rows/u);
    assert.match(html, /No BOM imports yet/u);
    assert.match(html, /Use the CSV intake panel above/u);
    assert.match(html, /No confirmed part usage yet/u);
    assert.match(html, /No parts list to check/u);
    assert.match(html, /No follow-ups yet/u);
    assert.match(html, /No evidence yet/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies a missing project returns Next.js not-found behavior instead of fake project memory.
 */
test("project detail returns not found when the API returns 404", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/projects/project-missing") {
      return jsonResponse(
        {
          error: {
            code: "PROJECT_NOT_FOUND",
            message: "Project not found."
          }
        },
        404
      );
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    await assert.rejects(async () => {
      await ProjectDetailPage({ params: Promise.resolve({ projectId: "project-missing" }) });
    }, /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND|not.?found/iu);
  } finally {
    restoreFetch();
  }
});

/**
 * Renders a project detail server component to static markup.
 */
async function renderProjectDetailPage(projectId: string): Promise<string> {
  return renderToStaticMarkup(await ProjectDetailPage({ params: Promise.resolve({ projectId }) }));
}

/**
 * Replaces global fetch with a project detail API handler.
 */
function mockFetch(handler: (url: URL) => Response): () => void {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());

    try {
      return handler(url);
    } catch (error) {
      if (/^\/projects\/[^/]+\/bom-health$/u.test(url.pathname)) {
        return jsonResponse({
          data: buildProjectBomHealthResponse(readProjectIdFromChildPath(url.pathname, "bom-health")),
          source: "database"
        });
      }

      if (/^\/projects\/[^/]+\/evidence$/u.test(url.pathname)) {
        return jsonResponse({
          data: buildProjectEvidenceResponse(readProjectIdFromChildPath(url.pathname, "evidence")),
          source: "database"
        });
      }

      if (/^\/projects\/[^/]+\/follow-ups$/u.test(url.pathname)) {
        return jsonResponse({
          data: buildProjectFollowUpsResponse(readProjectIdFromChildPath(url.pathname, "follow-ups")),
          source: "database"
        });
      }

      throw error;
    }
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
  };
}

/**
 * Reads a project id from a project child route path.
 */
function readProjectIdFromChildPath(pathname: string, child: "bom-health" | "evidence" | "follow-ups"): string {
  const match = new RegExp(`^/projects/([^/]+)/${child}$`, "u").exec(pathname);

  return match?.[1] ? decodeURIComponent(match[1]) : "project-alpha";
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
 * Builds the lightweight health response used by project detail tests.
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
 * Builds the project BOM health response used by detail tests.
 */
function buildProjectBomHealthResponse(projectId: string): ProjectBomHealthResponse {
  return {
    findings: [
      {
        affectedBomLineIds: ["bom-line-alpha-1"],
        affectedPartIds: ["part-tps7a02dbvr"],
        code: "missing_verified_cad",
        detail: "1 matched BOM row does not have a complete verified file-backed CAD/export set.",
        id: `${projectId}:bom-health:missing_verified_cad`,
        inputs: ["U1: TPS7A02DBVR, lifecycle=active, approval=approved, verifiedCad=0/3, referencedCad=1, evidence=1."],
        nextAction: "Review symbol, footprint, and 3D model coverage; referenced CAD alone does not unlock export.",
        projectId,
        severity: "review",
        title: "Missing verified CAD/export assets"
      }
    ],
    generatedAt: "2026-05-01T12:00:00.000Z",
    lifecycleReviewCheckpointAt: null,
    projectId,
    state: "available",
    summary: {
      ambiguousLineCount: 0,
      approvalGapCount: 0,
      connectorBuildabilityGapCount: 0,
      evidenceAttachmentCount: 1,
      ignoredLineCount: 0,
      lifecycleRegressionCount: 0,
      lifecycleRiskCount: 0,
      matchedLineCount: 1,
      missingEvidenceCount: 0,
      missingVerifiedCadCount: 1,
      referencedCadOnlyCount: 1,
      totalLineCount: 2,
      unmatchedLineCount: 0,
      weakMatchLineCount: 1
    }
  };
}

/**
 * Builds an empty project BOM health response for projects with no BOM rows.
 */
function buildEmptyProjectBomHealthResponse(projectId: string): ProjectBomHealthResponse {
  return {
    findings: [],
    generatedAt: "2026-05-01T12:00:00.000Z",
    lifecycleReviewCheckpointAt: null,
    projectId,
    state: "empty",
    summary: {
      ambiguousLineCount: 0,
      approvalGapCount: 0,
      connectorBuildabilityGapCount: 0,
      evidenceAttachmentCount: 0,
      ignoredLineCount: 0,
      lifecycleRegressionCount: 0,
      lifecycleRiskCount: 0,
      matchedLineCount: 0,
      missingEvidenceCount: 0,
      missingVerifiedCadCount: 0,
      referencedCadOnlyCount: 0,
      totalLineCount: 0,
      unmatchedLineCount: 0,
      weakMatchLineCount: 0
    }
  };
}

/**
 * Builds the project evidence response used by detail tests.
 */
function buildProjectEvidenceResponse(projectId: string): ProjectEvidenceAttachmentsResponse {
  return {
    attachments: projectId === "project-alpha"
      ? [
          {
            createdAt: "2026-05-01T11:00:00.000Z",
            evidenceType: "link",
            fileHash: null,
            id: "evidence-alpha-review",
            mimeType: null,
            notes: "Review preserved for project memory.",
            provenance: "manual_internal",
            reviewStatus: "unreviewed",
            sourceUrl: "https://example.test/design-review",
            storageKey: null,
            targetId: projectId,
            targetType: "project",
            title: "Design review link",
            updatedAt: "2026-05-01T11:00:00.000Z",
            uploadedBy: "test-admin"
          }
        ]
      : [],
    projectId,
    state: projectId === "project-alpha" ? "available" : "empty"
  };
}

/**
 * Builds a populated project follow-up response for detail tests.
 */
function buildProjectFollowUpsResponse(projectId: string): FollowUpListResponse {
  return {
    followUps: [
      {
        assignedTo: "hardware",
        createdAt: "2026-05-02T12:00:00.000Z",
        detail: "One matched BOM row still needs verified file-backed CAD/export evidence.",
        evidenceAttachmentIds: ["evidence-alpha-review"],
        id: "followup-alpha-cad",
        nextAction: "Review symbol, footprint, and 3D model coverage.",
        resolutionNotes: null,
        resolvedAt: null,
        severity: "review",
        sourceFindingId: `${projectId}:bom-health:missing_verified_cad`,
        sourceInputs: ["U1: TPS7A02DBVR, verifiedCad=0/3."],
        sourceType: "bom_health",
        status: "in_progress",
        targetId: projectId,
        targetType: "project",
        title: "CAD evidence follow-up",
        updatedAt: "2026-05-02T12:10:00.000Z"
      }
    ],
    state: "available",
    summary: {
      dangerCount: 0,
      dismissedCount: 0,
      inProgressCount: 1,
      openCount: 0,
      resolvedCount: 0,
      reviewCount: 1,
      totalCount: 1
    },
    targetId: projectId,
    targetType: "project"
  };
}

/**
 * Builds an empty project follow-up response for detail tests.
 */
function buildEmptyProjectFollowUpsResponse(projectId: string): FollowUpListResponse {
  return {
    followUps: [],
    state: "empty",
    summary: {
      dangerCount: 0,
      dismissedCount: 0,
      inProgressCount: 0,
      openCount: 0,
      resolvedCount: 0,
      reviewCount: 0,
      totalCount: 0
    },
    targetId: projectId,
    targetType: "project"
  };
}

/**
 * Builds a project overlap response with inspectable prior usage and block-role clues.
 */
function buildProjectOverlapResponse(projectId: string): ProjectOverlapPanelResponse {
  return {
    circuitBlockRoleHitsPreview: [
      {
        blockKey: "ALPHA-POWER",
        blockName: "Alpha power rail",
        blockPartId: "cbpart-alpha-power-ldo",
        blockStatus: "approved",
        circuitBlockId: "cblock-alpha-power",
        isRequired: true,
        mpn: "TPS7A02DBVR",
        partId: "part-tps7a02dbvr",
        quantity: 1,
        role: "Main LDO",
        substitutionPolicy: "exact_required"
      }
    ],
    circuitBlockWhereUsedHitCount: 1,
    connectorWhereUsedHitCount: 0,
    priorEngineeringMemoryWarnings: [],
    priorProjects: [
      {
        project: {
          createdAt: "2026-04-15T10:00:00.000Z",
          description: "Prior motor-controller build.",
          id: "project-beta",
          name: "Beta Build",
          owner: "Hardware",
          projectKey: "BETA",
          status: "active",
          updatedAt: "2026-04-15T12:00:00.000Z"
        },
        sharedPartCount: 1,
        sharedPartIds: ["part-tps7a02dbvr"],
        sharedPartsPreview: [
          {
            designatorsPreview: ["U1"],
            mpn: "TPS7A02DBVR",
            partId: "part-tps7a02dbvr",
            projectRevisionLabel: "A",
            quantityTotal: 1,
            usageCount: 1,
            usageStatus: "used"
          }
        ]
      }
    ],
    projectId,
    scannedPartCount: 1,
    state: "available"
  };
}

/**
 * Builds a complete project detail API response.
 */
function buildProjectDetailResponse(): ProjectDetailResponse {
  const summary = buildProjectSummary();

  return {
    bomImports: [
      {
        columnMapping: {
          designators: "Designator",
          mpn: "MPN",
          quantity: "Qty"
        },
        createdAt: "2026-04-30T11:30:00.000Z",
        id: "bom-alpha-1",
        importedBy: "Hardware",
        importStatus: "processed",
        importSummary: {
          rowCount: 2
        },
        projectId: "project-alpha",
        projectRevisionId: "revision-alpha-a",
        sourceFilename: "alpha-bom.csv",
        sourceFormat: "csv",
        storageKey: "bom/project-alpha/alpha-bom.csv",
        updatedAt: "2026-04-30T12:00:00.000Z"
      }
    ],
    capabilities: buildCapabilities(),
    project: summary.project,
    revisions: [
      {
        createdAt: "2026-04-30T10:30:00.000Z",
        id: "revision-alpha-a",
        projectId: "project-alpha",
        releasedAt: "2026-04-30T15:00:00.000Z",
        revisionLabel: "Rev A",
        revisionStatus: "released",
        sourceReference: "Altium project package",
        updatedAt: "2026-04-30T15:30:00.000Z"
      }
    ],
    state: "available",
    summary,
    usages: [
      {
        approvalSnapshot: {
          status: "approved"
        },
        bomLineId: "bom-line-alpha-1",
        createdAt: "2026-04-30T12:15:00.000Z",
        designators: ["U1"],
        id: "usage-alpha-1",
        partId: "part-tps7a02dbvr",
        projectId: "project-alpha",
        projectRevisionId: "revision-alpha-a",
        quantity: 1,
        readinessSnapshot: {
          status: "blocked"
        },
        updatedAt: "2026-04-30T12:30:00.000Z",
        usageContext: "Power rail",
        usageStatus: "used"
      }
    ]
  };
}

/**
 * Builds a representative project summary used by detail fixtures.
 */
function buildProjectSummary(): ProjectSummary {
  return {
    bomImportCount: 1,
    latestActivityAt: "2026-04-30T16:30:00.000Z",
    project: {
      createdAt: "2026-04-30T10:00:00.000Z",
      description: "Alpha motor controller board with first project-memory records.",
      id: "project-alpha",
      name: "Motor controller alpha",
      owner: "Hardware",
      projectKey: "ALPHA",
      status: "production",
      updatedAt: "2026-04-30T16:00:00.000Z"
    },
    revisionCount: 1,
    usageCount: 1
  };
}

/**
 * Builds capability metadata that keeps current foundations separate from planned workflows.
 */
function buildCapabilities(): ProjectMemoryCapability[] {
  return [
    {
      detail: "Project records can be read when they exist in the database.",
      id: "project_records",
      label: "Project records",
      state: "foundation"
    },
    {
      detail: "BOM import metadata and persisted rows can be read after CSV intake creates them.",
      id: "bom_import_records",
      label: "BOM import records",
      state: "foundation"
    },
    {
      detail: "CSV BOM upload and column mapping can persist raw and mapped BOM lines without part matching.",
      id: "bom_upload",
      label: "BOM upload",
      state: "foundation"
    },
    {
      detail: "BOM row matching can confirm exact internal MPN/manufacturer rows.",
      id: "bom_matching",
      label: "BOM matching",
      state: "foundation"
    },
    {
      detail: "Where-used reads expose confirmed project usage by part.",
      id: "where_used",
      label: "Where-used",
      state: "foundation"
    },
    {
      detail: "BOM health derives explainable risk findings.",
      id: "bom_health",
      label: "BOM health",
      state: "foundation"
    },
    {
      detail: "Evidence attachment metadata can be preserved.",
      id: "evidence_vault",
      label: "Evidence vault",
      state: "foundation"
    },
    {
      detail: "Circuit block records preserve structured reusable circuit knowledge.",
      id: "circuit_blocks",
      label: "Circuit blocks",
      state: "foundation"
    }
  ];
}
