/**
 * File header: Server component that surfaces backend health for the search page so the user
 * sees a clear warning when the worker daemon is offline, the API is unreachable, or the
 * database is missing. Each state lists the exact env var or command that fixes it.
 */

import type { SystemHealthResponse } from "@ee-library/shared";
import React from "react";

/** WorkerStatusBannerProps accepts the health payload (or null when fetch failed). */
export interface WorkerStatusBannerProps {
  /** Resolved system health payload, or null when the API fetch failed. */
  health: SystemHealthResponse | null;
  /** API base URL the web server tried to reach. */
  apiBaseUrl: string;
  /** True when the runtime is local development; controls how verbose the copy is. */
  isLocalDev: boolean;
  /** The DATABASE_URL value visible to the web process (for diagnostic copy only). */
  databaseUrlConfigured: boolean;
}

/**
 * Renders a banner explaining the system state. Returns null when everything is healthy.
 */
export function WorkerStatusBanner({ apiBaseUrl, databaseUrlConfigured, health, isLocalDev }: WorkerStatusBannerProps) {
  if (!health) {
    return (
      <div className="status-banner status-banner--danger" data-testid="banner-api-unreachable" role="status">
        <strong>API unreachable at {apiBaseUrl}.</strong>
        {isLocalDev ? (
          <ul className="status-banner__list">
            <li>If you have not bootstrapped: <code>npm run setup:dev</code></li>
            <li>Then start the stack: <code>npm run dev</code></li>
            <li>Verify it works: <code>npm run smoke:local</code></li>
            <li>If the API process is supposed to be running, check that EE_LIBRARY_API_BASE_URL points at <code>{apiBaseUrl}</code> in your .env.</li>
          </ul>
        ) : (
          <span>Check the API service and the EE_LIBRARY_API_BASE_URL value.</span>
        )}
      </div>
    );
  }

  if (health.database.status === "unavailable") {
    return (
      <div className="status-banner status-banner--danger" data-testid="banner-database-unavailable" role="status">
        <strong>Database unavailable.</strong>
        {isLocalDev ? (
          <ul className="status-banner__list">
            <li>Start Postgres: <code>npm run setup:dev</code> (this also runs Docker).</li>
            <li>Confirm it accepts connections: <code>npm run db:status</code></li>
            <li>If you bypass Docker, check that DATABASE_URL points at a reachable Postgres.</li>
          </ul>
        ) : (
          <span>Check that DATABASE_URL is reachable.</span>
        )}
      </div>
    );
  }

  if (health.database.status === "not_configured") {
    return (
      <div className="status-banner status-banner--danger" data-testid="banner-database-not-configured" role="status">
        <strong>DATABASE_URL is not set on the API process.</strong>
        {isLocalDev ? (
          <ul className="status-banner__list">
            <li>Run <code>npm run setup:dev</code> to write .env, OR</li>
            <li>Restart the dev stack via <code>npm run dev</code> so .env is reloaded ({databaseUrlConfigured ? "the web process can see DATABASE_URL but the API process cannot - restart the API" : "neither web nor API can see DATABASE_URL"}).</li>
            <li>Search is currently using the seed-fallback dataset only.</li>
          </ul>
        ) : (
          <span>Set DATABASE_URL on the API service and restart it.</span>
        )}
      </div>
    );
  }

  const queueSummary = summarizeQueues(health);

  if (health.worker.status === "offline") {
    return (
      <div className="status-banner status-banner--warning" data-testid="banner-worker-offline" role="status">
        <strong>Worker daemon is offline.</strong>
        <span>
          Direct MPN imports still work. Bulk acquisition and queued enrichment will not run until you start{" "}
          <code>npm run dev:worker</code>
          {health.worker.lastSeenAt ? ` (last heartbeat ${formatRelative(health.worker.lastSeenAt)})` : " (no heartbeat ever recorded)"}.
          {queueSummary.totalPending > 0 ? ` ${formatQueueSummary(queueSummary)} waiting for a worker.` : ""}
        </span>
      </div>
    );
  }

  if (queueSummary.totalFailed > 0) {
    return (
      <div className="status-banner status-banner--warning" data-testid="banner-queue-failures" role="status">
        <strong>Queued background work has failures.</strong>
        <span>
          {formatQueueSummary(queueSummary)} Check <code>npm run operations:worker</code> or the admin queue before trusting async results.
        </span>
      </div>
    );
  }

  if (queueSummary.totalPending > 0) {
    return (
      <div className="status-banner status-banner--warning" data-testid="banner-queue-pending" role="status">
        <strong>Queued provider work is active.</strong>
        <span>
          {formatQueueSummary(queueSummary)} The worker is online, so queued acquisition and enrichment should continue moving.
        </span>
      </div>
    );
  }

  return null;
}

/** QueueSummary is a compact view of async provider work from /system/health. */
interface QueueSummary {
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
  /** All pending or running jobs. */
  totalPending: number;
  /** All failed jobs. */
  totalFailed: number;
}

/**
 * Collapses acquisition and enrichment counts into totals plus per-queue fields.
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
    exportAssemblyFailed,
    exportAssemblyPending,
    enrichmentFailed,
    enrichmentPending,
    totalFailed: acquisitionFailed + enrichmentFailed + exportAssemblyFailed,
    totalPending: acquisitionPending + enrichmentPending + exportAssemblyPending
  };
}

/**
 * Formats queue counts for the status banner without hiding which queue needs attention.
 */
function formatQueueSummary(summary: QueueSummary): string {
  return `Acquisition: ${summary.acquisitionPending} pending, ${summary.acquisitionFailed} failed. Enrichment: ${summary.enrichmentPending} pending, ${summary.enrichmentFailed} failed. Export assembly: ${summary.exportAssemblyPending} pending, ${summary.exportAssemblyFailed} failed.`;
}

/**
 * Formats an ISO timestamp as a short relative string for the banner copy.
 */
function formatRelative(isoTimestamp: string): string {
  const elapsedMs = Date.now() - new Date(isoTimestamp).getTime();
  if (Number.isNaN(elapsedMs) || elapsedMs < 0) {
    return "moments ago";
  }
  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
