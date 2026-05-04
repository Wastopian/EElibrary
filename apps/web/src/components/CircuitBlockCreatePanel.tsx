/**
 * File header: Client-side circuit block creation panel for structured reusable circuit memory.
 */

"use client";

import React, { useCallback, useState } from "react";
import { createCircuitBlock, isApiClientError } from "../lib/api-client";
import type { CircuitBlockCreateResponse, CircuitBlockStatus, CircuitBlockType } from "@ee-library/shared/types";

/** CircuitBlockCreateStatus tracks operator feedback without implying part readiness. */
type CircuitBlockCreateStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; response: CircuitBlockCreateResponse }
  | { kind: "failed"; message: string };

/**
 * Renders a compact form that creates a reusable circuit block shell.
 */
export function CircuitBlockCreatePanel(): React.ReactElement {
  const [blockKey, setBlockKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [reuseScope, setReuseScope] = useState("");
  const [constraintsNote, setConstraintsNote] = useState("");
  const [blockType, setBlockType] = useState<CircuitBlockType>("power");
  const [status, setStatus] = useState<CircuitBlockStatus>("draft");
  const [createStatus, setCreateStatus] = useState<CircuitBlockCreateStatus>({ kind: "idle" });

  /**
   * Creates the block and opens its detail workspace once persistence succeeds.
   */
  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!blockKey.trim() || !name.trim()) {
        setCreateStatus({ kind: "failed", message: "Block key and name are required." });
        return;
      }

      setCreateStatus({ kind: "submitting" });

      try {
        const response = await createCircuitBlock({
          blockKey: blockKey.trim(),
          blockType,
          constraints: constraintsNote.trim() ? { note: constraintsNote.trim() } : {},
          description: description.trim() || null,
          name: name.trim(),
          owner: owner.trim() || null,
          reuseScope: reuseScope.trim() || null,
          status
        });

        setCreateStatus({ kind: "success", response });
        navigateToCircuitBlock(response.circuitBlock.id);
      } catch (error) {
        setCreateStatus({ kind: "failed", message: resolveCircuitBlockCreateFailure(error) });
      }
    },
    [blockKey, blockType, constraintsNote, description, name, owner, reuseScope, status]
  );

  return (
    <div className="circuit-block-create-panel">
      <form className="circuit-block-create-panel__form" onSubmit={onSubmit}>
        <label>
          <span>Block key</span>
          <input autoComplete="off" onChange={(event) => setBlockKey(event.target.value)} placeholder="POWER-5V-BUCK" value={blockKey} />
        </label>
        <label>
          <span>Name</span>
          <input autoComplete="off" onChange={(event) => setName(event.target.value)} placeholder="5 V buck regulator" value={name} />
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
          <input autoComplete="off" onChange={(event) => setReuseScope(event.target.value)} placeholder="Motor control boards only" value={reuseScope} />
        </label>
        <label className="circuit-block-create-panel__field--wide">
          <span>Description</span>
          <input autoComplete="off" onChange={(event) => setDescription(event.target.value)} placeholder="What design pattern does this preserve?" value={description} />
        </label>
        <label className="circuit-block-create-panel__field--wide">
          <span>Constraints</span>
          <input autoComplete="off" onChange={(event) => setConstraintsNote(event.target.value)} placeholder="Voltage, current, layout, thermal, or sourcing constraints" value={constraintsNote} />
        </label>
        <div className="circuit-block-create-panel__actions">
          <button disabled={createStatus.kind === "submitting"} type="submit">
            {createStatus.kind === "submitting" ? "Creating..." : "Create circuit block"}
          </button>
          <span>Creates structured reusable circuit memory, not a part approval.</span>
        </div>
      </form>
      <CircuitBlockCreateStatusMessage status={createStatus} />
    </div>
  );
}

/**
 * Renders circuit block creation feedback.
 */
function CircuitBlockCreateStatusMessage({ status }: { status: CircuitBlockCreateStatus }) {
  if (status.kind === "idle") {
    return null;
  }

  if (status.kind === "submitting") {
    return <p className="circuit-block-create-panel__status circuit-block-create-panel__status--pending">Creating circuit block...</p>;
  }

  if (status.kind === "success") {
    return <p className="circuit-block-create-panel__status circuit-block-create-panel__status--success">Created {status.response.circuitBlock.blockKey}. Opening detail workspace.</p>;
  }

  return <p className="circuit-block-create-panel__status circuit-block-create-panel__status--failed">{status.message}</p>;
}

/**
 * Converts API failures into concise block-creation copy.
 */
function resolveCircuitBlockCreateFailure(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Circuit block creation failed. Check the API and try again.";
  }

  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "Circuit block creation requires an admin session.";
  }

  if (error.code === "DB_NOT_CONFIGURED") {
    return "Circuit block creation requires the engineering-memory database.";
  }

  return error.message.replace(/^Circuit block create failed \([^)]+\):\s*/u, "");
}

/**
 * Opens the created circuit block detail route when running in the browser.
 */
function navigateToCircuitBlock(circuitBlockId: string): void {
  if (typeof window !== "undefined") {
    window.location.assign(`/circuit-blocks/${encodeURIComponent(circuitBlockId)}`);
  }
}
