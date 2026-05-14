/**
 * File header: Renders the connector-set catalog grouped by connector_class with mate context.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { fetchApiHealth, fetchConnectorSetCatalog, isApiClientError, resolveConnectorSetIntent } from "../../lib/api-client";
import { getSetupStateCopy } from "../../lib/setup-state-copy";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { ConnectorClass, ConnectorSetClassGroup, ConnectorSetEntry, ConnectorSetIntentCandidate, ConnectorSetIntentResolution, ConnectorSetListResponse, ConnectorSetMatePair, ConnectorSetResolvedRelation } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** ConnectorSetsPageSearchParams mirrors the GET query that drives this catalog view. */
type ConnectorSetsPageSearchParams = {
  awg?: string | string[];
  connectorClass?: string | string[];
  pins?: string | string[];
  q?: string | string[];
  sealing?: string | string[];
};

/** ConnectorSetsPageState separates ready reads from setup failures. */
type ConnectorSetsPageState =
  | { health: ApiHealth | null; resolution: ConnectorSetIntentResolution | null; response: ConnectorSetListResponse; status: "ready" }
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
  const pinCountFilter = readPositiveIntegerParam(readSingleParam(resolved.pins));
  const cableGaugeFilter = readPositiveIntegerParam(readSingleParam(resolved.awg));
  const sealingFilter = readSingleParam(resolved.sealing);
  const pageState = await loadConnectorSetsPage(connectorClassFilter, queryFilter, pinCountFilter, cableGaugeFilter, sealingFilter);

  if (pageState.status === "setup_required") {
    return <ConnectorSetsSetupState pageState={pageState} />;
  }

  const { health, resolution, response } = pageState;

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Connector sets</p>
            <h1>Connector set catalog</h1>
            <p className="projects-hero__lede">
              Find connectors with their matching mates and accessories. Each row shows the best mate, any alternates, and how many projects already use it.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label="Database connected" tone="verified" />
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
          <ConnectorSetsFilterForm cableGauge={cableGaugeFilter} connectorClassFilter={response.connectorClassFilter} pinCount={pinCountFilter} query={response.query ?? ""} sealing={sealingFilter} />
        </SectionPanel>
      </section>

      {resolution ? (
        <section className="detail-section" aria-labelledby="connector-sets-intent-heading">
          <SectionHeading
            id="connector-sets-intent-heading"
            index="02"
            subtitle={`${resolution.candidates.length} candidate${resolution.candidates.length === 1 ? "" : "s"} with buildability state and warnings.`}
            title="Intent resolver"
          />
          <SectionPanel description={resolution.boundary} title={`Resolver candidates for "${resolution.intent.class}"`}>
            {resolution.candidates.length > 0 ? <ConnectorIntentCandidates candidates={resolution.candidates} /> : <EmptyState title="No intent candidates" body="Try a family, series, pin count, or cable gauge that exists in the seeded connector catalog." />}
          </SectionPanel>
        </section>
      ) : null}

      <section className="detail-section" aria-labelledby="connector-sets-list-heading">
        <SectionHeading
          id="connector-sets-list-heading"
          index={resolution ? "03" : "02"}
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
          index={resolution ? "04" : "03"}
          subtitle="Connector listings are reference material. Always confirm fit and verification before reuse."
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
async function loadConnectorSetsPage(
  connectorClassFilter: ConnectorClass | null,
  query: string,
  pinCount: number | null,
  cableGauge: number | null,
  sealing: string
): Promise<ConnectorSetsPageState> {
  const healthPromise = fetchApiHealth().catch(() => null);

  try {
    const filters: { connectorClass?: ConnectorClass; query?: string } = {};
    if (connectorClassFilter) filters.connectorClass = connectorClassFilter;
    if (query.trim().length > 0) filters.query = query.trim();
    const resolutionPromise = query.trim().length > 0
      ? resolveConnectorSetIntent({
          cableGauge,
          class: query.trim(),
          pinCount,
          query: query.trim(),
          sealing: sealing.trim().length > 0 ? sealing.trim() : null
        }).catch(() => null)
      : Promise.resolve(null);
    const [health, response, resolution] = await Promise.all([healthPromise, fetchConnectorSetCatalog(filters), resolutionPromise]);

    return {
      health,
      resolution,
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
      <section className="projects-hero">
        <div className="projects-hero__copy">
          <p className="app-kicker">Connector sets</p>
          <h1>{getSetupStateCopy(pageState.code).headline}</h1>
          <p className="projects-hero__lede">{getSetupStateCopy(pageState.code).body} Connector set browsing needs persisted connector parts and mate_relations rows.</p>
          <div className="projects-hero__status">
            <StatusBadge label={`Database ${pageState.health?.dependencies.database ?? "unknown"}`} tone={pageState.health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
          <details className="audit-disclosure">
            <summary>Show technical details</summary>
            <p className="muted-copy">{pageState.code}: {pageState.message}</p>
          </details>
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
function ConnectorSetsFilterForm({ cableGauge, connectorClassFilter, pinCount, query, sealing }: { cableGauge: number | null; connectorClassFilter: ConnectorClass | null; pinCount: number | null; query: string; sealing: string }) {
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
        <span>Intent, MPN, or manufacturer</span>
        <input defaultValue={query} name="q" placeholder="JST PH 2 pin or AMPSEAL 18 AWG" type="search" />
      </label>
      <label>
        <span>Pins</span>
        <input defaultValue={pinCount ?? ""} min="1" name="pins" placeholder="2" type="number" />
      </label>
      <label>
        <span>Sealing</span>
        <input defaultValue={sealing} name="sealing" placeholder="sealed or IP67" />
      </label>
      <label>
        <span>AWG</span>
        <input defaultValue={cableGauge ?? ""} min="1" name="awg" placeholder="24" type="number" />
      </label>
      <button className="button-primary" type="submit">Apply filters</button>
    </form>
  );
}

/**
 * Renders resolver candidates with buildability, confidence, and family warnings separated.
 */
function ConnectorIntentCandidates({ candidates }: { candidates: ConnectorSetIntentCandidate[] }) {
  return (
    <div className="connector-sets-list">
      {candidates.map((candidate) => (
        <article className="connector-sets-card" key={candidate.connector.partId}>
          <header>
            <Link href={`/parts/${encodeURIComponent(candidate.connector.partId)}`} className="ui-mono">{candidate.connector.mpn}</Link>
            <p className="muted-copy">{candidate.connector.manufacturerName} - {candidate.connector.connectorFamilyName ?? "No family"} - {candidate.connector.packagePinCount ?? "?"} pins</p>
            <div className="projects-hero__status">
              <StatusBadge label={candidate.buildabilityState.replace(/_/gu, " ")} tone={candidate.buildabilityState === "buildable" ? "verified" : candidate.buildabilityState === "pending" ? "review" : "danger"} />
              <StatusBadge label={`${Math.round(candidate.confidenceScore * 100)}% confidence`} tone={candidate.confidenceScore >= 0.8 ? "verified" : "review"} />
            </div>
          </header>
          <div className="projects-truth-rail projects-truth-rail--compact">
            <ConnectorIntentRelation label="Mate" relation={candidate.mate} />
            <ConnectorIntentRelationList label="Required accessories" relations={candidate.requiredAccessories} />
            <ConnectorIntentRelationList label="Optional accessories" relations={candidate.optionalAccessories} />
            <ConnectorIntentRelation label="Cable option" relation={candidate.cableOption} />
            <ConnectorIntentRelationList label="Tooling" relations={candidate.tooling} />
          </div>
          {candidate.familyConfusionWarnings.length > 0 ? (
            <div className="connector-warning-list">
              {candidate.familyConfusionWarnings.map((warning) => (
                <p className="muted-copy" key={warning.code}><strong>{warning.summary}</strong> {warning.detail}</p>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/**
 * Renders a single resolver relation without implying that missing data is available.
 */
function ConnectorIntentRelation({ label, relation }: { label: string; relation: ConnectorSetIntentCandidate["mate"] }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{relation ? relation.part.mpn : "Pending"}</strong>
      <p>{relation ? `${relation.part.manufacturerName} - ${Math.round(relation.confidenceScore * 100)}% - ${relation.compatibilityStatus}` : "No stored relation satisfies this part of the intent yet."}</p>
    </div>
  );
}

/**
 * Renders resolver relation lists with an explicit pending empty state.
 */
function ConnectorIntentRelationList({ label, relations }: { label: string; relations: ConnectorSetResolvedRelation[] }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{relations.length > 0 ? `${relations.length} mapped` : "Pending"}</strong>
      <p>{relations.length > 0 ? relations.map((relation) => `${relation.part.mpn} (${Math.round(relation.confidenceScore * 100)}%)`).join(", ") : "No stored rows are available for this group."}</p>
    </div>
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
            <span className="muted-copy"> - {group.entries.length} connector{group.entries.length === 1 ? "" : "s"}</span>
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
        <p className="muted-copy">{entry.manufacturerName} - lifecycle {entry.lifecycleStatus} - approval {entry.approvalStatus ?? "missing"} - readiness {entry.readinessStatus ?? "unknown"}</p>
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
        <p className="muted-copy">{pair.matePartReadinessStatus ?? "readiness unknown"} - lifecycle {pair.matePartLifecycleStatus}</p>
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

/**
 * Parses a positive integer search parameter and drops invalid values.
 */
function readPositiveIntegerParam(value: string): number | null {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
