/**
 * File header: Tests project/BOM memory read contracts and HTTP routes.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { newDb } from "pg-mem";
import {
  createBomImportInDatabase,
  createProjectInDatabase,
  readProjectDetailFromDatabase,
  readProjectsFromDatabase,
  setProjectMemoryStorePoolForTests
} from "./project-memory-store";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by project-memory tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after each test releases it. */
  end: () => Promise<void>;
};

/**
 * Verifies project-memory reads do not pretend to work without configured persistence.
 */
test("readProjectsFromDatabase returns not_configured without a project-memory database", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  setProjectMemoryStorePoolForTests(null);

  try {
    const result = await readProjectsFromDatabase();

    assert.equal(result.status, "not_configured");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    restoreDatabaseUrl(previousDatabaseUrl);
  }
});

/**
 * Verifies a configured but empty project-memory database reports an empty state.
 */
test("readProjectsFromDatabase returns an empty state from configured empty project tables", async () => {
  const pool = createProjectMemoryPool(false);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await readProjectsFromDatabase();

    assert.equal(result.status, "available");
    assert.equal(result.response.state, "empty");
    assert.deepEqual(result.response.projects, []);
    assert.equal(result.response.capabilities.find((capability) => capability.id === "bom_upload")?.state, "foundation");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies persisted BOM rows and confirmed usage stay separate from weak matches.
 */
test("project memory store exposes project detail without promoting weak BOM lines", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await readProjectDetailFromDatabase("project-alpha");

    assert.equal(result.status, "available");
    assert.equal(result.response.project.projectKey, "ALPHA");
    assert.equal(result.response.summary.revisionCount, 1);
    assert.equal(result.response.summary.bomImportCount, 1);
    assert.equal(result.response.summary.usageCount, 1);
    assert.equal(result.response.revisions[0]?.revisionLabel, "A");
    assert.equal(result.response.bomImports[0]?.sourceFilename, "alpha-bom.csv");
    assert.equal(result.response.usages.length, 1);
    assert.equal(result.response.usages[0]?.partId, "part-memory-ldo");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies project creation writes a project and initial revision for site workflows.
 */
test("project memory store creates a project and first revision", async () => {
  const pool = createProjectMemoryPool(false);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await createProjectInDatabase({
      initialRevisionLabel: "Rev A",
      name: "Beta Driver",
      owner: "hardware",
      projectKey: "BETA",
      status: "prototype"
    });

    assert.equal(result.status, "created");
    assert.equal(result.response.project.id, "project-beta");
    assert.equal(result.response.initialRevision.revisionLabel, "Rev A");
    assert.equal(result.response.detail.summary.revisionCount, 1);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies mapped BOM import persistence keeps rows unmatched and preserves raw payloads.
 */
test("project memory store persists mapped CSV BOM lines without creating usage", async () => {
  const pool = createProjectMemoryPool(true);
  setProjectMemoryStorePoolForTests(pool);

  try {
    const result = await createBomImportInDatabase(
      "project-alpha",
      {
        columnMapping: {
          designators: "Refs",
          manufacturer: "Maker",
          mpn: "MPN",
          quantity: "Qty"
        },
        projectRevisionId: "rev-alpha-a",
        rawContent: "Refs,MPN,Maker,Qty\nU2 U3,TPS7A02DBVR,Texas Instruments,2\n\nR5,RC0603FR-0710KL,Yageo,1\n",
        sourceFilename: "alpha-upload.csv",
        sourceFormat: "csv"
      },
      "test-admin"
    );

    assert.equal(result.status, "created");
    assert.equal(result.response.lineCount, 2);
    assert.equal(result.response.summary.skippedBlankRowCount, 1);
    assert.equal(result.response.linesPreview[0]?.matchStatus, "unmatched");
    assert.deepEqual(result.response.linesPreview[0]?.designators, ["U2", "U3"]);
    assert.equal(result.response.linesPreview[0]?.rawRowPayload.MPN, "TPS7A02DBVR");

    const detail = await readProjectDetailFromDatabase("project-alpha");

    assert.equal(detail.status, "available");
    assert.equal(detail.response.summary.bomImportCount, 2);
    assert.equal(detail.response.summary.usageCount, 1);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Verifies project-memory API routes return typed database envelopes and honest planned states.
 */
test("project memory routes return project, BOM line, and usage read contracts", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const pool = createProjectMemoryPool(true);
  process.env.NODE_ENV = "test";
  setProjectMemoryStorePoolForTests(pool);

  try {
    const { handleRequest } = await import("./index");
    const list = await invokeApiGet("/projects", handleRequest);
    const detail = await invokeApiGet("/projects/project-alpha", handleRequest);
    const usages = await invokeApiGet("/projects/project-alpha/usages", handleRequest);
    const lines = await invokeApiGet("/bom-imports/bom-alpha-a/lines", handleRequest);
    const missing = await invokeApiGet("/projects/project-missing", handleRequest);

    assert.equal(list.statusCode, 200);
    assert.equal(list.headers["X-EE-Operation"], "api-project-list");
    assert.equal(list.body.source, "database");
    assert.equal(list.body.data.projects[0]?.project.projectKey, "ALPHA");
    assert.equal(list.body.data.capabilities.find((capability: any) => capability.id === "bom_matching")?.state, "planned");

    assert.equal(detail.statusCode, 200);
    assert.equal(detail.body.data.project.id, "project-alpha");
    assert.equal(detail.body.data.usages.length, 1);

    assert.equal(usages.statusCode, 200);
    assert.equal(usages.body.data.usages[0]?.partId, "part-memory-ldo");

    assert.equal(lines.statusCode, 200);
    assert.equal(lines.body.data.lines.length, 2);
    assert.equal(lines.body.data.lines.find((line: any) => line.id === "line-alpha-2")?.matchStatus, "weak_match");

    assert.equal(missing.statusCode, 404);
    assert.equal(missing.body.error.code, "PROJECT_NOT_FOUND");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
    restoreNodeEnv(previousNodeEnv);
  }
});

/**
 * Verifies project and BOM write routes power the site without running part matching.
 */
test("project memory write routes create projects and persist mapped BOM imports", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const pool = createProjectMemoryPool(false);
  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  setProjectMemoryStorePoolForTests(pool);

  try {
    const { handleRequest } = await import("./index");
    const preview = await invokeApiPost("/bom-imports/preview", {
      rawContent: "Refs,MPN,Maker,Qty\nU1,TPS7A02DBVR,Texas Instruments,1\n",
      sourceFilename: "beta.csv",
      sourceFormat: "csv"
    }, handleRequest);

    assert.equal(preview.statusCode, 200);
    assert.equal(preview.headers["X-EE-Operation"], "api-bom-import-preview");
    assert.equal(preview.body.data.rowCount, 1);

    const emptyAfterPreview = await readProjectsFromDatabase();
    assert.equal(emptyAfterPreview.status, "available");
    assert.equal(emptyAfterPreview.response.projects.length, 0);

    const project = await invokeApiPost("/projects", {
      initialRevisionLabel: "Rev A",
      name: "Beta Driver",
      projectKey: "BETA"
    }, handleRequest);

    assert.equal(project.statusCode, 201);
    assert.equal(project.body.data.project.id, "project-beta");

    const bomImport = await invokeApiPost("/projects/project-beta/bom-imports", {
      columnMapping: {
        designators: "Refs",
        manufacturer: "Maker",
        mpn: "MPN",
        quantity: "Qty"
      },
      projectRevisionId: "rev-project-beta-rev-a",
      rawContent: "Refs,MPN,Maker,Qty\nU1,TPS7A02DBVR,Texas Instruments,1\n",
      sourceFilename: "beta.csv",
      sourceFormat: "csv"
    }, handleRequest);

    assert.equal(bomImport.statusCode, 201);
    assert.equal(bomImport.body.data.lineCount, 1);
    assert.equal(bomImport.body.data.linesPreview[0]?.matchStatus, "unmatched");

    const detail = await invokeApiGet("/projects/project-beta", handleRequest);
    assert.equal(detail.body.data.summary.bomImportCount, 1);
    assert.equal(detail.body.data.summary.usageCount, 0);
  } finally {
    setProjectMemoryStorePoolForTests(null);
    await pool.end();
    restoreTestAuth(previousTestAuth);
    restoreNodeEnv(previousNodeEnv);
  }
});

/**
 * Verifies project-memory routes do not fall back to seed or fake records without a database.
 */
test("project memory routes return DB_NOT_CONFIGURED honestly", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.NODE_ENV = "test";
  delete process.env.DATABASE_URL;
  setProjectMemoryStorePoolForTests(null);

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/projects", handleRequest);

    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.code, "DB_NOT_CONFIGURED");
  } finally {
    setProjectMemoryStorePoolForTests(null);
    restoreDatabaseUrl(previousDatabaseUrl);
    restoreNodeEnv(previousNodeEnv);
  }
});

/**
 * Creates a pg-mem project-memory database with optional fixture rows.
 */
function createProjectMemoryPool(seedRows: boolean): TestPool {
  const db = newDb();

  db.public.none(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE project_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_label TEXT NOT NULL,
      revision_status TEXT NOT NULL DEFAULT 'draft',
      source_reference TEXT,
      released_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE bom_imports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_revision_id TEXT NOT NULL,
      source_filename TEXT NOT NULL,
      source_format TEXT NOT NULL DEFAULT 'csv',
      storage_key TEXT,
      import_status TEXT NOT NULL DEFAULT 'uploaded',
      column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
      import_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE bom_lines (
      id TEXT PRIMARY KEY,
      bom_import_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_revision_id TEXT NOT NULL,
      row_number INTEGER NOT NULL,
      designators TEXT[] NOT NULL DEFAULT '{}',
      quantity NUMERIC,
      raw_mpn TEXT,
      raw_manufacturer TEXT,
      raw_description TEXT,
      raw_supplier_reference TEXT,
      raw_notes TEXT,
      raw_row_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      matched_part_id TEXT,
      match_status TEXT NOT NULL DEFAULT 'unmatched',
      match_confidence_score NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE project_part_usages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_revision_id TEXT NOT NULL,
      bom_line_id TEXT,
      part_id TEXT NOT NULL,
      usage_context TEXT,
      designators TEXT[] NOT NULL DEFAULT '{}',
      quantity NUMERIC,
      usage_status TEXT NOT NULL DEFAULT 'proposed',
      approval_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      readiness_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  if (seedRows) {
    seedProjectMemoryRows(db);
  }

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Seeds one project with two BOM lines but only one confirmed usage record.
 */
function seedProjectMemoryRows(db: ReturnType<typeof newDb>): void {
  db.public.none(`
    INSERT INTO projects (id, project_key, name, description, owner, status, created_at, updated_at)
    VALUES ('project-alpha', 'ALPHA', 'Alpha Controller', 'Memory API test project', 'hardware', 'active', '2026-04-30T00:00:00.000Z', '2026-04-30T00:01:00.000Z');

    INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference, created_at, updated_at)
    VALUES ('rev-alpha-a', 'project-alpha', 'A', 'draft', 'alpha-a', '2026-04-30T00:02:00.000Z', '2026-04-30T00:02:00.000Z');

    INSERT INTO bom_imports (id, project_id, project_revision_id, source_filename, source_format, import_status, column_mapping, import_summary, imported_by, created_at, updated_at)
    VALUES ('bom-alpha-a', 'project-alpha', 'rev-alpha-a', 'alpha-bom.csv', 'csv', 'mapped', '{"mpn":"MPN","quantity":"Qty"}'::jsonb, '{"rowCount":2}'::jsonb, 'api-test', '2026-04-30T00:03:00.000Z', '2026-04-30T00:03:00.000Z');

    INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at)
    VALUES
      ('line-alpha-1', 'bom-alpha-a', 'project-alpha', 'rev-alpha-a', 1, '{"U1"}', 1, 'TPS7A02DBVR', 'Texas Instruments', 'LDO regulator', '{"row":1}'::jsonb, 'part-memory-ldo', 'matched', 1, '2026-04-30T00:04:00.000Z', '2026-04-30T00:04:00.000Z'),
      ('line-alpha-2', 'bom-alpha-a', 'project-alpha', 'rev-alpha-a', 2, '{"R1"}', 1, 'RC-UNKNOWN', 'Unknown', 'Weak resistor row', '{"row":2}'::jsonb, NULL, 'weak_match', 0.4, '2026-04-30T00:05:00.000Z', '2026-04-30T00:05:00.000Z');

    INSERT INTO project_part_usages (id, project_id, project_revision_id, bom_line_id, part_id, usage_context, designators, quantity, usage_status, approval_snapshot, readiness_snapshot, created_at, updated_at)
    VALUES ('usage-alpha-u1', 'project-alpha', 'rev-alpha-a', 'line-alpha-1', 'part-memory-ldo', 'Main rail regulator', '{"U1"}', 1, 'proposed', '{"approvalStatus":"not_requested"}'::jsonb, '{"readinessStatus":"blocked"}'::jsonb, '2026-04-30T00:06:00.000Z', '2026-04-30T00:06:00.000Z');
  `);
}

/**
 * Invokes the API handler with a tiny in-memory GET request/response pair.
 */
async function invokeApiGet(
  url: string,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const request = Readable.from([]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let responseHeaders: Record<string, string> = {};
  const response = {
    end(payload: string) {
      responseBody = payload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = { host: "localhost" };
  request.method = "GET";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Invokes the API handler with a tiny in-memory POST request/response pair.
 */
async function invokeApiPost(
  url: string,
  body: unknown,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const requestBody = JSON.stringify(body);
  const request = Readable.from([requestBody]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let responseHeaders: Record<string, string> = {};
  const response = {
    end(payload: string) {
      responseBody = payload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = {
    "content-type": "application/json",
    host: "localhost"
  };
  request.method = "POST";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Restores NODE_ENV after route tests mutate it.
 */
function restoreNodeEnv(previousNodeEnv: string | undefined): void {
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
}

/**
 * Restores the explicit test auth opt-in after write route tests.
 */
function restoreTestAuth(previousTestAuth: string | undefined): void {
  if (previousTestAuth === undefined) {
    delete process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  } else {
    process.env.EE_LIBRARY_ALLOW_TEST_AUTH = previousTestAuth;
  }
}

/**
 * Restores DATABASE_URL after not-configured tests mutate it.
 */
function restoreDatabaseUrl(previousDatabaseUrl: string | undefined): void {
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
}
