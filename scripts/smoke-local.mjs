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
import { DEMO_CABLE_ASSEMBLY_ID, DEMO_PROJECT_ID, DEMO_PROJECT_KEY } from "./seed-demo-project.mjs";

const apiBaseUrl = (process.env.EE_LIBRARY_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/u, "");
const webBaseUrl = (process.env.EE_LIBRARY_WEB_BASE_URL ?? `http://127.0.0.1:${process.env.WEB_PORT ?? "3000"}`).replace(/\/$/u, "");
const requireWebWorkspace = (process.env.EE_SMOKE_REQUIRE_WEB ?? "").trim() === "1";
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

function classifyWebCheckStatus(ok) {
  if (ok) {
    return "pass";
  }
  return requireWebWorkspace ? "fail" : "warn";
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
  } else if (detailResponse.body?.data?.record?.part?.id === demoPartId) {
    check(`GET /parts/${demoPartId}`, "pass", `mpn=${detailResponse.body.data.record.part.mpn} source=${detailResponse.body.source}`);
  } else {
    check(`GET /parts/${demoPartId}`, "fail", `unexpected payload: ${JSON.stringify(detailResponse.body)}`);
  }

  const demoProjectId = DEMO_PROJECT_ID;
  const demoProjectResponse = await safeFetch(`/projects/${encodeURIComponent(demoProjectId)}`);
  if (!demoProjectResponse.ok) {
    check(
      `GET /projects/${demoProjectId}`,
      "fail",
      demoProjectResponse.error ?? `HTTP ${demoProjectResponse.status}; run npm run seed:demo-project after ingest:local`
    );
  } else if (
    demoProjectResponse.body?.data?.project?.id === demoProjectId &&
    demoProjectResponse.body?.data?.project?.projectKey === DEMO_PROJECT_KEY
  ) {
    check(
      `GET /projects/${demoProjectId}`,
      "pass",
      `demo BOM project available (source=${demoProjectResponse.body.source})`
    );
  } else {
    check(`GET /projects/${demoProjectId}`, "fail", `unexpected payload: ${JSON.stringify(demoProjectResponse.body)}`);
  }

  const demoBomHealthResponse = await safeFetch(`/projects/${encodeURIComponent(demoProjectId)}/bom-health`);
  if (!demoBomHealthResponse.ok) {
    check(`GET /projects/${demoProjectId}/bom-health`, "fail", demoBomHealthResponse.error ?? `HTTP ${demoBomHealthResponse.status}`);
  } else if (demoBomHealthResponse.body?.data?.projectId === demoProjectId && demoBomHealthResponse.body?.data?.summary?.totalLineCount > 0) {
    check(
      `GET /projects/${demoProjectId}/bom-health`,
      "pass",
      `${demoBomHealthResponse.body.data.summary.totalLineCount} seeded BOM rows checked`
    );
  } else {
    check(`GET /projects/${demoProjectId}/bom-health`, "fail", `unexpected payload: ${JSON.stringify(demoBomHealthResponse.body)}`);
  }

  const demoWhereUsedResponse = await safeFetch("/where-used?targetType=part&q=part-tps7a02dbvr");
  if (!demoWhereUsedResponse.ok) {
    check("GET /where-used demo part", "fail", demoWhereUsedResponse.error ?? `HTTP ${demoWhereUsedResponse.status}`);
  } else if (demoWhereUsedResponse.body?.data?.state === "available" && demoWhereUsedResponse.body?.data?.projectUsages?.length > 0) {
    check("GET /where-used demo part", "pass", `${demoWhereUsedResponse.body.data.projectUsages.length} usage rows found`);
  } else {
    check("GET /where-used demo part", "fail", `unexpected payload: ${JSON.stringify(demoWhereUsedResponse.body)}`);
  }

  const demoProjectFilesResponse = await safeFetch(`/projects/${encodeURIComponent(demoProjectId)}/files`);
  if (!demoProjectFilesResponse.ok) {
    check("GET /projects demo files", "fail", demoProjectFilesResponse.error ?? `HTTP ${demoProjectFilesResponse.status}`);
  } else if (
    demoProjectFilesResponse.body?.data?.availability === "configured" &&
    demoProjectFilesResponse.body?.data?.documentMap?.summary?.documentCount > 0 &&
    demoProjectFilesResponse.body?.data?.documentMap?.summary?.folderPatternCount > 0 &&
    demoProjectFilesResponse.body?.data?.documentMap?.summary?.moveSuggestionCount > 0 &&
    demoProjectFilesResponse.body?.data?.documentMap?.summary?.pinMentionCount > 0 &&
    demoProjectFilesResponse.body?.data?.documentMap?.documents?.some(
      (entry) =>
        entry.signals?.connectorRefs?.includes("J202") &&
        entry.signals?.pinRefs?.includes("47") &&
        entry.sortPlan?.action === "move_to_standard_folder"
    ) &&
    demoProjectFilesResponse.body?.data?.documentMap?.folderPatterns?.some(
      (pattern) =>
        pattern.folderPath === "Bob-drop/old-tests" &&
        pattern.dominantDocumentType === "test_procedure" &&
        pattern.suggestedAction === "use_file_copy_buttons"
    )
  ) {
    check(
      "GET /projects demo files",
      "pass",
      `${demoProjectFilesResponse.body.data.documentMap.summary.documentCount} mapped project files found`
    );
  } else {
    check("GET /projects demo files", "fail", `unexpected payload: ${JSON.stringify(demoProjectFilesResponse.body)}`);
  }

  const documentWhereUsedResponse = await safeFetch("/where-used?targetType=document&q=Which%20test%20procedure%20uses%20connector%20J202%3F");
  if (!documentWhereUsedResponse.ok) {
    check("GET /where-used demo documents", "fail", documentWhereUsedResponse.error ?? `HTTP ${documentWhereUsedResponse.status}`);
  } else if (
    documentWhereUsedResponse.body?.data?.state === "available" &&
    documentWhereUsedResponse.body?.data?.documentHits?.some(
      (hit) =>
        hit.project?.id === demoProjectId &&
        hit.document?.filename === "J202-test-procedure-rev-d.md" &&
        hit.matchedLabels?.includes("Connector: J202") &&
        hit.matchedLabels?.includes("Type: Test procedure")
    )
  ) {
    check(
      "GET /where-used demo documents",
      "pass",
      `${documentWhereUsedResponse.body.data.documentHits.length} document clue hits found`
    );
  } else {
    check("GET /where-used demo documents", "fail", `unexpected payload: ${JSON.stringify(documentWhereUsedResponse.body)}`);
  }

  const interconnectResponse = await safeFetch("/interconnects");
  if (!interconnectResponse.ok) {
    check("GET /interconnects", "fail", interconnectResponse.error ?? `HTTP ${interconnectResponse.status}`);
  } else if (
    interconnectResponse.body?.data?.state === "available" &&
    interconnectResponse.body?.data?.cableAssemblies?.some((entry) => entry.id === DEMO_CABLE_ASSEMBLY_ID) &&
    interconnectResponse.body?.data?.summary?.pinMapRowCount >= 24
  ) {
    check("GET /interconnects", "pass", `${interconnectResponse.body.data.summary.pinMapRowCount} interconnect pin rows found`);
  } else {
    check("GET /interconnects", "fail", `unexpected payload: ${JSON.stringify(interconnectResponse.body)}`);
  }

  // Optional web workspace reachability checks. These stay warnings by default so
  // API-only probes still provide value; set EE_SMOKE_REQUIRE_WEB=1 to fail hard.
  const catalogPage = await safeFetchWeb(`/catalog`);
  if (!catalogPage.ok) {
    check("GET web /catalog", classifyWebCheckStatus(false), catalogPage.error ?? `HTTP ${catalogPage.status}`);
  } else {
    check("GET web /catalog", "pass", "workspace route returned HTTP 200");
  }

  const partPage = await safeFetchWeb(`/parts/${encodeURIComponent(demoPartId)}`);
  if (!partPage.ok) {
    check(`GET web /parts/${demoPartId}`, classifyWebCheckStatus(false), partPage.error ?? `HTTP ${partPage.status}`);
  } else {
    check(`GET web /parts/${demoPartId}`, "pass", "part detail route returned HTTP 200");
  }

  const demoProjectPage = await safeFetchWeb(`/projects/${encodeURIComponent(demoProjectId)}`);
  if (!demoProjectPage.ok) {
    check(
      `GET web /projects/${demoProjectId}`,
      classifyWebCheckStatus(false),
      demoProjectPage.error ?? `HTTP ${demoProjectPage.status}`
    );
  } else {
    check(`GET web /projects/${demoProjectId}`, "pass", "demo project workspace route returned HTTP 200");
  }

  printSummary();
}

async function safeFetchWeb(path, init) {
  const url = `${webBaseUrl}${path}`;
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "follow", ...init });
    return { ok: response.ok, status: response.status, url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false, status: 0, url };
  }
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
