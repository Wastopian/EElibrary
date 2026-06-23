/**
 * File header: Renders the global where-used workspace from project-memory usage and circuit-block records.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { fetchApiHealth, fetchWhereUsedSearch, isApiClientError } from "../../lib/api-client";
import { getSetupStateCopy } from "../../lib/setup-state-copy";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { CircuitBlockPartSubstitutionPolicy, ProjectDocumentMapEntry, ProjectDocumentType, ProjectPartUsageStatus, WhereUsedAssetExportRecord, WhereUsedCircuitBlockDependencyRecord, WhereUsedDocumentHitRecord, WhereUsedInterconnectHitKind, WhereUsedInterconnectHitRecord, WhereUsedProjectUsageRecord, WhereUsedSearchResponse, WhereUsedTargetType } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** WhereUsedPageSearchParams mirrors the GET query that drives the where-used workspace. */
type WhereUsedPageSearchParams = {
  q?: string | string[];
  targetType?: string | string[];
};

/** WhereUsedPageState separates first-load, ready, and setup-failure rendering. */
type WhereUsedPageState =
  | { health: ApiHealth | null; query: string; status: "idle"; targetType: WhereUsedTargetType }
  | { health: ApiHealth | null; response: WhereUsedSearchResponse; status: "ready" }
  | { code: string; health: ApiHealth | null; message: string; query: string; status: "setup_required"; targetType: WhereUsedTargetType };

/** WhereUsedQueryExample is one shareable lookup example for a target family. */
interface WhereUsedQueryExample {
  /** Short example label shown before the concrete query value. */
  label: string;
  /** Concrete query value used in the generated example link. */
  query: string;
}

/** WhereUsedQueryGuidance keeps per-target query and recovery copy together. */
interface WhereUsedQueryGuidance {
  /** One-sentence target-specific query hint. */
  hint: string;
  /** Concrete examples that can be opened as shareable where-used searches. */
  examples: WhereUsedQueryExample[];
  /** Recovery hint shown when a query returns no persisted results. */
  recovery: string;
}

/** WhereUsedPageProps carries Next.js search params as an awaited value in this app version. */
interface WhereUsedPageProps {
  searchParams: Promise<WhereUsedPageSearchParams>;
}

/**
 * Renders global where-used search without treating historical usage as approval.
 */
export default async function WhereUsedPage({ searchParams }: WhereUsedPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = readSingleParam(resolvedSearchParams.q);
  const targetType = readWhereUsedTargetType(readSingleParam(resolvedSearchParams.targetType));
  const pageState = await loadWhereUsedPage(targetType, query);
  const jumpItems = [
    { href: "#where-used-search-heading", label: "Search" },
    { href: "#where-used-results-heading", label: "Results" },
    { href: "#where-used-boundaries-heading", label: "Boundaries" }
  ];

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Where-used</p>
            <h1>Usage and dependency search</h1>
            <p className="projects-hero__lede">
              Find every place a part, asset, circuit block, or project document clue appears. Past use does not approve a part for a new project.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label="Historical context only" tone="review" />
              <StatusBadge label={pageState.health ? `API ${pageState.health.status}` : "API health unavailable"} tone={pageState.health ? "info" : "review"} />
              <StatusBadge label={`Database ${pageState.health?.dependencies.database ?? "unknown"}`} tone={pageState.health?.dependencies.database === "connected" ? "verified" : "review"} />
            </div>
          </div>
          {pageState.status === "ready" ? <WhereUsedSnapshot response={pageState.response} /> : pageState.status === "setup_required" ? <WhereUsedSetupSnapshot /> : <WhereUsedIdleSnapshot />}
        </div>
      </section>

      <WorkspaceJumpNav ariaLabel="Where-used sections" items={jumpItems} />

      <section className="detail-section" aria-labelledby="where-used-search-heading">
        <SectionHeading id="where-used-search-heading" index="01" subtitle={pageState.status === "setup_required" ? "Connect project memory to search where things are used." : "Find a part, circuit block, connector set, exported asset, or project document clue and see where it appears."} title="Search memory" />
        <SectionPanel description={pageState.status === "setup_required" ? "Where-used search is paused until projects are connected." : "Search by part number, block key, connector ref, pin, cable id, fixture id, or signal."} title={pageState.status === "setup_required" ? "Projects unavailable" : "Where-used lookup"}>
          {pageState.status === "setup_required"
            ? <WhereUsedSearchSetupState state={pageState} />
            : <WhereUsedSearchForm query={pageState.status === "ready" ? pageState.response.query : pageState.query} targetType={pageState.status === "ready" ? pageState.response.targetType : pageState.targetType} />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="where-used-results-heading">
        <SectionHeading id="where-used-results-heading" index="02" subtitle="Grouped by project usage and reusable circuit roles." title="Results" />
        <SectionPanel description="Past use is information only. It does not approve parts or files." title={getResultsTitle(pageState)}>
          <WhereUsedResults state={pageState} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="where-used-boundaries-heading">
        <SectionHeading id="where-used-boundaries-heading" index="03" subtitle="Where-used is reference info. It does not approve parts or files on its own." title="Boundaries" />
        <div className="projects-truth-rail projects-truth-rail--compact">
          <div>
            <span>Confirmed usage</span>
            <strong>Project usage starts from matched BOM rows.</strong>
            <p>Weak or ambiguous BOM rows stay out of confirmed history until matching evidence is strong enough.</p>
          </div>
          <div>
            <span>Circuit roles</span>
            <strong>Block membership is dependency context.</strong>
            <p>A block role does not approve the part, validate evidence, or make the part export-ready.</p>
          </div>
          <div>
            <span>Connector sets</span>
            <strong>Connector-set search returns the connector and its mates.</strong>
            <p>Project usages and block roles are shown for the matched connector and any linked best-mate or alternate-mate parts.</p>
          </div>
          <div>
            <span>Asset exports</span>
            <strong>Asset search returns export bundles that included the part's assets.</strong>
            <p>Results come from export bundle manifests. A part appearing in an export bundle does not mean the part is approved or that the design is released.</p>
          </div>
          <div>
            <span>Project documents</span>
            <strong>Document search reads current project file maps.</strong>
            <p>Document hits come from filenames, small text files, and completed PDF or Office reading. They do not mean the file was reviewed or approved.</p>
          </div>
          <div>
            <span>Cables &amp; fixtures</span>
            <strong>Interconnect search reads recorded cable, fixture, and pin-map memory.</strong>
            <p>Hits show what is on file for a connector ref, cable, fixture, pin, or signal. They do not approve a part or prove a bench setup is safe to reuse.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * Loads the where-used response only after the user provides a query.
 */
async function loadWhereUsedPage(targetType: WhereUsedTargetType, query: string): Promise<WhereUsedPageState> {
  const healthPromise = fetchApiHealth().catch(() => null);

  if (query.trim().length === 0) {
    const health = await healthPromise;

    if (!health) {
      return {
        code: "API_UNAVAILABLE",
        health,
        message: "The API health endpoint could not be reached, so where-used backing cannot be confirmed.",
        query,
        status: "setup_required",
        targetType
      };
    }

    if (health && !isProjectMemoryConnected(health)) {
      return {
        code: "DB_NOT_CONFIGURED",
        health,
        message: "Where-used search requires the project-memory database before target coverage can be claimed.",
        query,
        status: "setup_required",
        targetType
      };
    }

    return {
      health,
      query,
      status: "idle",
      targetType
    };
  }

  try {
    const [health, response] = await Promise.all([healthPromise, fetchWhereUsedSearch(targetType, query)]);

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
        query,
        status: "setup_required",
        targetType
      };
    }

    return {
      code: "API_UNAVAILABLE",
      health: await healthPromise,
      message: "The API could not be reached, so where-used memory cannot be read.",
      query,
      status: "setup_required",
      targetType
    };
  }
}

/**
 * Checks whether health confirms the persistence layer needed by where-used search.
 */
function isProjectMemoryConnected(health: ApiHealth): boolean {
  return health.dependencies.database === "connected";
}

/**
 * Renders the search controls as a simple GET form so the result URL is shareable.
 */
function WhereUsedSearchForm({ query, targetType }: { query: string; targetType: WhereUsedTargetType }) {
  return (
    <div className="where-used-search-panel">
      <form className="where-used-search-form" method="get">
        <label>
          <span>Target</span>
          <select defaultValue={targetType} name="targetType">
            <option value="part">Part</option>
            <option value="circuit_block">Circuit block</option>
            <option value="connector_set">Connector set</option>
            <option value="asset">Asset</option>
            <option value="document">Project documents</option>
            <option value="interconnect">Cables &amp; fixtures</option>
          </select>
        </label>
        <label className="where-used-search-form__query">
          <span>Query</span>
          <input defaultValue={query} name="q" placeholder={getWhereUsedQueryGuidance(targetType).examples.map((example) => example.query).join(" or ")} type="search" />
        </label>
        <button className="button-primary" type="submit">Search</button>
      </form>
      <WhereUsedQueryGuidancePanel targetType={targetType} />
    </div>
  );
}

/**
 * Renders setup guidance in place of query controls when project memory is unavailable.
 */
function WhereUsedSearchSetupState({ state }: { state: Extract<WhereUsedPageState, { status: "setup_required" }> }) {
  const copy = getSetupStateCopy(state.code);
  return <EmptyState title={copy.headline} body={`${copy.body} (${state.code}: ${state.message})`} />;
}

/**
 * Renders a neutral snapshot before the first search.
 */
function WhereUsedIdleSnapshot() {
  return (
    <div className="projects-stat-grid">
      <WhereUsedStat label="Targets" tone="info" value="6" />
      <WhereUsedStat label="Backed now" tone="verified" value="6" />
      <WhereUsedStat label="Trust" tone="review" value="Bounded" />
      <WhereUsedStat label="Export" tone="neutral" value="No change" />
    </div>
  );
}

/**
 * Renders neutral setup tiles so unavailable persistence is not counted as backed capability.
 */
function WhereUsedSetupSnapshot() {
  return (
    <div className="projects-stat-grid">
      <WhereUsedStat label="Targets" tone="neutral" value="-" />
      <WhereUsedStat label="Backed now" tone="review" value="DB" />
      <WhereUsedStat label="Trust" tone="review" value="Setup" />
      <WhereUsedStat label="Export" tone="neutral" value="No change" />
    </div>
  );
}

/**
 * Renders result counts without collapsing them into a reuse score.
 */
function WhereUsedSnapshot({ response }: { response: WhereUsedSearchResponse }) {
  return (
    <div className="projects-stat-grid">
      <WhereUsedStat label="Part matches" tone="info" value={response.matchedParts.length.toString()} />
      <WhereUsedStat label="Block matches" tone="info" value={response.matchedCircuitBlocks.length.toString()} />
      <WhereUsedStat label="Project usages" tone={response.projectUsages.length > 0 ? "verified" : "neutral"} value={response.projectUsages.length.toString()} />
      <WhereUsedStat label="Block roles" tone={response.circuitBlockDependencies.length > 0 ? "review" : "neutral"} value={response.circuitBlockDependencies.length.toString()} />
      {response.assetExports.length > 0 && <WhereUsedStat label="Export bundles" tone="verified" value={response.assetExports.length.toString()} />}
      {response.documentHits.length > 0 && <WhereUsedStat label="Document hits" tone="info" value={response.documentHits.length.toString()} />}
      {response.interconnectHits.length > 0 && <WhereUsedStat label="Cable/fixture hits" tone="info" value={response.interconnectHits.length.toString()} />}
    </div>
  );
}

/**
 * Renders one compact count tile.
 */
function WhereUsedStat({ label, tone, value }: { label: string; tone: BadgeTone; value: string }) {
  return (
    <div className={`projects-stat projects-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Renders the correct results state for idle, setup, unsupported, empty, and populated searches.
 */
function WhereUsedResults({ state }: { state: WhereUsedPageState }) {
  if (state.status === "idle") {
    return <WhereUsedIdleRecovery />;
  }

  if (state.status === "setup_required") {
    const copy = getSetupStateCopy(state.code);
    return <EmptyState title={copy.headline} body={`${copy.body} (${state.code}: ${state.message})`} />;
  }

  const { response } = state;

  if (!response.supportedTarget) {
    return <EmptyState title={`${formatWhereUsedTargetType(response.targetType)} where-used is not searchable yet`} body={response.unsupportedReason ?? "This kind of target is not searchable yet. Try searching by part number, circuit block, or asset."} />;
  }

  if (response.state === "empty") {
    return (
      <div className="where-used-empty-recovery">
        <EmptyState title="No where-used records found" body={`No persisted ${formatWhereUsedTargetType(response.targetType).toLowerCase()} usage or dependency records matched "${response.query}".`} />
        <WhereUsedRecoveryHint targetType={response.targetType} />
      </div>
    );
  }

  return (
    <div className="where-used-global-results">
      <details className="where-used-panel__boundary">
        <summary><strong>Trust boundary</strong></summary>
        <p>{response.boundary}</p>
      </details>
      <WhereUsedMatchSummary response={response} />
      {response.projectUsages.length > 0
        ? <WhereUsedProjectUsageTable records={response.projectUsages} />
        : response.assetExports.length === 0 && response.documentHits.length === 0 && response.interconnectHits.length === 0
          ? <EmptyState title="No confirmed project usage" body="This part may still appear in circuit blocks or export bundles below, even if no project BOM has used it yet." />
          : null}
      {response.circuitBlockDependencies.length > 0 ? <WhereUsedCircuitDependencyTable records={response.circuitBlockDependencies} /> : null}
      {response.assetExports.length > 0 ? <WhereUsedAssetExportTable records={response.assetExports} /> : null}
      {response.documentHits.length > 0 ? <WhereUsedDocumentHitTable records={response.documentHits} /> : null}
      {response.interconnectHits.length > 0 ? <WhereUsedInterconnectHitTable records={response.interconnectHits} /> : null}
    </div>
  );
}

/**
 * Renders first-run where-used guidance with concrete places to find searchable identifiers.
 */
function WhereUsedIdleRecovery() {
  return (
    <div className="where-used-empty-recovery">
      <EmptyState
        title="Start with a saved part or project"
        body="Use Catalog or Projects to find an exact part number, internal part record, circuit block key, connector, or project asset before searching where-used memory."
      />
      <div className="empty-recovery-actions" aria-label="Where-used recovery actions">
        <Link className="button-link" href="/catalog">Find parts in Catalog</Link>
        <Link className="button-link button-link--quiet" href="/projects">Open project BOMs</Link>
        <Link className="button-link button-link--quiet" href="/connector-sets">Browse connector sets</Link>
      </div>
    </div>
  );
}

/**
 * Renders target-specific query examples beside the where-used form.
 */
function WhereUsedQueryGuidancePanel({ targetType }: { targetType: WhereUsedTargetType }) {
  const guidance = getWhereUsedQueryGuidance(targetType);

  return (
    <div className="where-used-query-guidance">
      <div className="where-used-query-guidance__copy">
        <span>Query examples</span>
        <p>{guidance.hint}</p>
      </div>
      <div className="where-used-query-guidance__examples">
        {guidance.examples.map((example) => (
          <Link href={buildWhereUsedExampleHref(targetType, example.query)} key={`${targetType}:${example.query}`}>
            {example.label}: <strong>{example.query}</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders a no-result recovery hint that matches the selected target family.
 */
function WhereUsedRecoveryHint({ targetType }: { targetType: WhereUsedTargetType }) {
  return (
    <div className="where-used-recovery-hint">
      <span>No-result recovery</span>
      <p>{getWhereUsedQueryGuidance(targetType).recovery}</p>
    </div>
  );
}

/**
 * Renders matched identities before detailed rows.
 */
function WhereUsedMatchSummary({ response }: { response: WhereUsedSearchResponse }) {
  if (response.matchedParts.length === 0 && response.matchedCircuitBlocks.length === 0) {
    return null;
  }

  return (
    <div className="where-used-match-grid">
      {response.matchedParts.map((part) => (
        <div className="where-used-match" key={part.partId}>
          <span>Part</span>
          <Link href={`/parts/${encodeURIComponent(part.partId)}`}>{part.mpn}</Link>
          <p>{part.manufacturerName} · readiness {part.readinessStatus ?? "unknown"} · approval {part.approvalStatus ?? "missing"}</p>
        </div>
      ))}
      {response.matchedCircuitBlocks.map((summary) => (
        <div className="where-used-match" key={summary.circuitBlock.id}>
          <span>Circuit block</span>
          <Link href={`/circuit-blocks/${encodeURIComponent(summary.circuitBlock.id)}`}>{summary.circuitBlock.blockKey}</Link>
          <p>{summary.circuitBlock.name} · {summary.totalPartCount} roles · {summary.readinessGapCount} readiness gaps</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders confirmed project usage rows with project, revision, BOM, and optional circuit role context.
 */
function WhereUsedProjectUsageTable({ records }: { records: WhereUsedProjectUsageRecord[] }) {
  return (
    <div className="where-used-table-wrap">
      <table className="where-used-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Revision</th>
            <th>Part</th>
            <th>Usage</th>
            <th>Circuit role</th>
            <th>BOM row</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.usage.id}:${record.blockPart?.id ?? "part"}`}>
              <td>
                <Link href={`/projects/${encodeURIComponent(record.project.id)}`}>{record.project.projectKey}</Link>
                <p>{record.project.name}</p>
              </td>
              <td>
                <span>{record.projectRevision.revisionLabel}</span>
                <p>{formatUsageStatus(record.usage.usageStatus)}</p>
              </td>
              <td>
                <Link href={`/parts/${encodeURIComponent(record.part.partId)}`}>{record.part.mpn}</Link>
                <p>{record.part.manufacturerName}</p>
              </td>
              <td>
                <span>{record.usage.designators.length > 0 ? record.usage.designators.join(", ") : "No designator"}</span>
                <p>Quantity {record.usage.quantity ?? "unknown"}</p>
              </td>
              <td>
                {record.circuitBlock && record.blockPart ? (
                  <>
                    <Link href={`/circuit-blocks/${encodeURIComponent(record.circuitBlock.id)}`}>{record.circuitBlock.blockKey}</Link>
                    <p>{record.blockPart.role}</p>
                  </>
                ) : (
                  <span>Direct part usage</span>
                )}
              </td>
              <td>
                <span>{record.bomLine ? `Row ${record.bomLine.rowNumber}` : "No BOM row"}</span>
                <p>{record.bomLine?.rawMpn ?? record.usage.usageContext ?? "Confirmed usage record"}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders circuit block dependency rows independently from project usage.
 */
function WhereUsedCircuitDependencyTable({ records }: { records: WhereUsedCircuitBlockDependencyRecord[] }) {
  return (
    <div className="where-used-table-wrap">
      <table className="where-used-table">
        <thead>
          <tr>
            <th>Circuit block</th>
            <th>Role</th>
            <th>Part</th>
            <th>Requirement</th>
            <th>Part state</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.blockPart.id}>
              <td>
                <Link href={`/circuit-blocks/${encodeURIComponent(record.circuitBlock.id)}`}>{record.circuitBlock.blockKey}</Link>
                <p>{record.circuitBlock.name}</p>
              </td>
              <td>
                <span>{record.blockPart.role}</span>
                <p>{formatSubstitutionPolicy(record.blockPart.substitutionPolicy)}</p>
              </td>
              <td>
                <Link href={`/parts/${encodeURIComponent(record.part.partId)}`}>{record.part.mpn}</Link>
                <p>{record.part.manufacturerName}</p>
              </td>
              <td>
                <span>{record.blockPart.isRequired ? "Required" : "Optional"}</span>
                <p>Quantity {record.blockPart.quantity ?? "not fixed"}</p>
              </td>
              <td>
                <span>{record.part.approvalStatus ?? "approval missing"}</span>
                <p>{record.part.readinessStatus ?? "readiness unknown"} · blockers {record.part.blockerCount ?? "unknown"}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders export bundle rows that included assets for the matched part.
 */
function WhereUsedAssetExportTable({ records }: { records: WhereUsedAssetExportRecord[] }) {
  return (
    <div className="where-used-table-wrap">
      <h4 className="form-section-label">Export bundle inclusions</h4>
      <table className="where-used-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Bundle format</th>
            <th>Part MPN</th>
            <th>Asset type</th>
            <th>Generated</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, i) => (
            <tr key={`${record.bundleId}-${record.assetId}-${i}`}>
              <td>
                <Link href={`/projects/${encodeURIComponent(record.projectId)}`}>{record.projectKey}</Link>
                <p>{record.projectName}</p>
              </td>
              <td>
                <StatusBadge label={record.bundleFormat} tone="info" />
              </td>
              <td className="ui-mono">{record.partMpn}</td>
              <td>{record.assetType.replace(/_/gu, " ")}</td>
              <td className="ui-mono">{new Date(record.bundleCreatedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders project document hits from the live file-map scan.
 */
function WhereUsedDocumentHitTable({ records }: { records: WhereUsedDocumentHitRecord[] }) {
  return (
    <div className="where-used-table-wrap">
      <h4 className="form-section-label">Project document hits</h4>
      <table className="where-used-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>File</th>
            <th>Type</th>
            <th>Matched clues</th>
            <th>Suggested place</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.project.id}:${record.document.relativePath}`}>
              <td>
                <Link href={`/projects/${encodeURIComponent(record.project.id)}#project-files-heading`}>{record.project.projectKey}</Link>
                <p>{record.project.name}</p>
              </td>
              <td>
                <span className="ui-mono">{record.document.filename}</span>
                <p>{record.document.relativePath}</p>
              </td>
              <td>
                <span>{formatProjectDocumentType(record.document.documentType)}</span>
                <p>{Math.round(record.document.confidenceScore * 100)}% scan confidence</p>
              </td>
              <td>
                <ul className="where-used-role-list">
                  {record.matchedLabels.slice(0, 4).map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
                <p>{formatProjectDocumentSignals(record.document)}</p>
              </td>
              <td>
                <span>{formatProjectDocumentSortAction(record.document)}</span>
                <p>{record.document.sortPlan.targetRelativePath ?? record.document.parentFolder}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders matched interconnect memory rows (cables, fixture ports, pin maps).
 */
function WhereUsedInterconnectHitTable({ records }: { records: WhereUsedInterconnectHitRecord[] }) {
  return (
    <div className="where-used-table-wrap">
      <h4 className="form-section-label">Cable, fixture, and pin-map hits</h4>
      <table className="where-used-table">
        <thead>
          <tr>
            <th>Record</th>
            <th>Cable / Fixture</th>
            <th>Connector</th>
            <th>Pin / Signal</th>
            <th>Destination</th>
            <th>Status</th>
            <th>Matched</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.kind}:${record.recordId}`}>
              <td>{formatInterconnectHitKind(record.kind)}</td>
              <td>
                <Link href="/interconnects">{record.cableKey ?? record.fixtureKey ?? "Unlabeled"}</Link>
                <p>{record.revisionLabel ? `Rev ${record.revisionLabel}` : "No revision"}{record.projectKey ? ` · ${record.projectKey}` : ""}</p>
              </td>
              <td>
                <span className="ui-mono">{record.connectorRef ?? "—"}</span>
                <p>{record.endLabel ? `End ${record.endLabel}` : "No end"}</p>
              </td>
              <td>
                <span className="ui-mono">{record.pinNumber ? `Pin ${record.pinNumber}` : "—"}</span>
                <p>{record.signalName ?? "No signal recorded"}</p>
              </td>
              <td>
                <span className="ui-mono">{record.destinationConnectorRef ?? "—"}</span>
                <p>{record.destinationPinNumber ? `Pin ${record.destinationPinNumber}` : ""}</p>
              </td>
              <td>
                <span>{record.status ? record.status.replace(/_/gu, " ") : "—"}</span>
                <p>{record.confidenceScore !== null ? `${Math.round(record.confidenceScore * 100)}% confidence` : ""}</p>
              </td>
              <td>
                <ul className="where-used-role-list">
                  {record.matchedLabels.length > 0
                    ? record.matchedLabels.slice(0, 3).map((label) => <li key={label}>{label}</li>)
                    : <li>Matched interconnect record</li>}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Formats an interconnect hit kind for the where-used table. */
function formatInterconnectHitKind(kind: WhereUsedInterconnectHitKind): string {
  if (kind === "pin_map_row") return "Pin map row";
  if (kind === "cable_end") return "Cable end";
  return "Fixture port";
}

/**
 * Builds the result panel title from current page state.
 */
function getResultsTitle(state: WhereUsedPageState): string {
  if (state.status === "idle") {
    return "No search yet";
  }

  if (state.status === "setup_required") {
    return "Where-used unavailable";
  }

  if (!state.response.supportedTarget) {
    return "Planned target";
  }

  return state.response.state === "available" ? `Results for ${state.response.query}` : "No persisted matches";
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
 * Returns target-specific query examples and empty-state recovery copy.
 */
function getWhereUsedQueryGuidance(targetType: WhereUsedTargetType): WhereUsedQueryGuidance {
  if (targetType === "circuit_block") {
    return {
      examples: [
        { label: "Block id", query: "cblock-alpha-power" },
        { label: "Block key", query: "ALPHA-POWER" }
      ],
      hint: "Circuit block searches match the persisted block id or block key and then expand to its part roles.",
      recovery: "Try the exact circuit block id shown near the block title, or use the uppercase block key shown in the circuit block library."
    };
  }

  if (targetType === "connector_set") {
    return {
      examples: [
        { label: "Connector part id", query: "part-memory-jst-header" },
        { label: "Connector MPN", query: "B4B-XH-A" }
      ],
      hint: "Connector-set searches start from a connector part id or MPN and include linked best-mate and alternate-mate parts.",
      recovery: "Switch to a connector part id or exact connector MPN; non-connector parts will not produce connector-set mate expansion."
    };
  }

  if (targetType === "asset") {
    return {
      examples: [
        { label: "Part id", query: "part-memory-ldo" },
        { label: "MPN", query: "TPS7A02DBVR" }
      ],
      hint: "Asset searches use the part id or MPN, then return export bundles whose manifests included that part's assets.",
      recovery: "Search the owning part id or MPN instead of an asset id; asset results come from export bundle manifests."
    };
  }

  if (targetType === "document") {
    return {
      examples: [
        { label: "Connector", query: "J202" },
        { label: "Pin", query: "pin 47" },
        { label: "Question", query: "Which test procedure uses connector J202?" }
      ],
      hint: "Project document searches use the current file map and match connector refs, pins, cables, fixtures, revisions, signals, filenames, and clear document types.",
      recovery: "Open the project files panel and check that the document map sees the folder. PDF and Office body text need a later extraction pass; filenames and small text-like files are searchable now."
    };
  }

  if (targetType === "interconnect") {
    return {
      examples: [
        { label: "Connector ref", query: "J202" },
        { label: "Signal", query: "CAN_H" },
        { label: "Pin", query: "47" }
      ],
      hint: "Cable & fixture searches read recorded interconnect memory: connector refs and pin numbers match exactly, while cable ids, fixture ids, and signal names match as you type part of the name.",
      recovery: "Connector refs and pins must match exactly (try J202, not J-202). For cables, fixtures, and signals, part of the name works. Open the Interconnects workspace to see what is recorded."
    };
  }

  return {
    examples: [
      { label: "Part id", query: "part-memory-ldo" },
      { label: "MPN", query: "TPS7A02DBVR" }
    ],
    hint: "Part searches match an internal part id or exact MPN before showing confirmed project usage and circuit dependencies.",
    recovery: "Try the internal part id shown on the part detail page first; if that misses, retry with the exact manufacturer part number from the catalog row."
  };
}

/**
 * Builds a shareable where-used example link for one target and query.
 */
function buildWhereUsedExampleHref(targetType: WhereUsedTargetType, query: string): string {
  const params = new URLSearchParams({
    q: query,
    targetType
  });

  return `/where-used?${params.toString()}`;
}

/**
 * Parses where-used target types while defaulting invalid query strings to part.
 */
function readWhereUsedTargetType(value: string): WhereUsedTargetType {
  if (value === "circuit_block" || value === "connector_set" || value === "asset" || value === "document" || value === "interconnect") {
    return value;
  }

  return "part";
}

/**
 * Formats target labels for page copy.
 */
function formatWhereUsedTargetType(targetType: WhereUsedTargetType): string {
  if (targetType === "circuit_block") return "Circuit block";
  if (targetType === "connector_set") return "Connector set (with mates)";
  if (targetType === "asset") return "Asset (export bundles)";
  if (targetType === "document") return "Project documents";
  if (targetType === "interconnect") return "Cables & fixtures";
  return "Part";
}

/** Formats a document-map type in the global where-used table. */
function formatProjectDocumentType(documentType: ProjectDocumentType): string {
  return {
    archive: "Archive",
    cad_model: "CAD model",
    cable_doc: "Cable or harness doc",
    datasheet: "Datasheet or app note",
    drawing: "Drawing",
    fixture_doc: "Fixture doc",
    parts_list: "Parts list",
    pinout: "Connector pinout",
    requirements: "Requirements",
    review_note: "Review note",
    schematic: "Schematic or board file",
    test_procedure: "Test procedure",
    unknown: "Needs sorting"
  }[documentType];
}

/** Formats one document-map row's most useful clue groups. */
function formatProjectDocumentSignals(entry: ProjectDocumentMapEntry): string {
  const groups = [
    entry.signals.connectorRefs.length > 0 ? `Connectors ${entry.signals.connectorRefs.slice(0, 3).join(", ")}` : null,
    entry.signals.pinRefs.length > 0 ? `Pins ${entry.signals.pinRefs.slice(0, 3).join(", ")}` : null,
    entry.signals.cableKeys.length > 0 ? `Cables ${entry.signals.cableKeys.slice(0, 2).join(", ")}` : null,
    entry.signals.fixtureKeys.length > 0 ? `Fixtures ${entry.signals.fixtureKeys.slice(0, 2).join(", ")}` : null,
    entry.signals.signalNames.length > 0 ? `Signals ${entry.signals.signalNames.slice(0, 2).join(", ")}` : null
  ].filter((value): value is string => Boolean(value));

  return groups.length > 0 ? groups.join(" - ") : "No stored clues";
}

/** Formats the current file-map suggestion without implying that a move has happened. */
function formatProjectDocumentSortAction(entry: ProjectDocumentMapEntry): string {
  if (entry.sortPlan.action === "leave_in_place") return "Leave here";
  if (entry.sortPlan.action === "move_to_standard_folder") return `Copy to ${entry.sortPlan.targetFolderLabel ?? "standard folder"}`;
  if (entry.sortPlan.action === "review_unknown") return "Open and sort";
  return "Choose folder";
}

/**
 * Formats project usage status values for operators.
 */
function formatUsageStatus(status: ProjectPartUsageStatus): string {
  return status.replace(/_/gu, " ");
}

/**
 * Formats circuit block substitution policy values.
 */
function formatSubstitutionPolicy(policy: CircuitBlockPartSubstitutionPolicy): string {
  return policy.replace(/_/gu, " ");
}
