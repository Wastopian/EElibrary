/**
 * File header: Provides an operational admin workspace for review, promotion, and audit flows.
 */

import Link from "next/link";
import React from "react";
import { revalidatePath } from "next/cache";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { AdminQueuePresentation } from "./AdminQueuePresentation";
import type { AdminQueueOverviewGroup, AdminQueueOverviewStat, AdminQueueTableRow } from "./AdminQueuePresentation";
import { ImportByMpnPanel } from "../../components/ImportByMpnPanel";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { isValidatedDownloadableAsset } from "@ee-library/shared/asset-state";
import { getAssetPromotionSummary, getAssetReviewStatus, getAssetValidationSummary, getWorkflowReviewStatus } from "@ee-library/shared/review-workflow";
import { createAssetPromotion, createReviewAction, fetchApiHealth, fetchPartSearchEnvelope, isApiClientError, updatePartIssueWorkflow, updateSourceReconciliation } from "../../lib/api-client";
import { formatReviewStateLabel, reviewStateTone } from "../../lib/detail-view-model";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type {
  Asset,
  AssetValidationRecord,
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
  id: string;
  partId: string;
  mpn: string;
  assetId: string;
  validationStatus: AssetValidationRecord["validationStatus"];
  validationType: AssetValidationRecord["validationType"];
  validatedAt: string;
  validator: string;
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

/**
 * Renders the admin/review/audit workspace using existing catalog projections.
 */
export default async function AdminPage() {
  const catalogState = await loadAdminCatalog();

  if (catalogState.status === "setup_required") {
    return <AdminSetupState catalogState={catalogState} />;
  }

  const { health, records, source, warnings } = catalogState;
  const reviewQueue = buildReviewQueue(records);
  const promotionQueue = buildPromotionQueue(records);
  const importRows = buildImportRows(records);
  const failedImportRows = importRows.filter((row) => row.importStatus === "failed").slice(0, 8);
  const recentImportRows = importRows.slice(0, 12);
  const validationRows = buildValidationRows(records);
  const recentValidationRows = validationRows.slice(0, 12);
  const promotionAudits = buildPromotionAuditRows(records).slice(0, 14);
  const validationSummary = summarizeValidation(validationRows);
  const issueQueueRows = buildIssueQueueRows(records);
  const issueWorkflowRows = buildIssueWorkflowRows(records);
  const overviewStats = buildAdminOverviewStats(reviewQueue, promotionQueue, failedImportRows.length, validationSummary, issueQueueRows);
  const overviewGroups = buildAdminOverviewGroups(reviewQueue, promotionQueue, failedImportRows.length, validationSummary, issueQueueRows);
  const overviewTableRows = buildAdminOverviewTableRows(reviewQueue, promotionQueue, failedImportRows, validationRows, issueQueueRows);

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
      <Link className="back-link" href="/">
        &larr; Back to catalog
      </Link>

      <section className="admin-hero">
        <div className="admin-hero__layout">
          <div className="admin-hero__copy">
            <p className="app-kicker">Admin workspace</p>
            <h1>Review and trust maintenance</h1>
            <p className="admin-hero__lede">
              Review generated drafts, inspect part-level blockers, and monitor promotion and import evidence without implying export readiness before evidence is complete.
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
          { href: "#import-by-mpn-heading", label: "Import by MPN" },
          { href: "#issue-ops-heading", label: "Issue operations" },
          { href: "#review-queue-heading", label: "Review queue" },
          { href: "#promotion-queue-heading", label: "Promotion queue" },
          { href: "#ops-health-heading", label: "Imports and validation" },
          { href: "#audit-heading", label: "Promotion audit history" }
        ]}
      />

      <AdminQueuePresentation groups={overviewGroups} rows={overviewTableRows} stats={overviewStats} />

      <section className="detail-section" aria-labelledby="issue-ops-heading">
        <SectionHeading
          id="issue-ops-heading"
          index="00"
          subtitle="Assign, resolve, reopen, and reconcile backend-derived issues without collapsing them into asset review or export promotion."
          title="Issue operations"
        />
        <SectionPanel
          description="Issue workflow state is operational metadata. It does not remove underlying readiness evidence until the backend projection itself changes."
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
                  {issueWorkflowRows.map((row) => (
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
            </div>
          ) : (
            <EmptyState title="No issue workflow items" body="No backend-derived issues are currently open or recently resolved in this catalog window." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="import-by-mpn-heading">
        <SectionHeading
          id="import-by-mpn-heading"
          index="01"
          subtitle="Pull one part from a registered provider into the catalog database, then continue in part detail or the queues below."
          title="Import by MPN"
        />
        <SectionPanel
          description="Uses the same worker-backed import path as the CLI. Success means the part row exists - not that CAD is verified or exportable."
          title="Operator import"
          tone="technical"
        >
          <ImportByMpnPanel />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="review-queue-heading">
        <SectionHeading id="review-queue-heading" index="02" title="Review queue" subtitle="Generated drafts and review-required outputs that need approve/reject/changes decisions." />
        <SectionPanel description="Review state and actions are explicit. Approval alone does not verify export." title={`${reviewQueue.length} review items`}>
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
                  {reviewQueue.map((item) => (
                    <tr key={`${item.targetType}-${item.targetId}`}>
                      <td>
                        <Link href={`/parts/${item.partId}`}>
                          <span className="ui-mono">{item.mpn}</span>
                        </Link>
                        <div className="muted-copy">{item.manufacturerName}</div>
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
            </div>
          ) : (
            <EmptyState title="No review queue items" body="No generated drafts or review-required items are currently waiting for review." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="promotion-queue-heading">
        <SectionHeading id="promotion-queue-heading" index="03" title="Promotion queue" subtitle="Approved assets eligible or blocked for explicit verified-for-export promotion." />
        <SectionPanel description="Promotion remains separate from review. Blocker reasons are shown before action." title={`${promotionQueue.length} promotion candidates`}>
          {promotionQueue.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Asset</th>
                    <th>Promotion state</th>
                    <th>Validation evidence</th>
                    <th>Blockers</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {promotionQueue.map((item) => (
                    <tr key={`promotion-${item.assetId}`}>
                      <td>
                        <Link href={`/parts/${item.partId}`}>
                          <span className="ui-mono">{item.mpn}</span>
                        </Link>
                        <div className="muted-copy">{item.manufacturerName}</div>
                      </td>
                      <td>
                        <div>{formatAssetType(item.assetType)}</div>
                        <div className="muted-copy ui-mono">{item.assetId}</div>
                        <div className="muted-copy">{formatDateTime(item.updatedAt)}</div>
                      </td>
                      <td>
                        <StatusBadge label={item.canPromote ? "Eligible now" : "Blocked"} tone={item.canPromote ? "verified" : "review"} />
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
                            Promote
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No promotion candidates" body="No approved non-export assets are currently waiting for promotion." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="ops-health-heading">
        <SectionHeading id="ops-health-heading" index="04" title="Imports and validation" subtitle="Recent import health plus validation evidence status for trust maintenance." />
        <div className="detail-two-col">
          <SectionPanel title="Recent imports" description="Newest source import rows across this catalog window.">
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
              <EmptyState title="No imports" body="No source import rows are attached to the current catalog window." />
            )}
          </SectionPanel>
          <SectionPanel title="Failed imports" description="Failures include source-level error text for immediate triage.">
            {failedImportRows.length > 0 ? (
              <ul className="admin-inline-list">
                {failedImportRows.map((row) => (
                  <li key={`${row.partId}-${row.providerId}-failed`}>
                    <span className="ui-mono">{row.mpn}</span> - {row.providerId} - {row.importErrorDetails ?? "No error details"}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No failed imports" body="No failed import rows were found in this catalog window." />
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
                      <td className="ui-mono">{row.assetId}</td>
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
            <EmptyState title="No validation records" body="No validation evidence is attached to the current catalog window." />
          )}
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="audit-heading">
        <SectionHeading id="audit-heading" index="05" title="Promotion audit history" subtitle="Recent promotion attempts with actor, outcome, and blocker reasons." />
        <SectionPanel title="Recent promotion audits" description="Promotion outcomes remain auditable even when denied by blocker rules.">
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
            <EmptyState title="No promotion audits" body="No promotion attempts are recorded in the current catalog window." />
          )}
        </SectionPanel>
      </section>
    </main>
  );
}

/**
 * Builds the compact queue statistics shown above the admin tables.
 */
function buildAdminOverviewStats(
  reviewQueue: ReviewQueueItem[],
  promotionQueue: PromotionQueueItem[],
  failedImportCount: number,
  validationSummary: ReturnType<typeof summarizeValidation>,
  issueQueueRows: OverviewQueueRow[]
): AdminQueueOverviewStat[] {
  const eligiblePromotionCount = promotionQueue.filter((item) => item.canPromote).length;
  const blockedPromotionCount = promotionQueue.length - eligiblePromotionCount;
  const validationIssueCount = validationSummary.needsReview + validationSummary.failed + validationSummary.notValidated;
  const validationIssueTone: BadgeTone = validationIssueCount > 0 ? "review" : "verified";
  const pendingApprovalCount = countQueueRows(issueQueueRows, "approval");
  const identityFollowUpCount = countQueueRows(issueQueueRows, "identity");
  const cadGapCount = countQueueRows(issueQueueRows, "cad_gaps");
  const connectorGapCount = countQueueRows(issueQueueRows, "connector");
  const duplicateCount = countQueueRows(issueQueueRows, "duplicates");

  return [
    { label: "Review items", tone: "review" as const, value: reviewQueue.length },
    { label: "Promotion candidates", tone: "info" as const, value: promotionQueue.length },
    { label: "Eligible promotions", tone: "verified" as const, value: eligiblePromotionCount },
    { label: "Blocked promotions", tone: "review" as const, value: blockedPromotionCount },
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
  validationSummary: ReturnType<typeof summarizeValidation>,
  issueQueueRows: OverviewQueueRow[]
): AdminQueueOverviewGroup[] {
  const validationIssueCount = validationSummary.needsReview + validationSummary.failed + validationSummary.notValidated;
  const groups: AdminQueueOverviewGroup[] = [];

  pushAdminOverviewGroup(groups, reviewQueue.length, {
    description: "Generated assets and generation workflows waiting for explicit review decisions.",
    id: "review",
    label: "Generated drafts and review-required outputs",
    tone: "review"
  });
  pushAdminOverviewGroup(groups, promotionQueue.length, {
    description: "Approved assets that still require explicit verified-for-export promotion or blocker review.",
    id: "promotion",
    label: "Promotion blockers and candidates",
    tone: "info"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "approval"), {
    description: "Whole-part approval is still pending or not requested, so engineer-ready use needs follow-up.",
    id: "approval",
    label: "Pending approval",
    tone: "info"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "identity"), {
    description: "Identity confidence or provenance is still below the confirmed threshold.",
    id: "identity",
    label: "Low-confidence identity",
    tone: "review"
  });
  pushAdminOverviewGroup(groups, countQueueRows(issueQueueRows, "cad_gaps"), {
    description: "Export-capable, file-backed CAD is still missing or incomplete for these parts.",
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
    description: "Possible duplicate catalog rows need merge, dismissal, or reconciliation decisions.",
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
    description: "Provider/source provenance is conflicted or unhealthy and needs investigation.",
    id: "source_conflicts",
    label: "Source conflicts",
    tone: "review"
  });
  pushAdminOverviewGroup(groups, failedImportCount, {
    description: "Provider source rows with failed import status and durable error details.",
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
  validationRows: ValidationRow[],
  issueQueueRows: OverviewQueueRow[]
): AdminQueueTableRow[] {
  const rows: OverviewQueueRow[] = [
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
      queueLabel: "Promotion queue",
      stateLabel: item.canPromote ? "Eligible now" : "Blocked",
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
    ...validationRows
      .filter((row) => row.validationStatus !== "verified")
      .map((row) => ({
        detail: `${formatValidationType(row.validationType)} - ${row.validator}`,
        href: `/parts/${row.partId}`,
        id: `validation-${row.id}`,
        manufacturerName: row.validator,
        mpn: row.mpn,
        queueId: "validation",
        queueLabel: "Validation issues",
        stateLabel: formatValidationStatus(row.validationStatus),
        stateTone: validationStatusTone(row.validationStatus),
        updatedAtRaw: row.validatedAt,
        updatedLabel: formatDateTime(row.validatedAt)
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
  const preferredLabels = ["Review items", "Eligible promotions", "Pending approval", "Missing verified CAD", "Failed imports", "Validation issues"];

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
      <Link className="back-link" href="/">
        &larr; Back to catalog
      </Link>
      <section className="admin-hero">
        <div>
          <p className="app-kicker">Admin workspace</p>
          <h1>Review and trust maintenance</h1>
          <p className="admin-hero__lede">Connect the catalog before using review/promotion/audit operations.</p>
        </div>
        <div className="admin-hero__status">
          <StatusBadge label={catalogState.code} tone="review" />
          <StatusBadge label={`Database ${catalogState.health?.dependencies.database ?? "unknown"}`} tone={catalogState.health?.dependencies.database === "connected" ? "verified" : "review"} />
        </div>
        <p className="mode-warning">{catalogState.message}</p>
      </section>
      <SectionPanel title="Setup guidance" description="Admin tools require DB-backed catalog records.">
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
            <span>Seed mode is for local examples, not production trust maintenance.</span>
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
    <section aria-label="Admin trust boundaries" className="admin-truth-rail">
      <div>
        <span>Review truth</span>
        <strong>Approval does not verify export.</strong>
        <p>Reviewed or approved outputs still stay outside export truth until file-backed validation evidence and promotion are complete.</p>
      </div>
      <div>
        <span>Promotion truth</span>
        <strong>Verified-for-export stays explicit.</strong>
        <p>Promotion remains a separate action so operators can see exactly which assets are eligible now and which are still blocked.</p>
      </div>
      <div>
        <span>Coverage gaps</span>
        <strong>Queues appear only when the backend has evidence.</strong>
        <p>Issue-driven queues such as identity, connector coverage, lifecycle, and source conflicts stay hidden until backend records exist for them.</p>
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
      rows.push({
        assetId: validation.assetId,
        id: validation.id,
        mpn: record.part.mpn,
        partId: record.part.id,
        validatedAt: validation.validatedAt,
        validationStatus: validation.validationStatus,
        validationType: validation.validationType,
        validator: validation.validator
      });
    }
  }

  return rows.sort((left, right) => Date.parse(right.validatedAt) - Date.parse(left.validatedAt) || right.id.localeCompare(left.id));
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
