/**
 * File header: Provides the provider-neutral HTTP API for catalog search and detail reads.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { filterPartRecords, getSearchFacetsFromRecords } from "@ee-library/shared/catalog-runtime";
import { CatalogStoreError, createGenerationRequestInDatabase, getCatalogStoreStatus, readCatalogRecordsFromDatabase, readPartDetailRecordsFromDatabase } from "./catalog-store";
import { resolveCatalogRecords } from "./catalog-resolver";
import { buildPartDetailResponse } from "./detail-response";
import type { ApiEnvelope, CadAvailabilityFilter, CatalogDataSource, GenerationRequestCreateInput, GenerationTargetAssetType, PartSearchFilters, PartSearchRecord } from "@ee-library/shared/types";

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

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const generationRequestMatch = /^\/parts\/([^/]+)\/generation-requests$/u.exec(url.pathname);

  if (request.method === "POST" && generationRequestMatch?.[1]) {
    await handleGenerationRequestCreate(request, response, generationRequestMatch[1]);
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Only GET and generation-request POST routes are enabled for the catalog API" });
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
 * Handles local/dev-safe generation request creation without simulating output assets.
 */
async function handleGenerationRequestCreate(request: IncomingMessage, response: ServerResponse, partId: string): Promise<void> {
  const body = await readJsonBody<GenerationRequestCreateInput>(request);

  if (!body || !isGenerationTargetAssetType(body.targetAssetType)) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_GENERATION_REQUEST",
        message: "Generation requests require a targetAssetType of footprint, symbol, or three_d_model."
      }
    });
    return;
  }

  try {
    const result = await createGenerationRequestInDatabase(partId, body.targetAssetType);

    if (result.status === "not_configured") {
      sendJson(response, 503, {
        error: {
          code: "DB_NOT_CONFIGURED",
          message: "Generation requests require a configured database so request state can be persisted."
        }
      });
      return;
    }

    if (result.status === "not_found") {
      sendJson(response, 404, {
        error: {
          code: "PART_NOT_FOUND",
          message: "Part not found."
        }
      });
      return;
    }

    if (result.status === "not_requestable") {
      sendJson(response, 409, {
        error: {
          code: "GENERATION_NOT_REQUESTABLE",
          message: result.reason
        }
      });
      return;
    }

    sendCatalogJson(response, result.response, "database");
  } catch (error) {
    sendCatalogStoreError(response, error);
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
 * Reads and parses a small JSON body from an incoming request.
 */
async function readJsonBody<TBody>(request: IncomingMessage): Promise<TBody | null> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as TBody;
  } catch {
    return null;
  }
}

/**
 * Checks generation request target values without trusting the JSON body.
 */
function isGenerationTargetAssetType(value: unknown): value is GenerationTargetAssetType {
  return value === "footprint" || value === "symbol" || value === "three_d_model";
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
 * Sends explicit DB-backed generation request failures without falling back to seed data.
 */
function sendCatalogStoreError(response: ServerResponse, error: unknown): void {
  if (error instanceof CatalogStoreError) {
    sendJson(response, error.kind === "database_unavailable" ? 503 : 500, {
      error: {
        code: error.kind.toUpperCase(),
        message: error.message
      }
    });
    return;
  }

  sendJson(response, 500, {
    error: {
      code: "QUERY_FAILED",
      message: "Generation request persistence failed."
    }
  });
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
