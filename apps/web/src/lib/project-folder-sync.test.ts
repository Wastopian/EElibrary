/**
 * File header: Tests server-side project folder sync uses the web proxy route.
 */

import assert from "node:assert/strict";
import test from "node:test";

test("syncProjectsFromFolderThroughWebProxy posts to the same-origin API proxy", async () => {
  const previousFetch = globalThis.fetch;
  const previousNextAuthUrl = process.env["NEXTAUTH_URL"];
  const previousNodeEnv = process.env.NODE_ENV;
  const requestedUrls: string[] = [];

  process.env["NEXTAUTH_URL"] = "http://localhost:3333";
  process.env.NODE_ENV = "test";

  globalThis.fetch = async (input, init) => {
    requestedUrls.push(String(input));
    assert.equal(init?.method, "POST");
    assert.equal(init?.headers && (init.headers as Record<string, string>)["Content-Type"], "application/json");

    return new Response(
      JSON.stringify({
        data: {
          availability: "configured",
          createdCount: 1,
          entries: [{ outcome: "created", projectKey: "trialProject1" }],
          folderEnsuredCount: 0,
          linkedCount: 0,
          root: "/tmp/projects",
          skippedCount: 0
        },
        source: "database"
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    );
  };

  try {
    const { syncProjectsFromFolderThroughWebProxy } = await import("./project-folder-sync");
    const result = await syncProjectsFromFolderThroughWebProxy();

    assert.equal(requestedUrls[0], "http://localhost:3333/api/projects/sync-from-folder");
    assert.equal(result.createdCount, 1);
    assert.equal(result.entries[0]?.projectKey, "trialProject1");
  } finally {
    globalThis.fetch = previousFetch;
    restoreOptionalEnv("NEXTAUTH_URL", previousNextAuthUrl);
    restoreOptionalEnv("NODE_ENV", previousNodeEnv);
  }
});

test("syncProjectsFromFolderThroughWebProxy surfaces HTTP 405 from the proxy as an API error", async () => {
  const previousFetch = globalThis.fetch;
  const previousNextAuthUrl = process.env["NEXTAUTH_URL"];
  const previousNodeEnv = process.env.NODE_ENV;

  process.env["NEXTAUTH_URL"] = "http://localhost:3333";
  process.env.NODE_ENV = "test";

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "This POST route is not enabled on the catalog API."
        }
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 405
      }
    );

  try {
    const { syncProjectsFromFolderThroughWebProxy } = await import("./project-folder-sync");
    const { ApiClientError } = await import("./api-client");

    await assert.rejects(
      () => syncProjectsFromFolderThroughWebProxy(),
      (error: unknown) => {
        assert.ok(error instanceof ApiClientError);
        assert.equal(error.statusCode, 405);
        assert.equal(error.code, "METHOD_NOT_ALLOWED");
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreOptionalEnv("NEXTAUTH_URL", previousNextAuthUrl);
    restoreOptionalEnv("NODE_ENV", previousNodeEnv);
  }
});

/**
 * Restores or clears one optional environment variable after a focused unit test.
 */
function restoreOptionalEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previousValue;
  }
}
