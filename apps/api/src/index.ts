/**
 * File header: Provides the provider-neutral HTTP API for catalog search and detail reads.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { filterPartRecords, getPartDetail, getSearchFacets, getSearchFacetsFromRecords, searchParts } from "@ee-library/shared";
import { getCatalogStoreStatus, readCatalogRecordsFromDatabase } from "./catalog-store";
import { handleImportRequest } from "./import-route";
import { buildSystemHealth } from "./system-health";
import type { CadAvailabilityFilter, PartSearchFilters, PartSearchRecord } from "@ee-library/shared";

/** API_PORT is read from the environment so local runs do not hard-code deployment details. */
const port = Number(process.env.API_PORT ?? 4000);

/**
 * Handles every incoming HTTP request with explicit route boundaries.
 */
async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL" });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "POST" && url.pathname === "/parts/import") {
    const rawBody = await readJsonBody(request);
    if (rawBody.kind === "invalid") {
      sendJson(response, 400, { error: rawBody.message });
      return;
    }
    const outcome = await handleImportRequest(rawBody.value);
    sendJson(response, outcome.statusCode, outcome.body);
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed for this route" });
    return;
  }

  if (url.pathname === "/health") {
    const database = await getCatalogStoreStatus();

    sendJson(response, 200, {
      dependencies: {
        database: database.label,
        objectStorage: "not_connected_phase_0",
        queue: "not_connected_phase_0"
      },
      service: "api",
      status: "ok"
    });
    return;
  }

  if (url.pathname === "/system/health") {
    const health = await buildSystemHealth();
    sendJson(response, 200, health);
    return;
  }

  if (url.pathname === "/parts") {
    const databaseRecords = await readDatabaseRecordsSafely();
    const data = databaseRecords ? filterPartRecords(databaseRecords, readSearchFilters(url)) : searchParts(readSearchFilters(url));

    sendJson(response, 200, {
      data,
      source: databaseRecords ? "database" : "seed_fallback"
    });
    return;
  }

  if (url.pathname === "/parts/facets") {
    const databaseRecords = await readDatabaseRecordsSafely();

    sendJson(response, 200, {
      data: databaseRecords ? getSearchFacetsFromRecords(databaseRecords) : getSearchFacets(),
      source: databaseRecords ? "database" : "seed_fallback"
    });
    return;
  }

  const partMatch = /^\/parts\/([^/]+)$/u.exec(url.pathname);

  if (partMatch?.[1]) {
    const databaseRecords = await readDatabaseRecordsSafely();
    const record = databaseRecords ? databaseRecords.find((candidate) => candidate.part.id === partMatch[1]) : getPartDetail(partMatch[1]);

    if (!record) {
      sendJson(response, 404, { error: "Part not found" });
      return;
    }

    sendJson(response, 200, {
      data: record,
      source: databaseRecords ? "database" : "seed_fallback"
    });
    return;
  }

  sendJson(response, 404, { error: "Route not found" });
}

/**
 * Reads database records while allowing seed fallback for local development outages.
 */
async function readDatabaseRecordsSafely(): Promise<PartSearchRecord[] | null> {
  try {
    return await readCatalogRecordsFromDatabase();
  } catch (error) {
    console.error("Catalog database read failed; using seed fallback.", error);
    return null;
  }
}

/**
 * Converts URL search parameters into strict shared search filters.
 */
function readSearchFilters(url: URL): PartSearchFilters {
  return {
    cadAvailability: readCadAvailability(url.searchParams.get("cad")),
    category: url.searchParams.get("category") ?? undefined,
    lifecycleStatus: readLifecycleStatus(url.searchParams.get("lifecycleStatus")),
    manufacturerId: url.searchParams.get("manufacturerId") ?? undefined,
    packageId: url.searchParams.get("packageId") ?? undefined,
    query: url.searchParams.get("q") ?? undefined
  };
}

/**
 * Normalizes the CAD availability query parameter for API consumers.
 */
function readCadAvailability(value: string | null): CadAvailabilityFilter {
  if (value === "available" || value === "unavailable") {
    return value;
  }

  return "any";
}

/**
 * Normalizes the lifecycle query parameter for API consumers.
 */
function readLifecycleStatus(value: string | null): PartSearchFilters["lifecycleStatus"] {
  if (value === "active" || value === "not_recommended" || value === "obsolete" || value === "unknown") {
    return value;
  }

  return undefined;
}

/**
 * Sends a JSON response with consistent headers.
 */
function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

/** ReadJsonBodyResult preserves either the parsed JSON or a structured invalid-body error. */
type ReadJsonBodyResult = { kind: "ok"; value: unknown } | { kind: "invalid"; message: string };

/**
 * Reads up to 1 MiB of body bytes and parses them as JSON. Used by mutating endpoints.
 */
async function readJsonBody(request: IncomingMessage): Promise<ReadJsonBodyResult> {
  const maxBytes = 1024 * 1024;
  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maxBytes) {
      return { kind: "invalid", message: "Request body exceeds 1 MiB limit" };
    }
    chunks.push(buffer);
  }

  if (received === 0) {
    return { kind: "ok", value: {} };
  }

  try {
    return { kind: "ok", value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { kind: "invalid", message: "Request body is not valid JSON" };
  }
}

/** server starts the provider-neutral API process. */
const server = createServer((request, response) => {
  handleRequest(request, response).catch((error: unknown) => {
    console.error("Unhandled API route error.", error);
    sendJson(response, 500, { error: "Internal API error" });
  });
});

server.listen(port, () => {
  console.log(`EE Library API listening on http://localhost:${port}`);
});
