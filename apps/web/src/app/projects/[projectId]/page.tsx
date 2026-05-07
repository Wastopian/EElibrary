/**
 * File header: Renders a project memory detail page from persisted project/BOM records.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { ApprovalBatchPanel } from "../../../components/ApprovalBatchPanel";
import { BomDiagnosticsPanel } from "../../../components/BomDiagnosticsPanel";
import { BomImportPanel } from "../../../components/BomImportPanel";
import { BomImportMatchPanel } from "../../../components/BomImportMatchPanel";
import { CircuitBlockInstantiationPanel } from "../../../components/CircuitBlockInstantiationPanel";
import { EvidenceAttachmentPanel } from "../../../components/EvidenceAttachmentPanel";
import { ExportBundlePanel } from "../../../components/ExportBundlePanel";
import { FollowUpPanel } from "../../../components/FollowUpPanel";
import { ProjectEditPanel } from "../../../components/ProjectEditPanel";
import { WorkspaceActionPanel, type WorkspaceAction } from "../../../components/WorkspaceActionPanel";
import { WorkspaceJumpNav } from "../../../components/WorkspaceJumpNav";
import { buildCompareUrl, fetchApiHealth, fetchProjectBomHealth, fetchProjectDetail, fetchProjectEvidenceAttachments, fetchProjectExportBundles, fetchProjectFollowUps, isApiClientError } from "../../../lib/api-client";
import type { ApiHealth } from "../../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type {
  BomImport,
  BomImportStatus,
  BomSourceFormat,
  EvidenceAttachment,
  EvidenceAttachmentType,
  EvidenceReviewStatus,
  EvidenceTargetType,
  ExportBundleListResponse,
  FollowUpListResponse,
  ProjectBomHealthResponse,
  ProjectBomRiskFinding,
  ProjectBomRiskSeverity,
  ProjectDetailResponse,
  ProjectEvidenceAttachmentsResponse,
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
      bomHealth: ProjectBomHealthResponse;
      evidence: ProjectEvidenceAttachmentsResponse;
      exportBundles: ExportBundleListResponse | null;
      followUps: FollowUpListResponse;
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

  const { bomHealth, evidence, exportBundles, followUps, health, response } = detailState;
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
              <span className="ui-mono">{project.projectKey}</span> preserves persisted revision, BOM import, and confirmed usage context. CSV BOM upload and exact internal row
              matching, BOM health, where-used detail, evidence metadata, and reusable circuit block records are available as foundation workflows.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label={formatProjectStatus(project.status)} tone={projectStatusTone(project.status)} />
              <StatusBadge label="DB-backed project record" tone="verified" />
              <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
            </div>
          </div>
          <ProjectDetailSnapshot revisionCount={summary.revisionCount} bomImportCount={summary.bomImportCount} usageCount={summary.usageCount} latestActivityAt={summary.latestActivityAt} riskFindingCount={bomHealth.findings.length} evidenceAttachmentCount={evidence.attachments.length} followUpCount={followUps.summary.openCount + followUps.summary.inProgressCount} />
        </div>
      </section>

      <WorkspaceJumpNav
        ariaLabel="Project detail sections"
        items={[
          { href: "#project-summary-heading", label: "Summary" },
          { href: "#project-edit-heading", label: "Edit" },
          { href: "#project-revisions-heading", label: "Revisions" },
          { href: "#project-bom-upload-heading", label: "Upload BOM" },
          { href: "#project-bom-imports-heading", label: "BOM imports" },
          { href: "#project-bom-diagnostics-heading", label: "BOM diagnostics" },
          { href: "#project-usage-heading", label: "Usage" },
          { href: "#project-risk-heading", label: "BOM health" },
          { href: "#project-approval-batch-heading", label: "Approval batch" },
          { href: "#project-export-bundles-heading", label: "Export bundles" },
          { href: "#project-follow-ups-heading", label: "Follow-ups" },
          { href: "#project-evidence-heading", label: "Evidence" },
          { href: "#project-capabilities-heading", label: "Capabilities" }
        ]}
      />

      <WorkspaceActionPanel
        actions={buildProjectWorkspaceActions(response)}
        description="Project-scoped jumps for review, compare, evidence, circuit reuse, and verified exports."
        title="Next project workspaces"
      />

      <section className="detail-section" aria-labelledby="project-summary-heading">
        <SectionHeading id="project-summary-heading" index="01" subtitle="Project identity and lifecycle state from persisted project memory." title="Project summary" />
        <SectionPanel description="Project records are a memory root. They do not imply any BOM row has been uploaded or matched yet." title={project.projectKey}>
          <ProjectSummaryGrid response={response} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-edit-heading">
        <SectionHeading id="project-edit-heading" index="02" subtitle="Maintain project metadata and current revision state without changing trust records." title="Edit project memory" />
        <SectionPanel description="These edits update project and revision metadata only. They do not approve parts, validate evidence, rematch BOM rows, or unlock export." title="Metadata maintenance">
          <ProjectEditPanel project={project} revisions={revisions} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-revisions-heading">
        <SectionHeading id="project-revisions-heading" index="03" subtitle="Revisions scope BOM imports and usage records for future where-used views." title="Revisions" />
        <SectionPanel description="Only persisted project revisions appear here." title={revisions.length > 0 ? `${revisions.length} revisions` : "No persisted revisions"}>
          {revisions.length > 0 ? <ProjectRevisionTable revisions={revisions} /> : <EmptyState title="No revisions yet" body="No project revision rows are persisted for this project." />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-bom-imports-heading">
        <SectionHeading id="project-bom-upload-heading" index="04" subtitle="Upload CSV, preview rows, map columns, and persist raw BOM line evidence." title="Upload mapped BOM" />
        <SectionPanel
          description="This saves BOM import metadata and raw/mapped BOM lines only. Matching is a separate action so weak or ambiguous rows never become usage by accident."
          title="CSV intake"
        >
          <BomImportPanel projectId={project.id} revisions={revisions} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-bom-imports-heading">
        <SectionHeading id="project-bom-imports-heading" index="05" subtitle="BOM import metadata is shown only after rows exist in the database." title="BOM imports" />
        <SectionPanel
          description="CSV upload and column mapping create these records. Run matching when you are ready to compare rows against internal catalog identity."
          title={bomImports.length > 0 ? `${bomImports.length} BOM import records` : "No persisted BOM imports"}
        >
          {bomImports.length > 0 ? (
            <BomImportTable bomImports={bomImports} />
          ) : (
            <EmptyState title="No BOM imports yet" body="No BOM import metadata is persisted for this project. Use the CSV intake panel above to preview and save mapped BOM rows." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-bom-diagnostics-heading">
        <SectionHeading id="project-bom-diagnostics-heading" index="06" subtitle="Row-level match status, confidence scores, triage actions, and side-by-side revision compare." title="BOM diagnostics" />
        <SectionPanel
          description="Diagnostics show match status per row and triage hints for weak, ambiguous, and unmatched rows. Revision compare shows what changed between two BOM imports."
          title={bomImports.length > 0 ? `${bomImports.length} imports available` : "No BOM imports to diagnose"}
        >
          <BomDiagnosticsPanel bomImports={bomImports} projectId={project.id} revisions={revisions} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-circuit-block-instantiation-heading">
        <SectionHeading
          id="project-circuit-block-instantiation-heading"
          index="07"
          subtitle="Generate BOM lines for a project revision from a reusable circuit block in the library."
          title="Add circuit block to BOM"
        />
        <SectionPanel
          description="Instantiation creates a synthetic BOM import with one matched line per block-part role. Confirmed usage rows are written for matched parts. Approval, readiness, and export verification are unchanged."
          title="Reusable circuit block"
        >
          <CircuitBlockInstantiationPanel projectId={project.id} revisions={revisions} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-usage-heading">
        <SectionHeading id="project-usage-heading" index="08" subtitle="Confirmed usage records are the future source for where-used search." title="Confirmed usage" />
        <SectionPanel
          description="Usage rows are created only from confirmed exact internal matches. Weak or ambiguous BOM line matches remain line evidence, not where-used history."
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
        <SectionHeading id="project-risk-heading" index="09" subtitle="Explainable counts from persisted BOM rows, confirmed usage, lifecycle, CAD/export, connector, approval, and evidence records." title="BOM health and risk" />
        <SectionPanel description="No opaque score is computed. Each finding lists the input rows and a concrete next action." title={bomHealth.summary.totalLineCount > 0 ? `${bomHealth.findings.length} explainable findings` : "No BOM rows to evaluate"}>
          <ProjectBomHealthPanel health={bomHealth} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-approval-batch-heading">
        <SectionHeading
          id="project-approval-batch-heading"
          index="10"
          subtitle="Review approval gaps from this project's confirmed usage and matched BOM rows; bulk approve or flag for review with one action."
          title="Review approval gaps"
        />
        <SectionPanel
          description="The approval-batch action records project context as the trigger and only changes part-level approval rows. Asset validation, lifecycle, readiness, and export verification are not touched."
          title="Project-scoped approval queue"
        >
          <ApprovalBatchPanel projectId={project.id} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-export-bundles-heading">
        <SectionHeading id="project-export-bundles-heading" index="11" subtitle="Generate manifest-first Altium, SolidWorks, or neutral export packages from verified assets only." title="Export bundles" />
        <SectionPanel
          description="Bundles include only verified file-backed assets. Referenced-only, unverified, or missing assets are recorded as omissions in the manifest. Export readiness does not imply part approval."
          title={exportBundles && exportBundles.bundles.length > 0 ? `${exportBundles.bundles.length} export bundle${exportBundles.bundles.length === 1 ? "" : "s"}` : "No export bundles yet"}
        >
          <ExportBundlePanel
            bundles={exportBundles ?? { bundles: [], projectId: project.id }}
            projectId={project.id}
            revisions={revisions}
          />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-follow-ups-heading">
        <SectionHeading id="project-follow-ups-heading" index="12" subtitle="Persist assignable work from current BOM health findings without changing part truth." title="Follow-up work" />
        <SectionPanel description="Follow-up status, assignee, evidence links, and resolution notes are operational workflow only. They do not resolve readiness unless the underlying BOM, part, asset, or evidence state changes." title={followUps.followUps.length > 0 ? `${followUps.followUps.length} follow-up records` : "No follow-up records"}>
          <FollowUpPanel followUps={followUps} targetId={project.id} targetType="project" />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-evidence-heading">
        <SectionHeading id="project-evidence-heading" index="13" subtitle="Decision evidence metadata can be attached without changing validation, approval, or export readiness." title="Evidence attachments" />
        <SectionPanel description="Evidence can support future reviews, but it remains provenance until someone explicitly reviews or validates the underlying item." title={evidence.attachments.length > 0 ? `${evidence.attachments.length} evidence attachments` : "No evidence attachments"}>
          <ProjectEvidencePanel attachments={evidence.attachments} projectId={project.id} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-capabilities-heading">
        <SectionHeading id="project-capabilities-heading" index="14" subtitle="Capability metadata keeps shipped foundations separate from planned workflows." title="Capability state" />
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
    const [health, response, bomHealth, evidence, followUps, exportBundles] = await Promise.all([
      healthPromise,
      fetchProjectDetail(projectId),
      fetchProjectBomHealth(projectId),
      fetchProjectEvidenceAttachments(projectId),
      fetchProjectFollowUps(projectId),
      fetchProjectExportBundles(projectId).catch(() => null)
    ]);

    if (!response || !bomHealth || !evidence || !followUps) {
      return { status: "not_found" };
    }

    return {
      bomHealth,
      evidence,
      exportBundles,
      followUps,
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
 * Builds project-scoped workflow jumps that avoid manual URL or id entry for common next actions.
 */
function buildProjectWorkspaceActions(response: ProjectDetailResponse): WorkspaceAction[] {
  const usagePartIds = [...new Set(response.usages.map((usage) => usage.partId).filter(Boolean))].slice(0, 4);
  const firstUsagePartId = usagePartIds[0] ?? "";

  return [
    {
      body: usagePartIds.length > 0
        ? "Compare the first confirmed parts used by this project."
        : "Open compare and add parts after BOM matching creates confirmed usage.",
      href: usagePartIds.length > 0 ? buildCompareUrl(usagePartIds) : "/compare",
      label: "Compare used parts",
      signal: usagePartIds.length > 0 ? `${usagePartIds.length} selected` : "Pick parts"
    },
    {
      body: firstUsagePartId
        ? "Open where-used for the first confirmed part from this project."
        : "Open where-used search after confirmed usage exists.",
      href: firstUsagePartId ? buildProjectWhereUsedHref(firstUsagePartId) : "/where-used",
      label: "Search where-used",
      signal: response.usages.length > 0 ? "Usage ready" : "Needs usage"
    },
    {
      body: "Attach or review project-level evidence without changing approval or export state.",
      href: buildProjectEvidenceHref(response.project.id),
      label: "Attach project evidence",
      signal: "Project target"
    },
    {
      body: "Add a reusable circuit block to this project BOM when repeated circuitry applies.",
      href: "#project-circuit-block-instantiation-heading",
      label: "Use circuit blocks",
      signal: "BOM helper"
    },
    {
      body: "Create or inspect bundles that include verified file-backed assets only.",
      href: "#project-export-bundles-heading",
      label: "Install/export files",
      signal: "Verified only"
    }
  ];
}

/**
 * Builds a where-used URL for a known project usage part id.
 */
function buildProjectWhereUsedHref(partId: string): string {
  const params = new URLSearchParams({ q: partId, targetType: "part" });

  return `/where-used?${params.toString()}`;
}

/**
 * Builds the global evidence vault URL filtered to this project target.
 */
function buildProjectEvidenceHref(projectId: string): string {
  const params = new URLSearchParams({ q: projectId, targetType: "project" });

  return `/evidence?${params.toString()}`;
}

/**
 * Renders the project detail count strip.
 */
function ProjectDetailSnapshot({
  evidenceAttachmentCount,
  followUpCount,
  bomImportCount,
  latestActivityAt,
  riskFindingCount,
  revisionCount,
  usageCount
}: {
  evidenceAttachmentCount: number;
  followUpCount: number;
  bomImportCount: number;
  latestActivityAt: string;
  riskFindingCount: number;
  revisionCount: number;
  usageCount: number;
}) {
  return (
    <div className="projects-hero__snapshot" aria-label="Project detail summary">
      <ProjectMemoryStat label="Revisions" tone="neutral" value={revisionCount.toString()} />
      <ProjectMemoryStat label="BOM imports" tone="review" value={bomImportCount.toString()} />
      <ProjectMemoryStat label="Confirmed usage" tone="verified" value={usageCount.toString()} />
      <ProjectMemoryStat label="Risk findings" tone={riskFindingCount > 0 ? "review" : "verified"} value={riskFindingCount.toString()} />
      <ProjectMemoryStat label="Follow-ups" tone={followUpCount > 0 ? "danger" : "neutral"} value={followUpCount.toString()} />
      <ProjectMemoryStat label="Evidence" tone={evidenceAttachmentCount > 0 ? "info" : "neutral"} value={evidenceAttachmentCount.toString()} />
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
            <th>Matching</th>
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
              <td>
                <BomImportMatchPanel bomImportId={bomImport.id} projectId={bomImport.projectId} />
              </td>
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
            <th>Trust context</th>
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
                  <strong className="ui-mono">{usage.partMpn ?? usage.partId}</strong>
                </Link>
                <div className="muted-copy">{usage.manufacturerName ?? "Manufacturer not recorded"}</div>
                <div className="muted-copy ui-mono">{usage.partId}</div>
              </td>
              <td>
                <StatusBadge label={formatUsageStatus(usage.usageStatus)} tone={usageStatusTone(usage.usageStatus)} />
              </td>
              <td className="muted-copy">{formatUsageTrustContext(usage)}</td>
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
 * Builds a compact trust summary from persisted usage snapshots.
 */
function formatUsageTrustContext(usage: ProjectPartUsage): string {
  const approvalStatus = readSnapshotString(usage.approvalSnapshot, "status");
  const readinessStatus = readSnapshotString(usage.readinessSnapshot, "status");
  const approvalStage = approvalStatus === "approved"
    ? "Approved"
    : approvalStatus === "pending_review"
      ? "Pending approval"
      : "Approval not recorded";
  const readinessStage = readinessStatus
    ? `Readiness: ${readinessStatus.replace(/_/g, " ")}`
    : "Readiness not recorded";
  return `${approvalStage} | ${readinessStage}`;
}

function readSnapshotString(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Renders the explainable BOM health summary and findings.
 */
function ProjectBomHealthPanel({ health }: { health: ProjectBomHealthResponse }) {
  const { summary } = health;

  if (summary.totalLineCount === 0) {
    return <EmptyState title="No BOM rows to evaluate" body="Upload and map a BOM before health can derive row, part, CAD/export, evidence, or lifecycle findings." />;
  }

  return (
    <div className="project-health-panel">
      <dl className="project-health-grid">
        <HealthMetric label="Rows" value={summary.totalLineCount} />
        <HealthMetric label="Matched" tone="verified" value={summary.matchedLineCount} />
        <HealthMetric label="Unmatched" tone={summary.unmatchedLineCount > 0 ? "review" : "neutral"} value={summary.unmatchedLineCount} />
        <HealthMetric label="Weak/ambiguous" tone={summary.weakMatchLineCount + summary.ambiguousLineCount > 0 ? "review" : "neutral"} value={summary.weakMatchLineCount + summary.ambiguousLineCount} />
        <HealthMetric label="Approval gaps" tone={summary.approvalGapCount > 0 ? "review" : "neutral"} value={summary.approvalGapCount} />
        <HealthMetric label="Lifecycle risk" tone={summary.lifecycleRiskCount > 0 ? "danger" : "neutral"} value={summary.lifecycleRiskCount} />
        <HealthMetric
          label="Lifecycle regression"
          tone={summary.lifecycleRegressionCount > 0 ? "danger" : "neutral"}
          value={summary.lifecycleRegressionCount}
        />
        <HealthMetric label="Missing verified CAD" tone={summary.missingVerifiedCadCount > 0 ? "review" : "neutral"} value={summary.missingVerifiedCadCount} />
        <HealthMetric label="Referenced CAD only" tone={summary.referencedCadOnlyCount > 0 ? "review" : "neutral"} value={summary.referencedCadOnlyCount} />
        <HealthMetric label="Connector gaps" tone={summary.connectorBuildabilityGapCount > 0 ? "review" : "neutral"} value={summary.connectorBuildabilityGapCount} />
        <HealthMetric label="Missing evidence" tone={summary.missingEvidenceCount > 0 ? "review" : "neutral"} value={summary.missingEvidenceCount} />
      </dl>

      <p className="muted-copy project-health-checkpoint">
        {health.lifecycleReviewCheckpointAt ? (
          <>
            Lifecycle regression uses the <strong>current</strong> catalog part row (including <code className="ui-mono">last_updated_at</code>) and fires when obsolete or not recommended state landed after your last BOM health review checkpoint:{" "}
            <strong>{formatDateTime(health.lifecycleReviewCheckpointAt)}</strong> (resolved or dismissed BOM health follow-ups, or accepted evidence on a{" "}
            <code className="ui-mono">:bom-health:</code> risk finding).
          </>
        ) : (
          <>
            No BOM health review checkpoint yet. Resolve or dismiss a BOM health follow-up, or mark evidence on a <code className="ui-mono">:bom-health:</code> risk finding as accepted, to anchor{" "}
            <strong>lifecycle regression</strong> detection against catalog updates.
          </>
        )}
      </p>

      {health.findings.length > 0 ? (
        <div className="project-risk-list">
          {health.findings.map((finding) => (
            <ProjectRiskFindingCard finding={finding} key={finding.id} />
          ))}
        </div>
      ) : (
        <EmptyState title="No explainable findings" body="The current BOM rows do not trigger any configured health finding. This is not an approval or export guarantee." />
      )}
    </div>
  );
}

/**
 * Renders one numeric health metric with a badge tone.
 */
function HealthMetric({ label, tone = "neutral", value }: { label: string; tone?: BadgeTone; value: number }) {
  return (
    <div className={`project-health-metric project-health-metric--${tone}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Renders one risk finding with affected record ids and concrete next action.
 */
function ProjectRiskFindingCard({ finding }: { finding: ProjectBomRiskFinding }) {
  return (
    <article className={`project-risk-card project-risk-card--${finding.severity}`}>
      <div className="project-risk-card__header">
        <div>
          <h3>{finding.title}</h3>
          <p>{finding.detail}</p>
        </div>
        <StatusBadge label={formatRiskSeverity(finding.severity)} tone={finding.severity === "danger" ? "danger" : "review"} />
      </div>
      <p className="project-risk-card__action">
        <strong>Next action:</strong> {finding.nextAction}
      </p>
      <dl className="project-risk-card__records">
        <div>
          <dt>BOM rows</dt>
          <dd>{formatRecordIdList(finding.affectedBomLineIds)}</dd>
        </div>
        <div>
          <dt>Parts</dt>
          <dd>{formatRecordIdList(finding.affectedPartIds)}</dd>
        </div>
      </dl>
      <ul>
        {finding.inputs.map((input) => (
          <li key={input}>{input}</li>
        ))}
      </ul>
    </article>
  );
}

/**
 * Renders evidence metadata and the first-pass project-level evidence form.
 */
function ProjectEvidencePanel({ attachments, projectId }: { attachments: EvidenceAttachment[]; projectId: string }) {
  return (
    <div className="project-evidence-panel">
      <div className="project-evidence-panel__boundary">
        <strong>Evidence is provenance.</strong> It does not validate assets, approve parts, or unlock export bundles by itself.
      </div>
      <EvidenceAttachmentPanel submitLabel="Attach project evidence" targetId={projectId} targetType="project" />
      {attachments.length > 0 ? (
        <ProjectEvidenceTable attachments={attachments} />
      ) : (
        <EmptyState title="No evidence metadata yet" body="Attach a review link or note to preserve why this project decision was made." />
      )}
    </div>
  );
}

/**
 * Renders persisted evidence attachment rows.
 */
function ProjectEvidenceTable({ attachments }: { attachments: EvidenceAttachment[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Evidence</th>
            <th>Target</th>
            <th>Type</th>
            <th>Review state</th>
            <th>Reference</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {attachments.map((attachment) => (
            <tr key={attachment.id}>
              <td>
                <strong>{attachment.title}</strong>
                <p className="muted-copy">{attachment.notes ?? attachment.provenance}</p>
              </td>
              <td>
                <span>{formatEvidenceTargetType(attachment.targetType)}</span>
                <p className="ui-mono">{attachment.targetId}</p>
              </td>
              <td>{formatEvidenceAttachmentType(attachment.evidenceType)}</td>
              <td>
                <StatusBadge label={formatEvidenceReviewStatus(attachment.reviewStatus)} tone={evidenceReviewTone(attachment.reviewStatus)} />
              </td>
              <td>{renderEvidenceReference(attachment)}</td>
              <td>{formatDateTime(attachment.updatedAt)}</td>
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
 * Formats risk severity.
 */
function formatRiskSeverity(severity: ProjectBomRiskSeverity): string {
  return severity === "danger" ? "High risk" : "Needs review";
}

/**
 * Formats record id lists without hiding empty evidence.
 */
function formatRecordIdList(ids: string[]): string {
  return ids.length > 0 ? ids.join(", ") : "None";
}

/**
 * Formats evidence target type values for compact tables.
 */
function formatEvidenceTargetType(targetType: EvidenceTargetType): string {
  return {
    asset: "Asset",
    bom_import: "BOM import",
    bom_line: "BOM line",
    circuit_block: "Circuit block",
    circuit_block_part: "Circuit block part",
    part: "Part",
    project: "Project",
    project_part_usage: "Project usage",
    risk_finding: "Risk finding"
  }[targetType];
}

/**
 * Formats evidence attachment type values.
 */
function formatEvidenceAttachmentType(evidenceType: EvidenceAttachmentType): string {
  return {
    file: "File metadata",
    link: "Link",
    note: "Note"
  }[evidenceType];
}

/**
 * Formats evidence review status without implying accepted evidence is validation.
 */
function formatEvidenceReviewStatus(reviewStatus: EvidenceReviewStatus): string {
  return {
    accepted: "Accepted evidence",
    rejected: "Rejected evidence",
    superseded: "Superseded",
    unreviewed: "Unreviewed"
  }[reviewStatus];
}

/**
 * Maps evidence review status into badge tones.
 */
function evidenceReviewTone(reviewStatus: EvidenceReviewStatus): BadgeTone {
  if (reviewStatus === "accepted") {
    return "info";
  }

  if (reviewStatus === "rejected") {
    return "danger";
  }

  if (reviewStatus === "superseded") {
    return "neutral";
  }

  return "review";
}

/**
 * Renders the most concrete evidence reference available.
 */
function renderEvidenceReference(attachment: EvidenceAttachment): React.ReactNode {
  if (attachment.sourceUrl) {
    return <a href={attachment.sourceUrl}>{attachment.sourceUrl}</a>;
  }

  if (attachment.storageKey) {
    return <span className="ui-mono">{attachment.storageKey}</span>;
  }

  return "No external reference";
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
