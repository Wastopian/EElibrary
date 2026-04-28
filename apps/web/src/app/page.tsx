/**
 * File header: Implements the provider-neutral search page through the API boundary.
 */

import Link from "next/link";
import { EmptyState, StatusBadge, TrustMeter } from "@ee-library/ui";
import { isValidatedDownloadableAsset, normalizeExactMpn } from "@ee-library/shared";
import { fetchPartSearch, fetchSearchFacets, fetchSystemHealth } from "../lib/api-client";
import { ImportExactMpnCta } from "../components/ImportExactMpnCta";
import { WorkerStatusBanner } from "../components/WorkerStatusBanner";
import type { BadgeTone } from "@ee-library/ui";
import type { CadAvailabilityFilter, LifecycleStatus, PartSearchFilters } from "@ee-library/shared";

/** PageSearchParams mirrors the GET filters used by the search form. */
type PageSearchParams = {
  cad?: string | string[];
  category?: string | string[];
  manufacturerId?: string | string[];
  packageId?: string | string[];
  lifecycleStatus?: string | string[];
  q?: string | string[];
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
  const [facets, results, systemHealth] = await Promise.all([
    fetchSearchFacets(),
    fetchPartSearch(filters),
    fetchSystemHealth()
  ]);
  const exactMpn = normalizeExactMpn(query);
  const apiBaseUrl = process.env.EE_LIBRARY_API_BASE_URL ?? "http://127.0.0.1:4000";
  const isLocalDev = (process.env.LOCAL_DEV ?? "").toLowerCase() !== "false" && process.env.NODE_ENV !== "production";
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());

  return (
    <main className="search-layout">
      <WorkerStatusBanner apiBaseUrl={apiBaseUrl} databaseUrlConfigured={databaseUrlConfigured} health={systemHealth} isLocalDev={isLocalDev} />
      <section className="search-hero">
        <div>
          <p className="app-kicker">Phase 2 foundation</p>
          <h2>Search parts, inspect provenance, and keep export readiness honest.</h2>
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
              CAD files
              <select defaultValue={cadAvailability} name="cad">
                <option value="any">Any CAD state</option>
                <option value="available">Validated downloadable</option>
                <option value="unavailable">Needs validation</option>
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
            <StatusBadge label="Catalog API" tone="info" />
          </div>

          {results.length > 0 ? (
            <div className="results-list">
              {results.map((record) => {
                const exportableAssets = record.assets.filter(isValidatedDownloadableAsset);
                const assetLabel = exportableAssets.length > 0 ? `${exportableAssets.length} exportable` : "not exportable";

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
                    <div className="result-row__badges">
                      <StatusBadge label={record.part.lifecycleStatus} tone="info" />
                      <StatusBadge label={assetLabel} tone={exportableAssets.length > 0 ? "verified" : "review"} />
                    </div>
                    <TrustMeter label="Trust" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
                  </article>
                );
              })}
            </div>
          ) : exactMpn ? (
            <ImportExactMpnCta mpn={exactMpn} />
          ) : (
            <EmptyState body="Try a broader MPN, manufacturer, category, package, or CAD availability filter." title="No matching parts" />
          )}
        </section>
      </div>
    </main>
  );
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
