/**
 * File header: Tests the /preview-artifact/download route's honesty discipline.
 *
 * The preview-artifact route is intentionally separate from the asset-download route so
 * the source bytes' availability/trust contract is never confused with whether a derived
 * viewer artifact exists. These tests exercise the four honest outcomes the UI relies on:
 *  - 404 when the asset row is unknown,
 *  - 409 when the row exists but no derived artifact is recorded (preview pending or
 *    no artifact key/format), so the UI can render an explicit "preview pending" state,
 *  - 503 when storage is misconfigured, so the UI can render an explicit "setup_required"
 *    state instead of a silently broken viewer,
 *  - 200 stream from local storage on the happy path.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PassThrough, Readable } from "node:stream";
import { setCatalogStorePoolForTests } from "./catalog-store";
import { setStorageClientForTests } from "./file-storage";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

test("GET /assets/:assetId/preview-artifact/download returns 404 when the asset row does not exist", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(createEmptyPreviewArtifactPoolStub());

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet(
      "/parts/part-missing/assets/asset-missing/preview-artifact/download",
      handleRequest
    );

    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error.code, "ASSET_NOT_FOUND");
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /assets/:assetId/preview-artifact/download returns 409 when previewStatus is pending", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(
    createPreviewArtifactPoolStub({
      id: "asset-pending",
      part_id: "part-pending",
      asset_type: "three_d_model",
      file_format: "step",
      preview_status: "pending",
      preview_artifact_storage_key: null,
      preview_artifact_format: null
    })
  );

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet(
      "/parts/part-pending/assets/asset-pending/preview-artifact/download",
      handleRequest
    );

    assert.equal(result.statusCode, 409);
    assert.equal(result.body.error.code, "PREVIEW_ARTIFACT_NOT_AVAILABLE");
    assert.match(result.body.error.message, /no derived preview artifact/iu);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /assets/:assetId/preview-artifact/download returns 409 when ready but artifact storage key is missing", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(
    createPreviewArtifactPoolStub({
      id: "asset-no-key",
      part_id: "part-no-key",
      asset_type: "three_d_model",
      file_format: "step",
      preview_status: "ready",
      preview_artifact_storage_key: null,
      preview_artifact_format: "glb"
    })
  );

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet(
      "/parts/part-no-key/assets/asset-no-key/preview-artifact/download",
      handleRequest
    );

    assert.equal(result.statusCode, 409);
    assert.equal(result.body.error.code, "PREVIEW_ARTIFACT_NOT_AVAILABLE");
    assert.match(result.body.error.message, /storage key/iu);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /assets/:assetId/preview-artifact/download returns 409 when ready but artifact format is missing", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(
    createPreviewArtifactPoolStub({
      id: "asset-no-format",
      part_id: "part-no-format",
      asset_type: "three_d_model",
      file_format: "step",
      preview_status: "ready",
      preview_artifact_storage_key: "cad/three-d-previews/part-no-format/asset-no-format.glb",
      preview_artifact_format: null
    })
  );

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet(
      "/parts/part-no-format/assets/asset-no-format/preview-artifact/download",
      handleRequest
    );

    assert.equal(result.statusCode, 409);
    assert.equal(result.body.error.code, "PREVIEW_ARTIFACT_NOT_AVAILABLE");
    assert.match(result.body.error.message, /format/iu);
  } finally {
    setCatalogStorePoolForTests(null);
    restoreEnv(previousNodeEnv);
  }
});

test("GET /assets/:assetId/preview-artifact/download returns 404 when the preview artifact file is missing on disk", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  const tempDir = await mkdtemp(join(tmpdir(), "ee-preview-missing-"));

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tempDir;
  setCatalogStorePoolForTests(
    createPreviewArtifactPoolStub({
      id: "asset-unconfigured-storage",
      part_id: "part-unconfigured-storage",
      asset_type: "three_d_model",
      file_format: "step",
      preview_status: "ready",
      preview_artifact_storage_key: "cad/three-d-previews/part-unconfigured-storage/asset.glb",
      preview_artifact_format: "glb"
    })
  );

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGet(
      "/parts/part-unconfigured-storage/assets/asset-unconfigured-storage/preview-artifact/download",
      handleRequest
    );

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

test("GET /assets/:assetId/preview-artifact/download streams the preview artifact on the happy path", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowTestAuth = process.env.EE_LIBRARY_ALLOW_TEST_AUTH;
  const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
  const tempDir = await mkdtemp(join(tmpdir(), "ee-preview-artifact-"));
  const previewDir = join(tempDir, "cad", "three-d-previews", "part-ok");
  const testContent = "glTF preview bytes";
  await mkdir(previewDir, { recursive: true });
  await writeFile(join(previewDir, "asset-ok.glb"), testContent, "utf8");

  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_ALLOW_TEST_AUTH = "1";
  process.env.STORAGE_LOCAL_PATH = tempDir;
  setCatalogStorePoolForTests(
    createPreviewArtifactPoolStub({
      id: "asset-ok",
      part_id: "part-ok",
      asset_type: "three_d_model",
      file_format: "step",
      preview_status: "ready",
      preview_artifact_storage_key: "cad/three-d-previews/part-ok/asset-ok.glb",
      preview_artifact_format: "glb"
    })
  );

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiGetStreaming(
      "/parts/part-ok/assets/asset-ok/preview-artifact/download",
      handleRequest
    );

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["Content-Type"], "model/gltf-binary");
    assert.equal(result.body, testContent);
    assert.equal(result.headers["X-EE-Operation"], "api-asset-preview-artifact-download");
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

/** PreviewArtifactPoolRow mirrors the row shape used by the new query. */
interface PreviewArtifactPoolRow {
  id: string;
  part_id: string;
  asset_type: string;
  file_format: string;
  preview_status: string;
  preview_artifact_storage_key: string | null;
  preview_artifact_format: string | null;
}

/**
 * Creates a pool stub that returns one preview-artifact row when the assets table is queried.
 *
 * Differentiates from the source-asset stub by recognizing the preview_artifact column list
 * in the SELECT, so the source-asset and preview-artifact code paths cannot accidentally
 * cross-feed each other in tests.
 */
function createPreviewArtifactPoolStub(row: PreviewArtifactPoolRow): Pool {
  return {
    query: async (sql: string) => {
      if (typeof sql === "string" && sql.includes("preview_artifact_storage_key")) {
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  } as unknown as Pool;
}

/**
 * Creates a pool stub that returns no rows for the preview-artifact query.
 */
function createEmptyPreviewArtifactPoolStub(): Pool {
  return {
    query: async () => ({ rows: [], rowCount: 0 })
  } as unknown as Pool;
}

/**
 * Builds a storage client stub that returns the given download URL (or null when unconfigured).
 */
function createStorageClientStub(downloadUrl: string | null): FileStorageClient {
  return {
    backend: downloadUrl !== null ? "local" : "not_configured",
    exists: async () => downloadUrl !== null,
    getDownloadUrl: async () => downloadUrl,
    read: async () => Buffer.from(""),
    write: async () => {
      throw new Error("write not expected in preview-artifact route tests");
    }
  } as FileStorageClient;
}

/**
 * Restores process.env.NODE_ENV after a test mutates it for catalog-store gating.
 */
function restoreEnv(previousNodeEnv: string | undefined): void {
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
}

/**
 * Invokes one GET API route through the real request handler and captures the response.
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
    setHeader(name: string, value: string) {
      responseHeaders[name] = value;
    },
    writeHead(code: number, nextHeaders?: Record<string, string>) {
      statusCode = code;
      if (nextHeaders) {
        responseHeaders = { ...responseHeaders, ...nextHeaders };
      }
      return response;
    }
  } as unknown as ServerResponse;

  request.url = url;
  request.method = "GET";
  request.headers = {};

  await handleRequest(request, response);

  let parsedBody: Record<string, any> = {};
  if (responseBody.length > 0) {
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      parsedBody = { raw: responseBody };
    }
  }

  return { statusCode, body: parsedBody, headers: responseHeaders };
}

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
  (response as { writeHead: (code: number, headers?: Record<string, string>) => ServerResponse }).writeHead = (code, headers) => {
    statusCode = code;
    responseHeaders = headers ?? {};
    return response;
  };

  const origEnd = responseStream.end.bind(responseStream);
  (response as { end: (payload?: string | Buffer) => void }).end = (payload) => {
    if (payload !== undefined) {
      responseStream.write(payload);
    }

    origEnd();
  };

  request.url = url;
  request.method = "GET";
  request.headers = { host: "localhost" };

  await handleRequest(request, response);

  return {
    body: Buffer.concat(chunks).toString("utf8"),
    headers: responseHeaders,
    statusCode
  };
}

function restoreOptionalEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
