/**
 * File header: Tests admin-only project file root setting routes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import type { IncomingMessage, ServerResponse } from "node:http";

test("GET /admin/project-files-root requires admin auth outside the test-session shortcut", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const settingsRoot = await mkdtemp(path.join(tmpdir(), "ee-project-root-route-"));
  process.env.AUTH_SECRET = "project-root-route-secret-padded-to-thirty-two-bytes";
  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_SITE_SETTINGS_PATH = path.join(settingsRoot, "site-settings.json");

  try {
    const { handleRequest } = await import("./index");
    process.env.NODE_ENV = "production";
    const result = await invokeApiRequest("/admin/project-files-root", "GET", undefined, handleRequest);

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error.code, "UNAUTHORIZED");
  } finally {
    restoreEnv(previousAuthSecret, previousNodeEnv);
    delete process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
    await rm(settingsRoot, { recursive: true, force: true });
  }
});

test("PATCH /admin/project-files-root saves the site setting and returns the effective root", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProjectRoot = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;
  const previousSettingsPath = process.env.EE_LIBRARY_SITE_SETTINGS_PATH;
  const settingsRoot = await mkdtemp(path.join(tmpdir(), "ee-project-root-route-"));
  const selectedRoot = path.join(settingsRoot, "selected-projects");
  process.env.AUTH_SECRET = "project-root-route-secret-padded-to-thirty-two-bytes";
  process.env.NODE_ENV = "test";
  process.env.EE_LIBRARY_PROJECT_FILES_ROOT = path.join(settingsRoot, "env-projects");
  process.env.EE_LIBRARY_SITE_SETTINGS_PATH = path.join(settingsRoot, "site-settings.json");

  try {
    const { handleRequest } = await import("./index");
    process.env.NODE_ENV = "production";
    const headers = { authorization: await createBearerToken(process.env.AUTH_SECRET, "admin") };
    const patch = await invokeApiRequest("/admin/project-files-root", "PATCH", { rootPath: selectedRoot }, handleRequest, headers);
    const read = await invokeApiRequest("/admin/project-files-root", "GET", undefined, handleRequest, headers);
    const settings = JSON.parse(await readFile(process.env.EE_LIBRARY_SITE_SETTINGS_PATH, "utf8")) as Record<string, unknown>;

    assert.equal(patch.statusCode, 200);
    assert.equal(patch.body.data.source, "site_setting");
    assert.equal(patch.body.data.currentRootPath, selectedRoot);
    assert.equal(read.body.data.currentRootPath, selectedRoot);
    assert.equal(settings.projectFilesRoot, selectedRoot);
  } finally {
    restoreEnv(previousAuthSecret, previousNodeEnv);
    restoreOptionalEnv("EE_LIBRARY_PROJECT_FILES_ROOT", previousProjectRoot);
    restoreOptionalEnv("EE_LIBRARY_SITE_SETTINGS_PATH", previousSettingsPath);
    await rm(settingsRoot, { recursive: true, force: true });
  }
});

/**
 * Invokes one real API route with a small JSON or empty request body.
 */
async function invokeApiRequest(
  url: string,
  method: "GET" | "PATCH",
  body: unknown,
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: Record<string, any>; headers: Record<string, string> }> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const request = Readable.from(payload ? [payload] : []) as IncomingMessage;
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
 * Creates a real HS256 bearer token so admin-only route behavior can be tested without shortcuts.
 */
async function createBearerToken(secret: string, role: "admin" | "user"): Promise<string> {
  const jwt = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`test-${role}`)
    .sign(new TextEncoder().encode(secret));

  return `Bearer ${jwt}`;
}

/**
 * Restores auth-related environment variables touched by these route tests.
 */
function restoreEnv(previousAuthSecret: string | undefined, previousNodeEnv: string | undefined): void {
  restoreOptionalEnv("AUTH_SECRET", previousAuthSecret);
  restoreOptionalEnv("NODE_ENV", previousNodeEnv);
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
