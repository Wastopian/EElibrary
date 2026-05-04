#!/usr/bin/env node
/**
 * File header: Smoke test for a running local stack. Probes the API service via the same base
 * URL the web app uses, validates required endpoints, and prints a structured pass/fail summary
 * so a fresh checkout can confirm the homepage will work BEFORE the user opens it.
 *
 * Exits 0 on all-pass, 1 on any failure. Designed to be run after `npm run setup:dev` and
 * `npm run dev` (or against a remote env where DATABASE_URL/API base url match).
 */

import { validateLocalEnv } from "./lib/env-validate.mjs";

const apiBaseUrl = (process.env.EE_LIBRARY_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/u, "");
const checks = [];

function check(name, status, detail) {
  checks.push({ detail, name, status });
}

async function safeFetch(path, init) {
  const url = `${apiBaseUrl}${path}`;
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    let body = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    } else {
      body = await response.text().catch(() => null);
    }
    return { body, ok: response.ok, status: response.status, url };
  } catch (error) {
    return { body: null, error: error instanceof Error ? error.message : String(error), ok: false, status: 0, url };
  }
}

async function main() {
  console.log(`smoke:local: probing ${apiBaseUrl}`);

  // Step 0: env sanity. Surface issues as warnings; --warn-only wrapper still ran us.
  const envIssues = validateLocalEnv(process.env);
  if (envIssues.length === 0) {
    check("env vars", "pass", "DATABASE_URL, AUTH_SECRET, EE_LIBRARY_API_BASE_URL all set");
  } else {
    for (const issue of envIssues) {
      check(`env: ${issue.key}`, "fail", issue.message);
    }
  }

  // Check /health
  const healthResponse = await safeFetch("/health");
  if (!healthResponse.ok) {
    check("GET /health", "fail", healthResponse.error ? `network error: ${healthResponse.error}` : `HTTP ${healthResponse.status}`);
  } else if (healthResponse.body && typeof healthResponse.body === "object" && healthResponse.body.status === "ok") {
    check("GET /health", "pass", `status=ok, database=${healthResponse.body.dependencies?.database}`);
  } else {
    check("GET /health", "fail", `unexpected payload: ${JSON.stringify(healthResponse.body)}`);
  }

  // Check /system/health and inspect database / worker / object storage
  const systemResponse = await safeFetch("/system/health");
  let systemHealth = null;
  if (!systemResponse.ok) {
    check("GET /system/health", "fail", systemResponse.error ? `network error: ${systemResponse.error}` : `HTTP ${systemResponse.status}`);
  } else if (systemResponse.body && typeof systemResponse.body === "object") {
    systemHealth = systemResponse.body;
    check("GET /system/health", "pass", `database=${systemHealth.database?.status} worker=${systemHealth.worker?.status} objectStorage=${systemHealth.objectStorage?.status}`);

    if (systemHealth.database?.status === "connected") {
      check("database", "pass", "Postgres is reachable from the API");
    } else if (systemHealth.database?.status === "not_configured") {
      check("database", "fail", "DATABASE_URL is unset on the API process; the API will only serve seed-fallback data");
    } else {
      check("database", "fail", "Postgres is configured but not reachable; check Docker and `npm run db:status`");
    }

    if (systemHealth.objectStorage?.status === "connected") {
      check("object storage", "pass", "OBJECT_STORAGE_ENDPOINT is configured");
    } else {
      check("object storage", "warn", "object storage is not configured; CAD/datasheet downloads will be referenced-only");
    }

    if (systemHealth.worker?.status === "online") {
      check("worker heartbeat", "pass", `last seen ${systemHealth.worker.lastSeenAt}`);
    } else if (systemHealth.worker?.lastSeenAt) {
      check("worker heartbeat", "warn", `worker offline; last heartbeat at ${systemHealth.worker.lastSeenAt}. Run \`npm run dev:worker\``);
    } else {
      check("worker heartbeat", "warn", "worker has never emitted a heartbeat. Run `npm run dev:worker`");
    }
  } else {
    check("GET /system/health", "fail", `unexpected payload: ${JSON.stringify(systemResponse.body)}`);
  }

  // Check /parts search returns an array
  const searchResponse = await safeFetch("/parts?q=TPS7A02");
  if (!searchResponse.ok) {
    check("GET /parts?q=TPS7A02", "fail", searchResponse.error ?? `HTTP ${searchResponse.status}`);
  } else if (searchResponse.body && Array.isArray(searchResponse.body.data)) {
    check("GET /parts?q=TPS7A02", "pass", `${searchResponse.body.data.length} results, source=${searchResponse.body.source}`);
  } else {
    check("GET /parts?q=TPS7A02", "fail", `unexpected payload: ${JSON.stringify(searchResponse.body)}`);
  }

  // Check that the parent's provider-lookup endpoint exists and rejects empty bodies cleanly.
  // We don't exercise a real exact-match flow here because that path requires a configured
  // provider adapter and an admin-bearer token; this is a route-existence smoke check.
  const providerLookupResponse = await safeFetch("/provider-lookups", {
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  if (providerLookupResponse.status >= 400 && providerLookupResponse.status < 500) {
    check("POST /provider-lookups (route exists)", "pass", `route exists; rejected empty body with HTTP ${providerLookupResponse.status}`);
  } else if (providerLookupResponse.status === 0) {
    check("POST /provider-lookups (route exists)", "fail", providerLookupResponse.error ?? "network error");
  } else {
    check("POST /provider-lookups (route exists)", "warn", `expected 4xx for empty body, got HTTP ${providerLookupResponse.status}`);
  }

  // Check at least one demo part detail endpoint
  const demoPartId = "part-tps7a02dbvr";
  const detailResponse = await safeFetch(`/parts/${encodeURIComponent(demoPartId)}`);
  if (!detailResponse.ok) {
    check(`GET /parts/${demoPartId}`, "fail", detailResponse.error ?? `HTTP ${detailResponse.status}`);
  } else if (detailResponse.body?.data?.part?.id === demoPartId) {
    check(`GET /parts/${demoPartId}`, "pass", `mpn=${detailResponse.body.data.part.mpn} source=${detailResponse.body.source}`);
  } else {
    check(`GET /parts/${demoPartId}`, "fail", `unexpected payload: ${JSON.stringify(detailResponse.body)}`);
  }

  printSummary();
}

function printSummary() {
  const failed = checks.filter((entry) => entry.status === "fail");
  const warned = checks.filter((entry) => entry.status === "warn");
  const passed = checks.filter((entry) => entry.status === "pass");

  console.log("");
  console.log(`smoke:local results: ${passed.length} pass, ${warned.length} warn, ${failed.length} fail`);
  console.log("-".repeat(60));
  for (const entry of checks) {
    const symbol = entry.status === "pass" ? "PASS" : entry.status === "warn" ? "WARN" : "FAIL";
    console.log(`  ${symbol} ${entry.name}: ${entry.detail}`);
  }
  console.log("");

  if (failed.length === 0) {
    console.log("smoke:local: PASSED");
    process.exitCode = 0;
  } else {
    console.log("smoke:local: FAILED");
    console.log("Most likely fix: `npm run setup:dev` then `npm run dev` in another terminal, then re-run smoke.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("smoke:local crashed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
