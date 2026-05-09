/**
 * File header: Tests the project memory dashboard rendering against project API contracts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProjectsPage from "./page";
import type { ProjectListResponse, ProjectMemoryCapability, ProjectSummary } from "@ee-library/shared/types";

/**
 * Verifies configured-but-empty project memory renders an honest empty state.
 */
test("projects dashboard renders empty DB state with project creation path", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/projects") {
      return jsonResponse({
        data: buildProjectListResponse([]),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderProjectsPage();

    assert.match(html, /Project memory/u);
    assert.match(html, /No project records yet/u);
    assert.match(html, /Create a project first/u);
    assert.match(html, /Create project/u);
    assert.match(html, /Current foundations/u);
    assert.match(html, /Where-used/u);
    assert.match(html, /Circuit blocks/u);
    assert.doesNotMatch(html, /Planned project memory/u);
    assert.doesNotMatch(html, /BOM health dashboard is ready/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies persisted project summaries render as navigable project-memory rows.
 */
test("projects dashboard renders persisted project summaries", async () => {
  const project = buildProjectSummary();
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("connected"));
    }

    if (url.pathname === "/projects") {
      return jsonResponse({
        data: buildProjectListResponse([project]),
        source: "database"
      });
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderProjectsPage();

    assert.match(html, /1 project records/u);
    assert.match(html, /ALPHA/u);
    assert.match(html, /Motor controller alpha/u);
    assert.match(html, /Production/u);
    assert.match(html, /2/u);
    assert.match(html, /href="\/projects\/project-alpha"/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Verifies project memory setup failures stay explicit and do not fall back to fake data.
 */
test("projects dashboard renders setup guidance when project memory is not configured", async () => {
  const restoreFetch = mockFetch((url) => {
    if (url.pathname === "/health") {
      return jsonResponse(buildHealthResponse("not_configured"));
    }

    if (url.pathname === "/projects") {
      return jsonResponse(
        {
          error: {
            code: "DB_NOT_CONFIGURED",
            message: "Project memory reads require a configured database so project, BOM, and usage state can be read."
          }
        },
        503
      );
    }

    throw new Error(`unexpected request: ${url.pathname}`);
  });

  try {
    const html = await renderProjectsPage();

    assert.match(html, /Project pages are paused/u);
    assert.match(html, /Open system checks/u);
    assert.match(html, /Finish setup to open projects/u);
    assert.doesNotMatch(html, /Motor controller alpha/u);
  } finally {
    restoreFetch();
  }
});

/**
 * Renders the project dashboard server component to static markup.
 */
async function renderProjectsPage(): Promise<string> {
  return renderToStaticMarkup(await ProjectsPage());
}

/**
 * Replaces global fetch with a project-memory API handler for dashboard tests.
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
 * Builds the lightweight health response used by project dashboard tests.
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
 * Builds a project-list API response with stable capability metadata.
 */
function buildProjectListResponse(projects: ProjectSummary[]): ProjectListResponse {
  return {
    capabilities: buildCapabilities(),
    projects,
    state: projects.length > 0 ? "available" : "empty"
  };
}

/**
 * Builds a representative persisted project summary row.
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
    revisionCount: 2,
    usageCount: 3
  };
}

/**
 * Builds capability metadata that keeps read foundations separate from planned workflows.
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
