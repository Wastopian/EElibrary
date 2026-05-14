/**
 * File header: Client-side panel that instantiates a reusable circuit block into a project BOM.
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import { fetchCircuitBlocks, instantiateCircuitBlockIntoBom, isApiClientError } from "../lib/api-client";
import { getCircuitBlockReuseHeadline } from "../lib/circuit-block-reuse-readiness";
import type { BadgeTone } from "@ee-library/ui";
import type { CircuitBlockReuseHeadline } from "../lib/circuit-block-reuse-readiness";
import type {
  CircuitBlockInstantiationCreateResponse,
  CircuitBlockSummary,
  ProjectRevision
} from "@ee-library/shared/types";

/** CircuitBlockInstantiationPanelProps scopes instantiation to one project. */
export interface CircuitBlockInstantiationPanelProps {
  projectId: string;
  revisions: ProjectRevision[];
}

type LibraryState =
  | { kind: "loading" }
  | { kind: "loaded"; blocks: CircuitBlockSummary[] }
  | { kind: "failed"; message: string };

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; data: CircuitBlockInstantiationCreateResponse }
  | { kind: "failed"; message: string };

/**
 * Renders the circuit-block library selector and instantiation form.
 */
export function CircuitBlockInstantiationPanel({
  projectId,
  revisions
}: CircuitBlockInstantiationPanelProps): React.ReactElement {
  const [libraryState, setLibraryState] = useState<LibraryState>({ kind: "loading" });
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [selectedBlockId, setSelectedBlockId] = useState<string>("");
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>(revisions[0]?.id ?? "");
  const [includeOptional, setIncludeOptional] = useState(false);
  const [designatorPrefix, setDesignatorPrefix] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [filterText, setFilterText] = useState<string>("");
  const [hideBlocked, setHideBlocked] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchCircuitBlocks();
        if (cancelled) return;
        setLibraryState({ kind: "loaded", blocks: list.circuitBlocks });
      } catch (error) {
        if (cancelled) return;
        const message = isApiClientError(error)
          ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
          : "Circuit block library fetch failed.";
        setLibraryState({ kind: "failed", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const blockEntries = useMemo(() => {
    if (libraryState.kind !== "loaded") return [] as Array<{ summary: CircuitBlockSummary; headline: CircuitBlockReuseHeadline }>;
    return libraryState.blocks.map((summary) => ({ headline: getCircuitBlockReuseHeadline(summary), summary }));
  }, [libraryState]);

  const filteredBlockEntries = useMemo(() => {
    const trimmedText = filterText.trim().toLowerCase();
    return blockEntries.filter(({ summary, headline }) => {
      if (hideBlocked && headline.state === "blocked") return false;
      if (trimmedText.length === 0) return true;
      const haystack = [
        summary.circuitBlock.blockKey,
        summary.circuitBlock.name,
        summary.circuitBlock.description,
        summary.circuitBlock.reuseScope,
        summary.circuitBlock.owner ?? ""
      ]
        .join(" \u0001 ")
        .toLowerCase();
      return haystack.includes(trimmedText);
    });
  }, [blockEntries, filterText, hideBlocked]);

  const selectedEntry = useMemo(() => {
    return blockEntries.find((entry) => entry.summary.circuitBlock.id === selectedBlockId) ?? null;
  }, [blockEntries, selectedBlockId]);

  const selectedBlock = selectedEntry?.summary ?? null;

  const handleSubmit = async (): Promise<void> => {
    if (!selectedBlockId || !selectedRevisionId) return;
    setSubmitState({ kind: "submitting" });
    try {
      const data = await instantiateCircuitBlockIntoBom(projectId, {
        circuitBlockId: selectedBlockId,
        designatorPrefix: designatorPrefix.trim() || null,
        includeOptional,
        notes: notes.trim() || null,
        projectRevisionId: selectedRevisionId
      });
      setSubmitState({ kind: "success", data });
    } catch (error) {
      const message = isApiClientError(error)
        ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
        : "Circuit block instantiation failed.";
      setSubmitState({ kind: "failed", message });
    }
  };

  if (revisions.length === 0) {
    return (
      <EmptyState
        title="Project has no revisions"
        body="Create a project revision before instantiating a circuit block into the BOM."
      />
    );
  }

  if (libraryState.kind === "loading") {
    return <p className="form-hint">Loading circuit block library…</p>;
  }

  if (libraryState.kind === "failed") {
    return <div className="form-feedback form-feedback--error">{libraryState.message}</div>;
  }

  if (libraryState.blocks.length === 0) {
    return (
      <EmptyState
        title="No circuit blocks yet"
        body="Create a reusable circuit block in the library before instantiating it into a project BOM."
      />
    );
  }

  return (
    <div className="circuit-block-instantiation-panel">
      <p className="form-hint">
        Generates a synthetic BOM import for the selected revision with one matched line per block-part role.
        Required parts are always included. Toggle includeOptional to also instantiate optional parts.
        This does not change part approval, readiness, or export verification.
      </p>

      <div className="form-row form-row--inline">
        <label className="form-label" htmlFor="instantiation-filter-text">Filter library</label>
        <input
          className="form-input"
          id="instantiation-filter-text"
          placeholder="search by name, key, owner, or scope"
          type="search"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <label className="checkbox-label">
          <input
            checked={hideBlocked}
            type="checkbox"
            onChange={(e) => setHideBlocked(e.target.checked)}
          />
          {" "}Hide blocked
        </label>
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="instantiation-block">Circuit block</label>
        <select
          className="form-select"
          id="instantiation-block"
          value={selectedBlockId}
          onChange={(e) => {
            setSelectedBlockId(e.target.value);
            setSubmitState({ kind: "idle" });
          }}
        >
          <option value="">Select a circuit block…</option>
          {filteredBlockEntries.map(({ summary, headline }) => (
            <option key={summary.circuitBlock.id} value={summary.circuitBlock.id}>
              [{formatReuseStateLabel(headline.state)}] {summary.circuitBlock.name} ({summary.circuitBlock.blockKey}) — {summary.requiredPartCount} required, {summary.optionalPartCount} optional
            </option>
          ))}
        </select>
        {filteredBlockEntries.length === 0 && (
          <small className="form-hint">
            No blocks match the current filter. {hideBlocked ? "Try unchecking \u201cHide blocked\u201d or " : ""}Clear the search to see the full library.
          </small>
        )}
        {selectedEntry && (
          <div className="instantiation-panel__verdict">
            <StatusBadge label={selectedEntry.headline.label} tone={headlineToneToBadge(selectedEntry.headline.tone)} />
            <span className="form-hint">{selectedEntry.headline.detail}</span>
          </div>
        )}
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="instantiation-revision">Project revision</label>
        <select
          className="form-select"
          id="instantiation-revision"
          value={selectedRevisionId}
          onChange={(e) => {
            setSelectedRevisionId(e.target.value);
            setSubmitState({ kind: "idle" });
          }}
        >
          {revisions.map((revision) => (
            <option key={revision.id} value={revision.id}>
              {revision.revisionLabel} — {revision.revisionStatus}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="instantiation-prefix">Designator prefix (optional)</label>
        <input
          className="form-input"
          id="instantiation-prefix"
          maxLength={16}
          placeholder="U, R, C, J…"
          value={designatorPrefix}
          onChange={(e) => setDesignatorPrefix(e.target.value)}
        />
        <small className="form-hint">When set, designators are auto-numbered per quantity (e.g. U1, U2, U3).</small>
      </div>

      <div className="form-row">
        <label className="checkbox-label">
          <input
            checked={includeOptional}
            type="checkbox"
            onChange={(e) => setIncludeOptional(e.target.checked)}
          />
          {" "}Include optional block parts
        </label>
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="instantiation-notes">Notes (optional)</label>
        <textarea
          className="form-textarea"
          id="instantiation-notes"
          maxLength={500}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="form-actions">
        <button
          className="button button--primary"
          disabled={!selectedBlockId || !selectedRevisionId || submitState.kind === "submitting"}
          type="button"
          onClick={handleSubmit}
        >
          {submitState.kind === "submitting" ? "Instantiating…" : "Add circuit block to BOM"}
        </button>
      </div>

      {selectedBlock && (
        <div className="form-hint">
          Selected: <strong>{selectedBlock.circuitBlock.name}</strong>
          {" — "}
          {includeOptional
            ? `${selectedBlock.totalPartCount} part role${selectedBlock.totalPartCount === 1 ? "" : "s"} will be instantiated`
            : `${selectedBlock.requiredPartCount} required part role${selectedBlock.requiredPartCount === 1 ? "" : "s"} will be instantiated`}
        </div>
      )}

      {submitState.kind === "failed" && (
        <div className="form-feedback form-feedback--error">{submitState.message}</div>
      )}

      {submitState.kind === "success" && (
        <div className="form-feedback form-feedback--success">
          <p>
            Created BOM import {submitState.data.bomImport.sourceFilename}: {submitState.data.matchedLineCount} matched line
            {submitState.data.matchedLineCount === 1 ? "" : "s"}.
            {submitState.data.skippedOptionalCount > 0 && ` ${submitState.data.skippedOptionalCount} optional role${submitState.data.skippedOptionalCount === 1 ? "" : "s"} skipped.`}
          </p>
          <p className="form-hint">{submitState.data.boundary}</p>
          <p>
            <StatusBadge label="Refresh project detail" tone="info" /> to see the new BOM import, lines, and confirmed usage rows.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Maps the reuse-headline state onto a short scan label for the select option prefix.
 */
function formatReuseStateLabel(state: CircuitBlockReuseHeadline["state"]): string {
  switch (state) {
    case "reusable":
      return "READY";
    case "pending":
      return "PENDING";
    case "blocked":
      return "BLOCKED";
    case "not_applicable":
      return "DEPRECATED";
    default:
      return state;
  }
}

/**
 * Maps the reuse-headline `ViewTone` onto a `BadgeTone` accepted by StatusBadge.
 */
function headlineToneToBadge(tone: CircuitBlockReuseHeadline["tone"]): BadgeTone {
  if (tone === "generated") return "info";
  return tone;
}
