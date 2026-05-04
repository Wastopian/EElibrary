/**
 * File header: Renders the reusable circuit block library from engineering-memory persistence.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { CircuitBlockCreatePanel } from "../../components/CircuitBlockCreatePanel";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { fetchApiHealth, fetchCircuitBlocks, isApiClientError } from "../../lib/api-client";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { CircuitBlockListResponse, CircuitBlockStatus, CircuitBlockSummary, CircuitBlockType } from "@ee-library/shared/types";

export const dynamic = "force-dynamic";

/** CircuitBlocksPageState separates ready library reads from setup failures. */
type CircuitBlocksPageState =
  | {
      health: ApiHealth | null;
      response: CircuitBlockListResponse;
      status: "ready";
    }
  | {
      code: string;
      health: ApiHealth | null;
      message: string;
      status: "setup_required";
    };

/**
 * Renders the circuit block library and creation surface.
 */
export default async function CircuitBlocksPage() {
  const pageState = await loadCircuitBlocksPage();

  if (pageState.status === "setup_required") {
    return <CircuitBlocksSetupState pageState={pageState} />;
  }

  const { health, response } = pageState;

  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Circuit memory</p>
            <h1>Reusable circuit blocks</h1>
            <p className="projects-hero__lede">
              Capture reusable circuit patterns with linked internal parts, constraints, evidence, and current readiness signals. Block approval never overrides part approval or export readiness.
            </p>
            <div className="projects-hero__status">
              <StatusBadge label="DB-backed circuit memory" tone="verified" />
              <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
              <StatusBadge label={`Database ${health?.dependencies.database ?? "unknown"}`} tone={health?.dependencies.database === "connected" ? "verified" : "review"} />
            </div>
          </div>
          <CircuitBlocksSnapshot response={response} />
        </div>
      </section>

      <WorkspaceJumpNav
        ariaLabel="Circuit block sections"
        items={[
          { href: "#circuit-block-list-heading", label: "Blocks" },
          { href: "#circuit-block-create-heading", label: "Create" },
          { href: "#circuit-block-boundaries-heading", label: "Boundaries" }
        ]}
      />

      <section className="detail-section" aria-labelledby="circuit-block-list-heading">
        <SectionHeading
          id="circuit-block-list-heading"
          index="01"
          subtitle="Structured reusable circuits with linked part roles and readiness signals."
          title="Circuit block library"
        />
        <SectionPanel
          description="Only persisted circuit block records appear here. Counts are inputs for review, not an opaque quality score."
          title={response.circuitBlocks.length > 0 ? `${response.circuitBlocks.length} circuit blocks` : "No circuit blocks"}
        >
          {response.circuitBlocks.length > 0 ? <CircuitBlocksTable circuitBlocks={response.circuitBlocks} /> : <CircuitBlocksEmptyState />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-create-heading">
        <SectionHeading
          id="circuit-block-create-heading"
          index="02"
          subtitle="Create a reusable circuit record before adding internal part roles."
          title="Create circuit block"
        />
        <SectionPanel
          description="Creation stores structured design knowledge and constraints. It does not create parts, approve parts, or verify assets."
          title="New circuit block"
        >
          <CircuitBlockCreatePanel />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="circuit-block-boundaries-heading">
        <SectionHeading
          id="circuit-block-boundaries-heading"
          index="03"
          subtitle="Reusable circuit knowledge stays separate from trust and export gates."
          title="Trust boundaries"
        />
        <SectionPanel description="Circuit block status is a design-memory state. Linked parts keep their own approval, lifecycle, readiness, validation, and export state." title="Reuse truth">
          <div className="projects-truth-rail projects-truth-rail--compact">
            <div>
              <span>Block state</span>
              <strong>Reusable knowledge, not export permission.</strong>
              <p>Approved blocks can still contain parts with readiness gaps or missing verified CAD.</p>
            </div>
            <div>
              <span>Part roles</span>
              <strong>Required and optional are distinct.</strong>
              <p>Substitution policy is recorded per role so reuse constraints stay visible.</p>
            </div>
            <div>
              <span>Evidence</span>
              <strong>Provenance stays reviewable.</strong>
              <p>Links and notes support future review without changing validation or approval state.</p>
            </div>
          </div>
        </SectionPanel>
      </section>
    </main>
  );
}

/**
 * Loads the circuit block library while preserving setup failures.
 */
async function loadCircuitBlocksPage(): Promise<CircuitBlocksPageState> {
  const healthPromise = fetchApiHealth();

  try {
    const [health, response] = await Promise.all([healthPromise, fetchCircuitBlocks()]);

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
      message: "The API could not be reached, so circuit block memory cannot be read.",
      status: "setup_required"
    };
  }
}

/**
 * Renders setup guidance for unavailable circuit block persistence.
 */
function CircuitBlocksSetupState({ pageState }: { pageState: Extract<CircuitBlocksPageState, { status: "setup_required" }> }) {
  return (
    <main className="projects-layout">
      <Link className="back-link" href="/projects">
        &larr; Back to projects
      </Link>
      <section className="projects-hero">
        <div className="projects-hero__copy">
          <p className="app-kicker">Circuit memory</p>
          <h1>Connect the engineering-memory database</h1>
          <p className="projects-hero__lede">Circuit block reads require persisted circuit block and linked part-role tables. No seed fallback is used for reusable circuit knowledge.</p>
          <div className="projects-hero__status">
            <StatusBadge label={pageState.code} tone="review" />
            <StatusBadge label={`Database ${pageState.health?.dependencies.database ?? "unknown"}`} tone={pageState.health?.dependencies.database === "connected" ? "verified" : "review"} />
          </div>
          <p className="mode-warning">{pageState.message}</p>
        </div>
      </section>
    </main>
  );
}

/**
 * Renders the circuit block summary strip.
 */
function CircuitBlocksSnapshot({ response }: { response: CircuitBlockListResponse }) {
  const totalParts = response.circuitBlocks.reduce((total, summary) => total + summary.totalPartCount, 0);
  const readinessGaps = response.circuitBlocks.reduce((total, summary) => total + summary.readinessGapCount, 0);
  const evidence = response.circuitBlocks.reduce((total, summary) => total + summary.evidenceAttachmentCount, 0);

  return (
    <div className="projects-hero__snapshot" aria-label="Circuit block summary">
      <CircuitBlockStat label="Blocks" tone="info" value={response.circuitBlocks.length.toString()} />
      <CircuitBlockStat label="Part roles" tone="neutral" value={totalParts.toString()} />
      <CircuitBlockStat label="Readiness gaps" tone={readinessGaps > 0 ? "review" : "verified"} value={readinessGaps.toString()} />
      <CircuitBlockStat label="Evidence" tone="info" value={evidence.toString()} />
    </div>
  );
}

/**
 * Renders one compact circuit block stat tile.
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
 * Renders persisted circuit blocks in a dense table.
 */
function CircuitBlocksTable({ circuitBlocks }: { circuitBlocks: CircuitBlockSummary[] }) {
  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            <th>Block</th>
            <th>Type</th>
            <th>Status</th>
            <th>Parts</th>
            <th>Required</th>
            <th>Gaps</th>
            <th>Evidence</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {circuitBlocks.map((summary) => (
            <tr key={summary.circuitBlock.id}>
              <td>
                <Link href={`/circuit-blocks/${summary.circuitBlock.id}`}>
                  <span className="ui-mono">{summary.circuitBlock.blockKey}</span>
                </Link>
                <div className="projects-table__primary">{summary.circuitBlock.name}</div>
                <div className="muted-copy">{summary.circuitBlock.reuseScope || summary.circuitBlock.description}</div>
              </td>
              <td>{formatCircuitBlockType(summary.circuitBlock.blockType)}</td>
              <td>
                <StatusBadge label={formatCircuitBlockStatus(summary.circuitBlock.status)} tone={circuitBlockStatusTone(summary.circuitBlock.status)} />
              </td>
              <td>{summary.totalPartCount}</td>
              <td>{summary.requiredPartCount}</td>
              <td>{summary.readinessGapCount}</td>
              <td>{summary.evidenceAttachmentCount}</td>
              <td>{formatDateTime(summary.circuitBlock.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders the configured-but-empty circuit block state.
 */
function CircuitBlocksEmptyState() {
  return <EmptyState title="No circuit blocks yet" body="The database is ready, but no reusable circuit blocks are persisted. Create a block, then add internal part roles from the detail page." />;
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
 * Formats timestamps for circuit block tables.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
