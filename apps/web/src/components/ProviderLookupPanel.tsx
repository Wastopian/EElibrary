/**
 * File header: Explicit client-side provider candidate lookup plus selected-candidate import intake for DB-backed no-match states.
 */

"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import {
  fetchProviderAcquisitionJob,
  isApiClientError,
  requestProviderAcquisitionJob,
  requestProviderImport,
  requestProviderLookup
} from "../lib/api-client";
import { importUiCopy } from "../lib/import-ui-copy";
import { resolveImportFailureState, resolveImportSuccessAction, type ImportPanelSuccessAction } from "./ImportByMpnPanel";
import type {
  ProviderAcquisitionJobCreateInput,
  ProviderAcquisitionJobDetailResponse,
  ProviderImportCreateInput,
  ProviderLookupCandidate
} from "@ee-library/shared/types";

/** ProviderLookupPanelProps carries the no-match lookup text, import mode, and refresh target from catalog surfaces. */
export interface ProviderLookupPanelProps {
  /** Concrete lookup text from the homepage quick-search field. */
  initialQuery: string;
  /** Selects direct import for catalog no-match UX or durable queue intake for worker-backed flows. */
  importMode?: ProviderLookupImportMode;
  /** Search href used when a successful import should rerun the current catalog query. */
  refreshHref: string;
}

/** ProviderLookupImportMode controls whether a candidate imports now or enters the worker queue. */
export type ProviderLookupImportMode = "direct" | "queue";

/** ProviderLookupPanelState keeps the explicit provider-lookup workflow honest and click-driven. */
type ProviderLookupPanelState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "candidates"; candidates: ProviderLookupCandidate[] }
  | { kind: "no_candidates" }
  | { kind: "failed"; message: string };

/** CandidateAcquisitionState keeps the selected provider candidate import state explicit and testable. */
export type CandidateAcquisitionState =
  | { kind: "idle" }
  | { kind: "creating"; candidateKey: string }
  | { kind: "queued"; candidateKey: string; detail: ProviderAcquisitionJobDetailResponse }
  | { kind: "running"; candidateKey: string; detail: ProviderAcquisitionJobDetailResponse }
  | { kind: "succeeded"; candidateKey: string; detail?: ProviderAcquisitionJobDetailResponse; action: ImportPanelSuccessAction }
  | { kind: "failed"; candidateKey: string; detail?: ProviderAcquisitionJobDetailResponse; message: string }
  | { kind: "unavailable"; candidateKey: string; message: string };

/** ProviderLookupPanelViewProps carries the pure rendered panel state so tests can verify multi-candidate locking without browser-only hooks. */
export interface ProviderLookupPanelViewProps {
  /** Current lookup-panel state. */
  status: ProviderLookupPanelState;
  /** Current selected-candidate import state. */
  acquisitionState: CandidateAcquisitionState;
  /** Import behavior used by the rendered candidate action button. */
  importMode?: ProviderLookupImportMode;
  /** Runs explicit provider lookup from the no-match panel. */
  onRunLookup: () => void;
  /** Queues one selected provider candidate for acquisition when the worker-backed flow is active. */
  onQueueAcquisition: (candidate: ProviderLookupCandidate) => void;
  /** Imports one selected provider candidate immediately when the catalog surface is in direct mode. */
  onRunDirectImport?: (candidate: ProviderLookupCandidate) => void;
}

/** ProviderLookupCandidateCardProps carries one candidate row plus the current acquisition state for that row. */
interface ProviderLookupCandidateCardProps {
  /** Provider-neutral exact-match candidate row. */
  candidate: ProviderLookupCandidate;
  /** Current acquisition state for the candidate, if any. */
  acquisitionState: CandidateAcquisitionState;
  /** Import behavior used by this candidate action button. */
  importMode: ProviderLookupImportMode;
  /** True when any candidate in the current lookup result set already has an active pending job. */
  hasPendingAcquisition: boolean;
  /** True when this candidate currently owns the active pending job slot. */
  isActivePendingCandidate: boolean;
  /** Runs the current provider-candidate import action for the selected candidate. */
  onRunCandidateImport: (candidate: ProviderLookupCandidate) => void;
}

/** ProviderLookupCandidateJobStatusProps isolates candidate import status rendering for focused status tests. */
interface ProviderLookupCandidateJobStatusProps {
  /** Current acquisition state for one selected candidate. */
  state: CandidateAcquisitionState;
  /** Import behavior used by this candidate action button. */
  importMode?: ProviderLookupImportMode;
}

/**
 * Builds the admin-facing provider acquisition job body from one selected exact-match provider candidate.
 */
export function buildProviderAcquisitionJobCreateInput(
  candidate: ProviderLookupCandidate,
  requestedLookup: string
): ProviderAcquisitionJobCreateInput {
  return {
    manufacturerName: candidate.manufacturerName,
    matchConfidence: candidate.matchConfidence,
    matchType: candidate.matchType,
    mpn: candidate.mpn,
    package: candidate.package,
    providerId: candidate.providerId,
    providerPartKey: candidate.providerPartKey,
    requestedLookup,
    sourceUrl: candidate.sourceUrl
  };
}

/**
 * Builds the direct provider import body from one selected exact-match provider candidate.
 */
export function buildProviderCandidateImportInput(candidate: ProviderLookupCandidate): ProviderImportCreateInput {
  return {
    datasheetUrl: null,
    manufacturerName: candidate.manufacturerName,
    mpn: candidate.mpn,
    providerId: candidate.providerId,
    providerPartId: candidate.providerPartKey,
    providerUrl: candidate.sourceUrl
  };
}

/**
 * Maps request-level acquisition failures into explicit failed vs unavailable UI states.
 */
export function resolveProviderAcquisitionRequestFailure(
  candidateKey: string,
  error: unknown
): CandidateAcquisitionState {
  if (!isApiClientError(error)) {
    return {
      candidateKey,
      kind: "failed",
      message: importUiCopy.providerAcquisitionFailed
    };
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return {
      candidateKey,
      kind: "unavailable",
      message: importUiCopy.catalogAcquisitionUnavailableSession
    };
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return {
      candidateKey,
      kind: "unavailable",
      message: importUiCopy.catalogAcquisitionUnavailableDatabase
    };
  }

  if (error.code === "UNKNOWN_PROVIDER") {
    return {
      candidateKey,
      kind: "unavailable",
      message: importUiCopy.catalogAcquisitionUnavailableProvider
    };
  }

  return {
    candidateKey,
    kind: "failed",
    message: stripProviderAcquisitionFailurePrefix(error.message)
  };
}

/**
 * Maps one polled provider acquisition job into a clear queued/running/succeeded/failed UI state.
 */
export function resolveProviderAcquisitionTrackingState(
  candidateKey: string,
  detail: ProviderAcquisitionJobDetailResponse,
  refreshHref: string
): CandidateAcquisitionState {
  if (detail.job.jobStatus === "queued") {
    return { candidateKey, detail, kind: "queued" };
  }

  if (detail.job.jobStatus === "running") {
    return { candidateKey, detail, kind: "running" };
  }

  if (detail.job.jobStatus === "failed") {
    return {
      candidateKey,
      detail,
      kind: "failed",
      message: detail.job.errorMessage?.trim() || importUiCopy.providerAcquisitionFailed
    };
  }

  return {
    action: resolveImportSuccessAction({
      partId: detail.job.partId,
      refreshHref
    }),
    candidateKey,
    detail,
    kind: "succeeded"
  };
}

/**
 * Returns whether the queue-acquisition button must stay disabled for the current candidate state.
 */
export function isQueueAcquisitionButtonDisabled(
  importAllowed: boolean,
  acquisitionState: CandidateAcquisitionState,
  hasPendingAcquisition = isPendingCandidateAcquisition(acquisitionState)
): boolean {
  return !importAllowed || hasPendingAcquisition;
}

/**
 * Returns whether the current acquisition state still owns the one-active-job lock for the visible candidate set.
 */
export function isPendingCandidateAcquisition(acquisitionState: CandidateAcquisitionState): boolean {
  return acquisitionState.kind === "creating" ||
    acquisitionState.kind === "queued" ||
    acquisitionState.kind === "running";
}

/**
 * Renders explicit exact-match provider lookup and imports selected candidates through the configured intake mode.
 */
export function ProviderLookupPanel({
  importMode = "queue",
  initialQuery,
  refreshHref
}: ProviderLookupPanelProps): React.ReactElement {
  const [status, setStatus] = useState<ProviderLookupPanelState>({ kind: "idle" });
  const [acquisitionState, setAcquisitionState] = useState<CandidateAcquisitionState>({ kind: "idle" });
  const pollTimeoutRef = useRef<number | null>(null);
  const requestCycleRef = useRef(0);

  /**
   * Cancels any pending acquisition-job polling so stale no-match states cannot overwrite the current page context.
   */
  const clearScheduledPoll = useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  /**
   * Applies the next acquisition state only if it still belongs to the current no-match request cycle.
   */
  const applyAcquisitionState = useCallback(
    (nextState: CandidateAcquisitionState, requestCycle: number) => {
      if (requestCycle !== requestCycleRef.current) {
        return;
      }

      setAcquisitionState(nextState);

      if (
        nextState.kind === "succeeded" &&
        nextState.action.kind === "open_part"
      ) {
        navigateBrowserLocation(nextState.action.href);
      }
    },
    []
  );

  /**
   * Polls one provider acquisition job until it reaches a terminal state or the no-match context changes.
   */
  const pollAcquisitionJob = useCallback(
    async (candidateKey: string, jobId: string, requestCycle: number) => {
      try {
        const detail = await fetchProviderAcquisitionJob(jobId);
        if (requestCycle !== requestCycleRef.current) {
          return;
        }
        const nextState = resolveProviderAcquisitionTrackingState(candidateKey, detail, refreshHref);

        applyAcquisitionState(nextState, requestCycle);

        if (nextState.kind === "queued" || nextState.kind === "running") {
          pollTimeoutRef.current = scheduleBrowserPoll(() => {
            void pollAcquisitionJob(candidateKey, jobId, requestCycle);
          });
        }
      } catch (error) {
        applyAcquisitionState(resolveProviderAcquisitionRequestFailure(candidateKey, error), requestCycle);
      }
    },
    [applyAcquisitionState, refreshHref]
  );

  /**
   * Runs explicit provider lookup only when the user asks for it from the no-match state.
   */
  const runLookup = useCallback(async () => {
    clearScheduledPoll();
    requestCycleRef.current += 1;
    setStatus({ kind: "searching" });
    setAcquisitionState({ kind: "idle" });

    try {
      const candidates = await requestProviderLookup({ query: initialQuery });

      if (candidates.length === 0) {
        setStatus({ kind: "no_candidates" });
        return;
      }

      setStatus({ candidates, kind: "candidates" });
    } catch (error) {
      setStatus({
        kind: "failed",
        message: isApiClientError(error)
          ? error.message.replace(/^Provider lookup failed \([^)]+?\):\s*/u, "")
          : importUiCopy.providerLookupFailure
      });
    }
  }, [clearScheduledPoll, initialQuery]);

  /**
   * Queues one selected exact-match candidate as a provider acquisition job and begins status polling.
   */
  const queueCandidateAcquisition = useCallback(
    async (candidate: ProviderLookupCandidate) => {
      const candidateKey = buildCandidateKey(candidate);
      clearScheduledPoll();
      requestCycleRef.current += 1;
      const requestCycle = requestCycleRef.current;
      setAcquisitionState({ candidateKey, kind: "creating" });

      try {
        const detail = await requestProviderAcquisitionJob(
          buildProviderAcquisitionJobCreateInput(candidate, initialQuery)
        );
        if (requestCycle !== requestCycleRef.current) {
          return;
        }
        const nextState = resolveProviderAcquisitionTrackingState(candidateKey, detail, refreshHref);

        applyAcquisitionState(nextState, requestCycle);

        if (nextState.kind === "queued" || nextState.kind === "running") {
          pollTimeoutRef.current = scheduleBrowserPoll(() => {
            void pollAcquisitionJob(candidateKey, detail.job.id, requestCycle);
          });
        }
      } catch (error) {
        applyAcquisitionState(resolveProviderAcquisitionRequestFailure(candidateKey, error), requestCycle);
      }
    },
    [applyAcquisitionState, clearScheduledPoll, initialQuery, pollAcquisitionJob, refreshHref]
  );

  /**
   * Imports one selected exact-match candidate immediately through the existing provider import route.
   */
  const importCandidateDirectly = useCallback(
    async (candidate: ProviderLookupCandidate) => {
      const candidateKey = buildCandidateKey(candidate);
      clearScheduledPoll();
      requestCycleRef.current += 1;
      const requestCycle = requestCycleRef.current;
      setAcquisitionState({ candidateKey, kind: "creating" });

      try {
        const result = await requestProviderImport(buildProviderCandidateImportInput(candidate));
        if (requestCycle !== requestCycleRef.current) {
          return;
        }

        applyAcquisitionState(
          {
            action: resolveImportSuccessAction({
              partId: result.partId,
              refreshHref
            }),
            candidateKey,
            kind: "succeeded"
          },
          requestCycle
        );
      } catch (error) {
        applyAcquisitionState(resolveProviderDirectImportFailure(candidateKey, error), requestCycle);
      }
    },
    [applyAcquisitionState, clearScheduledPoll, refreshHref]
  );

  /**
   * Resets acquisition polling when the no-match lookup changes underneath the client component.
   */
  useEffect(() => {
    clearScheduledPoll();
    requestCycleRef.current += 1;
    setStatus({ kind: "idle" });
    setAcquisitionState({ kind: "idle" });
  }, [clearScheduledPoll, initialQuery, refreshHref]);

  /**
   * Clears the delayed poll when the lookup panel unmounts so no stale update survives navigation.
   */
  useEffect(() => clearScheduledPoll, [clearScheduledPoll]);

  return (
    <ProviderLookupPanelView
      acquisitionState={acquisitionState}
      importMode={importMode}
      onQueueAcquisition={queueCandidateAcquisition}
      onRunDirectImport={importCandidateDirectly}
      onRunLookup={runLookup}
      status={status}
    />
  );
}

/**
 * Renders the visible provider lookup panel state so tests can verify candidate locking and terminal-state markup without browser effects.
 */
export function ProviderLookupPanelView({
  acquisitionState,
  importMode = "queue",
  onQueueAcquisition,
  onRunDirectImport,
  onRunLookup,
  status
}: ProviderLookupPanelViewProps): React.ReactElement {
  const activePendingCandidateKey = readActivePendingCandidateKey(acquisitionState);
  const hasPendingAcquisition = isPendingCandidateAcquisition(acquisitionState);
  const activePendingCandidate =
    status.kind === "candidates" && activePendingCandidateKey
      ? status.candidates.find((candidate) => buildCandidateKey(candidate) === activePendingCandidateKey) ?? null
      : null;

  return (
    <div className="quick-provider-lookup">
      <p className="quick-provider-lookup__intro muted-copy">
        {importUiCopy.providerLookupLead} {importUiCopy.providerLookupExactNote} {importUiCopy.catalogAcquisitionNote}
      </p>

      <div className="quick-actions-row quick-actions-row--lookup">
        <button disabled={status.kind === "searching"} onClick={onRunLookup} type="button">
          {importUiCopy.buttonSearchProviders}
        </button>
      </div>

      {status.kind === "searching" ? (
        <p className="quick-check-empty__note">{importUiCopy.providerLookupSearching}</p>
      ) : null}

      {status.kind === "no_candidates" ? (
        <p className="quick-check-empty__note">{importUiCopy.providerLookupNoMatch}</p>
      ) : null}

      {status.kind === "failed" ? (
        <p className="quick-check-empty__note">
          <strong>{importUiCopy.providerLookupFailure}</strong> {status.message}
        </p>
      ) : null}

      {activePendingCandidate ? (
        <p className="quick-check-empty__note">
          <strong>{importUiCopy.providerAcquisitionActiveLead}</strong>{" "}
          {activePendingCandidate.providerId} / {activePendingCandidate.providerPartKey}.{" "}
          {importUiCopy.providerAcquisitionLocked}
        </p>
      ) : null}

      {status.kind === "candidates" ? (
        <div className="quick-provider-candidates">
          {status.candidates.map((candidate) => {
            const candidateKey = buildCandidateKey(candidate);
            const candidateState = readCandidateAcquisitionState(candidateKey, acquisitionState);

            return (
              <ProviderLookupCandidateCard
                acquisitionState={candidateState}
                candidate={candidate}
                hasPendingAcquisition={hasPendingAcquisition}
                importMode={importMode}
                isActivePendingCandidate={candidateKey === activePendingCandidateKey}
                key={candidateKey}
                onRunCandidateImport={importMode === "direct" && onRunDirectImport ? onRunDirectImport : onQueueAcquisition}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders one provider candidate row plus the current import action and status for that row.
 */
function ProviderLookupCandidateCard({
  acquisitionState,
  candidate,
  hasPendingAcquisition,
  importMode,
  isActivePendingCandidate,
  onRunCandidateImport
}: ProviderLookupCandidateCardProps): React.ReactElement {
  const isPending = isQueueAcquisitionButtonDisabled(candidate.importAllowed, acquisitionState, hasPendingAcquisition);
  const idleButtonLabel = importMode === "direct" ? importUiCopy.buttonImportCandidate : importUiCopy.buttonQueueAcquisition;

  return (
    <section className="quick-provider-candidate">
      <div className="quick-provider-candidate__summary">
        <div className="quick-provider-candidate__identity">
          <span className="ui-mono">{candidate.mpn}</span>
          <span>
            {candidate.manufacturerName} / {candidate.package}
          </span>
          <span className="quick-provider-candidate__source">
            {candidate.providerId} / {candidate.providerPartKey}
          </span>
        </div>
        <div className="quick-provider-candidate__badges">
          <StatusBadge
            label={candidate.matchType === "exact_mpn" ? "Exact MPN match" : "Exact provider id match"}
            tone="verified"
          />
          <StatusBadge
            label={candidate.importAllowed ? "Import available" : "Import unavailable"}
            tone={candidate.importAllowed ? "info" : "review"}
          />
          {isActivePendingCandidate ? (
            <StatusBadge label={importUiCopy.providerAcquisitionActiveBadge} tone="info" />
          ) : null}
        </div>
      </div>

      {candidate.sourceUrl ? (
        <p className="quick-provider-candidate__link">
          <a href={candidate.sourceUrl} rel="noreferrer" target="_blank">
            Open provider source
          </a>
        </p>
      ) : null}

      <div className="quick-provider-candidate__actions">
        <button
          disabled={isPending}
          onClick={() => onRunCandidateImport(candidate)}
          type="button"
        >
          {isPending && acquisitionState.kind === "creating"
            ? importUiCopy.providerAcquisitionCreating
            : idleButtonLabel}
        </button>
        {!candidate.importAllowed ? (
          <p className="quick-check-empty__note">{importUiCopy.providerLookupImportUnavailable}</p>
        ) : null}
      </div>

      <ProviderLookupCandidateJobStatus importMode={importMode} state={acquisitionState} />
    </section>
  );
}

/**
 * Renders the selected candidate's queued/running/succeeded/failed import status.
 */
export function ProviderLookupCandidateJobStatus({
  importMode = "queue",
  state
}: ProviderLookupCandidateJobStatusProps): React.ReactElement | null {
  if (state.kind === "idle") {
    return null;
  }

  if (state.kind === "creating") {
    return (
      <p className="quick-provider-candidate__job-status quick-provider-candidate__job-status--pending">
        {importUiCopy.providerAcquisitionCreating}
      </p>
    );
  }

  if (state.kind === "queued") {
    return (
      <p className="quick-provider-candidate__job-status quick-provider-candidate__job-status--pending">
        {importUiCopy.providerAcquisitionQueued}
      </p>
    );
  }

  if (state.kind === "running") {
    return (
      <p className="quick-provider-candidate__job-status quick-provider-candidate__job-status--pending">
        {importUiCopy.providerAcquisitionRunning}
      </p>
    );
  }

  if (state.kind === "succeeded") {
    const successCopy = state.action.kind === "refresh_search"
      ? (importMode === "direct" ? importUiCopy.successRefreshLead : importUiCopy.providerAcquisitionSucceededRefresh)
      : (importMode === "direct" ? importUiCopy.successLead : importUiCopy.providerAcquisitionSucceeded);

    return (
      <div className="quick-provider-candidate__job-status quick-provider-candidate__job-status--success">
        <p>{successCopy}</p>
        {state.action.kind === "open_part" ? (
          <Link className="button-link button-link--quiet" href={state.action.href}>
            {importUiCopy.linkOpenPart}
          </Link>
        ) : null}
        {state.action.kind === "refresh_search" ? (
          <Link className="button-link button-link--quiet" href={state.action.href}>
            {importUiCopy.linkRefreshSearch}
          </Link>
        ) : null}
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <p className="quick-provider-candidate__job-status quick-provider-candidate__job-status--unavailable">
        {state.message}
      </p>
    );
  }

  return (
    <p className="quick-provider-candidate__job-status quick-provider-candidate__job-status--failed">
      {state.message}
    </p>
  );
}

/**
 * Builds a stable client-side key for one provider candidate row.
 */
function buildCandidateKey(candidate: ProviderLookupCandidate): string {
  return `${candidate.providerId}:${candidate.providerPartKey}`;
}

/**
 * Returns the currently active pending candidate key, if the panel is still creating or tracking one queued/running job.
 */
function readActivePendingCandidateKey(acquisitionState: CandidateAcquisitionState): string | null {
  if (
    acquisitionState.kind === "creating" ||
    acquisitionState.kind === "queued" ||
    acquisitionState.kind === "running"
  ) {
    return acquisitionState.candidateKey;
  }

  return null;
}

/**
 * Returns the acquisition state for one candidate row while leaving all other rows in the idle presentation state.
 */
function readCandidateAcquisitionState(
  candidateKey: string,
  acquisitionState: CandidateAcquisitionState
): CandidateAcquisitionState {
  return "candidateKey" in acquisitionState && acquisitionState.candidateKey === candidateKey
    ? acquisitionState
    : { kind: "idle" };
}

/**
 * Removes the repetitive API client prefix so queue failure copy stays compact.
 */
function stripProviderAcquisitionFailurePrefix(message: string): string {
  return message.replace(/^Provider acquisition job failed \([^)]+?\):\s*/u, "");
}

/**
 * Maps direct selected-candidate import failures into the provider candidate status shape.
 */
function resolveProviderDirectImportFailure(candidateKey: string, error: unknown): CandidateAcquisitionState {
  const failure = resolveImportFailureState(error);

  return {
    candidateKey,
    kind: failure.kind,
    message: failure.message
  };
}

/**
 * Navigates to a browser location only when this client component is running in the browser.
 */
function navigateBrowserLocation(href: string): void {
  if (typeof window !== "undefined") {
    window.location.assign(href);
  }
}

/**
 * Schedules the next acquisition-job poll only when the lookup panel is running in the browser.
 */
function scheduleBrowserPoll(callback: () => void): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.setTimeout(callback, 900) as number;
}
