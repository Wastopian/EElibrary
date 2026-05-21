/**
 * File header: Helpers for the slim part detail view opened from a project.
 */

import type { DetailSectionTab } from "../app/parts/[partId]/DetailSectionNav";

/** ProjectFocusContext carries the project the engineer came from. */
export interface ProjectFocusContext {
  projectId: string;
  projectName: string;
}

/**
 * Reads the optional `project` query param used when navigating from a project part kit.
 */
export function normalizeProjectContextId(searchParams: { project?: string | string[] }): string | null {
  const raw = searchParams.project;

  if (typeof raw === "string") {
    const trimmed = raw.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(raw)) {
    const first = raw[0]?.trim();

    return first && first.length > 0 ? first : null;
  }

  return null;
}

/**
 * @deprecated Use the full catalog detail tabs; kept for tests that still import this helper.
 */
export function buildProjectFocusDetailTabs(whereUsedCount: number): DetailSectionTab[] {
  return [
    { href: "#overview-heading", label: "Overview" },
    { href: "#files-heading", label: "Files" },
    {
      badge: whereUsedCount > 0 ? `${whereUsedCount}` : undefined,
      href: "#where-used-heading",
      label: "Where-used"
    },
    { href: "#catalog-advanced-heading", label: "More catalog detail" }
  ];
}

/**
 * Builds the back link target for a project-focused part view.
 */
export function buildProjectFocusBackHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

/**
 * Builds the part kit editor anchor on the project page.
 */
export function buildProjectFocusKitHref(projectId: string): string {
  return `${buildProjectFocusBackHref(projectId)}#project-usage-heading`;
}
