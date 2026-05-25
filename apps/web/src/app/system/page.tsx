/**
 * File header: Renders the operator-facing system health workspace for API, database,
 * storage, worker, and queued background-job visibility.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { WorkerStatusBanner } from "../../components/WorkerStatusBanner";
import { fetchSystemHealth, getApiBaseUrl } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { ServiceConnectionStatus, SystemHealthResponse, WorkerLivenessStatus } from "@ee-library/shared";

export const dynamic = "force-dynamic";

/**
 * Renders the system health page so operators can intentionally inspect backend readiness.
 */
export default async function SystemPage() {
  const health = await fetchSystemHealth();
  const apiBaseUrl = getApiBaseUrl();
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const isLocalDev = process.env.NODE_ENV !== "production";

  return (
    <main className="page-layout">
      <section className="page-hero">
        <div className="page-hero__layout">
          <div className="page-hero__copy">
            <p className="app-kicker">System</p>
            <h1>Is everything running?</h1>
            <p className="page-hero__lede">
              See what is online and what is offline. Open this when something will not load or an action keeps failing.
            </p>
            <div className="page-hero__status">
              <StatusBadge label={health ? "API ok" : "API health unavailable"} tone={health ? "verified" : "danger"} />
              <StatusBadge label={`Database ${health ? formatConnectionLabel(health.database.status) : "unknown"}`} tone={health ? toneForConnection(health.database.status) : "review"} />
              <StatusBadge label={`Worker ${health ? formatWorkerLabel(health.worker.status) : "unknown"}`} tone={health ? toneForWorker(health.worker.status) : "review"} />
            </div>
          </div>
          <SystemHealthSnapshot health={health} />
        </div>
      </section>

      <WorkerStatusBanner apiBaseUrl={apiBaseUrl} databaseUrlConfigured={databaseUrlConfigured} health={health} isLocalDev={isLocalDev} />

      <section className="detail-section" aria-labelledby="system-current-heading">
        <SectionHeading id="system-current-heading" subtitle="Live service status." title="Current status" />
        <SectionPanel description="These states show what is reachable. They do not change part approval, evidence review, or export readiness." title="Service readiness">
          {health ? <SystemHealthOverview health={health} /> : <SystemUnavailableState apiBaseUrl={apiBaseUrl} />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="system-queues-heading">
        <SectionHeading id="system-queues-heading" subtitle="Pending and failed background work." title="Background work" />
        <SectionPanel description="Pending work can still be moving when the worker is online. Failed work needs a look before its results are trusted." title="Queue status">
          {health ? <SystemQueueTable health={health} /> : <SystemUnavailableState apiBaseUrl={apiBaseUrl} />}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="system-recovery-heading">
        <SectionHeading id="system-recovery-heading" subtitle="What to do when something is offline." title="What to check next" />
        <SectionPanel description="Use these when a page says it is paused, the API is down, or background work has failed." title="Recovery paths">
          <SystemRecoveryPanel apiBaseUrl={apiBaseUrl} health={health} />
        </SectionPanel>
      </section>
    </main>
  );
}

/**
 * Renders compact status counts in the hero without making unavailable services look healthy.
 */
function SystemHealthSnapshot({ health }: { health: SystemHealthResponse | null }) {
  if (!health) {
    return (
      <div className="projects-stat-grid">
        <SystemStat label="API" tone="danger" value="Down" />
        <SystemStat label="Database" tone="review" value="Unknown" />
        <SystemStat label="Worker" tone="review" value="Unknown" />
        <SystemStat label="Queues" tone="review" value="Unknown" />
      </div>
    );
  }

  const queueTotals = summarizeQueues(health);

  return (
    <div className="projects-stat-grid">
      <SystemStat label="API" tone="verified" value="OK" />
      <SystemStat label="Database" tone={toneForConnection(health.database.status)} value={formatConnectionLabel(health.database.status)} />
      <SystemStat label="Worker" tone={toneForWorker(health.worker.status)} value={formatWorkerLabel(health.worker.status)} />
      <SystemStat label="Queues" tone={queueTotals.failed > 0 ? "danger" : queueTotals.pending > 0 ? "review" : "verified"} value={`${queueTotals.pending}/${queueTotals.failed}`} />
    </div>
  );
}

/**
 * Renders one compact system stat tile using the existing project dashboard visual language.
 */
function SystemStat({ label, tone, value }: { label: string; tone: BadgeTone; value: string }) {
  return (
    <div className={`projects-stat projects-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Renders service cards with direct, source-backed state labels.
 */
function SystemHealthOverview({ health }: { health: SystemHealthResponse }) {
  return (
    <div className="system-health-grid">
      <SystemHealthCard detail="The web app reached the system-health endpoint." label="API" tone="verified" value="OK" />
      <SystemHealthCard detail="Catalog, project memory, evidence, where-used, and export records require this connection." label="Database" tone={toneForConnection(health.database.status)} value={formatConnectionLabel(health.database.status)} />
      <SystemHealthCard detail="File-backed evidence, generated assets, and export bundles depend on configured storage." label="Object storage" tone={toneForConnection(health.objectStorage.status)} value={formatConnectionLabel(health.objectStorage.status)} />
      <SystemHealthCard detail={formatWorkerDetail(health.worker)} label="Worker" tone={toneForWorker(health.worker.status)} value={formatWorkerLabel(health.worker.status)} />
    </div>
  );
}

/**
 * Renders one service state card.
 */
function SystemHealthCard({ detail, label, tone, value }: { detail: string; label: string; tone: BadgeTone; value: string }) {
  return (
    <article className={`system-health-card system-health-card--${tone}`}>
      <div className="system-health-card__header">
        <span>{label}</span>
        <StatusBadge label={value} tone={tone} />
      </div>
      <p>{detail}</p>
    </article>
  );
}

/**
 * Renders an unavailable API state without pretending the underlying services are empty.
 */
function SystemUnavailableState({ apiBaseUrl }: { apiBaseUrl: string }) {
  return (
    <div className="empty-recovery-state">
      <EmptyState
        title="API health unavailable"
        body={`The web app could not read ${apiBaseUrl}/system/health. System state is unknown until the API responds.`}
      />
      <div className="empty-recovery-actions" aria-label="System unavailable recovery actions">
        <a className="button-link" href={`${apiBaseUrl}/system/health`}>Open health endpoint</a>
        <Link className="button-link button-link--quiet" href="/catalog">Return to Catalog</Link>
      </div>
    </div>
  );
}

/**
 * Renders acquisition and enrichment queue counts from the health contract.
 */
function SystemQueueTable({ health }: { health: SystemHealthResponse }) {
  const rows = [
    {
      description: "Provider acquisition jobs that collect source records and catalog candidates.",
      failed: health.queues.acquisition.failed,
      pending: health.queues.acquisition.pending,
      queue: "Acquisition"
    },
    {
      description: "Queued enrichment work that may add normalized fields, metadata, or generated drafts.",
      failed: health.queues.enrichment.failed,
      pending: health.queues.enrichment.pending,
      queue: "Enrichment"
    },
    {
      description: "Pending export bundles waiting for the worker daemon to copy verified asset bytes; failed rows expose `assembly_error` JSONB for diagnostic detail.",
      failed: health.queues.exportBundleAssembly.failed,
      pending: health.queues.exportBundleAssembly.pending,
      queue: "Export bundle assembly"
    }
  ];

  return (
    <div className="admin-table-wrap">
      <table className="admin-table system-queue-table">
        <thead>
          <tr>
            <th scope="col">Queue</th>
            <th scope="col">Pending or running</th>
            <th scope="col">Failed</th>
            <th scope="col">State</th>
            <th scope="col">What it means</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.queue}>
              <th scope="row">{row.queue}</th>
              <td className="ui-mono">{row.pending}</td>
              <td className="ui-mono">{row.failed}</td>
              <td>
                <StatusBadge label={formatQueueState(row.pending, row.failed)} tone={toneForQueue(row.pending, row.failed)} />
              </td>
              <td>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders practical recovery cards for setup and async-job problems.
 */
function SystemRecoveryPanel({ apiBaseUrl, health }: { apiBaseUrl: string; health: SystemHealthResponse | null }) {
  const queueTotals = health ? summarizeQueues(health) : { failed: 0, pending: 0 };

  return (
    <div className="system-recovery-grid">
      <SystemRecoveryCard
        actionHref={`${apiBaseUrl}/system/health`}
        actionLabel="Open health endpoint"
        detail={health ? "The API is reachable. If a workspace still fails, use its setup message and check database or storage state below." : "Check whether the API service is running and whether the web app points to the correct API address."}
        label="API"
        tone={health ? "verified" : "danger"}
        title={health ? "API is responding" : "API cannot be reached"}
      />
      <SystemRecoveryCard
        actionHref="/catalog"
        actionLabel="Open Catalog"
        detail={health?.database.status === "connected" ? "Catalog-backed workspaces can read persisted records." : "Catalog, project memory, evidence, where-used, and export workflows need the database before records can be trusted."}
        label="Database"
        tone={health ? toneForConnection(health.database.status) : "review"}
        title={health ? `Database ${formatConnectionLabel(health.database.status)}` : "Database state unknown"}
      />
      <SystemRecoveryCard
        actionHref="/admin"
        actionLabel="Open Admin queues"
        detail={buildWorkerRecoveryDetail(health, queueTotals)}
        label="Worker"
        tone={health ? toneForWorker(health.worker.status) : "review"}
        title={health ? `Worker ${formatWorkerLabel(health.worker.status)}` : "Worker state unknown"}
      />
      <SystemRecoveryCard
        actionHref="/admin"
        actionLabel="Review failed work"
        detail={queueTotals.failed > 0 ? "Failed queued work needs an operator review before async provider output should be trusted." : "No failed background work is reported by system health right now."}
        label="Queues"
        tone={queueTotals.failed > 0 ? "danger" : queueTotals.pending > 0 ? "review" : "verified"}
        title={queueTotals.pending > 0 || queueTotals.failed > 0 ? `${queueTotals.pending} pending, ${queueTotals.failed} failed` : "Queues clear"}
      />
    </div>
  );
}

/**
 * Renders one recovery card with an optional route or endpoint action.
 */
function SystemRecoveryCard({
  actionHref,
  actionLabel,
  detail,
  label,
  title,
  tone
}: {
  actionHref: string;
  actionLabel: string;
  detail: string;
  label: string;
  title: string;
  tone: BadgeTone;
}) {
  return (
    <article className={`system-recovery-card system-recovery-card--${tone}`}>
      <span>{label}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      <a className="button-link button-link--quiet" href={actionHref}>{actionLabel}</a>
    </article>
  );
}

/**
 * Summarizes queue counts for hero and recovery surfaces.
 */
function summarizeQueues(health: SystemHealthResponse): { failed: number; pending: number } {
  return {
    failed: health.queues.acquisition.failed + health.queues.enrichment.failed + health.queues.exportBundleAssembly.failed,
    pending: health.queues.acquisition.pending + health.queues.enrichment.pending + health.queues.exportBundleAssembly.pending
  };
}

/**
 * Builds worker recovery copy without overstating queued job progress.
 */
function buildWorkerRecoveryDetail(health: SystemHealthResponse | null, queueTotals: { failed: number; pending: number }): string {
  if (!health) {
    return "Worker state is unknown because the API health endpoint is unavailable.";
  }

  if (health.worker.status === "online") {
    return queueTotals.pending > 0 ? "The worker is online, so pending background work should continue moving." : "The worker is online and no pending queue work is reported.";
  }

  if (health.worker.status === "offline") {
    return queueTotals.pending > 0 ? "Queued work is waiting for the worker before acquisition or enrichment can continue." : "Start or restart the worker before relying on new async provider jobs.";
  }

  return "No worker heartbeat has been confirmed yet, so async provider job progress is uncertain.";
}

/**
 * Formats object and database connection states for non-technical operators.
 */
function formatConnectionLabel(status: ServiceConnectionStatus): string {
  if (status === "not_configured") {
    return "Not configured";
  }

  if (status === "unavailable") {
    return "Unavailable";
  }

  return "Connected";
}

/**
 * Maps service connection states into visual tones.
 */
function toneForConnection(status: ServiceConnectionStatus): BadgeTone {
  if (status === "connected") {
    return "verified";
  }

  if (status === "unavailable") {
    return "danger";
  }

  return "review";
}

/**
 * Formats worker liveness states for status badges.
 */
function formatWorkerLabel(status: WorkerLivenessStatus): string {
  if (status === "online") {
    return "Online";
  }

  if (status === "offline") {
    return "Offline";
  }

  return "Unknown";
}

/**
 * Maps worker liveness into visual tones without implying queue success.
 */
function toneForWorker(status: WorkerLivenessStatus): BadgeTone {
  if (status === "online") {
    return "verified";
  }

  if (status === "offline") {
    return "danger";
  }

  return "review";
}

/**
 * Formats worker heartbeat detail with a readable absolute timestamp.
 */
function formatWorkerDetail(worker: SystemHealthResponse["worker"]): string {
  if (!worker.lastSeenAt) {
    return `No worker heartbeat has been recorded. The worker is considered stale after ${worker.staleAfterSeconds} seconds.`;
  }

  const seenAt = new Date(worker.lastSeenAt);
  const seenLabel = Number.isNaN(seenAt.getTime()) ? worker.lastSeenAt : seenAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });

  return `Last heartbeat: ${seenLabel}. The worker is considered stale after ${worker.staleAfterSeconds} seconds.`;
}

/**
 * Formats a queue state label from pending and failed counts.
 */
function formatQueueState(pending: number, failed: number): string {
  if (failed > 0) {
    return "Needs review";
  }

  if (pending > 0) {
    return "In progress";
  }

  return "Clear";
}

/**
 * Maps queue counts into visual tones.
 */
function toneForQueue(pending: number, failed: number): BadgeTone {
  if (failed > 0) {
    return "danger";
  }

  if (pending > 0) {
    return "review";
  }

  return "verified";
}
