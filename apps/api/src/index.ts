/**
 * File header: Provides a small provider-neutral HTTP API skeleton for Phase 0 and Phase 1.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getPartDetail, getSearchFacets, searchParts } from "@ee-library/shared";
import type { CadAvailabilityFilter, PartSearchFilters } from "@ee-library/shared";

/** API_PORT is read from the environment so local runs do not hard-code deployment details. */
const port = Number(process.env.API_PORT ?? 4000);

/**
 * Handles every incoming HTTP request with explicit route boundaries.
 */
function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL" });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Only GET is enabled in the Phase 1 skeleton" });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(response, 200, {
      dependencies: {
        database: "not_connected_phase_0",
        objectStorage: "not_connected_phase_0",
        queue: "not_connected_phase_0"
      },
      service: "api",
      status: "ok"
    });
    return;
  }

  if (url.pathname === "/parts") {
    sendJson(response, 200, {
      data: searchParts(readSearchFilters(url))
    });
    return;
  }

  if (url.pathname === "/parts/facets") {
    sendJson(response, 200, {
      data: getSearchFacets()
    });
    return;
  }

  const partMatch = /^\/parts\/([^/]+)$/u.exec(url.pathname);

  if (partMatch?.[1]) {
    const record = getPartDetail(partMatch[1]);

    if (!record) {
      sendJson(response, 404, { error: "Part not found" });
      return;
    }

    sendJson(response, 200, { data: record });
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

/** server starts the provider-neutral API process. */
const server = createServer(handleRequest);

server.listen(port, () => {
  console.log(`EE Library API listening on http://localhost:${port}`);
});
