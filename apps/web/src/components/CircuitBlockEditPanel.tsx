/**
 * File header: Client-side circuit block metadata editor for reusable circuit memory.
 */

"use client";

import React, { useCallback, useState } from "react";
import { isApiClientError, updateCircuitBlock } from "../lib/api-client";
import type { CircuitBlock, CircuitBlockStatus, CircuitBlockType } from "@ee-library/shared/types";

/** CircuitBlockEditPanelProps seeds the editor from the persisted block record. */
export interface CircuitBlockEditPanelProps {
  circuitBlock: CircuitBlock;
}

/** CircuitBlockEditStatus tracks operator feedback for metadata saves. */
type CircuitBlockEditStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; message: string }
  | { kind: "failed"; message: string };

/**
 * Renders the circuit-block metadata edit form without touching linked-part trust state.
 */
export function CircuitBlockEditPanel({ circuitBlock }: CircuitBlockEditPanelProps): React.ReactElement {
  const [name, setName] = useState(circuitBlock.name);
  const [description, setDescription] = useState(circuitBlock.description);
  const [blockType, setBlockType] = useState<CircuitBlockType>(circuitBlock.blockType);
  const [owner, setOwner] = useState(circuitBlock.owner ?? "");
  const [status, setStatus] = useState<CircuitBlockStatus>(circuitBlock.status);
  const [reuseScope, setReuseScope] = useState(circuitBlock.reuseScope);
  const [constraintsNote, setConstraintsNote] = useState(readConstraintsNote(circuitBlock.constraints));
  const [editStatus, setEditStatus] = useState<CircuitBlockEditStatus>({ kind: "idle" });

  /**
   * Persists circuit block metadata while preserving linked-part readiness boundaries.
   */
  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!name.trim()) {
        setEditStatus({ kind: "failed", message: "Circuit block name is required." });
        return;
      }

      setEditStatus({ kind: "saving" });

      try {
        const response = await updateCircuitBlock(circuitBlock.id, {
          blockType,
          constraints: constraintsNote.trim() ? { note: constraintsNote.trim() } : {},
          description: description.trim() || null,
          name: name.trim(),
          owner: owner.trim() || null,
          reuseScope: reuseScope.trim() || null,
          status
        });

        setEditStatus({ kind: "success", message: response.boundary });
        refreshCircuitBlockDetail();
      } catch (error) {
        setEditStatus({ kind: "failed", message: resolveCircuitBlockEditFailure(error) });
      }
    },
    [blockType, circuitBlock.id, constraintsNote, description, name, owner, reuseScope, status]
  );

  return (
    <div className="circuit-block-edit-panel">
      <form className="circuit-block-edit-panel__form" onSubmit={onSubmit}>
        <label>
          <span>Name</span>
          <input autoComplete="off" onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label>
          <span>Type</span>
          <select onChange={(event) => setBlockType(event.target.value as CircuitBlockType)} value={blockType}>
            <option value="power">Power</option>
            <option value="mcu_support">MCU support</option>
            <option value="interface">Interface</option>
            <option value="protection">Protection</option>
            <option value="connector_set">Connector set</option>
            <option value="sensor_front_end">Sensor front end</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select onChange={(event) => setStatus(event.target.value as CircuitBlockStatus)} value={status}>
            <option value="draft">Draft</option>
            <option value="in_review">In review</option>
            <option value="approved">Approved</option>
            <option value="restricted">Restricted</option>
            <option value="deprecated">Deprecated</option>
          </select>
        </label>
        <label>
          <span>Owner</span>
          <input autoComplete="off" onChange={(event) => setOwner(event.target.value)} placeholder="Hardware" value={owner} />
        </label>
        <label>
          <span>Reuse scope</span>
          <input autoComplete="off" onChange={(event) => setReuseScope(event.target.value)} placeholder="Approved boards, programs, or conditions" value={reuseScope} />
        </label>
        <label className="circuit-block-edit-panel__field--wide">
          <span>Description</span>
          <input autoComplete="off" onChange={(event) => setDescription(event.target.value)} placeholder="What design pattern does this preserve?" value={description} />
        </label>
        <label className="circuit-block-edit-panel__field--wide">
          <span>Constraints</span>
          <input autoComplete="off" onChange={(event) => setConstraintsNote(event.target.value)} placeholder="Voltage, current, layout, thermal, or sourcing constraints" value={constraintsNote} />
        </label>
        <div className="circuit-block-edit-panel__actions">
          <button disabled={editStatus.kind === "saving"} type="submit">
            {editStatus.kind === "saving" ? "Saving..." : "Save circuit block"}
          </button>
          <span>Block status does not approve linked parts.</span>
        </div>
      </form>
      <CircuitBlockEditStatusMessage status={editStatus} />
    </div>
  );
}

/**
 * Reads the common note constraint from a flexible JSON constraint object.
 */
function readConstraintsNote(constraints: Record<string, unknown>): string {
  return typeof constraints.note === "string" ? constraints.note : "";
}

/**
 * Renders block edit feedback.
 */
function CircuitBlockEditStatusMessage({ status }: { status: CircuitBlockEditStatus }): React.ReactElement | null {
  if (status.kind === "idle") {
    return null;
  }

  if (status.kind === "saving") {
    return <p className="circuit-block-edit-panel__status circuit-block-edit-panel__status--pending">Saving circuit block metadata...</p>;
  }

  if (status.kind === "success") {
    return <p className="circuit-block-edit-panel__status circuit-block-edit-panel__status--success">{status.message}</p>;
  }

  return <p className="circuit-block-edit-panel__status circuit-block-edit-panel__status--failed">{status.message}</p>;
}

/**
 * Converts API failures into concise circuit-block edit copy.
 */
function resolveCircuitBlockEditFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Circuit block update failed. Check the API and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Circuit block updates require an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "Circuit block updates require the engineering-memory database.";
  }

  return error.message.replace(/^Circuit block update failed \([^)]+\):\s*/u, "");
}

/**
 * Refreshes the detail route after block metadata is saved.
 */
function refreshCircuitBlockDetail(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
