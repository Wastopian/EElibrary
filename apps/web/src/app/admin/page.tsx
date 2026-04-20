/**
 * File header: Provides an operational admin workspace for review, promotion, and audit flows.
 */

import Link from "next/link";
import React from "react";
import { revalidatePath } from "next/cache";
import { EmptyState, SectionHeading, SectionPanel, StatusBadge } from "@ee-library/ui";
import { ImportByMpnPanel } from "../../components/ImportByMpnPanel";
import { isValidatedDownloadableAsset } from "@ee-library/shared/asset-state";
import { getAssetPromotionSummary, getAssetReviewStatus, getAssetValidationSummary, getWorkflowReviewStatus } from "@ee-library/shared/review-workflow";
import { createAssetPromotion, createReviewAction, fetchApiHealth, fetchPartSearchEnvelope, isApiClientError } from "../../lib/api-client";
import { formatReviewStateLabel, reviewStateTone } from "../../lib/detail-view-model";
import type { ApiHealth } from "../../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { Asset, AssetValidationRecord, CatalogDataSource, PartSearchFilters, PartSearchRecord, ReviewOutcome, ReviewTargetType } from "@ee-library/shared/types";

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

  return (
    <main className="admin-layout">
      <Link className="back-link" href="/">
        ← Back to catalog
      </Link>

      <section className="admin-hero">
        <div>
          <p className="app-kicker">Admin workspace</p>
          <h1>Review and trust maintenance</h1>
          <p className="admin-hero__lede">
            Review generated drafts, inspect promotion blockers, and monitor import/validation audit trails without implying export readiness before evidence is complete.
          </p>
        </div>
        <div className="admin-hero__status">
          <StatusBadge label={source === "seed_fallback" ? "Local seed mode" : "DB-backed catalog"} tone={source === "seed_fallback" ? "review" : "verified"} />
          <StatusBadge label={health ? `API ${health.status}` : "API health unavailable"} tone={health ? "info" : "review"} />
          <StatusBadge label={`Database ${health?.dependencies.database ?? "unknown"}`} tone={health?.dependencies.database === "connected" ? "verified" : "review"} />
        </div>
        {warnings.length > 0 ? <p className="mode-warning">{warnings.join(" ")}</p> : null}
      </section>

      <AdminQueueOverview
        failedImportCount={failedImportRows.length}
        promotionQueue={promotionQueue}
        reviewQueue={reviewQueue}
        validationSummary={validationSummary}
      />

      <section className="detail-section" aria-labelledby="import-by-mpn-heading">
        <SectionHeading
          id="import-by-mpn-heading"
          index="00"
          subtitle="Pull one part from a registered provider into the catalog database, then continue in part detail or the queues below."
          title="Import by MPN"
        />
        <SectionPanel
          description="Uses the same worker-backed import path as the CLI. Success means the part row exists—not that CAD is verified or exportable."
          title="Operator import"
          tone="technical"
        >
          <ImportByMpnPanel />
        </SectionPanel>
      </section>

      <section className="detail-section" aria-labelledby="review-queue-heading">
        <SectionHeading id="review-queue-heading" index="01" title="Review queue" subtitle="Generated drafts and review-required outputs that need approve/reject/changes decisions." />
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
        <SectionHeading id="promotion-queue-heading" index="02" title="Promotion queue" subtitle="Approved assets eligible or blocked for explicit verified-for-export promotion." />
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
        <SectionHeading id="ops-health-heading" index="03" title="Imports and validation" subtitle="Recent import health plus validation evidence status for trust maintenance." />
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
                    <span className="ui-mono">{row.mpn}</span> · {row.providerId} · {row.importErrorDetails ?? "No error details"}
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
        <SectionHeading id="audit-heading" index="04" title="Promotion audit history" subtitle="Recent promotion attempts with actor, outcome, and blocker reasons." />
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
 * Renders a V3-style grouped queue overview using only backend-backed derived queues.
 */
function AdminQueueOverview({
  failedImportCount,
  promotionQueue,
  reviewQueue,
  validationSummary
}: {
  failedImportCount: number;
  promotionQueue: PromotionQueueItem[];
  reviewQueue: ReviewQueueItem[];
  validationSummary: ReturnType<typeof summarizeValidation>;
}) {
  const eligiblePromotionCount = promotionQueue.filter((item) => item.canPromote).length;
  const blockedPromotionCount = promotionQueue.length - eligiblePromotionCount;
  const lowConfidenceCount = validationSummary.needsReview + validationSummary.failed + validationSummary.notValidated;

  return (
    <section aria-labelledby="admin-queue-overview-heading" className="admin-queue-overview">
      <div className="admin-queue-overview__header">
        <div>
          <p className="app-kicker">Admin</p>
          <h2 id="admin-queue-overview-heading">Review Queue</h2>
          <p>Grouped by real review, promotion, import, and validation state. Mock-only queue categories stay unavailable until the backend records them.</p>
        </div>
        <div className="admin-queue-overview__mode" aria-label="Available queue presentation">
          <span>Grouped</span>
          <span>Table sections below</span>
        </div>
      </div>

      <div className="admin-queue-stats" aria-label="Review queue counts">
        <AdminQueueStat label="Review items" tone="review" value={reviewQueue.length} />
        <AdminQueueStat label="Promotion candidates" tone="info" value={promotionQueue.length} />
        <AdminQueueStat label="Eligible promotions" tone="verified" value={eligiblePromotionCount} />
        <AdminQueueStat label="Blocked promotions" tone="review" value={blockedPromotionCount} />
        <AdminQueueStat label="Failed imports" tone="danger" value={failedImportCount} />
        <AdminQueueStat label="Validation issues" tone={lowConfidenceCount > 0 ? "review" : "verified"} value={lowConfidenceCount} />
      </div>

      <div className="admin-queue-groups">
        <AdminQueueGroup count={reviewQueue.length} description="Generated assets and generation workflows waiting for explicit review decisions." label="Generated drafts and review-required outputs" tone="review" />
        <AdminQueueGroup count={promotionQueue.length} description="Approved assets that still require explicit verified-for-export promotion or blocker review." label="Promotion blockers and candidates" tone="info" />
        <AdminQueueGroup count={failedImportCount} description="Provider source rows with failed import status and durable error details." label="Failed imports" tone="danger" />
        <AdminQueueGroup count={lowConfidenceCount} description="Validation records that are failed, not validated, or still need review." label="Validation evidence issues" tone="review" />
        <AdminQueueGroup count={null} description="No backend duplicate-candidate source exists yet, so this V3 bucket is intentionally unavailable." label="Duplicate candidates" tone="neutral" />
        <AdminQueueGroup count={null} description="No dedicated obsolescence-risk queue exists yet beyond lifecycle fields on part records." label="Obsolescence risk" tone="neutral" />
        <AdminQueueGroup count={null} description="Connector mate gaps are visible on detail/search records, but no admin queue endpoint stores unresolved mate tasks yet." label="Unresolved mating parts" tone="neutral" />
      </div>
    </section>
  );
}

/**
 * Renders one compact admin queue statistic.
 */
function AdminQueueStat({ label, tone, value }: { label: string; tone: BadgeTone; value: number }) {
  return (
    <div className={`admin-queue-stat admin-queue-stat--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/**
 * Renders one grouped queue row and marks unsupported buckets explicitly unavailable.
 */
function AdminQueueGroup({ count, description, label, tone }: { count: number | null; description: string; label: string; tone: BadgeTone }) {
  return (
    <article className={`admin-queue-group admin-queue-group--${tone}`}>
      <div>
        <h3>{label}</h3>
        <p>{description}</p>
      </div>
      {count === null ? <StatusBadge label="Unavailable" tone="neutral" /> : <StatusBadge label={`${count} items`} tone={tone} />}
    </article>
  );
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
        ← Back to catalog
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

function buildReviewQueue(records: PartSearchRecord[]): ReviewQueueItem[] {
  const queue: ReviewQueueItem[] = [];

  for (const record of records) {
    for (const asset of record.assets) {
      const reviewStatus = getAssetReviewStatus(asset, record.reviewRecords);
      if (reviewStatus.state !== "pending_review" && reviewStatus.state !== "changes_requested") {
        continue;
      }

      queue.push({
        context: `${formatAssetType(asset.assetType)} · ${formatAssetProvenance(asset.provenance)}`,
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

function readRequiredFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
