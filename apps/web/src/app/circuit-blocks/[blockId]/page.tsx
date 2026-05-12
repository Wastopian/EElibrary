/**
 * File header: Renders one reusable circuit block with part roles, evidence, and readiness boundaries.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { CircuitBlockEditPanel } from "../../../components/CircuitBlockEditPanel";
import { CircuitBlockPartEditTable } from "../../../components/CircuitBlockPartEditTable";
import { CircuitBlockPartAddPanel } from "../../../components/CircuitBlockPartAddPanel";
import { EvidenceAttachmentPanel } from "../../../components/EvidenceAttachmentPanel";
import { FollowUpPanel } from "../../../components/FollowUpPanel";
import { WorkspaceJumpNav } from "../../../components/WorkspaceJumpNav";
import { fetchCircuitBlockDetail, fetchCircuitBlockFollowUps, isApiClientError } from "../../../lib/api-client";
import { getSetupStateCopy } from "../../../lib/setup-state-copy";
import type { BadgeTone } from "@ee-library/ui";
import type { CircuitBlockDetailResponse, CircuitBlockProjectDependency, CircuitBlockStatus, CircuitBlockType, EvidenceAttachment, FollowUpListResponse } from "@ee-library/shared/types";

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
          { href: "#circuit-block-summary-heading", label: "Summary" },
          { href: "#circuit-block-edit-heading", label: "Edit" },
          { href: "#circuit-block-parts-heading", label: "Parts" },
          { href: "#circuit-block-add-part-heading", label: "Add part" },
          { href: "#circuit-block-deps-heading", label: "Dependent projects" },
          { href: "#circuit-block-follow-ups-heading", label: "Follow-ups" },
          { href: "#circuit-block-evidence-heading", label: "Evidence" }
        ]}
      />

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

      <section className="detail-section" aria-labelledby="circuit-block-deps-heading">
        <SectionHeading id="circuit-block-deps-heading" index="05" subtitle="Projects with confirmed usages of parts in this block's roles." title="Dependent projects" />
        <SectionPanel description="Dependency context comes from confirmed project usage records. It does not approve the block, validate parts, or unlock export." title={detail.projectDependencies.length > 0 ? `${detail.projectDependencies.length} dependent project${detail.projectDependencies.length === 1 ? "" : "s"}` : "No dependent projects"}>
          {detail.projectDependencies.length > 0
            ? <CircuitBlockProjectDependencyTable dependencies={detail.projectDependencies} />
            : <EmptyState title="No project dependencies yet" body="Projects become dependent when their confirmed BOM usages overlap with this block's part roles." />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-evidence-heading">
        <SectionHeading id="circuit-block-follow-ups-heading" index="06" subtitle="Open work items captured from gaps in required part roles." title="Follow-up work" />
        <SectionPanel description="Follow-up workflow state does not approve linked parts or make this circuit export-ready. Refresh creates or updates records from current required-role readiness gaps." title={followUps.followUps.length > 0 ? `${followUps.followUps.length} follow-up records` : "No follow-up records"}>
          <FollowUpPanel followUps={followUps} targetId={detail.circuitBlock.id} targetType="circuit_block" />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-evidence-heading">
        <SectionHeading id="circuit-block-evidence-heading" index="07" subtitle="Supporting links, notes, and files for this block. Reference material only." title="Evidence" />
        <SectionPanel description="Circuit block evidence is provenance. It does not approve the block, validate assets, or unlock export." title={detail.evidence.length > 0 ? `${detail.evidence.length} evidence attachments` : "No evidence attachments"}>
          <div className="project-evidence-panel">
            <div className="project-evidence-panel__boundary">
              <strong>Evidence is provenance.</strong> It supports future review without changing part approval, validation, or export readiness.
            </div>
            <EvidenceAttachmentPanel submitLabel="Attach circuit evidence" targetId={detail.circuitBlock.id} targetType="circuit_block" />
            {detail.evidence.length > 0 ? <CircuitBlockEvidenceTable evidence={detail.evidence} /> : <EmptyState title="No circuit evidence yet" body="Attach design review links or notes when this reusable circuit is reviewed." />}
          </div>
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
