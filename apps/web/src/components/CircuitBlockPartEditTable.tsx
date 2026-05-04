/**
 * File header: Client-side editable table for circuit block part-role metadata.
 */

"use client";

import Link from "next/link";
import React, { useCallback, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import { isApiClientError, updateCircuitBlockPart } from "../lib/api-client";
import type { BadgeTone } from "@ee-library/ui";
import type { CircuitBlockPartRecord, CircuitBlockPartSubstitutionPolicy } from "@ee-library/shared/types";

/** CircuitBlockPartEditTableProps scopes editable role rows to one block. */
export interface CircuitBlockPartEditTableProps {
  circuitBlockId: string;
  parts: CircuitBlockPartRecord[];
}

/** RoleSaveState tracks which row is being saved and what feedback should be shown. */
type RoleSaveState =
  | { kind: "idle" }
  | { kind: "saving"; rowId: string }
  | { kind: "success"; rowId: string; message: string }
  | { kind: "failed"; rowId: string; message: string };

/**
 * Renders editable part-role rows while keeping current part readiness read-only.
 */
export function CircuitBlockPartEditTable({ circuitBlockId, parts }: CircuitBlockPartEditTableProps): React.ReactElement {
  const [saveState, setSaveState] = useState<RoleSaveState>({ kind: "idle" });

  /**
   * Saves one role from its row form data.
   */
  const saveRole = useCallback(
    async (record: CircuitBlockPartRecord, formData: FormData) => {
      const quantityValue = String(formData.get("quantity") ?? "").trim();
      const quantity = quantityValue ? Number(quantityValue) : null;
      const isRequired = String(formData.get("requirement") ?? "required") === "required";
      const substitutionPolicy = String(formData.get("substitutionPolicy") ?? record.blockPart.substitutionPolicy) as CircuitBlockPartSubstitutionPolicy;
      const notes = String(formData.get("notes") ?? "").trim() || null;

      if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
        setSaveState({ kind: "failed", message: "Quantity must be a positive number when provided.", rowId: record.blockPart.id });
        return;
      }

      setSaveState({ kind: "saving", rowId: record.blockPart.id });

      try {
        const response = await updateCircuitBlockPart(circuitBlockId, record.blockPart.id, {
          isRequired,
          notes,
          quantity,
          substitutionPolicy
        });

        setSaveState({ kind: "success", message: response.boundary, rowId: record.blockPart.id });
        refreshCircuitBlockDetail();
      } catch (error) {
        setSaveState({ kind: "failed", message: resolveCircuitBlockPartEditFailure(error), rowId: record.blockPart.id });
      }
    },
    [circuitBlockId]
  );

  return (
    <div className="projects-table-wrap">
      <table className="projects-table circuit-block-part-edit-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Part</th>
            <th>Requirement</th>
            <th>Quantity</th>
            <th>Substitution</th>
            <th>Approval</th>
            <th>Readiness</th>
            <th>Notes</th>
            <th>Save</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((record) => (
            <CircuitBlockPartEditRow key={record.blockPart.id} record={record} saveRole={saveRole} saveState={saveState} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** CircuitBlockPartEditRowProps carries one editable role and shared save feedback. */
interface CircuitBlockPartEditRowProps {
  record: CircuitBlockPartRecord;
  saveRole: (record: CircuitBlockPartRecord, formData: FormData) => Promise<void>;
  saveState: RoleSaveState;
}

/**
 * Renders one editable circuit-block role row.
 */
function CircuitBlockPartEditRow({ record, saveRole, saveState }: CircuitBlockPartEditRowProps): React.ReactElement {
  const isSaving = saveState.kind === "saving" && saveState.rowId === record.blockPart.id;
  const rowMessage = (saveState.kind === "success" || saveState.kind === "failed") && saveState.rowId === record.blockPart.id ? saveState.message : null;

  return (
    <tr>
      <td>{record.blockPart.role}</td>
      <td>
        <Link href={`/parts/${record.part.partId}`}>
          <span className="ui-mono">{record.part.mpn}</span>
        </Link>
        <div className="muted-copy">{record.part.manufacturerName}</div>
      </td>
      <td>
        <select aria-label={`${record.blockPart.role} requirement`} defaultValue={record.blockPart.isRequired ? "required" : "optional"} form={`role-form-${record.blockPart.id}`} name="requirement">
          <option value="required">Required</option>
          <option value="optional">Optional</option>
        </select>
      </td>
      <td>
        <input aria-label={`${record.blockPart.role} quantity`} defaultValue={record.blockPart.quantity ?? ""} form={`role-form-${record.blockPart.id}`} inputMode="decimal" name="quantity" placeholder="Not set" />
      </td>
      <td>
        <select aria-label={`${record.blockPart.role} substitution policy`} defaultValue={record.blockPart.substitutionPolicy} form={`role-form-${record.blockPart.id}`} name="substitutionPolicy">
          <option value="exact_required">Exact required</option>
          <option value="approved_alternate_allowed">Approved alternate allowed</option>
          <option value="equivalent_allowed">Equivalent allowed</option>
          <option value="do_not_substitute">Do not substitute</option>
        </select>
      </td>
      <td>
        <StatusBadge label={record.part.approvalStatus ?? "Not recorded"} tone={approvalTone(record.part.approvalStatus)} />
      </td>
      <td>
        <StatusBadge label={record.part.readinessStatus ?? "Not recorded"} tone={record.part.readinessStatus === "ready_for_export_review" ? "verified" : "review"} />
        {record.part.blockerCount ? <div className="muted-copy">{record.part.blockerCount} blockers</div> : null}
      </td>
      <td>
        <input aria-label={`${record.blockPart.role} notes`} defaultValue={record.blockPart.notes ?? ""} form={`role-form-${record.blockPart.id}`} name="notes" placeholder="None" />
      </td>
      <td>
        <form
          id={`role-form-${record.blockPart.id}`}
          onSubmit={(event) => {
            event.preventDefault();
            void saveRole(record, new FormData(event.currentTarget));
          }}
        >
          <button disabled={isSaving} type="submit">
            {isSaving ? "Saving..." : "Save"}
          </button>
        </form>
        {rowMessage ? <p className={`circuit-block-part-edit-table__status circuit-block-part-edit-table__status--${saveState.kind}`}>{rowMessage}</p> : null}
      </td>
    </tr>
  );
}

/**
 * Maps approval state to an existing badge tone without changing approval itself.
 */
function approvalTone(approvalStatus: CircuitBlockPartRecord["part"]["approvalStatus"]): BadgeTone {
  return approvalStatus === "approved" ? "verified" : "review";
}

/**
 * Converts API failures into concise part-role edit copy.
 */
function resolveCircuitBlockPartEditFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Part-role update failed. Check the role metadata and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Part-role updates require an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "Part-role updates require the engineering-memory database.";
  }

  return error.message.replace(/^Circuit block part update failed \([^)]+\):\s*/u, "");
}

/**
 * Refreshes the detail route after a role edit is saved.
 */
function refreshCircuitBlockDetail(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
