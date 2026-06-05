/**
 * File header: Admin-gated controlled document revision history, ACL intent, and redline workflows.
 */

import { EmptyState, StatusBadge } from "@ee-library/ui";
import type { Asset, ControlledDocumentRevision } from "@ee-library/shared/types";
import React from "react";
import { isControlledDocumentAsset } from "../lib/asset-helpers";
import {
  assetTypeLabel,
  formatAclPrincipal,
  formatDateOnly,
  formatDateTime,
  formatDocumentAccess,
  formatDocumentLifecycle,
  formatDocumentType,
  formatRedlineStatus
} from "../lib/format";
import {
  documentAccessTone,
  documentLifecycleTone,
  redlineStatusTone
} from "../lib/tone";
import type { PartDocumentControlState } from "../lib/types";

/**
 * Renders controlled document revision history, ACL intent, and redline workflows.
 */
export function DocumentControlPanel({
  addRedlineAction,
  assets,
  createRevisionAction,
  state,
  updateRedlineAction
}: {
  addRedlineAction: (formData: FormData) => Promise<void>;
  assets: Asset[];
  createRevisionAction: (formData: FormData) => Promise<void>;
  state: PartDocumentControlState;
  updateRedlineAction: (formData: FormData) => Promise<void>;
}) {
  const documentAssets = assets.filter((asset) => isControlledDocumentAsset(asset));
  const revisions = state.status === "available" ? state.response.revisions : [];

  if (state.status === "unavailable") {
    return (
      <EmptyState
        body={`Document control requires the database-backed catalog. ${state.message}`}
        title="Document control unavailable"
      />
    );
  }

  if (documentAssets.length === 0) {
    return (
      <EmptyState
        body="No datasheet or mechanical drawing assets are attached yet, so there is no file to place under document control."
        title="No controllable documents"
      />
    );
  }

  return (
    <div className="document-control-panel">
      <p className="document-control-panel__boundary">
        <strong>Admin only.</strong> Access notes are recorded for future role-based and export-control rules. Review, validation, and export readiness are handled separately.
      </p>

      <form action={createRevisionAction} className="document-control-form">
        <div className="form-row">
          <label className="form-label" htmlFor="document-asset-id">Document asset</label>
          <select className="form-select" id="document-asset-id" name="assetId" required>
            {documentAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {assetTypeLabel(asset)} / {asset.fileFormat} / {asset.storageKey ? "stored file" : "reference"}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-type">Document type</label>
          <select className="form-select" id="document-type" name="documentType" defaultValue={documentAssets[0]?.assetType === "mechanical_drawing" ? "mechanical_drawing" : "datasheet"}>
            <option value="datasheet">Datasheet</option>
            <option value="mechanical_drawing">Mechanical drawing</option>
            <option value="controlled_drawing">Controlled drawing</option>
            <option value="specification">Specification</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-revision-label">Revision</label>
          <input className="form-input" id="document-revision-label" name="revisionLabel" placeholder="Rev A" required />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-revision-date">Revision date</label>
          <input className="form-input" id="document-revision-date" name="revisionDate" type="date" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-lifecycle">Lifecycle</label>
          <select className="form-select" id="document-lifecycle" name="lifecycleStatus" defaultValue="in_review">
            <option value="draft">Draft</option>
            <option value="in_review">In review</option>
            <option value="released">Released</option>
            <option value="superseded">Superseded</option>
            <option value="expired">Expired</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-access">Access</label>
          <select className="form-select" id="document-access" name="accessLevel" defaultValue="internal">
            <option value="public">Public</option>
            <option value="internal">Internal</option>
            <option value="restricted">Restricted</option>
            <option value="itar_controlled">ITAR controlled</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-supersedes">Replaces revision</label>
          <select className="form-select" id="document-supersedes" name="supersedesDocumentRevisionId" defaultValue="">
            <option value="">None</option>
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                {revision.revisionLabel} / {formatDocumentType(revision.documentType)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-effective">Effective</label>
          <input className="form-input" id="document-effective" name="effectiveAt" type="datetime-local" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-expires">Expires</label>
          <input className="form-input" id="document-expires" name="expiresAt" type="datetime-local" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-principal-id">Review principal</label>
          <input className="form-input" id="document-principal-id" name="principalId" placeholder="hardware-team" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-principal-type">Principal type</label>
          <select className="form-select" id="document-principal-type" name="principalType" defaultValue="team">
            <option value="team">Team</option>
            <option value="role">Role</option>
            <option value="user">User</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="document-permission">Permission</label>
          <select className="form-select" id="document-permission" name="permission" defaultValue="review">
            <option value="view">View</option>
            <option value="review">Review</option>
            <option value="approve">Approve</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="form-row document-control-form__wide">
          <label className="form-label" htmlFor="document-access-notes">Access notes</label>
          <textarea className="form-textarea" id="document-access-notes" name="accessNotes" placeholder="Distribution limits, customer program, or review instructions." />
        </div>
        <div className="document-control-form__actions">
          <button className="button-link" type="submit">Save controlled revision</button>
        </div>
      </form>

      {state.status === "not_found" || revisions.length === 0 ? (
        <EmptyState
          body="No controlled revisions have been saved for this part yet. Save one from a datasheet or drawing file above."
          title="No controlled revisions"
        />
      ) : (
        <div className="document-control-revision-list">
          {revisions.map((revision) => (
            <DocumentRevisionCard
              addRedlineAction={addRedlineAction}
              key={revision.id}
              revision={revision}
              updateRedlineAction={updateRedlineAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders one controlled document revision with its review notes and ACL grants.
 */
function DocumentRevisionCard({
  addRedlineAction,
  revision,
  updateRedlineAction
}: {
  addRedlineAction: (formData: FormData) => Promise<void>;
  revision: ControlledDocumentRevision;
  updateRedlineAction: (formData: FormData) => Promise<void>;
}) {
  const openRedlineCount = revision.redlines.filter((redline) => redline.redlineStatus === "open").length;

  return (
    <article className="document-revision-card">
      <div className="document-revision-card__header">
        <div>
          <p className="app-kicker">{formatDocumentType(revision.documentType)}</p>
          <h3>{revision.revisionLabel}</h3>
          <p className="muted-copy">{revision.revisionDate ? `Revision date ${formatDateOnly(revision.revisionDate)}` : "No revision date recorded"}</p>
        </div>
        <div className="document-revision-card__badges">
          <StatusBadge label={formatDocumentLifecycle(revision.lifecycleStatus)} tone={documentLifecycleTone(revision.lifecycleStatus)} />
          <StatusBadge label={formatDocumentAccess(revision.accessLevel)} tone={documentAccessTone(revision.accessLevel)} />
          <StatusBadge label={`${openRedlineCount} open redline${openRedlineCount === 1 ? "" : "s"}`} tone={openRedlineCount > 0 ? "review" : "verified"} />
        </div>
      </div>

      <dl className="document-revision-card__facts">
        <div>
          <dt>Asset</dt>
          <dd className="ui-mono">{revision.asset.fileFormat} / {revision.asset.storageKey ? "stored" : "reference"}</dd>
        </div>
        <div>
          <dt>File hash</dt>
          <dd className="ui-mono">{revision.sourceAssetHash ?? revision.asset.fileHash ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>{revision.effectiveAt ? formatDateTime(revision.effectiveAt) : "Not set"}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{revision.expiresAt ? formatDateTime(revision.expiresAt) : "No expiry"}</dd>
        </div>
        <div>
          <dt>Replaces</dt>
          <dd>{revision.supersedesDocumentRevisionId ?? "None"}</dd>
        </div>
        <div>
          <dt>Replaced by</dt>
          <dd>{revision.supersededByDocumentRevisionId ?? "None"}</dd>
        </div>
      </dl>

      {revision.accessNotes ? <p className="document-revision-card__notes">{revision.accessNotes}</p> : null}

      <div className="document-revision-card__subgrid">
        <section aria-label="Document ACL entries">
          <h4>ACL intent</h4>
          {revision.aclEntries.length > 0 ? (
            <ul className="info-list">
              {revision.aclEntries.map((entry) => (
                <li key={entry.id}>
                  <span>
                    {formatAclPrincipal(entry.principalType, entry.principalId)} can {entry.permission}
                    {entry.expiresAt ? ` until ${formatDateTime(entry.expiresAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-copy">No explicit ACL grants recorded for this revision.</p>
          )}
        </section>

        <section aria-label="Document redlines">
          <h4>Redlines</h4>
          {revision.redlines.length > 0 ? (
            <div className="document-redline-list">
              {revision.redlines.map((redline) => (
                <article className="document-redline" key={redline.id}>
                  <div className="document-redline__header">
                    <StatusBadge label={formatRedlineStatus(redline.redlineStatus)} tone={redlineStatusTone(redline.redlineStatus, redline.severity)} />
                    <span>{redline.pageNumber ? `Page ${redline.pageNumber}` : "No page anchor"}</span>
                  </div>
                  <p>{redline.note}</p>
                  {redline.anchorText ? <p className="muted-copy">Anchor: {redline.anchorText}</p> : null}
                  {redline.redlineStatus === "open" ? (
                    <form action={updateRedlineAction} className="document-redline__resolve-form">
                      <input name="redlineId" type="hidden" value={redline.id} />
                      <input name="redlineStatus" type="hidden" value="resolved" />
                      <button className="button-link button-link--quiet" type="submit">Resolve</button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No redlines recorded for this revision.</p>
          )}

          <form action={addRedlineAction} className="document-redline-form">
            <input name="documentRevisionId" type="hidden" value={revision.id} />
            <div className="form-row">
              <label className="form-label" htmlFor={`redline-note-${revision.id}`}>New redline</label>
              <textarea className="form-textarea" id={`redline-note-${revision.id}`} name="note" placeholder="Review note or markup summary." required />
            </div>
            <div className="document-redline-form__row">
              <input className="form-input" min={1} name="pageNumber" placeholder="Page" type="number" />
              <select className="form-select" name="severity" defaultValue="review">
                <option value="info">Info</option>
                <option value="review">Review</option>
                <option value="blocker">Blocker</option>
              </select>
            </div>
            <input className="form-input" name="anchorText" placeholder="Anchor text or drawing zone" />
            <button className="button-link" type="submit">Add redline</button>
          </form>
        </section>
      </div>
    </article>
  );
}
