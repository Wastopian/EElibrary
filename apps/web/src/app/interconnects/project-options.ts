/**
 * File header: Loads the optional project picker options for cable authoring forms.
 *
 * Best-effort: if the project list cannot be read, the forms simply show "No project" and
 * cable authoring still works without a project link.
 */

import { fetchProjectList } from "../../lib/api-client";
import type { CableProjectOption } from "./CableCreateForm";

/** Reads distinct projects as cable project-picker options, degrading to an empty list on failure. */
export async function loadCableProjectOptions(): Promise<CableProjectOption[]> {
  try {
    const response = await fetchProjectList();
    return response.projects.map((summary) => ({
      id: summary.project.id,
      label: [summary.project.projectKey, summary.project.name].filter(Boolean).join(" — ")
    }));
  } catch {
    return [];
  }
}
