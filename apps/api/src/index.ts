/**
 * File header: Provides the provider-neutral HTTP API for catalog search and detail reads.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { filterPartRecords, getSearchFacetsFromRecords } from "@ee-library/shared/catalog-runtime";
import { getCatalogStoreStatus, readCatalogRecordsFromDatabase, readPartDetailRecordsFromDatabase } from "./catalog-store";
import { resolveCatalogRecords } from "./catalog-resolver";
import { buildPartDetailResponse } from "./detail-response";
import type { ApiEnvelope, CadAvailabilityFilter, CatalogDataSource, PartSearchFilters, PartSearchRecord } from "@ee-library/shared/types";

/** port is the local HTTP port for the API process. */
const port = Number(process.env.API_PORT ?? 4000);

/**
 * Handles every incoming HTTP request with explicit route boundaries.
 */
async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL" });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Only GET is enabled for the catalog API" });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

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

  if (url.pathname === "/parts") {
    const filters = readSearchFilters(url);
    const catalog = await resolveCatalogRecords(readCatalogRecordsFromDatabase, loadSeedCatalogRecords);

    if (!catalog.ok) {
      sendJson(response, catalog.statusCode, catalog.body);
      return;
    }

    sendCatalogJson(response, filterPartRecords(catalog.records, filters), catalog.source, catalog.warnings);
    return;
  }

  if (url.pathname === "/parts/facets") {
    const catalog = await resolveCatalogRecords(readCatalogRecordsFromDatabase, loadSeedCatalogRecords);

    if (!catalog.ok) {
      sendJson(response, catalog.statusCode, catalog.body);
      return;
    }

    sendCatalogJson(response, getSearchFacetsFromRecords(catalog.records), catalog.source, catalog.warnings);
    return;
  }

  const partMatch = /^\/parts\/([^/]+)$/u.exec(url.pathname);

  if (partMatch?.[1]) {
    const partId = partMatch[1];
    const catalog = await resolveCatalogRecords(() => readPartDetailRecordsFromDatabase(partId), loadSeedCatalogRecords);

    if (!catalog.ok) {
      sendJson(response, catalog.statusCode, catalog.body);
      return;
    }

    const records = catalog.records;
    const record = records.find((candidate) => candidate.part.id === partMatch[1]);

    if (!record) {
      sendJson(response, 404, { error: "Part not found" });
      return;
    }

    sendCatalogJson(response, buildPartDetailResponse(record, records), catalog.source, catalog.warnings);
    return;
  }

  sendJson(response, 404, { error: "Route not found" });
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
 * Reads a URL CAD availability filter without accepting unknown strings.
 */
function readCadAvailability(value: string | null): CadAvailabilityFilter {
  if (value === "available" || value === "unavailable") {
    return value;
  }

  return "any";
}

/**
 * Reads a URL lifecycle filter without accepting unknown strings.
 */
function readLifecycleStatus(value: string | null): PartSearchFilters["lifecycleStatus"] {
  if (value === "active" || value === "not_recommended" || value === "obsolete" || value === "unknown") {
    return value;
  }

  return undefined;
}

/**
 * Sends a JSON response with a stable content type.
 */
function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

/**
 * Sends a typed catalog data envelope with optional degraded-state warnings.
 */
function sendCatalogJson<TData>(response: ServerResponse, data: TData, source: CatalogDataSource, warnings?: string[]): void {
  const payload: ApiEnvelope<TData> = warnings && warnings.length > 0 ? { data, source, warnings } : { data, source };

  sendJson(response, 200, payload);
}

/**
 * Dynamically loads seed data only when explicit local fallback is enabled.
 */
async function loadSeedCatalogRecords(): Promise<PartSearchRecord[]> {
  const { getAllPartRecords } = await import("@ee-library/shared/search");

  return getAllPartRecords();
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
