/**
 * File header: "Use as BOM import" action for a parts-list file already in the project folder.
 *
 * The server reads the mirror file directly (no browser re-upload), suggests a column mapping from
 * its headers, and creates the BOM import when the MPN column is recognizable. When it is not, the
 * flow honestly falls back to a compact human mapping step instead of guessing catalog identity.
 * Importing records rows only — it never matches, approves, or export-promotes anything.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useMemo, useState } from "react";
import { importProjectFileAsBom, isApiClientError } from "../lib/api-client";
import type { BomColumnMapping, BomImportPreviewResponse, ProjectFileBomImportResponse, ProjectRevision } from "@ee-library/shared/types";

/** NEW_REVISION_VALUE marks the "create a new revision" select option. */
const NEW_REVISION_VALUE = "__new_revision__";

/** UNMAPPED_VALUE marks a mapping select left without a source column. */
const UNMAPPED_VALUE = "__unmapped__";

/** MAPPING_FIELDS lists the BOM columns an engineer can map, MPN first because it is required. */
const MAPPING_FIELDS: Array<{ key: keyof BomColumnMapping; label: string; required: boolean }> = [
  { key: "mpn", label: "MPN", required: true },
  { key: "manufacturer", label: "Manufacturer", required: false },
  { key: "quantity", label: "Quantity", required: false },
  { key: "designators", label: "Designators", required: false },
  { key: "description", label: "Description", required: false },
  { key: "supplierReference", label: "Supplier reference", required: false },
  { key: "notes", label: "Notes", required: false }
];

/** ProjectFileBomImportActionProps scopes the action to one mapped parts-list file. */
export interface ProjectFileBomImportActionProps {
  projectId: string;
  /** Mirror-relative path of the parts-list file. */
  relativePath: string;
  /** Existing project revisions for the import target selector. */
  revisions: ProjectRevision[];
}

/** ActionStatus tracks the inline import flow state. */
type ActionStatus =
  | { kind: "collapsed" }
  | { kind: "choosing" }
  | { kind: "importing" }
  | { kind: "mapping"; preview: BomImportPreviewResponse; mapping: BomColumnMapping }
  | { kind: "success"; response: Extract<ProjectFileBomImportResponse, { outcome: "created" }> }
  | { kind: "failed"; message: string };

/**
 * Renders the inline import flow for one parts-list file the folder already has.
 */
export function ProjectFileBomImportAction({ projectId, relativePath, revisions }: ProjectFileBomImportActionProps): React.ReactElement {
  const router = useRouter();
  const [status, setStatus] = useState<ActionStatus>({ kind: "collapsed" });
  const [selectedRevisionId, setSelectedRevisionId] = useState(revisions[0]?.id ?? NEW_REVISION_VALUE);
  const [revisionLabel, setRevisionLabel] = useState(revisions.length > 0 ? "" : "Working");

  const revisionInput = useMemo(() => {
    return selectedRevisionId === NEW_REVISION_VALUE
      ? { revisionLabel: revisionLabel.trim() || null }
      : { projectRevisionId: selectedRevisionId };
  }, [revisionLabel, selectedRevisionId]);

  const canImport = selectedRevisionId !== NEW_REVISION_VALUE || revisionLabel.trim().length > 0;

  /**
   * Runs one import attempt; a mapping argument re-submits after the human mapping step.
   */
  const onImport = useCallback(
    async (mapping?: BomColumnMapping) => {
      setStatus({ kind: "importing" });

      try {
        const response = await importProjectFileAsBom(projectId, {
          relativePath,
          ...revisionInput,
          ...(mapping ? { columnMapping: mapping } : {})
        });

        if (response.outcome === "mapping_required") {
          setStatus({ kind: "mapping", mapping: response.preview.suggestedMapping, preview: response.preview });
          return;
        }

        setStatus({ kind: "success", response });
        router.refresh();
      } catch (error) {
        setStatus({ kind: "failed", message: resolveImportFailure(error) });
      }
    },
    [projectId, relativePath, revisionInput, router]
  );

  if (status.kind === "collapsed") {
    return (
      <button className="button-link button-link--quiet" onClick={() => setStatus({ kind: "choosing" })} type="button">
        Use as BOM import
      </button>
    );
  }

  if (status.kind === "success") {
    const created = status.response.created;

    return (
      <div className="project-file-bom-import">
        <p className="project-file-bom-import__status">
          Saved {created.lineCount} row{created.lineCount === 1 ? "" : "s"} from <code className="ui-mono">{status.response.sourceRelativePath}</code>.
          {" "}
          <Link href="#project-bom-imports-heading">Match the rows in Parts list imports</Link>
        </p>
        <p className="muted-copy">Rows are saved, not matched or approved — run Match rows next.</p>
      </div>
    );
  }

  return (
    <div className="project-file-bom-import">
      <label>
        <span>Import into revision</span>
        <select onChange={(event) => setSelectedRevisionId(event.target.value)} value={selectedRevisionId}>
          {revisions.map((revision) => (
            <option key={revision.id} value={revision.id}>
              {revision.revisionLabel}
            </option>
          ))}
          <option value={NEW_REVISION_VALUE}>New revision...</option>
        </select>
      </label>
      {selectedRevisionId === NEW_REVISION_VALUE ? (
        <label>
          <span>New revision label</span>
          <input onChange={(event) => setRevisionLabel(event.target.value)} placeholder="For example: A" type="text" value={revisionLabel} />
        </label>
      ) : null}
      {status.kind === "mapping" ? (
        <MappingStep
          initialMapping={status.mapping}
          onSubmit={(mapping) => void onImport(mapping)}
          preview={status.preview}
        />
      ) : (
        <button disabled={status.kind === "importing" || !canImport} onClick={() => void onImport()} type="button">
          {status.kind === "importing" ? "Reading the file..." : "Import this parts list"}
        </button>
      )}
      {status.kind === "failed" ? <p className="project-file-bom-import__error">{status.message}</p> : null}
      <button className="button-link button-link--quiet" onClick={() => setStatus({ kind: "collapsed" })} type="button">
        Cancel
      </button>
    </div>
  );
}

/**
 * Renders the compact human mapping step when the file's MPN column was not recognizable.
 */
function MappingStep({
  initialMapping,
  onSubmit,
  preview
}: {
  initialMapping: BomColumnMapping;
  onSubmit: (mapping: BomColumnMapping) => void;
  preview: BomImportPreviewResponse;
}): React.ReactElement {
  const [mapping, setMapping] = useState<BomColumnMapping>(initialMapping);

  return (
    <div className="project-file-bom-import__mapping">
      <p className="muted-copy">
        The file&apos;s MPN column was not recognizable, so nothing was imported. Map the columns below — only mapped columns are saved.
      </p>
      {MAPPING_FIELDS.map((field) => (
        <label key={field.key}>
          <span>
            {field.label}
            {field.required ? " (required)" : ""}
          </span>
          <select
            onChange={(event) =>
              setMapping((current) => ({
                ...current,
                [field.key]: event.target.value === UNMAPPED_VALUE ? null : event.target.value
              }))
            }
            value={mapping[field.key] ?? UNMAPPED_VALUE}
          >
            <option value={UNMAPPED_VALUE}>Not in this file</option>
            {preview.headers.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button disabled={!mapping.mpn} onClick={() => onSubmit(mapping)} type="button">
        Import with this mapping
      </button>
    </div>
  );
}

/**
 * Converts API failures into concise operator copy.
 */
function resolveImportFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Could not import the file. Check the API and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Importing a parts list requires an admin session.";
  }

  return error.message.replace(/^Project-file BOM import failed \([^)]+?\):\s*/u, "");
}
