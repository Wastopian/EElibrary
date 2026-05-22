/**
 * File header: Tests direct catalog asset uploads from part detail file rows.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { SignJWT } from "jose";
import { newDb } from "pg-mem";
import {
  createManualPartAssetInDatabase,
  readPartAssetUploadTargetFromDatabase,
  setCatalogStorePoolForTests
} from "./catalog-store";
import { setStorageClientForTests } from "./file-storage";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";

/** TestPool is the pg-mem pool shape used by direct asset upload tests. */
type TestPool = Pool & {
  /** Closes the in-memory pool after the test releases it from catalog-store. */
  end: () => Promise<void>;
};

test("POST /parts/:partId/assets/:assetType writes upload bytes and returns a manual asset", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const pool = createPartAssetUploadPool();
  const storage = createMemoryStorageClient();
  const authSecret = "part-asset-upload-secret-padded-to-thirty-two-bytes";
  process.env.AUTH_SECRET = authSecret;
  process.env.NODE_ENV = "test";
  setCatalogStorePoolForTests(pool);
  setStorageClientForTests(storage.client);

  try {
    const { handleRequest } = await import("./index");
    process.env.NODE_ENV = "production";
    const result = await invokeApiRequest(
      "/parts/part-alpha/assets/datasheet",
      "POST",
      {
        contentBase64: Buffer.from("%PDF upload").toString("base64"),
        filename: "../TPS7A02.pdf"
      },
      handleRequest,
      { authorization: await createBearerToken(authSecret, "admin") }
    );

    assert.equal(result.statusCode, 201);
    assert.equal(result.headers["X-EE-Operation"], "api-part-asset-upload");
    assert.equal(result.body.source, "database");
    assert.equal(result.body.data.asset.assetType, "datasheet");
    assert.equal(result.body.data.asset.provenance, "manual_internal");
    assert.equal(result.body.data.asset.reviewStatus, "review_required");
    assert.equal(result.body.data.asset.exportStatus, "not_exportable");
    assert.equal(storage.writes.size, 1);
    assert.equal([...storage.writes.keys()][0]?.startsWith("manual-assets/part-alpha/datasheet/"), true);
  } finally {
    setCatalogStorePoolForTests(null);
    setStorageClientForTests(null);
    await pool.end();
    restoreEnv(previousAuthSecret, previousNodeEnv);
  }
});

test("createManualPartAssetInDatabase records manual uploads as review-required files", async () => {
  const pool = createPartAssetUploadPool();
  setCatalogStorePoolForTests(pool);

  try {
    const target = await readPartAssetUploadTargetFromDatabase("part-alpha");
    assert.deepEqual(target, { status: "available" });

    const result = await createManualPartAssetInDatabase("part-alpha", {
      assetType: "datasheet",
      fileHash: "0123456789abcdef0123456789abcdef",
      filename: "TPS7A02.pdf",
      storageKey: "manual-assets/part-alpha/datasheet/0123456789abcdef-TPS7A02.pdf",
      uploadedAt: "2026-05-22T00:00:00.000Z"
    });

    assert.equal(result.status, "created");
    if (result.status !== "created") return;

    assert.equal(result.asset.assetType, "datasheet");
    assert.equal(result.asset.availabilityStatus, "downloaded");
    assert.equal(result.asset.provenance, "manual_internal");
    assert.equal(result.asset.reviewStatus, "review_required");
    assert.equal(result.asset.exportStatus, "not_exportable");
    assert.equal(result.asset.validationStatus, "not_validated");
    assert.equal(result.asset.previewStatus, "ready");
    assert.equal(result.asset.previewArtifactStorageKey, result.asset.storageKey);
    assert.match(result.boundary, /needs review/u);

    const revision = await pool.query<{ revision_label: string; file_asset_id: string }>(
      "SELECT revision_label, file_asset_id FROM datasheet_revisions WHERE part_id = $1",
      ["part-alpha"]
    );
    assert.equal(revision.rows[0]?.revision_label, "Manual upload (TPS7A02.pdf)");
    assert.equal(revision.rows[0]?.file_asset_id, result.asset.id);
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

test("readPartAssetUploadTargetFromDatabase reports missing parts before file storage writes", async () => {
  const pool = createPartAssetUploadPool();
  setCatalogStorePoolForTests(pool);

  try {
    const target = await readPartAssetUploadTargetFromDatabase("part-missing");
    assert.deepEqual(target, { status: "not_found" });
  } finally {
    setCatalogStorePoolForTests(null);
    await pool.end();
  }
});

/**
 * Invokes one API route with JSON input and collects the JSON response body.
 */
async function invokeApiRequest(
  url: string,
  method: "POST",
  body: unknown,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const payload = JSON.stringify(body);
  const request = Readable.from([payload]) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  let responseHeaders: Record<string, string> = {};
  const response = {
    end(nextPayload: string) {
      responseBody = nextPayload;
    },
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders ?? {};
      return response;
    }
  } as unknown as ServerResponse;

  request.headers = { "content-type": "application/json", host: "localhost", ...headers };
  request.method = method;
  request.url = url;

  await handleRequest(request, response);

  return {
    body: JSON.parse(responseBody) as Record<string, any>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Creates a real HS256 bearer token for admin-only route tests.
 */
async function createBearerToken(secret: string, role: "admin" | "user"): Promise<string> {
  const jwt = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`test-${role}`)
    .sign(new TextEncoder().encode(secret));

  return `Bearer ${jwt}`;
}

/**
 * Creates an in-memory storage client that records upload writes by storage key.
 */
function createMemoryStorageClient(): { client: FileStorageClient; writes: Map<string, Buffer> } {
  const writes = new Map<string, Buffer>();

  return {
    client: {
      backend: "local",
      async exists(storageKey: string) {
        return writes.has(storageKey);
      },
      async getDownloadUrl(storageKey: string) {
        return `http://storage.test/${encodeURIComponent(storageKey)}`;
      },
      async read(storageKey: string) {
        const content = writes.get(storageKey);
        if (!content) {
          throw new Error("Missing storage key.");
        }
        return content;
      },
      async write(storageKey: string, content: Buffer) {
        writes.set(storageKey, Buffer.from(content));
      }
    },
    writes
  };
}

/**
 * Creates the smallest catalog schema needed for direct asset upload persistence.
 */
function createPartAssetUploadPool(): TestPool {
  const db = newDb();
  db.public.none(`
    CREATE TABLE parts (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      part_id TEXT,
      asset_type TEXT,
      file_format TEXT,
      storage_key TEXT,
      file_hash TEXT,
      provider_id TEXT,
      license_mode TEXT,
      provenance TEXT,
      availability_status TEXT,
      review_status TEXT,
      export_status TEXT,
      asset_status TEXT,
      generation_method TEXT,
      generation_source_asset_id TEXT,
      validation_status TEXT,
      preview_status TEXT,
      preview_artifact_storage_key TEXT,
      preview_artifact_format TEXT,
      preview_artifact_generated_at TIMESTAMPTZ,
      preview_artifact_source TEXT,
      asset_state TEXT,
      source_url TEXT,
      source_record_id TEXT,
      last_updated_at TIMESTAMPTZ
    );

    CREATE TABLE datasheet_revisions (
      id TEXT PRIMARY KEY,
      part_id TEXT,
      revision_label TEXT,
      file_asset_id TEXT,
      parse_confidence DOUBLE PRECISION,
      pin_table_status TEXT
    );

    INSERT INTO parts (id) VALUES ('part-alpha');
  `);

  const { Pool: MemoryPool } = db.adapters.createPg();

  return new MemoryPool() as TestPool;
}

/**
 * Restores environment variables touched by route-level upload tests.
 */
function restoreEnv(previousAuthSecret: string | undefined, previousNodeEnv: string | undefined): void {
  if (previousAuthSecret === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = previousAuthSecret;
  }

  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
}
