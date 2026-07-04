/**
 * File header: Client-side circuit block part-role form for linking internal parts to reusable blocks.
 */

"use client";

import React, { useCallback, useState } from "react";
import { createCircuitBlockPart, isApiClientError } from "../lib/api-client";
import type { CircuitBlockPartCreateResponse, CircuitBlockPartSubstitutionPolicy } from "@ee-library/shared/types";

/** CircuitBlockPartAddStatus tracks persistence feedback for one role add. */
type CircuitBlockPartAddStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; response: CircuitBlockPartCreateResponse }
  | { kind: "failed"; message: string };

/** CircuitBlockPartAddPanelProps scopes the form to one circuit block id. */
export interface CircuitBlockPartAddPanelProps {
  circuitBlockId: string;
}

/**
 * Renders a compact role form for adding a known internal part to a block.
 */
export function CircuitBlockPartAddPanel({ circuitBlockId }: CircuitBlockPartAddPanelProps): React.ReactElement {
  const [partId, setPartId] = useState("");
  const [role, setRole] = useState("");
  const [quantity, setQuantity] = useState("");
  const [isRequired, setIsRequired] = useState(true);
  const [substitutionPolicy, setSubstitutionPolicy] = useState<CircuitBlockPartSubstitutionPolicy>("exact_required");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<CircuitBlockPartAddStatus>({ kind: "idle" });

  /**
   * Persists or refreshes a circuit-block part role.
   */
  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!partId.trim() || !role.trim()) {
        setStatus({ kind: "failed", message: "Part number (MPN) and role are required." });
        return;
      }

      const parsedQuantity = quantity.trim() ? Number(quantity) : null;

      if (parsedQuantity !== null && (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0)) {
        setStatus({ kind: "failed", message: "Quantity must be a positive number when provided." });
        return;
      }

      setStatus({ kind: "saving" });

      try {
        const response = await createCircuitBlockPart(circuitBlockId, {
          isRequired,
          notes: notes.trim() || null,
          partId: partId.trim(),
          quantity: parsedQuantity,
          role: role.trim(),
          substitutionPolicy
        });

        setStatus({ kind: "success", response });
        refreshCircuitBlockDetail();
      } catch (error) {
        setStatus({ kind: "failed", message: resolveCircuitBlockPartFailure(error) });
      }
    },
    [circuitBlockId, isRequired, notes, partId, quantity, role, substitutionPolicy]
  );

  return (
    <div className="circuit-block-part-panel">
      <form className="circuit-block-part-panel__form" onSubmit={onSubmit}>
        <label>
          <span>Part number (MPN)</span>
          <input autoComplete="off" onChange={(event) => setPartId(event.target.value)} placeholder="e.g. TPS7A02DBVR" value={partId} />
        </label>
        <label>
          <span>Role</span>
          <input autoComplete="off" onChange={(event) => setRole(event.target.value)} placeholder="Main regulator" value={role} />
        </label>
        <label>
          <span>Quantity</span>
          <input inputMode="decimal" onChange={(event) => setQuantity(event.target.value)} placeholder="1" value={quantity} />
        </label>
        <label>
          <span>Requirement</span>
          <select onChange={(event) => setIsRequired(event.target.value === "required")} value={isRequired ? "required" : "optional"}>
            <option value="required">Required</option>
            <option value="optional">Optional</option>
          </select>
        </label>
        <label>
          <span>Substitution</span>
          <select onChange={(event) => setSubstitutionPolicy(event.target.value as CircuitBlockPartSubstitutionPolicy)} value={substitutionPolicy}>
            <option value="exact_required">Exact required</option>
            <option value="approved_alternate_allowed">Approved alternate allowed</option>
            <option value="equivalent_allowed">Equivalent allowed</option>
            <option value="do_not_substitute">Do not substitute</option>
          </select>
        </label>
        <label className="circuit-block-part-panel__field--wide">
          <span>Notes</span>
          <input autoComplete="off" onChange={(event) => setNotes(event.target.value)} placeholder="Role-specific constraints or review notes" value={notes} />
        </label>
        <div className="circuit-block-part-panel__actions">
          <button disabled={status.kind === "saving"} type="submit">
            {status.kind === "saving" ? "Saving..." : "Add part role"}
          </button>
          <span>Part roles preserve reuse knowledge; they do not approve parts.</span>
        </div>
      </form>
      <CircuitBlockPartAddStatusMessage status={status} />
    </div>
  );
}

/**
 * Renders persistence feedback for part-role changes.
 */
function CircuitBlockPartAddStatusMessage({ status }: { status: CircuitBlockPartAddStatus }) {
  if (status.kind === "idle") {
    return null;
  }

  if (status.kind === "saving") {
    return <p className="circuit-block-part-panel__status circuit-block-part-panel__status--pending">Saving part role...</p>;
  }

  if (status.kind === "success") {
    return <p className="circuit-block-part-panel__status circuit-block-part-panel__status--success">Saved {status.response.circuitBlockPart.role}. {status.response.boundary}</p>;
  }

  return <p className="circuit-block-part-panel__status circuit-block-part-panel__status--failed">{status.message}</p>;
}

/**
 * Converts API failures into concise part-role copy.
 */
function resolveCircuitBlockPartFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Part role save failed. Check the part id and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Adding circuit block parts requires an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "Circuit block parts require the engineering-memory database.";
  }

  return error.message.replace(/^Circuit block part create failed \([^)]+\):\s*/u, "");
}

/**
 * Refreshes the detail route after a part role is saved.
 */
function refreshCircuitBlockDetail(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
