/**
 * File header: Implements the provider-neutral search page through the API boundary.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionPanel, StatusBadge, TrustMeter } from "@ee-library/ui";
import { fetchApiHealth, fetchPartSearchEnvelope, fetchSearchFacetsEnvelope, isApiClientError } from "../lib/api-client";
import { getAssetTruthSummary, getConnectorWorkflowSummary, getRecoveryWorkflowSummary, getSearchExportReadiness } from "../lib/detail-view-model";
import type { BadgeTone } from "@ee-library/ui";
import type { CadAvailabilityFilter, CatalogDataSource, LifecycleStatus, PartSearchFilters, PartSearchRecord, SearchFacets } from "@ee-library/shared/types";
import type { ApiHealth } from "../lib/api-client";

/** PageSearchParams mirrors the GET filters used by the search form. */
type PageSearchParams = {
  cad?: string | string[];
  category?: string | string[];
  manufacturerId?: string | string[];
  packageId?: string | string[];
  lifecycleStatus?: string | string[];
  q?: string | string[];
};

/** HomepageCatalogState makes setup-vs-data rendering explicit. */
type HomepageCatalogState =
  | {
      /** Ready means the API returned either DB-backed data or explicit local seed data. */
      status: "ready";
      /** Search facets for the filter rail. */
      facets: SearchFacets;
      /** Search results for the current filter set. */
      results: PartSearchRecord[];
      /** Catalog source reported by the API envelope. */
      source: CatalogDataSource;
      /** Explicit source/degraded-mode warnings from the API envelope. */
      warnings: string[];
      /** Operational API health if the health endpoint was reachable. */
      health: ApiHealth | null;
    }
  | {
      /** Setup required means the homepage should not pretend records are available. */
      status: "setup_required";
      /** Machine-readable reason for the setup state. */
      code: string;
      /** Actionable setup copy. */
      message: string;
      /** Operational API health if the health endpoint was reachable. */
      health: ApiHealth | null;
    };

/** dynamic forces search data to flow through the API service at request time. */
export const dynamic = "force-dynamic";

/** SearchPageProps supports both current and previous Next.js searchParams shapes. */
interface SearchPageProps {
  /** Query string filters from the app router. */
  searchParams: Promise<PageSearchParams>;
}

/**
 * Renders the search workflow with filter rail, empty state, and trust badges.
 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = readSingleParam(resolvedSearchParams?.q);
  const manufacturerId = readSingleParam(resolvedSearchParams?.manufacturerId);
  const category = readSingleParam(resolvedSearchParams?.category);
  const packageId = readSingleParam(resolvedSearchParams?.packageId);
  const lifecycleStatus = readLifecycleStatus(readSingleParam(resolvedSearchParams?.lifecycleStatus));
  const cadAvailability = readCadAvailability(readSingleParam(resolvedSearchParams?.cad));
  const filters: PartSearchFilters = {
    cadAvailability,
    category,
    lifecycleStatus,
    manufacturerId,
    packageId,
    query
  };
  const catalogState = await loadHomepageCatalog(filters);

  if (catalogState.status === "setup_required") {
    return <HomepageSetupState catalogState={catalogState} />;
  }

  const { facets, health, results, source, warnings } = catalogState;
  const catalogStats = buildCatalogStats(results);
  const sampleParts = selectSampleParts(results);
  const providerSummary = buildProviderSummary(results, source, health);

  return (
    <main className="search-layout">
      <section className="search-hero">
        <div>
          <p className="app-kicker">Engineering workspace / {catalogModeLabel(source)}</p>
          <h2>Search parts, inspect provenance, and keep export readiness honest.</h2>
          <div className="status-row">
            <StatusBadge label={catalogModeLabel(source)} tone={catalogModeTone(source)} />
            <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
            <StatusBadge label={`Database ${health?.dependencies.database ?? "unknown"}`} tone={health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
          {warnings.length > 0 ? <p className="mode-warning">{warnings.join(" ")}</p> : null}
          {source === "seed_fallback" ? <p className="mode-warning">Local seed mode uses deterministic local examples only. It is not DB-backed catalog data.</p> : null}
          <div className="workspace-priorities" aria-label="Core engineering workflows">
            <div>
              <strong>Exact MPN lookup</strong>
              <span>Start with the part number and preserve source truth.</span>
            </div>
            <div>
              <strong>Connector mate set</strong>
              <span>Check mates, accessories, tooling, and cable options.</span>
            </div>
            <div>
              <strong>Verified CAD evidence</strong>
              <span>Separate file-backed assets from references and drafts.</span>
            </div>
            <div>
              <strong>Missing-CAD recovery</strong>
              <span>Request drafts only when extracted source material supports it.</span>
            </div>
          </div>
        </div>
        <form className="search-bar" action="/" method="get">
          <label htmlFor="q">MPN or keyword</label>
          <input name="manufacturerId" type="hidden" value={manufacturerId} />
          <input name="category" type="hidden" value={category} />
          <input name="packageId" type="hidden" value={packageId} />
          <input name="lifecycleStatus" type="hidden" value={lifecycleStatus} />
          <input name="cad" type="hidden" value={cadAvailability} />
          <div className="search-bar__controls">
            <input defaultValue={query} id="q" name="q" placeholder="TPS7A02, 0603, QFN..." />
            <button type="submit">Search</button>
          </div>
        </form>
      </section>

      <section className="dashboard-grid" aria-label="Homepage status and shortcuts">
        <SectionPanel description="Fast checks for the current catalog result set and trust posture." title="Catalog mode">
          <div className="health-grid">
            <div>
              <span>Total records</span>
              <strong>{catalogStats.totalRecords}</strong>
            </div>
            <div>
              <span>Verified CAD records</span>
              <strong>{catalogStats.verifiedCadRecords}</strong>
            </div>
            <div>
              <span>Connector records</span>
              <strong>{catalogStats.connectorRecords}</strong>
            </div>
            <div>
              <span>Generation workflows</span>
              <strong>{catalogStats.generationWorkflowCount}</strong>
            </div>
          </div>
        </SectionPanel>

        <SectionPanel description={providerSummary.description} title="Import / provider health">
          <div className="provider-summary">
            <StatusBadge label={providerSummary.label} tone={providerSummary.tone} />
            <p>{providerSummary.detail}</p>
          </div>
        </SectionPanel>

        <SectionPanel description="Start from common engineering workflows without changing catalog truth." title="Quick navigation">
          <div className="quick-actions">
            <Link className="button-link" href="/?cad=available">
              Verified CAD
            </Link>
            <Link className="button-link" href="/?cad=unavailable">
              Missing CAD
            </Link>
            <Link className="button-link" href="/?category=Connector">
              Connectors
            </Link>
          </div>
        </SectionPanel>
      </section>

      <SectionPanel description="Latest records from the active catalog mode. Seed mode examples are labeled above and must not be treated as production data." title="Recent / sample parts">
        {sampleParts.length > 0 ? (
          <div className="sample-part-grid">
            {sampleParts.map((record) => {
              const exportReadiness = getSearchExportReadiness(record);
              const assetTruth = getAssetTruthSummary(record);
              const recoveryStatus = getRecoveryWorkflowSummary(record);

              return (
                <Link className="sample-part-card" href={`/parts/${record.part.id}`} key={record.part.id}>
                  <span className="ui-mono">{record.part.mpn}</span>
                  <strong>{record.manufacturer.name}</strong>
                  <span>
                    {record.part.category} / {record.package.packageName}
                  </span>
                  <div className="sample-part-card__badges">
                    <StatusBadge label={exportReadiness.label} tone={exportReadiness.tone} />
                    <StatusBadge label={assetTruth.label} tone={assetTruth.tone} />
                    <StatusBadge label={recoveryStatus.label} tone={recoveryStatus.tone} />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState body="No sample records are available from the current catalog source." title="No sample parts" />
        )}
      </SectionPanel>

      <div className="search-workspace">
        <aside className="filter-rail" aria-label="Search filters">
          <form action="/" method="get">
            <input name="q" type="hidden" value={query} />
            <label>
              Manufacturer
              <select defaultValue={manufacturerId} name="manufacturerId">
                <option value="">All manufacturers</option>
                {facets.manufacturers.map((manufacturer) => (
                  <option key={manufacturer.id} value={manufacturer.id}>
                    {manufacturer.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select defaultValue={category} name="category">
                <option value="">All categories</option>
                {facets.categories.map((partCategory) => (
                  <option key={partCategory} value={partCategory}>
                    {partCategory}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Package
              <select defaultValue={packageId} name="packageId">
                <option value="">All packages</option>
                {facets.packages.map((partPackage) => (
                  <option key={partPackage.id} value={partPackage.id}>
                    {partPackage.packageName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lifecycle
              <select defaultValue={lifecycleStatus} name="lifecycleStatus">
                <option value="">All lifecycle states</option>
                {facets.lifecycleStatuses.map((status) => (
                  <option key={status} value={status}>
                    {formatLifecycleStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CAD / export evidence
              <select defaultValue={cadAvailability} name="cad">
                <option value="any">Any CAD state</option>
                <option value="available">Verified file-backed CAD</option>
                <option value="unavailable">Missing verified CAD</option>
              </select>
            </label>
            <button type="submit">Apply filters</button>
          </form>
        </aside>

        <section className="results-panel" aria-label="Search results">
          <div className="results-panel__header">
            <div>
              <p className="app-kicker">Search results</p>
              <h2>{results.length} matched records</h2>
            </div>
            <StatusBadge label={catalogModeLabel(source)} tone={catalogModeTone(source)} />
          </div>

          {results.length > 0 ? (
            <div className="results-list">
              {results.map((record) => {
                const exportReadiness = getSearchExportReadiness(record);
                const assetTruth = getAssetTruthSummary(record);
                const connectorHint = getConnectorWorkflowSummary(record);
                const recoveryStatus = getRecoveryWorkflowSummary(record);

                return (
                  <article className="result-row" key={record.part.id}>
                    <div className="result-row__identity">
                      <Link className="result-row__mpn" href={`/parts/${record.part.id}`}>
                        {record.part.mpn}
                      </Link>
                      <p>
                        {record.manufacturer.name} / {record.part.category}
                      </p>
                    </div>
                    <div className="result-row__package">
                      <span>Package</span>
                      <strong>{record.package.packageName}</strong>
                    </div>
                    <div className="result-row__signals">
                      <div>
                        <span>Asset truth</span>
                        <strong>{assetTruth.label}</strong>
                        <small>{assetTruth.detail}</small>
                      </div>
                      <div>
                        <span>{connectorHint ? "Connector" : "Recovery"}</span>
                        <strong>{connectorHint?.label ?? recoveryStatus.label}</strong>
                        <small>{connectorHint?.detail ?? recoveryStatus.detail}</small>
                      </div>
                    </div>
                    <div className="result-row__badges">
                      <StatusBadge label={record.part.lifecycleStatus} tone="info" />
                      <StatusBadge label={exportReadiness.label} tone={exportReadiness.tone} />
                    </div>
                    <TrustMeter label="Trust" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState body="Try a broader MPN, manufacturer, category, package, or CAD availability filter." title="No matching parts" />
          )}
        </section>
      </div>
    </main>
  );
}

/**
 * Loads homepage catalog data while converting setup failures into renderable state.
 */
async function loadHomepageCatalog(filters: PartSearchFilters): Promise<HomepageCatalogState> {
  const healthPromise = fetchApiHealth();

  try {
    const [health, facetsEnvelope, resultsEnvelope] = await Promise.all([healthPromise, fetchSearchFacetsEnvelope(), fetchPartSearchEnvelope(filters)]);
    const source = resultsEnvelope.source ?? facetsEnvelope.source ?? "database";

    return {
      facets: facetsEnvelope.data,
      health,
      results: resultsEnvelope.data,
      source,
      status: "ready",
      warnings: [...new Set([...(facetsEnvelope.warnings ?? []), ...(resultsEnvelope.warnings ?? [])])]
    };
  } catch (error) {
    return buildSetupCatalogState(error, await healthPromise);
  }
}

/**
 * Builds a setup state from DB or API failures without throwing during homepage render.
 */
function buildSetupCatalogState(error: unknown, health: ApiHealth | null): HomepageCatalogState {
  if (isApiClientError(error) && error.code === "DB_NOT_CONFIGURED") {
    return {
      code: error.code,
      health,
      message: "Catalog database is not configured, and explicit local seed fallback is disabled.",
      status: "setup_required"
    };
  }

  if (isApiClientError(error)) {
    return {
      code: error.code,
      health,
      message: error.message,
      status: "setup_required"
    };
  }

  return {
    code: "API_UNAVAILABLE",
    health,
    message: "The API could not be reached, so the homepage cannot load catalog records.",
    status: "setup_required"
  };
}

/**
 * Renders an actionable setup state instead of crashing the root page.
 */
function HomepageSetupState({ catalogState }: { catalogState: Extract<HomepageCatalogState, { status: "setup_required" }> }) {
  return (
    <main className="search-layout">
      <section className="setup-panel">
        <div className="setup-panel__header">
          <p className="app-kicker">Local setup</p>
          <h2>Connect Postgres or enable local seed mode.</h2>
          <div className="status-row">
            <StatusBadge label={catalogState.code} tone="review" />
            <StatusBadge label={`Database ${catalogState.health?.dependencies.database ?? "unknown"}`} tone={catalogState.health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
        </div>
        <p>{catalogState.message}</p>
        <p>No catalog records are shown here because EE Library will not silently pretend DB-backed data is available.</p>
        <div className="setup-steps">
          <div>
            <strong>Use the canonical database</strong>
            <code>$env:DATABASE_URL="postgres://ee_library:ee_library@127.0.0.1:5432/ee_library"</code>
            <code>npm run ingest:local</code>
            <code>npm run dev</code>
          </div>
          <div>
            <strong>Use explicit local seed mode</strong>
            <code>$env:EE_LIBRARY_ALLOW_SEED_FALLBACK="true"</code>
            <code>npm run dev</code>
            <span>Seed mode is local example data only, not DB-backed catalog truth.</span>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * Builds compact homepage counters from the active result set.
 */
function buildCatalogStats(records: PartSearchRecord[]) {
  return {
    connectorRecords: records.filter((record) => record.connectorFamily !== null || record.part.category.toLowerCase().includes("connector")).length,
    generationWorkflowCount: records.reduce((total, record) => total + record.generationWorkflows.length, 0),
    totalRecords: records.length,
    verifiedCadRecords: records.filter((record) => record.assets.some((asset) => asset.exportStatus === "verified_for_export" && asset.storageKey !== null && asset.fileHash !== null)).length
  };
}

/**
 * Selects deterministic sample parts using update time and MPN tie-breaks.
 */
function selectSampleParts(records: PartSearchRecord[]): PartSearchRecord[] {
  return [...records].sort((left, right) => Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt) || left.part.mpn.localeCompare(right.part.mpn)).slice(0, 4);
}

/**
 * Summarizes provider/source health without introducing a separate provider-specific UI layer.
 */
function buildProviderSummary(records: PartSearchRecord[], source: CatalogDataSource, health: ApiHealth | null): { description: string; detail: string; label: string; tone: BadgeTone } {
  if (source === "seed_fallback") {
    return {
      description: "Local fallback is explicit and visible.",
      detail: "Records are deterministic seed examples. Import freshness and provider failures are not production DB health.",
      label: "local seed mode",
      tone: "review"
    };
  }

  if (!health) {
    return {
      description: "API health could not be loaded.",
      detail: "Catalog data loaded, but the health endpoint was not reachable for dependency status.",
      label: "health unknown",
      tone: "review"
    };
  }

  const sources = records.flatMap((record) => record.sources);
  const providerCount = new Set(sources.map((sourceRecord) => sourceRecord.providerId)).size;
  const failedImports = sources.filter((sourceRecord) => sourceRecord.importStatus === "failed").length;
  const latestImport = sources.map((sourceRecord) => sourceRecord.sourceLastImportedAt).filter((value): value is string => Boolean(value)).sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

  return {
    description: "Provider source records attached to the current catalog result set.",
    detail: `${providerCount} providers represented, ${failedImports} failed imports attached${latestImport ? `, latest import ${formatDateTime(latestImport)}` : ""}.`,
    label: health.dependencies.database === "connected" ? "DB-backed catalog" : `database ${health.dependencies.database}`,
    tone: health.dependencies.database === "connected" && failedImports === 0 ? "verified" : "review"
  };
}

/**
 * Labels the active catalog mode without hiding local seed fallback.
 */
function catalogModeLabel(source: CatalogDataSource): string {
  return source === "seed_fallback" ? "Local seed mode" : "DB-backed catalog";
}

/**
 * Maps catalog mode into a compact status tone.
 */
function catalogModeTone(source: CatalogDataSource): BadgeTone {
  return source === "seed_fallback" ? "review" : "verified";
}

/**
 * Formats ISO timestamps for compact health summaries.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

/**
 * Reads one query value from a Next.js search parameter.
 */
function readSingleParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

/**
 * Normalizes the CAD availability query parameter into a strict filter value.
 */
function readCadAvailability(value: string | undefined): CadAvailabilityFilter {
  if (value === "available" || value === "unavailable") {
    return value;
  }

  return "any";
}

/**
 * Normalizes lifecycle query parameters into strict domain values.
 */
function readLifecycleStatus(value: string | undefined): LifecycleStatus | undefined {
  if (value === "active" || value === "not_recommended" || value === "obsolete" || value === "unknown") {
    return value;
  }

  return undefined;
}

/**
 * Formats lifecycle values for the filter rail.
 */
function formatLifecycleStatus(status: LifecycleStatus): string {
  const labels: Record<LifecycleStatus, string> = {
    active: "Active",
    not_recommended: "Not recommended",
    obsolete: "Obsolete",
    unknown: "Unknown"
  };

  return labels[status];
}

/**
 * Maps trust scores to simple badge tones for the shared UI package.
 */
function scoreTone(score: number): BadgeTone {
  if (score >= 0.8) {
    return "verified";
  }

  if (score >= 0.65) {
    return "review";
  }

  return "danger";
}
