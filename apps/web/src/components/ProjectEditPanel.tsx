/**
 * File header: Client-side project and active-revision edit panel for project-memory records.
 */

"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useMemo, useState } from "react";
import { isApiClientError, updateProject, updateProjectRevision } from "../lib/api-client";
import type { Project, ProjectRevision, ProjectRevisionStatus, ProjectStatus } from "@ee-library/shared/types";

/** ProjectEditPanelProps provides persisted project records that seed the edit forms. */
export interface ProjectEditPanelProps {
  project: Project;
  revisions: ProjectRevision[];
}

/** ProjectEditStatus tracks operator feedback for one edit form. Each form keeps its own state
 * so a save on one does not erase the confirmation banner on the other. */
type ProjectEditStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; message: string }
  | { kind: "failed"; message: string };

/**
 * Renders project metadata and current revision edit forms without touching trust state.
 */
export function ProjectEditPanel({ project, revisions }: ProjectEditPanelProps): React.ReactElement {
  const router = useRouter();
  const activeRevision = useMemo(() => chooseActiveRevision(revisions), [revisions]);
  const [name, setName] = useState(project.name);
  const [owner, setOwner] = useState(project.owner ?? "");
  const [description, setDescription] = useState(project.description);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>(project.status);
  const [revisionStatus, setRevisionStatus] = useState<ProjectRevisionStatus>(activeRevision?.revisionStatus ?? "draft");
  const [sourceReference, setSourceReference] = useState(activeRevision?.sourceReference ?? "");
  const [releasedAt, setReleasedAt] = useState(toDateTimeLocalValue(activeRevision?.releasedAt ?? null));
  const [projectFormStatus, setProjectFormStatus] = useState<ProjectEditStatus>({ kind: "idle" });
  const [revisionFormStatus, setRevisionFormStatus] = useState<ProjectEditStatus>({ kind: "idle" });

  /**
   * Persists project-level metadata only.
   */
  const onProjectSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!name.trim()) {
        setProjectFormStatus({ kind: "failed", message: "Project name is required." });
        return;
      }

      setProjectFormStatus({ kind: "saving" });

      try {
        const response = await updateProject(project.id, {
          description: description.trim() || null,
          name: name.trim(),
          owner: owner.trim() || null,
          status: projectStatus
        });

        setProjectFormStatus({ kind: "success", message: response.boundary });
        router.refresh();
      } catch (error) {
        setProjectFormStatus({ kind: "failed", message: resolveProjectEditFailure(error, "Project update") });
      }
    },
    [description, name, owner, project.id, projectStatus, router]
  );

  /**
   * Persists active revision metadata without mutating BOM rows.
   */
  const onRevisionSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!activeRevision) {
        setRevisionFormStatus({ kind: "failed", message: "Create a project revision before editing revision metadata." });
        return;
      }

      setRevisionFormStatus({ kind: "saving" });

      try {
        const response = await updateProjectRevision(project.id, activeRevision.id, {
          releasedAt: releasedAt.trim() ? new Date(releasedAt).toISOString() : null,
          revisionStatus,
          sourceReference: sourceReference.trim() || null
        });

        setRevisionFormStatus({ kind: "success", message: response.boundary });
        router.refresh();
      } catch (error) {
        setRevisionFormStatus({ kind: "failed", message: resolveProjectEditFailure(error, "Project revision update") });
      }
    },
    [activeRevision, project.id, releasedAt, revisionStatus, router, sourceReference]
  );

  return (
    <div className="project-edit-panel">
      <form className="project-edit-panel__form" onSubmit={onProjectSubmit}>
        <label>
          <span>Name</span>
          <input autoComplete="off" onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label>
          <span>Owner</span>
          <input autoComplete="off" onChange={(event) => setOwner(event.target.value)} placeholder="Hardware" value={owner} />
        </label>
        <label>
          <span>Status</span>
          <select onChange={(event) => setProjectStatus(event.target.value as ProjectStatus)} value={projectStatus}>
            <option value="active">Active</option>
            <option value="prototype">Prototype</option>
            <option value="production">Production</option>
            <option value="deprecated">Deprecated</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="project-edit-panel__field--wide">
          <span>Notes / description</span>
          <textarea onChange={(event) => setDescription(event.target.value)} placeholder="Project context, constraints, or maintenance notes" value={description} />
        </label>
        <div className="project-edit-panel__actions">
          <button disabled={projectFormStatus.kind === "saving"} type="submit">
            {projectFormStatus.kind === "saving" ? "Saving..." : "Save project"}
          </button>
          <span>Edits project metadata only.</span>
        </div>
        <ProjectEditStatusMessage scope="project" status={projectFormStatus} />
      </form>

      <form className="project-edit-panel__form" onSubmit={onRevisionSubmit}>
        <label>
          <span>Active revision</span>
          <input disabled value={activeRevision?.revisionLabel ?? "No revision"} />
        </label>
        <label>
          <span>Revision status</span>
          <select disabled={!activeRevision} onChange={(event) => setRevisionStatus(event.target.value as ProjectRevisionStatus)} value={revisionStatus}>
            <option value="draft">Draft</option>
            <option value="in_review">In review</option>
            <option value="released">Released</option>
            <option value="superseded">Superseded</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          <span>Released at</span>
          <input disabled={!activeRevision} onChange={(event) => setReleasedAt(event.target.value)} type="datetime-local" value={releasedAt} />
        </label>
        <label className="project-edit-panel__field--wide">
          <span>Revision source</span>
          <input disabled={!activeRevision} onChange={(event) => setSourceReference(event.target.value)} placeholder="Git tag, ECO, release note, or board file reference" value={sourceReference} />
        </label>
        <div className="project-edit-panel__actions">
          <button disabled={!activeRevision || revisionFormStatus.kind === "saving"} type="submit">
            {revisionFormStatus.kind === "saving" ? "Saving..." : "Save revision"}
          </button>
          <span>Revision edits do not remap BOM rows.</span>
        </div>
        <ProjectEditStatusMessage scope="revision" status={revisionFormStatus} />
      </form>
    </div>
  );
}

/**
 * Chooses the newest non-archived revision as the editable active revision.
 */
function chooseActiveRevision(revisions: ProjectRevision[]): ProjectRevision | null {
  return revisions.find((revision) => revision.revisionStatus !== "archived" && revision.revisionStatus !== "superseded") ?? revisions[0] ?? null;
}

/**
 * Converts ISO timestamps to the local value expected by datetime-local inputs.
 */
function toDateTimeLocalValue(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 16);
}

/**
 * Renders edit feedback without implying trust-state changes. Each form mounts its own copy
 * anchored beneath its submit button so a save on one form does not erase the other's banner.
 */
function ProjectEditStatusMessage({ scope, status }: { scope: "project" | "revision"; status: ProjectEditStatus }): React.ReactElement | null {
  if (status.kind === "idle") {
    return null;
  }

  if (status.kind === "saving") {
    return <p className="project-edit-panel__status project-edit-panel__status--pending">Saving {scope} metadata...</p>;
  }

  if (status.kind === "success") {
    return <p className="project-edit-panel__status project-edit-panel__status--success">{status.message}</p>;
  }

  return <p className="project-edit-panel__status project-edit-panel__status--failed">{status.message}</p>;
}

/**
 * Converts API failures into concise project-edit copy.
 */
function resolveProjectEditFailure(error: unknown, action: string): string {
  if (!isApiClientError(error)) {
    return `${action} failed. Check the API and try again.`;
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return `${action} requires an admin session.`;
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return `${action} requires the project-memory database.`;
  }

  return error.message.replace(new RegExp(`^${action} failed \\([^)]+\\):\\s*`, "u"), "");
}
