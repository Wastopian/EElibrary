/**
 * File header: Renders the read-only project memory dashboard for persisted project/BOM foundations.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { ProjectCreatePanel } from "../../components/ProjectCreatePanel";
import { ProjectsBrowser } from "../../components/ProjectsBrowser";
import { fetchApiHealth, fetchProjectFleetRisk, fetchProjectListEnvelope, isApiClientError } from "../../lib/api-client";
import { getSetupStateCopy } from "../../lib/setup-state-copy";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { CatalogDataSource, ProjectFleetRiskResponse, ProjectFleetRiskRow, ProjectListResponse, ProjectMemoryCapability, ProjectMemoryCapabilityState, ProjectSummary } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** ProjectsDashboardState separates ready project-memory reads from setup/recovery states. */
type ProjectsDashboardState =
  | {
      fleetRisk: ProjectFleetRiskResponse | null;
      health: ApiHealth | null;
      response: ProjectListResponse;
      source: CatalogDataSource;
      status: "ready";
    }
  | {
      code: string;
      health: ApiHealth | null;
      message: string;
      status: "setup_required";
    };

/**
 * Renders the project-memory dashboard (fleet risk, BOM import/match, revision compare, export bundles, etc.).
 */
export default async function ProjectsPage() {
  const dashboardState = await loadProjectsDashboard();

  if (dashboardState.status === "setup_required") {
    return <ProjectsSetupState dashboardState={dashboardState} />;
  }

  const { fleetRisk, health, response, source } = dashboardState;
  const foundationCapabilities = response.capabilities.filter((capability) => capability.state === "foundation");
  const plannedCapabilities = response.capabilities.filter((capability) => capability.state === "planned");
  const fleetRows = fleetRisk?.rows ?? [];

  return (
    <main className="projects-layout">
      <section className="projects-hero projects-hero--slim">
        <div className="projects-hero__copy">
          <p className="app-kicker">Projects</p>
          <h1>Your projects</h1>
          <p className="projects-hero__lede">
            Pick a project to see its parts. Use where-used to find which projects already use a part.
          </p>
          <div className="empty-recovery-actions" aria-label="Project quick actions">
            <Link className="button-link" href="/projects/new">Drop a BOM, see your project</Link>
            <a className="button-link button-link--quiet" href="#project-create-heading">Create empty project</a>
            <Link className="button-link button-link--quiet" href="/where-used">Search where a part is used</Link>
          </div>
        </div>
      </section>

      <section className="detail-section" aria-labelledby="projects-list-heading">
        <SectionHeading
          id="projects-list-heading"
          subtitle="Search by name, key, or owner. Click a project to see its parts."
          title="Project records"
        />
        <SectionPanel
          description={response.projects.length > 0
            ? "Click any project to open its parts and uploads."
            : "No projects yet. Create one below to start tracking parts and uploads."}
          title={response.projects.length > 0 ? `${response.projects.length} project records` : "No projects yet"}
        >
          {response.projects.length > 0 ? <ProjectsBrowser projects={response.projects} /> : <ProjectsEmptyState />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-create-heading">
        <SectionHeading
          id="project-create-heading"
          subtitle="A project gives parts uploads a home."
          title="Create project"
        />
        <SectionPanel
          description="Create a project first. You can upload a parts list from the project page once it exists."
          title="New project"
        >
          <ProjectCreatePanel />
        </SectionPanel>
      </section>

      <details className="projects-advanced">
        <summary>Advanced project tools</summary>
        <p className="projects-advanced__lede muted-copy">
          Risk dashboards, capability state, and provenance boundaries. Most engineers can ignore these.
        </p>

        <div className="projects-advanced__status" role="group" aria-label="Project memory status">
          <StatusBadge label={source === "seed_fallback" ? "Sample data only" : "Live project data"} tone={source === "database" ? "verified" : "review"} />
          <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
          <StatusBadge label={`Database ${health?.dependencies.database ?? "unknown"}`} tone={health?.dependencies.database === "connected" ? "verified" : "review"} />
        </div>

        <ProjectMemorySnapshot projects={response.projects} />

        {fleetRows.length > 0 && (
          <section className="detail-section" aria-labelledby="projects-fleet-risk-heading">
            <SectionHeading
              id="projects-fleet-risk-heading"
              subtitle="Risk and gap counts across every project, drawn from saved BOMs, lifecycle, CAD, and follow-up state."
              title="Fleet risk dashboard"
            />
            <SectionPanel
              description={fleetRisk?.boundary ?? "Counts are explainable inputs only. They do not approve parts, validate assets, or unlock export."}
              title={`${fleetRows.length} project${fleetRows.length === 1 ? "" : "s"} ranked by total risk count`}
            >
              <ProjectFleetRiskTable rows={fleetRows} />
            </SectionPanel>
          </section>
        )}

        <section className="detail-section" aria-labelledby="project-foundations-heading">
          <SectionHeading id="project-foundations-heading" subtitle="What the API can read today." title="Current foundations" />
          <SectionPanel description="Foundations mean the API persists this stage. Approval, evidence, and export remain separate states." title="Readable foundations">
            <CapabilityList capabilities={foundationCapabilities} />
          </SectionPanel>
        </section>

        {plannedCapabilities.length > 0 ? (
          <section className="detail-section" aria-labelledby="planned-project-memory-heading">
            <SectionHeading id="planned-project-features-heading" subtitle="Visible as planned work, not shipped behavior." title="Planned project features" />
            <SectionPanel
              description="The next work turns foundation data into richer project workflows."
              title="Near-term project workflow"
            >
              <CapabilityList capabilities={plannedCapabilities} />
            </SectionPanel>
          </section>
        ) : null}

        <ProjectMemoryTruthRail />
      </details>
    </main>
  );
}

/**
 * Loads dashboard data while preserving a route-level setup state for unavailable persistence.
 */
async function loadProjectsDashboard(): Promise<ProjectsDashboardState> {
  const healthPromise = fetchApiHealth();

  try {
    const [health, envelope] = await Promise.all([healthPromise, fetchProjectListEnvelope()]);
    let fleetRisk: ProjectFleetRiskResponse | null = null;
    try {
      fleetRisk = await fetchProjectFleetRisk();
    } catch {
      fleetRisk = null;
    }

    return {
      fleetRisk,
      health,
      response: envelope.data,
      source: envelope.source ?? "database",
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
      message: "The API could not be reached, so project memory cannot be read.",
      status: "setup_required"
    };
  }
}

/**
 * Renders setup guidance for project memory without offering seed fallback as real data.
 */
function ProjectsSetupState({ dashboardState }: { dashboardState: Extract<ProjectsDashboardState, { status: "setup_required" }> }) {
  // The database-connection badge + the setup panel below explain the dominant case (DB unreachable).
  // Only surface the technical API message when the DB is actually reported as connected — that is
  // the genuinely unexpected path where an operator needs the diagnostic detail to debug further.
  const databaseStatus = dashboardState.health?.dependencies.database;
  const showTechnicalMessage = databaseStatus === "connected";
  const copy = getSetupStateCopy(dashboardState.code);

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__copy">
          <p className="app-kicker">Projects</p>
          <h1>{copy.headline}</h1>
          <p className="projects-hero__lede">{copy.body}</p>
          <div className="projects-hero__status">
            <StatusBadge label="Projects paused" tone="review" />
            <StatusBadge label={`Database ${databaseStatus ?? "unknown"}`} tone={databaseStatus === "connected" ? "verified" : "review"} />
          </div>
          <div className="empty-recovery-actions">
            <Link className="button-link" href="/system">Open system checks</Link>
            <Link className="button-link button-link--quiet" href="/catalog">Open catalog</Link>
          </div>
          {showTechnicalMessage ? (
            <details className="import-guide">
              <summary>Show technical details</summary>
              <p className="mode-warning">{dashboardState.message}</p>
              <p className="mode-warning">Status code: {dashboardState.code}</p>
            </details>
          ) : null}
        </div>
      </section>
      <SectionPanel title="Finish setup to open projects" description="Use the quick path first. Open advanced details only if needed.">
        <div className="setup-steps">
          <div>
            <strong>Quick start</strong>
            <code>npm run setup:dev</code>
            <code>npm run dev</code>
            <span>This prepares local services and starts the app with live project data access.</span>
          </div>
          <div>
            <strong>What to expect</strong>
            <span>After setup, this page may still be empty until you create your first project and upload a parts list.</span>
          </div>
        </div>
        <details className="import-guide">
          <summary>Advanced setup commands</summary>
          <code>$env:DATABASE_URL=&quot;postgres://ee_library:ee_library@127.0.0.1:5432/ee_library&quot;</code>
          <code>npm run db:migrate</code>
          <code>npm run dev</code>
        </details>
      </SectionPanel>
    </main>
  );
}

/**
 * Renders the dashboard count strip from persisted project summaries.
 */
function ProjectMemorySnapshot({ projects }: { projects: ProjectSummary[] }) {
  const totalRevisions = projects.reduce((total, project) => total + project.revisionCount, 0);
  const totalBomImports = projects.reduce((total, project) => total + project.bomImportCount, 0);
  const totalUsages = projects.reduce((total, project) => total + project.usageCount, 0);

  return (
    <div className="projects-hero__snapshot" aria-label="Project memory summary">
      <ProjectMemoryStat label="Projects" tone="info" value={projects.length.toString()} />
      <ProjectMemoryStat label="Revisions" tone="neutral" value={totalRevisions.toString()} />
      <ProjectMemoryStat label="Parts list uploads" tone="review" value={totalBomImports.toString()} />
      <ProjectMemoryStat label="Confirmed usage" tone="verified" value={totalUsages.toString()} />
    </div>
  );
}

/**
 * Renders one compact project-memory stat tile.
 */
function ProjectMemoryStat({ label, tone, value }: { label: string; tone: BadgeTone; value: string }) {
  return (
    <div className={`projects-stat projects-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Renders the trust boundaries that keep project memory honest during the foundation stage.
 */
function ProjectMemoryTruthRail() {
  return (
    <section aria-label="Project memory boundaries" className="projects-truth-rail">
      <div>
        <span>Provider data</span>
        <strong>Input, not the product.</strong>
        <p>Public catalog and provider rows help intake parts, but internal project history and decisions become the durable memory.</p>
      </div>
      <div>
        <span>BOM truth</span>
        <strong>Rows are not usage until confirmed.</strong>
        <p>Raw, weak, or ambiguous BOM rows must stay separate from confirmed where-used history.</p>
      </div>
      <div>
        <span>Readiness truth</span>
        <strong>Approved does not mean export-ready.</strong>
        <p>Review approval, validation evidence, and verified-for-export promotion remain separate states.</p>
      </div>
    </section>
  );
}

/**
 * Renders the cross-project risk dashboard table with drill-down links to project detail anchors.
 */
function ProjectFleetRiskTable({ rows }: { rows: ProjectFleetRiskRow[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Total risk</th>
            <th>Unmatched</th>
            <th>Weak/ambiguous</th>
            <th>Approval gaps</th>
            <th>Lifecycle risk</th>
            <th>Missing verified CAD</th>
            <th>Open follow-ups</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.project.id}>
              <td>
                <Link href={`/projects/${row.project.id}`}>
                  <span className="ui-mono">{row.project.projectKey}</span>
                </Link>
                <div className="projects-table__primary">{row.project.name}</div>
              </td>
              <td>
                <StatusBadge label={row.totalRiskCount.toString()} tone={fleetTotalTone(row.totalRiskCount)} />
              </td>
              <td>
                <FleetCountLink projectId={row.project.id} anchor="project-bom-diagnostics-heading" count={row.unmatchedLineCount} />
              </td>
              <td>
                <FleetCountLink projectId={row.project.id} anchor="project-bom-diagnostics-heading" count={row.weakOrAmbiguousLineCount} />
              </td>
              <td>
                <FleetCountLink projectId={row.project.id} anchor="project-risk-heading" count={row.approvalGapCount} />
              </td>
              <td>
                <FleetCountLink projectId={row.project.id} anchor="project-risk-heading" count={row.lifecycleRiskCount} />
              </td>
              <td>
                <FleetCountLink projectId={row.project.id} anchor="project-risk-heading" count={row.missingVerifiedCadCount} />
              </td>
              <td>
                <FleetCountLink projectId={row.project.id} anchor="project-follow-ups-heading" count={row.openFollowUpCount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders one fleet count cell as a drill-down link when the count is non-zero, otherwise plain text.
 */
function FleetCountLink({ anchor, count, projectId }: { anchor: string; count: number; projectId: string }) {
  if (count === 0) {
    return <span className="muted-copy">0</span>;
  }
  return <Link href={`/projects/${projectId}#${anchor}`}>{count}</Link>;
}

/**
 * Maps a fleet total risk count to a badge tone so the dashboard surfaces high-risk projects visually.
 */
function fleetTotalTone(total: number): BadgeTone {
  if (total >= 5) return "danger";
  if (total >= 1) return "review";
  return "verified";
}

/**
 * Renders the configured-but-empty state for project memory.
 */
function ProjectsEmptyState() {
  return (
    <EmptyState
      title="No project records yet"
      body="The database is reachable, but no projects have been created yet. Create a project first, then upload a CSV BOM from the project page."
    />
  );
}

/**
 * Renders capability states without collapsing foundation and planned work.
 */
function CapabilityList({ capabilities }: { capabilities: ProjectMemoryCapability[] }) {
  if (capabilities.length === 0) {
    return <EmptyState title="No capabilities reported" body="We could not read capability information for this view." />;
  }

  return (
    <ul className="projects-capability-list">
      {capabilities.map((capability) => (
        <li className="projects-capability" key={capability.id}>
          <div>
            <strong>{capability.label}</strong>
            <p>{capability.detail}</p>
          </div>
          <StatusBadge label={formatCapabilityState(capability.state)} tone={capabilityTone(capability.state)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Formats project-memory capability state.
 */
function formatCapabilityState(state: ProjectMemoryCapabilityState): string {
  return state === "foundation" ? "Foundation" : "Planned";
}

/**
 * Maps capability state to a badge tone without claiming planned work is shipped.
 */
function capabilityTone(state: ProjectMemoryCapabilityState): BadgeTone {
  return state === "foundation" ? "info" : "review";
}
