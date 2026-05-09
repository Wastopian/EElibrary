"use client";

/**
 * File header: Renders confirmed project part usage with a client-side search filter.
 *
 * Engineers commonly want to ask "is this part used here?" The search input narrows the
 * usage table by part identifier, MPN, manufacturer, designators, and usage context so
 * that question is answered without leaving the project page.
 */

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";
import type { ProjectPartUsage, ProjectPartUsageStatus } from "@ee-library/shared/types";

interface ProjectUsageBrowserProps {
  /** Confirmed usage rows to display. */
  usages: ProjectPartUsage[];
}

/**
 * Renders a search input above the confirmed usage table; the table is filtered live.
 */
export function ProjectUsageBrowser({ usages }: ProjectUsageBrowserProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => filterUsages(usages, query), [usages, query]);

  return (
    <div className="project-usage-browser">
      <label className="project-usage-browser__search">
        <span>Search parts in this project</span>
        <input
          autoComplete="off"
          name="project-part-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Part number, manufacturer, designator, or context"
          type="search"
          value={query}
        />
      </label>
      <p className="project-usage-browser__count muted-copy">
        {query
          ? `${filtered.length} of ${usages.length} matching part${usages.length === 1 ? "" : "s"}`
          : `${usages.length} part${usages.length === 1 ? "" : "s"} confirmed in this project`}
      </p>
      {filtered.length === 0 ? (
        <p className="project-usage-browser__empty">No parts in this project match this search.</p>
      ) : (
        <div className="projects-table-wrap">
          <table className="projects-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Status</th>
                <th>Designators</th>
                <th>Quantity</th>
                <th>Context</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((usage) => (
                <tr key={usage.id}>
                  <td>
                    <Link href={`/parts/${usage.partId}`}>
                      <strong className="ui-mono">{usage.partMpn ?? usage.partId}</strong>
                    </Link>
                    <div className="muted-copy">{usage.manufacturerName ?? "Manufacturer not recorded"}</div>
                  </td>
                  <td>
                    <StatusBadge label={formatUsageStatus(usage.usageStatus)} tone={usageStatusTone(usage.usageStatus)} />
                  </td>
                  <td>{formatDesignators(usage.designators)}</td>
                  <td>{usage.quantity ?? "Not recorded"}</td>
                  <td>{usage.usageContext ?? "No usage context recorded"}</td>
                  <td>{formatDateTime(usage.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Filters confirmed usage rows by a case-insensitive substring across the most useful fields.
 */
function filterUsages(usages: ProjectPartUsage[], rawQuery: string): ProjectPartUsage[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return usages;
  }

  return usages.filter((usage) => {
    const haystack = [
      usage.partId,
      usage.partMpn ?? "",
      usage.manufacturerName ?? "",
      usage.designators.join(" "),
      usage.usageContext ?? ""
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

/**
 * Formats confirmed project usage lifecycle status for display.
 */
function formatUsageStatus(status: ProjectPartUsageStatus): string {
  return {
    deprecated: "Deprecated",
    in_review: "In review",
    proposed: "Proposed",
    released: "Released",
    used: "Used"
  }[status];
}

/**
 * Maps usage lifecycle status into a badge tone consistent with the rest of the workspace.
 */
function usageStatusTone(status: ProjectPartUsageStatus): BadgeTone {
  if (status === "released" || status === "used") {
    return "verified";
  }

  if (status === "in_review" || status === "proposed") {
    return "info";
  }

  return "review";
}

/**
 * Formats designator arrays for dense usage rows.
 */
function formatDesignators(designators: string[]): string {
  return designators.length > 0 ? designators.join(", ") : "Not recorded";
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
