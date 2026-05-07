/**
 * File header: Renders the connector-set catalog grouped by connector_class with mate context.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { fetchApiHealth, fetchConnectorSetCatalog, isApiClientError } from "../../lib/api-client";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { ConnectorClass, ConnectorSetClassGroup, ConnectorSetEntry, ConnectorSetListResponse, ConnectorSetMatePair } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** ConnectorSetsPageSearchParams mirrors the GET query that drives this catalog view. */
type ConnectorSetsPageSearchParams = {
  connectorClass?: string | string[];
  q?: string | string[];
};

/** ConnectorSetsPageState separates ready reads from setup failures. */
type ConnectorSetsPageState =
  | { health: ApiHealth | null; response: ConnectorSetListResponse; status: "ready" }
  | { code: string; health: ApiHealth | null; message: string; status: "setup_required" };

/** ConnectorSetsPageProps carries Next.js search params as an awaited value. */
interface ConnectorSetsPageProps {
  searchParams: Promise<ConnectorSetsPageSearchParams>;
}

/**
 * Renders the connector set catalog with optional connector_class filter and MPN search.
 */
export default async function ConnectorSetsPage({ searchParams }: ConnectorSetsPageProps) {
  const resolved = await searchParams;
  const connectorClassFilter = readConnectorClassParam(readSingleParam(resolved.connectorClass));
  const queryFilter = readSingleParam(resolved.q);
  const pageState = await loadConnectorSetsPage(connectorClassFilter, queryFilter);

  if (pageState.status === "setup_required") {
    return <ConnectorSetsSetupState pageState={pageState} />;
  }

  const { health, response } = pageState;

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Connector memory</p>
            <h1>Connector set catalog</h1>
            <p className="projects-hero__lede">
              Browse connector parts grouped by connector_class. Each connector lists best-mate and alternate-mate pairs from <code>mate_relations</code>, plus confirmed project usage counts.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label="DB-backed connector memory" tone="verified" />
              <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
              <StatusBadge label={`Database ${health?.dependencies.database ?? "unknown"}`} tone={health?.dependencies.database === "connected" ? "verified" : "review"} />
            </div>
          </div>
          <ConnectorSetsSnapshot response={response} />
        </div>
      </section>

      <WorkspaceJumpNav
        ariaLabel="Connector set sections"
        items={[
          { href: "#connector-sets-filter-heading", label: "Filter" },
          { href: "#connector-sets-list-heading", label: "Connector families" },
          { href: "#connector-sets-boundaries-heading", label: "Boundaries" }
        ]}
      />

      <section className="detail-section" aria-labelledby="connector-sets-filter-heading">
        <SectionHeading
          id="connector-sets-filter-heading"
          index="01"
          subtitle="Filter by connector class or search by MPN/manufacturer."
          title="Filter connector catalog"
        />
        <SectionPanel description="Filters are server-side; selecting a class only changes the rendered scope without re-classifying any part." title="Catalog filters">
          <ConnectorSetsFilterForm connectorClassFilter={response.connectorClassFilter} query={response.query ?? ""} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="connector-sets-list-heading">
        <SectionHeading
          id="connector-sets-list-heading"
          index="02"
          subtitle={`${response.totalConnectorCount} connectors across ${response.groups.length} class${response.groups.length === 1 ? "" : "es"}.`}
          title="Connector families"
        />
        <SectionPanel
          description="Mate pairs come from `mate_relations` (best_mate, alternate_mate). No new schema is created here."
          title={response.totalConnectorCount > 0 ? `${response.totalConnectorCount} connectors` : "No connectors"}
        >
          {response.totalConnectorCount > 0 ? <ConnectorSetGroupsList groups={response.groups} /> : <EmptyState title="No connectors found" body="Adjust the filter or import connector parts before browsing the connector-set catalog." />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="connector-sets-boundaries-heading">
        <SectionHeading
          id="connector-sets-boundaries-heading"
          index="03"
          subtitle="Listing connectors and mates does not approve reuse, validate evidence, or unlock export."
          title="Trust boundaries"
        />
        <SectionPanel description={response.boundary} title="Connector set truth">
          <div className="projects-truth-rail projects-truth-rail--compact">
            <div>
              <span>Connector class</span>
              <strong>Class is the part-level grouping.</strong>
              <p>Class comes from `part_readiness_summaries.connector_class` and is read-only here.</p>
            </div>
            <div>
              <span>Mate pairs</span>
              <strong>Best-mate vs alternate-mate stays explicit.</strong>
              <p>Pairs come from `mate_relations` with their original confidence score; this view never collapses them into a single answer.</p>
            </div>
            <div>
              <span>Project usage</span>
              <strong>Usage counts are confirmed BOM matches only.</strong>
              <p>A non-zero usage count means a project's matched BOM line points at the connector or mate part, not that the connector has been approved for export.</p>
            </div>
          </div>
        </SectionPanel>
      </section>
    </main>
  );
}

/**
 * Loads the connector-set catalog while preserving setup failures.
 */
async function loadConnectorSetsPage(connectorClassFilter: ConnectorClass | null, query: string): Promise<ConnectorSetsPageState> {
  const healthPromise = fetchApiHealth().catch(() => null);

  try {
    const filters: { connectorClass?: ConnectorClass; query?: string } = {};
    if (connectorClassFilter) filters.connectorClass = connectorClassFilter;
    if (query.trim().length > 0) filters.query = query.trim();
    const [health, response] = await Promise.all([healthPromise, fetchConnectorSetCatalog(filters)]);

    return {
      health,
      response,
      status: "ready"
    };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        health: await healthPromise,
        message: error.message,
        status: "setup_required"
      };
    }

    return {
      code: "API_UNAVAILABLE",
      health: await healthPromise,
      message: "The API could not be reached, so the connector-set catalog cannot be read.",
      status: "setup_required"
    };
  }
}

/**
 * Renders setup guidance when the connector catalog cannot be read.
 */
function ConnectorSetsSetupState({ pageState }: { pageState: Extract<ConnectorSetsPageState, { status: "setup_required" }> }) {
  return (
    <main className="projects-layout">
      <Link className="back-link" href="/catalog">
        &larr; Back to catalog
      </Link>
      <section className="projects-hero">
        <div className="projects-hero__copy">
          <p className="app-kicker">Connector memory</p>
          <h1>Connect the engineering-memory database</h1>
          <p className="projects-hero__lede">Connector set browsing requires persisted connector parts plus mate_relations rows. No seed fallback is used here.</p>
          <div className="projects-hero__status">
            <StatusBadge label={pageState.code} tone="review" />
            <StatusBadge label={`Database ${pageState.health?.dependencies.database ?? "unknown"}`} tone={pageState.health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
          <p className="mode-warning">{pageState.message}</p>
        </div>
      </section>
    </main>
  );
}

/**
 * Renders the connector catalog hero snapshot.
 */
function ConnectorSetsSnapshot({ response }: { response: ConnectorSetListResponse }) {
  const projectUsageTotal = response.groups.reduce((total, group) =>
    total + group.entries.reduce((entryTotal, entry) => entryTotal + entry.projectUsageCount, 0)
    , 0);

  return (
    <div className="projects-hero__snapshot" aria-label="Connector set summary">
      <ConnectorSetStat label="Connectors" tone="info" value={response.totalConnectorCount.toString()} />
      <ConnectorSetStat label="Mate pairs" tone="neutral" value={response.totalMatePairCount.toString()} />
      <ConnectorSetStat label="Classes" tone="neutral" value={response.groups.length.toString()} />
      <ConnectorSetStat label="Project usages" tone={projectUsageTotal > 0 ? "verified" : "neutral"} value={projectUsageTotal.toString()} />
    </div>
  );
}

/**
 * Renders one compact connector stat tile.
 */
function ConnectorSetStat({ label, tone, value }: { label: string; tone: BadgeTone; value: string }) {
  return (
    <div className={`projects-stat projects-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Renders the connector class filter and MPN search form.
 */
function ConnectorSetsFilterForm({ connectorClassFilter, query }: { connectorClassFilter: ConnectorClass | null; query: string }) {
  return (
    <form className="where-used-search-form" method="get">
      <label>
        <span>Connector class</span>
        <select defaultValue={connectorClassFilter ?? ""} name="connectorClass">
          <option value="">All classes</option>
          <option value="connector">connector</option>
          <option value="accessory">accessory</option>
          <option value="tooling">tooling</option>
          <option value="cable">cable</option>
        </select>
      </label>
      <label className="where-used-search-form__query">
        <span>Search MPN or manufacturer</span>
        <input defaultValue={query} name="q" placeholder="EH-1.25 or JST" type="search" />
      </label>
      <button className="button-primary" type="submit">Apply</button>
    </form>
  );
}

/**
 * Renders connector groups and per-connector mate pairs.
 */
function ConnectorSetGroupsList({ groups }: { groups: ConnectorSetClassGroup[] }) {
  return (
    <div className="connector-sets-groups">
      {groups.map((group) => (
        <div className="connector-sets-group" key={group.connectorClass}>
          <h3 className="connector-sets-group__heading">
            {group.connectorClass}
            <span className="muted-copy"> · {group.entries.length} connector{group.entries.length === 1 ? "" : "s"}</span>
          </h3>
          <div className="connector-sets-list">
            {group.entries.map((entry) => (
              <ConnectorSetCard entry={entry} key={entry.partId} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders one connector with identity, current state, and mate pairs.
 */
function ConnectorSetCard({ entry }: { entry: ConnectorSetEntry }) {
  return (
    <article className="connector-sets-card">
      <header>
        <Link href={`/parts/${encodeURIComponent(entry.partId)}`} className="ui-mono">{entry.mpn}</Link>
        <p className="muted-copy">{entry.manufacturerName} · lifecycle {entry.lifecycleStatus} · approval {entry.approvalStatus ?? "missing"} · readiness {entry.readinessStatus ?? "unknown"}</p>
        <p className="muted-copy">Project usages: <strong>{entry.projectUsageCount}</strong></p>
      </header>
      {entry.matePairs.length > 0 ? (
        <table className="where-used-table">
          <thead>
            <tr>
              <th>Mate</th>
              <th>Pair kind</th>
              <th>Confidence</th>
              <th>Mate state</th>
              <th>Mate uses</th>
            </tr>
          </thead>
          <tbody>
            {entry.matePairs.map((pair) => (
              <ConnectorSetMateRow pair={pair} key={pair.matePartId + pair.relationshipType} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted-copy">No mate or alternate-mate rows recorded for this connector.</p>
      )}
    </article>
  );
}

/**
 * Renders one mate row in the per-connector table.
 */
function ConnectorSetMateRow({ pair }: { pair: ConnectorSetMatePair }) {
  return (
    <tr>
      <td>
        <Link href={`/parts/${encodeURIComponent(pair.matePartId)}`} className="ui-mono">{pair.mateMpn}</Link>
        <p className="muted-copy">{pair.mateManufacturerName}</p>
      </td>
      <td>
        <StatusBadge label={pair.relationshipType.replace(/_/gu, " ")} tone={pair.relationshipType === "best_mate" ? "verified" : "info"} />
      </td>
      <td>{pair.confidenceScore === null ? "n/a" : pair.confidenceScore.toFixed(2)}</td>
      <td>
        <span>{pair.matePartApprovalStatus ?? "approval missing"}</span>
        <p className="muted-copy">{pair.matePartReadinessStatus ?? "readiness unknown"} · lifecycle {pair.matePartLifecycleStatus}</p>
      </td>
      <td>{pair.projectUsageCount}</td>
    </tr>
  );
}

/**
 * Reads the first string value from a Next.js search param.
 */
function readSingleParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return value?.trim() ?? "";
}

/**
 * Parses connector class while dropping unsupported labels (defaults to no filter).
 */
function readConnectorClassParam(value: string): ConnectorClass | null {
  if (value === "connector" || value === "accessory" || value === "tooling" || value === "cable" || value === "non_connector") {
    return value;
  }
  return null;
}
