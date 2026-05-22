"use client";

/**
 * File header: Project-scoped part kit editor — datasheet, symbol, footprint, 3D, drawing, note, and supplier URL.
 *
 * The table stays compact: each row shows quick file/URL status. Expanding a row opens the
 * all-slot editor without sending engineers through the catalog verification workspace.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import { isApiClientError, updateProjectPartKit, uploadProjectFile } from "../lib/api-client";
import { buildKitFileActions, type KitFileSlot } from "../lib/part-kit-file-actions";
import {
  buildUploadedPartKitFileRef,
  MAX_PART_KIT_UPLOAD_BYTES,
  partKitSlotToCategory,
  readFileAsBase64,
  suggestPartKitFilename
} from "../lib/project-part-kit-upload";
import type { ProjectPartKit, ProjectPartKitFileRef } from "@ee-library/shared/types";

interface ProjectPartKitPanelProps {
  /** Stable project id for uploads and saves. */
  projectId: string;
  /** Initial kits loaded on the server. */
  initialKits: ProjectPartKit[];
  /** Whether the on-disk project mirror is configured. */
  mirrorAvailable: boolean;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "success"; message: string } | { kind: "failed"; message: string };

/**
 * Renders searchable part rows with an expandable kit editor per MPN.
 */
export function ProjectPartKitPanel({ projectId, initialKits, mirrorAvailable }: ProjectPartKitPanelProps) {
  const router = useRouter();
  const [kits, setKits] = useState(initialKits);
  const [query, setQuery] = useState("");
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);

  useEffect(() => {
    setKits(initialKits);
  }, [initialKits]);

  const filtered = useMemo(() => filterKits(kits, query), [kits, query]);

  const onKitUpdated = useCallback((updated: ProjectPartKit) => {
    setKits((current) => current.map((kit) => (kit.partId === updated.partId ? updated : kit)));
    router.refresh();
  }, [router]);

  return (
    <div className="project-part-kit-panel">
      <p className="project-part-kit-panel__lede muted-copy">
        Add datasheet, symbol, footprint, 3D model, mechanical drawing, a note, and a supplier link. Files are saved in your project folder;{" "}
        <strong>Save</strong> updates the BOM and copies files into the catalog when the mirror is available.
      </p>

      {!mirrorAvailable ? (
        <p className="project-part-kit-panel__warning muted-copy" role="status">
          Project folder mirror is off — you can still save notes and URLs, but file uploads need the mirror configured in admin.
        </p>
      ) : null}

      <label className="project-part-kit-panel__search">
        <span>Search parts</span>
        <input
          autoComplete="off"
          name="project-part-kit-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="MPN, designator, manufacturer"
          type="search"
          value={query}
        />
      </label>

      <p className="project-part-kit-panel__count muted-copy">
        {query ? `${filtered.length} of ${kits.length} parts` : `${kits.length} part${kits.length === 1 ? "" : "s"}`}
      </p>

      {filtered.length === 0 ? (
        <p className="project-part-kit-panel__empty muted-copy">No parts match this search.</p>
      ) : (
        <div className="project-part-kit-list">
          {filtered.map((kit) => (
            <ProjectPartKitRow
              expanded={expandedPartId === kit.partId}
              key={kit.partId}
              kit={kit}
              mirrorAvailable={mirrorAvailable}
              onKitUpdated={onKitUpdated}
              onToggle={() => setExpandedPartId((current) => (current === kit.partId ? null : kit.partId))}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ProjectPartKitRowProps {
  projectId: string;
  kit: ProjectPartKit;
  expanded: boolean;
  mirrorAvailable: boolean;
  onToggle: () => void;
  onKitUpdated: (kit: ProjectPartKit) => void;
}

/**
 * Renders one part summary row and its optional expanded editor.
 */
function ProjectPartKitRow({ projectId, kit, expanded, mirrorAvailable, onToggle, onKitUpdated }: ProjectPartKitRowProps) {
  const [partUrl, setPartUrl] = useState(kit.partUrl ?? "");
  const [note, setNote] = useState(kit.note ?? "");
  const [datasheet, setDatasheet] = useState(kit.datasheet);
  const [model, setModel] = useState(kit.model);
  const [footprint, setFootprint] = useState(kit.footprint);
  const [symbol, setSymbol] = useState(kit.symbol);
  const [mechanicalDrawing, setMechanicalDrawing] = useState(kit.mechanicalDrawing);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    setPartUrl(kit.partUrl ?? "");
    setNote(kit.note ?? "");
    setDatasheet(kit.datasheet);
    setModel(kit.model);
    setFootprint(kit.footprint);
    setSymbol(kit.symbol);
    setMechanicalDrawing(kit.mechanicalDrawing);
  }, [kit.datasheet, kit.footprint, kit.mechanicalDrawing, kit.model, kit.mpn, kit.note, kit.partId, kit.partUrl, kit.symbol]);

  const onSave = useCallback(async () => {
    setSaveState({ kind: "saving" });

    try {
      const result = await updateProjectPartKit(projectId, kit.partId, {
        note: note.trim() || null,
        partUrl: partUrl.trim() || null,
        syncToCatalog: mirrorAvailable
      });
      onKitUpdated({ ...result.kit, engineeringMemoryWarning: result.kit.engineeringMemoryWarning ?? kit.engineeringMemoryWarning ?? null });
      setPartUrl(result.kit.partUrl ?? "");
      setNote(result.kit.note ?? "");
      setDatasheet(result.kit.datasheet);
      setModel(result.kit.model);
      setFootprint(result.kit.footprint);
      setSymbol(result.kit.symbol);
      setMechanicalDrawing(result.kit.mechanicalDrawing);
      setSaveState({
        kind: "success",
        message: result.catalogSync
          ? `Saved. Catalog sync linked ${result.catalogSync.catalogAssetsIngested} file${result.catalogSync.catalogAssetsIngested === 1 ? "" : "s"}.`
          : "Saved description and supplier URL."
      });
    } catch (error) {
      setSaveState({
        kind: "failed",
        message: isApiClientError(error) ? error.message : "Could not save this part kit."
      });
    }
  }, [kit.partId, mirrorAvailable, note, onKitUpdated, partUrl, projectId]);

  return (
    <article className={`project-part-kit-row${expanded ? " project-part-kit-row--expanded" : ""}`}>
      <div className="project-part-kit-row__summary">
        <div className="project-part-kit-row__identity">
          <Link className="project-part-kit-row__mpn ui-mono" href={`/parts/${encodeURIComponent(kit.partId)}?project=${encodeURIComponent(projectId)}`}>
            {kit.mpn}
          </Link>
          <span className="muted-copy">{kit.manufacturerName ?? "Manufacturer not recorded"}</span>
          <span className="muted-copy">{formatDesignators(kit.designators)}</span>
          {kit.engineeringMemoryWarning && kit.engineeringMemoryWarning.warningCount > 0 ? (
            <Link
              className="project-part-kit-row__memory"
              href={`/parts/${encodeURIComponent(kit.partId)}?project=${encodeURIComponent(projectId)}#engineering-memory-heading`}
              title="This part has confirmed engineering-memory records. Review before reusing."
            >
              <StatusBadge
                label={kit.engineeringMemoryWarning.blockingCount > 0 ? "Blocked before" : "Bit us before"}
                tone={kit.engineeringMemoryWarning.blockingCount > 0 ? "danger" : "review"}
              />
            </Link>
          ) : null}
        </div>

        <div className="project-part-kit-row__pills" aria-label="Part kit status">
          <KitPill label="DS" present={Boolean(datasheet)} source={datasheet?.source} />
          <KitPill label="SYM" present={Boolean(symbol)} source={symbol?.source} />
          <KitPill label="3D" present={Boolean(model)} source={model?.source} />
          <KitPill label="FP" present={Boolean(footprint)} source={footprint?.source} />
          <KitPill label="DWG" present={Boolean(mechanicalDrawing)} source={mechanicalDrawing?.source} />
          <KitPill label="URL" present={Boolean(partUrl.trim())} />
        </div>

        <button className="project-part-kit-row__toggle" onClick={onToggle} type="button">
          {expanded ? "Close" : "Edit kit"}
        </button>
      </div>

      {expanded ? (
        <div className="project-part-kit-editor">
          <div className="project-part-kit-editor__files">
            <KitFileSlot
              catalogPartId={kit.partId}
              disabled={!mirrorAvailable}
              fileRef={datasheet}
              label="Datasheet"
              mirrorAvailable={mirrorAvailable}
              onUploaded={setDatasheet}
              projectId={projectId}
              slot="datasheet"
              suggestedMpn={kit.mpn}
            />
            <KitFileSlot
              catalogPartId={kit.partId}
              disabled={!mirrorAvailable}
              fileRef={symbol}
              label="Symbol"
              mirrorAvailable={mirrorAvailable}
              onUploaded={setSymbol}
              projectId={projectId}
              slot="symbol"
              suggestedMpn={kit.mpn}
            />
            <KitFileSlot
              catalogPartId={kit.partId}
              disabled={!mirrorAvailable}
              fileRef={model}
              label="3D model"
              mirrorAvailable={mirrorAvailable}
              onUploaded={setModel}
              projectId={projectId}
              slot="model"
              suggestedMpn={kit.mpn}
            />
            <KitFileSlot
              catalogPartId={kit.partId}
              disabled={!mirrorAvailable}
              fileRef={footprint}
              label="Footprint"
              mirrorAvailable={mirrorAvailable}
              onUploaded={setFootprint}
              projectId={projectId}
              slot="footprint"
              suggestedMpn={kit.mpn}
            />
            <KitFileSlot
              catalogPartId={kit.partId}
              disabled={!mirrorAvailable}
              fileRef={mechanicalDrawing}
              label="Mechanical drawing"
              mirrorAvailable={mirrorAvailable}
              onUploaded={setMechanicalDrawing}
              projectId={projectId}
              slot="mechanical_drawing"
              suggestedMpn={kit.mpn}
            />
          </div>

          <label className="project-part-kit-editor__field">
            <span>Supplier URL</span>
            <input
              autoComplete="off"
              onChange={(event) => setPartUrl(event.target.value)}
              placeholder="From your parts list or catalog source"
              type="url"
              value={partUrl}
            />
          </label>

          <label className="project-part-kit-editor__field">
            <span>Description</span>
            <textarea
              onChange={(event) => setNote(event.target.value)}
              placeholder="From your parts list or catalog record"
              rows={3}
              value={note}
            />
          </label>

          <div className="project-part-kit-editor__actions">
            <button className="button-link" disabled={saveState.kind === "saving"} onClick={() => void onSave()} type="button">
              {saveState.kind === "saving" ? "Saving…" : "Save"}
            </button>
            <Link className="button-link button-link--quiet" href={`/parts/${encodeURIComponent(kit.partId)}`}>
              Full part record
            </Link>
          </div>

          {saveState.kind === "success" || saveState.kind === "failed" ? (
            <p
              className={
                saveState.kind === "failed"
                  ? "project-part-kit-editor__status project-part-kit-editor__status--error"
                  : "project-part-kit-editor__status"
              }
              role={saveState.kind === "failed" ? "alert" : "status"}
            >
              {saveState.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

interface KitPillProps {
  label: string;
  present: boolean;
  source?: ProjectPartKitFileRef["source"];
}

/**
 * Renders one compact kit status chip. A catalog-sourced file is marked distinctly so engineers
 * can see the catalog already holds it (no need to re-upload) without expanding the row.
 */
function KitPill({ label, present, source }: KitPillProps) {
  const fromCatalog = present && source === "catalog";
  const title = !present
    ? "Missing"
    : fromCatalog
      ? "Already in the catalog — no need to re-upload"
      : source === "mirror"
        ? "In this project's folder"
        : "Present";

  return (
    <span
      className={`project-part-kit-pill${present ? " project-part-kit-pill--present" : ""}${fromCatalog ? " project-part-kit-pill--catalog" : ""}`}
      title={title}
    >
      {label}
    </span>
  );
}

interface KitFileSlotProps {
  projectId: string;
  catalogPartId: string;
  slot: KitFileSlot;
  label: string;
  suggestedMpn: string;
  fileRef: ProjectPartKitFileRef | null;
  disabled: boolean;
  mirrorAvailable: boolean;
  onUploaded: (fileRef: ProjectPartKitFileRef) => void;
}

/**
 * Renders one file slot with optional upload.
 */
function KitFileSlot({
  projectId,
  catalogPartId,
  slot,
  label,
  suggestedMpn,
  fileRef,
  disabled,
  mirrorAvailable,
  onUploaded
}: KitFileSlotProps) {
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [message, setMessage] = useState("");
  const fileActions = fileRef ? buildKitFileActions(fileRef, catalogPartId, projectId, slot) : [];
  const previewHref =
    slot === "model" && fileRef
      ? `/parts/${encodeURIComponent(catalogPartId)}?project=${encodeURIComponent(projectId)}#part-asset-three_d_model`
      : null;

  const onChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }

      if (file.size > MAX_PART_KIT_UPLOAD_BYTES) {
        setStatus("error");
        setMessage("File is too large.");
        return;
      }

      setStatus("uploading");
      setMessage(`Uploading ${file.name}…`);

      try {
        const category = partKitSlotToCategory(slot);
        const result = await uploadProjectFile(projectId, category, {
          contentBase64: await readFileAsBase64(file),
          filename: suggestPartKitFilename(suggestedMpn, file)
        });
        onUploaded(buildUploadedPartKitFileRef(slot, result.entry.name));
        setStatus("idle");
        setMessage(`Saved as ${result.entry.name}. Press Save to copy into the catalog.`);
      } catch (error) {
        setStatus("error");
        setMessage(isApiClientError(error) ? error.message : "Upload failed.");
      }
    },
    [onUploaded, projectId, slot, suggestedMpn]
  );

  return (
    <div className="project-part-kit-file">
      <div className="project-part-kit-file__head">
        <span className="project-part-kit-file__label">{label}</span>
        {fileRef ? (
          <div className="project-part-kit-file__present">
            <code className="project-part-kit-file__name ui-mono">{fileRef.name}</code>
            {fileRef.source === "catalog" ? <span className="muted-copy">Catalog</span> : <span className="muted-copy">Project folder</span>}
          </div>
        ) : (
          <span className="muted-copy">No file yet</span>
        )}
      </div>
      {fileActions.length > 0 || previewHref ? (
        <div className="project-part-kit-file__actions">
          {fileActions.map((action) => (
            <a
              className="project-part-kit-file__open button-link button-link--quiet"
              href={action.href}
              key={action.label}
              rel="noreferrer"
              target="_blank"
            >
              {action.label}
            </a>
          ))}
          {previewHref ? (
            <Link className="button-link button-link--quiet" href={previewHref}>
              View 3D preview
            </Link>
          ) : null}
        </div>
      ) : null}
      {mirrorAvailable ? (
        <label className={`file-upload${disabled || status === "uploading" ? " file-upload--disabled" : ""}`}>
          <input
            aria-label={`Upload ${label} for ${suggestedMpn}`}
            className="file-upload__input"
            disabled={disabled || status === "uploading"}
            onChange={(event) => void onChange(event)}
            type="file"
          />
          <span className="button-link button-link--quiet">{fileRef ? "Change file" : "Add file"}</span>
        </label>
      ) : (
        <p className="muted-copy project-part-kit-file__mirror-off">Upload needs the project folder mirror configured in admin.</p>
      )}
      {message ? <p className={`project-part-kit-file__message${status === "error" ? " project-part-kit-file__status--error" : ""}`}>{message}</p> : null}
    </div>
  );
}

/**
 * Filters kits by search query across common fields.
 */
function filterKits(kits: ProjectPartKit[], rawQuery: string): ProjectPartKit[] {
  const query = rawQuery.trim().toLowerCase();

  if (!query) {
    return kits;
  }

  return kits.filter((kit) => {
    const haystack = [kit.mpn, kit.manufacturerName ?? "", kit.designators.join(" "), kit.note ?? "", kit.partUrl ?? ""]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

/**
 * Formats designator arrays for compact rows.
 */
function formatDesignators(designators: string[]): string {
  return designators.length > 0 ? designators.join(", ") : "No designators";
}
