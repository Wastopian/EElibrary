/**
 * File header: Client-side target selector for adding evidence from the global vault.
 */

"use client";

import React, { useState } from "react";
import { EvidenceAttachmentPanel } from "./EvidenceAttachmentPanel";
import { buildEvidenceTargetPickerOptionKey, evidenceTargetTypeOptions, filterEvidenceTargetPickerOptions, formatEvidenceTargetTypeLabel, getEvidenceTargetPlaceholder, readEvidenceTargetType } from "../lib/evidence-target-picker";
import type { EvidenceTargetPickerOption } from "../lib/evidence-target-picker";

/** EvidenceVaultAttachPanelProps carries server-loaded target suggestions into the client picker. */
export interface EvidenceVaultAttachPanelProps {
  /** Persisted target suggestions from project memory, catalog search, and the current vault rows. */
  initialOptions?: EvidenceTargetPickerOption[];
}

/**
 * Renders target selection before showing the existing evidence capture workflow.
 */
export function EvidenceVaultAttachPanel({ initialOptions = [] }: EvidenceVaultAttachPanelProps): React.ReactElement {
  const [targetType, setTargetType] = useState(readEvidenceTargetType("project"));
  const [targetSearch, setTargetSearch] = useState("");
  const [targetId, setTargetId] = useState("");
  const normalizedTargetId = targetId.trim();
  const filteredOptions = filterEvidenceTargetPickerOptions(initialOptions, targetType, targetSearch);
  const selectedOptionKey = readSelectedTargetKey(initialOptions, targetType, normalizedTargetId);

  return (
    <div className="evidence-vault-attach">
      <div className="evidence-vault-attach__target">
        <label>
          <span>Target type</span>
          <select onChange={(event) => {
            const nextTargetType = readEvidenceTargetType(event.target.value);
            setTargetType(nextTargetType);
            setTargetSearch("");
            setTargetId("");
          }} value={targetType}>
            {evidenceTargetTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="evidence-vault-attach__search">
          <span>Find target</span>
          <input onChange={(event) => setTargetSearch(event.target.value)} placeholder={getEvidenceTargetPlaceholder(targetType)} type="search" value={targetSearch} />
        </label>
        <label className="evidence-vault-attach__picker">
          <span>Persisted target</span>
          <select onChange={(event) => {
            const selectedOption = findTargetOptionByKey(initialOptions, event.target.value);

            if (selectedOption) {
              setTargetType(selectedOption.targetType);
              setTargetId(selectedOption.targetId);
              setTargetSearch(selectedOption.label);
            }
          }} value={selectedOptionKey}>
            <option value="">{filteredOptions.length > 0 ? `Choose ${formatEvidenceTargetTypeLabel(targetType).toLowerCase()}` : "No indexed target; use ID override"}</option>
            {filteredOptions.map((option) => (
              <option key={buildEvidenceTargetPickerOptionKey(option.targetType, option.targetId)} value={buildEvidenceTargetPickerOptionKey(option.targetType, option.targetId)}>
                {option.label} - {option.detail}
              </option>
            ))}
          </select>
        </label>
        <label className="evidence-vault-attach__manual">
          <span>ID override</span>
          <input onChange={(event) => setTargetId(event.target.value)} placeholder="Paste a saved id" value={targetId} />
        </label>
      </div>
      <EvidenceTargetSelectionSummary option={findTargetOption(initialOptions, targetType, normalizedTargetId)} targetId={normalizedTargetId} targetType={targetType} />
      {normalizedTargetId ? (
        <EvidenceAttachmentPanel submitLabel="Attach evidence" targetId={normalizedTargetId} targetType={targetType} />
      ) : (
        <p className="evidence-vault-attach__hint">Choose a saved target, or paste a target id, before attaching a link, note, or file.</p>
      )}
    </div>
  );
}

/**
 * Renders the currently selected target without claiming that evidence changes validation.
 */
function EvidenceTargetSelectionSummary({ option, targetId, targetType }: { option: EvidenceTargetPickerOption | null; targetId: string; targetType: ReturnType<typeof readEvidenceTargetType> }): React.ReactElement | null {
  if (!targetId) {
    return null;
  }

  return (
    <div className="evidence-vault-attach__selection">
      <span>{formatEvidenceTargetTypeLabel(targetType)}</span>
      <strong>{option?.label ?? targetId}</strong>
      <p>{option?.detail ?? "Manual ID override. The API will verify the target before saving evidence."}</p>
    </div>
  );
}

/**
 * Finds an option by target type and id for selected-target display.
 */
function findTargetOption(options: EvidenceTargetPickerOption[], targetType: ReturnType<typeof readEvidenceTargetType>, targetId: string): EvidenceTargetPickerOption | null {
  return options.find((option) => option.targetType === targetType && option.targetId === targetId) ?? null;
}

/**
 * Finds an option by its stable select key.
 */
function findTargetOptionByKey(options: EvidenceTargetPickerOption[], key: string): EvidenceTargetPickerOption | null {
  return options.find((option) => buildEvidenceTargetPickerOptionKey(option.targetType, option.targetId) === key) ?? null;
}

/**
 * Reads the matching select key when the current id came from an indexed target.
 */
function readSelectedTargetKey(options: EvidenceTargetPickerOption[], targetType: ReturnType<typeof readEvidenceTargetType>, targetId: string): string {
  const option = findTargetOption(options, targetType, targetId);

  return option ? buildEvidenceTargetPickerOptionKey(option.targetType, option.targetId) : "";
}
