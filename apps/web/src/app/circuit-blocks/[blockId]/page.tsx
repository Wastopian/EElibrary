/**
 * File header: Renders one reusable circuit block with part roles, evidence, and readiness boundaries.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { CircuitBlockEditPanel } from "../../../components/CircuitBlockEditPanel";
import { CircuitBlockPartEditTable } from "../../../components/CircuitBlockPartEditTable";
import { CircuitBlockKnownRisksPanel } from "../../../components/CircuitBlockKnownRisksPanel";
import { CircuitBlockPartAddPanel } from "../../../components/CircuitBlockPartAddPanel";
import { EvidenceAttachmentPanel } from "../../../components/EvidenceAttachmentPanel";
import { FollowUpPanel } from "../../../components/FollowUpPanel";
import { WorkspaceJumpNav } from "../../../components/WorkspaceJumpNav";
import { fetchCircuitBlockDetail, fetchCircuitBlockFollowUps, isApiClientError } from "../../../lib/api-client";
import {
  getCircuitBlockReuseReadiness,
  type CircuitBlockReuseStageState,
  type CircuitBlockReuseStageSummary
} from "../../../lib/circuit-block-reuse-readiness";
import { getSetupStateCopy } from "../../../lib/setup-state-copy";
import type { BadgeTone } from "@ee-library/ui";
import type {
  CircuitBlock,
  CircuitBlockDetailResponse,
  CircuitBlockInstantiationHistoryRecord,
  CircuitBlockProjectDependency,
  CircuitBlockStatus,
  CircuitBlockType,
  EvidenceAttachment,
  FollowUpListResponse
} from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** CircuitBlockDetailState separates ready detail reads from setup failures. */
type CircuitBlockDetailState =
  | {
      detail: CircuitBlockDetailResponse;
      followUps: FollowUpListResponse;
      status: "ready";
    }
  | {
      code: string;
      message: string;
      status: "setup_required";
    }
  | {
      status: "not_found";
    };

/**
 * Renders the circuit block detail workspace.
 */
export default async function CircuitBlockDetailPage({ params }: { params: Promise<{ blockId: string }> }) {
  const { blockId } = await params;
  const pageState = await loadCircuitBlockDetail(blockId);

  if (pageState.status === "not_found") {
    notFound();
  }

  if (pageState.status === "setup_required") {
    return <CircuitBlockDetailSetupState pageState={pageState} />;
  }

  const { detail, followUps } = pageState;

  return (
    <main className="projects-layout">
      <Link className="back-link" href="/circuit-blocks">
        &larr; Back to circuit blocks
      </Link>
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Circuit block detail</p>
            <h1>{detail.circuitBlock.name}</h1>
            <p className="projects-hero__lede">
              <span className="ui-mono">{detail.circuitBlock.blockKey}</span> preserves part roles, constraints, reuse scope, and evidence for this circuit pattern. Linked parts keep their own approval, readiness, and export truth.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label={formatCircuitBlockStatus(detail.circuitBlock.status)} tone={circuitBlockStatusTone(detail.circuitBlock.status)} />
              <StatusBadge label={formatCircuitBlockType(detail.circuitBlock.blockType)} tone="info" />
              <StatusBadge label={`${detail.summary.readinessGapCount} readiness gaps`} tone={detail.summary.readinessGapCount > 0 ? "review" : "verified"} />
            </div>
          </div>
          <CircuitBlockDetailSnapshot detail={detail} followUpCount={followUps.summary.openCount + followUps.summary.inProgressCount} />
        </div>
      </section>

      <WorkspaceJumpNav
        ariaLabel="Circuit block detail sections"
        items={[
          { href: "#circuit-block-reuse-readiness-heading", label: "Reuse readiness" },
          { href: "#circuit-block-summary-heading", label: "Summary" },
          { href: "#circuit-block-edit-heading", label: "Edit" },
          { href: "#circuit-block-parts-heading", label: "Parts" },
          { href: "#circuit-block-add-part-heading", label: "Add part" },
          { href: "#circuit-block-instantiations-heading", label: "Reuse history" },
          { href: "#circuit-block-known-risks-heading", label: "Known risks" },
          { href: "#circuit-block-deps-heading", label: "Dependent projects" },
          { href: "#circuit-block-follow-ups-heading", label: "Follow-ups" },
          { href: "#circuit-block-evidence-heading", label: "Evidence" },
          { href: "#circuit-block-next-workspaces-heading", label: "Next workspaces" }
        ]}
      />

      <CircuitBlockReuseReadinessStrip detail={detail} />

      <section className="detail-section" aria-labelledby="circuit-block-summary-heading">
        <SectionHeading id="circuit-block-summary-heading" index="01" subtitle="Block details and reuse constraints." title="Block summary" />
        <SectionPanel description={detail.boundary} title={detail.circuitBlock.blockKey}>
          <dl className="projects-summary-grid">
            <div>
              <dt>Type</dt>
              <dd>{formatCircuitBlockType(detail.circuitBlock.blockType)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge label={formatCircuitBlockStatus(detail.circuitBlock.status)} tone={circuitBlockStatusTone(detail.circuitBlock.status)} />
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{detail.circuitBlock.owner ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDateTime(detail.circuitBlock.updatedAt)}</dd>
            </div>
            <div className="projects-summary-grid__wide">
              <dt>Reuse scope</dt>
              <dd>{detail.circuitBlock.reuseScope || "No reuse scope recorded."}</dd>
            </div>
            <div className="projects-summary-grid__wide">
              <dt>Description</dt>
              <dd>{detail.circuitBlock.description || "No description recorded."}</dd>
            </div>
            <div className="projects-summary-grid__wide">
              <dt>Constraints</dt>
              <dd>{formatConstraints(detail.circuitBlock.constraints)}</dd>
            </div>
          </dl>
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-edit-heading">
        <SectionHeading id="circuit-block-edit-heading" index="02" subtitle="Update the block's name, notes, and constraints. Linked parts are not affected." title="Edit circuit block" />
        <SectionPanel description="These edits update block metadata only. Block status, scope, and constraints do not approve linked parts or verify export assets." title="Metadata maintenance">
          <CircuitBlockEditPanel circuitBlock={detail.circuitBlock} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-parts-heading">
        <SectionHeading id="circuit-block-parts-heading" index="03" subtitle="Part roles stay tied to current catalog readiness and approval state." title="Part roles" />
        <SectionPanel description="Required and optional roles are saved separately. A block can be approved while a linked part still needs review." title={detail.parts.length > 0 ? `${detail.parts.length} part roles` : "No part roles"}>
          {detail.parts.length > 0 ? <CircuitBlockPartEditTable circuitBlockId={detail.circuitBlock.id} parts={detail.parts} /> : <EmptyState title="No part roles yet" body="Add internal part roles before this circuit block can support reuse review." />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-add-part-heading">
        <SectionHeading id="circuit-block-add-part-heading" index="04" subtitle="Link known internal parts to required or optional roles." title="Add part role" />
        <SectionPanel description="Part roles record reuse structure and substitution policy. They do not change part approval or export readiness." title="New part role">
          <CircuitBlockPartAddPanel circuitBlockId={detail.circuitBlock.id} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-instantiations-heading">
        <SectionHeading
          id="circuit-block-instantiations-heading"
          index="05"
          subtitle="Engineering memory: every time this reusable block was dropped into a project BOM."
          title="Reuse history"
        />
        <SectionPanel
          description="Instantiation rows record where this pattern was used. They do not approve linked parts, validate assets, or make export available — they preserve the decision trail."
          title={detail.instantiations.length > 0 ? `${detail.instantiations.length} instantiation${detail.instantiations.length === 1 ? "" : "s"}` : "No instantiations yet"}
        >
          {detail.instantiations.length > 0
            ? <CircuitBlockInstantiationHistoryTable instantiations={detail.instantiations} />
            : <EmptyState title="No reuse instantiations yet" body="When this block is instantiated into a project BOM, the project, revision, and BOM lines created will appear here." />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-known-risks-heading">
        <SectionHeading
          id="circuit-block-known-risks-heading"
          index="06"
          subtitle="Engineering memory the team learned the hard way: errata, limitations, and cautions tied to this reusable pattern."
          title="Known risks &amp; limitations"
        />
        <SectionPanel
          description="Known risks preserve institutional memory; unresolved blocking risks gate the reusable-stage verdict, but no severity changes linked-part approval, validation, or export status. Resolved rows stay visible so past project audits remain consistent."
          title={detail.knownRisks.length > 0
            ? `${detail.knownRisks.length} recorded risk${detail.knownRisks.length === 1 ? "" : "s"} (${detail.summary.activeKnownRiskCount} active${detail.summary.activeBlockingRiskCount > 0 ? `, ${detail.summary.activeBlockingRiskCount} blocking` : ""})`
            : "No known risks recorded"}
        >
          <CircuitBlockKnownRisksPanel circuitBlockId={detail.circuitBlock.id} knownRisks={detail.knownRisks} />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-deps-heading">
        <SectionHeading id="circuit-block-deps-heading" index="07" subtitle="Projects with confirmed usages of parts in this block's roles." title="Dependent projects" />
        <SectionPanel description="Dependency context comes from confirmed project usage records. It does not approve the block, validate parts, or make export available." title={detail.projectDependencies.length > 0 ? `${detail.projectDependencies.length} dependent project${detail.projectDependencies.length === 1 ? "" : "s"}` : "No dependent projects"}>
          {detail.projectDependencies.length > 0
            ? <CircuitBlockProjectDependencyTable dependencies={detail.projectDependencies} />
            : <EmptyState title="No project dependencies yet" body="Projects become dependent when their confirmed BOM usages overlap with this block's part roles." />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-follow-ups-heading">
        <SectionHeading id="circuit-block-follow-ups-heading" index="08" subtitle="Open work items captured from gaps in required part roles." title="Follow-up work" />
        <SectionPanel description="Follow-up workflow state does not approve linked parts or make this circuit export-ready. Refresh creates or updates records from current required-role readiness gaps." title={followUps.followUps.length > 0 ? `${followUps.followUps.length} follow-up records` : "No follow-up records"}>
          <FollowUpPanel followUps={followUps} targetId={detail.circuitBlock.id} targetType="circuit_block" />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-evidence-heading">
        <SectionHeading id="circuit-block-evidence-heading" index="09" subtitle="Supporting links, notes, and files for this block. Reference material only." title="Evidence" />
        <SectionPanel description="Circuit block evidence is provenance. It does not approve the block, validate assets, or make export available." title={detail.evidence.length > 0 ? `${detail.evidence.length} evidence attachments` : "No evidence attachments"}>
          <div className="project-evidence-panel">
            <div className="project-evidence-panel__boundary">
              <strong>Evidence is provenance.</strong> It supports future review without changing part approval, validation, or export readiness.
            </div>
            <EvidenceAttachmentPanel submitLabel="Attach circuit evidence" targetId={detail.circuitBlock.id} targetType="circuit_block" />
            {detail.evidence.length > 0 ? <CircuitBlockEvidenceTable evidence={detail.evidence} /> : <EmptyState title="No circuit evidence yet" body="Attach design review links or notes when this reusable circuit is reviewed." />}
          </div>
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-next-workspaces-heading">
        <SectionHeading
          id="circuit-block-next-workspaces-heading"
          index="10"
          subtitle="Cross-link into the workspaces that work alongside this block. Each link is read-only context — none of these change reuse readiness or part approval."
          title="Next workspaces"
        />
        <SectionPanel
          description="Engineering teams typically move from a block to: a project that needs to reuse it, the global where-used view, or the full library."
          title="Open a related workspace"
        >
          <CircuitBlockNextWorkspaces circuitBlock={detail.circuitBlock} dependentProjects={detail.projectDependencies} />
        </SectionPanel>
      </section>
    </main>
  );
}

/**
 * Loads a circuit block detail and maps API failures into page states.
 */
async function loadCircuitBlockDetail(blockId: string): Promise<CircuitBlockDetailState> {
  try {
    const [detail, followUps] = await Promise.all([
      fetchCircuitBlockDetail(blockId),
      fetchCircuitBlockFollowUps(blockId)
    ]);

    return detail && followUps ? { detail, followUps, status: "ready" } : { status: "not_found" };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        message: error.message,
        status: "setup_required"
      };
    }

    return {
      code: "API_UNAVAILABLE",
      message: "The API could not be reached, so circuit block detail cannot be read.",
      status: "setup_required"
    };
  }
}

/**
 * Renders setup or degraded-state guidance for circuit block detail.
 */
function CircuitBlockDetailSetupState({ pageState }: { pageState: Extract<CircuitBlockDetailState, { status: "setup_required" }> }) {
  return (
    <main className="projects-layout">
      <Link className="back-link" href="/circuit-blocks">
        &larr; Back to circuit blocks
      </Link>
      <section className="projects-hero">
        <div className="projects-hero__copy">
          <p className="app-kicker">Circuit block detail</p>
          <h1>{getSetupStateCopy(pageState.code).headline}</h1>
          <p className="projects-hero__lede">{getSetupStateCopy(pageState.code).body} Circuit block detail needs persisted block, part-role, and evidence tables.</p>
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
 * Renders detail-level summary counters.
 */
function CircuitBlockDetailSnapshot({ detail, followUpCount }: { detail: CircuitBlockDetailResponse; followUpCount: number }) {
  return (
    <div className="projects-hero__snapshot" aria-label="Circuit block detail summary">
      <CircuitBlockStat label="Part roles" tone="neutral" value={detail.summary.totalPartCount.toString()} />
      <CircuitBlockStat label="Required" tone="info" value={detail.summary.requiredPartCount.toString()} />
      <CircuitBlockStat label="Approved parts" tone={detail.summary.approvedPartCount === detail.summary.totalPartCount && detail.summary.totalPartCount > 0 ? "verified" : "review"} value={detail.summary.approvedPartCount.toString()} />
      <CircuitBlockStat label="Readiness gaps" tone={detail.summary.readinessGapCount > 0 ? "review" : "verified"} value={detail.summary.readinessGapCount.toString()} />
      <CircuitBlockStat label="Lifecycle risk" tone={detail.summary.lifecycleRiskCount > 0 ? "danger" : "verified"} value={detail.summary.lifecycleRiskCount.toString()} />
      <CircuitBlockStat label="Strict subs" tone={detail.summary.strictSubstitutionCount > 0 ? "review" : "neutral"} value={detail.summary.strictSubstitutionCount.toString()} />
      <CircuitBlockStat label="Dependent projects" tone={detail.projectDependencies.length > 0 ? "info" : "neutral"} value={detail.projectDependencies.length.toString()} />
      <CircuitBlockStat label="Follow-ups" tone={followUpCount > 0 ? "danger" : "neutral"} value={followUpCount.toString()} />
    </div>
  );
}

/**
 * Renders one compact detail stat tile.
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
 * Renders the four-stage reuse-readiness strip above the detail body.
 *
 * Mirrors the part-detail trust lineage strip so engineers see a scannable verdict on whether
 * the block is defined, has roles, has approved/ready parts, and is itself approved for reuse —
 * without conflating those gates with part-level approval or export readiness.
 */
function CircuitBlockReuseReadinessStrip({ detail }: { detail: CircuitBlockDetailResponse }) {
  const summary = getCircuitBlockReuseReadiness(detail);
  const guidance = summarizeReuseReadinessGuidance(summary.stages);

  return (
    <section className="detail-section" aria-labelledby="circuit-block-reuse-readiness-heading">
      <SectionHeading
        id="circuit-block-reuse-readiness-heading"
        index="00"
        subtitle="Defined → roles complete → parts ready → reusable. Each gate is independent."
        title="Reuse readiness"
      />
      <section className="trust-lineage-strip" role="group" aria-label="Circuit block reuse readiness">
        <div className="trust-lineage-strip__guidance">
          <strong>{guidance.title}</strong>
          <p>{guidance.detail}</p>
        </div>
        <details className="trust-lineage-strip__steps">
          <summary>Show reuse gates</summary>
          <ol className="trust-lineage-strip__stages">
            {summary.stages.map((stage, index) => (
              <li
                key={stage.stage}
                className="trust-lineage-strip__item"
                data-state={stage.state}
              >
                <div className="trust-lineage-strip__item-header">
                  <StatusBadge label={stage.label} tone={reuseStageBadgeTone(stage)} />
                  <span className={`trust-lineage-strip__state trust-lineage-strip__state--${stage.state}`}>
                    {stage.badgeLabel}
                  </span>
                </div>
                <p className="trust-lineage-strip__detail">{stage.detail}</p>
                {index < summary.stages.length - 1 ? (
                  <span aria-hidden="true" className="trust-lineage-strip__connector">→</span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="trust-lineage-strip__boundary muted-copy">{summary.boundary}</p>
        </details>
      </section>
    </section>
  );
}

/**
 * Produces a short headline + detail line based on the worst stage state.
 *
 * Keeps the headline honest: a blocked or pending later stage always wins over a passed
 * earlier stage, mirroring the part-detail trust strip's "headline first, drill down second"
 * pattern. This is the only place block-level reuse readiness is summarized.
 */
function summarizeReuseReadinessGuidance(stages: CircuitBlockReuseStageSummary[]): { title: string; detail: string } {
  const firstBlocked = stages.find((stage) => stage.state === "blocked");

  if (firstBlocked) {
    return {
      detail: firstBlocked.detail,
      title: `Reuse blocked at "${firstBlocked.label}"`
    };
  }

  const firstPending = stages.find((stage) => stage.state === "pending");

  if (firstPending) {
    return {
      detail: firstPending.detail,
      title: `Reuse pending at "${firstPending.label}"`
    };
  }

  const reusable = stages[stages.length - 1];
  const notApplicable = stages.find((stage) => stage.state === "not_applicable");

  if (notApplicable) {
    return {
      detail: notApplicable.detail,
      title: `Reuse retired at "${notApplicable.label}"`
    };
  }

  return {
    detail: reusable?.detail ?? "All reuse gates passed. Linked-part approval and export readiness remain separate per part.",
    title: "Ready to reuse"
  };
}

/**
 * Renders the instantiation history table: one row per reuse event.
 *
 * Each row links the operator to the destination project, revision, and BOM import so the
 * "this pattern was used here" decision trail stays one click away. The BOM line count is
 * shown as engineering memory, not a trust signal.
 */
function CircuitBlockInstantiationHistoryTable({ instantiations }: { instantiations: CircuitBlockInstantiationHistoryRecord[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Revision</th>
            <th>BOM import</th>
            <th>Lines</th>
            <th>Optional?</th>
            <th>Instantiated</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {instantiations.map((record) => (
            <tr key={record.instantiation.id}>
              <td>
                <Link href={`/projects/${encodeURIComponent(record.project.id)}`}>
                  <span className="ui-mono">{record.project.projectKey}</span>
                </Link>
                <div className="muted-copy">{record.project.name}</div>
              </td>
              <td>
                <span className="ui-mono">{record.revision.revisionLabel}</span>
                <div className="muted-copy">{record.revision.revisionStatus}</div>
              </td>
              <td>
                {record.bomImport ? (
                  <>
                    <strong>{record.bomImport.sourceFilename}</strong>
                    <div className="muted-copy">{record.bomImport.sourceFormat.toUpperCase()} · {record.bomImport.importStatus}</div>
                  </>
                ) : (
                  <span className="muted-copy">BOM import removed</span>
                )}
              </td>
              <td>{record.instantiatedBomLineCount}</td>
              <td>{record.instantiation.includeOptional ? "Included" : "Required only"}</td>
              <td>{formatDateTime(record.instantiation.createdAt)}</td>
              <td>{record.instantiation.createdBy ?? <span className="muted-copy">Unrecorded</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Maps a reuse-readiness stage onto a status badge tone.
 *
 * Keeps the badge consistent with the rest of the detail page without leaking the helper's
 * `ViewTone` into the UI library types.
 */
function reuseStageBadgeTone(stage: CircuitBlockReuseStageSummary): BadgeTone {
  if (stage.state === "passed") return stage.tone === "verified" ? "verified" : "info";
  if (stage.state === "blocked") return stage.tone === "danger" ? "danger" : "review";
  if (stage.state === "pending") return stage.tone === "review" ? "review" : "neutral";
  return "neutral";
}

/**
 * Formats a stage state into the short suffix shown next to each stage badge.
 */
function formatReuseStageStateLabel(state: CircuitBlockReuseStageState): string {
  switch (state) {
    case "blocked":
      return "blocked";
    case "not_applicable":
      return "n/a";
    case "passed":
      return "passed";
    case "pending":
      return "pending";
    default:
      return state;
  }
}

/**
 * Renders projects that depend on this circuit block through confirmed part usages.
 */
function CircuitBlockProjectDependencyTable({ dependencies }: { dependencies: CircuitBlockProjectDependency[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Status</th>
            <th>Parts matched</th>
            <th>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {dependencies.map((dep) => (
            <tr key={dep.project.id}>
              <td>
                <Link href={`/projects/${encodeURIComponent(dep.project.id)}`}>{dep.project.projectKey}</Link>
                <div className="muted-copy">{dep.project.name}</div>
              </td>
              <td>
                <StatusBadge label={dep.project.status} tone={dep.project.status === "production" ? "verified" : "info"} />
              </td>
              <td>{dep.matchedPartCount} / {dep.totalBlockPartCount}</td>
              <td>
                <StatusBadge
                  label={dep.matchedPartCount === dep.totalBlockPartCount ? "Full overlap" : "Partial overlap"}
                  tone={dep.matchedPartCount === dep.totalBlockPartCount ? "verified" : "review"}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders the cross-workspace nav for engineering teams working from a block to its neighbours.
 *
 * Three links are surfaced: open a dependent project to instantiate this block into its BOM,
 * see every usage of the block in the global where-used workspace, or jump back to the full
 * library. None of these links change reuse readiness or part approval — they exist so an
 * engineer can move from "what is this block" to "where do I use it" without leaving the page.
 */
function CircuitBlockNextWorkspaces({
  circuitBlock,
  dependentProjects
}: {
  circuitBlock: CircuitBlock;
  dependentProjects: CircuitBlockProjectDependency[];
}) {
  const whereUsedHref = `/where-used?targetType=circuit_block&q=${encodeURIComponent(circuitBlock.blockKey)}`;
  const topDependent = dependentProjects[0];

  return (
    <div className="circuit-block-next-workspaces">
      <article className="circuit-block-next-workspaces__card">
        <header>
          <p className="app-kicker">Use in a project</p>
          <h3>{topDependent ? `Reuse in ${topDependent.project.projectKey}` : "Pick a project to instantiate"}</h3>
        </header>
        <p>
          {topDependent
            ? `${topDependent.project.name} already overlaps with ${topDependent.matchedPartCount} of ${topDependent.totalBlockPartCount} part role${topDependent.totalBlockPartCount === 1 ? "" : "s"} in this block. Open the project to add this block to a BOM revision.`
            : "No project depends on this block yet. Open the projects workspace to pick a target BOM revision."}
        </p>
        <Link
          className="button-primary"
          href={topDependent
            ? `/projects/${encodeURIComponent(topDependent.project.id)}#project-circuit-block-instantiation-heading`
            : "/projects"}
        >
          {topDependent ? `Open ${topDependent.project.projectKey}` : "Browse projects"}
        </Link>
      </article>

      <article className="circuit-block-next-workspaces__card">
        <header>
          <p className="app-kicker">Where-used</p>
          <h3>Every project that touched this block</h3>
        </header>
        <p>
          Search confirmed BOM usages, circuit-block dependencies, and exported-asset trails. Past usage does not approve linked parts or make exports available.
        </p>
        <Link className="button-primary" href={whereUsedHref}>
          Open where-used for {circuitBlock.blockKey}
        </Link>
      </article>

      <article className="circuit-block-next-workspaces__card">
        <header>
          <p className="app-kicker">Library</p>
          <h3>Browse all circuit blocks</h3>
        </header>
        <p>
          Filter by type, status, or reuse readiness to find a block that matches what you are designing right now.
        </p>
        <Link
          className="button-secondary"
          href={`/circuit-blocks?type=${encodeURIComponent(circuitBlock.blockType)}`}
        >
          See all {formatCircuitBlockType(circuitBlock.blockType).toLowerCase()} blocks
        </Link>
      </article>
    </div>
  );
}

/**
 * Renders evidence rows attached to the circuit block or its part-role records.
 */
function CircuitBlockEvidenceTable({ evidence }: { evidence: EvidenceAttachment[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Evidence</th>
            <th>Target</th>
            <th>Status</th>
            <th>Reference</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {evidence.map((attachment) => (
            <tr key={attachment.id}>
              <td>
                <strong>{attachment.title}</strong>
                <div className="muted-copy">{attachment.evidenceType}</div>
              </td>
              <td>
                <span className="ui-mono">{attachment.targetType}</span>
                <div className="muted-copy">{attachment.targetId}</div>
              </td>
              <td>
                <StatusBadge label={attachment.reviewStatus} tone={attachment.reviewStatus === "accepted" ? "verified" : "review"} />
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
 * Renders constraints as compact text without exposing raw JSON syntax for common note records.
 */
function formatConstraints(constraints: Record<string, unknown>): string {
  if (typeof constraints.note === "string" && constraints.note.trim().length > 0) {
    return constraints.note;
  }

  const entries = Object.entries(constraints);

  return entries.length > 0 ? entries.map(([key, value]) => `${key}: ${String(value)}`).join("; ") : "No constraints recorded.";
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
  if (status === "approved") {
    return "verified";
  }

  if (status === "in_review" || status === "restricted") {
    return "review";
  }

  if (status === "deprecated") {
    return "neutral";
  }

  return "info";
}

/**
 * Renders the best available evidence reference.
 */
function renderEvidenceReference(attachment: EvidenceAttachment): React.ReactNode {
  if (attachment.sourceUrl) {
    return (
      <a href={attachment.sourceUrl} rel="noreferrer" target="_blank">
        Source link
      </a>
    );
  }

  if (attachment.storageKey) {
    return <span className="ui-mono">{attachment.storageKey}</span>;
  }

  return attachment.notes ?? "No reference";
}

/**
 * Formats timestamps for detail tables.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
