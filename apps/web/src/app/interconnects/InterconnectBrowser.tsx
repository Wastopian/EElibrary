"use client";

/**
 * File header: Interactive lookup surface for cable, fixture, and pin-map records.
 *
 * One query narrows every Area 2 record type. Scope buttons reduce the visible tables,
 * while the needs-check toggle isolates uncertain or restricted rows without changing
 * persisted engineering status.
 */

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";
import type {
  CableAssembly,
  CableAssemblyEnd,
  CablePinMapRow,
  FixturePort,
  InterconnectDashboardResponse,
  InterconnectPartSummary,
  InterconnectProvenance,
  InterconnectRecordStatus,
  TestFixture
} from "@ee-library/shared/types";

/** InterconnectScope names the record family shown by the segmented control. */
type InterconnectScope = "all" | "cables" | "fixtures" | "pins";

/** InterconnectStatusFilter narrows cable and fixture records to one recorded status, or all. */
type InterconnectStatusFilter = "all" | InterconnectRecordStatus;

/** InterconnectStructuredFilters carries the discoverable project and status dropdown selections. */
interface InterconnectStructuredFilters {
  /** Selected project key, or "all"/null for every project. */
  projectKey?: string | null;
  /** Selected cable/fixture status, or "all" for every status. */
  status?: InterconnectStatusFilter;
}

/** InterconnectProjectOption is one distinct project present in the loaded records. */
interface InterconnectProjectOption {
  key: string;
  label: string;
}

/** STATUS_FILTER_OPTIONS lists the cable/fixture statuses an operator can isolate. */
const STATUS_FILTER_OPTIONS: InterconnectRecordStatus[] = ["approved", "in_review", "draft", "restricted", "retired"];

/** InterconnectBrowserProps carries the complete database-backed Area 2 read model. */
interface InterconnectBrowserProps {
  /** Current cable, fixture, and pin-map records returned by the API. */
  response: InterconnectDashboardResponse;
}

/** Renders the joined search, scope, review filter, and matching record tables. */
export function InterconnectBrowser({ response }: InterconnectBrowserProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<InterconnectScope>("all");
  const [needsCheckOnly, setNeedsCheckOnly] = useState(false);
  const [projectKey, setProjectKey] = useState("all");
  const [status, setStatus] = useState<InterconnectStatusFilter>("all");
  const projectOptions = useMemo(() => buildInterconnectProjectOptions(response), [response]);
  const filtered = useMemo(
    () => filterInterconnectRecords(response, query, needsCheckOnly, { projectKey, status }),
    [needsCheckOnly, projectKey, query, response, status]
  );
  const hasActiveFilters = query.trim().length > 0 || needsCheckOnly || scope !== "all" || projectKey !== "all" || status !== "all";
  const visibleCount =
    (scope === "all" || scope === "cables" ? filtered.cables.length : 0) +
    (scope === "all" || scope === "fixtures" ? filtered.fixtures.length : 0) +
    (scope === "all" || scope === "pins" ? filtered.pinRows.length : 0);

  return (
    <section className="detail-section" aria-labelledby="interconnect-find-heading">
      <SectionHeading
        id="interconnect-find-heading"
        index="01"
        subtitle="Search connector refs, pins, signals, cable IDs, fixture IDs, projects, or source documents."
        title="Find interconnect records"
      />
      <SectionPanel
        description="Results update as you type. Filters narrow this page only and do not change any records."
        title="Cable, fixture, and pin lookup"
      >
        <div className="interconnect-browser">
          <div className="interconnect-browser__toolbar">
            <label className="interconnect-browser__search">
              <span>Search interconnects</span>
              <input
                autoComplete="off"
                name="interconnect-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="J202, pin 47, RS422_TX+, cable or fixture ID"
                type="search"
                value={query}
              />
            </label>

            <label className="interconnect-browser__filter">
              <span>Project</span>
              <select
                name="interconnect-project"
                onChange={(event) => setProjectKey(event.target.value)}
                value={projectKey}
              >
                <option value="all">All projects</option>
                {projectOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="interconnect-browser__filter">
              <span>Cable &amp; fixture status</span>
              <select
                name="interconnect-status"
                onChange={(event) => setStatus(event.target.value as InterconnectStatusFilter)}
                value={status}
              >
                <option value="all">Any status</option>
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option} value={option}>{formatRecordStatus(option)}</option>
                ))}
              </select>
            </label>

            <div className="interconnect-browser__scope" role="group" aria-label="Show record type">
              <InterconnectScopeButton
                active={scope === "all"}
                count={filtered.cables.length + filtered.fixtures.length + filtered.pinRows.length}
                label="All"
                onClick={() => setScope("all")}
              />
              <InterconnectScopeButton
                active={scope === "cables"}
                count={filtered.cables.length}
                label="Cables"
                onClick={() => setScope("cables")}
              />
              <InterconnectScopeButton
                active={scope === "fixtures"}
                count={filtered.fixtures.length}
                label="Fixtures"
                onClick={() => setScope("fixtures")}
              />
              <InterconnectScopeButton
                active={scope === "pins"}
                count={filtered.pinRows.length}
                label="Pins"
                onClick={() => setScope("pins")}
              />
            </div>

            <label className="interconnect-browser__check-filter">
              <input
                checked={needsCheckOnly}
                onChange={(event) => setNeedsCheckOnly(event.target.checked)}
                type="checkbox"
              />
              <span>Needs check only</span>
            </label>
          </div>

          <div className="interconnect-browser__result-bar" aria-live="polite">
            <strong>{visibleCount} matching record{visibleCount === 1 ? "" : "s"}</strong>
            <span>
              {hasActiveFilters
                ? "Showing the current filters."
                : "Showing all cable, fixture, and pin records."}
            </span>
            {query.trim() ? (
              <Link
                className="button-link button-link--quiet"
                href={`/where-used?targetType=document&q=${encodeURIComponent(query.trim())}`}
              >
                Search project documents
              </Link>
            ) : null}
          </div>

          {visibleCount === 0 ? (
            <EmptyState
              body="Try a connector ref, pin number, signal name, cable ID, fixture ID, or clear the needs-check filter."
              title="No interconnect records match"
            />
          ) : (
            <div className="interconnect-browser__results">
              {(scope === "all" || scope === "cables") && filtered.cables.length > 0 ? (
                <InterconnectResultSection count={filtered.cables.length} title="Cable assemblies">
                  <CableAssemblyTable cables={filtered.cables} />
                </InterconnectResultSection>
              ) : null}

              {(scope === "all" || scope === "fixtures") && filtered.fixtures.length > 0 ? (
                <InterconnectResultSection count={filtered.fixtures.length} title="Test fixtures">
                  <TestFixtureTable fixtures={filtered.fixtures} />
                </InterconnectResultSection>
              ) : null}

              {(scope === "all" || scope === "pins") && filtered.pinRows.length > 0 ? (
                <InterconnectResultSection count={filtered.pinRows.length} title="Pin map rows">
                  <PinMapTable rows={filtered.pinRows} />
                </InterconnectResultSection>
              ) : null}
            </div>
          )}
        </div>
      </SectionPanel>
    </section>
  );
}

/** Renders one stable segmented-control button with its current result count. */
function InterconnectScopeButton({
  active,
  count,
  label,
  onClick
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-pressed={active} onClick={onClick} type="button">
      {label} <span>{count}</span>
    </button>
  );
}

/** Wraps one record table with a compact title and matching-row count. */
function InterconnectResultSection({
  children,
  count,
  title
}: {
  children: React.ReactNode;
  count: number;
  title: string;
}) {
  return (
    <section className="interconnect-browser__section">
      <header>
        <h3>{title}</h3>
        <span>{count} shown</span>
      </header>
      {children}
    </section>
  );
}

/** Filters all Area 2 record families against the query, review toggle, and structured filters. */
export function filterInterconnectRecords(
  response: InterconnectDashboardResponse,
  rawQuery: string,
  needsCheckOnly: boolean,
  filters: InterconnectStructuredFilters = {}
): {
  cables: CableAssembly[];
  fixtures: TestFixture[];
  pinRows: CablePinMapRow[];
} {
  const query = rawQuery.trim().toLowerCase();
  const projectKey = filters.projectKey && filters.projectKey !== "all" ? filters.projectKey : null;
  const status = filters.status && filters.status !== "all" ? filters.status : null;
  const cableProjectByKey = buildCableProjectMap(response);
  const cables = response.cableAssemblies.filter(
    (cable) =>
      (!needsCheckOnly || recordNeedsCheck(cable.assemblyStatus)) &&
      (projectKey === null || cable.projectKey === projectKey) &&
      (status === null || cable.assemblyStatus === status) &&
      matchesInterconnectQuery(buildCableSearchText(cable), query)
  );
  const fixtures = response.fixtures.filter(
    (fixture) =>
      (!needsCheckOnly || recordNeedsCheck(fixture.fixtureStatus)) &&
      (projectKey === null || fixture.projectKey === projectKey) &&
      (status === null || fixture.fixtureStatus === status) &&
      matchesInterconnectQuery(buildFixtureSearchText(fixture), query)
  );
  const pinRows = response.pinMapRows.filter(
    (row) =>
      (!needsCheckOnly || row.confidenceScore < 0.75) &&
      (projectKey === null || cableProjectByKey.get(row.cableKey) === projectKey) &&
      matchesInterconnectQuery(buildPinRowSearchText(row), query)
  );

  return { cables, fixtures, pinRows };
}

/** Maps each cable key to its project key so pin rows can inherit project scope for filtering. */
function buildCableProjectMap(response: InterconnectDashboardResponse): Map<string, string> {
  const map = new Map<string, string>();
  for (const cable of response.cableAssemblies) {
    if (cable.projectKey) {
      map.set(cable.cableKey, cable.projectKey);
    }
  }
  return map;
}

/** Builds the distinct project options present across cable and fixture records. */
export function buildInterconnectProjectOptions(response: InterconnectDashboardResponse): InterconnectProjectOption[] {
  const labelByKey = new Map<string, string>();
  for (const cable of response.cableAssemblies) {
    if (cable.projectKey) {
      labelByKey.set(cable.projectKey, formatProjectLabel(cable.projectKey, cable.projectName, null));
    }
  }
  for (const fixture of response.fixtures) {
    if (fixture.projectKey) {
      labelByKey.set(fixture.projectKey, formatProjectLabel(fixture.projectKey, fixture.projectName, null));
    }
  }
  return [...labelByKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Returns true when a normalized query occurs in one prebuilt record corpus. */
function matchesInterconnectQuery(corpus: string, query: string): boolean {
  return !query || corpus.toLowerCase().includes(query);
}

/** Builds searchable text from the cable identity, ends, source, and project context. */
function buildCableSearchText(cable: CableAssembly): string {
  return [
    cable.cableKey,
    cable.revisionLabel,
    cable.assemblyStatus,
    cable.description ?? "",
    cable.owner ?? "",
    cable.projectKey ?? "",
    cable.projectName ?? "",
    cable.projectRevisionLabel ?? "",
    cable.sourceDocumentRef ?? "",
    ...cable.ends.flatMap((end) => [
      end.endLabel,
      end.connectorRef,
      formatPartText(end.connectorPart),
      formatPartText(end.matePart),
      end.notes ?? ""
    ])
  ].join(" ");
}

/** Builds searchable text from fixture identity, ports, source, and project context. */
function buildFixtureSearchText(fixture: TestFixture): string {
  return [
    fixture.fixtureKey,
    fixture.revisionLabel,
    fixture.fixtureStatus,
    fixture.purpose ?? "",
    fixture.owner ?? "",
    fixture.projectKey ?? "",
    fixture.projectName ?? "",
    fixture.sourceDocumentRef ?? "",
    ...fixture.ports.flatMap((port) => [
      port.connectorRef,
      port.portRole ?? "",
      port.cableKey ?? "",
      formatPartText(port.connectorPart),
      formatPartText(port.matePart),
      port.notes ?? ""
    ])
  ].join(" ");
}

/** Builds searchable text from one pin row's complete wiring context. */
function buildPinRowSearchText(row: CablePinMapRow): string {
  return [
    row.cableKey,
    row.revisionLabel,
    row.endLabel,
    row.connectorRef,
    row.pinNumber,
    `pin ${row.pinNumber}`,
    `${row.connectorRef} pin ${row.pinNumber}`,
    row.signalName,
    row.wireColor ?? "",
    row.wireGauge?.toString() ?? "",
    row.destinationConnectorRef ?? "",
    row.destinationPinNumber ?? "",
    row.destinationPinNumber ? `pin ${row.destinationPinNumber}` : "",
    row.destinationConnectorRef && row.destinationPinNumber
      ? `${row.destinationConnectorRef} pin ${row.destinationPinNumber}`
      : "",
    row.sourceDocumentRef ?? "",
    row.notes ?? ""
  ].join(" ");
}

/** Returns true for record states that still need review or careful use. */
function recordNeedsCheck(status: InterconnectRecordStatus): boolean {
  return status === "draft" || status === "in_review" || status === "restricted";
}

/** Renders cable assemblies in a dense workstation table. */
function CableAssemblyTable({ cables }: { cables: CableAssembly[] }) {
  return (
    <div className="where-used-table-wrap interconnect-table-wrap">
      <table className="where-used-table interconnect-table">
        <thead>
          <tr>
            <th>Cable</th>
            <th>Status</th>
            <th>Project</th>
            <th>Connector ends</th>
            <th>Rows</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {cables.map((cable) => <CableAssemblyTableRow cable={cable} key={cable.id} />)}
        </tbody>
      </table>
    </div>
  );
}

/** Renders one cable assembly row with connector ends and linked project context. */
function CableAssemblyTableRow({ cable }: { cable: CableAssembly }) {
  return (
    <tr className={recordNeedsCheck(cable.assemblyStatus) ? "interconnect-table__row--attention" : undefined}>
      <td>
        <Link className="ui-mono interconnect-table__identity interconnect-table__link" href={`/interconnects/cables/${encodeURIComponent(cable.id)}`}>{cable.cableKey}</Link>
        <p className="muted-copy">Revision {cable.revisionLabel} - updated {formatDate(cable.updatedAt)}</p>
        {cable.description ? <p>{cable.description}</p> : null}
      </td>
      <td>
        <StatusBadge label={formatRecordStatus(cable.assemblyStatus)} tone={readRecordStatusTone(cable.assemblyStatus)} />
        <p className="muted-copy">{cable.owner ?? "No owner recorded"}</p>
      </td>
      <td>
        <ProjectReference
          projectId={cable.projectId}
          projectKey={cable.projectKey}
          projectName={cable.projectName}
          revisionLabel={cable.projectRevisionLabel}
        />
      </td>
      <td><CableEndList ends={cable.ends} /></td>
      <td>
        <span>{cable.pinRowCount} pin row{cable.pinRowCount === 1 ? "" : "s"}</span>
        <p className="muted-copy">{cable.fixturePortCount} fixture port{cable.fixturePortCount === 1 ? "" : "s"}</p>
      </td>
      <td><SourceReference provenance={cable.provenance} sourceDocumentRef={cable.sourceDocumentRef} /></td>
    </tr>
  );
}

/** Renders cable end rows with connector and matched-part lookup links. */
function CableEndList({ ends }: { ends: CableAssemblyEnd[] }) {
  if (ends.length === 0) {
    return <span className="muted-copy">No ends recorded</span>;
  }

  return (
    <ul className="where-used-role-list interconnect-link-list">
      {ends.map((end) => (
        <li key={end.id}>
          <Link className="ui-mono interconnect-table__link" href={buildDocumentSearchHref(end.connectorRef)}>
            {end.endLabel}: {end.connectorRef}
          </Link>
          <p className="muted-copy">
            <PartReference part={end.connectorPart} />
            {end.matePart.partId ? <>{` - mates with `}<PartReference part={end.matePart} /></> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Renders test fixtures in a dense workstation table. */
function TestFixtureTable({ fixtures }: { fixtures: TestFixture[] }) {
  return (
    <div className="where-used-table-wrap interconnect-table-wrap">
      <table className="where-used-table interconnect-table">
        <thead>
          <tr>
            <th>Fixture</th>
            <th>Status</th>
            <th>Project</th>
            <th>Ports</th>
            <th>Rows</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {fixtures.map((fixture) => <TestFixtureTableRow fixture={fixture} key={fixture.id} />)}
        </tbody>
      </table>
    </div>
  );
}

/** Renders one test fixture row with port and project links. */
function TestFixtureTableRow({ fixture }: { fixture: TestFixture }) {
  return (
    <tr className={recordNeedsCheck(fixture.fixtureStatus) ? "interconnect-table__row--attention" : undefined}>
      <td>
        <span className="ui-mono interconnect-table__identity">{fixture.fixtureKey}</span>
        <p className="muted-copy">Revision {fixture.revisionLabel} - updated {formatDate(fixture.updatedAt)}</p>
        {fixture.purpose ? <p>{fixture.purpose}</p> : null}
      </td>
      <td>
        <StatusBadge label={formatRecordStatus(fixture.fixtureStatus)} tone={readRecordStatusTone(fixture.fixtureStatus)} />
        <p className="muted-copy">{fixture.owner ?? "No owner recorded"}</p>
      </td>
      <td>
        <ProjectReference
          projectId={fixture.projectId}
          projectKey={fixture.projectKey}
          projectName={fixture.projectName}
          revisionLabel={null}
        />
      </td>
      <td><FixturePortList ports={fixture.ports} /></td>
      <td>
        <span>{fixture.ports.length} port{fixture.ports.length === 1 ? "" : "s"}</span>
        <p className="muted-copy">{fixture.pinRowCount} pin row{fixture.pinRowCount === 1 ? "" : "s"}</p>
      </td>
      <td><SourceReference provenance={fixture.provenance} sourceDocumentRef={fixture.sourceDocumentRef} /></td>
    </tr>
  );
}

/** Renders fixture ports with direct connector-document searches. */
function FixturePortList({ ports }: { ports: FixturePort[] }) {
  if (ports.length === 0) {
    return <span className="muted-copy">No ports recorded</span>;
  }

  return (
    <ul className="where-used-role-list interconnect-link-list">
      {ports.map((port) => (
        <li key={port.id}>
          <Link className="ui-mono interconnect-table__link" href={buildDocumentSearchHref(port.connectorRef)}>
            {port.connectorRef}
          </Link>
          <p className="muted-copy">
            {port.portRole ?? "No role recorded"}
            {port.cableKey ? ` - cable ${port.cableKey}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Renders pin-map rows in a dense workstation table. */
function PinMapTable({ rows }: { rows: CablePinMapRow[] }) {
  return (
    <div className="where-used-table-wrap interconnect-table-wrap">
      <table className="where-used-table interconnect-table interconnect-table--pins">
        <thead>
          <tr>
            <th>Cable</th>
            <th>Connector pin</th>
            <th>Signal</th>
            <th>Wire</th>
            <th>Destination</th>
            <th>Confidence</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <PinMapTableRow row={row} key={row.id} />)}
        </tbody>
      </table>
    </div>
  );
}

/** Renders one pin-map row and visually marks confidence values needing review. */
function PinMapTableRow({ row }: { row: CablePinMapRow }) {
  return (
    <tr className={row.confidenceScore < 0.75 ? "interconnect-table__row--attention" : undefined}>
      <td>
        <span className="ui-mono interconnect-table__identity">{row.cableKey}</span>
        <p className="muted-copy">Revision {row.revisionLabel} - end {row.endLabel}</p>
      </td>
      <td>
        <Link className="ui-mono interconnect-table__link" href={buildDocumentSearchHref(`${row.connectorRef} pin ${row.pinNumber}`)}>
          {row.connectorRef} pin {row.pinNumber}
        </Link>
      </td>
      <td>
        <span>{row.signalName}</span>
        {row.notes ? <p className="muted-copy">{row.notes}</p> : null}
      </td>
      <td>{formatWireLabel(row.wireColor, row.wireGauge)}</td>
      <td>{formatDestinationLabel(row.destinationConnectorRef, row.destinationPinNumber)}</td>
      <td><StatusBadge label={`${Math.round(row.confidenceScore * 100)}%`} tone={readConfidenceTone(row.confidenceScore)} /></td>
      <td>
        {row.sourceDocumentRef ? (
          <Link className="interconnect-table__link" href={buildDocumentSearchHref(row.sourceDocumentRef)}>
            {row.sourceDocumentRef}
          </Link>
        ) : "No source on file"}
      </td>
    </tr>
  );
}

/** Renders a project label as a project-workspace link when an id is available. */
function ProjectReference({
  projectId,
  projectKey,
  projectName,
  revisionLabel
}: {
  projectId: string | null;
  projectKey: string | null;
  projectName: string | null;
  revisionLabel: string | null;
}) {
  const label = formatProjectLabel(projectKey, projectName, revisionLabel);
  return projectId ? (
    <Link className="interconnect-table__link" href={`/projects/${encodeURIComponent(projectId)}`}>
      {label}
    </Link>
  ) : label;
}

/** Renders source type and a document-search link for the source reference. */
function SourceReference({
  provenance,
  sourceDocumentRef
}: {
  provenance: InterconnectProvenance;
  sourceDocumentRef: string | null;
}) {
  return (
    <div className="interconnect-table__source">
      <span>{readSourceLabel(provenance)}</span>
      {sourceDocumentRef ? (
        <Link className="interconnect-table__link" href={buildDocumentSearchHref(sourceDocumentRef)}>
          {sourceDocumentRef}
        </Link>
      ) : null}
    </div>
  );
}

/** Renders a matched catalog part as a detail link and preserves unmatched states. */
function PartReference({ part }: { part: InterconnectPartSummary }) {
  const text = formatPartText(part);
  return part.partId ? (
    <Link className="interconnect-table__link" href={`/parts/${encodeURIComponent(part.partId)}`}>
      {text}
    </Link>
  ) : text;
}

/** Builds a shareable project-document lookup for a connector or source clue. */
function buildDocumentSearchHref(query: string): string {
  return `/where-used?targetType=document&q=${encodeURIComponent(query)}`;
}

/** Chooses a visual tone for cable and fixture status values. */
function readRecordStatusTone(status: InterconnectRecordStatus): BadgeTone {
  if (status === "approved") return "verified";
  if (status === "restricted") return "danger";
  if (status === "in_review") return "review";
  if (status === "retired") return "neutral";
  return "info";
}

/** Chooses a visual tone for pin-map confidence scores. */
function readConfidenceTone(score: number): BadgeTone {
  if (score >= 0.85) return "verified";
  if (score >= 0.75) return "info";
  return "review";
}

/** Formats database status labels for non-technical readers. */
function formatRecordStatus(status: InterconnectRecordStatus): string {
  return status.split("_").map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(" ");
}

/** Formats a project and revision label without implying approval. */
function formatProjectLabel(projectKey: string | null, projectName: string | null, revisionLabel: string | null): string {
  if (!projectKey && !projectName) {
    return "No project recorded";
  }
  const identity = [projectKey, projectName].filter(Boolean).join(" - ");
  return revisionLabel ? `${identity} / ${revisionLabel}` : identity;
}

/** Maps persistent source types to plain-language labels. */
function readSourceLabel(provenance: InterconnectProvenance): string {
  if (provenance === "project_file") return "Project file";
  if (provenance === "bom_import") return "BOM import";
  if (provenance === "connector_catalog") return "Connector catalog";
  return "Typed in by the team";
}

/** Formats an optional part identity without hiding unmatched connector refs. */
function formatPartText(part: InterconnectPartSummary): string {
  if (!part.partId) {
    return "No matched part";
  }
  return [part.manufacturerName, part.mpn ?? part.partId].filter(Boolean).join(" ");
}

/** Formats wire color and gauge as a compact label. */
function formatWireLabel(wireColor: string | null, wireGauge: number | null): string {
  if (!wireColor && !wireGauge) {
    return "No wire detail";
  }
  return [wireColor, wireGauge ? `${wireGauge} AWG` : null].filter(Boolean).join(" / ");
}

/** Formats the optional destination side of a pin-map row. */
function formatDestinationLabel(connectorRef: string | null, pinNumber: string | null): string {
  if (!connectorRef && !pinNumber) return "No destination";
  if (connectorRef && pinNumber) return `${connectorRef} pin ${pinNumber}`;
  return connectorRef ?? `Pin ${pinNumber}`;
}

/** Formats ISO timestamps for workstation display. */
function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}
