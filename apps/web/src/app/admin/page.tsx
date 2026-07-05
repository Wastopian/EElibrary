/**
 * File header: Provides an operational admin workspace for review, promotion, and audit flows.
 */

import Link from "next/link";
import React from "react";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { AdminQueuePresentation } from "./AdminQueuePresentation";
import type { AdminQueueOverviewGroup, AdminQueueOverviewStat, AdminQueueTableRow } from "./AdminQueuePresentation";
import { ImportByMpnPanel } from "../../components/ImportByMpnPanel";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { isValidatedDownloadableAsset } from "@ee-library/shared/asset-state";
import { getAssetPromotionSummary, getAssetReviewStatus, getAssetValidationSummary, getWorkflowReviewStatus } from "@ee-library/shared/review-workflow";
import { createAssetPromotion, createReviewAction, fetchApiHealth, fetchAuditEvents, fetchPartSearchEnvelope, isApiClientError, updatePartIssueWorkflow, updateSourceReconciliation } from "../../lib/api-client";
import type { AuditEventQueryFilters } from "../../lib/api-client";
import { getSetupStateCopy } from "../../lib/setup-state-copy";
import { getTrustLineageSummaryForSearchRecord } from "../../lib/trust-lineage";
import { formatReviewStateLabel, reviewStateTone } from "../../lib/detail-view-model";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type {
  Asset,
  AssetValidationRecord,
  AuditEvent,
  CatalogDataSource,
  PartApprovalStatus,
  PartIssue,
  PartIssueCode,
  PartIssueWorkflowStatus,
  PartRiskFlagCode,
  PartSearchFilters,
  PartSearchRecord,
  ReviewOutcome,
  ReviewTargetType,
  SourceReconciliationStatus
} from "@ee-library/shared/types";

type AdminCatalogState =
  | {
      status: "ready";
      records: PartSearchRecord[];
      source: CatalogDataSource;
      warnings: string[];
      health: ApiHealth | null;
    }
  | {
      status: "setup_required";
      code: string;
      message: string;
      health: ApiHealth | null;
    };

type AdminAuditEventState =
  | { status: "ready"; events: AuditEvent[]; boundary: string; filters: AuditEventQueryFilters }
  | { status: "unavailable"; message: string; filters: AuditEventQueryFilters };

interface ReviewQueueItem {
  partId: string;
  mpn: string;
  manufacturerName: string;
  targetId: string;
  targetType: ReviewTargetType;
  reviewStateLabel: string;
  reviewStateTone: BadgeTone;
  context: string;
  detail: string;
  trustLineageLabel: string;
  updatedAt: string;
}

interface PromotionQueueItem {
  partId: string;
  mpn: string;
  manufacturerName: string;
  assetId: string;
  assetType: Asset["assetType"];
  canPromote: boolean;
  blockerReasons: string[];
  validationReason: string;
  trustLineageLabel: string;
  updatedAt: string;
}

interface ImportRow {
  partId: string;
  mpn: string;
  providerId: string;
  importStatus: "imported" | "failed";
  sourceLastImportedAt: string | null;
  importErrorDetails: string | null;
}

interface ValidationRow {
  assetType: Asset["assetType"] | null;
  id: string;
  manufacturerName: string;
  partId: string;
  mpn: string;
  assetId: string;
  validationNotes: string | null;
  validationStatus: AssetValidationRecord["validationStatus"];
  validationType: AssetValidationRecord["validationType"];
  validatedAt: string;
  validator: string;
}

interface ValidationAttentionRow {
  assetId: string;
  assetType: Asset["assetType"];
  detail: string;
  id: string;
  manufacturerName: string;
  mpn: string;
  nextAction: string;
  partId: string;
  stateLabel: string;
  stateTone: BadgeTone;
  updatedAt: string;
  validationTypeLabel: string;
}

/** AssistantTriageRow is a review-prep packet assembled from existing evidence only. */
interface AssistantTriageRow {
  attentionReason: string;
  evidenceSummary: string;
  guardrail: string;
  manufacturerName: string;
  mpn: string;
  nextAction: string;
  partId: string;
  stateLabel: string;
  stateTone: BadgeTone;
  updatedAt: string;
}

interface PromotionAuditRow {
  id: string;
  partId: string;
  mpn: string;
  assetId: string;
  outcome: string;
  blockerReasons: string[];
  createdAt: string;
  actor: string;
}

type IssueQueueId = "approval" | "cad_gaps" | "connector" | "duplicates" | "identity" | "lifecycle" | "source_conflicts";

/** Confidence below this threshold is useful assistant-prep context but not trusted truth. */
const ASSISTANT_TRIAGE_CONFIDENCE_THRESHOLD = 0.75;
/** Guardrail copy repeated per packet so assistant prep cannot be mistaken for approval. */
const ASSISTANT_TRIAGE_GUARDRAIL = "Human review required; assistant notes cannot approve, normalize, or promote records.";

interface OverviewQueueRow extends AdminQueueTableRow {
  updatedAtRaw: string;
}

interface IssueWorkflowRow {
  partId: string;
  mpn: string;
  manufacturerName: string;
  issue: PartIssue;
  queueLabel: string;
  detail: string;
  duplicateContext: string | null;
  sourceReconciliationContext: string | null;
  sourceReconciliationNotes: string | null;
  preferredSourceRecordId: string | null;
}

export const dynamic = "force-dynamic";

/** AdminPageSearchParams carries optional URL filters consumed by the user-action audit section. */
type AdminPageSearchParams = {
  auditActorId?: string | string[];
  auditAction?: string | string[];
  auditTargetType?: string | string[];
  auditTargetId?: string | string[];
  auditOutcome?: string | string[];
};

interface AdminPageProps {
  searchParams?: Promise<AdminPageSearchParams>;
}

/**
 * Renders the admin/review/audit workspace using existing catalog projections.
 * Optional audit-* search params filter the user-action audit timeline so detail
 * pages can deep-link into a target-scoped audit view.
 */
export default async function AdminPage(props: AdminPageProps) {
  const resolvedSearchParams = props.searchParams ? await props.searchParams : {};
  const auditFilters = readAuditFiltersFromSearchParams(resolvedSearchParams);

  const catalogState = await loadAdminCatalog();

  if (catalogState.status === "setup_required") {
    return <AdminSetupState catalogState={catalogState} />;
  }

  const { health, records, source, warnings } = catalogState;
  const auditEventState = await loadAdminAuditEvents(auditFilters);
  const reviewQueue = buildReviewQueue(records);
  const promotionQueue = buildPromotionQueue(records);
  const importRows = buildImportRows(records);
  const failedImportRows = importRows.filter((row) => row.importStatus === "failed").slice(0, 8);
  const recentImportRows = importRows.slice(0, 12);
  const validationRows = buildValidationRows(records);
  const recentValidationRows = validationRows.slice(0, 12);
  const validationAttentionRows = buildValidationAttentionRows(records);
  const recentValidationAttentionRows = validationAttentionRows.slice(0, 12);
  const promotionAudits = buildPromotionAuditRows(records).slice(0, 14);
  const validationSummary = summarizeValidation(validationRows);
  const issueQueueRows = buildIssueQueueRows(records);
  const issueWorkflowRows = buildIssueWorkflowRows(records);
  const assistantTriageRows = buildAssistantTriageRows(records);
  const recentAssistantTriageRows = assistantTriageRows.slice(0, 12);

  /**
   * Dense queues render at most this many rows. Without a cap the page ran to ~85,000px with the
   * demo catalog alone (247 issue rows) — unusable to scroll and slow to render. Counts stay honest
   * in each panel title; a per-table note says how many more exist and how to narrow.
   */
  const QUEUE_ROW_DISPLAY_LIMIT = 20;
  const displayedIssueWorkflowRows = issueWorkflowRows.slice(0, QUEUE_ROW_DISPLAY_LIMIT);
  const displayedReviewQueue = reviewQueue.slice(0, QUEUE_ROW_DISPLAY_LIMIT);
  const displayedPromotionQueue = promotionQueue.slice(0, QUEUE_ROW_DISPLAY_LIMIT);
  const overviewStats = buildAdminOverviewStats(reviewQueue, promotionQueue, failedImportRows.length, validationAttentionRows.length, issueQueueRows, assistantTriageRows.length);
  const overviewGroups = buildAdminOverviewGroups(reviewQueue, promotionQueue, failedImportRows.length, validationAttentionRows.length, issueQueueRows, assistantTriageRows.length);
  const overviewTableRows = buildAdminOverviewTableRows(reviewQueue, promotionQueue, failedImportRows, validationAttentionRows, issueQueueRows, assistantTriageRows);

  /**
   * Writes one review action without collapsing review and export truth boundaries.
   */
  async function submitReviewAction(formData: FormData) {
    "use server";

    const partId = readRequiredFormString(formData.get("partId"));
    const targetType = readReviewTargetType(formData.get("targetType"));
    const targetId = readRequiredFormString(formData.get("targetId"));
    const outcome = readReviewOutcome(formData.get("outcome"));

    if (!partId || !targetType || !targetId || !outcome) {
      return;
    }

    await createReviewAction(partId, { outcome, targetId, targetType });
    revalidatePath("/admin");
    revalidatePath(`/parts/${partId}`);
  }

  /**
   * Runs explicit export promotion for one approved candidate asset.
   */
  async function submitPromotionAction(formData: FormData) {
    "use server";

    const partId = readRequiredFormString(formData.get("partId"));
    const assetId = readRequiredFormString(formData.get("assetId"));

    if (!partId || !assetId) {
      return;
    }

    await createAssetPromotion(partId, assetId);
    revalidatePath("/admin");
    revalidatePath(`/parts/${partId}`);
  }

  /**
   * Persists operator workflow state for one backend-derived part issue.
   */
  async function submitIssueWorkflowAction(formData: FormData) {
    "use server";

    const partId = readRequiredFormString(formData.get("partId"));
    const issueCode = readPartIssueCode(formData.get("issueCode"));
    const status = readIssueWorkflowStatus(formData.get("status"));
    const assignedTo = readOptionalFormString(formData.get("assignedTo"));
    const resolutionNotes = readOptionalFormString(formData.get("resolutionNotes"));

    if (!partId || !issueCode || !status) {
      return;
    }

    await updatePartIssueWorkflow(partId, issueCode, { assignedTo, resolutionNotes, status });
    revalidatePath("/admin");
    revalidatePath(`/parts/${partId}`);
  }

  /**
   * Persists source-conflict reconciliation decisions without hiding remaining evidence.
   */
  async function submitSourceReconciliationAction(formData: FormData) {
    "use server";

    const partId = readRequiredFormString(formData.get("partId"));
    const resolutionStatus = readSourceReconciliationStatus(formData.get("resolutionStatus"));
    const preferredSourceRecordId = readOptionalFormString(formData.get("preferredSourceRecordId"));
    const notes = readOptionalFormString(formData.get("notes"));

    if (!partId || !resolutionStatus) {
      return;
    }

    await updateSourceReconciliation(partId, { notes, preferredSourceRecordId, resolutionStatus });
    revalidatePath("/admin");
    revalidatePath(`/parts/${partId}`);
  }

  return (
    <main className="admin-layout">
      <section className="admin-hero">
        <div className="admin-hero__layout">
          <div className="admin-hero__copy">
            <p className="app-kicker">Admin workspace</p>
            <h1>Review and trust maintenance</h1>
            <p className="admin-hero__lede">
              Review pending drafts, clear blockers, and mark files verified for export. Marking files verified is a separate step so nothing slips through unreviewed.
            </p>
            <div className="admin-hero__status">
              <StatusBadge label={source === "seed_fallback" ? "Local seed mode" : "DB-backed catalog"} tone={source === "seed_fallback" ? "review" : "verified"} />
              <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
              <StatusBadge label={`Database ${health?.dependencies.database ?? "unknown"}`} tone={health?.dependencies.database === "connected" ? "verified" : "review"} />
            </div>
            {warnings.length > 0 ? <p className="mode-warning">{warnings.join(" ")}</p> : null}
          </div>
          <AdminHeroSnapshot stats={selectAdminHeroStats(overviewStats)} />
        </div>
      </section>

      <AdminTruthRail />

      <WorkspaceJumpNav
        ariaLabel="Admin workspace sections"
        items={[
          { href: "#assistant-triage-heading", label: "Assistant triage" },
          { href: "#issue-ops-heading", label: "Issue operations" },
          { href: "#import-by-mpn-heading", label: "Import by MPN" },
          { href: "#review-queue-heading", label: "Review queue" },
          { href: "#promotion-queue-heading", label: "Files to mark verified" },
          { href: "#ops-health-heading", label: "Imports and validation" },
          { href: "#audit-heading", label: "Verification audit history" },
          { href: "#user-action-audit-heading", label: "User action audit" }
        ]}
      />

      <AdminQueuePresentation groups={overviewGroups} rows={overviewTableRows} stats={overviewStats} />

      <section className="detail-section" aria-labelledby="assistant-triage-heading">
        <SectionHeading
          id="assistant-triage-heading"
          index="00"
          subtitle="Briefing packets for assistant-aided review. They summarize existing records only and never change approval or export status."
          title="Assistant triage prep"
        />
        <SectionPanel
          description="Built from current source, metric, issue, extraction, and file evidence. Assistant output is never trusted automatically — the review queues stay in charge."
          title={`${assistantTriageRows.length} assistant triage ${assistantTriageRows.length === 1 ? "packet" : "packets"}`}
        >
          {recentAssistantTriageRows.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--dense">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Why queued</th>
                    <th>Evidence packet</th>
                    <th>Guardrail</th>
                    <th>Next action</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAssistantTriageRows.map((row) => (
                    <tr key={`assistant-triage-${row.partId}`}>
                      <td>
                        <Link href={`/parts/${row.partId}`}>
                          <span className="ui-mono">{row.mpn}</span>
                        </Link>
                        <div className="muted-copy">{row.manufacturerName}</div>
                      </td>
                      <td>
                        <StatusBadge label={row.stateLabel} tone={row.stateTone} />
                        <div className="muted-copy">{row.attentionReason}</div>
                      </td>
                      <td>{row.evidenceSummary}</td>
                      <td>{row.guardrail}</td>
                      <td>{row.nextAction}</td>
                      <td>{formatDateTime(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No assistant triage packets" body="Current catalog records do not have source conflicts, generated-review files, or low-confidence extraction work that needs prep." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="issue-ops-heading">
        <SectionHeading
          id="issue-ops-heading"
          index="01"
          subtitle="Assign, resolve, and reopen open issues. These stay separate from file review and verification."
          title="Issue operations"
        />
        <SectionPanel
          description="Editing an issue here does not change part status or make exports available. It only updates the issue."
          title={`${issueWorkflowRows.length} issue workflow items`}
        >
          {issueWorkflowRows.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--dense">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Issue</th>
                    <th>Workflow</th>
                    <th>Context</th>
                    <th>Workflow action</th>
                    <th>Source reconciliation</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedIssueWorkflowRows.map((row) => (
                    <tr key={`${row.partId}-${row.issue.code}`}>
                      <td>
                        <Link href={`/parts/${row.partId}`}>
                          <span className="ui-mono">{row.mpn}</span>
                        </Link>
                        <div className="muted-copy">{row.manufacturerName}</div>
                      </td>
                      <td>
                        <div>{row.queueLabel}</div>
                        <div className="muted-copy">{row.issue.summary}</div>
                        <div className="muted-copy ui-mono">{row.issue.code}</div>
                      </td>
                      <td>
                        <StatusBadge label={formatIssueWorkflowStatus(row.issue.status)} tone={issueWorkflowTone(row.issue.status)} />
                        <div className="muted-copy">{row.issue.assignedTo ? `Assigned to ${row.issue.assignedTo}` : "Unassigned"}</div>
                        <div className="muted-copy">{row.issue.resolvedAt ? `Resolved ${formatDateTime(row.issue.resolvedAt)}` : `Updated ${formatDateTime(row.issue.lastUpdatedAt)}`}</div>
                      </td>
                      <td>
                        <div>{row.detail}</div>
                        {row.duplicateContext ? <div className="muted-copy">{row.duplicateContext}</div> : null}
                        {row.sourceReconciliationContext ? <div className="muted-copy">{row.sourceReconciliationContext}</div> : null}
                        {row.issue.resolutionNotes ? <div className="muted-copy">Notes: {row.issue.resolutionNotes}</div> : null}
                      </td>
                      <td>
                        <form action={submitIssueWorkflowAction} className="admin-issue-form">
                          <input name="partId" type="hidden" value={row.partId} />
                          <input name="issueCode" type="hidden" value={row.issue.code} />
                          <label>
                            <span>Assignee</span>
                            <input defaultValue={row.issue.assignedTo ?? ""} name="assignedTo" type="text" />
                          </label>
                          <label>
                            <span>Resolution notes</span>
                            <textarea defaultValue={row.issue.resolutionNotes ?? ""} name="resolutionNotes" rows={3} />
                          </label>
                          <div className="admin-action-row">
                            <button name="status" type="submit" value="in_review">
                              In review
                            </button>
                            <button name="status" type="submit" value="resolved">
                              Resolve
                            </button>
                            <button className="button-link--quiet" name="status" type="submit" value="open">
                              Reopen
                            </button>
                          </div>
                        </form>
                      </td>
                      <td>
                        {row.issue.code === "source_conflict" ? (
                          <form action={submitSourceReconciliationAction} className="admin-issue-form">
                            <input name="partId" type="hidden" value={row.partId} />
                            <label>
                              <span>Preferred source record</span>
                              <input defaultValue={row.preferredSourceRecordId ?? ""} name="preferredSourceRecordId" type="text" />
                            </label>
                            <label>
                              <span>Reconciliation notes</span>
                              <textarea defaultValue={row.sourceReconciliationNotes ?? ""} name="notes" rows={3} />
                            </label>
                            <div className="admin-action-row">
                              <button name="resolutionStatus" type="submit" value="canonical_source_selected">
                                Select canonical
                              </button>
                              <button name="resolutionStatus" type="submit" value="mixed_sources_accepted">
                                Accept mixed
                              </button>
                              <button className="button-link--quiet" name="resolutionStatus" type="submit" value="unreviewed">
                                Reopen conflict
                              </button>
                            </div>
                          </form>
                        ) : (
                          <span className="muted-copy">Not applicable</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {issueWorkflowRows.length > displayedIssueWorkflowRows.length ? (
                <p className="muted-copy">
                  Showing the first {displayedIssueWorkflowRows.length} of {issueWorkflowRows.length}. Use the issue queue links above to open a narrower filtered view.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState title="No issue workflow items" body="No issues are open or recently resolved right now." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="import-by-mpn-heading">
        <SectionHeading
          id="import-by-mpn-heading"
          index="02"
          subtitle="Pull one part from a provider into the catalog, then continue in part detail or the queues below."
          title="Import by MPN"
        />
        <SectionPanel
          description="Same import path the background worker uses. A successful import means the record was created — not that CAD is verified or ready to export."
          title="Operator import"
          tone="technical"
        >
          <ImportByMpnPanel />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="review-queue-heading">
        <SectionHeading id="review-queue-heading" index="03" title="Review queue" subtitle="Generated drafts and review-required files that need approve, reject, or request-changes." />
        <SectionPanel description="Review state and actions are explicit. Approving alone does not verify files for export." title={`${reviewQueue.length} review items`}>
          {reviewQueue.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Target</th>
                    <th>Review state</th>
                    <th>Reason</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedReviewQueue.map((item) => (
                    <tr key={`${item.targetType}-${item.targetId}`}>
                      <td>
                        <Link href={`/parts/${item.partId}`}>
                          <span className="ui-mono">{item.mpn}</span>
                        </Link>
                        <div className="muted-copy">{item.manufacturerName}</div>
                        <div className="muted-copy">{item.trustLineageLabel}</div>
                      </td>
                      <td>
                        <div>{item.context}</div>
                        <div className="muted-copy ui-mono">{item.targetId}</div>
                      </td>
                      <td>
                        <StatusBadge label={item.reviewStateLabel} tone={item.reviewStateTone} />
                      </td>
                      <td>
                        <div>{item.detail}</div>
                        <div className="muted-copy">{formatDateTime(item.updatedAt)}</div>
                      </td>
                      <td>
                        <form action={submitReviewAction} className="admin-action-row">
                          <input name="partId" type="hidden" value={item.partId} />
                          <input name="targetType" type="hidden" value={item.targetType} />
                          <input name="targetId" type="hidden" value={item.targetId} />
                          <button name="outcome" type="submit" value="approved">
                            Approve
                          </button>
                          <button className="button-link--quiet" name="outcome" type="submit" value="changes_requested">
                            Changes
                          </button>
                          <button className="admin-button-danger" name="outcome" type="submit" value="rejected">
                            Reject
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reviewQueue.length > displayedReviewQueue.length ? (
                <p className="muted-copy">
                  Showing the first {displayedReviewQueue.length} of {reviewQueue.length}. Handle these and reload to pull the next batch forward.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState title="No review queue items" body="No drafts or review-required items are waiting right now." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="promotion-queue-heading">
        <SectionHeading id="promotion-queue-heading" index="04" title="Files to mark verified" subtitle="Approved files that are ready or blocked for the final verification step before export." />
        <SectionPanel description="Verifying for export is a separate step from review. Blockers are shown before you mark anything verified." title={`${promotionQueue.length} files waiting to verify`}>
          {promotionQueue.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>File</th>
                    <th>Verify state</th>
                    <th>Validation evidence</th>
                    <th>Blockers</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedPromotionQueue.map((item) => (
                    <tr key={`promotion-${item.assetId}`}>
                      <td>
                        <Link href={`/parts/${item.partId}`}>
                          <span className="ui-mono">{item.mpn}</span>
                        </Link>
                        <div className="muted-copy">{item.manufacturerName}</div>
                        <div className="muted-copy">{item.trustLineageLabel}</div>
                      </td>
                      <td>
                        <div>{formatAssetType(item.assetType)}</div>
                        <div className="muted-copy ui-mono">{item.assetId}</div>
                        <div className="muted-copy">{formatDateTime(item.updatedAt)}</div>
                      </td>
                      <td>
                        <StatusBadge label={item.canPromote ? "Ready to verify" : "Blocked"} tone={item.canPromote ? "verified" : "review"} />
                      </td>
                      <td>{item.validationReason}</td>
                      <td>
                        {item.blockerReasons.length > 0 ? (
                          <ul className="admin-inline-list">
                            {item.blockerReasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="muted-copy">No blockers</span>
                        )}
                      </td>
                      <td>
                        <form action={submitPromotionAction}>
                          <input name="partId" type="hidden" value={item.partId} />
                          <input name="assetId" type="hidden" value={item.assetId} />
                          <button disabled={!item.canPromote} type="submit">
                            Mark verified
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {promotionQueue.length > displayedPromotionQueue.length ? (
                <p className="muted-copy">
                  Showing the first {displayedPromotionQueue.length} of {promotionQueue.length}. Verify these and reload to pull the next batch forward.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState title="Nothing to verify right now" body="No approved files are waiting to be marked verified for export." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="ops-health-heading">
        <SectionHeading id="ops-health-heading" index="05" title="Imports and validation" subtitle="Recent import results and validation evidence." />
        <div className="detail-two-col">
          <SectionPanel title="Recent imports" description="Most recent source imports.">
            {recentImportRows.length > 0 ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Part</th>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>Imported at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentImportRows.map((row) => (
                      <tr key={`${row.partId}-${row.providerId}-${row.sourceLastImportedAt ?? "none"}`}>
                        <td>
                          <Link href={`/parts/${row.partId}`}>
                            <span className="ui-mono">{row.mpn}</span>
                          </Link>
                        </td>
                        <td>{row.providerId}</td>
                        <td>
                          <StatusBadge label={row.importStatus === "imported" ? "Imported" : "Failed"} tone={row.importStatus === "imported" ? "verified" : "danger"} />
                        </td>
                        <td>{row.sourceLastImportedAt ? formatDateTime(row.sourceLastImportedAt) : "No successful import"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No imports" body="No source imports recorded in the current catalog window." />
            )}
          </SectionPanel>
          <SectionPanel title="Failed imports" description="Failures include the original error text so you can fix them quickly.">
            {failedImportRows.length > 0 ? (
              <ul className="admin-inline-list">
                {failedImportRows.map((row) => (
                  <li key={`${row.partId}-${row.providerId}-failed`}>
                    <span className="ui-mono">{row.mpn}</span> - {row.providerId} - {row.importErrorDetails ?? "No error details"}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No failed imports" body="No failed import rows were found right now." />
            )}
          </SectionPanel>
        </div>

        <SectionPanel title="Validation evidence summary" description="Evidence counts by validation state, plus recent validation records.">
          <div className="admin-summary-row">
            <StatusBadge label={`${validationSummary.verified} verified`} tone="verified" />
            <StatusBadge label={`${validationSummary.needsReview} needs review`} tone="review" />
            <StatusBadge label={`${validationSummary.failed} failed`} tone="danger" />
            <StatusBadge label={`${validationSummary.notValidated} not validated`} tone="neutral" />
          </div>
          {recentValidationRows.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Asset</th>
                    <th>Validation</th>
                    <th>Evidence type</th>
                    <th>Validator</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentValidationRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/parts/${row.partId}`}>
                          <span className="ui-mono">{row.mpn}</span>
                        </Link>
                      </td>
                      <td>
                        {row.assetType ? formatAssetType(row.assetType) : "Asset"}
                        <div className="ui-mono muted-copy">{row.assetId}</div>
                      </td>
                      <td>
                        <StatusBadge label={formatValidationStatus(row.validationStatus)} tone={validationStatusTone(row.validationStatus)} />
                      </td>
                      <td>{formatValidationType(row.validationType)}</td>
                      <td>{row.validator}</td>
                      <td>{formatDateTime(row.validatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No validation records" body="No validation evidence recorded in the current catalog window." />
          )}
        </SectionPanel>
        <SectionPanel title="CAD trust checks needing attention" description="Failed or review-required checks, plus CAD files marked for validation review with no evidence yet.">
          {recentValidationAttentionRows.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Asset</th>
                    <th>Check</th>
                    <th>State</th>
                    <th>What to do</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recentValidationAttentionRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/parts/${row.partId}#files-heading`}>
                          <span className="ui-mono">{row.mpn}</span>
                        </Link>
                        <div className="muted-copy">{row.manufacturerName}</div>
                      </td>
                      <td>
                        {formatAssetType(row.assetType)}
                        <div className="ui-mono muted-copy">{row.assetId}</div>
                      </td>
                      <td>{row.validationTypeLabel}</td>
                      <td>
                        <StatusBadge label={row.stateLabel} tone={row.stateTone} />
                      </td>
                      <td>
                        {row.nextAction}
                        <div className="muted-copy">{row.detail}</div>
                      </td>
                      <td>{formatDateTime(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No CAD trust checks need attention" body="Failed and review-required CAD checks are clear in the current catalog window." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="audit-heading">
        <SectionHeading id="audit-heading" index="06" title="Verification audit history" subtitle="Recent verification attempts with who, the outcome, and any blocker reasons." />
        <SectionPanel title="Recent verification audits" description="Verification outcomes are recorded even when denied by a blocker.">
          {promotionAudits.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Asset</th>
                    <th>Outcome</th>
                    <th>Actor</th>
                    <th>Time</th>
                    <th>Blockers</th>
                  </tr>
                </thead>
                <tbody>
                  {promotionAudits.map((audit) => (
                    <tr key={audit.id}>
                      <td>
                        <Link href={`/parts/${audit.partId}`}>
                          <span className="ui-mono">{audit.mpn}</span>
                        </Link>
                      </td>
                      <td className="ui-mono">{audit.assetId}</td>
                      <td>
                        <StatusBadge label={audit.outcome} tone={audit.outcome.includes("denied") ? "review" : "verified"} />
                      </td>
                      <td>{audit.actor}</td>
                      <td>{formatDateTime(audit.createdAt)}</td>
                      <td>
                        {audit.blockerReasons.length > 0 ? (
                          <ul className="admin-inline-list">
                            {audit.blockerReasons.map((reason) => (
                              <li key={`${audit.id}-${reason}`}>{reason}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="muted-copy">No blockers</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No verification audits" body="No verification attempts recorded in the current catalog window." />
          )}
        </SectionPanel>
      </section>

      <AdminUserActionAuditSection auditEventState={auditEventState} />
    </main>
  );
}

/**
 * Renders the general API action audit trail without exposing request payloads.
 */
function AdminUserActionAuditSection({ auditEventState }: { auditEventState: AdminAuditEventState }): React.ReactElement {
  const filters = auditEventState.filters;
  const hasActiveFilters = Boolean(filters.actorId || filters.action || filters.targetType || filters.targetId || filters.outcome);

  return (
    <section className="detail-section" aria-labelledby="user-action-audit-heading">
      <SectionHeading
        id="user-action-audit-heading"
        index="07"
        title="User action audit trail"
        subtitle="Recent API write attempts with actor, target, outcome, and request correlation."
      />
      <SectionPanel
        title="Filter audit timeline"
        description="Narrow by actor, action, target, or outcome. Clear filters to see all recent events."
      >
        <form className="audit-filter-form" method="get" action="/admin">
          <label className="audit-filter-form__field">
            <span>Actor id</span>
            <input defaultValue={filters.actorId ?? ""} name="auditActorId" placeholder="user id" type="search" />
          </label>
          <label className="audit-filter-form__field">
            <span>Action</span>
            <input defaultValue={filters.action ?? ""} name="auditAction" placeholder="project.update" type="search" />
          </label>
          <label className="audit-filter-form__field">
            <span>Target type</span>
            <input defaultValue={filters.targetType ?? ""} name="auditTargetType" placeholder="project, part, asset" type="search" />
          </label>
          <label className="audit-filter-form__field">
            <span>Target id</span>
            <input defaultValue={filters.targetId ?? ""} name="auditTargetId" placeholder="entity id" type="search" />
          </label>
          <label className="audit-filter-form__field">
            <span>Outcome</span>
            <select defaultValue={filters.outcome ?? ""} name="auditOutcome">
              <option value="">Any outcome</option>
              <option value="succeeded">Succeeded</option>
              <option value="denied">Denied</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <div className="audit-filter-form__actions">
            <button type="submit">Apply filters</button>
            {hasActiveFilters ? (
              <Link className="button-link button-link--quiet" href="/admin#user-action-audit-heading">
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      </SectionPanel>
      <SectionPanel
        title="Recent user actions"
        description={auditEventState.status === "ready" ? auditEventState.boundary : "Audit events are unavailable until the API audit store is reachable."}
      >
        {auditEventState.status === "ready" && auditEventState.events.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--dense">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Actor</th>
                  <th>Outcome</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {auditEventState.events.map((event) => (
                  <tr key={event.id}>
                    <td className="ui-mono">{event.action}</td>
                    <td>
                      {formatAuditTarget(event)}
                      <p className="muted-copy">{event.method} {event.path}</p>
                    </td>
                    <td>{event.actorId ? `${event.actorId} (${event.actorRole ?? "role unknown"})` : "Unauthenticated"}</td>
                    <td>
                      <StatusBadge label={formatAuditOutcome(event.outcome)} tone={auditOutcomeTone(event.outcome)} />
                    </td>
                    <td>{event.statusCode}</td>
                    <td>{formatDateTime(event.occurredAt)}</td>
                    <td className="ui-mono">{event.requestId.slice(0, 12)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : auditEventState.status === "ready" ? (
          <EmptyState title="No audit events" body="No API write actions are recorded yet." />
        ) : (
          <EmptyState title="Audit trail unavailable" body={auditEventState.message} />
        )}
      </SectionPanel>
    </section>
  );
}

/**
 * Loads recent user-action audit events without blocking the rest of the admin workspace.
 */
async function loadAdminAuditEvents(filters: AuditEventQueryFilters): Promise<AdminAuditEventState> {
  try {
    const response = await fetchAuditEvents(20, await getServerApiAuthHeaders(), filters);
    return { boundary: response.boundary, events: response.events, filters, status: "ready" };
  } catch (error) {
    return {
      filters,
      message: isApiClientError(error) ? `${error.code}: ${error.message}` : "Audit event API request failed.",
      status: "unavailable"
    };
  }
}

/**
 * Narrows search-param strings into the typed AuditEventQueryFilters shape. Untyped
 * outcome values are dropped so they cannot reach the API.
 */
function readAuditFiltersFromSearchParams(searchParams: AdminPageSearchParams): AuditEventQueryFilters {
  const filters: AuditEventQueryFilters = {};
  const actorId = readFirst(searchParams.auditActorId);
  const action = readFirst(searchParams.auditAction);
  const targetType = readFirst(searchParams.auditTargetType);
  const targetId = readFirst(searchParams.auditTargetId);
  const outcome = readFirst(searchParams.auditOutcome);

  if (actorId) filters.actorId = actorId;
  if (action) filters.action = action;
  if (targetType) filters.targetType = targetType;
  if (targetId) filters.targetId = targetId;
  if (outcome === "succeeded" || outcome === "failed" || outcome === "denied") {
    filters.outcome = outcome;
  }

  return filters;
}

/**
 * Returns the first value from a Next.js search-param entry that may be string or array.
 */
function readFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Builds API auth headers for server-rendered admin reads by forwarding the current session cookie.
 */
async function getServerApiAuthHeaders(): Promise<Record<string, string>> {
  let cookieHeader: string | null = null;
  try {
    cookieHeader = (await headers()).get("cookie");
  } catch {
    cookieHeader = null;
  }

  const base = process.env["NEXTAUTH_URL"] ?? "http://localhost:3000";
  const response = await fetch(`${base}/api/token`, {
    cache: "no-store",
    headers: cookieHeader ? { cookie: cookieHeader } : {}
  });

  if (!response.ok) {
    return {};
  }

  const body = (await response.json()) as { token?: unknown };

  return typeof body.token === "string" && body.token.length > 0 ? { Authorization: `Bearer ${body.token}` } : {};
}

/**
 * Formats one audit target for compact admin tables.
 */
function formatAuditTarget(event: AuditEvent): string {
  return event.targetId ? `${event.targetType}:${event.targetId}` : event.targetType;
}

/**
 * Formats audit outcomes for badges.
 */
function formatAuditOutcome(outcome: AuditEvent["outcome"]): string {
  return {
    denied: "Denied",
    failed: "Failed",
    succeeded: "Succeeded"
  }[outcome];
}

/**
 * Maps audit outcomes to the shared badge palette.
 */
function auditOutcomeTone(outcome: AuditEvent["outcome"]): BadgeTone {
  if (outcome === "succeeded") {
    return "verified";
  }
  if (outcome === "denied") {
    return "danger";
  }
  return "review";
}

/**
 * Builds the compact queue statistics shown above the admin tables.
 */
function buildAdminOverviewStats(
  reviewQueue: ReviewQueueItem[],
  promotionQueue: PromotionQueueItem[],
  failedImportCount: number,
  validationIssueCount: number,
  issueQueueRows: OverviewQueueRow[],
  assistantTriageCount: number
): AdminQueueOverviewStat[] {
  const eligiblePromotionCount = promotionQueue.filter((item) => item.canPromote).length;
  const blockedPromotionCount = promotionQueue.length - eligiblePromotionCount;
  const validationIssueTone: BadgeTone = validationIssueCount > 0 ? "review" : "verified";
  const pendingApprovalCount = countQueueRows(issueQueueRows, "approval");
  const identityFollowUpCount = countQueueRows(issueQueueRows, "identity");
  const cadGapCount = countQueueRows(issueQueueRows, "cad_gaps");
  const connectorGapCount = countQueueRows(issueQueueRows, "connector");
  const duplicateCount = countQueueRows(issueQueueRows, "duplicates");
  const assistantTriageTone: BadgeTone = assistantTriageCount > 0 ? "generated" : "verified";

  return [
    { label: "Assistant triage", tone: assistantTriageTone, value: assistantTriageCount },
    { label: "Review items", tone: "review" as const, value: reviewQueue.length },
    { label: "Files waiting to verify", tone: "info" as const, value: promotionQueue.length },
    { label: "Ready to verify", tone: "verified" as const, value: eligiblePromotionCount },
    { label: "Blocked from verify", tone: "review" as const, value: blockedPromotionCount },
    { label: "Pending approval", tone: "info" as const, value: pendingApprovalCount },
    { label: "Identity follow-up", tone: "review" as const, value: identityFollowUpCount },
    { label: "Missing verified CAD", tone: "review" as const, value: cadGapCount },
    { label: "Connector gaps", tone: "review" as const, value: connectorGapCount },
    ...(duplicateCount > 0 ? [{ label: "Duplicate candidates", tone: "review" as const, value: duplicateCount }] : []),
    { label: "Failed imports", tone: "danger" as const, value: failedImportCount },
    { label: "Validation issues", tone: validationIssueTone, value: validationIssueCount }
  ];
}

/**
 * Builds grouped admin buckets and keeps unsupported V3 buckets explicitly unavailable.
 */
function buildAdminOverviewGroups(
  reviewQueue: ReviewQueueItem[],
  promotionQueue: PromotionQueueItem[],
  failedImportCount: number,
  validationIssueCount: number,
  issueQueueRows: OverviewQueueRow[],
  assistantTriageCount: number
): AdminQueueOverviewGroup[] {
  const groups: AdminQueueOverviewGroup[] = [];

  pushAdminOverviewGroup(groups, assistantTriageCount, {
    description: "Review-prep packets built from existing evidence. They do not approve, normalize, or verify anything.",
    id: "assistant_triage",
    label: "Assistant triage prep",
    tone: "generated"
  });
  pushAdminOverviewGroup(groups, reviewQueue.length, {
    description: "Generated files and generation workflows waiting for an explicit review decision.",
    id: "review",
    label: "Drafts and review-required files",
    tone: "review"
  });
  pushAdminOverviewGroup(groups, promotionQueue.length, {
    description: "Approved files that still need the final verification step or a blocker review.",
    id: "promotion",
    label: "Files to mark verified",
    tone: "info"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "approval"), {
    description: "Part approval is still pending or not requested, so engineering use needs follow-up.",
    id: "approval",
    label: "Pending approval",
    tone: "info"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "identity"), {
    description: "Identity confidence or source is still below the confirmed threshold.",
    id: "identity",
    label: "Low-confidence identity",
    tone: "review"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "cad_gaps"), {
    description: "Stored CAD files are missing or incomplete for these parts.",
    id: "cad_gaps",
    label: "Missing verified CAD",
    tone: "review"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "connector"), {
    description: "Connector mate or accessory coverage still needs engineering follow-up.",
    id: "connector",
    label: "Connector coverage gaps",
    tone: "review"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "duplicates"), {
    description: "Possible duplicate catalog rows need merge, dismissal, or reconciliation.",
    id: "duplicates",
    label: "Duplicate candidates",
    tone: "review"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "lifecycle"), {
    description: "Lifecycle risk is visible on the part record and needs design-use review.",
    id: "lifecycle",
    label: "Lifecycle risk",
    tone: "danger"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "source_conflicts"), {
    description: "Provider or source records conflict or look unhealthy and need investigation.",
    id: "source_conflicts",
    label: "Source conflicts",
    tone: "review"
  });
  pushAdminOverviewGroup(groups, failedImportCount, {
    description: "Provider source rows that failed to import, with the original error text.",
    id: "imports",
    label: "Failed imports",
    tone: "danger"
  });
  pushAdminOverviewGroup(groups, validationIssueCount, {
    description: "Validation records that are failed, not validated, or still need review.",
    id: "validation",
    label: "Validation evidence issues",
    tone: "review"
  });

  return groups;
}

/**
 * Flattens supported queues into one dense table model for the interactive table view.
 */
function buildAdminOverviewTableRows(
  reviewQueue: ReviewQueueItem[],
  promotionQueue: PromotionQueueItem[],
  failedImportRows: ImportRow[],
  validationAttentionRows: ValidationAttentionRow[],
  issueQueueRows: OverviewQueueRow[],
  assistantTriageRows: AssistantTriageRow[]
): AdminQueueTableRow[] {
  const rows: OverviewQueueRow[] = [
    ...assistantTriageRows.map((row) => ({
      detail: `${row.attentionReason}. ${row.nextAction}`,
      href: `/parts/${row.partId}`,
      id: `assistant-triage-${row.partId}`,
      manufacturerName: row.manufacturerName,
      mpn: row.mpn,
      queueId: "assistant_triage",
      queueLabel: "Assistant triage prep",
      stateLabel: row.stateLabel,
      stateTone: row.stateTone,
      updatedAtRaw: row.updatedAt,
      updatedLabel: formatDateTime(row.updatedAt)
    })),
    ...reviewQueue.map((item) => ({
      detail: `${item.context}. ${item.detail}`,
      href: `/parts/${item.partId}`,
      id: `review-${item.targetType}-${item.targetId}`,
      manufacturerName: item.manufacturerName,
      mpn: item.mpn,
      queueId: "review",
      queueLabel: "Review queue",
      stateLabel: item.reviewStateLabel,
      stateTone: item.reviewStateTone,
      updatedAtRaw: item.updatedAt,
      updatedLabel: formatDateTime(item.updatedAt)
    })),
    ...promotionQueue.map((item) => ({
      detail: item.blockerReasons.length > 0 ? item.blockerReasons.join(" ") : item.validationReason,
      href: `/parts/${item.partId}`,
      id: `promotion-${item.assetId}`,
      manufacturerName: item.manufacturerName,
      mpn: item.mpn,
      queueId: "promotion",
      queueLabel: "Files to mark verified",
      stateLabel: item.canPromote ? "Ready to verify" : "Blocked",
      stateTone: item.canPromote ? ("verified" as const) : ("review" as const),
      updatedAtRaw: item.updatedAt,
      updatedLabel: formatDateTime(item.updatedAt)
      })),
    ...issueQueueRows,
    ...failedImportRows.map((row) => ({
      detail: `${row.providerId} - ${row.importErrorDetails ?? "No error details"}`,
      href: `/parts/${row.partId}`,
      id: `import-${row.partId}-${row.providerId}`,
      manufacturerName: row.providerId,
      mpn: row.mpn,
      queueId: "imports",
      queueLabel: "Failed imports",
      stateLabel: "Failed",
      stateTone: "danger" as const,
      updatedAtRaw: row.sourceLastImportedAt ?? "1970-01-01T00:00:00.000Z",
      updatedLabel: row.sourceLastImportedAt ? formatDateTime(row.sourceLastImportedAt) : "No successful import"
    })),
    ...validationAttentionRows
      .map((row) => ({
        detail: `${row.validationTypeLabel} - ${row.detail}`,
        href: `/parts/${row.partId}#files-heading`,
        id: `validation-${row.id}`,
        manufacturerName: row.manufacturerName,
        mpn: row.mpn,
        queueId: "validation",
        queueLabel: "Validation issues",
        stateLabel: row.stateLabel,
        stateTone: row.stateTone,
        updatedAtRaw: row.updatedAt,
        updatedLabel: formatDateTime(row.updatedAt)
      }))
  ];

  return rows
    .sort((left, right) => left.queueLabel.localeCompare(right.queueLabel) || Date.parse(right.updatedAtRaw) - Date.parse(left.updatedAtRaw) || left.mpn.localeCompare(right.mpn))
    .map(({ updatedAtRaw: _updatedAtRaw, ...row }) => row);
}

/**
 * Builds issue-driven admin rows from backend part issues, approval state, and risk flags.
 */
function buildIssueQueueRows(records: PartSearchRecord[]): OverviewQueueRow[] {
  const rows: OverviewQueueRow[] = [];

  for (const record of records) {
    const matchingApprovalIssues = collectIssues(record, ["pending_approval"]);
    if (matchingApprovalIssues.length > 0) {
      rows.push(
        createIssueQueueRow(record, {
          detail: record.approval.detail,
          queueId: "approval",
          queueLabel: "Pending approval",
          stateLabel: record.approval.summary,
          stateTone: approvalQueueTone(record.approval.status),
          updatedAtRaw: latestTimestamp([
            record.approval.lastUpdatedAt,
            ...matchingApprovalIssues.map((issue) => issue.lastUpdatedAt)
          ])
        })
      );
    }

    const matchingIdentityIssues = collectIssues(record, ["low_confidence_identity"]);
    if (matchingIdentityIssues.length > 0) {
      rows.push(
        createIssueQueueRow(record, {
          detail: joinIssueDetails(matchingIdentityIssues),
          queueId: "identity",
          queueLabel: "Low-confidence identity",
          stateLabel: record.readinessSummary.identityStatus === "unknown" ? "Identity unknown" : "Identity needs confirmation",
          stateTone: issueTone(matchingIdentityIssues),
          updatedAtRaw: latestTimestamp(matchingIdentityIssues.map((issue) => issue.lastUpdatedAt))
        })
      );
    }

    const matchingCadIssues = collectIssues(record, ["missing_verified_cad"]);
    if (matchingCadIssues.length > 0) {
      rows.push(
        createIssueQueueRow(record, {
          detail: joinIssueDetails(matchingCadIssues),
          queueId: "cad_gaps",
          queueLabel: "Missing verified CAD",
          stateLabel: record.readinessSummary.label,
          stateTone: issueTone(matchingCadIssues),
          updatedAtRaw: latestTimestamp(matchingCadIssues.map((issue) => issue.lastUpdatedAt))
        })
      );
    }

    const matchingConnectorIssues = collectIssues(record, ["connector_low_confidence", "missing_connector_accessories", "missing_connector_mate"]);
    if (matchingConnectorIssues.length > 0) {
      rows.push(
        createIssueQueueRow(record, {
          detail: joinIssueDetails(matchingConnectorIssues),
          queueId: "connector",
          queueLabel: "Connector coverage gaps",
          stateLabel: "Connector follow-up",
          stateTone: issueTone(matchingConnectorIssues),
          updatedAtRaw: latestTimestamp(matchingConnectorIssues.map((issue) => issue.lastUpdatedAt))
        })
      );
    }

    const matchingDuplicateIssues = collectIssues(record, ["duplicate_candidate"]);
    if (matchingDuplicateIssues.length > 0) {
      rows.push(
        createIssueQueueRow(record, {
          detail: joinIssueDetails(matchingDuplicateIssues),
          queueId: "duplicates",
          queueLabel: "Duplicate candidates",
          stateLabel: `${record.duplicateCandidates.length} possible matches`,
          stateTone: issueTone(matchingDuplicateIssues),
          updatedAtRaw: latestTimestamp(matchingDuplicateIssues.map((issue) => issue.lastUpdatedAt))
        })
      );
    }

    const matchingLifecycleIssues = collectIssues(record, ["lifecycle_risk"]);
    const matchingLifecycleRiskFlags = collectRiskFlags(record, ["lifecycle_not_active"]);
    if (matchingLifecycleIssues.length > 0 || matchingLifecycleRiskFlags.length > 0) {
      rows.push(
        createIssueQueueRow(record, {
          detail: joinIssueAndRiskDetails(matchingLifecycleIssues, matchingLifecycleRiskFlags),
          queueId: "lifecycle",
          queueLabel: "Lifecycle risk",
          stateLabel: `Lifecycle ${record.part.lifecycleStatus}`,
          stateTone: matchingLifecycleRiskFlags.some((flag) => flag.tone === "danger") || matchingLifecycleIssues.some((issue) => issue.severity === "error") ? "danger" : "review",
          updatedAtRaw: latestTimestamp([
            ...matchingLifecycleIssues.map((issue) => issue.lastUpdatedAt),
            ...matchingLifecycleRiskFlags.map((flag) => flag.lastUpdatedAt)
          ])
        })
      );
    }

    const matchingSourceConflictIssues = collectIssues(record, ["source_conflict"]);
    const matchingSourceConflictRiskFlags = collectRiskFlags(record, ["source_conflict"]);
    if (matchingSourceConflictIssues.length > 0 || matchingSourceConflictRiskFlags.length > 0) {
      rows.push(
        createIssueQueueRow(record, {
          detail: joinIssueAndRiskDetails(matchingSourceConflictIssues, matchingSourceConflictRiskFlags),
          queueId: "source_conflicts",
          queueLabel: "Source conflicts",
          stateLabel: formatSourceReconciliationStatus(record.sourceReconciliation?.resolutionStatus),
          stateTone: issueTone(matchingSourceConflictIssues),
          updatedAtRaw: latestTimestamp([
            ...matchingSourceConflictIssues.map((issue) => issue.lastUpdatedAt),
            ...matchingSourceConflictRiskFlags.map((flag) => flag.lastUpdatedAt)
          ])
        })
      );
    }
  }

  return rows;
}

/**
 * Builds the issue-operations table so operators can resolve or reopen backend-derived issues.
 */
function buildIssueWorkflowRows(records: PartSearchRecord[]): IssueWorkflowRow[] {
  const rows: IssueWorkflowRow[] = [];

  for (const record of records) {
    for (const issue of record.issues) {
      rows.push({
        detail: issue.detail,
        duplicateContext: issue.code === "duplicate_candidate" ? formatDuplicateCandidateContext(record) : null,
        issue,
        manufacturerName: record.manufacturer.name,
        mpn: record.part.mpn,
        partId: record.part.id,
        preferredSourceRecordId: record.sourceReconciliation?.preferredSourceRecordId ?? record.sources[0]?.id ?? null,
        queueLabel: formatIssueQueueLabel(issue.code),
        sourceReconciliationContext: issue.code === "source_conflict" ? formatSourceReconciliationContext(record) : null,
        sourceReconciliationNotes: issue.code === "source_conflict" ? record.sourceReconciliation?.notes ?? null : null
      });
    }
  }

  return rows.sort(
    (left, right) =>
      issueWorkflowSortScore(left.issue.status) - issueWorkflowSortScore(right.issue.status) ||
      Date.parse(right.issue.resolvedAt ?? right.issue.lastUpdatedAt) - Date.parse(left.issue.resolvedAt ?? left.issue.lastUpdatedAt) ||
      left.mpn.localeCompare(right.mpn)
  );
}

/**
 * Renders a compact admin snapshot so queue pressure is visible before the detailed tables.
 */
function AdminHeroSnapshot({ stats }: { stats: AdminQueueOverviewStat[] }) {
  return (
    <aside aria-label="Admin queue snapshot" className="admin-hero__snapshot">
      {stats.map((stat) => (
        <div className={`admin-hero-stat admin-hero-stat--${stat.tone}`} key={stat.label}>
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </div>
      ))}
    </aside>
  );
}

/**
 * Selects the most decision-critical queue counts for the admin hero snapshot.
 */
function selectAdminHeroStats(stats: AdminQueueOverviewStat[]): AdminQueueOverviewStat[] {
  const preferredLabels = ["Assistant triage", "Review items", "Eligible promotions", "Pending approval", "Missing verified CAD", "Failed imports", "Validation issues"];

  return preferredLabels
    .map((label) => stats.find((stat) => stat.label === label))
    .filter((stat): stat is AdminQueueOverviewStat => Boolean(stat));
}

/**
 * Formats duplicate candidate context for dense admin tables.
 */
function formatDuplicateCandidateContext(record: PartSearchRecord): string | null {
  if (record.duplicateCandidates.length === 0) {
    return null;
  }

  return record.duplicateCandidates
    .slice(0, 3)
    .map((candidate) => `${candidate.duplicatePartMpn} (${candidate.duplicateManufacturerName})`)
    .join(", ");
}

/**
 * Formats source reconciliation state without implying the conflict has disappeared.
 */
function formatSourceReconciliationContext(record: PartSearchRecord): string {
  if (!record.sourceReconciliation) {
    return "No reconciliation decision recorded yet.";
  }

  const statusLabel = formatSourceReconciliationStatus(record.sourceReconciliation.resolutionStatus);

  return record.sourceReconciliation.notes
    ? `${statusLabel}. ${record.sourceReconciliation.notes}`
    : `${statusLabel}.`;
}

/**
 * Maps issue codes into operator-facing queue labels.
 */
function formatIssueQueueLabel(code: PartIssueCode): string {
  return {
    connector_low_confidence: "Connector coverage gaps",
    duplicate_candidate: "Duplicate candidates",
    lifecycle_risk: "Lifecycle risk",
    low_confidence_identity: "Low-confidence identity",
    missing_connector_accessories: "Connector coverage gaps",
    missing_connector_mate: "Connector coverage gaps",
    missing_datasheet: "Missing datasheet",
    missing_verified_cad: "Missing verified CAD",
    pending_approval: "Pending approval",
    source_conflict: "Source conflicts"
  }[code];
}

/**
 * Creates one queue row shape from a part record plus queue-specific state.
 */
function createIssueQueueRow(
  record: PartSearchRecord,
  config: {
    detail: string;
    queueId: IssueQueueId;
    queueLabel: string;
    stateLabel: string;
    stateTone: BadgeTone;
    updatedAtRaw: string;
  }
): OverviewQueueRow {
  return {
    detail: config.detail,
    href: `/parts/${record.part.id}`,
    id: `${config.queueId}-${record.part.id}`,
    manufacturerName: record.manufacturer.name,
    mpn: record.part.mpn,
    queueId: config.queueId,
    queueLabel: config.queueLabel,
    stateLabel: config.stateLabel,
    stateTone: config.stateTone,
    updatedAtRaw: config.updatedAtRaw,
    updatedLabel: formatDateTime(config.updatedAtRaw)
  };
}

/**
 * Adds one overview group only when the backend currently emits data for it.
 */
function pushAdminOverviewGroup(
  groups: AdminQueueOverviewGroup[],
  count: number,
  config: { description: string; id: string; label: string; tone: BadgeTone }
): void {
  if (count <= 0) {
    return;
  }

  groups.push({
    count,
    description: config.description,
    id: config.id,
    label: config.label,
    tone: config.tone
  });
}

/**
 * Counts queue rows by id for stats and grouped cards.
 */
function countQueueRows(rows: OverviewQueueRow[], queueId: OverviewQueueRow["queueId"]): number {
  return rows.filter((row) => row.queueId === queueId).length;
}

/**
 * Collects matching issue codes from one part record.
 */
function collectIssues(record: PartSearchRecord, codes: PartIssueCode[]): PartIssue[] {
  return record.issues.filter((issue) => codes.includes(issue.code) && issue.status !== "resolved" && issue.status !== "ignored");
}

/**
 * Collects matching risk-flag codes from one part record.
 */
function collectRiskFlags(record: PartSearchRecord, codes: PartRiskFlagCode[]) {
  return record.riskFlags.filter((flag) => codes.includes(flag.code));
}

/**
 * Collapses issue detail into one readable admin-table sentence.
 */
function joinIssueDetails(issues: PartIssue[]): string {
  return issues.map((issue) => issue.detail).join(" ");
}

/**
 * Collapses mixed issue and risk-flag detail into one readable admin-table sentence.
 */
function joinIssueAndRiskDetails(
  issues: PartIssue[],
  riskFlags: Array<Pick<PartSearchRecord["riskFlags"][number], "detail">>
): string {
  return [...issues.map((issue) => issue.detail), ...riskFlags.map((flag) => flag.detail)].join(" ");
}

/**
 * Maps issue workflow state into a compact admin badge label.
 */
function formatIssueWorkflowStatus(status: PartIssueWorkflowStatus): string {
  return {
    ignored: "Ignored",
    in_review: "In review",
    open: "Open",
    resolved: "Resolved"
  }[status];
}

/**
 * Maps issue workflow state into admin badge tone.
 */
function issueWorkflowTone(status: PartIssueWorkflowStatus): BadgeTone {
  if (status === "resolved") {
    return "verified";
  }

  if (status === "ignored") {
    return "neutral";
  }

  if (status === "in_review") {
    return "info";
  }

  return "review";
}

/**
 * Maps source reconciliation state into operator-facing badge text.
 */
function formatSourceReconciliationStatus(status: SourceReconciliationStatus | undefined): string {
  if (status === "canonical_source_selected") {
    return "Canonical source selected";
  }

  if (status === "mixed_sources_accepted") {
    return "Mixed sources accepted";
  }

  return "Source follow-up";
}

/**
 * Sorts workflow rows so open work stays ahead of resolved or ignored items.
 */
function issueWorkflowSortScore(status: PartIssueWorkflowStatus): number {
  return {
    open: 0,
    in_review: 1,
    resolved: 2,
    ignored: 3
  }[status];
}

/**
 * Maps matching issue severities into one badge tone for the queue row.
 */
function issueTone(issues: PartIssue[]): BadgeTone {
  return issues.some((issue) => issue.severity === "error") ? "danger" : "review";
}

/**
 * Maps approval state into the admin queue badge tone.
 */
function approvalQueueTone(status: PartApprovalStatus): BadgeTone {
  if (status === "pending_review") {
    return "info";
  }

  if (status === "not_requested") {
    return "review";
  }

  return "neutral";
}

/**
 * Picks the latest timestamp for queue ordering while falling back safely to epoch.
 */
function latestTimestamp(timestamps: string[]): string {
  return timestamps
    .filter((timestamp) => timestamp.length > 0)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? "1970-01-01T00:00:00.000Z";
}

async function loadAdminCatalog(): Promise<AdminCatalogState> {
  const healthPromise = fetchApiHealth();

  try {
    const filters: PartSearchFilters = {
      cadAvailability: "any",
      page: 1,
      pageSize: 200,
      sort: "updated_desc"
    };
    const [health, envelope] = await Promise.all([healthPromise, fetchPartSearchEnvelope(filters)]);

    return {
      health,
      records: envelope.data,
      source: envelope.source ?? "database",
      status: "ready",
      warnings: envelope.warnings ?? []
    };
  } catch (error) {
    if (isApiClientError(error)) {
      return {
        code: error.code,
        health: await healthPromise,
        message: error.message,
        status: "setup_required"
      };
    }

    return {
      code: "API_UNAVAILABLE",
      health: await healthPromise,
      message: "The API could not be reached, so admin workflows are unavailable.",
      status: "setup_required"
    };
  }
}

function AdminSetupState({ catalogState }: { catalogState: Extract<AdminCatalogState, { status: "setup_required" }> }) {
  return (
    <main className="admin-layout">
      <section className="admin-hero">
        <div>
          <p className="app-kicker">Admin workspace</p>
          <h1>Review and trust maintenance</h1>
          <p className="admin-hero__lede">{getSetupStateCopy(catalogState.code).body} Connect the catalog before using review, verification, or audit features.</p>
        </div>
        <div className="admin-hero__status">
          <StatusBadge label={catalogState.code} tone="review" />
          <StatusBadge label={`Database ${catalogState.health?.dependencies.database ?? "unknown"}`} tone={catalogState.health?.dependencies.database === "connected" ? "verified" : "review"} />
        </div>
        <p className="mode-warning">{catalogState.message}</p>
      </section>
      <SectionPanel title="Setup guidance" description="Admin tools need the database-backed catalog to be reachable.">
        <div className="setup-steps">
          <div>
            <strong>Canonical database</strong>
            <code>$env:DATABASE_URL=&quot;postgres://ee_library:ee_library@127.0.0.1:5432/ee_library&quot;</code>
            <code>npm run ingest:local</code>
            <code>npm run dev</code>
          </div>
          <div>
            <strong>Explicit local seed</strong>
            <code>$env:EE_LIBRARY_ALLOW_SEED_FALLBACK=&quot;true&quot;</code>
            <code>npm run dev</code>
            <span>Seed mode is for local examples, not production work.</span>
          </div>
        </div>
      </SectionPanel>
    </main>
  );
}

/**
 * Renders compact admin guidance cards so operators can keep review, promotion, and coverage truth in view.
 */
function AdminTruthRail() {
  return (
    <section aria-label="Admin guidance" className="admin-truth-rail">
      <div>
        <span>Review</span>
        <strong>Approving a part does not make exports available.</strong>
        <p>Approved or reviewed files still need stored validation evidence and a final verification step before export.</p>
      </div>
      <div>
        <span>Verification</span>
        <strong>Marking files verified stays a separate step.</strong>
        <p>It is a separate step so you can see exactly which files are ready now and which are still blocked.</p>
      </div>
      <div>
        <span>Coverage</span>
        <strong>Queues only appear when there is something in them.</strong>
        <p>Queues for identity, connector coverage, lifecycle, and source conflicts stay hidden until there is something to handle.</p>
      </div>
    </section>
  );
}

function buildReviewQueue(records: PartSearchRecord[]): ReviewQueueItem[] {
  const queue: ReviewQueueItem[] = [];

  for (const record of records) {
    for (const asset of record.assets) {
      const reviewStatus = getAssetReviewStatus(asset, record.reviewRecords);
      if (reviewStatus.state !== "pending_review" && reviewStatus.state !== "changes_requested") {
        continue;
      }

      queue.push({
        context: `${formatAssetType(asset.assetType)} - ${formatAssetProvenance(asset.provenance)}`,
        detail: asset.provenance === "generated" ? "Generated draft requires explicit review outcome." : "Asset is marked review-required by current trust state.",
        manufacturerName: record.manufacturer.name,
        mpn: record.part.mpn,
        partId: record.part.id,
        reviewStateLabel: formatReviewStateLabel(reviewStatus.state),
        reviewStateTone: mapViewToneToBadge(reviewStateTone(reviewStatus.state)),
        targetId: asset.id,
        targetType: "asset",
        trustLineageLabel: formatCompactTrustLineage(record),
        updatedAt: asset.lastUpdatedAt
      });
    }

    for (const workflow of record.generationWorkflows) {
      const reviewStatus = getWorkflowReviewStatus(workflow, record.reviewRecords);
      if (reviewStatus.state !== "pending_review" && reviewStatus.state !== "changes_requested") {
        continue;
      }

      queue.push({
        context: `${formatAssetType(workflow.targetAssetType)} generation workflow`,
        detail: "Generated output workflow requires explicit review outcome before trust can advance.",
        manufacturerName: record.manufacturer.name,
        mpn: record.part.mpn,
        partId: record.part.id,
        reviewStateLabel: formatReviewStateLabel(reviewStatus.state),
        reviewStateTone: mapViewToneToBadge(reviewStateTone(reviewStatus.state)),
        targetId: workflow.id,
        targetType: "generation_workflow",
        trustLineageLabel: formatCompactTrustLineage(record),
        updatedAt: record.lastUpdatedAt
      });
    }
  }

  return queue.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.mpn.localeCompare(right.mpn));
}

function buildPromotionQueue(records: PartSearchRecord[]): PromotionQueueItem[] {
  const queue: PromotionQueueItem[] = [];

  for (const record of records) {
    for (const asset of record.assets) {
      const reviewStatus = getAssetReviewStatus(asset, record.reviewRecords);
      if (reviewStatus.state !== "approved" || isValidatedDownloadableAsset(asset)) {
        continue;
      }

      const promotionSummary = getAssetPromotionSummary(asset, record.validationRecords, record.promotionAudits);
      const validationSummary = getAssetValidationSummary(asset, record.validationRecords);

      queue.push({
        assetId: asset.id,
        assetType: asset.assetType,
        blockerReasons: promotionSummary.blockerReasons,
        canPromote: promotionSummary.canPromote,
        manufacturerName: record.manufacturer.name,
        mpn: record.part.mpn,
        partId: record.part.id,
        trustLineageLabel: formatCompactTrustLineage(record),
        updatedAt: asset.lastUpdatedAt,
        validationReason: validationSummary.reason
      });
    }
  }

  return queue.sort((left, right) => Number(right.canPromote) - Number(left.canPromote) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.mpn.localeCompare(right.mpn));
}

function buildImportRows(records: PartSearchRecord[]): ImportRow[] {
  const rows: ImportRow[] = [];

  for (const record of records) {
    for (const source of record.sources) {
      rows.push({
        importErrorDetails: source.importErrorDetails,
        importStatus: source.importStatus,
        mpn: record.part.mpn,
        partId: record.part.id,
        providerId: source.providerId,
        sourceLastImportedAt: source.sourceLastImportedAt
      });
    }
  }

  return rows.sort((left, right) => Date.parse(right.sourceLastImportedAt ?? "1970-01-01T00:00:00.000Z") - Date.parse(left.sourceLastImportedAt ?? "1970-01-01T00:00:00.000Z") || left.mpn.localeCompare(right.mpn));
}

function buildValidationRows(records: PartSearchRecord[]): ValidationRow[] {
  const rows: ValidationRow[] = [];

  for (const record of records) {
    for (const validation of record.validationRecords) {
      const asset = record.assets.find((candidate) => candidate.id === validation.assetId) ?? null;

      rows.push({
        assetType: asset?.assetType ?? null,
        assetId: validation.assetId,
        id: validation.id,
        manufacturerName: record.manufacturer.name,
        mpn: record.part.mpn,
        partId: record.part.id,
        validatedAt: validation.validatedAt,
        validationNotes: validation.validationNotes,
        validationStatus: validation.validationStatus,
        validationType: validation.validationType,
        validator: validation.validator
      });
    }
  }

  return rows.sort((left, right) => Date.parse(right.validatedAt) - Date.parse(left.validatedAt) || right.id.localeCompare(left.id));
}

/**
 * Builds a user-actionable list of CAD trust checks that need engineering attention.
 */
function buildValidationAttentionRows(records: PartSearchRecord[]): ValidationAttentionRow[] {
  const rows: ValidationAttentionRow[] = [];

  for (const record of records) {
    const latestValidationByAsset = buildLatestValidationByAssetId(record.validationRecords);

    for (const asset of record.assets) {
      if (!isValidationCheckAsset(asset)) {
        continue;
      }

      const latestValidation = latestValidationByAsset.get(asset.id) ?? null;
      if (latestValidation && latestValidation.validationStatus !== "verified") {
        rows.push(buildValidationAttentionRow(record, asset, latestValidation));
        continue;
      }

      if (!latestValidation && (asset.validationStatus === "failed" || asset.validationStatus === "needs_review")) {
        rows.push(buildValidationAttentionRow(record, asset, null));
      }
    }
  }

  return rows.sort((left, right) => validationAttentionRank(left) - validationAttentionRank(right) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.mpn.localeCompare(right.mpn));
}

/**
 * Creates one row of validation worklist copy from either evidence or asset state.
 */
function buildValidationAttentionRow(record: PartSearchRecord, asset: Asset, validation: AssetValidationRecord | null): ValidationAttentionRow {
  const status = validation?.validationStatus ?? asset.validationStatus;
  const validationTypeLabel = validation ? formatValidationType(validation.validationType) : defaultValidationTypeLabel(asset);
  const detail = validation?.validationNotes ?? (validation ? "No validation notes were recorded." : "No durable validation evidence is attached to this asset yet.");

  return {
    assetId: asset.id,
    assetType: asset.assetType,
    detail,
    id: validation?.id ?? `asset-state-${asset.id}`,
    manufacturerName: record.manufacturer.name,
    mpn: record.part.mpn,
    nextAction: nextValidationAction(status),
    partId: record.part.id,
    stateLabel: formatValidationStatus(status),
    stateTone: validationStatusTone(status),
    updatedAt: validation?.validatedAt ?? asset.lastUpdatedAt,
    validationTypeLabel
  };
}

/**
 * Builds a latest-record lookup without requiring API consumers to pre-group evidence.
 */
function buildLatestValidationByAssetId(validationRecords: AssetValidationRecord[]): Map<string, AssetValidationRecord> {
  const latestByAssetId = new Map<string, AssetValidationRecord>();

  for (const validation of validationRecords) {
    const current = latestByAssetId.get(validation.assetId);
    if (!current || Date.parse(validation.validatedAt) > Date.parse(current.validatedAt) || (validation.validatedAt === current.validatedAt && validation.id.localeCompare(current.id) > 0)) {
      latestByAssetId.set(validation.assetId, validation);
    }
  }

  return latestByAssetId;
}

/**
 * Limits the validation worklist to CAD classes engineers can act on in the file area.
 */
function isValidationCheckAsset(asset: Asset): boolean {
  return asset.assetType === "footprint" || asset.assetType === "symbol" || asset.assetType === "three_d_model";
}

/**
 * Sorts failed checks first, then review-required checks, then informational gaps.
 */
function validationAttentionRank(row: ValidationAttentionRow): number {
  if (row.stateLabel === "Failed") return 0;
  if (row.stateLabel === "Needs review") return 1;
  return 2;
}

/**
 * Gives assets without validation evidence a readable expected check label.
 */
function defaultValidationTypeLabel(asset: Asset): string {
  if (asset.assetType === "footprint") return "Footprint geometry";
  if (asset.assetType === "symbol") return "Symbol pin mapping";
  return "3D geometry";
}

/**
 * Converts a validation state into a direct operator next action.
 */
function nextValidationAction(status: AssetValidationRecord["validationStatus"]): string {
  if (status === "failed") {
    return "Review or replace this file before relying on it.";
  }

  if (status === "needs_review") {
    return "Open the part files area and finish engineering review.";
  }

  if (status === "not_validated") {
    return "Run the relevant CAD check before promotion.";
  }

  return "No action needed.";
}

/**
 * Builds assistant-ready review prep packets from existing evidence without creating trusted conclusions.
 */
function buildAssistantTriageRows(records: PartSearchRecord[]): AssistantTriageRow[] {
  const rows: AssistantTriageRow[] = [];

  for (const record of records) {
    const openIssues = record.issues.filter((issue) => issue.status !== "resolved" && issue.status !== "ignored");
    const failedSources = record.sources.filter((source) => source.importStatus === "failed");
    const generatedReviewAssets = record.assets.filter((asset) => asset.provenance === "generated" && asset.reviewStatus !== "approved" && asset.reviewStatus !== "rejected");
    const lowConfidenceMetrics = record.metrics.filter((metric) => metric.confidenceScore < ASSISTANT_TRIAGE_CONFIDENCE_THRESHOLD);
    const reviewExtractionSignals = record.extractionSignals.filter(
      (signal) => signal.extractionStatus === "needs_review" || signal.confidenceScore < ASSISTANT_TRIAGE_CONFIDENCE_THRESHOLD
    );
    const sourceConflictIssues = openIssues.filter((issue) => issue.code === "source_conflict");
    const sourceConflictRiskFlags = record.riskFlags.filter((flag) => flag.code === "source_conflict");
    const lifecycleIssues = openIssues.filter((issue) => issue.code === "lifecycle_risk");
    const lifecycleRiskFlags = record.riskFlags.filter((flag) => flag.code === "lifecycle_not_active");
    const lifecycleNeedsReview = record.part.lifecycleStatus === "not_recommended" || record.part.lifecycleStatus === "obsolete";
    const hasSourceFollowUp = failedSources.length > 0 || sourceConflictIssues.length > 0 || sourceConflictRiskFlags.length > 0;
    const hasGeneratedReviewWork = generatedReviewAssets.length > 0;
    const hasLowConfidenceExtraction = lowConfidenceMetrics.length > 0 || reviewExtractionSignals.length > 0;
    const hasLifecycleRisk = lifecycleIssues.length > 0 || lifecycleRiskFlags.length > 0 || lifecycleNeedsReview;
    const reasons = buildAssistantTriageReasons({
      failedSourceCount: failedSources.length,
      generatedReviewAssetCount: generatedReviewAssets.length,
      hasLifecycleRisk,
      hasSourceFollowUp,
      lowConfidenceMetricCount: lowConfidenceMetrics.length,
      openIssueCount: openIssues.length,
      reviewExtractionSignalCount: reviewExtractionSignals.length
    });

    if (reasons.length === 0) {
      continue;
    }

    const state = selectAssistantTriageState({
      hasErrorIssue: openIssues.some((issue) => issue.severity === "error"),
      hasFailedSource: failedSources.length > 0,
      hasGeneratedReviewWork,
      hasLifecycleRisk,
      hasLowConfidenceExtraction,
      hasSourceFollowUp,
      lifecycleStatus: record.part.lifecycleStatus
    });

    rows.push({
      attentionReason: reasons.slice(0, 3).join("; "),
      evidenceSummary: buildAssistantEvidenceSummary(record, {
        failedSourceCount: failedSources.length,
        generatedReviewAssetCount: generatedReviewAssets.length,
        lowConfidenceMetricCount: lowConfidenceMetrics.length,
        reviewExtractionSignalCount: reviewExtractionSignals.length
      }),
      guardrail: ASSISTANT_TRIAGE_GUARDRAIL,
      manufacturerName: record.manufacturer.name,
      mpn: record.part.mpn,
      nextAction: selectAssistantTriageNextAction({
        hasGeneratedReviewWork,
        hasLifecycleRisk,
        hasLowConfidenceExtraction,
        hasSourceFollowUp
      }),
      partId: record.part.id,
      stateLabel: state.label,
      stateTone: state.tone,
      updatedAt: latestTimestamp([
        record.lastUpdatedAt,
        record.part.lastUpdatedAt,
        ...failedSources.map((source) => source.lastUpdatedAt),
        ...generatedReviewAssets.map((asset) => asset.lastUpdatedAt),
        ...lowConfidenceMetrics.map((metric) => metric.lastUpdatedAt),
        ...reviewExtractionSignals.map((signal) => signal.lastUpdatedAt),
        ...openIssues.map((issue) => issue.lastUpdatedAt),
        ...record.riskFlags.map((flag) => flag.lastUpdatedAt)
      ])
    });
  }

  return rows.sort((left, right) => assistantTriageStateRank(left.stateLabel) - assistantTriageStateRank(right.stateLabel) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.mpn.localeCompare(right.mpn));
}

/**
 * Turns backend evidence counts into short reasons an engineer can hand to an assistant.
 */
function buildAssistantTriageReasons(config: {
  failedSourceCount: number;
  generatedReviewAssetCount: number;
  hasLifecycleRisk: boolean;
  hasSourceFollowUp: boolean;
  lowConfidenceMetricCount: number;
  openIssueCount: number;
  reviewExtractionSignalCount: number;
}): string[] {
  const reasons: string[] = [];

  if (config.hasSourceFollowUp) {
    reasons.push(config.failedSourceCount > 0 ? "Source evidence needs reconciliation after import failure" : "Source evidence needs reconciliation");
  }

  if (config.generatedReviewAssetCount > 0) {
    reasons.push(`${formatCount(config.generatedReviewAssetCount, "generated asset")} needs human review`);
  }

  if (config.lowConfidenceMetricCount > 0 || config.reviewExtractionSignalCount > 0) {
    reasons.push(`${formatCount(config.lowConfidenceMetricCount + config.reviewExtractionSignalCount, "low-confidence evidence item")} needs datasheet comparison`);
  }

  if (config.hasLifecycleRisk) {
    reasons.push("Lifecycle risk needs design-use review");
  }

  if (reasons.length === 0 && config.openIssueCount > 0) {
    reasons.push(`${formatCount(config.openIssueCount, "open issue")} needs review context`);
  }

  return reasons;
}

/**
 * Summarizes the exact evidence attached to the packet without inventing new certainty.
 */
function buildAssistantEvidenceSummary(
  record: PartSearchRecord,
  counts: {
    failedSourceCount: number;
    generatedReviewAssetCount: number;
    lowConfidenceMetricCount: number;
    reviewExtractionSignalCount: number;
  }
): string {
  const datasheetLabel = record.datasheetRevision ? `datasheet ${record.datasheetRevision.revisionLabel}` : "no parsed datasheet";
  const fragments = [
    formatCount(record.sources.length, "source row", "source rows"),
    formatCount(record.metrics.length, "metric"),
    formatCount(record.extractionSignals.length, "extraction signal"),
    datasheetLabel,
    counts.failedSourceCount > 0 ? `${formatCount(counts.failedSourceCount, "failed source")} with import errors` : null,
    counts.lowConfidenceMetricCount > 0 ? formatCount(counts.lowConfidenceMetricCount, "low-confidence metric") : null,
    counts.reviewExtractionSignalCount > 0 ? formatCount(counts.reviewExtractionSignalCount, "review extraction signal") : null,
    counts.generatedReviewAssetCount > 0 ? `${formatCount(counts.generatedReviewAssetCount, "generated asset")} awaiting review` : null
  ];

  return fragments.filter((fragment): fragment is string => Boolean(fragment)).join(" | ");
}

/**
 * Chooses the visible queue state while keeping assistant prep distinct from approval.
 */
function selectAssistantTriageState(config: {
  hasErrorIssue: boolean;
  hasFailedSource: boolean;
  hasGeneratedReviewWork: boolean;
  hasLifecycleRisk: boolean;
  hasLowConfidenceExtraction: boolean;
  hasSourceFollowUp: boolean;
  lifecycleStatus: PartSearchRecord["part"]["lifecycleStatus"];
}): { label: string; tone: BadgeTone } {
  if (config.hasSourceFollowUp) {
    return { label: "Source reconciliation", tone: config.hasFailedSource || config.hasErrorIssue ? "danger" : "review" };
  }

  if (config.hasGeneratedReviewWork) {
    return { label: "Generated review", tone: "generated" };
  }

  if (config.hasLowConfidenceExtraction) {
    return { label: "Extraction review", tone: "review" };
  }

  if (config.hasLifecycleRisk) {
    return { label: "Lifecycle review", tone: config.lifecycleStatus === "obsolete" ? "danger" : "review" };
  }

  return { label: "Issue prep", tone: "review" };
}

/**
 * Gives each assistant packet one concrete next action that maps back to existing admin workflows.
 */
function selectAssistantTriageNextAction(config: {
  hasGeneratedReviewWork: boolean;
  hasLifecycleRisk: boolean;
  hasLowConfidenceExtraction: boolean;
  hasSourceFollowUp: boolean;
}): string {
  if (config.hasSourceFollowUp) {
    return "Compare source rows, choose or document the canonical source, then update issue operations.";
  }

  if (config.hasGeneratedReviewWork) {
    return "Open part files and finish the explicit review decision before any promotion.";
  }

  if (config.hasLowConfidenceExtraction) {
    return "Compare low-confidence values to the datasheet and keep uncertain fields pending.";
  }

  if (config.hasLifecycleRisk) {
    return "Confirm lifecycle evidence before design-use approval or substitution work.";
  }

  return "Open part detail and use this packet as review context before changing trusted fields.";
}

/**
 * Orders assistant packets by the kind of human review they need first.
 */
function assistantTriageStateRank(stateLabel: string): number {
  if (stateLabel === "Source reconciliation") return 0;
  if (stateLabel === "Generated review") return 1;
  if (stateLabel === "Extraction review") return 2;
  if (stateLabel === "Lifecycle review") return 3;
  return 4;
}

function buildPromotionAuditRows(records: PartSearchRecord[]): PromotionAuditRow[] {
  const rows: PromotionAuditRow[] = [];

  for (const record of records) {
    for (const audit of record.promotionAudits) {
      rows.push({
        actor: audit.actor,
        assetId: audit.assetId,
        blockerReasons: audit.blockerReasons,
        createdAt: audit.createdAt,
        id: audit.id,
        mpn: record.part.mpn,
        outcome: audit.promotionOutcome,
        partId: record.part.id
      });
    }
  }

  return rows.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id));
}

function summarizeValidation(rows: ValidationRow[]): { failed: number; needsReview: number; notValidated: number; verified: number } {
  return rows.reduce(
    (summary, row) => {
      if (row.validationStatus === "verified") summary.verified += 1;
      if (row.validationStatus === "needs_review") summary.needsReview += 1;
      if (row.validationStatus === "failed") summary.failed += 1;
      if (row.validationStatus === "not_validated") summary.notValidated += 1;
      return summary;
    },
    { failed: 0, needsReview: 0, notValidated: 0, verified: 0 }
  );
}

/**
 * Formats simple count labels for dense admin copy.
 */
function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatAssetType(assetType: Asset["assetType"]): string {
  return {
    datasheet: "Datasheet",
    footprint: "Footprint",
    mechanical_drawing: "Mechanical drawing",
    symbol: "Symbol",
    three_d_model: "3D model"
  }[assetType];
}

function formatAssetProvenance(provenance: Asset["provenance"]): string {
  return {
    generated: "Generated",
    manual_internal: "Manual internal",
    official: "Official",
    trusted_external: "Trusted external"
  }[provenance];
}

/**
 * Formats a compact four-stage trust chain for queue rows.
 */
function formatCompactTrustLineage(record: PartSearchRecord): string {
  // Sparse-projection-aware on purpose: a record without bundle readiness must still report its REAL
  // imported/reviewed/approved states. The previous hardcoded all-pending fallback told admins a part
  // with confirmed imports and approved reviews was completely unprocessed.
  const trust = getTrustLineageSummaryForSearchRecord(record);
  const markers = trust.stages.map((stage) => `${stage.label}: ${formatCompactStageState(stage.state)}`);
  return markers.join(" | ");
}

function formatCompactStageState(state: "passed" | "pending" | "blocked" | "not_applicable"): string {
  if (state === "passed") return "ok";
  if (state === "blocked") return "blocked";
  if (state === "not_applicable") return "n/a";
  return "pending";
}

function validationStatusTone(status: AssetValidationRecord["validationStatus"]): BadgeTone {
  if (status === "verified") {
    return "verified";
  }
  if (status === "needs_review") {
    return "review";
  }
  if (status === "failed") {
    return "danger";
  }

  return "neutral";
}

function formatValidationStatus(status: AssetValidationRecord["validationStatus"]): string {
  return {
    failed: "Failed",
    needs_review: "Needs review",
    not_validated: "Not validated",
    verified: "Verified"
  }[status];
}

function formatValidationType(type: AssetValidationRecord["validationType"]): string {
  return {
    file_integrity: "File integrity",
    footprint_geometry: "Footprint geometry",
    manual_engineering_review: "Manual engineering review",
    symbol_pin_mapping: "Symbol pin mapping",
    three_d_geometry: "3D geometry"
  }[type];
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function mapViewToneToBadge(tone: ReturnType<typeof reviewStateTone>): BadgeTone {
  return tone as BadgeTone;
}

function readReviewTargetType(value: FormDataEntryValue | null): ReviewTargetType | null {
  if (value === "asset" || value === "generation_workflow") {
    return value;
  }

  return null;
}

function readReviewOutcome(value: FormDataEntryValue | null): ReviewOutcome | null {
  if (value === "approved" || value === "changes_requested" || value === "rejected") {
    return value;
  }

  return null;
}

function readPartIssueCode(value: FormDataEntryValue | null): PartIssueCode | null {
  if (
    value === "low_confidence_identity" ||
    value === "pending_approval" ||
    value === "missing_verified_cad" ||
    value === "missing_datasheet" ||
    value === "missing_connector_mate" ||
    value === "missing_connector_accessories" ||
    value === "connector_low_confidence" ||
    value === "lifecycle_risk" ||
    value === "source_conflict" ||
    value === "duplicate_candidate"
  ) {
    return value;
  }

  return null;
}

function readIssueWorkflowStatus(value: FormDataEntryValue | null): PartIssueWorkflowStatus | null {
  if (value === "open" || value === "in_review" || value === "resolved" || value === "ignored") {
    return value;
  }

  return null;
}

function readSourceReconciliationStatus(value: FormDataEntryValue | null): SourceReconciliationStatus | null {
  if (value === "unreviewed" || value === "canonical_source_selected" || value === "mixed_sources_accepted") {
    return value;
  }

  return null;
}

function readOptionalFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readRequiredFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
