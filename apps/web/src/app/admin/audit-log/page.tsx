/**
 * File header: Renders the admin audit-log timeline so operators and security reviewers
 * can answer "who did what and when" without leaving the app.
 */

import Link from "next/link";
import React from "react";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { fetchAuditEventsEnvelope, isApiClientError } from "../../../lib/api-client";
import type { AuditEventListResponse, AuditEventListing } from "../../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";

export const dynamic = "force-dynamic";

/** AuditLogPageSearchParams mirrors the GET query that drives the timeline view. */
type AuditLogPageSearchParams = {
  actorEmail?: string | string[];
  action?: string | string[];
  entityType?: string | string[];
  resultStatus?: string | string[];
  page?: string | string[];
};

/** AuditLogPageState separates ready reads from setup failures for clean rendering. */
type AuditLogPageState =
  | { response: AuditEventListResponse; status: "ready" }
  | { code: string; message: string; status: "setup_required" };

/** AuditLogPageProps carries Next.js search params as an awaited value. */
interface AuditLogPageProps {
  searchParams: Promise<AuditLogPageSearchParams>;
}

/**
 * Renders the audit-log timeline with filters and pagination.
 */
export default async function AuditLogPage({ searchParams }: AuditLogPageProps) {
  const resolved = await searchParams;
  const actorEmail = readSingleParam(resolved.actorEmail);
  const action = readSingleParam(resolved.action);
  const entityType = readSingleParam(resolved.entityType);
  const resultStatus = readResultStatus(readSingleParam(resolved.resultStatus));
  const page = readPositiveInteger(readSingleParam(resolved.page));

  const pageState = await loadAuditLogPage({
    actorEmail,
    action,
    entityType,
    resultStatus,
    page
  });

  if (pageState.status === "setup_required") {
    const headline =
      pageState.code === "DB_NOT_CONFIGURED"
        ? "The catalog database is not connected yet."
        : "The audit log could not be read.";
    const body =
      pageState.code === "DB_NOT_CONFIGURED"
        ? "An administrator needs to bring it online. The audit log returns once the database is reachable."
        : "Try again in a moment, or check the System page.";
    return (
      <main className="admin-layout">
        <section className="admin-hero">
          <div>
            <p className="app-kicker">Admin workspace</p>
            <h1>Audit log</h1>
            <p className="admin-hero__lede">{body}</p>
          </div>
        </section>
        <SectionPanel title="Audit log unavailable" description={headline}>
          <EmptyState title={headline} body={`${body} (${pageState.code}: ${pageState.message})`} />
        </SectionPanel>
      </main>
    );
  }

  const { response } = pageState;
  const { events, totalRecords, totalPages } = response;
  const filtersActive = Boolean(actorEmail || action || entityType || resultStatus);

  return (
    <main className="admin-layout">
      <section className="admin-hero">
        <div>
          <p className="app-kicker">Admin workspace</p>
          <h1>Audit log</h1>
          <p className="admin-hero__lede">
            Every recorded mutation, newest first. Use this for security review, change history, and answering "who did what and when".
          </p>
        </div>
      </section>

      <section className="detail-section" aria-labelledby="audit-log-filters-heading">
        <SectionHeading
          id="audit-log-filters-heading"
          index="01"
          subtitle="Narrow the timeline by actor, action, entity type, or result."
          title="Filters"
        />
        <SectionPanel
          description="Filters are server-side. Each filter narrows what is recorded — clearing returns the full timeline."
          title="Refine the timeline"
        >
          <form action="/admin/audit-log" className="audit-log-filters" method="get">
            <label className="audit-log-filters__field">
              <span>Actor email contains</span>
              <input defaultValue={actorEmail} name="actorEmail" placeholder="alice@example.com" type="search" />
            </label>
            <label className="audit-log-filters__field">
              <span>Action</span>
              <input defaultValue={action} name="action" placeholder="project.create" type="search" />
            </label>
            <label className="audit-log-filters__field">
              <span>Entity type</span>
              <input defaultValue={entityType} name="entityType" placeholder="project, asset, review_record" type="search" />
            </label>
            <label className="audit-log-filters__field">
              <span>Result</span>
              <select defaultValue={resultStatus ?? ""} name="resultStatus">
                <option value="">Any result</option>
                <option value="success">Success</option>
                <option value="denied">Denied</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <div className="audit-log-filters__actions">
              <button type="submit">Apply filters</button>
              {filtersActive ? (
                <Link className="button-link button-link--quiet" href="/admin/audit-log">
                  Clear
                </Link>
              ) : null}
            </div>
          </form>
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="audit-log-results-heading">
        <SectionHeading
          id="audit-log-results-heading"
          index="02"
          subtitle={`${totalRecords} event${totalRecords === 1 ? "" : "s"} on ${totalPages} page${totalPages === 1 ? "" : "s"}.`}
          title="Timeline"
        />
        <SectionPanel
          description="Each row shows when, who, what, and the result. Expand for the recorded payload."
          title={totalRecords > 0 ? `${events.length} events on this page` : "No events"}
        >
          {events.length > 0 ? (
            <AuditEventTimeline events={events} />
          ) : (
            <EmptyState
              title="No audit events match"
              body={filtersActive ? "Clear or change the filters above to see more events." : "No mutations have been recorded yet."}
            />
          )}
          <AuditLogPagination
            actorEmail={actorEmail}
            action={action}
            entityType={entityType}
            resultStatus={resultStatus}
            page={response.page}
            totalPages={totalPages}
          />
        </SectionPanel>
      </section>
    </main>
  );
}

/**
 * Renders one row per audit event with an expandable payload disclosure.
 */
function AuditEventTimeline({ events }: { events: AuditEventListing[] }) {
  return (
    <div className="audit-log-table-wrap">
      <table className="audit-log-table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Entity</th>
            <th scope="col">Result</th>
            <th scope="col">Payload</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>
                <span className="ui-mono">{formatDateTime(event.occurredAt)}</span>
              </td>
              <td>
                <div>{event.actorEmail ?? "system"}</div>
                {event.actorRole ? <small className="muted-copy">{event.actorRole}</small> : null}
              </td>
              <td className="ui-mono">{event.action}</td>
              <td>
                <div className="ui-mono">{event.entityType}</div>
                <small className="muted-copy">{event.entityId}</small>
              </td>
              <td>
                <StatusBadge label={event.resultStatus} tone={resultTone(event.resultStatus)} />
              </td>
              <td>
                {hasPayload(event) ? (
                  <details className="audit-log-payload">
                    <summary>Show payload</summary>
                    <pre className="audit-log-payload__pre">{JSON.stringify({ before: event.beforeState, after: event.afterState }, null, 2)}</pre>
                  </details>
                ) : (
                  <span className="muted-copy">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders prev/next pagination preserving the active filter set.
 */
function AuditLogPagination({
  actorEmail,
  action,
  entityType,
  resultStatus,
  page,
  totalPages
}: {
  actorEmail: string;
  action: string;
  entityType: string;
  resultStatus: AuditEventListing["resultStatus"] | undefined;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  return (
    <nav aria-label="Audit log pagination" className="audit-log-pagination">
      {page > 1 ? (
        <Link className="button-link button-link--quiet" href={buildHref({ actorEmail, action, entityType, resultStatus, page: prevPage })}>
          &larr; Previous
        </Link>
      ) : (
        <span className="muted-copy">Previous</span>
      )}
      <strong>
        Page {page} of {totalPages}
      </strong>
      {page < totalPages ? (
        <Link className="button-link button-link--quiet" href={buildHref({ actorEmail, action, entityType, resultStatus, page: nextPage })}>
          Next &rarr;
        </Link>
      ) : (
        <span className="muted-copy">Next</span>
      )}
    </nav>
  );
}

/**
 * Loads the audit-log timeline while preserving setup failures for clean rendering.
 */
async function loadAuditLogPage(filters: { actorEmail: string; action: string; entityType: string; resultStatus: AuditEventListing["resultStatus"] | undefined; page: number }): Promise<AuditLogPageState> {
  try {
    const envelope = await fetchAuditEventsEnvelope({
      ...(filters.actorEmail ? { actorEmail: filters.actorEmail } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.resultStatus ? { resultStatus: filters.resultStatus } : {}),
      page: filters.page,
      pageSize: 50
    });

    return { response: envelope.data, status: "ready" };
  } catch (error) {
    if (isApiClientError(error)) {
      return { code: error.code, message: error.message, status: "setup_required" };
    }

    return {
      code: "API_UNAVAILABLE",
      message: "The audit log could not be read.",
      status: "setup_required"
    };
  }
}

/**
 * Maps result_status into a UI badge tone.
 */
function resultTone(status: AuditEventListing["resultStatus"]): BadgeTone {
  switch (status) {
    case "success":
      return "verified";
    case "denied":
      return "review";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Returns true when an event has any recorded before/after payload to show.
 */
function hasPayload(event: AuditEventListing): boolean {
  return event.beforeState !== null && event.beforeState !== undefined
    ? true
    : event.afterState !== null && event.afterState !== undefined;
}

/**
 * Reads the first value from a Next.js search-param entry that may be string or array.
 */
function readSingleParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Narrows a result-status query value into the allowed union or null.
 */
function readResultStatus(value: string): AuditEventListing["resultStatus"] | undefined {
  if (value === "success" || value === "denied" || value === "failed") return value;
  return undefined;
}

/**
 * Reads a positive integer page param, defaulting to 1 when missing or invalid.
 */
function readPositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Builds an href that preserves the active filter set across pagination clicks.
 */
function buildHref({
  actorEmail,
  action,
  entityType,
  resultStatus,
  page
}: {
  actorEmail: string;
  action: string;
  entityType: string;
  resultStatus: AuditEventListing["resultStatus"] | undefined;
  page: number;
}): string {
  const params = new URLSearchParams();
  if (actorEmail) params.set("actorEmail", actorEmail);
  if (action) params.set("action", action);
  if (entityType) params.set("entityType", entityType);
  if (resultStatus) params.set("resultStatus", resultStatus);
  if (page > 1) params.set("page", page.toString());

  return params.toString() ? `/admin/audit-log?${params.toString()}` : "/admin/audit-log";
}

/**
 * Formats an ISO timestamp into a compact human-readable display.
 */
function formatDateTime(value: string): string {
  if (!value) return "Unknown";
  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    }).format(date);
  } catch {
    return value;
  }
}
