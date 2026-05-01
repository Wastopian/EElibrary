/**
 * File header: Renders a read-only project memory detail page from persisted project/BOM records.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { BomImportPanel } from "../../../components/BomImportPanel";
import { WorkspaceJumpNav } from "../../../components/WorkspaceJumpNav";
import { fetchApiHealth, fetchProjectDetail, isApiClientError } from "../../../lib/api-client";
import type { ApiHealth } from "../../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type {
  BomImport,
  BomImportStatus,
  BomSourceFormat,
  ProjectDetailResponse,
  ProjectMemoryCapability,
  ProjectMemoryCapabilityState,
  ProjectPartUsage,
  ProjectPartUsageStatus,
  ProjectRevision,
  ProjectRevisionStatus,
  ProjectStatus
} from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** ProjectDetailPageProps supplies the Next.js route parameter for one project id. */
interface ProjectDetailPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

/** ProjectDetailState separates persisted detail data from setup/recovery states. */
type ProjectDetailState =
  | {
      health: ApiHealth | null;
      response: ProjectDetailResponse;
      status: "ready";
    }
  | {
      code: string;
      health: ApiHealth | null;
      message: string;
      status: "setup_required";
    }
  | {
      status: "not_found";
    };

/**
 * Renders one project detail workspace with honest empty sections for planned BOM workflows.
 */
export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { projectId } = await params;
  const detailState = await loadProjectDetail(projectId);

  if (detailState.status === "not_found") {
    notFound();
  }

  if (detailState.status === "setup_required") {
    return <ProjectDetailSetupState detailState={detailState} />;
  }

  const { health, response } = detailState;
  const { bomImports, capabilities, project, revisions, summary, usages } = response;
  const foundationCapabilities = capabilities.filter((capability) => capability.state === "foundation");
  const plannedCapabilities = capabilities.filter((capability) => capability.state === "planned");

  return (
    <main className="projects-layout">
      <Link className="back-link" href="/projects">
        &larr; Back to projects
      </Link>

      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Project memory detail</p>
            <h1>{project.name}</h1>
            <p className="projects-hero__lede">
              <span className="ui-mono">{project.projectKey}</span> preserves persisted revision, BOM import, and confirmed usage context. CSV BOM upload is available here; matching,
              where-used search, and BOM health are still planned workflows.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label={formatProjectStatus(project.status)} tone={projectStatusTone(project.status)} />
              <StatusBadge label="DB-backed project record" tone="verified" />
              <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
            </div>
          </div>
          <ProjectDetailSnapshot revisionCount={summary.revisionCount} bomImportCount={summary.bomImportCount} usageCount={summary.usageCount} latestActivityAt={summary.latestActivityAt} />
        </div>
      </section>

      <WorkspaceJumpNav
        ariaLabel="Project detail sections"
        items={[
          { href: "#project-summary-heading", label: "Summary" },
          { href: "#project-revisions-heading", label: "Revisions" },
          { href: "#project-bom-upload-heading", label: "Upload BOM" },
          { href: "#project-bom-imports-heading", label: "BOM imports" },
          { href: "#project-usage-heading", label: "Usage" },
          { href: "#project-risk-heading", label: "BOM health" },
          { href: "#project-capabilities-heading", label: "Capabilities" }
        ]}
      />

      <section className="detail-section" aria-labelledby="project-summary-heading">
        <SectionHeading id="project-summary-heading" index="01" subtitle="Project identity and lifecycle state from persisted project memory." title="Project summary" />
        <SectionPanel description="Project records are a memory root. They do not imply any BOM row has been uploaded or matched yet." title={project.projectKey}>
          <ProjectSummaryGrid response={response} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-revisions-heading">
        <SectionHeading id="project-revisions-heading" index="02" subtitle="Revisions scope BOM imports and usage records for future where-used views." title="Revisions" />
        <SectionPanel description="Only persisted project revisions appear here." title={revisions.length > 0 ? `${revisions.length} revisions` : "No persisted revisions"}>
          {revisions.length > 0 ? <ProjectRevisionTable revisions={revisions} /> : <EmptyState title="No revisions yet" body="No project revision rows are persisted for this project." />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-bom-imports-heading">
        <SectionHeading id="project-bom-upload-heading" index="03" subtitle="Upload CSV, preview rows, map columns, and persist raw BOM line evidence." title="Upload mapped BOM" />
        <SectionPanel
          description="This saves BOM import metadata and raw/mapped BOM lines only. It does not create parts, match rows, create usage history, or approve reuse."
          title="CSV intake"
        >
          <BomImportPanel projectId={project.id} revisions={revisions} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-bom-imports-heading">
        <SectionHeading id="project-bom-imports-heading" index="04" subtitle="BOM import metadata is shown only after rows exist in the database." title="BOM imports" />
        <SectionPanel
          description="CSV upload and column mapping create these records. Matching and usage creation are intentionally still separate."
          title={bomImports.length > 0 ? `${bomImports.length} BOM import records` : "No persisted BOM imports"}
        >
          {bomImports.length > 0 ? (
            <BomImportTable bomImports={bomImports} />
          ) : (
            <EmptyState title="No BOM imports yet" body="No BOM import metadata is persisted for this project. Use the CSV intake panel above to preview and save mapped BOM rows." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-usage-heading">
        <SectionHeading id="project-usage-heading" index="05" subtitle="Confirmed usage records are the future source for where-used search." title="Confirmed usage" />
        <SectionPanel
          description="Usage rows must be confirmed. Weak or ambiguous BOM line matches should remain BOM line evidence, not where-used history."
          title={usages.length > 0 ? `${usages.length} confirmed usage rows` : "No confirmed usage"}
        >
          {usages.length > 0 ? (
            <ProjectUsageTable usages={usages} />
          ) : (
            <EmptyState title="No confirmed part usage yet" body="No part-to-project usage rows are persisted. Future matching must confirm rows before they appear as where-used memory." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-risk-heading">
        <SectionHeading id="project-risk-heading" index="06" subtitle="Risk review remains planned until BOM line matching and usage history exist." title="BOM health and risk" />
        <SectionPanel description="No lifecycle, CAD/export, evidence, connector, or sourcing risk projection is computed on this page yet." title="Planned health dashboard">
          <EmptyState
            title="BOM health dashboard is planned"
            body="P0-MEM7 will derive explainable risk findings after BOM rows and confirmed usage history exist. This page does not invent risk counts."
          />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-capabilities-heading">
        <SectionHeading id="project-capabilities-heading" index="07" subtitle="Capability metadata keeps shipped foundations separate from planned workflows." title="Capability state" />
        <div className="projects-detail-grid">
          <SectionPanel title="Readable foundations" description="These are current read foundations for persisted project memory.">
            <CapabilityList capabilities={foundationCapabilities} />
          </SectionPanel>
          <SectionPanel title="Planned workflows" description="These are not shipped by the current project detail page.">
            <CapabilityList capabilities={plannedCapabilities} />
          </SectionPanel>
        </div>
      </section>
    </main>
  );
}

/**
 * Loads one project detail while preserving API and database setup failures.
 */
async function loadProjectDetail(projectId: string): Promise<ProjectDetailState> {
  const healthPromise = fetchApiHealth();

  try {
    const [health, response] = await Promise.all([healthPromise, fetchProjectDetail(projectId)]);

    if (!response) {
      return { status: "not_found" };
    }

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
      message: "The API could not be reached, so project detail cannot be read.",
      status: "setup_required"
    };
  }
}

/**
 * Renders setup guidance for a scoped project detail request.
 */
function ProjectDetailSetupState({ detailState }: { detailState: Extract<ProjectDetailState, { status: "setup_required" }> }) {
  return (
    <main className="projects-layout">
      <Link className="back-link" href="/projects">
        &larr; Back to projects
      </Link>
      <section className="projects-hero">
        <div className="projects-hero__copy">
          <p className="app-kicker">Project memory detail</p>
          <h1>Project detail unavailable</h1>
          <p className="projects-hero__lede">Project detail reads require the project-memory database tables. No fallback project history is shown.</p>
          <div className="projects-hero__status">
            <StatusBadge label={detailState.code} tone="review" />
            <StatusBadge label={`Database ${detailState.health?.dependencies.database ?? "unknown"}`} tone={detailState.health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
          <p className="mode-warning">{detailState.message}</p>
        </div>
      </section>
      <SectionPanel title="Setup guidance" description="Project detail requires DB-backed project, revision, BOM, and usage tables.">
        <div className="setup-steps">
          <div>
            <strong>Apply migrations</strong>
            <code>npm run db:migrate</code>
            <code>npm run dev</code>
          </div>
          <div>
            <strong>No fallback records</strong>
            <span>Project memory stays empty or unavailable until persisted project rows exist.</span>
          </div>
        </div>
      </SectionPanel>
    </main>
  );
}

/**
 * Renders the project detail count strip.
 */
function ProjectDetailSnapshot({
  bomImportCount,
  latestActivityAt,
  revisionCount,
  usageCount
}: {
  bomImportCount: number;
  latestActivityAt: string;
  revisionCount: number;
  usageCount: number;
}) {
  return (
    <div className="projects-hero__snapshot" aria-label="Project detail summary">
      <ProjectMemoryStat label="Revisions" tone="neutral" value={revisionCount.toString()} />
      <ProjectMemoryStat label="BOM imports" tone="review" value={bomImportCount.toString()} />
      <ProjectMemoryStat label="Confirmed usage" tone="verified" value={usageCount.toString()} />
      <ProjectMemoryStat label="Latest activity" tone="info" value={formatDate(latestActivityAt)} />
    </div>
  );
}

/**
 * Renders one compact stat tile for the project detail header.
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
 * Renders key/value project metadata for the summary panel.
 */
function ProjectSummaryGrid({ response }: { response: ProjectDetailResponse }) {
  const { project, summary } = response;

  return (
    <dl className="projects-summary-grid">
      <div>
        <dt>Project key</dt>
        <dd className="ui-mono">{project.projectKey}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>
          <StatusBadge label={formatProjectStatus(project.status)} tone={projectStatusTone(project.status)} />
        </dd>
      </div>
      <div>
        <dt>Owner</dt>
        <dd>{project.owner ?? "Unassigned"}</dd>
      </div>
      <div>
        <dt>Created</dt>
        <dd>{formatDateTime(project.createdAt)}</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd>{formatDateTime(project.updatedAt)}</dd>
      </div>
      <div>
        <dt>Latest activity</dt>
        <dd>{formatDateTime(summary.latestActivityAt)}</dd>
      </div>
      <div className="projects-summary-grid__wide">
        <dt>Description</dt>
        <dd>{project.description || "No description recorded."}</dd>
      </div>
    </dl>
  );
}

/**
 * Renders persisted project revisions.
 */
function ProjectRevisionTable({ revisions }: { revisions: ProjectRevision[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Revision</th>
            <th>Status</th>
            <th>Source</th>
            <th>Released</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {revisions.map((revision) => (
            <tr key={revision.id}>
              <td className="ui-mono">{revision.revisionLabel}</td>
              <td>
                <StatusBadge label={formatRevisionStatus(revision.revisionStatus)} tone={revisionStatusTone(revision.revisionStatus)} />
              </td>
              <td>{revision.sourceReference ?? "Not recorded"}</td>
              <td>{formatOptionalDateTime(revision.releasedAt)}</td>
              <td>{formatDateTime(revision.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders persisted BOM import metadata without exposing upload controls.
 */
function BomImportTable({ bomImports }: { bomImports: BomImport[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Source file</th>
            <th>Status</th>
            <th>Format</th>
            <th>Imported by</th>
            <th>Mapping keys</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {bomImports.map((bomImport) => (
            <tr key={bomImport.id}>
              <td>
                <span className="ui-mono">{bomImport.sourceFilename}</span>
                <div className="muted-copy">{bomImport.storageKey ?? "No stored source file reference"}</div>
              </td>
              <td>
                <StatusBadge label={formatBomImportStatus(bomImport.importStatus)} tone={bomImportStatusTone(bomImport.importStatus)} />
              </td>
              <td>{formatBomSourceFormat(bomImport.sourceFormat)}</td>
              <td>{bomImport.importedBy ?? "Not recorded"}</td>
              <td>{Object.keys(bomImport.columnMapping).length}</td>
              <td>{formatDateTime(bomImport.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders confirmed project part usage records.
 */
function ProjectUsageTable({ usages }: { usages: ProjectPartUsage[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Part</th>
            <th>Status</th>
            <th>Designators</th>
            <th>Quantity</th>
            <th>Context</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {usages.map((usage) => (
            <tr key={usage.id}>
              <td>
                <Link href={`/parts/${usage.partId}`}>
                  <span className="ui-mono">{usage.partId}</span>
                </Link>
              </td>
              <td>
                <StatusBadge label={formatUsageStatus(usage.usageStatus)} tone={usageStatusTone(usage.usageStatus)} />
              </td>
              <td>{formatDesignators(usage.designators)}</td>
              <td>{usage.quantity ?? "Not recorded"}</td>
              <td>{usage.usageContext ?? "No usage context recorded"}</td>
              <td>{formatDateTime(usage.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders capability states without presenting planned workflows as shipped.
 */
function CapabilityList({ capabilities }: { capabilities: ProjectMemoryCapability[] }) {
  if (capabilities.length === 0) {
    return <EmptyState title="No capabilities reported" body="The API did not return capability metadata for this project detail read." />;
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
 * Formats revision lifecycle status.
 */
function formatRevisionStatus(status: ProjectRevisionStatus): string {
  return {
    archived: "Archived",
    draft: "Draft",
    in_review: "In review",
    released: "Released",
    superseded: "Superseded"
  }[status];
}

/**
 * Maps revision lifecycle status into badge tone.
 */
function revisionStatusTone(status: ProjectRevisionStatus): BadgeTone {
  if (status === "released") {
    return "verified";
  }

  if (status === "in_review" || status === "draft") {
    return "info";
  }

  return "neutral";
}

/**
 * Formats BOM import status.
 */
function formatBomImportStatus(status: BomImportStatus): string {
  return {
    failed: "Failed",
    mapped: "Mapped",
    mapping_required: "Mapping required",
    processed: "Processed",
    processing: "Processing",
    uploaded: "Uploaded"
  }[status];
}

/**
 * Maps BOM import status into badge tone.
 */
function bomImportStatusTone(status: BomImportStatus): BadgeTone {
  if (status === "processed") {
    return "verified";
  }

  if (status === "failed") {
    return "danger";
  }

  if (status === "mapping_required") {
    return "review";
  }

  return "info";
}

/**
 * Formats BOM source file family.
 */
function formatBomSourceFormat(sourceFormat: BomSourceFormat): string {
  return {
    csv: "CSV",
    eda_export: "EDA export",
    json: "JSON",
    manual: "Manual",
    xlsx: "XLSX"
  }[sourceFormat];
}

/**
 * Formats confirmed project usage lifecycle status.
 */
function formatUsageStatus(status: ProjectPartUsageStatus): string {
  return {
    deprecated: "Deprecated",
    in_review: "In review",
    proposed: "Proposed",
    released: "Released",
    used: "Used"
  }[status];
}

/**
 * Maps usage lifecycle status into badge tone.
 */
function usageStatusTone(status: ProjectPartUsageStatus): BadgeTone {
  if (status === "released" || status === "used") {
    return "verified";
  }

  if (status === "in_review" || status === "proposed") {
    return "info";
  }

  return "review";
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
 * Formats designator arrays for dense usage tables.
 */
function formatDesignators(designators: string[]): string {
  return designators.length > 0 ? designators.join(", ") : "Not recorded";
}

/**
 * Formats optional timestamps for revision release fields.
 */
function formatOptionalDateTime(value: string | null): string {
  return value ? formatDateTime(value) : "Not released";
}

/**
 * Formats compact dates for stat tiles.
 */
function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short"
  }).format(new Date(value));
}

/**
 * Formats timestamps for project detail tables.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
