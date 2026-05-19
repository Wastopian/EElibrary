"use client";

/**
 * File header: Client-side tray for adding and removing compare identifiers.
 */

import React from "react";
import { useRouter } from "next/navigation";
import { buildCompareUrl } from "../lib/api-client";

const MAX_PARTS = 4;

/**
 * Parses comma-separated MPNs or internal part ids from the add-parts field.
 */
function parseCompareInput(value: string): string[] {
  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Renders compare selection controls and syncs the selected identifiers into the URL.
 */
export function CompareSelectionTray({ initialPartIds }: { initialPartIds: string[] }) {
  const router = useRouter();
  const [partIds, setPartIds] = React.useState<string[]>(initialPartIds);
  const [input, setInput] = React.useState("");
  const [warning, setWarning] = React.useState<string | null>(null);

  /**
   * Pushes the compare token list to the route so the server loader can resolve ids or exact MPNs.
   */
  function syncToUrl(nextPartIds: string[]) {
    router.push(buildCompareUrl(nextPartIds));
  }

  /**
   * Removes one selected compare token from both local state and the URL.
   */
  function removePart(partId: string) {
    const next = partIds.filter((id) => id !== partId);
    setPartIds(next);
    setWarning(null);
    syncToUrl(next);
  }

  /**
   * Adds comma-separated MPN/id tokens while enforcing the compare limit before navigation.
   */
  function addParts(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFromInput = parseCompareInput(input);
    if (nextFromInput.length === 0) {
      return;
    }

    const merged = [...new Set([...partIds, ...nextFromInput])];
    const capped = merged.slice(0, MAX_PARTS);
    if (merged.length > MAX_PARTS) {
      setWarning(`Compare supports up to ${MAX_PARTS} parts. Extra entries were ignored.`);
    } else {
      setWarning(null);
    }
    setPartIds(capped);
    setInput("");
    syncToUrl(capped);
  }

  return (
    <section aria-label="Compare selection" className="compare-selection-tray">
      <div className="compare-selection-tray__header">
        <strong>Compare selection</strong>
        <span className="muted-copy">{partIds.length} / {MAX_PARTS} selected</span>
      </div>
      <div className="compare-selection-tray__chips">
        {partIds.length > 0 ? (
          partIds.map((partId) => (
            <button
              aria-label={`Remove ${partId} from compare`}
              className="button-link button-link--quiet"
              key={partId}
              onClick={() => removePart(partId)}
              type="button"
            >
              <span className="ui-mono">{partId}</span> <span aria-hidden="true">&times;</span>
            </button>
          ))
        ) : (
          <span className="muted-copy">No parts selected yet.</span>
        )}
      </div>
      <form className="compare-selection-tray__form" onSubmit={addParts}>
        <label htmlFor="compare-add-input">
          Add MPNs or part IDs
        </label>
        <input
          id="compare-add-input"
          onChange={(event) => setInput(event.target.value)}
          placeholder="215079-8, TPS7A02DBVR, part-id"
          value={input}
        />
        <button type="submit">Add parts</button>
      </form>
      {warning ? <p className="muted-copy">{warning}</p> : null}
    </section>
  );
}
