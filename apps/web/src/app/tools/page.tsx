/**
 * File header: Renders the dedicated engineering tools workspace.
 *
 * These tools reinforce project and part memory by producing evidence-note drafts,
 * not approval decisions or hidden data mutations.
 */

import Link from "next/link";
import React from "react";
import { SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { EngineeringToolsWorkspace } from "../../components/EngineeringToolsWorkspace";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";

/** ToolsPage renders local engineering scratchpads without requiring API data. */
export default function ToolsPage() {
  return (
    <main className="projects-layout tools-page">
      <section className="projects-hero tools-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Engineering tools</p>
            <h1>Calculators that leave a trail</h1>
            <p className="projects-hero__lede">
              Run common EE checks, then carry the result into project evidence, part notes, or review follow-ups. The math is local scratchpad context, not approval.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label="Local scratchpad" tone="info" />
              <StatusBadge label="Evidence-note draft" tone="review" />
              <StatusBadge label="No gate changes" tone="neutral" />
            </div>
          </div>
          <div className="projects-hero__snapshot" aria-label="Tools summary">
            <ToolHeroStat label="Tools" tone="info" value="3" />
            <ToolHeroStat label="Writes" tone="neutral" value="0" />
            <ToolHeroStat label="Evidence" tone="review" value="Draft" />
            <ToolHeroStat label="Approvals" tone="neutral" value="None" />
          </div>
        </div>
      </section>

      <WorkspaceJumpNav
        ariaLabel="Engineering tools sections"
        items={[
          { href: "#tools-workbench-heading", label: "Workbench" },
          { href: "#tools-handoff-heading", label: "Handoff" },
          { href: "#tools-boundaries-heading", label: "Boundaries" }
        ]}
      />

      <section className="detail-section" aria-labelledby="tools-workbench-heading">
        <SectionHeading
          id="tools-workbench-heading"
          index="01"
          subtitle="Load-aware divider, pull-up edge, and power-derating checks with copyable calculation records."
          title="Tool workbench"
        />
        <SectionPanel description="Each result is a scratch calculation and note draft. Save the note elsewhere only after engineering review." title="Calculator scratchpad">
          <EngineeringToolsWorkspace />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="tools-handoff-heading">
        <SectionHeading
          id="tools-handoff-heading"
          index="02"
          subtitle="Move from a calculation into the existing memory surfaces that preserve decisions."
          title="Project handoff"
        />
        <SectionPanel description="Tools stay useful when their output is attached to the project or part decision they support." title="Next places for the note">
          <div className="tools-handoff-grid">
            <ToolHandoffLink
              body="Attach reviewed calculations to a project, BOM line, part, or circuit block as supporting evidence."
              href="/evidence"
              label="Attach evidence"
              signal="Evidence"
            />
            <ToolHandoffLink
              body="Open the active BOM before deciding whether this check changes a follow-up, substitution, or approval review."
              href="/projects"
              label="Open projects"
              signal="Project"
            />
            <ToolHandoffLink
              body="Compare candidate parts after the scratch math says a rating, tolerance, or package might be tight."
              href="/compare"
              label="Compare parts"
              signal="Compare"
            />
          </div>
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="tools-boundaries-heading">
        <SectionHeading
          id="tools-boundaries-heading"
          index="03"
          subtitle="The route is intentionally useful without becoming another hidden approval path."
          title="Trust boundaries"
        />
        <div className="projects-truth-rail projects-truth-rail--compact tools-boundary-grid">
          <div>
            <span>Local math</span>
            <strong>Inputs are typed by the operator.</strong>
            <p>Nothing here is read from or written to project memory until an engineer attaches the copied note somewhere else.</p>
          </div>
          <div>
            <span>Review context</span>
            <strong>Results are evidence candidates.</strong>
            <p>A copied note can support review, but it does not approve a part, validate CAD, or make an export bundle available.</p>
          </div>
          <div>
            <span>Design reality</span>
            <strong>Datasheet and layout still win.</strong>
            <p>Use these checks to catch obvious pressure points, then confirm package limits, tolerance, leakage, capacitance, and measured behavior.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * Renders one compact hero stat tile using the existing project stat visual language.
 */
function ToolHeroStat({ label, tone, value }: { label: string; tone: "neutral" | "info" | "review"; value: string }) {
  return (
    <div className={`projects-stat projects-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Renders one handoff action into an existing memory workspace.
 */
function ToolHandoffLink({ body, href, label, signal }: { body: string; href: string; label: string; signal: string }) {
  return (
    <Link className="workspace-action-card tools-handoff-card" href={href}>
      <span className="workspace-action-card__signal">{signal}</span>
      <strong>{label}</strong>
      <p>{body}</p>
    </Link>
  );
}
