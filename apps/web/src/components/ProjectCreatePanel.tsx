/**
 * File header: Client-side project creation panel for opening real project-memory workspaces.
 */

"use client";

import React, { useCallback, useState } from "react";
import { createProject, isApiClientError } from "../lib/api-client";
import type { ProjectCreateInput, ProjectCreateResponse, ProjectStatus } from "@ee-library/shared/types";

/** ProjectCreateStatus tracks operator feedback for project creation. */
type ProjectCreateStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; response: ProjectCreateResponse }
  | { kind: "failed"; message: string };

/**
 * Renders a compact project creation form that creates the first revision as part of setup.
 */
export function ProjectCreatePanel(): React.ReactElement {
  const [projectKey, setProjectKey] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [description, setDescription] = useState("");
  const [initialRevisionLabel, setInitialRevisionLabel] = useState("Working");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [createStatus, setCreateStatus] = useState<ProjectCreateStatus>({ kind: "idle" });

  /**
   * Creates a DB-backed project and opens the detail workspace when the API confirms it.
   */
  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!projectKey.trim() || !name.trim()) {
        setCreateStatus({ kind: "failed", message: "Project key and name are required." });
        return;
      }

      setCreateStatus({ kind: "submitting" });

      const input: ProjectCreateInput = {
        description: description.trim() || null,
        initialRevisionLabel: initialRevisionLabel.trim() || "Working",
        name: name.trim(),
        owner: owner.trim() || null,
        projectKey: projectKey.trim(),
        status
      };

      try {
        const response = await createProject(input);
        setCreateStatus({ kind: "success", response });
        navigateToProject(response.project.id);
      } catch (error) {
        setCreateStatus({
          kind: "failed",
          message: resolveProjectCreateFailure(error)
        });
      }
    },
    [description, initialRevisionLabel, name, owner, projectKey, status]
  );

  return (
    <div className="project-create-panel">
      <form className="project-create-panel__form" onSubmit={onSubmit}>
        <label className="project-create-panel__field">
          <span>Project key</span>
          <input autoComplete="off" name="projectKey" onChange={(event) => setProjectKey(event.target.value)} placeholder="ALPHA-CONTROL" value={projectKey} />
        </label>
        <label className="project-create-panel__field">
          <span>Name</span>
          <input autoComplete="off" name="name" onChange={(event) => setName(event.target.value)} placeholder="Motor controller alpha" value={name} />
        </label>
        <label className="project-create-panel__field">
          <span>Owner</span>
          <input autoComplete="off" name="owner" onChange={(event) => setOwner(event.target.value)} placeholder="Hardware" value={owner} />
        </label>
        <label className="project-create-panel__field">
          <span>Status</span>
          <select name="status" onChange={(event) => setStatus(event.target.value as ProjectStatus)} value={status}>
            <option value="active">Active</option>
            <option value="prototype">Prototype</option>
            <option value="production">Production</option>
            <option value="deprecated">Deprecated</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="project-create-panel__field">
          <span>First revision</span>
          <input autoComplete="off" name="initialRevisionLabel" onChange={(event) => setInitialRevisionLabel(event.target.value)} placeholder="Working" value={initialRevisionLabel} />
        </label>
        <label className="project-create-panel__field project-create-panel__field--wide">
          <span>Description</span>
          <input autoComplete="off" name="description" onChange={(event) => setDescription(event.target.value)} placeholder="Short project context" value={description} />
        </label>
        <div className="project-create-panel__actions">
          <button disabled={createStatus.kind === "submitting"} type="submit">
            {createStatus.kind === "submitting" ? "Creating..." : "Create project"}
          </button>
          <span>Creates a project root and first draft revision for BOM intake.</span>
        </div>
      </form>
      <ProjectCreateStatusMessage status={createStatus} />
    </div>
  );
}

/**
 * Renders project creation feedback without hiding auth or database failures.
 */
function ProjectCreateStatusMessage({ status }: { status: ProjectCreateStatus }) {
  if (status.kind === "idle") {
    return null;
  }

  if (status.kind === "submitting") {
    return <p className="project-create-panel__status project-create-panel__status--pending">Creating project memory...</p>;
  }

  if (status.kind === "success") {
    return <p className="project-create-panel__status project-create-panel__status--success">Created {status.response.project.projectKey}. Opening project workspace.</p>;
  }

  return <p className="project-create-panel__status project-create-panel__status--failed">{status.message}</p>;
}

/**
 * Converts API project creation failures into concise operator copy.
 */
function resolveProjectCreateFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Project creation failed. Check the API and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Project creation requires an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "Project creation requires the project-memory database.";
  }

  return error.message.replace(/^Project create failed \([^)]+\):\s*/u, "");
}

/**
 * Navigates to the created project detail route when a browser window is available.
 */
function navigateToProject(projectId: string): void {
  if (typeof window !== "undefined") {
    window.location.assign(`/projects/${encodeURIComponent(projectId)}`);
  }
}
