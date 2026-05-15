"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { buildCompareUrl, fetchPartSearch } from "../lib/api-client";
import { COMPARE_BASKET_STORAGE_KEY } from "./CompareAddLink";

const MAX_PARTS = 4;

// Internal part ids in this catalog use a stable `part-` prefix. Inputs without that prefix are
// treated as MPNs and resolved through the search API before being added to the basket.
const PART_ID_PREFIX = "part-";

/**
 * Mirrors the current basket into sessionStorage so part-detail "Compare with another part"
 * links can merge into the user's existing selection instead of replacing it. Best-effort:
 * a failed write (private mode, full storage) silently degrades to the previous URL-only behavior.
 */
function persistCompareBasket(partIds: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(COMPARE_BASKET_STORAGE_KEY, JSON.stringify(partIds));
  } catch {
    // Ignore storage failures -- the tray still works, cross-page merge just won't.
  }
}

function parseCompareInput(value: string): string[] {
  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Resolves one user-typed segment to a partId. UUID-shaped ids (prefix `part-`) pass through; an
 * MPN is resolved via the catalog search API, preferring an exact case-insensitive match. Returns
 * the resolved partId and a display MPN when known, or null when nothing matched.
 */
async function resolveCompareInput(segment: string): Promise<{ partId: string; mpn?: string } | null> {
  if (segment.toLowerCase().startsWith(PART_ID_PREFIX)) {
    return { partId: segment };
  }

  try {
    const results = await fetchPartSearch({ query: segment });
    const exact = results.find((record) => record.part.mpn.toLowerCase() === segment.toLowerCase());
    const chosen = exact ?? results[0];
    if (!chosen) return null;
    return { partId: chosen.part.id, mpn: chosen.part.mpn };
  } catch {
    return null;
  }
}

export interface CompareSelectionTrayProps {
  /** Part ids that should appear in the basket on mount, in the order they should display. */
  initialPartIds: string[];
  /** Optional partId -> MPN map for chip labels. Missing entries fall back to the raw partId. */
  initialPartLabels?: Record<string, string>;
}

export function CompareSelectionTray({ initialPartIds, initialPartLabels = {} }: CompareSelectionTrayProps) {
  const router = useRouter();
  const [partIds, setPartIds] = React.useState<string[]>(initialPartIds);
  const [labels, setLabels] = React.useState<Record<string, string>>(initialPartLabels);
  const [input, setInput] = React.useState("");
  const [warning, setWarning] = React.useState<string | null>(null);
  const [resolving, setResolving] = React.useState(false);

  // Mirror the server-rendered initial basket so part-detail links pick up state on first visit.
  React.useEffect(() => {
    persistCompareBasket(initialPartIds);
  }, [initialPartIds]);

  function syncToUrl(nextPartIds: string[]) {
    persistCompareBasket(nextPartIds);
    router.push(buildCompareUrl(nextPartIds));
  }

  function removePart(partId: string) {
    const next = partIds.filter((id) => id !== partId);
    setPartIds(next);
    setWarning(null);
    syncToUrl(next);
  }

  async function addParts(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const segments = parseCompareInput(input);
    if (segments.length === 0) {
      return;
    }

    setResolving(true);
    try {
      const resolved = await Promise.all(segments.map((segment) => resolveCompareInput(segment).then((result) => ({ segment, result }))));

      const unresolved = resolved.filter((entry) => entry.result === null).map((entry) => entry.segment);
      const newIds = resolved
        .filter((entry): entry is { segment: string; result: { partId: string; mpn?: string } } => entry.result !== null)
        .map((entry) => entry.result.partId);

      const nextLabels = { ...labels };
      for (const entry of resolved) {
        if (entry.result?.mpn) {
          nextLabels[entry.result.partId] = entry.result.mpn;
        }
      }

      const merged = [...new Set([...partIds, ...newIds])];
      const capped = merged.slice(0, MAX_PARTS);

      const warnings: string[] = [];
      if (unresolved.length > 0) {
        warnings.push(`No catalog match for: ${unresolved.join(", ")}.`);
      }
      if (merged.length > MAX_PARTS) {
        warnings.push(`Compare supports up to ${MAX_PARTS} parts. Extra ids were ignored.`);
      }
      setWarning(warnings.length > 0 ? warnings.join(" ") : null);

      setPartIds(capped);
      setLabels(nextLabels);
      setInput("");
      if (capped.length !== partIds.length) {
        syncToUrl(capped);
      }
    } finally {
      setResolving(false);
    }
  }

  return (
    <section aria-label="Compare selection" className="compare-selection-tray">
      <div className="compare-selection-tray__header">
        <strong>Compare selection</strong>
        <span className="muted-copy">{partIds.length} / {MAX_PARTS} selected</span>
      </div>
      <div className="compare-selection-tray__chips">
        {partIds.length > 0 ? (
          partIds.map((partId) => {
            const label = labels[partId] ?? partId;
            return (
              <button
                aria-label={`Remove ${label} from compare`}
                className="button-link button-link--quiet"
                key={partId}
                onClick={() => removePart(partId)}
                type="button"
                title={partId}
              >
                <span className="ui-mono">{label}</span> ×
              </button>
            );
          })
        ) : (
          <span className="muted-copy">No parts selected yet.</span>
        )}
      </div>
      <form className="compare-selection-tray__form" onSubmit={addParts}>
        <label htmlFor="compare-add-input">
          Add by MPN or part id
        </label>
        <input
          id="compare-add-input"
          onChange={(event) => setInput(event.target.value)}
          placeholder="e.g. 215079-8 or part-te-215079-8"
          value={input}
        />
        <button disabled={resolving} type="submit">
          {resolving ? "Resolving…" : "Add parts"}
        </button>
      </form>
      {warning ? <p className="muted-copy">{warning}</p> : null}
    </section>
  );
}
