/**
 * File header: Implements the provider-neutral search page through the API boundary.
 */

import Link from "next/link";
import React from "react";
import { looksLikeConcreteProviderLookupQuery } from "@ee-library/shared";
import { EmptyState, StatusBadge, TrustMeter } from "@ee-library/ui";
import { CatalogResultsPresentation } from "../../components/CatalogResultsPresentation";
import { ImportByMpnPanel } from "../../components/ImportByMpnPanel";
import { fetchApiHealth, fetchPartSearchEnvelope, fetchSearchFacetsEnvelope, isApiClientError } from "../../lib/api-client";
import { getAssetTruthSummary, getConnectorWorkflowSummary, getPartNextActions, getQuickReadinessDataCoverage, getQuickReadinessSummary, getRecoveryWorkflowSummary, getSearchExportReadiness } from "../../lib/detail-view-model";
import { importUiCopy } from "../../lib/import-ui-copy";
import type { BadgeTone } from "@ee-library/ui";
import type { CadAvailabilityFilter, CatalogDataSource, ConnectorClass, LifecycleStatus, PartApprovalStatus, PartReadinessStatus, PartSearchFilters, PartSearchRecord, PartSearchSort, SearchFacets, SearchPagination } from "@ee-library/shared/types";
import type { ApiHealth } from "../../lib/api-client";

/** PageSearchParams mirrors the GET filters used by the search form. */
type PageSearchParams = {
  approvalStatus?: string | string[];
  cad?: string | string[];
  category?: string | string[];
  connectorClass?: string | string[];
  datasheetUrl?: string | string[];
  manufacturerId?: string | string[];
  packageId?: string | string[];
  lifecycleStatus?: string | string[];
  page?: string | string[];
  pageSize?: string | string[];
  providerPartId?: string | string[];
  providerUrl?: string | string[];
  q?: string | string[];
  readinessStatus?: string | string[];
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

/** NoMatchProviderLookupState keeps no-match intake honest and limited to direct exact-MPN import, not live search. */
type NoMatchProviderLookupState =
  | { status: "available"; initialQuery: string; refreshHref: string }
  | { status: "unavailable"; reason: string };

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
  const providerPartId = readSingleParam(resolvedSearchParams?.providerPartId);
  const providerUrl = readSingleParam(resolvedSearchParams?.providerUrl);
  const datasheetUrl = readSingleParam(resolvedSearchParams?.datasheetUrl);
  const manufacturerId = readSingleParam(resolvedSearchParams?.manufacturerId);
  const category = readSingleParam(resolvedSearchParams?.category);
  const packageId = readSingleParam(resolvedSearchParams?.packageId);
  const lifecycleStatus = readLifecycleStatus(readSingleParam(resolvedSearchParams?.lifecycleStatus));
  const cadAvailability = readCadAvailability(readSingleParam(resolvedSearchParams?.cad));
  const readinessStatus = readReadinessStatus(readSingleParam(resolvedSearchParams?.readinessStatus));
  const approvalStatus = readApprovalStatus(readSingleParam(resolvedSearchParams?.approvalStatus));
  const connectorClass = readConnectorClass(readSingleParam(resolvedSearchParams?.connectorClass));
  const page = readPositiveInteger(readSingleParam(resolvedSearchParams?.page));
  const pageSize = readPositiveInteger(readSingleParam(resolvedSearchParams?.pageSize));
  const sort = readSearchSort(readSingleParam(resolvedSearchParams?.sort));
  const filters: PartSearchFilters = {
    approvalStatus,
    cadAvailability,
    category,
    connectorClass,
    datasheetUrl,
    lifecycleStatus,
    manufacturerId,
    packageId,
    page,
    pageSize,
    providerPartId,
    providerUrl,
    query,
    readinessStatus,
    sort
  };
  const catalogState = await loadHomepageCatalog(filters);

  if (catalogState.status === "setup_required") {
    return <HomepageSetupState catalogState={catalogState} />;
  }

  const { facets, health, pagination, results, source, warnings } = catalogState;
  const catalogStats = buildCatalogStats(results, pagination.totalRecords);
  const providerSummary = buildProviderSummary(results, source, health);
  const resultRange = buildResultRange(pagination, results.length);
  const quickLookupState = buildQuickLookupState(buildLookupValue(query, providerPartId, providerUrl, datasheetUrl), results, pagination);
  const noMatchProviderLookup = buildNoMatchProviderLookup(query, source, buildSearchHref(filters, 1));
  const catalogResultRows = buildCatalogResultRows(results);
  const activeFilterPills = buildActiveFilterPills({
    approvalStatus,
    cadAvailability,
    category,
    connectorClass,
    datasheetUrl,
    facets,
    lifecycleStatus,
    manufacturerId,
    packageId,
    providerPartId,
    providerUrl,
    query,
    readinessStatus,
    sort
  });

  return (
    <main>
      <section aria-label="Catalog workbench search" className="quick-check-workspace catalog-workbench-hero" id="quick-check">
        <div className="quick-check-workspace__layout">
          <div className="hero-editorial__inner quick-check-workspace__main">
            <h1>Catalog workbench</h1>
            <p className="hero-lede">Paste an MPN, scan the matching parts table, or import an exact MPN from configured providers.</p>

            <form className="quick-check-form" action="/catalog" method="get">
              <input name="manufacturerId" type="hidden" value={manufacturerId} />
              <input name="category" type="hidden" value={category} />
              <input name="packageId" type="hidden" value={packageId} />
              <input name="lifecycleStatus" type="hidden" value={lifecycleStatus} />
              <input name="cad" type="hidden" value={cadAvailability} />
              <input name="readinessStatus" type="hidden" value={readinessStatus} />
              <input name="approvalStatus" type="hidden" value={approvalStatus} />
              <input name="connectorClass" type="hidden" value={connectorClass} />
              <input name="sort" type="hidden" value={sort} />
              <label className="quick-check-form__field" htmlFor="q">
                <span>MPN, manufacturer, provider id, or keyword</span>
                <input defaultValue={query} id="q" name="q" placeholder="TPS7A02DBVR, STM32G031K8T6, GRM188R71C104KA01D..." />
              </label>
              <details className="quick-check-form__advanced" open={!!(providerPartId || providerUrl || datasheetUrl)}>
                <summary className="quick-check-form__advanced-toggle">Provider or datasheet lookup context</summary>
                <div className="quick-check-form__advanced-fields">
                  <label className="quick-check-form__field quick-check-form__field--provider-ref" htmlFor="provider-part-reference">
                    <span>Provider part reference</span>
                    <input defaultValue={providerPartId} id="provider-part-reference" name="providerPartId" placeholder="LCSC code or provider part id" />
                  </label>
                  <label className="quick-check-form__field quick-check-form__field--provider-url" htmlFor="provider-url">
                    <span>Provider URL</span>
                    <input defaultValue={providerUrl} id="provider-url" name="providerUrl" placeholder="Provider product URL" />
                  </label>
                  <label className="quick-check-form__field quick-check-form__field--datasheet">
                    <span>Datasheet URL</span>
                    <input defaultValue={datasheetUrl} name="datasheetUrl" placeholder="Datasheet URL for existing records" />
                  </label>
                </div>
              </details>
              <div className="quick-check-form__actions">
                <button type="submit">Check Part</button>
                {query || providerPartId || providerUrl || datasheetUrl ? (
                  <Link className="button-link button-link--quiet quick-check-form__clear" href="/catalog">
                    Clear
                  </Link>
                ) : null}
              </div>
            </form>

            <p className="quick-check-hint">
              Try <Link href="/catalog?q=0430250200">0430250200</Link> / <Link href="/catalog?q=STM32F411CEU6">STM32F411CEU6</Link> / <Link href="/catalog?q=TPS7A02DBVR">TPS7A02DBVR</Link>
            </p>

            {warnings.length > 0 ? <p className="mode-warning">{warnings.join(" ")}</p> : null}
            {source === "seed_fallback" ? (
              <p className="mode-warning">Local seed mode — not DB-backed catalog data.</p>
            ) : null}

            <QuickLookupPanel noMatchProviderLookup={noMatchProviderLookup} state={quickLookupState} />

            <details className="catalog-import-drawer" id="import-by-mpn">
              <summary>Import by MPN from configured providers</summary>
              <ImportByMpnPanel />
            </details>

          </div>
          <HomepageWorkspaceRail catalogStats={catalogStats} providerSummary={providerSummary} source={source} />
        </div>
      </section>

      <div className="search-workspace">
        <aside className="filter-rail filter-rail--bar" aria-label="Search filters">
          <form action="/catalog" method="get">
            <div className="filter-rail__intro">
              <p className="app-kicker">Filters</p>
              <strong>Refine results</strong>
            </div>
            <input name="q" type="hidden" value={query} />
            <input name="providerPartId" type="hidden" value={providerPartId} />
            <input name="providerUrl" type="hidden" value={providerUrl} />
            <input name="datasheetUrl" type="hidden" value={datasheetUrl} />
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
              Readiness
              <select defaultValue={readinessStatus} name="readinessStatus">
                <option value="">All readiness states</option>
                {facets.readinessStatuses.map((status) => (
                  <option key={status} value={status}>
                    {formatFacetOptionLabel(formatReadinessStatus(status), facets.counts?.readinessStatuses[status])}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Approval
              <select defaultValue={approvalStatus} name="approvalStatus">
                <option value="">All approval states</option>
                {facets.approvalStatuses.map((status) => (
                  <option key={status} value={status}>
                    {formatFacetOptionLabel(formatApprovalStatus(status), facets.counts?.approvalStatuses[status])}
                  </option>
                ))}
              </select>
            </label>
            {facets.connectorClasses.length > 0 ? (
              <label>
                Connector class
                <select defaultValue={connectorClass} name="connectorClass">
                  <option value="">All connector classes</option>
                  {facets.connectorClasses.map((status) => (
                    <option key={status} value={status}>
                      {formatFacetOptionLabel(formatConnectorClass(status), facets.counts?.connectorClasses[status])}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Sort
              <select defaultValue={sort} name="sort">
                <option value="mpn_asc">MPN A-Z</option>
                <option value="mpn_desc">MPN Z-A</option>
                <option value="updated_desc">Recently updated</option>
                <option value="trust_desc">Trust score</option>
              </select>
            </label>
            <div className="filter-rail__actions">
              <button type="submit">Apply filters</button>
              {activeFilterPills.length > 0 ? (
                <Link className="filter-rail__clear" href="/catalog">
                  Clear all
                </Link>
              ) : null}
            </div>
          </form>
        </aside>

        <section className="results-panel" aria-label="Search results" id="catalog-results">
          <div className="results-panel__header">
            <div>
              <p className="app-kicker">Results</p>
              <h2>{pagination.totalRecords} matches</h2>
              <p className="results-panel__range">
                Rows {resultRange.start}-{resultRange.end} / page {pagination.page} of {pagination.totalPages}
              </p>
              <p className="results-panel__lede">Each row summarizes identity, top blocker, asset truth, and export gate before you open the full readiness record.</p>
            </div>
            <StatusBadge label={catalogModeLabel(source)} tone={catalogModeTone(source)} />
          </div>
          {activeFilterPills.length > 0 ? (
            <div className="results-filter-summary" aria-label="Active filters">
              <span>Current filters</span>
              <div className="results-filter-summary__pills">
                {activeFilterPills.map((pill) => (
                  <StatusBadge key={pill} label={pill} tone="neutral" />
                ))}
              </div>
            </div>
          ) : null}

          {results.length > 0 ? (
            <CatalogResultsPresentation initialMode="table" rows={catalogResultRows} />
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
 * Renders the compact homepage rail so engineers can see catalog scope and trust boundaries before scrolling.
 */
function HomepageWorkspaceRail({
  catalogStats,
  providerSummary,
  source
}: {
  catalogStats: ReturnType<typeof buildCatalogStats>;
  providerSummary: { detail: string; label: string; tone: BadgeTone };
  source: CatalogDataSource;
}) {
  return (
    <aside aria-label="Homepage workspace context" className="quick-check-rail">
      <section className="quick-check-rail__card">
        <p className="app-kicker">Catalog snapshot</p>
        <div className="quick-check-rail__badges">
          <StatusBadge label={catalogModeLabel(source)} tone={catalogModeTone(source)} />
          <StatusBadge label={providerSummary.label} tone={providerSummary.tone} />
        </div>
        <div className="quick-check-rail__metrics">
          <div>
            <span>Matches</span>
            <strong>{catalogStats.totalMatches}</strong>
          </div>
          <div>
            <span>Verified CAD</span>
            <strong>{catalogStats.verifiedCadRecords}</strong>
          </div>
          <div>
            <span>Connectors</span>
            <strong>{catalogStats.connectorRecords}</strong>
          </div>
          <div>
            <span>Generation workflows</span>
            <strong>{catalogStats.generationWorkflowCount}</strong>
          </div>
        </div>
      </section>

      <section className="quick-check-rail__card">
        <p className="app-kicker">Catalog health</p>
        <strong>{providerSummary.label}</strong>
        <p>{providerSummary.detail}</p>
      </section>

      <section className="quick-check-rail__card">
        <p className="app-kicker">Engineer workflow</p>
        <strong>Use quick check for triage, detail for decisions, and admin for follow-up.</strong>
        <p>Export remains gated by verified file-backed CAD, and connector ambiguity stays visible instead of getting polished away.</p>
        <div className="quick-check-rail__links">
          <Link href="/catalog?approvalStatus=pending_review">Pending approval</Link>
          <Link href="/catalog?cad=unavailable">Missing CAD</Link>
          <Link href="/admin">Open admin queue</Link>
        </div>
      </section>
    </aside>
  );
}

/**
 * Renders the explicit quick lookup state before any detailed readiness answer.
 */
function QuickLookupPanel({ noMatchProviderLookup, state }: { noMatchProviderLookup: NoMatchProviderLookupState; state: QuickLookupState }) {
  if (state.status === "idle") {
    return (
      <div className="quick-check-empty quick-check-empty--idle" role="status">
        <strong>Search the readiness record</strong>
        <p>Enter a part number to see confirmed identity, visible blockers, and whether export still lacks file-backed assets.</p>
      </div>
    );
  }

  if (state.status === "no_match") {
    return <NoMatchProviderLookup lookup={state.query} providerLookup={noMatchProviderLookup} />;
  }

  if (state.status === "ambiguous") {
    return <QuickAmbiguousResult records={state.records} totalRecords={state.totalRecords} query={state.query} />;
  }

  return <QuickReadinessResult record={state.record} />;
}

/**
 * Renders direct exact-MPN import from a no-match state without pretending the site is doing live global search.
 */
function NoMatchProviderLookup({ lookup, providerLookup }: { lookup: string; providerLookup: NoMatchProviderLookupState }) {
  return (
    <div className="quick-check-empty quick-check-empty--acquisition" role="status">
      <strong>Part not found</strong>
      <p>
        No catalog records matched <span className="ui-mono">{lookup}</span>. The UI will not create a readiness answer without backend data.
      </p>
      {providerLookup.status === "available" ? (
        <ImportByMpnPanel
          autoRedirectOnSuccess
          compact
          initialMpn={providerLookup.initialQuery}
          refreshHref={providerLookup.refreshHref}
        />
      ) : (
        <p className="quick-check-empty__note">
          <strong>{importUiCopy.unavailableLead}</strong> {providerLookup.reason}
        </p>
      )}
    </div>
  );
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
  const warningRows = buildQuickResultWarnings(record, summary, dataCoverage, exportReadiness, assetTruth, connectorHint ?? recoveryStatus);
  const readinessCounts = summarizeQuickChecks(summary.checks);
  const identityLabel = record.sources.length > 0 ? "Identity confirmed" : "Single catalog match";
  const sourceRowLabel = `${record.sources.length} source row${record.sources.length === 1 ? "" : "s"}`;

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
        <div className="quick-readiness-result__trust">
          <TrustMeter label="Trust" score={record.part.trustScore} tone={scoreTone(record.part.trustScore)} />
          <p>{readinessCounts.passCount} pass / {readinessCounts.attentionCount} attention</p>
        </div>
        <TrustScoreBreakdown record={record} />
      </div>

      <div className="quick-readiness-result__identity">
        <span className="ui-mono">{record.part.mpn}</span>
        <span>{record.manufacturer.name}</span>
        <span>
          {record.part.category} / {record.package.packageName}
        </span>
        <StatusBadge label={identityLabel} tone="verified" />
        <StatusBadge label={sourceRowLabel} tone="neutral" />
        <StatusBadge label={formatLifecycleShort(record.part.lifecycleStatus)} tone="neutral" />
        <StatusBadge label={dataCoverage.label} tone={mapViewTone(dataCoverage.tone)} />
        <Link className="button-link" href={`/parts/${record.part.id}`}>
          Open Full Record
        </Link>
      </div>

      <details className="quick-readiness-details">
        <summary>Readiness details</summary>
        <div className="quick-readiness-grid">
          <section className="quick-readiness-card">
            <div className="quick-readiness-card__header">
              <span>Readiness Checks</span>
              <span>
                {readinessCounts.passCount} pass / {readinessCounts.attentionCount} attention
              </span>
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
              <span>{summary.actions.length > 0 ? `${summary.actions.length} derived` : "none"}</span>
            </div>
            {summary.actions.length > 0 ? (
              summary.actions.map((action) => (
                <div className="quick-action-row" key={action.label}>
                  <span className={`quick-action-row__priority quick-action-row__priority--${action.priority}`}>{action.priority}</span>
                  <p>{action.label}</p>
                </div>
              ))
            ) : (
              <EmptyActionsMessage dataCoverage={dataCoverage} exportReadiness={exportReadiness} record={record} />
            )}
          </section>

          {connectorHint ? (
            <QuickConnectorPreviewCard assetTruth={assetTruth} dataCoverage={dataCoverage} record={record} />
          ) : (
            <section className="quick-readiness-card">
              <div className="quick-readiness-card__header">
                <span>Missing-CAD Recovery</span>
                <StatusBadge label={recoveryStatus.label} tone={mapViewTone(recoveryStatus.tone)} />
              </div>
              <p>{recoveryStatus.detail}</p>
              <div className="quick-readiness-card__footer">
                <StatusBadge label={assetTruth.label} tone={mapViewTone(assetTruth.tone)} />
                <p>{dataCoverage.detail}</p>
              </div>
            </section>
          )}
        </div>

        {warningRows.length > 0 ? (
          <section aria-label="Quick readiness warnings" className="quick-warning-strip">
            {warningRows.map((warning) => (
              <div className="quick-warning-strip__row" key={warning.label}>
                <span className={`quick-warning-strip__icon quick-warning-strip__icon--${warning.tone}`}>{warning.tone === "info" ? "i" : "!"}</span>
                <div>
                  <strong>{warning.label}</strong>
                  <p>{warning.detail}</p>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <div className="quick-actions-row quick-actions-row--result">
          <Link className="button-link" href={`/parts/${record.part.id}`}>
            Open Full Record
          </Link>
          <Link className="button-link button-link--quiet" href="/admin">
            View in Queue
          </Link>
          <Link className="button-link button-link--quiet" href="/catalog">
            Check Another Part
          </Link>
        </div>
      </details>
    </section>
  );
}

/**
 * Renders a compact connector mate preview when connector intelligence exists for the result record.
 */
function QuickConnectorPreviewCard({
  assetTruth,
  dataCoverage,
  record
}: {
  assetTruth: ReturnType<typeof getAssetTruthSummary>;
  dataCoverage: ReturnType<typeof getQuickReadinessDataCoverage>;
  record: PartSearchRecord;
}) {
  const bestMate = record.buildableMatingSet.bestMate;
  const alternateMates = record.buildableMatingSet.alternateMates;
  const requiredAccessories = record.buildableMatingSet.requiredAccessories;
  const cableOptions = record.buildableMatingSet.cableOptions;
  const cableAssumptions = record.buildableMatingSet.cableAssumptions;

  return (
    <section className="quick-readiness-card">
      <div className="quick-readiness-card__header">
        <span>Mating Parts</span>
        <span>
          {(bestMate ? 1 : 0) + alternateMates.length + requiredAccessories.length} mapped
        </span>
      </div>
      <div className="quick-mates-preview">
        <div className="quick-mates-preview__item">
          <strong>Best mate</strong>
          <span className="ui-mono">{bestMate ? bestMate.matePartId : "No best mate stored"}</span>
          <p>{bestMate ? `${Math.round(bestMate.confidenceScore * 100)}% confidence` : "Connector metadata exists, but no prioritized mate is stored yet."}</p>
        </div>
        <div className="quick-mates-preview__item">
          <strong>Alternate mates</strong>
          <span>{alternateMates.length > 0 ? alternateMates.length : "None mapped"}</span>
          <p>{alternateMates.length > 0 ? alternateMates.map((item) => item.matePartId).join(", ") : "No alternate mate rows are attached yet."}</p>
        </div>
        <div className="quick-mates-preview__item">
          <strong>Required accessories</strong>
          <span>{requiredAccessories.length > 0 ? requiredAccessories.length : "None mapped"}</span>
          <p>{requiredAccessories.length > 0 ? requiredAccessories.map((item) => item.accessoryPartId).join(", ") : "No accessory rows are attached yet."}</p>
        </div>
        <div className="quick-mates-preview__item">
          <strong>Cable options</strong>
          <span>{cableOptions.length > 0 ? cableOptions.length : "None mapped"}</span>
          <p>
            {cableOptions.length > 0
              ? `${cableOptions.map((item) => item.cablePartId).join(", ")}${cableAssumptions.length > 0 ? ` (${cableAssumptions.length} note-derived assumptions)` : ""}`
              : "No cable compatibility rows are attached yet."}
          </p>
        </div>
      </div>
      <div className="quick-readiness-card__footer">
        <StatusBadge label={assetTruth.label} tone={mapViewTone(assetTruth.tone)} />
        <p>{dataCoverage.detail}</p>
      </div>
    </section>
  );
}

/**
 * Renders a contextual empty state for the Next Actions card based on actual record state.
 */
function EmptyActionsMessage({
  dataCoverage,
  exportReadiness,
  record
}: {
  dataCoverage: ReturnType<typeof getQuickReadinessDataCoverage>;
  exportReadiness: ReturnType<typeof getSearchExportReadiness>;
  record: PartSearchRecord;
}) {
  if (dataCoverage.partial) {
    return (
      <div className="quick-actions-empty quick-actions-empty--partial">
        <p>Readiness data is incomplete — actions could not be fully derived. Open the full record to assess what is missing.</p>
      </div>
    );
  }

  if (record.readinessSummary.status === "ready_for_export_review" && exportReadiness.tone === "verified") {
    return (
      <div className="quick-actions-empty quick-actions-empty--ready">
        <p>No blocking actions. This part has verified file-backed CAD and is ready for export review.</p>
        <Link className="button-link button-link--quiet quick-actions-empty__link" href={`/parts/${record.part.id}`}>
          Open full record to promote
        </Link>
      </div>
    );
  }

  return (
    <div className="quick-actions-empty">
      <p>No specific actions were identified from the current catalog record. Open the full record for a complete assessment.</p>
      <Link className="button-link button-link--quiet quick-actions-empty__link" href={`/parts/${record.part.id}`}>
        Open full record
      </Link>
    </div>
  );
}

/**
 * Summarizes pass-vs-attention counts without inventing any new readiness scoring.
 */
function summarizeQuickChecks(checks: ReturnType<typeof getQuickReadinessSummary>["checks"]) {
  const passCount = checks.filter((check) => check.tone === "verified" || check.tone === "info").length;
  const attentionCount = checks.length - passCount;

  return { attentionCount, passCount };
}

/**
 * Builds concise risk and trust-boundary rows from real quick-check signals only.
 */
function buildQuickResultWarnings(
  record: PartSearchRecord,
  summary: ReturnType<typeof getQuickReadinessSummary>,
  dataCoverage: ReturnType<typeof getQuickReadinessDataCoverage>,
  exportReadiness: ReturnType<typeof getSearchExportReadiness>,
  assetTruth: ReturnType<typeof getAssetTruthSummary>,
  workflowSignal: NonNullable<ReturnType<typeof getConnectorWorkflowSummary>> | ReturnType<typeof getRecoveryWorkflowSummary>
) {
  const warnings: Array<{ detail: string; label: string; tone: "info" | "warn" }> = [];

  // Only warn about partial readiness data — it affects whether the quick summary can be trusted at all.
  if (dataCoverage.partial) {
    warnings.push({
      detail: dataCoverage.detail,
      label: "Partial readiness data",
      tone: "info"
    });
  }

  // Lifecycle warnings fire only for genuinely risky states, not for the common "active" baseline.
  if (record.part.lifecycleStatus === "obsolete") {
    warnings.push({
      detail: "This part is obsolete. Do not use in new designs — source an active replacement.",
      label: "Part obsolete",
      tone: "warn"
    });
  } else if (record.part.lifecycleStatus === "not_recommended") {
    warnings.push({
      detail: "Manufacturer does not recommend this part for new designs.",
      label: "Not recommended for new designs",
      tone: "warn"
    });
  }

  // Connector review warnings only fire when there is a specific unresolved problem, not on every non-verified state.
  if (workflowSignal.tone === "danger") {
    warnings.push({
      detail: workflowSignal.detail,
      label: "Connector mapping blocked",
      tone: "warn"
    });
  } else if (workflowSignal.tone === "review" && record.buildableMatingSet.warningDetails.length > 0 && summary.actions.length > 0) {
    warnings.push({
      detail: workflowSignal.detail,
      label: "Connector review needed",
      tone: "info"
    });
  }

  return warnings;
}

/**
 * Renders an expandable trust score breakdown using the record signals already on the page.
 */
function TrustScoreBreakdown({ record }: { record: PartSearchRecord }) {
  const factors = buildTrustScoreBreakdown(record);

  return (
    <details className="trust-breakdown">
      <summary className="trust-breakdown__toggle">Score breakdown</summary>
      <div className="trust-breakdown__factors">
        {factors.map((factor) => (
          <div className="trust-breakdown__row" key={factor.label}>
            <StatusBadge label={factor.label} tone={mapViewTone(factor.tone)} />
            <p>{factor.detail}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * Derives trust score factor rows from the signals already present in the search record.
 * The overall score comes from the backend — these factors explain what the backend is likely weighing.
 */
function buildTrustScoreBreakdown(record: PartSearchRecord): Array<{ label: string; detail: string; tone: BadgeTone }> {
  const factors: Array<{ label: string; detail: string; tone: BadgeTone }> = [];

  const sourceCount = record.sources.length;
  factors.push({
    label: `${sourceCount} provider ${sourceCount === 1 ? "source" : "sources"}`,
    detail: sourceCount > 0 ? "Provider identity and import history confirmed." : "No provider source records attached.",
    tone: sourceCount > 0 ? "verified" : "review"
  });

  const metricCount = record.metrics.length;
  factors.push({
    label: `${metricCount} normalized ${metricCount === 1 ? "metric" : "metrics"}`,
    detail: metricCount > 2 ? "Specification data extracted and normalized." : metricCount > 0 ? "Partial spec data recorded." : "No normalized specs recorded.",
    tone: metricCount > 2 ? "verified" : metricCount > 0 ? "info" : "neutral"
  });

  if (record.datasheetRevision) {
    const parseConfidence = record.datasheetRevision.parseConfidence;
    const pages = record.datasheetRevision.pageCount;
    factors.push({
      label: `Datasheet parsed — ${Math.round(parseConfidence * 100)}% confidence`,
      detail: `Revision ${record.datasheetRevision.revisionLabel}${pages ? `, ${pages} pages` : ""}.`,
      tone: parseConfidence >= 0.8 ? "verified" : parseConfidence >= 0.5 ? "info" : "review"
    });
  } else {
    factors.push({
      label: "No datasheet revision",
      detail: "Datasheet metadata has not been parsed for this record.",
      tone: "neutral"
    });
  }

  const cadAssets = record.assets.filter((asset) => asset.assetType === "footprint" || asset.assetType === "symbol" || asset.assetType === "three_d_model");
  const verifiedCadCount = cadAssets.filter((asset) => asset.exportStatus === "verified_for_export").length;
  const totalCadCount = cadAssets.length;
  factors.push({
    detail: verifiedCadCount > 0 ? "File-backed verified assets count toward export readiness." : totalCadCount > 0 ? "CAD exists but is not yet verified for export." : "No CAD assets are attached to this record.",
    label: verifiedCadCount > 0 ? `${verifiedCadCount} of ${totalCadCount} CAD verified` : totalCadCount > 0 ? `${totalCadCount} CAD unverified` : "No CAD assets",
    tone: verifiedCadCount > 0 ? "verified" : totalCadCount > 0 ? "review" : "neutral"
  });

  if (record.buildableMatingSet.confidenceScore !== null) {
    const score = record.buildableMatingSet.confidenceScore;
    factors.push({
      detail: score >= 0.8 ? "High-confidence connector mapping is recorded." : score >= 0.5 ? "Moderate connector confidence — review mate details." : "Low connector confidence — check warnings before layout.",
      label: `${Math.round(score * 100)}% connector confidence`,
      tone: score >= 0.8 ? "verified" : score >= 0.5 ? "info" : "review"
    });
  }

  return factors;
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

/**
 * Builds a no-match provider lookup state from the main MPN field only, never from live provider search.
 */
function buildNoMatchProviderLookup(query: string | undefined, source: CatalogDataSource, refreshHref: string): NoMatchProviderLookupState {
  const normalizedQuery = query?.trim() ?? "";

  if (source !== "database") {
    return {
      reason: importUiCopy.catalogAcquisitionUnavailableSeed,
      status: "unavailable"
    };
  }

  if (!looksLikeProviderLookupQuery(normalizedQuery)) {
    return {
      reason: importUiCopy.catalogAcquisitionUnavailableLookup,
      status: "unavailable"
    };
  }

  return {
    initialQuery: normalizedQuery,
    refreshHref,
    status: "available"
  };
}

/**
 * Uses a conservative MPN-style heuristic so no-match provider lookup stays scoped to concrete part lookups.
 */
function looksLikeProviderLookupQuery(query: string): boolean {
  return looksLikeConcreteProviderLookupQuery(query);
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
          <p className="mode-warning">{importUiCopy.catalogAcquisitionUnavailableSetup}</p>
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
    detail: `${providerCount} provider identities on this page / ${failedImports} failed imports / ${latestImport ? `last import ${formatDateTime(latestImport)}` : "no import timestamps on page"}`,
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

function readReadinessStatus(value: string | undefined): PartReadinessStatus | undefined {
  if (value === "ready_for_export_review" || value === "needs_attention" || value === "blocked" || value === "unknown") {
    return value;
  }

  return undefined;
}

function readApprovalStatus(value: string | undefined): PartApprovalStatus | undefined {
  if (value === "approved" || value === "pending_review" || value === "not_requested" || value === "not_applicable") {
    return value;
  }

  return undefined;
}

function readConnectorClass(value: string | undefined): ConnectorClass | undefined {
  if (value === "connector" || value === "accessory" || value === "tooling" || value === "cable" || value === "non_connector") {
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

function formatReadinessStatus(status: PartReadinessStatus): string {
  return {
    blocked: "Blocked",
    needs_attention: "Needs attention",
    ready_for_export_review: "Ready for export review",
    unknown: "Unknown"
  }[status];
}

function formatApprovalStatus(status: PartApprovalStatus): string {
  return {
    approved: "Approved",
    not_applicable: "Not applicable",
    not_requested: "Not requested",
    pending_review: "Pending review"
  }[status];
}

function formatConnectorClass(status: ConnectorClass): string {
  return {
    accessory: "Accessory",
    cable: "Cable",
    connector: "Connector",
    non_connector: "Non-connector",
    tooling: "Tooling"
  }[status];
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

function approvalTone(status: PartApprovalStatus): BadgeTone {
  const tones: Record<PartApprovalStatus, BadgeTone> = {
    approved: "verified",
    not_applicable: "neutral",
    not_requested: "review",
    pending_review: "info"
  };

  return tones[status];
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
  appendHrefParam(params, "providerPartId", filters.providerPartId);
  appendHrefParam(params, "providerUrl", filters.providerUrl);
  appendHrefParam(params, "datasheetUrl", filters.datasheetUrl);
  appendHrefParam(params, "manufacturerId", filters.manufacturerId);
  appendHrefParam(params, "category", filters.category);
  appendHrefParam(params, "packageId", filters.packageId);
  appendHrefParam(params, "lifecycleStatus", filters.lifecycleStatus);
  appendHrefParam(params, "readinessStatus", filters.readinessStatus);
  appendHrefParam(params, "approvalStatus", filters.approvalStatus);
  appendHrefParam(params, "connectorClass", filters.connectorClass);
  appendHrefParam(params, "cad", filters.cadAvailability === "any" ? undefined : filters.cadAvailability);
  appendHrefParam(params, "sort", filters.sort && filters.sort !== "mpn_asc" ? filters.sort : undefined);
  appendHrefParam(params, "pageSize", filters.pageSize && filters.pageSize !== 20 ? filters.pageSize.toString() : undefined);
  appendHrefParam(params, "page", page > 1 ? page.toString() : undefined);

  const queryString = params.toString();

  return queryString ? `/catalog?${queryString}` : "/catalog";
}

/**
 * Builds presentation rows for the list/table catalog results view without leaking backend shapes.
 */
function buildCatalogResultRows(records: PartSearchRecord[]) {
  return records.map((record) => {
    const exportReadiness = getSearchExportReadiness(record);
    const assetTruth = getAssetTruthSummary(record);
    const connectorHint = getConnectorWorkflowSummary(record);
    const recoveryStatus = getRecoveryWorkflowSummary(record);
    const datasheetStatus = buildDatasheetStatus(record);
    const nextAction = buildCatalogNextAction(record);
    const topBlocker = record.readinessSummary.blockerSummary[0] ?? record.readinessSummary.recommendedActions[0] ?? "No immediate blocker derived from this record.";
    const riskLabel = record.riskFlags[0]?.label ? "Risk flag" : "Top blocker";

    return {
      approvalDetail: record.approval.detail,
      approvalLabel: record.approval.summary,
      approvalTone: approvalTone(record.approval.status),
      assetTruthDetail: assetTruth.detail,
      assetTruthLabel: assetTruth.label,
      cadExportLabel: exportReadiness.label,
      cadExportTone: exportReadiness.tone,
      category: record.part.category,
      description: record.part.description,
      connectorSignalDetail: connectorHint?.detail ?? recoveryStatus.detail,
      connectorSignalLabel: connectorHint?.label ?? recoveryStatus.label,
      connectorSignalTitle: connectorHint ? "Connector intelligence" : "Recovery",
      connectorTitle: record.connectorFamily?.name ?? "General component",
      datasheetLabel: datasheetStatus.label,
      datasheetTone: datasheetStatus.tone,
      exportLabel: exportReadiness.label,
      exportTone: exportReadiness.tone,
      href: `/parts/${record.part.id}`,
      id: record.part.id,
      lifecycleLabel: formatLifecycleShort(record.part.lifecycleStatus),
      manufacturerName: record.manufacturer.name,
      mpn: record.part.mpn,
      nextActionDetail: nextAction.detail,
      nextActionLabel: nextAction.label,
      packageName: record.package.packageName,
      readinessDetail: record.readinessSummary.detail,
      readinessHeadline: record.readinessSummary.label,
      readinessSubhead:
        record.readinessSummary.blockerCount > 0
          ? `${record.readinessSummary.blockerCount} ${record.readinessSummary.blockerCount === 1 ? "blocker" : "blockers"} recorded.`
          : record.approval.summary,
      riskLabel,
      topBlocker,
      trustScore: record.part.trustScore,
      trustTone: scoreTone(record.part.trustScore)
    };
  });
}

/**
 * Builds a compact datasheet state for catalog-table scanning without implying a local file exists.
 */
function buildDatasheetStatus(record: PartSearchRecord): { label: string; tone: BadgeTone } {
  if (!record.datasheetRevision) {
    return { label: "Missing", tone: "review" };
  }

  const datasheetAsset = record.datasheetRevision.fileAssetId
    ? record.assets.find((asset) => asset.id === record.datasheetRevision?.fileAssetId)
    : undefined;

  if (datasheetAsset?.storageKey) {
    return { label: "File stored", tone: "verified" };
  }

  if (datasheetAsset?.sourceUrl) {
    return { label: "Reference", tone: "info" };
  }

  return { label: "Metadata only", tone: "neutral" };
}

/**
 * Chooses one next action for the catalog table while leaving deeper workflow details to the part page.
 */
function buildCatalogNextAction(record: PartSearchRecord): { detail: string; label: string } {
  const action = getPartNextActions(record)[0];

  if (action) {
    return {
      detail: action.detail,
      label: action.label
    };
  }

  if (record.readinessSummary.recommendedActions[0]) {
    return {
      detail: record.readinessSummary.detail,
      label: record.readinessSummary.recommendedActions[0]
    };
  }

  return {
    detail: "Open the detail page to inspect provenance, datasheet, and asset evidence.",
    label: "Open detail"
  };
}

/**
 * Builds concise active-filter labels so engineers can see the current query context at a glance.
 */
function buildActiveFilterPills({
  approvalStatus,
  cadAvailability,
  category,
  connectorClass,
  datasheetUrl,
  facets,
  lifecycleStatus,
  manufacturerId,
  packageId,
  providerPartId,
  providerUrl,
  query,
  readinessStatus,
  sort
}: {
  approvalStatus: PartApprovalStatus | undefined;
  cadAvailability: CadAvailabilityFilter;
  category: string | undefined;
  connectorClass: ConnectorClass | undefined;
  datasheetUrl: string | undefined;
  facets: SearchFacets;
  lifecycleStatus: LifecycleStatus | undefined;
  manufacturerId: string | undefined;
  packageId: string | undefined;
  providerPartId: string | undefined;
  providerUrl: string | undefined;
  query: string | undefined;
  readinessStatus: PartReadinessStatus | undefined;
  sort: PartSearchSort;
}) {
  const pills: string[] = [];
  const manufacturerName = manufacturerId ? facets.manufacturers.find((manufacturer) => manufacturer.id === manufacturerId)?.name : undefined;
  const packageName = packageId ? facets.packages.find((partPackage) => partPackage.id === packageId)?.packageName : undefined;

  if (query && query.trim().length > 0) {
    pills.push(`Query: ${query}`);
  }

  if (providerPartId && providerPartId.trim().length > 0) {
    pills.push(`Provider ref: ${providerPartId}`);
  }

  if (providerUrl && providerUrl.trim().length > 0) {
    pills.push("Provider URL lookup");
  }

  if (datasheetUrl && datasheetUrl.trim().length > 0) {
    pills.push("Datasheet URL lookup");
  }

  if (manufacturerName) {
    pills.push(`Manufacturer: ${manufacturerName}`);
  }

  if (category) {
    pills.push(`Category: ${category}`);
  }

  if (packageName) {
    pills.push(`Package: ${packageName}`);
  }

  if (lifecycleStatus) {
    pills.push(`Lifecycle: ${formatLifecycleStatus(lifecycleStatus)}`);
  }

  if (readinessStatus) {
    pills.push(`Readiness: ${formatReadinessStatus(readinessStatus)}`);
  }

  if (approvalStatus) {
    pills.push(`Approval: ${formatApprovalStatus(approvalStatus)}`);
  }

  if (connectorClass) {
    pills.push(`Connector class: ${formatConnectorClass(connectorClass)}`);
  }

  if (cadAvailability === "available") {
    pills.push("CAD: verified file-backed only");
  }

  if (cadAvailability === "unavailable") {
    pills.push("CAD: missing verified assets");
  }

  if (sort !== "mpn_asc") {
    pills.push(`Sort: ${formatSortLabel(sort)}`);
  }

  return pills;
}

/**
 * Maps the search sort to a short filter-summary label.
 */
function formatSortLabel(sort: PartSearchSort): string {
  return {
    mpn_asc: "MPN A-Z",
    mpn_desc: "MPN Z-A",
    trust_desc: "Trust score",
    updated_desc: "Recently updated"
  }[sort];
}

function appendHrefParam(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value && value.trim().length > 0) {
    params.set(key, value);
  }
}

/**
 * Builds one visible lookup label from the quick-check identity fields.
 */
function buildLookupValue(query: string | undefined, providerPartId: string | undefined, providerUrl: string | undefined, datasheetUrl: string | undefined): string | undefined {
  return query || providerPartId || providerUrl || datasheetUrl;
}
