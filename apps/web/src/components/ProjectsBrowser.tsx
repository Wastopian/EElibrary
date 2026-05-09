"use client";

/**
 * File header: Renders the projects list with a client-side search filter.
 *
 * The search input filters by project key, name, owner, and description so engineers can
 * quickly narrow the list without round-tripping the server. When the filter excludes
 * everything, the table shows an explicit empty state to avoid implying "no projects exist".
 */

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";
import type { ProjectStatus, ProjectSummary } from "@ee-library/shared/types";

interface ProjectsBrowserProps {
  /** Project summaries persisted in the catalog database, in their server-provided order. */
  projects: ProjectSummary[];
}

/**
 * Renders a search input plus a simplified projects table that updates as the engineer types.
 */
export function ProjectsBrowser({ projects }: ProjectsBrowserProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => filterProjects(projects, query), [projects, query]);

  return (
    <div className="projects-browser">
      <label className="projects-browser__search">
        <span>Search projects</span>
        <input
          autoComplete="off"
          name="project-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Project name, key, owner, or description"
          type="search"
          value={query}
        />
      </label>
      <p className="projects-browser__count muted-copy">
        {query
          ? `${filtered.length} of ${projects.length} project${projects.length === 1 ? "" : "s"}`
          : `${projects.length} project${projects.length === 1 ? "" : "s"}`}
      </p>
      {filtered.length === 0 ? (
        <p className="projects-browser__empty">No projects match this search.</p>
      ) : (
        <div className="projects-table-wrap">
          <table className="projects-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Parts</th>
                <th>Latest activity</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((summary) => (
                <tr key={summary.project.id}>
                  <td>
                    <Link className="projects-browser__link" href={`/projects/${summary.project.id}`}>
                      <span className="ui-mono">{summary.project.projectKey}</span>
                    </Link>
                    <div className="projects-table__primary">{summary.project.name}</div>
                    {summary.project.description ? (
                      <div className="muted-copy">{summary.project.description}</div>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge label={formatProjectStatus(summary.project.status)} tone={projectStatusTone(summary.project.status)} />
                  </td>
                  <td>{summary.project.owner ?? "Unassigned"}</td>
                  <td>{summary.usageCount}</td>
                  <td>{formatDateTime(summary.latestActivityAt)}</td>
                  <td>
                    <Link className="button-link button-link--quiet" href={`/projects/${summary.project.id}`}>
                      Open
                    </Link>
                  </td>
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
 * Filters project summaries by a case-insensitive substring match across the most
 * useful identification fields, keeping the input flexible without relying on the API.
 */
function filterProjects(projects: ProjectSummary[], rawQuery: string): ProjectSummary[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return projects;
  }

  return projects.filter((summary) => {
    const haystack = [
      summary.project.projectKey,
      summary.project.name,
      summary.project.description ?? "",
      summary.project.owner ?? ""
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

/**
 * Maps project lifecycle status into operator-facing copy that mirrors the server-rendered table.
 */
function formatProjectStatus(status: ProjectStatus): string {
  return {
    active: "Active",
    archived: "Archived",
    deprecated: "Deprecated",
    production: "Production",
    prototype: "Prototype"
  }[status];
}

/**
 * Maps project lifecycle status to a badge tone identical to the rest of the workspace.
 */
function projectStatusTone(status: ProjectStatus): BadgeTone {
  if (status === "production" || status === "active") {
    return "verified";
  }

  if (status === "prototype") {
    return "info";
  }

  if (status === "deprecated") {
    return "review";
  }

  return "neutral";
}

/**
 * Formats timestamps for the table without changing the original time zone behavior.
 */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
