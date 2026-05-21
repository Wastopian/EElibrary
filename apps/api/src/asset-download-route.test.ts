/**
 * File header: Tests asset download redirect behavior for referenced, file-backed, inaccessible, and unconfigured states.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Readable, PassThrough } from "node:stream";
import { setCatalogStorePoolForTests } from "./catalog-store";
import { setStorageClientForTests } from "./file-storage";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

test("GET /parts/:partId/assets/:assetId/download redirects to source_url for a referenced asset", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-a",
    part_id: "part-a",
    asset_type: "datasheet",
    file_format: "pdf",
    availability_status: "referenced",
    source_url: "https://example.com/datasheet.pdf",
    storage_key: null
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/parts/part-a/assets/asset-a/download", handleRequest);

    assert.equal(result.statusCode, 302);
    assert.equal(result.headers["Location"], "https://example.com/datasheet.pdf");
    assert.equal(result.headers["X-EE-Operation"], "api-asset-download");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /parts/:partId/assets/:assetId/download prefers stored files over external source_url", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  const tempDir = await mkdtemp(join(tmpdir(), "ee-asset-download-prefer-"));
  const testContent = "KiCad footprint bytes";
  await mkdir(join(tempDir, "cad"), { recursive: true });
  await writeFile(join(tempDir, "cad", "part-b.kicad_mod"), testContent, "utf8");

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tempDir;
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-b",
    part_id: "part-b",
    asset_type: "footprint",
    file_format: "kicad",
    availability_status: "downloaded",
    source_url: "https://example.com/footprint.kicad_mod",
    storage_key: "cad/part-b.kicad_mod"
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGetStreaming("/parts/part-b/assets/asset-b/download", handleRequest);

    assert.equal(result.statusCode, 200);
    assert.equal(result.body, testContent);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    if (previousStoragePath === undefined) {
      delete process.env.STORAGE_LOCAL_PATH;
    } else {
      process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    }
    restoreEnv(previousNodeEnv);
    await rm(tempDir, { recursive: true });
  }
});

test("GET /parts/:partId/assets/:assetId/download returns 404 for file:// mirror references without storage", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-mirror",
    part_id: "part-mirror",
    asset_type: "three_d_model",
    file_format: "step",
    availability_status: "downloaded",
    source_url: "file:///C:/projects/trialproject1/models/part.stp",
    storage_key: null
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/parts/part-mirror/assets/asset-mirror/download", handleRequest);

    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error.code, "ASSET_NOT_ACCESSIBLE");
    assert.match(result.body.error.message, /local project folder path only/i);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /parts/:partId/assets/:assetId/download returns 404 when the stored file is missing on disk", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  const tempDir = await mkdtemp(join(tmpdir(), "ee-asset-download-missing-"));

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tempDir;
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-c",
    part_id: "part-c",
    asset_type: "symbol",
    file_format: "kicad",
    availability_status: "validated",
    source_url: null,
    storage_key: "cad/part-c.kicad_sym"
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/parts/part-c/assets/asset-c/download", handleRequest);

    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error.code, "FILE_NOT_FOUND");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    if (previousStoragePath === undefined) {
      delete process.env.STORAGE_LOCAL_PATH;
    } else {
      process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    }
    restoreEnv(previousNodeEnv);
    await rm(tempDir, { recursive: true });
  }
});

test("GET /parts/:partId/assets/:assetId/download returns 404 for a missing asset", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-d",
    part_id: "part-d",
    asset_type: "datasheet",
    file_format: "pdf",
    availability_status: "missing",
    source_url: null,
    storage_key: null
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/parts/part-d/assets/asset-d/download", handleRequest);

    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error.code, "ASSET_NOT_ACCESSIBLE");
    assert.match(result.body.error.message, /no file or URL/u);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /parts/:partId/assets/:assetId/download returns 404 for a failed asset", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-e",
    part_id: "part-e",
    asset_type: "datasheet",
    file_format: "pdf",
    availability_status: "failed",
    source_url: null,
    storage_key: null
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/parts/part-e/assets/asset-e/download", handleRequest);

    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error.code, "ASSET_NOT_ACCESSIBLE");
    assert.match(result.body.error.message, /failed/u);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /parts/:partId/assets/:assetId/download returns 404 when asset not found", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createEmptyPoolStub());

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/parts/part-x/assets/asset-x/download", handleRequest);

    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error.code, "ASSET_NOT_FOUND");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /parts/:partId/assets/:assetId/download returns 404 when assetId belongs to a different part", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createEmptyPoolStub());

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/parts/wrong-part/assets/asset-a/download", handleRequest);

    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error.code, "ASSET_NOT_FOUND");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /parts/:partId/assets/:assetId/download returns 503 when database is not configured", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.NODE_ENV = "test";
  delete process.env.DATABASE_URL;
  setCatalogStorePoolForTests(null);

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/parts/part-a/assets/asset-a/download", handleRequest);

    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.code, "DB_NOT_CONFIGURED");
  } finally {
    setCatalogStorePoolForTests(null);
    if (previousDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    restoreEnv(previousNodeEnv);
  }
});

test("GET /parts/:partId/assets/:assetId/download streams cbj3157-pdf inline without a file extension", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  const tempDir = await mkdtemp(join(tmpdir(), "ee-asset-download-pdf-stem-"));
  const testContent = "%PDF-1.4 cbj3157 inline test";
  await mkdir(join(tempDir, "cad"), { recursive: true });
  await writeFile(join(tempDir, "cad", "cbj3157-pdf"), testContent, "utf8");

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tempDir;
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-pdf-stem",
    part_id: "part-pdf-stem",
    asset_type: "datasheet",
    file_format: "pdf",
    availability_status: "validated",
    source_url: null,
    storage_key: "cad/cbj3157-pdf"
  }));

  try {
    const { handleRequest } = await import("./index");
    const open = await invokeApiGetStreaming("/parts/part-pdf-stem/assets/asset-pdf-stem/download", handleRequest);
    const download = await invokeApiGetStreaming("/parts/part-pdf-stem/assets/asset-pdf-stem/download?attachment=1", handleRequest);

    assert.equal(open.statusCode, 200);
    assert.equal(open.headers["Content-Type"], "application/pdf");
    assert.match(open.headers["Content-Disposition"] ?? "", /inline/u);
    assert.equal(download.headers["Content-Disposition"] ?? "", 'attachment; filename="cbj3157-pdf"');
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    if (previousStoragePath === undefined) {
      delete process.env.STORAGE_LOCAL_PATH;
    } else {
      process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    }
    restoreEnv(previousNodeEnv);
    await rm(tempDir, { recursive: true });
  }
});

test("GET /parts/:partId/assets/:assetId/download streams a file_only asset from local storage", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  const tempDir = await mkdtemp(join(tmpdir(), "ee-asset-download-"));
  const testContent = "%PDF-1.4 asset download stream test";
  await mkdir(join(tempDir, "cad"), { recursive: true });
  await writeFile(join(tempDir, "cad", "part-local.pdf"), testContent, "utf8");

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tempDir;
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-local",
    part_id: "part-local",
    asset_type: "datasheet",
    file_format: "pdf",
    availability_status: "validated",
    source_url: null,
    storage_key: "cad/part-local.pdf"
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGetStreaming("/parts/part-local/assets/asset-local/download", handleRequest);

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["Content-Type"], "application/pdf");
    assert.match(result.headers["Content-Disposition"] ?? "", /inline/u);
    assert.equal(result.body, testContent);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    if (previousStoragePath === undefined) {
      delete process.env.STORAGE_LOCAL_PATH;
    } else {
      process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    }
    restoreEnv(previousNodeEnv);
    await rm(tempDir, { recursive: true });
  }
});

test("GET /api/parts/:partId/assets/:assetId/download resolves the same route as /parts", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-a",
    part_id: "part-a",
    asset_type: "datasheet",
    file_format: "pdf",
    availability_status: "referenced",
    source_url: "https://example.com/datasheet.pdf",
    storage_key: null
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/api/parts/part-a/assets/asset-a/download", handleRequest);

    assert.equal(result.statusCode, 302);
    assert.equal(result.headers["Location"], "https://example.com/datasheet.pdf");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /parts/:partId/assets/:assetId/download returns 404 when storage_key points at a missing local file", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  const tempDir = await mkdtemp(join(tmpdir(), "ee-asset-download-missing-key-"));

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tempDir;
  setCatalogStorePoolForTests(createAssetPoolStub({
    id: "asset-unconfigured",
    part_id: "part-unconfigured",
    asset_type: "footprint",
    file_format: "kicad",
    availability_status: "downloaded",
    source_url: null,
    storage_key: "cad/part.kicad_mod"
  }));

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/parts/part-unconfigured/assets/asset-unconfigured/download", handleRequest);

    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error.code, "FILE_NOT_FOUND");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    if (previousStoragePath === undefined) {
      delete process.env.STORAGE_LOCAL_PATH;
    } else {
      process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    }
    restoreEnv(previousNodeEnv);
    await rm(tempDir, { recursive: true });
  }
});

test("GET /storage/:encodedKey returns 400 for a path traversal key", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  setCatalogStorePoolForTests(createEmptyPoolStub());

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/storage/..%2F..%2Fetc%2Fpasswd", handleRequest);

    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error.code, "INVALID_STORAGE_KEY");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /storage/:encodedKey returns 401 when auth is missing", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  process.env.NODE_ENV = "test";
  delete process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  setCatalogStorePoolForTests(createEmptyPoolStub());

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/storage/test-part.step", handleRequest);

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error.code, "UNAUTHORIZED");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /storage/:encodedKey returns 404 when the file does not exist in local storage", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tmpdir();
  setCatalogStorePoolForTests(createEmptyPoolStub());

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet("/storage/nonexistent-file-ee-test-12345.pdf", handleRequest);

    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error.code, "FILE_NOT_FOUND");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    if (previousStoragePath === undefined) {
      delete process.env.STORAGE_LOCAL_PATH;
    } else {
      process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    }
    restoreEnv(previousNodeEnv);
  }
});

test("GET /storage/:encodedKey streams a real file with correct headers", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  const tempDir = await mkdtemp(join(tmpdir(), "ee-serve-test-"));
  const testContent = "STEP file content for EE storage test";
  await writeFile(join(tempDir, "test-part.step"), testContent, "utf8");

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tempDir;
  setCatalogStorePoolForTests(createEmptyPoolStub());

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGetStreaming("/storage/test-part.step", handleRequest);

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["Content-Type"], "application/octet-stream");
    assert.match(result.headers["Content-Disposition"] ?? "", /attachment/u);
    assert.equal(result.body, testContent);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    if (previousStoragePath === undefined) {
      delete process.env.STORAGE_LOCAL_PATH;
    } else {
      process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    }
    restoreEnv(previousNodeEnv);
    await rm(tempDir, { recursive: true });
  }
});

test("GET /storage/:encodedKey serves a PDF with inline Content-Disposition", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  const tempDir = await mkdtemp(join(tmpdir(), "ee-serve-pdf-test-"));
  const pdfContent = "%PDF-1.4 test content";
  await writeFile(join(tempDir, "datasheet.pdf"), pdfContent, "utf8");

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tempDir;
  setCatalogStorePoolForTests(createEmptyPoolStub());

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGetStreaming("/storage/datasheet.pdf", handleRequest);

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["Content-Type"], "application/pdf");
    assert.match(result.headers["Content-Disposition"] ?? "", /inline/u);
    assert.equal(result.body, pdfContent);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreOptionalEnv("EE_LIBRARY_ALLOW_TEST_AUTH", previousAllowTestAuth);
    if (previousStoragePath === undefined) {
      delete process.env.STORAGE_LOCAL_PATH;
    } else {
      process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    }
    restoreEnv(previousNodeEnv);
    await rm(tempDir, { recursive: true });
  }
});

/** AssetPoolRow is the minimal shape returned by the asset download query stub. */
interface AssetPoolRow {
  id: string;
  part_id: string;
  asset_type: string;
  file_format: string;
  availability_status: string;
  source_url: string | null;
  storage_key: string | null;
}

/**
 * Creates a pool stub that returns one asset row when the assets table is queried.
 */
function createAssetPoolStub(row: AssetPoolRow): Pool {
  return {
    query: async (sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM assets")) {
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  } as unknown as Pool;
}

/**
 * Creates a pool stub that returns no rows for all queries.
 */
function createEmptyPoolStub(): Pool {
  return {
    query: async () => ({ rows: [], rowCount: 0 })
  } as unknown as Pool;
}

/**
 * Invokes one GET API route through the real request handler.
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
    end(nextPayload?: string) {
      responseBody = nextPayload ?? "";
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
    body: responseBody ? (JSON.parse(responseBody) as Record<string, any>) : {},
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Creates a FileStorageClient stub that returns the given download URL (or null).
 */
function createStorageClientStub(downloadUrl: string | null): FileStorageClient {
  return {
    backend: downloadUrl !== null ? "local" : "not_configured",
    exists: async () => downloadUrl !== null,
    getDownloadUrl: async () => downloadUrl,
    read: async () => Buffer.from(""),
    write: async () => { throw new Error("write not expected in download route tests"); }
  } as FileStorageClient;
}

/**
 * Invokes one GET API route and collects a streamed response body.
 * Works for both streaming routes (createReadStream.pipe) and non-streaming routes.
 * Requires handleRequest to fully await stream completion before returning.
 */
async function invokeApiGetStreaming(
  url: string,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ statusCode: number; body: string; headers: Record<string, string> }> {
  const request = Readable.from([]) as IncomingMessage;
  const chunks: Buffer[] = [];
  let statusCode = 0;
  let responseHeaders: Record<string, string> = {};

  const responseStream = new PassThrough();
  responseStream.on("data", (chunk: Buffer) => { chunks.push(chunk); });

  const response = responseStream as unknown as ServerResponse;
  (response as any).writeHead = (code: number, headers?: Record<string, string>) => {
    statusCode = code;
    responseHeaders = headers ?? {};
    return response;
  };

  const origEnd = responseStream.end.bind(responseStream);
  (response as any).end = (payload?: string | Buffer) => {
    if (payload !== undefined) {
      responseStream.write(payload);
    }
    origEnd();
  };

  request.headers = { host: "localhost" };
  request.method = "GET";
  request.url = url;

  await handleRequest(request, response);

  return {
    body: Buffer.concat(chunks).toString("utf8"),
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Restores the NODE_ENV environment variable after a test.
 */
function restoreEnv(previousNodeEnv: string | undefined): void {
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
}

function restoreOptionalEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
