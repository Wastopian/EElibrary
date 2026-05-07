"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { buildCompareUrl } from "../lib/api-client";

const MAX_PARTS = 4;

function parseCompareInput(value: string): string[] {
  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function CompareSelectionTray({ initialPartIds }: { initialPartIds: string[] }) {
  const router = useRouter();
  const [partIds, setPartIds] = React.useState<string[]>(initialPartIds);
  const [input, setInput] = React.useState("");
  const [warning, setWarning] = React.useState<string | null>(null);

  function syncToUrl(nextPartIds: string[]) {
    router.push(buildCompareUrl(nextPartIds));
  }

  function removePart(partId: string) {
    const next = partIds.filter((id) => id !== partId);
    setPartIds(next);
    setWarning(null);
    syncToUrl(next);
  }

  function addParts(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFromInput = parseCompareInput(input);
    if (nextFromInput.length === 0) {
      return;
    }

    const merged = [...new Set([...partIds, ...nextFromInput])];
    const capped = merged.slice(0, MAX_PARTS);
    if (merged.length > MAX_PARTS) {
      setWarning(`Compare supports up to ${MAX_PARTS} parts. Extra ids were ignored.`);
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
              <span className="ui-mono">{partId}</span> ×
            </button>
          ))
        ) : (
          <span className="muted-copy">No parts selected yet.</span>
        )}
      </div>
      <form className="compare-selection-tray__form" onSubmit={addParts}>
        <label htmlFor="compare-add-input">
          Add part id(s)
        </label>
        <input
          id="compare-add-input"
          onChange={(event) => setInput(event.target.value)}
          placeholder="part-id-1, part-id-2"
          value={input}
        />
        <button type="submit">Add</button>
      </form>
      {warning ? <p className="muted-copy">{warning}</p> : null}
    </section>
  );
}
