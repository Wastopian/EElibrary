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
import { OperatorChecklist } from "../../../components/OperatorChecklist";
import { ProjectAdvancedToolsDetails } from "../../../components/ProjectAdvancedToolsDetails";
import { ProjectEditPanel } from "../../../components/ProjectEditPanel";
import { ProjectFilesPanel } from "../../../components/ProjectFilesPanel";
import { ProjectOverlapPanel } from "../../../components/ProjectOverlapPanel";
import { ProjectRevisionApprovalGatePanel } from "../../../components/ProjectRevisionApprovalGatePanel";
import { RecentActivityStrip } from "../../../components/RecentActivityStrip";
import { ProjectUsageBrowser } from "../../../components/ProjectUsageBrowser";
import { WorkspaceActionPanel, type WorkspaceAction } from "../../../components/WorkspaceActionPanel";
import { buildCompareUrl, fetchApiHealth, fetchEntityAuditEvents, fetchProjectBomHealth, fetchProjectDetail, fetchProjectEvidenceAttachments, fetchProjectExportBundles, fetchProjectFiles, fetchProjectFollowUps, fetchProjectOverlapPanel, isApiClientError } from "../../../lib/api-client";
import { getSetupStateCopy } from "../../../lib/setup-state-copy";
import type { ApiHealth } from "../../../lib/api-client";
import type { AuditEvent } from "@ee-library/shared/types";
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
  ProjectFilesResponse,
  ProjectMemoryCapability,
  ProjectMemoryCapabilityState,
  ProjectOverlapPanelResponse,
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
      files: ProjectFilesResponse | null;
      followUps: FollowUpListResponse;
      health: ApiHealth | null;
      overlap: ProjectOverlapPanelResponse | null;
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

  const { bomHealth, evidence, exportBundles, files, followUps, health, overlap, response } = detailState;
  const { bomImports, capabilities, project, revisions, summary, usages } = response;
  const recentActivity = await loadRecentActivityForProject(project.id);
  const foundationCapabilities = capabilities.filter((capability) => capability.state === "foundation");
  const plannedCapabilities = capabilities.filter((capability) => capability.state === "planned");

  return (
    <main className="projects-layout">
      <Link className="back-link" href="/projects">
        &larr; Back to projects
      </Link>

      <section className="projects-hero projects-hero--slim">
        <div className="projects-hero__copy">
          <p className="app-kicker">Project</p>
          <h1>{project.name}</h1>
          <p className="projects-hero__lede">
            <span className="ui-mono">{project.projectKey}</span>
            {project.description ? <> &mdash; {project.description}</> : null}
          </p>
          <div className="empty-recovery-actions" aria-label="Project quick actions">
            <a className="button-link" href="#project-bom-upload-heading">Upload parts list</a>
            <Link className="button-link button-link--quiet" href="/where-used">Search where-used</Link>
            <a className="button-link button-link--quiet" href="#advanced-project-tools">More tools</a>
          </div>
          <div className="projects-hero__status">
            <StatusBadge label={formatProjectStatus(project.status)} tone={projectStatusTone(project.status)} />
            <StatusBadge label={`${summary.usageCount} part${summary.usageCount === 1 ? "" : "s"}`} tone={summary.usageCount > 0 ? "verified" : "neutral"} />
            <StatusBadge label={`${summary.bomImportCount} parts list upload${summary.bomImportCount === 1 ? "" : "s"}`} tone="info" />
          </div>
        </div>
      </section>

      <section className="detail-section" aria-labelledby="project-usage-heading">
        <SectionHeading id="project-usage-heading" subtitle="The parts confirmed in this project. Type to search." title="Parts in this project" />
        <SectionPanel
          description="Only confirmed matches appear here. Unclear rows wait in diagnostics until they are reviewed."
          title={usages.length > 0 ? `${usages.length} part${usages.length === 1 ? "" : "s"} in this project` : "No confirmed parts yet"}
        >
          {usages.length > 0 ? (
            <ProjectUsageBrowser usages={usages} />
          ) : (
            <EmptyState
              title="No confirmed part usage yet"
              body="Upload a parts list below, then confirm matches to populate this list. No parts are confirmed for this project yet."
            />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-overlap-heading">
        <SectionHeading
          id="project-overlap-heading"
          subtitle="Prior projects ranked by shared confirmed parts. A reuse signal, never an approval signal."
          title="Prior project overlap"
        />
        <ProjectOverlapPanel overlap={overlap} />
      </section>

      <section className="detail-section" aria-labelledby="project-bom-upload-heading">
        <SectionHeading id="project-bom-upload-heading" subtitle="Upload a CSV or XLSX file. Map columns. Save rows." title="Upload parts list" />
        <SectionPanel
          description="This step saves your parts list rows. Matching them to known parts is a separate step so wrong rows are not linked by accident."
          title="Upload mapped BOM"
        >
          <BomImportPanel projectId={project.id} revisions={revisions} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="project-files-heading">
        <SectionHeading
          id="project-files-heading"
          subtitle="Files on disk for this project. Drop files into the folder to add them; refresh to update."
          title="Project files"
        />
        <SectionPanel
          description="Each project has its own folder with subfolders for parts list source files, datasheets, and 3D models. The site reads what is on disk."
          title="Folders on the API host"
        >
          <ProjectFilesPanel files={files} projectId={project.id} />
        </SectionPanel>
      </section>

      <ProjectAdvancedToolsDetails>
        <summary>Advanced project tools</summary>
        <p className="projects-advanced__lede muted-copy">
          Diagnostics, approvals, exports, follow-ups, evidence, and capabilities. Open these when you need them.
        </p>

        <ProjectDetailSnapshot revisionCount={summary.revisionCount} bomImportCount={summary.bomImportCount} usageCount={summary.usageCount} latestActivityAt={summary.latestActivityAt} riskFindingCount={bomHealth.findings.length} evidenceAttachmentCount={evidence.attachments.length} followUpCount={followUps.summary.openCount + followUps.summary.inProgressCount} />

        <OperatorChecklist
          primaryActionHref={response.bomImports.length > 0 ? "#project-bom-imports-heading" : "#project-bom-upload-heading"}
          primaryActionLabel={response.bomImports.length > 0 ? "Match BOM rows" : "Upload first BOM"}
          steps={[
            {
              detail: "Upload your parts list file.",
              label: "Step 1: Upload"
            },
            {
              detail: "Match the rows so the app knows which parts are real matches.",
              label: "Step 2: Match"
            },
            {
              detail: "Review issues and finish follow-up tasks.",
              label: "Step 3: Fix and finish"
            }
          ]}
          summary="Simple flow for first-time users."
          title="Project first-run checklist"
        />

        <WorkspaceActionPanel
          actions={buildProjectNextStepActions({
            bomHealth,
            evidenceAttachmentCount: evidence.attachments.length,
            exportBundleCount: exportBundles?.bundles.length ?? 0,
            followUps,
            response
          })}
          description="Task-first shortcuts for the next likely project action."
          title="Actionable next steps"
        />

        <WorkspaceActionPanel
          actions={buildProjectWorkspaceActions(response)}
          description="Project-scoped jumps for review, compare, evidence, circuit reuse, and verified exports."
          title="Next project workspaces"
        />

        <section className="detail-section" aria-labelledby="project-summary-heading">
          <SectionHeading id="project-summary-heading" subtitle="Basic project info." title="Project summary" />
          <SectionPanel description="This section shows project details only. It does not mean parts list rows are uploaded or matched yet." title={project.projectKey}>
            <ProjectSummaryGrid response={response} />
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-edit-heading">
          <SectionHeading id="project-edit-heading" subtitle="Update project name, owner, notes, and revision labels." title="Edit project memory" />
          <SectionPanel description="This updates project details only. It does not approve parts, verify files, or rerun matching." title="Edit details">
            <ProjectEditPanel project={project} revisions={revisions} />
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-revisions-heading">
          <SectionHeading id="project-revisions-heading" subtitle="Saved revision history for this project." title="Revisions" />
          <SectionPanel description="These are the revisions saved for this project." title={revisions.length > 0 ? `${revisions.length} revisions` : "No revisions saved yet"}>
            {revisions.length > 0 ? <ProjectRevisionTable revisions={revisions} /> : <EmptyState title="No revisions yet" body="No revisions have been saved for this project yet." />}
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-bom-imports-heading">
          <SectionHeading id="project-bom-imports-heading" subtitle="Saved parts list uploads." title="BOM imports" />
          <SectionPanel
            description="Each upload appears here after it is saved. Use Match rows to link parts list lines to known parts."
            title={bomImports.length > 0 ? `${bomImports.length} BOM import records` : "No persisted BOM imports"}
          >
            {bomImports.length > 0 ? (
              <BomImportTable bomImports={bomImports} />
            ) : (
              <EmptyState title="No BOM imports yet" body="No parts list import metadata is persisted for this project. Use the CSV intake panel above to preview and save mapped rows." />
            )}
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-bom-diagnostics-heading">
          <SectionHeading id="project-bom-diagnostics-heading" subtitle="See what matched, what did not, and what changed." title="BOM diagnostics" />
          <SectionPanel
            description="Use this to find unmatched rows, weak matches, and revision differences."
            title={bomImports.length > 0 ? `${bomImports.length} imports available` : "No BOM imports to diagnose"}
          >
            <BomDiagnosticsPanel bomImports={bomImports} projectId={project.id} revisions={revisions} />
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-revision-gates-heading">
          <SectionHeading id="project-revision-gates-heading" subtitle="Record review decisions for versioned BOM diffs." title="Revision approval gates" />
          <SectionPanel
            description="Gate records preserve the diff fingerprint that was reviewed."
            title={revisions.length > 1 ? "BOM diff gate" : "Need another revision"}
          >
            <ProjectRevisionApprovalGatePanel projectId={project.id} revisions={revisions} />
          </SectionPanel>
          <RecentActivityStrip events={recentActivity} targetType="project" targetId={project.id} />
        </section>

        <section className="detail-section" aria-labelledby="project-circuit-block-instantiation-heading">
          <SectionHeading
            id="project-circuit-block-instantiation-heading"
            subtitle="Add a saved circuit block into this BOM."
            title="Add circuit block to BOM"
          />
          <SectionPanel
            description="This adds rows from a reusable block. It does not auto-approve parts or files."
            title="Reusable circuit block"
          >
            <CircuitBlockInstantiationPanel projectId={project.id} revisions={revisions} />
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-risk-heading">
          <SectionHeading id="project-risk-heading" subtitle="Issues found in your parts list and matched parts." title="BOM health and risk" />
          <SectionPanel description="Each issue includes a clear next action." title={bomHealth.summary.totalLineCount > 0 ? `${bomHealth.findings.length} explainable findings` : "No BOM rows to evaluate"}>
            <ProjectBomHealthPanel health={bomHealth} />
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-approval-batch-heading">
          <SectionHeading
            id="project-approval-batch-heading"
            subtitle="Approve many parts at once when ready."
            title="Review approval gaps"
          />
          <SectionPanel
            description="This updates part approval status only."
            title="Approval queue"
          >
            <ApprovalBatchPanel projectId={project.id} />
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-export-bundles-heading">
          <SectionHeading id="project-export-bundles-heading" subtitle="Build downloadable export files." title="Export bundles" />
          <SectionPanel
            description="Only verified files are included. Missing files are listed clearly in the bundle details."
            title={exportBundles && exportBundles.bundles.length > 0 ? `${exportBundles.bundles.length} export bundle${exportBundles.bundles.length === 1 ? "" : "s"}` : "No export bundles yet"}
          >
            <ExportBundlePanel
              bundles={exportBundles ?? { bundles: [], projectId: project.id }}
              disabledReason={resolveExportBundleDisabledReason({ bomHealth, summary })}
              projectId={project.id}
              revisions={revisions}
            />
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-follow-ups-heading">
          <SectionHeading id="project-follow-ups-heading" subtitle="Track open tasks for this project." title="Follow-up work" />
          <SectionPanel description="Use this list to assign and track work items." title={followUps.followUps.length > 0 ? `${followUps.followUps.length} follow-up records` : "No follow-up records"}>
            <FollowUpPanel followUps={followUps} targetId={project.id} targetType="project" />
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-evidence-heading">
          <SectionHeading id="project-evidence-heading" subtitle="Attach notes and files that explain decisions." title="Evidence attachments" />
          <SectionPanel description="Evidence gives context for reviews and audits." title={evidence.attachments.length > 0 ? `${evidence.attachments.length} evidence attachments` : "No evidence attachments"}>
            <ProjectEvidencePanel attachments={evidence.attachments} projectId={project.id} />
          </SectionPanel>
        </section>

        <section className="detail-section" aria-labelledby="project-capabilities-heading">
          <SectionHeading id="project-capabilities-heading" subtitle="What this page can do now and what is planned next." title="Capability state" />
          <div className="projects-detail-grid">
            <SectionPanel title="Available now" description="Features you can use today.">
              <CapabilityList capabilities={foundationCapabilities} />
            </SectionPanel>
            <SectionPanel title="Planned next" description="Features not shipped yet.">
              <CapabilityList capabilities={plannedCapabilities} />
            </SectionPanel>
          </div>
        </section>
      </ProjectAdvancedToolsDetails>
    </main>
  );
}

/**
 * Loads the last few audit events for this project so the detail page can render a
 * "Recent activity" strip. Auditing is admin-gated; non-admin sessions and any
 * transport failure resolve to null so the page renders without a strip.
 */
async function loadRecentActivityForProject(projectId: string): Promise<AuditEvent[] | null> {
  const response = await fetchEntityAuditEvents("project", projectId, 5);
  return response ? response.events : null;
}

/**
 * Loads one project detail while preserving API and database setup failures.
 */
async function loadProjectDetail(projectId: string): Promise<ProjectDetailState> {
  const healthPromise = fetchApiHealth();

  try {
    const [health, response, bomHealth, evidence, followUps, exportBundles, files, overlap] = await Promise.all([
      healthPromise,
      fetchProjectDetail(projectId),
      fetchProjectBomHealth(projectId),
      fetchProjectEvidenceAttachments(projectId),
      fetchProjectFollowUps(projectId),
      fetchProjectExportBundles(projectId).catch(() => null),
      // The file mirror is not critical to rendering the project workspace, so a failure
      // here must never break the page. Catch and downgrade to null so the panel renders
      // its own honest unavailable state without setup-blocking the rest of the route.
      fetchProjectFiles(projectId).catch(() => null),
      // The overlap panel is a reuse signal layered on top of confirmed usage. Its read
      // path is informational only, so a failure must never break the project workspace:
      // catch and downgrade to null so the panel renders its own honest unavailable state.
      fetchProjectOverlapPanel(projectId).catch(() => null)
    ]);

    if (!response || !bomHealth || !evidence || !followUps) {
      return { status: "not_found" };
    }

    return {
      bomHealth,
      evidence,
      exportBundles,
      files,
      followUps,
      health,
      overlap,
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
          <p className="app-kicker">Project</p>
          <h1>{getSetupStateCopy(detailState.code).headline}</h1>
          <p className="projects-hero__lede">{getSetupStateCopy(detailState.code).body}</p>
          <div className="projects-hero__status">
            <StatusBadge label={`Database ${detailState.health?.dependencies.database ?? "unknown"}`} tone={detailState.health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
          <details className="audit-disclosure">
            <summary>Show technical details</summary>
            <p className="muted-copy">{detailState.code}: {detailState.message}</p>
          </details>
        </div>
      </section>
      <SectionPanel title="Finish setup to view project details" description="Project details appear after the database tables are migrated and data is available.">
        <div className="setup-steps">
          <div>
            <strong>Run database setup</strong>
            <code>npm run db:migrate</code>
            <code>npm run dev</code>
          </div>
          <div>
            <strong>What to expect</strong>
            <span>This page stays empty until project rows exist in your database.</span>
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
    ...(response.usages.length > 0
      ? [
          {
            body: "Prior projects ranked by how many confirmed parts they share with this BOM. Reuse signal only — not approval or export readiness.",
            href: "#project-overlap-heading",
            label: "Prior project overlap",
            signal: "Reuse hint"
          } satisfies WorkspaceAction
        ]
      : []),
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
      body: "Record a review gate for the exact BOM diff between two saved revisions.",
      href: "#project-revision-gates-heading",
      label: "Gate BOM revision",
      signal: response.revisions.length > 1 ? "Diff ready" : "Needs revisions"
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
 * Builds task-first actions so first-time operators can continue project flow without hunting sections.
 */
function buildProjectNextStepActions({
  bomHealth,
  evidenceAttachmentCount,
  exportBundleCount,
  followUps,
  response
}: {
  bomHealth: ProjectBomHealthResponse;
  evidenceAttachmentCount: number;
  exportBundleCount: number;
  followUps: FollowUpListResponse;
  response: ProjectDetailResponse;
}): WorkspaceAction[] {
  const hasBomImports = response.bomImports.length > 0;
  const hasUsage = response.usages.length > 0;
  const openFollowUps = followUps.summary.openCount + followUps.summary.inProgressCount;
  const hasBomRows = bomHealth.summary.totalLineCount > 0;
  const hasFindings = bomHealth.findings.length > 0;

  return [
    hasBomImports
      ? {
          body: "Persist the next revision so diagnostics and compare stay current.",
          href: "#project-bom-upload-heading",
          label: "Upload next BOM revision",
          signal: `${response.bomImports.length} imported`
        }
      : {
          body: "Start by uploading one mapped BOM so the rest of this workspace can derive usage and risk.",
          href: "#project-bom-upload-heading",
          label: "Upload first BOM",
          signal: "No BOM imports"
        },
    hasUsage
      ? {
          body: "Review confirmed matches and jump to part detail where trust/export decisions are needed.",
          href: "#project-usage-heading",
          label: "Review confirmed usage",
          signal: `${response.usages.length} confirmed`
        }
      : {
          body: "Run row matching so project BOM lines become confirmed usage where confidence is exact.",
          href: "#project-bom-imports-heading",
          label: "Match imported BOM rows",
          signal: hasBomImports ? "0 confirmed usage" : "Needs BOM import"
        },
    hasBomRows
      ? {
          body: hasFindings ? "Triage explainable BOM findings and run the next concrete action." : "BOM health is currently clear; keep it clear as revisions land.",
          href: "#project-risk-heading",
          label: hasFindings ? "Triage BOM health findings" : "Review BOM health status",
          signal: hasFindings ? `${bomHealth.findings.length} findings` : "No findings"
        }
      : {
          body: "No risk derivation yet because no BOM rows are available.",
          href: "#project-bom-diagnostics-heading",
          label: "Open BOM diagnostics",
          signal: "No BOM rows"
        },
    openFollowUps > 0
      ? {
          body: "Close or progress tracked project work before the next release checkpoint.",
          href: "#project-follow-ups-heading",
          label: "Resolve follow-ups",
          signal: `${openFollowUps} active`
        }
      : {
          body: "No active follow-ups right now; create one when a finding needs tracked execution.",
          href: "#project-follow-ups-heading",
          label: "Review follow-up queue",
          signal: "No active follow-ups"
        },
    exportBundleCount > 0
      ? {
          body: "Inspect the latest bundle state and download archives for install/export workflows.",
          href: "#project-export-bundles-heading",
          label: "Inspect export bundles",
          signal: `${exportBundleCount} bundles`
        }
      : {
          body: evidenceAttachmentCount > 0
            ? "Generate a first bundle when verified file-backed assets are available."
            : "Attach evidence and verify assets, then generate the first bundle.",
          href: "#project-export-bundles-heading",
          label: "Generate first export bundle",
          signal: "No bundles"
        }
  ];
}

/**
 * Resolves the reason an export bundle cannot be generated yet, or null when generation is
 * worth attempting. Conservative on purpose: the manifest honestly lists omissions when only
 * *some* assets lack verified-for-export promotion, so we only gate the button when the bundle
 * is guaranteed to be empty (no confirmed parts in the project at all).
 *
 * The brief requires disabled export actions to name exactly what verified file-backed assets
 * are missing rather than letting an operator click into a silent empty bundle.
 */
function resolveExportBundleDisabledReason({
  bomHealth,
  summary
}: {
  bomHealth: ProjectBomHealthResponse;
  summary: ProjectDetailResponse["summary"];
}): string | null {
  if (summary.usageCount === 0 && bomHealth.summary.matchedLineCount === 0) {
    return "No confirmed parts in this project yet. Upload a BOM and match rows before generating a bundle.";
  }

  return null;
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
 * Renders the explainable BOM health summary and findings.
 */
function ProjectBomHealthPanel({ health }: { health: ProjectBomHealthResponse }) {
  const { summary } = health;

  if (summary.totalLineCount === 0) {
    return <EmptyState title="No parts list to check" body="Upload a parts list first. Once it is mapped, the health view will flag row, part, CAD, evidence, and lifecycle issues." />;
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
        <EmptyState title="No issues found" body="No rules flagged anything in this BOM. That does not approve the parts for export — it just means nothing is currently flagged." />
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
        <EmptyState title="No evidence yet" body="Attach a link or note so future you remembers why this decision was made." />
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
    return <EmptyState title="No capabilities reported" body="We could not read capability information for this project." />;
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
