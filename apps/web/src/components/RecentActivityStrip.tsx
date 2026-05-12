/**
 * File header: Renders a compact per-entity audit timeline on detail pages.
 *
 * The strip degrades gracefully: when the events array is null (audit store
 * unavailable or the request was unauthorized) it renders nothing rather than
 * blocking the rest of the page. The "View all" link deep-links into the admin
 * audit-events filter for the same target so the timeline always has an escape
 * hatch into the full filtered view.
 */

import Link from "next/link";
import React from "react";
import { StatusBadge } from "@ee-library/ui";
import type { AuditEvent } from "@ee-library/shared/types";
import type { BadgeTone } from "@ee-library/ui";

interface RecentActivityStripProps {
  /** The events to render, newest first. Pass null when the fetch failed so the strip stays hidden. */
  events: AuditEvent[] | null;
  /** Target type used to build the "View all" deep link into the admin audit view. */
  targetType: string;
  /** Target id used to build the "View all" deep link. */
  targetId: string;
  /** Optional title override. Defaults to "Recent activity". */
  title?: string;
}

/**
 * Renders the most recent audit events for one entity as a compact list with a
 * "View all" link that scopes the admin timeline to the same target.
 */
export function RecentActivityStrip({ events, targetType, targetId, title = "Recent activity" }: RecentActivityStripProps) {
  if (!events || events.length === 0) {
    return null;
  }

  const viewAllHref = `/admin?auditTargetType=${encodeURIComponent(targetType)}&auditTargetId=${encodeURIComponent(targetId)}#user-action-audit-heading`;

  return (
    <section aria-label={title} className="recent-activity-strip">
      <header className="recent-activity-strip__header">
        <div>
          <p className="app-kicker">Activity</p>
          <h3>{title}</h3>
        </div>
        <Link className="recent-activity-strip__view-all" href={viewAllHref}>
          View full audit &rarr;
        </Link>
      </header>
      <ul className="recent-activity-strip__list">
        {events.map((event) => (
          <li className="recent-activity-strip__item" key={event.id}>
            <div className="recent-activity-strip__when">
              <span className="ui-mono">{formatRelativeOrAbsolute(event.occurredAt)}</span>
            </div>
            <div className="recent-activity-strip__what">
              <strong className="ui-mono">{event.action}</strong>
              <span className="muted-copy"> by {formatActor(event)}</span>
            </div>
            <div className="recent-activity-strip__result">
              <StatusBadge label={event.outcome} tone={outcomeTone(event.outcome)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Maps an outcome value to the badge tone shared with the admin audit timeline.
 */
function outcomeTone(outcome: AuditEvent["outcome"]): BadgeTone {
  switch (outcome) {
    case "succeeded":
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
 * Formats an actor cell using the same convention as the admin timeline.
 * Unauthenticated actions show as "Unauthenticated" — the middleware records
 * denied attempts even when there is no session.
 */
function formatActor(event: AuditEvent): string {
  if (!event.actorId) return "Unauthenticated";
  return event.actorRole ? `${event.actorId} (${event.actorRole})` : event.actorId;
}

/**
 * Renders a relative timestamp for recent events and a compact absolute date
 * for older events. Falls back to the raw ISO string if parsing fails.
 */
function formatRelativeOrAbsolute(iso: string): string {
  if (!iso) return "Unknown";
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffSeconds = Math.round((now - then) / 1000);

    if (diffSeconds < 60) return "just now";
    if (diffSeconds < 3600) return `${Math.round(diffSeconds / 60)} min ago`;
    if (diffSeconds < 86400) return `${Math.round(diffSeconds / 3600)} hr ago`;
    if (diffSeconds < 604800) return `${Math.round(diffSeconds / 86400)} day ago`;

    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
