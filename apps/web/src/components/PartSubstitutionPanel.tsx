/**
 * File header: Client-side panel that lets engineers add, view, and revoke approved part substitutions.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { EmptyState, StatusBadge } from "@ee-library/ui";
import {
  createPartSubstitution,
  fetchPartSubstitutions,
  isApiClientError,
  revokePartSubstitution
} from "../lib/api-client";
import type {
  PartSubstitutionListResponse,
  PartSubstitutionScope,
  PartSubstitutionSummary
} from "@ee-library/shared/types";

/** PartSubstitutionPanelProps scopes substitution management to one catalog part. */
export interface PartSubstitutionPanelProps {
  partId: string;
  partMpn: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; data: PartSubstitutionListResponse }
  | { kind: "failed"; message: string };

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "failed"; message: string };

/**
 * Renders existing substitutions and a create form for one part.
 */
export function PartSubstitutionPanel({ partId, partMpn }: PartSubstitutionPanelProps): React.ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [substitutePartId, setSubstitutePartId] = useState<string>("");
  const [scope, setScope] = useState<PartSubstitutionScope>("global");
  const [projectId, setProjectId] = useState<string>("");
  const [signoffNotes, setSignoffNotes] = useState<string>("");

  const reload = useCallback(async () => {
    try {
      const data = await fetchPartSubstitutions(partId);
      setLoadState({ kind: "loaded", data });
    } catch (error) {
      const message = isApiClientError(error)
        ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
        : "Substitution list fetch failed.";
      setLoadState({ kind: "failed", message });
    }
  }, [partId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = useCallback(async () => {
    if (!substitutePartId.trim()) {
      setSubmitState({ kind: "failed", message: "Enter the substitute part id (catalog id)." });
      return;
    }
    if (scope === "project" && !projectId.trim()) {
      setSubmitState({ kind: "failed", message: "Enter the project id for project-scoped substitutions." });
      return;
    }
    setSubmitState({ kind: "submitting" });
    try {
      const result = await createPartSubstitution(partId, {
        projectId: scope === "project" ? projectId.trim() : null,
        scope,
        signoffNotes: signoffNotes.trim() || null,
        substitutePartId: substitutePartId.trim()
      });
      setSubmitState({
        kind: "success",
        message: `Substitution recorded: ${result.substitution.substitutePartMpn} approved as alternate for ${partMpn}.`
      });
      setSubstitutePartId("");
      setSignoffNotes("");
      setProjectId("");
      await reload();
    } catch (error) {
      const message = isApiClientError(error)
        ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
        : "Substitution create failed.";
      setSubmitState({ kind: "failed", message });
    }
  }, [partId, partMpn, projectId, reload, scope, signoffNotes, substitutePartId]);

  const onRevoke = useCallback(
    async (summary: PartSubstitutionSummary) => {
      try {
        await revokePartSubstitution(summary.substitution.id);
        await reload();
      } catch (error) {
        const message = isApiClientError(error)
          ? error.message.replace(/^.*failed \([^)]+\):\s*/u, "")
          : "Substitution revoke failed.";
        setSubmitState({ kind: "failed", message });
      }
    },
    [reload]
  );

  return (
    <div className="part-substitution-panel">
      <p className="form-hint">
        Approved substitutions are signed-off engineering decision records. They do not change part approval, validation, lifecycle, or export readiness.
      </p>

      <div className="part-substitution-panel__form">
        <h4 className="form-section-label">Add approved substitute</h4>
        <p className="form-hint">Fill in why this alternate is acceptable so future reviewers can trust the decision quickly.</p>

        <div className="form-row">
          <label className="form-label" htmlFor="substitution-substitute">Substitute part id</label>
          <input
            className="form-input"
            id="substitution-substitute"
            placeholder="e.g. part-stm32g031k8t6"
            value={substitutePartId}
            onChange={(e) => setSubstitutePartId(e.target.value)}
          />
          <small className="form-hint">Use the internal catalog part id of the alternate. Both parts must already exist in the catalog.</small>
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="substitution-scope">Scope</label>
          <select
            className="form-select"
            id="substitution-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as PartSubstitutionScope)}
          >
            <option value="global">Global - any project may substitute</option>
            <option value="project">Project - only one specific project</option>
          </select>
        </div>

        {scope === "project" && (
          <div className="form-row">
            <label className="form-label" htmlFor="substitution-project">Project id</label>
            <input
              className="form-input"
              id="substitution-project"
              placeholder="e.g. project-alpha"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            />
          </div>
        )}

        <div className="form-row">
          <label className="form-label" htmlFor="substitution-notes">Sign-off notes</label>
          <textarea
            className="form-textarea form-textarea--notes"
            id="substitution-notes"
            maxLength={500}
            placeholder="State the reason plainly: fit, performance match, tests passed, and any limits."
            rows={6}
            value={signoffNotes}
            onChange={(e) => setSignoffNotes(e.target.value)}
          />
          <small className="form-hint">Tip: include evidence source or test ID so anyone can verify later.</small>
        </div>

        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={submitState.kind === "submitting"}
            type="button"
            onClick={submit}
          >
            {submitState.kind === "submitting" ? "Saving…" : "Add approved substitute"}
          </button>
        </div>

        {submitState.kind === "failed" && (
          <div className="form-feedback form-feedback--error">{submitState.message}</div>
        )}
        {submitState.kind === "success" && (
          <div className="form-feedback form-feedback--success">{submitState.message}</div>
        )}
      </div>

      {loadState.kind === "loading" && <p className="form-hint">Loading substitution history…</p>}
      {loadState.kind === "failed" && (
        <div className="form-feedback form-feedback--error">{loadState.message}</div>
      )}
      {loadState.kind === "loaded" && (
        <SubstitutionHistory data={loadState.data} partId={partId} onRevoke={onRevoke} />
      )}
    </div>
  );
}

function SubstitutionHistory({
  data,
  onRevoke,
  partId
}: {
  data: PartSubstitutionListResponse;
  onRevoke: (summary: PartSubstitutionSummary) => Promise<void>;
  partId: string;
}): React.ReactElement {
  return (
    <div className="part-substitution-history">
      <h4 className="form-section-label">Active approved substitutes</h4>
      {data.active.length === 0 ? (
        <EmptyState
          title="No active substitutes"
          body="No approved substitutions are currently recorded for this part."
        />
      ) : (
        <SubstitutionTable rows={data.active} partId={partId} onRevoke={onRevoke} showRevoke />
      )}

      {data.revoked.length > 0 && (
        <>
          <h4 className="form-section-label">Revoked substitutions (history)</h4>
          <SubstitutionTable rows={data.revoked} partId={partId} showRevoke={false} />
        </>
      )}
    </div>
  );
}

function SubstitutionTable({
  onRevoke,
  partId,
  rows,
  showRevoke
}: {
  onRevoke?: (summary: PartSubstitutionSummary) => Promise<void>;
  partId: string;
  rows: PartSubstitutionSummary[];
  showRevoke: boolean;
}): React.ReactElement {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Direction</th>
          <th>Counterpart</th>
          <th>Scope</th>
          <th>Approved by</th>
          <th>Sign-off notes</th>
          <th>{showRevoke ? "Action" : "Revoked"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((summary) => {
          const isOriginalSide = summary.substitution.originalPartId === partId;
          const counterpartMpn = isOriginalSide ? summary.substitutePartMpn : summary.originalPartMpn;
          const counterpartManufacturer = isOriginalSide ? summary.substituteManufacturerName : summary.originalManufacturerName;
          return (
            <tr key={summary.substitution.id}>
              <td>
                <StatusBadge
                  label={isOriginalSide ? "this -> alternate" : "alternate -> this"}
                  tone={isOriginalSide ? "info" : "review"}
                />
              </td>
              <td className="ui-mono">
                {counterpartMpn} <span className="text-muted">({counterpartManufacturer})</span>
              </td>
              <td>
                <StatusBadge
                  label={summary.substitution.scope === "global" ? "Global" : `Project: ${summary.projectName ?? summary.substitution.projectId ?? "-"}`}
                  tone={summary.substitution.scope === "global" ? "verified" : "info"}
                />
              </td>
              <td>{summary.substitution.approvedBy}</td>
              <td className="text-truncate">{summary.substitution.signoffNotes || <span className="text-muted">-</span>}</td>
              <td>
                {showRevoke && onRevoke ? (
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => {
                      void onRevoke(summary);
                    }}
                  >
                    Revoke
                  </button>
                ) : (
                  <span className="text-muted">
                    {summary.substitution.revokedBy ?? "-"}
                    {summary.substitution.revokedAt ? ` on ${new Date(summary.substitution.revokedAt).toLocaleDateString()}` : ""}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

