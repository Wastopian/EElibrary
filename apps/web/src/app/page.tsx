/**
 * File header: Implements the provider-neutral search page through the API boundary.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, StatusBadge, TrustMeter } from "@ee-library/ui";
import { ImportByMpnPanel } from "../components/ImportByMpnPanel";
import { fetchApiHealth, fetchPartSearchEnvelope, fetchSearchFacetsEnvelope, isApiClientError } from "../lib/api-client";
import { getAssetTruthSummary, getConnectorWorkflowSummary, getQuickReadinessDataCoverage, getQuickReadinessSummary, getRecoveryWorkflowSummary, getSearchExportReadiness } from "../lib/detail-view-model";
import type { BadgeTone } from "@ee-library/ui";
import type { CadAvailabilityFilter, CatalogDataSource, LifecycleStatus, PartSearchFilters, PartSearchRecord, PartSearchSort, SearchFacets, SearchPagination } from "@ee-library/shared/types";
import type { ApiHealth } from "../lib/api-client";

/** PageSearchParams mirrors the GET filters used by the search form. */
type PageSearchParams = {
  cad?: string | string[];
  category?: string | string[];
  manufacturerId?: string | string[];
  packageId?: string | string[];
  lifecycleStatus?: string | string[];
  page?: string | string[];
  pageSize?: string | string[];
  q?: string | string[];
  sort?: string | string[];
};

/** HomepageCatalogState makes setup-vs-data rendering explicit. */
type HomepageCatalogState =
  | {
      status: "ready";
      facets: SearchFacets;
      results: PartSearchRecord[];
      pagination: SearchPagination;
      source: CatalogDataSource;
      warnings: string[];
      health: ApiHealth | null;
    }
  | {
      status: "setup_required";
      code: string;
      message: string;
      health: ApiHealth | null;
    };

/** QuickLookupState makes no-match and ambiguity explicit before rendering a readiness answer. */
type QuickLookupState =
  | { status: "idle" }
  | { status: "no_match"; query: string }
  | { status: "ambiguous"; query: string; records: PartSearchRecord[]; totalRecords: number }
  | { status: "matched"; record: PartSearchRecord };

export const dynamic = "force-dynamic";

interface SearchPageProps {
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
  const page = readPositiveInteger(readSingleParam(resolvedSearchParams?.page));
  const pageSize = readPositiveInteger(readSingleParam(resolvedSearchParams?.pageSize));
  const sort = readSearchSort(readSingleParam(resolvedSearchParams?.sort));
  const filters: PartSearchFilters = {
    cadAvailability,
    category,
    lifecycleStatus,
    manufacturerId,
    packageId,
    page,
    pageSize,
    query,
    sort
  };
  const catalogState = await loadHomepageCatalog(filters);

  if (catalogState.status === "setup_required") {
    return <HomepageSetupState catalogState={catalogState} />;
  }

  const { facets, health, pagination, results, source, warnings } = catalogState;
  const catalogStats = buildCatalogStats(results, pagination.totalRecords);
  const sampleParts = selectSampleParts(results);
  const providerSummary = buildProviderSummary(results, source, health);
  const resultRange = buildResultRange(pagination, results.length);
  const quickLookupState = buildQuickLookupState(query, results, pagination);

  return (
    <main>
      <section aria-label="Quick part readiness check" className="quick-check-workspace">
        <div className="hero-editorial__inner">
          <p className="app-kicker">EE Library</p>
          <h1>Quick part readiness check</h1>
          <p className="hero-lede">Normalized specs, connector build sets, and file-backed engineering assets—without treating references, drafts, or approvals as production-ready exports.</p>

          <form className="quick-check-form" action="/" method="get">
            <label htmlFor="q">MPN or keyword</label>
            <input name="manufacturerId" type="hidden" value={manufacturerId} />
            <input name="category" type="hidden" value={category} />
            <input name="packageId" type="hidden" value={packageId} />
            <input name="lifecycleStatus" type="hidden" value={lifecycleStatus} />
            <input name="cad" type="hidden" value={cadAvailability} />
            <input name="sort" type="hidden" value={sort} />
            <div className="search-bar__controls">
              <input defaultValue={query} id="q" name="q" placeholder="TPS7A02, QFN-16, connector series…" />
              <button type="submit">Check Part</button>
            </div>
            <label className="quick-check-unavailable">
              <span>Datasheet URL</span>
              <input disabled placeholder="Unavailable until the import API accepts datasheet URLs" />
            </label>
          </form>

          <div className="catalog-strip" role="status">
            <span className="catalog-strip__label">Catalog</span>
            <StatusBadge label={catalogModeLabel(source)} tone={catalogModeTone(source)} />
            <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
            <StatusBadge label={`Database ${health?.dependencies.database ?? "unknown"}`} tone={health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
          {warnings.length > 0 ? <p className="mode-warning">{warnings.join(" ")}</p> : null}
          {source === "seed_fallback" ? (
            <p className="mode-warning">Local seed mode uses deterministic local examples only. It is not DB-backed catalog data.</p>
          ) : null}

          <QuickLookupPanel state={quickLookupState} />

          <div className="quick-actions-row">
            <Link className="button-link button-link--quiet" href="/#import-by-mpn">
              Import by MPN
            </Link>
            <Link className="button-link button-link--quiet" href="/?category=Connector">
              Browse connectors
            </Link>
            <Link className="button-link button-link--quiet" href="/?cad=unavailable">
              Review missing or unverified CAD
            </Link>
          </div>

          <ImportByMpnPanel anchorId="import-by-mpn" />
        </div>
      </section>

      <div className="home-secondary">
        <div className="home-secondary__metrics">
          <div className="health-compact" aria-label="Snapshot of this page">
            <div>
              <span>Matches (total)</span>
              <strong>{catalogStats.totalMatches}</strong>
            </div>
            <div>
              <span>On this page</span>
              <strong>{catalogStats.visibleRecords}</strong>
            </div>
            <div>
              <span>Verified CAD (page)</span>
              <strong>{catalogStats.verifiedCadRecords}</strong>
            </div>
            <div>
              <span>Connectors (page)</span>
              <strong>{catalogStats.connectorRecords}</strong>
            </div>
            <div>
              <span>Generation jobs (page)</span>
              <strong>{catalogStats.generationWorkflowCount}</strong>
            </div>
            <div>
              <span>Catalog mode</span>
              <strong>{catalogModeLabel(source)}</strong>
            </div>
          </div>
        </div>
        <aside className="home-secondary__provider" aria-label="Provider and ingestion summary">
          <p className="app-kicker">Catalog health</p>
          <StatusBadge label={providerSummary.label} tone={providerSummary.tone} />
          <p className="muted-copy">{providerSummary.detail}</p>
        </aside>
      </div>

      <section className="sample-strip" aria-label="Sample records">
        <h2>Recently updated in this catalog window</h2>
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
                    {record.part.category} · {record.package.packageName}
                  </span>
                  <div className="sample-part-card__badges">
                    <StatusBadge label={exportReadiness.label} tone={exportReadiness.tone} />
                    <StatusBadge label={assetTruth.label} tone={mapViewTone(assetTruth.tone)} />
                    <StatusBadge label={recoveryStatus.label} tone={mapViewTone(recoveryStatus.tone)} />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState body="No sample records are available from the current catalog source." title="No sample parts" />
        )}
      </section>

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
                    {formatFacetOptionLabel(manufacturer.name, facets.counts?.manufacturers[manufacturer.id])}
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
                    {formatFacetOptionLabel(partCategory, facets.counts?.categories[partCategory])}
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
                    {formatFacetOptionLabel(partPackage.packageName, facets.counts?.packages[partPackage.id])}
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
                    {formatFacetOptionLabel(formatLifecycleStatus(status), facets.counts?.lifecycleStatuses[status])}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CAD files for export
              <select defaultValue={cadAvailability} name="cad">
                <option value="any">{formatFacetOptionLabel("Any", facets.counts?.cadAvailability.any)}</option>
                <option value="available">{formatFacetOptionLabel("Has verified file-backed CAD", facets.counts?.cadAvailability.available)}</option>
                <option value="unavailable">{formatFacetOptionLabel("Missing verified CAD", facets.counts?.cadAvailability.unavailable)}</option>
              </select>
            </label>
            <label>
              Sort
              <select defaultValue={sort} name="sort">
                <option value="mpn_asc">MPN A–Z</option>
                <option value="mpn_desc">MPN Z–A</option>
                <option value="updated_desc">Recently updated</option>
                <option value="trust_desc">Trust score</option>
              </select>
            </label>
            <button type="submit">Apply filters</button>
          </form>
        </aside>

        <section className="results-panel" aria-label="Search results">
          <div className="results-panel__header">
            <div>
              <p className="app-kicker">Results</p>
              <h2>{pagination.totalRecords} matches</h2>
              <p className="results-panel__range">
                Rows {resultRange.start}–{resultRange.end} · page {pagination.page} of {pagination.totalPages}
              </p>
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
                        {record.manufacturer.name} · {record.part.category}
                      </p>
                    </div>
                    <div className="result-row__package">
                      <span>Package</span>
                      <strong className="ui-mono">{record.package.packageName}</strong>
                    </div>
                    <div className="result-row__signals">
                      <div>
                        <span>Export bundle</span>
                        <strong>{exportReadiness.label}</strong>
                        <small>Altium / SolidWorks bundles follow this gate, not single-file luck.</small>
                      </div>
                      <div>
                        <span>CAD on disk</span>
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
                      <StatusBadge label={formatLifecycleShort(record.part.lifecycleStatus)} tone="neutral" />
                      <StatusBadge label={exportReadiness.label} tone={exportReadiness.tone} />
                    </div>
                    <TrustMeter label="Trust" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState body="Try a broader MPN, manufacturer, category, package, or CAD filter." title="No matching parts" />
          )}
          <SearchPaginationControls filters={filters} pagination={pagination} />
        </section>
      </div>
    </main>
  );
}

/**
 * Renders the explicit quick lookup state before any detailed readiness answer.
 */
function QuickLookupPanel({ state }: { state: QuickLookupState }) {
  if (state.status === "idle") {
    return <p className="quick-check-hint">Try a raw MPN, manufacturer-filtered lookup, or use provider import when a part is not in the catalog yet.</p>;
  }

  if (state.status === "no_match") {
    return (
      <div className="quick-check-empty" role="status">
        <strong>Part not found</strong>
        <p>
          No catalog records matched <span className="ui-mono">{state.query}</span>. The UI will not create a readiness answer without backend data.
        </p>
        <a className="button-link button-link--quiet" href="#import-by-mpn">
          Try provider import
        </a>
      </div>
    );
  }

  if (state.status === "ambiguous") {
    return <QuickAmbiguousResult records={state.records} totalRecords={state.totalRecords} query={state.query} />;
  }

  return <QuickReadinessResult record={state.record} />;
}

/**
 * Renders an ambiguity state with real candidate records instead of choosing silently.
 */
function QuickAmbiguousResult({ query, records, totalRecords }: { query: string; records: PartSearchRecord[]; totalRecords: number }) {
  return (
    <section aria-label={`Ambiguous readiness matches for ${query}`} className="quick-check-empty quick-check-empty--ambiguous" role="status">
      <div>
        <strong>Ambiguous match</strong>
        <p>
          {totalRecords} catalog records matched <span className="ui-mono">{query}</span>. Open the correct part before trusting readiness or export state.
        </p>
      </div>
      <div className="quick-candidate-list">
        {records.slice(0, 5).map((record) => (
          <Link href={`/parts/${record.part.id}`} key={record.part.id}>
            <span className="ui-mono">{record.part.mpn}</span>
            <span>
              {record.manufacturer.name} / {record.part.category} / {record.package.packageName}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * Renders the explanation-first quick readiness result from one real search record.
 */
function QuickReadinessResult({ record }: { record: PartSearchRecord }) {
  const summary = getQuickReadinessSummary(record);
  const dataCoverage = getQuickReadinessDataCoverage(record);
  const exportReadiness = getSearchExportReadiness(record);
  const assetTruth = getAssetTruthSummary(record);
  const connectorHint = getConnectorWorkflowSummary(record);
  const recoveryStatus = getRecoveryWorkflowSummary(record);

  return (
    <section aria-label={`Readiness result for ${record.part.mpn}`} className={`quick-readiness-result quick-readiness-result--${summary.tone}`}>
      <div className="quick-readiness-result__explanation">
        <div className="quick-readiness-result__bar" aria-hidden />
        <div>
          <div className="quick-readiness-result__headline">
            <h2>{summary.headline}</h2>
            <span>{summary.subhead}</span>
          </div>
          <p>{summary.detail}</p>
        </div>
        <TrustMeter label="Trust" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
      </div>

      <div className="quick-readiness-result__identity">
        <span className="ui-mono">{record.part.mpn}</span>
        <span>{record.manufacturer.name}</span>
        <span>
          {record.part.category} / {record.package.packageName}
        </span>
        <StatusBadge label={formatLifecycleShort(record.part.lifecycleStatus)} tone="neutral" />
        <StatusBadge label={dataCoverage.label} tone={mapViewTone(dataCoverage.tone)} />
        <Link className="button-link" href={`/parts/${record.part.id}`}>
          Open Full Record
        </Link>
      </div>

      <div className="quick-readiness-grid">
        <section className="quick-readiness-card">
          <div className="quick-readiness-card__header">
            <span>Readiness Checks</span>
            <StatusBadge label={exportReadiness.label} tone={exportReadiness.tone} />
          </div>
          {summary.checks.map((check) => (
            <div className="quick-check-row" key={check.label}>
              <StatusBadge label={check.label} tone={mapViewTone(check.tone)} />
              <p>{check.detail}</p>
            </div>
          ))}
        </section>

        <section className="quick-readiness-card">
          <div className="quick-readiness-card__header">
            <span>Next Actions</span>
            <span>{summary.actions.length} derived</span>
          </div>
          {summary.actions.length > 0 ? (
            summary.actions.map((action) => (
              <div className="quick-action-row" key={action.label}>
                <span className={`quick-action-row__priority quick-action-row__priority--${action.priority}`}>{action.priority}</span>
                <p>{action.label}</p>
              </div>
            ))
          ) : (
            <p className="muted-copy">No quick actions were derived from the current catalog record.</p>
          )}
        </section>

        <section className="quick-readiness-card">
          <div className="quick-readiness-card__header">
            <span>{connectorHint ? "Connector Intelligence" : "Missing-CAD Recovery"}</span>
            <StatusBadge label={connectorHint?.label ?? recoveryStatus.label} tone={mapViewTone(connectorHint?.tone ?? recoveryStatus.tone)} />
          </div>
          <p>{connectorHint?.detail ?? recoveryStatus.detail}</p>
          <div className="quick-readiness-card__footer">
            <StatusBadge label={assetTruth.label} tone={mapViewTone(assetTruth.tone)} />
            <p>{dataCoverage.detail}</p>
          </div>
        </section>
      </div>
    </section>
  );
}

function mapViewTone(tone: string): BadgeTone {
  if (tone === "generated") {
    return "generated";
  }

  return tone as BadgeTone;
}

/**
 * Builds the quick lookup state from a paged search response without silently selecting ambiguous results.
 */
function buildQuickLookupState(query: string | undefined, records: PartSearchRecord[], pagination: SearchPagination): QuickLookupState {
  if (!query || query.trim().length === 0) {
    return { status: "idle" };
  }

  if (records.length === 0 || pagination.totalRecords === 0) {
    return { query, status: "no_match" };
  }

  if (pagination.totalRecords > 1) {
    return {
      query,
      records,
      status: "ambiguous",
      totalRecords: pagination.totalRecords
    };
  }

  const record = records[0];

  return record ? { record, status: "matched" } : { query, status: "no_match" };
}

function formatLifecycleShort(status: string): string {
  const labels: Record<string, string> = {
    active: "Lifecycle: active",
    not_recommended: "Lifecycle: not recommended",
    obsolete: "Lifecycle: obsolete",
    unknown: "Lifecycle: unknown"
  };

  return labels[status] ?? status;
}

async function loadHomepageCatalog(filters: PartSearchFilters): Promise<HomepageCatalogState> {
  const healthPromise = fetchApiHealth();

  try {
    const [health, facetsEnvelope, resultsEnvelope] = await Promise.all([healthPromise, fetchSearchFacetsEnvelope(filters), fetchPartSearchEnvelope(filters)]);
    const source = resultsEnvelope.source ?? facetsEnvelope.source ?? "database";

    return {
      facets: facetsEnvelope.data,
      health,
      pagination: resultsEnvelope.pagination ?? buildFallbackPagination(resultsEnvelope.data.length, filters),
      results: resultsEnvelope.data,
      source,
      status: "ready",
      warnings: [...new Set([...(facetsEnvelope.warnings ?? []), ...(resultsEnvelope.warnings ?? [])])]
    };
  } catch (error) {
    return buildSetupCatalogState(error, await healthPromise);
  }
}

function SearchPaginationControls({ filters, pagination }: { filters: PartSearchFilters; pagination: SearchPagination }) {
  if (pagination.totalPages <= 1) {
    return null;
  }

  const previousPage = pagination.page - 1;
  const nextPage = pagination.page + 1;

  return (
    <nav aria-label="Search pagination" className="pagination-bar">
      {previousPage >= 1 ? (
        <Link className="button-link button-link--quiet" href={buildSearchHref(filters, previousPage)}>
          Previous
        </Link>
      ) : (
        <span>Previous</span>
      )}
      <strong>
        Page {pagination.page} / {pagination.totalPages}
      </strong>
      {nextPage <= pagination.totalPages ? (
        <Link className="button-link button-link--quiet" href={buildSearchHref(filters, nextPage)}>
          Next
        </Link>
      ) : (
        <span>Next</span>
      )}
    </nav>
  );
}

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

function HomepageSetupState({ catalogState }: { catalogState: Extract<HomepageCatalogState, { status: "setup_required" }> }) {
  return (
    <main>
      <section aria-label="Quick part readiness check unavailable" className="quick-check-workspace">
        <div className="hero-editorial__inner">
          <p className="app-kicker">EE Library</p>
          <h1>Quick part readiness check</h1>
          <p className="hero-lede">Backend unavailable. Connect the catalog database or enable explicit local seed mode to search. The UI will not invent DB-backed results.</p>
          <div className="catalog-strip" role="status">
            <span className="catalog-strip__label">Status</span>
            <StatusBadge label={catalogState.code} tone="review" />
            <StatusBadge label={`Database ${catalogState.health?.dependencies.database ?? "unknown"}`} tone={catalogState.health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
          <p className="mode-warning">{catalogState.message}</p>
          <form className="search-bar" aria-disabled="true">
            <label htmlFor="q-disabled">Search by MPN or keyword</label>
            <div className="search-bar__controls">
              <input disabled id="q-disabled" name="q" placeholder="Available after catalog is connected" />
              <button disabled type="button">
                Search catalog
              </button>
            </div>
          </form>
          <p className="search-disabled-note">Search stays visible so the layout matches a connected catalog. It remains disabled until data is reachable.</p>
          <details className="import-guide" id="import-by-mpn">
            <summary>How to import a part by MPN (worker)</summary>
            <pre>{`npm run ingest -w @ee-library/worker -- jlcparts <MPN_OR_LCSC_ID>
npm run imports:providers`}</pre>
          </details>
        </div>
      </section>

      <div className="setup-panel">
        <h2>Connect Postgres or enable local seed mode</h2>
        <p>No catalog records are shown here because EE Library does not silently substitute production data.</p>
        <div className="setup-steps">
          <div>
            <strong>Canonical database</strong>
            <code>$env:DATABASE_URL=&quot;postgres://ee_library:ee_library@127.0.0.1:5432/ee_library&quot;</code>
            <code>npm run ingest:local</code>
            <code>npm run dev</code>
          </div>
          <div>
            <strong>Explicit local seed</strong>
            <code>$env:EE_LIBRARY_ALLOW_SEED_FALLBACK=&quot;true&quot;</code>
            <code>npm run dev</code>
            <span>Seed mode is local examples only, not Postgres-backed truth.</span>
          </div>
        </div>
      </div>
    </main>
  );
}

function buildCatalogStats(records: PartSearchRecord[], totalMatches: number) {
  return {
    totalMatches,
    connectorRecords: records.filter((record) => record.connectorFamily !== null || record.part.category.toLowerCase().includes("connector")).length,
    generationWorkflowCount: records.reduce((total, record) => total + record.generationWorkflows.length, 0),
    visibleRecords: records.length,
    verifiedCadRecords: records.filter((record) => record.assets.some((asset) => asset.exportStatus === "verified_for_export" && asset.storageKey !== null && asset.fileHash !== null)).length
  };
}

function selectSampleParts(records: PartSearchRecord[]): PartSearchRecord[] {
  return [...records].sort((left, right) => Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt) || left.part.mpn.localeCompare(right.part.mpn)).slice(0, 4);
}

function buildProviderSummary(records: PartSearchRecord[], source: CatalogDataSource, health: ApiHealth | null): { detail: string; label: string; tone: BadgeTone } {
  if (source === "seed_fallback") {
    return {
      detail: "Deterministic seed examples. Provider import health is not representative of production.",
      label: "Local seed",
      tone: "review"
    };
  }

  if (!health) {
    return {
      detail: "Catalog rows loaded, but the health endpoint was not reachable.",
      label: "Health unknown",
      tone: "review"
    };
  }

  const sources = records.flatMap((record) => record.sources);
  const providerCount = new Set(sources.map((sourceRecord) => sourceRecord.providerId)).size;
  const failedImports = sources.filter((sourceRecord) => sourceRecord.importStatus === "failed").length;
  const latestImport = sources.map((sourceRecord) => sourceRecord.sourceLastImportedAt).filter((value): value is string => Boolean(value)).sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

  return {
    detail: `${providerCount} provider identities on this page · ${failedImports} failed imports · ${latestImport ? `last import ${formatDateTime(latestImport)}` : "no import timestamps on page"}`,
    label: health.dependencies.database === "connected" ? "DB-backed" : `DB ${health.dependencies.database}`,
    tone: health.dependencies.database === "connected" && failedImports === 0 ? "verified" : "review"
  };
}

function catalogModeLabel(source: CatalogDataSource): string {
  return source === "seed_fallback" ? "Local seed mode" : "DB-backed catalog";
}

function catalogModeTone(source: CatalogDataSource): BadgeTone {
  return source === "seed_fallback" ? "review" : "verified";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function readSingleParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function readCadAvailability(value: string | undefined): CadAvailabilityFilter {
  if (value === "available" || value === "unavailable") {
    return value;
  }

  return "any";
}

function readSearchSort(value: string | undefined): PartSearchSort {
  if (value === "mpn_desc" || value === "updated_desc" || value === "trust_desc") {
    return value;
  }

  return "mpn_asc";
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
}

function readLifecycleStatus(value: string | undefined): LifecycleStatus | undefined {
  if (value === "active" || value === "not_recommended" || value === "obsolete" || value === "unknown") {
    return value;
  }

  return undefined;
}

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
 * Formats one filter option with a DB-backed count when the API supplied it.
 */
function formatFacetOptionLabel(label: string, count: number | undefined): string {
  return typeof count === "number" ? `${label} (${count})` : label;
}

function scoreTone(score: number): BadgeTone {
  if (score >= 0.8) {
    return "verified";
  }

  if (score >= 0.65) {
    return "review";
  }

  return "danger";
}

function buildFallbackPagination(totalRecords: number, filters: PartSearchFilters): SearchPagination {
  return {
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 20,
    sort: filters.sort ?? "mpn_asc",
    totalPages: Math.max(1, Math.ceil(totalRecords / (filters.pageSize ?? 20))),
    totalRecords
  };
}

function buildResultRange(pagination: SearchPagination, visibleCount: number): { end: number; start: number } {
  if (pagination.totalRecords === 0 || visibleCount === 0) {
    return { end: 0, start: 0 };
  }

  const start = (pagination.page - 1) * pagination.pageSize + 1;

  return {
    end: start + visibleCount - 1,
    start
  };
}

function buildSearchHref(filters: PartSearchFilters, page: number): string {
  const params = new URLSearchParams();

  appendHrefParam(params, "q", filters.query);
  appendHrefParam(params, "manufacturerId", filters.manufacturerId);
  appendHrefParam(params, "category", filters.category);
  appendHrefParam(params, "packageId", filters.packageId);
  appendHrefParam(params, "lifecycleStatus", filters.lifecycleStatus);
  appendHrefParam(params, "cad", filters.cadAvailability === "any" ? undefined : filters.cadAvailability);
  appendHrefParam(params, "sort", filters.sort && filters.sort !== "mpn_asc" ? filters.sort : undefined);
  appendHrefParam(params, "pageSize", filters.pageSize && filters.pageSize !== 20 ? filters.pageSize.toString() : undefined);
  appendHrefParam(params, "page", page > 1 ? page.toString() : undefined);

  const queryString = params.toString();

  return queryString ? `/?${queryString}` : "/";
}

function appendHrefParam(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value && value.trim().length > 0) {
    params.set(key, value);
  }
}
