/**
 * File header: Tests POST /projects/sync-from-folder on the catalog API.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

test("POST /projects/sync-from-folder is enabled and does not return HTTP 405", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost("/projects/sync-from-folder", {}, handleRequest);

    assert.notEqual(result.statusCode, 405);
    assert.equal(result.headers["X-EE-Operation"], "api-project-folder-sync");
  } finally {
    restoreOptionalEnv("NODE_ENV", previousNodeEnv);
  }
});

test("POST /projects/sync-from-folder/ accepts a trailing slash", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";

  try {
    const { handleRequest } = await import("./index");
    const result = await invokeApiPost("/projects/sync-from-folder/", {}, handleRequest);

    assert.notEqual(result.statusCode, 405);
    assert.equal(result.headers["X-EE-Operation"], "api-project-folder-sync");
  } finally {
    restoreOptionalEnv("NODE_ENV", previousNodeEnv);
  }
});

/**
 * Invokes one POST route against the in-process API handler.
 */
async function invokeApiPost(
  url: string,
  body: unknown,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Promise<{ statusCode: number; body: Record<string, unknown>; headers: Record<string, string> }> {
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
    body: JSON.parse(responseBody) as Record<string, unknown>,
    headers: responseHeaders,
    statusCode
  };
}

/**
 * Restores or clears one optional environment variable after a focused route test.
 */
function restoreOptionalEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previousValue;
  }
}
