/**
 * File header: Client-side target selector for adding evidence from the global vault.
 */

"use client";

import React, { useState } from "react";
import { EvidenceAttachmentPanel } from "./EvidenceAttachmentPanel";
import type { EvidenceTargetType } from "@ee-library/shared/types";

/** evidenceTargetOptions lists target types supported by the API evidence contract. */
const evidenceTargetOptions: Array<{ label: string; value: EvidenceTargetType }> = [
  { label: "Project", value: "project" },
  { label: "BOM import", value: "bom_import" },
  { label: "BOM line", value: "bom_line" },
  { label: "Project usage", value: "project_part_usage" },
  { label: "Risk finding", value: "risk_finding" },
  { label: "Circuit block", value: "circuit_block" },
  { label: "Circuit block part", value: "circuit_block_part" },
  { label: "Part", value: "part" },
  { label: "Asset", value: "asset" }
];

/**
 * Renders target selection before showing the existing evidence capture workflow.
 */
export function EvidenceVaultAttachPanel(): React.ReactElement {
  const [targetType, setTargetType] = useState<EvidenceTargetType>("project");
  const [targetId, setTargetId] = useState("");
  const normalizedTargetId = targetId.trim();

  return (
    <div className="evidence-vault-attach">
      <div className="evidence-vault-attach__target">
        <label>
          <span>Target type</span>
          <select onChange={(event) => setTargetType(readEvidenceTargetType(event.target.value))} value={targetType}>
            {evidenceTargetOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Target id</span>
          <input onChange={(event) => setTargetId(event.target.value)} placeholder="project-alpha or line-alpha-1" value={targetId} />
        </label>
      </div>
      {normalizedTargetId ? (
        <EvidenceAttachmentPanel submitLabel="Attach evidence" targetId={normalizedTargetId} targetType={targetType} />
      ) : (
        <p className="evidence-vault-attach__hint">Enter a persisted target id before attaching link, note, or file evidence.</p>
      )}
    </div>
  );
}

/**
 * Reads supported evidence target types without trusting raw DOM values.
 */
function readEvidenceTargetType(value: string): EvidenceTargetType {
  return evidenceTargetOptions.find((option) => option.value === value)?.value ?? "project";
}
