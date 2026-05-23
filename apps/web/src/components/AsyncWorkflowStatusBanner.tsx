/**
 * File header: Renders a compact workflow warning when background worker state affects
 * operator actions on catalog and compare pages.
 */

import Link from "next/link";
import React from "react";
import { StatusBadge } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";
import type { SystemHealthResponse, WorkerLivenessStatus } from "@ee-library/shared";

/** AsyncWorkflowContext identifies which workspace needs worker-impact copy. */
type AsyncWorkflowContext = "catalog" | "compare";

/** AsyncWorkflowStatusBannerProps carries the canonical health payload and page context. */
type AsyncWorkflowStatusBannerProps = {
  /** Page using the banner so the body copy can stay specific to the workflow. */
  context: AsyncWorkflowContext;
  /** System health payload, or null when health cannot be read without blocking the page. */
  health: SystemHealthResponse | null;
};

/** QueueSummary is a small operator-facing rollup of background queues. */
type QueueSummary = {
  /** Pending or running acquisition jobs. */
  acquisitionPending: number;
  /** Failed acquisition jobs. */
  acquisitionFailed: number;
  /** Pending or running enrichment jobs. */
  enrichmentPending: number;
  /** Failed enrichment jobs. */
  enrichmentFailed: number;
  /** Pending export bundle assembly rows. */
  exportAssemblyPending: number;
  /** Failed export bundle assembly rows. */
  exportAssemblyFailed: number;
  /** All pending or running work that health reports. */
  totalPending: number;
  /** All failed work that health reports. */
  totalFailed: number;
};

/**
 * Renders a scoped warning only when worker or queue state changes what the operator can expect.
 */
export function AsyncWorkflowStatusBanner({ context, health }: AsyncWorkflowStatusBannerProps) {
  if (!isUsableSystemHealth(health) || health.database.status !== "connected") {
    return null;
  }

  const queueSummary = summarizeQueues(health);
  const shouldShow =
    health.worker.status !== "online" || queueSummary.totalPending > 0 || queueSummary.totalFailed > 0;

  if (!shouldShow) {
    return null;
  }

  const tone = getBannerTone(health.worker.status, queueSummary);
  const copy = buildBannerCopy(context, health.worker.status, queueSummary);

  return (
    <aside className={`async-workflow-banner async-workflow-banner--${tone}`} role="status">
      <div className="async-workflow-banner__copy">
        <span>Background work</span>
        <strong>{copy.title}</strong>
        <p>{copy.body}</p>
        <p className="muted-copy">{formatQueueSummary(queueSummary)}</p>
      </div>
      <div className="async-workflow-banner__actions">
        <StatusBadge label={formatWorkerLabel(health.worker.status)} tone={toneForWorker(health.worker.status, queueSummary)} />
        <Link className="button-link button-link--quiet" href="/system">Open System</Link>
        {queueSummary.totalFailed > 0 ? (
          <Link className="button-link button-link--quiet" href="/admin">Review queues</Link>
        ) : null}
      </div>
    </aside>
  );
}

/**
 * Confirms the health payload has the canonical fields before reading nested worker data.
 */
function isUsableSystemHealth(health: SystemHealthResponse | null): health is SystemHealthResponse {
  return Boolean(
    health?.database &&
      health.worker &&
      health.queues?.acquisition &&
      health.queues.enrichment &&
      health.queues.exportBundleAssembly
  );
}

/**
 * Collapses health queue counts into one summary for inline workflow banners.
 */
function summarizeQueues(health: SystemHealthResponse): QueueSummary {
  const acquisitionPending = health.queues.acquisition.pending;
  const acquisitionFailed = health.queues.acquisition.failed;
  const enrichmentPending = health.queues.enrichment.pending;
  const enrichmentFailed = health.queues.enrichment.failed;
  const exportAssemblyPending = health.queues.exportBundleAssembly.pending;
  const exportAssemblyFailed = health.queues.exportBundleAssembly.failed;

  return {
    acquisitionFailed,
    acquisitionPending,
    enrichmentFailed,
    enrichmentPending,
    exportAssemblyFailed,
    exportAssemblyPending,
    totalFailed: acquisitionFailed + enrichmentFailed + exportAssemblyFailed,
    totalPending: acquisitionPending + enrichmentPending + exportAssemblyPending
  };
}

/**
 * Chooses banner tone from worker and queue state without treating pending work as failure.
 */
function getBannerTone(workerStatus: WorkerLivenessStatus, summary: QueueSummary): BadgeTone {
  if (summary.totalFailed > 0) {
    return "danger";
  }

  if (workerStatus === "online") {
    return "review";
  }

  return "review";
}

/**
 * Builds page-specific impact copy for catalog and compare workflows.
 */
function buildBannerCopy(context: AsyncWorkflowContext, workerStatus: WorkerLivenessStatus, summary: QueueSummary): { body: string; title: string } {
  if (summary.totalFailed > 0) {
    return {
      body:
        context === "catalog"
          ? "Catalog search still works, but failed background jobs need review before imported or enriched results should be trusted."
          : "Compare still reads existing records, but failed background jobs may leave previews or export assembly stale until reviewed.",
      title: "Background queues need review"
    };
  }

  if (workerStatus !== "online") {
    return {
      body:
        context === "catalog"
          ? "Search and existing records still work. Supplier acquisition, enrichment, generated previews, validation checks, and export assembly will not advance until the worker is running."
          : "Side-by-side comparison still works for saved records. Generated previews, validation checks, and export bundle assembly will not advance until the worker is running.",
      title: "Worker is not running"
    };
  }

  return {
    body:
      context === "catalog"
        ? "Search is live while background acquisition, enrichment, or export assembly continues."
        : "Compare is live while background preview, validation, or export assembly work continues.",
    title: "Background work is moving"
  };
}

/**
 * Formats worker liveness for the visible badge.
 */
function formatWorkerLabel(status: WorkerLivenessStatus): string {
  if (status === "online") {
    return "Worker online";
  }

  if (status === "offline") {
    return "Worker offline";
  }

  return "Worker unknown";
}

/**
 * Maps worker and queue state into badge tones without overstating pending progress.
 */
function toneForWorker(status: WorkerLivenessStatus, summary: QueueSummary): BadgeTone {
  if (summary.totalFailed > 0) {
    return "danger";
  }

  if (status === "online") {
    return "verified";
  }

  return "review";
}

/**
 * Formats queue counts so operators can see which background lane is affected.
 */
function formatQueueSummary(summary: QueueSummary): string {
  return `Acquisition ${summary.acquisitionPending}/${summary.acquisitionFailed}, enrichment ${summary.enrichmentPending}/${summary.enrichmentFailed}, export assembly ${summary.exportAssemblyPending}/${summary.exportAssemblyFailed} pending/failed.`;
}
