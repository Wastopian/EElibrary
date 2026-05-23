/**
 * File header: Client-side scratchpad tools for the dedicated /tools workspace.
 *
 * The calculators are intentionally local-only. Results are presented as evidence-note
 * drafts so engineers can attach reviewed reasoning elsewhere without these tools
 * mutating project, approval, validation, or export state.
 */

"use client";

import React, { useMemo, useState } from "react";
import { StatusBadge } from "@ee-library/ui";
import type { BadgeTone } from "@ee-library/ui";
import {
  calculatePowerDerating,
  calculatePullupEdge,
  calculateVoltageDivider,
  type EngineeringToolFact,
  type EngineeringToolResult,
  type EngineeringToolTone,
  type PowerDeratingInput,
  type PullupEdgeInput,
  type VoltageDividerInput
} from "../lib/engineering-tools";

/** ToolKey identifies the three first-shipped engineering-memory scratch tools. */
type ToolKey = "divider" | "pullup" | "power";

/** ToolTab describes one selectable calculator tab. */
interface ToolTab {
  description: string;
  key: ToolKey;
  label: string;
}

/** DEFAULT_DIVIDER_INPUT is a conservative 3.3 V half-divider starting point. */
const DEFAULT_DIVIDER_INPUT: VoltageDividerInput = {
  bottomResistanceOhms: 10_000,
  bottomTolerancePercent: 1,
  inputVoltage: 3.3,
  loadResistanceOhms: null,
  topResistanceOhms: 10_000,
  topTolerancePercent: 1
};

/** DEFAULT_PULLUP_INPUT starts near a common small I2C/control-line check. */
const DEFAULT_PULLUP_INPUT: PullupEdgeInput = {
  busCapacitancePicofarads: 100,
  pullupResistanceOhms: 4_700,
  riseTimeLimitMicroseconds: 1,
  supplyVoltage: 3.3
};

/** DEFAULT_POWER_INPUT starts with a modest linear-regulator/package dissipation check. */
const DEFAULT_POWER_INPUT: PowerDeratingInput = {
  ambientCelsius: 25,
  deratingTargetPercent: 50,
  loadCurrentAmps: 0.1,
  maxJunctionCelsius: 125,
  packagePowerRatingWatts: 0.5,
  thermalResistanceCPerWatt: 100,
  voltageDropVolts: 2
};

/** TOOL_TABS keeps the rendered tab labels and active descriptions in one place. */
const TOOL_TABS: ToolTab[] = [
  {
    description: "Divider tolerance and load shift",
    key: "divider",
    label: "Voltage divider"
  },
  {
    description: "Pull-up edge and sink current",
    key: "pullup",
    label: "Pull-up edge"
  },
  {
    description: "Package dissipation and derating",
    key: "power",
    label: "Power derating"
  }
];

/**
 * Renders the active tool, its input grid, result facts, and copyable evidence note.
 */
export function EngineeringToolsWorkspace(): React.ReactElement {
  const [activeTool, setActiveTool] = useState<ToolKey>("divider");
  const [dividerInput, setDividerInput] = useState<VoltageDividerInput>(DEFAULT_DIVIDER_INPUT);
  const [pullupInput, setPullupInput] = useState<PullupEdgeInput>(DEFAULT_PULLUP_INPUT);
  const [powerInput, setPowerInput] = useState<PowerDeratingInput>(DEFAULT_POWER_INPUT);
  const [copyStatus, setCopyStatus] = useState<string>("");

  const result = useMemo(() => {
    if (activeTool === "pullup") {
      return calculatePullupEdge(pullupInput);
    }

    if (activeTool === "power") {
      return calculatePowerDerating(powerInput);
    }

    return calculateVoltageDivider(dividerInput);
  }, [activeTool, dividerInput, powerInput, pullupInput]);

  return (
    <div className="engineering-tools" id="tools-workbench">
      <div aria-label="Engineering tool selector" className="tools-tablist" role="tablist">
        {TOOL_TABS.map((tool) => {
          const selected = activeTool === tool.key;

          return (
            <button
              aria-controls={`tool-panel-${tool.key}`}
              aria-selected={selected}
              className={selected ? "tools-tab tools-tab--active" : "tools-tab"}
              id={`tool-tab-${tool.key}`}
              key={tool.key}
              onClick={() => {
                setActiveTool(tool.key);
                setCopyStatus("");
              }}
              role="tab"
              type="button"
            >
              <span>{tool.label}</span>
              <small>{tool.description}</small>
            </button>
          );
        })}
      </div>

      <div aria-labelledby={`tool-tab-${activeTool}`} className="tools-panel" id={`tool-panel-${activeTool}`} role="tabpanel">
        <div className="tools-panel__form">
          <ToolForm
            activeTool={activeTool}
            dividerInput={dividerInput}
            onDividerInputChange={setDividerInput}
            onPowerInputChange={setPowerInput}
            onPullupInputChange={setPullupInput}
            powerInput={powerInput}
            pullupInput={pullupInput}
          />
        </div>
        <ToolResult result={result} />
        <EvidenceNote copyStatus={copyStatus} note={result.evidenceNote} onCopyStatusChange={setCopyStatus} />
      </div>
    </div>
  );
}

/**
 * Renders the input form for the selected calculator.
 */
function ToolForm({
  activeTool,
  dividerInput,
  onDividerInputChange,
  onPowerInputChange,
  onPullupInputChange,
  powerInput,
  pullupInput
}: {
  activeTool: ToolKey;
  dividerInput: VoltageDividerInput;
  onDividerInputChange: React.Dispatch<React.SetStateAction<VoltageDividerInput>>;
  onPowerInputChange: React.Dispatch<React.SetStateAction<PowerDeratingInput>>;
  onPullupInputChange: React.Dispatch<React.SetStateAction<PullupEdgeInput>>;
  powerInput: PowerDeratingInput;
  pullupInput: PullupEdgeInput;
}) {
  if (activeTool === "pullup") {
    return (
      <fieldset className="tools-fieldset">
        <legend>Pull-up edge inputs</legend>
        <ToolNumberField label="Supply voltage" unit="V" value={pullupInput.supplyVoltage} onChange={(value) => onPullupInputChange((current) => ({ ...current, supplyVoltage: value ?? Number.NaN }))} />
        <ToolNumberField label="Pull-up resistance" unit="ohm" value={pullupInput.pullupResistanceOhms} onChange={(value) => onPullupInputChange((current) => ({ ...current, pullupResistanceOhms: value ?? Number.NaN }))} />
        <ToolNumberField label="Bus capacitance" unit="pF" value={pullupInput.busCapacitancePicofarads} onChange={(value) => onPullupInputChange((current) => ({ ...current, busCapacitancePicofarads: value ?? Number.NaN }))} />
        <ToolNumberField label="Rise-time limit" unit="us" value={pullupInput.riseTimeLimitMicroseconds} onChange={(value) => onPullupInputChange((current) => ({ ...current, riseTimeLimitMicroseconds: value ?? Number.NaN }))} />
      </fieldset>
    );
  }

  if (activeTool === "power") {
    return (
      <fieldset className="tools-fieldset tools-fieldset--dense">
        <legend>Power derating inputs</legend>
        <ToolNumberField label="Load current" unit="A" value={powerInput.loadCurrentAmps} onChange={(value) => onPowerInputChange((current) => ({ ...current, loadCurrentAmps: value ?? Number.NaN }))} />
        <ToolNumberField label="Voltage drop" unit="V" value={powerInput.voltageDropVolts} onChange={(value) => onPowerInputChange((current) => ({ ...current, voltageDropVolts: value ?? Number.NaN }))} />
        <ToolNumberField label="Package rating" unit="W" value={powerInput.packagePowerRatingWatts} onChange={(value) => onPowerInputChange((current) => ({ ...current, packagePowerRatingWatts: value ?? Number.NaN }))} />
        <ToolNumberField label="Derating target" unit="%" value={powerInput.deratingTargetPercent} onChange={(value) => onPowerInputChange((current) => ({ ...current, deratingTargetPercent: value ?? Number.NaN }))} />
        <ToolNumberField label="Ambient" unit="C" value={powerInput.ambientCelsius} onChange={(value) => onPowerInputChange((current) => ({ ...current, ambientCelsius: value ?? Number.NaN }))} />
        <ToolNumberField label="Theta JA" unit="C/W" value={powerInput.thermalResistanceCPerWatt} onChange={(value) => onPowerInputChange((current) => ({ ...current, thermalResistanceCPerWatt: value ?? Number.NaN }))} />
        <ToolNumberField label="Max junction" unit="C" value={powerInput.maxJunctionCelsius} onChange={(value) => onPowerInputChange((current) => ({ ...current, maxJunctionCelsius: value ?? Number.NaN }))} />
      </fieldset>
    );
  }

  return (
    <fieldset className="tools-fieldset tools-fieldset--dense">
      <legend>Voltage divider inputs</legend>
      <ToolNumberField label="Input voltage" unit="V" value={dividerInput.inputVoltage} onChange={(value) => onDividerInputChange((current) => ({ ...current, inputVoltage: value ?? Number.NaN }))} />
      <ToolNumberField label="Top resistor" unit="ohm" value={dividerInput.topResistanceOhms} onChange={(value) => onDividerInputChange((current) => ({ ...current, topResistanceOhms: value ?? Number.NaN }))} />
      <ToolNumberField label="Bottom resistor" unit="ohm" value={dividerInput.bottomResistanceOhms} onChange={(value) => onDividerInputChange((current) => ({ ...current, bottomResistanceOhms: value ?? Number.NaN }))} />
      <ToolNumberField label="Top tolerance" unit="%" value={dividerInput.topTolerancePercent} onChange={(value) => onDividerInputChange((current) => ({ ...current, topTolerancePercent: value ?? Number.NaN }))} />
      <ToolNumberField label="Bottom tolerance" unit="%" value={dividerInput.bottomTolerancePercent} onChange={(value) => onDividerInputChange((current) => ({ ...current, bottomTolerancePercent: value ?? Number.NaN }))} />
      <ToolNumberField label="Load resistance" optional unit="ohm" value={dividerInput.loadResistanceOhms} onChange={(value) => onDividerInputChange((current) => ({ ...current, loadResistanceOhms: value }))} />
    </fieldset>
  );
}

/**
 * Renders one numeric input with a compact unit suffix.
 */
function ToolNumberField({
  label,
  onChange,
  optional = false,
  unit,
  value
}: {
  label: string;
  onChange: (value: number | null) => void;
  optional?: boolean;
  unit: string;
  value: number | null;
}) {
  return (
    <label className="tools-number-field">
      <span>
        {label}
        <small>{unit}</small>
      </span>
      <input
        aria-label={label}
        inputMode="decimal"
        min={optional ? undefined : 0}
        onChange={(event) => onChange(parseNumberInput(event.currentTarget.value))}
        step="any"
        type="number"
        value={formatInputValue(value)}
      />
    </label>
  );
}

/**
 * Renders the headline and fact grid for a calculator result.
 */
function ToolResult({ result }: { result: EngineeringToolResult }) {
  return (
    <section aria-live="polite" className="tools-result">
      <div className="tools-result__header">
        <div>
          <span>Result</span>
          <h3>{result.headline}</h3>
        </div>
        <StatusBadge label={result.inputIssues.length > 0 ? "Check inputs" : result.tone === "verified" ? "Looks reasonable" : result.tone} tone={toBadgeTone(result.tone)} />
      </div>

      {result.inputIssues.length > 0 ? (
        <ul className="tools-issue-list">
          {result.inputIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : (
        <div className="tools-result-grid">
          {result.facts.map((fact) => (
            <ToolFactCard fact={fact} key={fact.label} />
          ))}
        </div>
      )}

      <p className="tools-boundary-copy">{result.boundary}</p>
    </section>
  );
}

/**
 * Renders one dense result fact.
 */
function ToolFactCard({ fact }: { fact: EngineeringToolFact }) {
  return (
    <div className="tools-fact">
      <span>{fact.label}</span>
      <strong>{fact.value}</strong>
      <p>{fact.detail}</p>
      <StatusBadge label={fact.tone} tone={toBadgeTone(fact.tone)} />
    </div>
  );
}

/**
 * Renders the copyable evidence note alongside the active result.
 */
function EvidenceNote({
  copyStatus,
  note,
  onCopyStatusChange
}: {
  copyStatus: string;
  note: string;
  onCopyStatusChange: (status: string) => void;
}) {
  return (
    <section className="tools-evidence-note">
      <div className="tools-evidence-note__header">
        <div>
          <span>Evidence note draft</span>
          <h3>Copyable calculation record</h3>
        </div>
        <button onClick={() => void copyEvidenceNote(note, onCopyStatusChange)} type="button">Copy note</button>
      </div>
      <textarea aria-label="Evidence note draft" readOnly rows={8} value={note} />
      {copyStatus ? <p className="muted-copy" role="status">{copyStatus}</p> : null}
    </section>
  );
}

/**
 * Copies the generated note when the browser allows clipboard writes.
 */
async function copyEvidenceNote(note: string, onCopyStatusChange: (status: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(note);
    onCopyStatusChange("Copied. Attach it to the relevant project, part, or evidence record after review.");
  } catch {
    onCopyStatusChange("Clipboard was unavailable. Select the note text and copy it manually.");
  }
}

/**
 * Parses a numeric field while preserving blank values as null for validation.
 */
function parseNumberInput(value: string): number | null {
  if (value.trim().length === 0) {
    return null;
  }

  return Number(value);
}

/**
 * Formats input values so invalid numbers render as an empty editable field.
 */
function formatInputValue(value: number | null): string | number {
  if (value === null || !Number.isFinite(value)) {
    return "";
  }

  return value;
}

/**
 * Narrows engineering-tool tones into shared badge tones.
 */
function toBadgeTone(tone: EngineeringToolTone): BadgeTone {
  return tone;
}
