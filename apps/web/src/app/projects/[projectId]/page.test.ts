/**
 * File header: Tests the project memory detail rendering against read-only API responses.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProjectDetailPage from "./page";
import type { ProjectDetailResponse, ProjectMemoryCapability, ProjectSummary } from "@ee-library/shared/types";

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

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderProjectDetailPage("project-alpha");

    assert.match(html, /Motor controller alpha/u);
    assert.match(html, /Project summary/u);
    assert.match(html, /Revisions/u);
    assert.match(html, /Rev A/u);
    assert.match(html, /Released/u);
    assert.match(html, /BOM imports/u);
    assert.match(html, /Upload mapped BOM/u);
    assert.match(html, /Upload a CSV to preview rows/u);
    assert.match(html, /alpha-bom.csv/u);
    assert.match(html, /Processed/u);
    assert.match(html, /Confirmed usage/u);
    assert.match(html, /part-tps7a02dbvr/u);
    assert.match(html, /U1/u);
    assert.match(html, /BOM health dashboard is planned/u);
    assert.match(html, /Planned workflows/u);
    assert.doesNotMatch(html, /BOM health dashboard is ready/u);
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

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderProjectDetailPage("project-alpha");

    assert.match(html, /No revisions yet/u);
    assert.match(html, /No BOM imports yet/u);
    assert.match(html, /Use the CSV intake panel above/u);
    assert.match(html, /No confirmed part usage yet/u);
    assert.match(html, /does not invent risk counts/u);
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
      detail: "Where-used views will read from confirmed project usage records.",
      id: "where_used",
      label: "Where-used",
      state: "planned"
    },
    {
      detail: "BOM health and risk projections are planned after usage history exists.",
      id: "bom_health",
      label: "BOM health",
      state: "planned"
    },
    {
      detail: "Circuit block records are planned as structured engineering knowledge.",
      id: "circuit_blocks",
      label: "Circuit blocks",
      state: "planned"
    }
  ];
}
