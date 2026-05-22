/**
 * File header: Registers missing BOM parts into the catalog from the on-disk project folder.
 */

"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useState } from "react";
import { ingestProjectMirrorFromFolder, isApiClientError } from "../lib/api-client";
import type { ProjectMirrorIngestResponse } from "@ee-library/shared/types";

/** ProjectMirrorCatalogPanelProps scopes ingest to one persisted project. */
export interface ProjectMirrorCatalogPanelProps {
  projectId: string;
}

type IngestStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success"; response: ProjectMirrorIngestResponse }
  | { kind: "failed"; message: string };

/**
 * Runs mirror ingest so unmatched BOM rows become catalog parts before matching.
 */
export function ProjectMirrorCatalogPanel({ projectId }: ProjectMirrorCatalogPanelProps): React.ReactElement {
  const router = useRouter();
  const [status, setStatus] = useState<IngestStatus>({ kind: "idle" });

  const onIngest = useCallback(async () => {
    setStatus({ kind: "running" });

    try {
      const response = await ingestProjectMirrorFromFolder(projectId);
      setStatus({ kind: "success", response });
      if (response.partsRegistered > 0 || response.usagesLinked > 0 || response.catalogAssetsIngested > 0) {
        router.refresh();
      }
    } catch (error) {
      setStatus({
        kind: "failed",
        message: isApiClientError(error) ? error.message : "Could not register parts from the project folder."
      });
    }
  }, [projectId, router]);

  return (
    <div className="project-mirror-catalog-panel">
      <button disabled={status.kind === "running"} onClick={onIngest} type="button">
        {status.kind === "running" ? "Registering from folder..." : "Register missing parts from folder"}
      </button>
      <ProjectMirrorCatalogStatus status={status} />
    </div>
  );
}

function ProjectMirrorCatalogStatus({ status }: { status: IngestStatus }): React.ReactElement | null {
  if (status.kind === "idle") {
    return (
      <p className="project-mirror-catalog-panel__status muted-copy">
        Reads <span className="ui-mono">parts-list/</span>, <span className="ui-mono">datasheets/</span>,{" "}
        <span className="ui-mono">models/</span>, <span className="ui-mono">footprints/</span>,{" "}
        <span className="ui-mono">symbols/</span>, and <span className="ui-mono">mechanical-drawings/</span> on disk, adds
        any missing MPNs to the catalog, then you can run <strong>Match rows</strong>.
      </p>
    );
  }

  if (status.kind === "running") {
    return <p className="project-mirror-catalog-panel__status muted-copy">Importing parts list and copying mirror files into the catalog...</p>;
  }

  if (status.kind === "failed") {
    return <p className="project-mirror-catalog-panel__status project-mirror-catalog-panel__status--failed">{status.message}</p>;
  }

  const parts: string[] = [];

  if (status.response.partsListFile) {
    parts.push(`parts list ${status.response.partsListFile}`);
  }

  if (status.response.partsRegistered > 0) {
    parts.push(
      `registered ${status.response.partsRegistered} catalog part${status.response.partsRegistered === 1 ? "" : "s"}`
    );
  }

  if (status.response.catalogAssetsIngested > 0) {
    parts.push(
      `ingested ${status.response.catalogAssetsIngested} catalog asset${status.response.catalogAssetsIngested === 1 ? "" : "s"}`
    );
  }

  if (status.response.usagesLinked > 0) {
    parts.push(`linked ${status.response.usagesLinked} project usage${status.response.usagesLinked === 1 ? "" : "s"}`);
  }

  if (status.response.assetsLinked > 0) {
    parts.push(`linked ${status.response.assetsLinked} mirror file${status.response.assetsLinked === 1 ? "" : "s"}`);
  }

  return (
    <p className="project-mirror-catalog-panel__status">
      {parts.length > 0 ? parts.join("; ") + "." : "Folder ingest completed with no new catalog changes."}
      {" "}
      Run <strong>Match rows</strong> below to link this project to the catalog.
    </p>
  );
}
