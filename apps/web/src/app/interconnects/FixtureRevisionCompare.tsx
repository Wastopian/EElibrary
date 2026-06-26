"use client";

/**
 * File header: Client section for comparing two revisions of one test fixture.
 *
 * Fetches the fixture's sibling revisions, lets the engineer pick one, and renders the port
 * differences in plain language. Honesty boundary: a clean (or any) diff is recorded-memory
 * context only — it never approves a part, validates an asset, proves a bench setup is safe,
 * or unlocks export.
 */

import React, { useEffect, useState } from "react";
import { fetchFixtureRevisionCompare, fetchTestFixtureRevisions, isApiClientError } from "../../lib/api-client";
import type { FixtureRevisionCompareResponse, InterconnectRevisionSummary } from "@ee-library/shared/types";

/** FixtureRevisionCompareProps scopes the section to one fixture. */
export interface FixtureRevisionCompareProps {
  fixtureId: string;
  fixtureKey: string;
  currentRevisionLabel: string;
}

/** LoadState tracks the sibling-revision load. */
type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; others: InterconnectRevisionSummary[] }
  | { kind: "failed"; message: string };

/** CompareState tracks the diff fetch. */
type CompareState =
  | { kind: "idle" }
  | { kind: "comparing" }
  | { kind: "ready"; compare: FixtureRevisionCompareResponse }
  | { kind: "failed"; message: string };

/** Renders the fixture revision compare section. */
export function FixtureRevisionCompare({ fixtureId, fixtureKey, currentRevisionLabel }: FixtureRevisionCompareProps): React.ReactElement {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [against, setAgainst] = useState("");
  const [compareState, setCompareState] = useState<CompareState>({ kind: "idle" });

  useEffect(() => {
    let active = true;
    fetchTestFixtureRevisions(fixtureId)
      .then((response) => {
        if (!active) return;
        const others = response.revisions.filter((revision) => revision.id !== fixtureId);
        setLoad({ kind: "ready", others });
        if (others[0]) setAgainst(others[0].id);
      })
      .catch((error) => {
        if (!active) return;
        setLoad({ kind: "failed", message: isApiClientError(error) ? error.message : "Could not load other revisions." });
      });
    return () => {
      active = false;
    };
  }, [fixtureId]);

  async function onCompare(): Promise<void> {
    if (!against) return;
    setCompareState({ kind: "comparing" });
    try {
      const compare = await fetchFixtureRevisionCompare(fixtureId, against);
      setCompareState({ kind: "ready", compare });
    } catch (error) {
      setCompareState({ kind: "failed", message: isApiClientError(error) ? error.message : "Could not compare revisions." });
    }
  }

  return (
    <section className="cable-editor__section">
      <h2>Compare revisions</h2>
      <p className="muted-copy">See what changed between this revision and another revision of <span className="ui-mono">{fixtureKey}</span>.</p>

      {load.kind === "loading" ? <p className="muted-copy">Loading other revisions…</p> : null}
      {load.kind === "failed" ? <p className="cable-form__error" role="alert">{load.message}</p> : null}
      {load.kind === "ready" && load.others.length === 0 ? (
        <p className="muted-copy">No other revisions of {fixtureKey} to compare yet. Create another revision to compare against.</p>
      ) : null}

      {load.kind === "ready" && load.others.length > 0 ? (
        <div className="cable-form cable-form--inline">
          <div className="cable-compare__controls">
            <label className="cable-form__field">
              <span>Compare {fixtureKey} {currentRevisionLabel} against</span>
              <select onChange={(event) => setAgainst(event.target.value)} value={against}>
                {load.others.map((revision) => (
                  <option key={revision.id} value={revision.id}>{revision.revisionLabel} ({revision.status.replace(/_/gu, " ")})</option>
                ))}
              </select>
            </label>
            <button className="button-primary" disabled={compareState.kind === "comparing"} onClick={onCompare} type="button">
              {compareState.kind === "comparing" ? "Comparing…" : "Compare"}
            </button>
          </div>
        </div>
      ) : null}

      {compareState.kind === "failed" ? <p className="cable-form__error" role="alert">{compareState.message}</p> : null}
      {compareState.kind === "ready" ? <CompareResult compare={compareState.compare} /> : null}
    </section>
  );
}

/** Renders the diff outcome for one revision comparison. */
function CompareResult({ compare }: { compare: FixtureRevisionCompareResponse }): React.ReactElement {
  return (
    <div className="cable-compare__result">
      <p className="cable-compare__headline">
        <strong>{compare.fixtureKey} {compare.baseRevisionLabel} → {compare.targetRevisionLabel}</strong>
        {" — "}
        Ports: +{compare.portSummary.added} −{compare.portSummary.removed} ~{compare.portSummary.changed} ({compare.portSummary.unchanged} unchanged)
      </p>

      {compare.portDiffs.length === 0 ? <p className="muted-copy">No port differences between these revisions.</p> : (
        <div className="cable-compare__group">
          <h3>Ports</h3>
          <ul className="cable-editor__list">
            {compare.portDiffs.map((diff) => (
              <li className="cable-editor__list-row" key={`port-${diff.connectorRef}`}>
                <div>
                  <span className="ui-mono">{diff.connectorRef}</span>
                  <p className="muted-copy">{describeChanges(diff.kind, diff.changes)}</p>
                </div>
                <DiffBadge kind={diff.kind} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="cable-editor__footnote">{compare.boundary}</p>
    </div>
  );
}

/** Renders a small added/removed/changed badge. */
function DiffBadge({ kind }: { kind: "added" | "removed" | "changed" }): React.ReactElement {
  const label = kind === "added" ? "Added" : kind === "removed" ? "Removed" : "Changed";
  return <span className={`cable-compare__badge cable-compare__badge--${kind}`}>{label}</span>;
}

/** Formats a diff's field changes (or add/remove) into one plain line. */
function describeChanges(kind: "added" | "removed" | "changed", changes: { field: string; from: string | null; to: string | null }[]): string {
  if (kind === "added") return "Added in the newer revision.";
  if (kind === "removed") return "Removed in the newer revision.";
  if (changes.length === 0) return "Changed.";
  return changes.map((change) => `${change.field}: ${change.from ?? "—"} → ${change.to ?? "—"}`).join(" · ");
}
