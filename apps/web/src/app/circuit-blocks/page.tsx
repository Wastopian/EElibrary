/**
 * File header: Renders the reusable circuit block library from engineering-memory persistence.
 *
 * The library page is intentionally scan-first so engineering teams can answer
 * "what blocks do we have, and which are ready to reuse?" without opening each detail page.
 * Filters narrow the result set on the server (q/type/status/owner/readiness) and the response
 * echoes the applied filters so the UI never silently disagrees with the server about what's shown.
 *
 * Reuse readiness is derived per row from the same shared helper used on the detail page so the
 * library can never report "ready" when the detail strip would say "blocked". Block reuse does
 * not approve linked parts, validate assets, or unlock exports — and that boundary is repeated
 * everywhere the column appears.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { CircuitBlockCreatePanel } from "../../components/CircuitBlockCreatePanel";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { fetchApiHealth, fetchCircuitBlocks, isApiClientError } from "../../lib/api-client";
import { getCircuitBlockReuseHeadline } from "../../lib/circuit-block-reuse-readiness";
import { getSetupStateCopy } from "../../lib/setup-state-copy";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { CircuitBlockReuseHeadline } from "../../lib/circuit-block-reuse-readiness";
import type {
  CircuitBlockListFilters,
  CircuitBlockListResponse,
  CircuitBlockReuseReadinessFilter,
  CircuitBlockStatus,
  CircuitBlockSummary,
  CircuitBlockType
} from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** CircuitBlocksPageSearchParams mirrors the GET query that drives the library filter bar. */
type CircuitBlocksPageSearchParams = {
  q?: string | string[];
  type?: string | string[];
  status?: string | string[];
  owner?: string | string[];
  readiness?: string | string[];
};

/** CircuitBlocksPageProps carries Next.js search params as an awaited value in this app version. */
interface CircuitBlocksPageProps {
  searchParams: Promise<CircuitBlocksPageSearchParams>;
}

/** CircuitBlocksPageState separates ready library reads from setup failures. */
type CircuitBlocksPageState =
  | {
      filtersApplied: boolean;
      health: ApiHealth | null;
      response: CircuitBlockListResponse;
      status: "ready";
    }
  | {
      code: string;
      health: ApiHealth | null;
      message: string;
      status: "setup_required";
    };

const ALLOWED_BLOCK_TYPES: ReadonlySet<CircuitBlockType> = new Set<CircuitBlockType>([
  "power",
  "mcu_support",
  "interface",
  "protection",
  "connector_set",
  "sensor_front_end",
  "other"
]);
const ALLOWED_STATUSES: ReadonlySet<CircuitBlockStatus> = new Set<CircuitBlockStatus>([
  "draft",
  "in_review",
  "approved",
  "deprecated",
  "restricted"
]);
const ALLOWED_READINESS: ReadonlySet<CircuitBlockReuseReadinessFilter> = new Set<CircuitBlockReuseReadinessFilter>([
  "reusable",
  "pending",
  "blocked"
]);

/**
 * Renders the circuit block library, filter bar, and creation surface.
 */
export default async function CircuitBlocksPage({ searchParams }: CircuitBlocksPageProps) {
  const resolvedSearchParams = await searchParams;
  const filters = readLibraryFilters(resolvedSearchParams);
  const pageState = await loadCircuitBlocksPage(filters);

  if (pageState.status === "setup_required") {
    return <CircuitBlocksSetupState pageState={pageState} />;
  }

  const { filtersApplied, health, response } = pageState;
  const appliedFilters = response.filters;
  const headlines = response.circuitBlocks.map((summary) => getCircuitBlockReuseHeadline(summary));

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Circuit blocks</p>
            <h1>Reusable circuit blocks</h1>
            <p className="projects-hero__lede">
              Save reusable circuit patterns so a future project can drop them in. Block approval is separate from part approval and from export readiness.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label="Database connected" tone="verified" />
              <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
              <StatusBadge label={`Database ${health?.dependencies.database ?? "unknown"}`} tone={health?.dependencies.database === "connected" ? "verified" : "review"} />
            </div>
          </div>
          <CircuitBlocksSnapshot headlines={headlines} response={response} />
        </div>
      </section>

      <WorkspaceJumpNav
        ariaLabel="Circuit block sections"
        items={[
          { href: "#circuit-block-filters-heading", label: "Filters" },
          { href: "#circuit-block-list-heading", label: "Blocks" },
          { href: "#circuit-block-create-heading", label: "Create" },
          { href: "#circuit-block-boundaries-heading", label: "Boundaries" }
        ]}
      />

      <section className="detail-section" aria-labelledby="circuit-block-filters-heading">
        <SectionHeading
          id="circuit-block-filters-heading"
          index="01"
          subtitle="Narrow the library by name, type, status, owner, or reuse readiness."
          title="Find a circuit block"
        />
        <SectionPanel
          description="Use filters to narrow the library by name, type, status, owner, or reuse readiness. The list updates to show only blocks that match."
          title={filtersApplied ? "Filtered library" : "All circuit blocks"}
        >
          <CircuitBlockLibraryFilterBar appliedFilters={appliedFilters} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-list-heading">
        <SectionHeading
          id="circuit-block-list-heading"
          index="02"
          subtitle="Saved circuit patterns with their part roles and reuse status."
          title="Circuit block library"
        />
        <SectionPanel
          description="The reuse-readiness column gives one quick verdict per block, based on the worst of four stages. It does not approve linked parts or make exports available."
          title={response.circuitBlocks.length > 0
            ? `${response.circuitBlocks.length} ${response.circuitBlocks.length === 1 ? "circuit block" : "circuit blocks"}`
            : filtersApplied ? "No blocks match these filters" : "No circuit blocks"}
        >
          {response.circuitBlocks.length > 0
            ? <CircuitBlocksTable circuitBlocks={response.circuitBlocks} headlines={headlines} />
            : <CircuitBlocksEmptyState filtersApplied={filtersApplied} />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-create-heading">
        <SectionHeading
          id="circuit-block-create-heading"
          index="03"
          subtitle="Create the pattern first. You can add the parts it uses on its detail page."
          title="Create circuit block"
        />
        <SectionPanel
          description="Creation stores structured design knowledge and constraints. It does not create parts, approve parts, or verify assets."
          title="New circuit block"
        >
          <CircuitBlockCreatePanel />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-boundaries-heading">
        <SectionHeading
          id="circuit-block-boundaries-heading"
          index="04"
          subtitle="A block's status describes the circuit pattern. The parts it uses keep their own status."
          title="How blocks relate to parts"
        />
        <SectionPanel description="A block's status describes the circuit pattern itself. The parts it uses keep their own approval, lifecycle, readiness, validation, and export status." title="How block status and part status interact">
          <div className="projects-truth-rail projects-truth-rail--compact">
            <div>
              <span>Block state</span>
              <strong>An approved block does not unlock its parts.</strong>
              <p>Approved blocks can still contain parts with readiness gaps or missing verified CAD.</p>
            </div>
            <div>
              <span>Part roles</span>
              <strong>Required and optional are kept separate.</strong>
              <p>Substitution policy is recorded per role so reuse constraints stay visible.</p>
            </div>
            <div>
              <span>Reuse readiness</span>
              <strong>The library shows the worst stage.</strong>
              <p>If any of the four reuse stages is blocked, the library shows the block as blocked too — so a block is never advertised as ready when a later stage is held up.</p>
            </div>
          </div>
        </SectionPanel>
      </section>
    </main>
  );
}

/**
 * Loads the circuit block library while preserving setup failures.
 */
async function loadCircuitBlocksPage(filters: CircuitBlockListFilters): Promise<CircuitBlocksPageState> {
  const healthPromise = fetchApiHealth();
  const filtersApplied = isAnyFilterApplied(filters);

  try {
    const [health, response] = await Promise.all([healthPromise, fetchCircuitBlocks(filters)]);

    return {
      filtersApplied,
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
      message: "The API could not be reached, so circuit block memory cannot be read.",
      status: "setup_required"
    };
  }
}

/**
 * Reads optional library filters from the URL, dropping unknown values silently so a curious
 * URL never breaks the page. The server applies its own allow-list as a second line of defence.
 */
function readLibraryFilters(searchParams: CircuitBlocksPageSearchParams): CircuitBlockListFilters {
  const query = readSingleParam(searchParams.q);
  const blockType = readSingleParam(searchParams.type);
  const status = readSingleParam(searchParams.status);
  const owner = readSingleParam(searchParams.owner);
  const readiness = readSingleParam(searchParams.readiness);

  return {
    blockType: blockType.length > 0 && ALLOWED_BLOCK_TYPES.has(blockType as CircuitBlockType)
      ? (blockType as CircuitBlockType)
      : null,
    owner: owner.length > 0 ? owner : null,
    query: query.length > 0 ? query : null,
    reuseReadiness: readiness.length > 0 && ALLOWED_READINESS.has(readiness as CircuitBlockReuseReadinessFilter)
      ? (readiness as CircuitBlockReuseReadinessFilter)
      : null,
    status: status.length > 0 && ALLOWED_STATUSES.has(status as CircuitBlockStatus)
      ? (status as CircuitBlockStatus)
      : null
  };
}

function readSingleParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}

function isAnyFilterApplied(filters: CircuitBlockListFilters): boolean {
  return Boolean(
    filters.query || filters.blockType || filters.status || filters.owner || filters.reuseReadiness
  );
}

/**
 * Renders setup guidance for unavailable circuit block persistence.
 */
function CircuitBlocksSetupState({ pageState }: { pageState: Extract<CircuitBlocksPageState, { status: "setup_required" }> }) {
  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__copy">
          <p className="app-kicker">Circuit blocks</p>
          <h1>{getSetupStateCopy(pageState.code).headline}</h1>
          <p className="projects-hero__lede">{getSetupStateCopy(pageState.code).body} Circuit block reads need persisted circuit block and linked part-role tables — no seed fallback is used for reusable circuit knowledge.</p>
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
 * Renders the filter bar above the library. Uses a plain GET form so server-rendered URLs
 * stay shareable and the page survives the absence of client-side JavaScript.
 */
function CircuitBlockLibraryFilterBar({ appliedFilters }: { appliedFilters: CircuitBlockListFilters }) {
  return (
    <form className="circuit-block-library-filters" method="get">
      <label className="circuit-block-library-filters__field circuit-block-library-filters__field--query">
        <span>Search</span>
        <input
          defaultValue={appliedFilters.query ?? ""}
          name="q"
          placeholder="block key, name, description, owner, or scope"
          type="search"
        />
      </label>
      <label className="circuit-block-library-filters__field">
        <span>Type</span>
        <select defaultValue={appliedFilters.blockType ?? ""} name="type">
          <option value="">Any type</option>
          <option value="power">Power</option>
          <option value="mcu_support">MCU support</option>
          <option value="interface">Interface</option>
          <option value="protection">Protection</option>
          <option value="connector_set">Connector set</option>
          <option value="sensor_front_end">Sensor front end</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="circuit-block-library-filters__field">
        <span>Status</span>
        <select defaultValue={appliedFilters.status ?? ""} name="status">
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="in_review">In review</option>
          <option value="approved">Approved</option>
          <option value="restricted">Restricted</option>
          <option value="deprecated">Deprecated</option>
        </select>
      </label>
      <label className="circuit-block-library-filters__field">
        <span>Reuse readiness</span>
        <select defaultValue={appliedFilters.reuseReadiness ?? ""} name="readiness">
          <option value="">Any verdict</option>
          <option value="reusable">Ready to reuse</option>
          <option value="pending">Pending</option>
          <option value="blocked">Blocked</option>
        </select>
      </label>
      <label className="circuit-block-library-filters__field">
        <span>Owner</span>
        <input
          defaultValue={appliedFilters.owner ?? ""}
          name="owner"
          placeholder="exact owner"
          type="text"
        />
      </label>
      <div className="circuit-block-library-filters__actions">
        <button className="button-primary" type="submit">Apply filters</button>
        <Link className="button-tertiary" href="/circuit-blocks">Clear</Link>
      </div>
    </form>
  );
}

/**
 * Renders the circuit block summary strip, including a reuse-readiness breakdown.
 */
function CircuitBlocksSnapshot({
  headlines,
  response
}: {
  headlines: CircuitBlockReuseHeadline[];
  response: CircuitBlockListResponse;
}) {
  const totalParts = response.circuitBlocks.reduce((total, summary) => total + summary.totalPartCount, 0);
  const readinessGaps = response.circuitBlocks.reduce((total, summary) => total + summary.readinessGapCount, 0);
  const activeRisks = response.circuitBlocks.reduce((total, summary) => total + summary.activeKnownRiskCount, 0);
  const blockingRisks = response.circuitBlocks.reduce((total, summary) => total + summary.activeBlockingRiskCount, 0);
  const readyCount = headlines.filter((headline) => headline.state === "reusable").length;
  const blockedCount = headlines.filter((headline) => headline.state === "blocked").length;

  return (
    <div className="projects-hero__snapshot" aria-label="Circuit block summary">
      <CircuitBlockStat label="Blocks" tone="info" value={response.circuitBlocks.length.toString()} />
      <CircuitBlockStat label="Ready to reuse" tone={readyCount > 0 ? "verified" : "neutral"} value={readyCount.toString()} />
      <CircuitBlockStat label="Blocked" tone={blockedCount > 0 ? "review" : "verified"} value={blockedCount.toString()} />
      <CircuitBlockStat label="Part roles" tone="neutral" value={totalParts.toString()} />
      <CircuitBlockStat label="Readiness gaps" tone={readinessGaps > 0 ? "review" : "verified"} value={readinessGaps.toString()} />
      <CircuitBlockStat
        label={blockingRisks > 0 ? `Active risks (${blockingRisks} blocking)` : "Active risks"}
        tone={blockingRisks > 0 ? "review" : activeRisks > 0 ? "info" : "verified"}
        value={activeRisks.toString()}
      />
    </div>
  );
}

/**
 * Renders one compact circuit block stat tile.
 */
function CircuitBlockStat({ label, tone, value }: { label: string; tone: BadgeTone; value: string }) {
  return (
    <div className={`projects-stat projects-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Renders persisted circuit blocks in a dense table.
 */
function CircuitBlocksTable({
  circuitBlocks,
  headlines
}: {
  circuitBlocks: CircuitBlockSummary[];
  headlines: CircuitBlockReuseHeadline[];
}) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Block</th>
            <th>Type</th>
            <th>Status</th>
            <th>Reuse</th>
            <th>Parts</th>
            <th>Required</th>
            <th>Gaps</th>
            <th>Risks</th>
            <th>Evidence</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {circuitBlocks.map((summary, index) => {
            const headline = headlines[index]!;
            return (
              <tr key={summary.circuitBlock.id}>
                <td>
                  <Link href={`/circuit-blocks/${summary.circuitBlock.id}`}>
                    <span className="ui-mono">{summary.circuitBlock.blockKey}</span>
                  </Link>
                  <div className="projects-table__primary">{summary.circuitBlock.name}</div>
                  <div className="muted-copy">{summary.circuitBlock.reuseScope || summary.circuitBlock.description}</div>
                </td>
                <td>{formatCircuitBlockType(summary.circuitBlock.blockType)}</td>
                <td>
                  <StatusBadge label={formatCircuitBlockStatus(summary.circuitBlock.status)} tone={circuitBlockStatusTone(summary.circuitBlock.status)} />
                </td>
                <td>
                  <StatusBadge label={headline.label} tone={headlineToneToBadge(headline.tone)} />
                  <div className="muted-copy">{headline.detail}</div>
                </td>
                <td>{summary.totalPartCount}</td>
                <td>{summary.requiredPartCount}</td>
                <td>{summary.readinessGapCount}</td>
                <td>
                  {summary.activeKnownRiskCount === 0
                    ? <span className="muted-copy">None</span>
                    : (
                      <StatusBadge
                        label={summary.activeBlockingRiskCount > 0
                          ? `${summary.activeKnownRiskCount} active · ${summary.activeBlockingRiskCount} blocking`
                          : `${summary.activeKnownRiskCount} active`}
                        tone={summary.activeBlockingRiskCount > 0 ? "review" : "info"}
                      />
                    )}
                </td>
                <td>{summary.evidenceAttachmentCount}</td>
                <td>{formatDateTime(summary.circuitBlock.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders the configured-but-empty circuit block state, distinguishing "no rows" from
 * "no rows match the current filters" so engineers know whether to clear filters.
 */
function CircuitBlocksEmptyState({ filtersApplied }: { filtersApplied: boolean }) {
  if (filtersApplied) {
    return (
      <EmptyState
        title="No circuit blocks match these filters"
        body="Clear the search, type, status, or readiness filters to see the full library."
      />
    );
  }

  return (
    <EmptyState
      title="No circuit blocks yet"
      body="Create a block below, then open it to add the part roles you reuse together."
    />
  );
}

/**
 * Formats circuit block type values for operators.
 */
function formatCircuitBlockType(blockType: CircuitBlockType): string {
  return {
    connector_set: "Connector set",
    interface: "Interface",
    mcu_support: "MCU support",
    other: "Other",
    power: "Power",
    protection: "Protection",
    sensor_front_end: "Sensor front end"
  }[blockType];
}

/**
 * Formats circuit block status values for operators.
 */
function formatCircuitBlockStatus(status: CircuitBlockStatus): string {
  return {
    approved: "Approved",
    deprecated: "Deprecated",
    draft: "Draft",
    in_review: "In review",
    restricted: "Restricted"
  }[status];
}

/**
 * Maps circuit block status to badge tone without claiming part readiness.
 */
function circuitBlockStatusTone(status: CircuitBlockStatus): BadgeTone {
  if (status === "approved") return "verified";
  if (status === "in_review" || status === "restricted") return "review";
  if (status === "deprecated") return "neutral";
  return "info";
}

/**
 * Maps the reuse-headline `ViewTone` onto the `BadgeTone` set the StatusBadge accepts.
 *
 * StatusBadge does not currently expose a "generated" tone, so we collapse it onto "info".
 * Every other ViewTone has a 1:1 mapping.
 */
function headlineToneToBadge(tone: CircuitBlockReuseHeadline["tone"]): BadgeTone {
  if (tone === "generated") return "info";
  return tone;
}

/**
 * Formats timestamps for circuit block tables.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
