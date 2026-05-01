/**
 * File header: Renders the read-only project memory dashboard for persisted project/BOM foundations.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { ProjectCreatePanel } from "../../components/ProjectCreatePanel";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { fetchApiHealth, fetchProjectListEnvelope, isApiClientError } from "../../lib/api-client";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { CatalogDataSource, ProjectListResponse, ProjectMemoryCapability, ProjectMemoryCapabilityState, ProjectStatus, ProjectSummary } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** ProjectsDashboardState separates ready project-memory reads from setup/recovery states. */
type ProjectsDashboardState =
  | {
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
 * Renders the project-memory dashboard without implying BOM upload or where-used workflows are shipped.
 */
export default async function ProjectsPage() {
  const dashboardState = await loadProjectsDashboard();

  if (dashboardState.status === "setup_required") {
    return <ProjectsSetupState dashboardState={dashboardState} />;
  }

  const { health, response, source } = dashboardState;
  const foundationCapabilities = response.capabilities.filter((capability) => capability.state === "foundation");
  const plannedCapabilities = response.capabilities.filter((capability) => capability.state === "planned");

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Project memory</p>
            <h1>Projects and BOM usage foundations</h1>
            <p className="projects-hero__lede">
              Create project memory, read persisted revisions and BOM imports, and upload mapped CSV BOM rows. Matching, where-used search, circuit blocks, and BOM health remain planned workflows.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label={source === "seed_fallback" ? "Unexpected seed mode" : "DB-backed project memory"} tone={source === "database" ? "verified" : "review"} />
              <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
              <StatusBadge label={`Database ${health?.dependencies.database ?? "unknown"}`} tone={health?.dependencies.database === "connected" ? "verified" : "review"} />
            </div>
          </div>
          <ProjectMemorySnapshot projects={response.projects} />
        </div>
      </section>

      <ProjectMemoryTruthRail />

      <WorkspaceJumpNav
        ariaLabel="Project memory sections"
        items={[
          { href: "#projects-list-heading", label: "Projects" },
          { href: "#project-create-heading", label: "Create" },
          { href: "#project-foundations-heading", label: "Foundations" },
          { href: "#planned-project-memory-heading", label: "Planned work" }
        ]}
      />

      <section className="detail-section" aria-labelledby="projects-list-heading">
        <SectionHeading
          id="projects-list-heading"
          index="01"
          subtitle="Only persisted project rows appear here. A configured but empty database stays empty."
          title="Project records"
        />
        <SectionPanel
          description="This is a read-only project-memory surface for records that already exist in the database."
          title={response.projects.length > 0 ? `${response.projects.length} project records` : "No persisted projects"}
        >
          {response.projects.length > 0 ? <ProjectsTable projects={response.projects} /> : <ProjectsEmptyState />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-create-heading">
        <SectionHeading
          id="project-create-heading"
          index="02"
          subtitle="Create a real project root and first revision so BOM intake has a durable scope."
          title="Create project"
        />
        <SectionPanel
          description="Project creation is the minimum write path needed before BOM upload. It does not create parts, approvals, usage history, or risk findings."
          title="New project memory"
        >
          <ProjectCreatePanel />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-foundations-heading">
        <SectionHeading id="project-foundations-heading" index="03" subtitle="These capabilities are foundations exposed by current endpoints." title="Current foundations" />
        <SectionPanel description="Foundation means the API has real persistence for this stage. Matching, where-used search, and risk review stay separate planned workflows." title="Readable project memory">
          <CapabilityList capabilities={foundationCapabilities} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="planned-project-memory-heading">
        <SectionHeading id="planned-project-memory-heading" index="04" subtitle="These workflows are intentionally visible as planned work, not shipped behavior." title="Planned project memory" />
        <SectionPanel
          description="The next P0 tasks turn the schema and read endpoints into BOM intake, usage history, and risk review."
          title="Near-term project workflow"
        >
          <CapabilityList capabilities={plannedCapabilities} />
        </SectionPanel>
      </section>
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

    return {
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
  return (
    <main className="projects-layout">
      <Link className="back-link" href="/catalog">
        &larr; Back to catalog
      </Link>
      <section className="projects-hero">
        <div className="projects-hero__copy">
          <p className="app-kicker">Project memory</p>
          <h1>Connect the project database</h1>
          <p className="projects-hero__lede">Project memory reads require persisted project, BOM, and usage tables. No seed fallback is used for project history.</p>
          <div className="projects-hero__status">
            <StatusBadge label={dashboardState.code} tone="review" />
            <StatusBadge label={`Database ${dashboardState.health?.dependencies.database ?? "unknown"}`} tone={dashboardState.health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
          <p className="mode-warning">{dashboardState.message}</p>
        </div>
      </section>
      <SectionPanel title="Setup guidance" description="Project memory is DB-backed only. Apply migrations before expecting project rows.">
        <div className="setup-steps">
          <div>
            <strong>Canonical database</strong>
            <code>$env:DATABASE_URL=&quot;postgres://ee_library:ee_library@127.0.0.1:5432/ee_library&quot;</code>
            <code>npm run db:migrate</code>
            <code>npm run dev</code>
          </div>
          <div>
            <strong>Honest empty state</strong>
            <span>A healthy empty database will show no project rows until project and BOM records are created by later workflows.</span>
          </div>
        </div>
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
      <ProjectMemoryStat label="BOM imports" tone="review" value={totalBomImports.toString()} />
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
 * Renders persisted projects in a dense table for engineering workstation use.
 */
function ProjectsTable({ projects }: { projects: ProjectSummary[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Status</th>
            <th>Owner</th>
            <th>Revisions</th>
            <th>BOM imports</th>
            <th>Confirmed usage</th>
            <th>Latest activity</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((summary) => (
            <tr key={summary.project.id}>
              <td>
                <Link href={`/projects/${summary.project.id}`}>
                  <span className="ui-mono">{summary.project.projectKey}</span>
                </Link>
                <div className="projects-table__primary">{summary.project.name}</div>
                <div className="muted-copy">{summary.project.description}</div>
              </td>
              <td>
                <StatusBadge label={formatProjectStatus(summary.project.status)} tone={projectStatusTone(summary.project.status)} />
              </td>
              <td>{summary.project.owner ?? "Unassigned"}</td>
              <td>{summary.revisionCount}</td>
              <td>{summary.bomImportCount}</td>
              <td>{summary.usageCount}</td>
              <td>{formatDateTime(summary.latestActivityAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders the configured-but-empty state for project memory.
 */
function ProjectsEmptyState() {
  return (
    <EmptyState
      title="No project records yet"
      body="The project-memory database is reachable, but no project rows are persisted. Create a project first, then upload a CSV BOM from the project detail page."
    />
  );
}

/**
 * Renders capability states without collapsing foundation and planned work.
 */
function CapabilityList({ capabilities }: { capabilities: ProjectMemoryCapability[] }) {
  if (capabilities.length === 0) {
    return <EmptyState title="No capabilities reported" body="The API did not return capability metadata for this project-memory read." />;
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
 * Maps project lifecycle status into operator-facing copy.
 */
function formatProjectStatus(status: ProjectStatus): string {
  return {
    active: "Active",
    archived: "Archived",
    deprecated: "Deprecated",
    production: "Production",
    prototype: "Prototype"
  }[status];
}

/**
 * Maps project lifecycle status into badge tone.
 */
function projectStatusTone(status: ProjectStatus): BadgeTone {
  if (status === "production" || status === "active") {
    return "verified";
  }

  if (status === "prototype") {
    return "info";
  }

  if (status === "deprecated") {
    return "review";
  }

  return "neutral";
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

/**
 * Formats timestamps for dashboard tables.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
