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
 * Renders resolver candidates as scannable cards led by the connector-to-mate pairing.
 */
function ConnectorIntentCandidates({ candidates }: { candidates: ConnectorSetIntentCandidate[] }) {
  return (
    <div className="resolver-candidates">
      {candidates.map((candidate) => (
        <ConnectorIntentCard candidate={candidate} key={candidate.connector.partId} />
      ))}
    </div>
  );
}

/**
 * Renders one resolver candidate with the mate pairing as the visual focus.
 */
function ConnectorIntentCard({ candidate }: { candidate: ConnectorSetIntentCandidate }) {
  const confidencePercent = Math.round(candidate.confidenceScore * 100);
  const buildabilityTone: BadgeTone =
    candidate.buildabilityState === "buildable" ? "verified" : candidate.buildabilityState === "pending" ? "review" : "danger";
  const identityLine = [
    candidate.connector.manufacturerName,
    candidate.connector.connectorFamilyName ?? "No family",
    candidate.connector.packagePinCount !== null ? `${candidate.connector.packagePinCount} pins` : null
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="resolver-card">
      <header className="resolver-card__head">
        <div className="resolver-card__identity">
          <Link href={`/parts/${encodeURIComponent(candidate.connector.partId)}`} className="ui-mono resolver-card__mpn">
            {candidate.connector.mpn}
          </Link>
          <p className="resolver-card__sub">{identityLine}</p>
        </div>
        <div className="resolver-card__status">
          <StatusBadge label={candidate.buildabilityState.replace(/_/gu, " ")} tone={buildabilityTone} />
          <StatusBadge label={`${confidencePercent}% confidence`} tone={candidate.confidenceScore >= 0.8 ? "verified" : "review"} />
        </div>
      </header>

      <ConnectorMatePairing connector={candidate.connector} mate={candidate.mate} />

      <ConnectorBuildKit candidate={candidate} />

      {candidate.warnings.length > 0 ? (
        <div className="resolver-flags">
          <span className="resolver-flags__title">Before you commit</span>
          <ul>
            {candidate.warnings.map((warning) => (
              <li className={`resolver-flag resolver-flag--${warning.tone}`} key={warning.code}>
                {warning.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Renders the connector-to-mate pairing as the card's focal point, with an honest pending state.
 */
function ConnectorMatePairing({
  connector,
  mate
}: {
  connector: ConnectorSetIntentCandidate["connector"];
  mate: ConnectorSetIntentCandidate["mate"];
}) {
  return (
    <div className="resolver-mate">
      <div className="resolver-mate__node">
        <span className="resolver-mate__role">This connector</span>
        <span className="ui-mono resolver-mate__part">{connector.mpn}</span>
      </div>
      <div className="resolver-mate__bridge" aria-hidden="true">
        <span className="resolver-mate__arrow">&rarr;</span>
        <span className="resolver-mate__bridge-label">mates with</span>
      </div>
      {mate ? (
        <div className="resolver-mate__node resolver-mate__node--mate">
          <span className="resolver-mate__role">Mate &middot; {Math.round(mate.confidenceScore * 100)}% match</span>
          <Link href={`/parts/${encodeURIComponent(mate.part.partId)}`} className="ui-mono resolver-mate__part">
            {mate.part.mpn}
          </Link>
          <span className="resolver-mate__meta">{mate.part.manufacturerName}</span>
        </div>
      ) : (
        <div className="resolver-mate__node resolver-mate__node--mate resolver-mate__node--pending">
          <span className="resolver-mate__role">Mate</span>
          <span className="resolver-mate__part resolver-mate__part--pending">No mate found yet</span>
          <span className="resolver-mate__meta">No stored mate satisfies this connector.</span>
        </div>
      )}
    </div>
  );
}

/**
 * Renders the parts needed to build the connector set, with present and pending markers.
 */
function ConnectorBuildKit({ candidate }: { candidate: ConnectorSetIntentCandidate }) {
  const groups = [
    { key: "required", label: "Required accessories", relations: candidate.requiredAccessories, required: true },
    { key: "cable", label: "Cable", relations: candidate.cableOption ? [candidate.cableOption] : [], required: false },
    { key: "tooling", label: "Tooling", relations: candidate.tooling, required: false },
    { key: "optional", label: "Optional accessories", relations: candidate.optionalAccessories, required: false }
  ];
  // Optional accessories only render when present; the rest always show so a gap reads as pending.
  const visible = groups.filter((group) => group.key !== "optional" || group.relations.length > 0);

  return (
    <div className="resolver-kit">
      <span className="resolver-kit__title">To build this set</span>
      <ul className="resolver-kit__list">
        {visible.map((group) => (
          <ConnectorBuildKitRow key={group.key} label={group.label} relations={group.relations} required={group.required} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Renders one build-kit group as a present or pending line without hiding missing coverage.
 */
function ConnectorBuildKitRow({
  label,
  relations,
  required
}: {
  label: string;
  relations: ConnectorSetResolvedRelation[];
  required: boolean;
}) {
  const present = relations.length > 0;
  const value = present
    ? relations.map((relation) => `${relation.part.mpn} (${Math.round(relation.confidenceScore * 100)}%)`).join(", ")
    : required
      ? "Needed — none stored yet"
      : "None recorded";

  return (
    <li className={`resolver-kit__row ${present ? "resolver-kit__row--present" : "resolver-kit__row--pending"}`}>
      <span className="resolver-kit__marker" aria-hidden="true">{present ? "✓" : "•"}</span>
      <span className="resolver-kit__label">{label}</span>
      <span className="resolver-kit__value">{value}</span>
    </li>
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
