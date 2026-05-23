/**
 * File header: Provider-neutral engineering calculator helpers for the /tools workspace.
 *
 * These helpers are deliberately scratchpad-only. They produce repeatable math and
 * evidence-note drafts, but they never change approval, validation, export, or project
 * memory state by themselves.
 */

/** EngineeringToolTone mirrors the shared badge tones used by the web UI. */
export type EngineeringToolTone = "neutral" | "info" | "verified" | "review" | "danger";

/** EngineeringToolFact is one dense, labeled result row for a calculator. */
export interface EngineeringToolFact {
  detail: string;
  label: string;
  tone: EngineeringToolTone;
  value: string;
}

/** EngineeringToolResult is the shared result envelope rendered by every calculator. */
export interface EngineeringToolResult {
  boundary: string;
  evidenceNote: string;
  facts: EngineeringToolFact[];
  headline: string;
  inputIssues: string[];
  tone: EngineeringToolTone;
}

/** VoltageDividerInput captures the values needed for a load-aware divider estimate. */
export interface VoltageDividerInput {
  bottomResistanceOhms: number;
  bottomTolerancePercent: number;
  inputVoltage: number;
  loadResistanceOhms: number | null;
  topResistanceOhms: number;
  topTolerancePercent: number;
}

/** VoltageDividerResult extends the shared envelope with raw values for tests and reuse. */
export interface VoltageDividerResult extends EngineeringToolResult {
  dividerCurrentMilliamps: number | null;
  loadErrorPercent: number | null;
  maxOutputVoltage: number | null;
  minOutputVoltage: number | null;
  nominalOutputVoltage: number | null;
  outputSpreadPercent: number | null;
}

/** PullupEdgeInput captures the values needed for a first-order pull-up timing check. */
export interface PullupEdgeInput {
  busCapacitancePicofarads: number;
  pullupResistanceOhms: number;
  riseTimeLimitMicroseconds: number;
  supplyVoltage: number;
}

/** PullupEdgeResult extends the shared envelope with timing and current values. */
export interface PullupEdgeResult extends EngineeringToolResult {
  lowLevelCurrentMilliamps: number | null;
  riseTimeMicroseconds: number | null;
  timeConstantMicroseconds: number | null;
}

/** PowerDeratingInput captures the values needed for a package-level dissipation check. */
export interface PowerDeratingInput {
  ambientCelsius: number;
  deratingTargetPercent: number;
  loadCurrentAmps: number;
  maxJunctionCelsius: number;
  packagePowerRatingWatts: number;
  thermalResistanceCPerWatt: number;
  voltageDropVolts: number;
}

/** PowerDeratingResult extends the shared envelope with raw dissipation values. */
export interface PowerDeratingResult extends EngineeringToolResult {
  allowedPowerWatts: number | null;
  estimatedJunctionCelsius: number | null;
  powerWatts: number | null;
  thermalMarginCelsius: number | null;
}

const SCRATCHPAD_BOUNDARY = "Scratchpad only: attach the note as evidence if it matters, then review the actual part, package, layout, and datasheet before approval or export.";

/**
 * Calculates a voltage divider with optional load resistance and worst-case resistor tolerance.
 */
export function calculateVoltageDivider(input: VoltageDividerInput): VoltageDividerResult {
  const issues = collectPositiveInputIssues([
    ["Input voltage", input.inputVoltage],
    ["Top resistor", input.topResistanceOhms],
    ["Bottom resistor", input.bottomResistanceOhms]
  ]);

  if (input.loadResistanceOhms !== null && input.loadResistanceOhms <= 0) {
    issues.push("Load resistance must be positive or blank.");
  }

  if (issues.length > 0) {
    return buildInvalidVoltageDividerResult(issues);
  }

  const topTolerance = percentToRatio(input.topTolerancePercent);
  const bottomTolerance = percentToRatio(input.bottomTolerancePercent);
  const loadResistance = input.loadResistanceOhms && input.loadResistanceOhms > 0 ? input.loadResistanceOhms : null;
  const unloadedOutput = dividerOutput(input.inputVoltage, input.topResistanceOhms, input.bottomResistanceOhms);
  const effectiveBottom = loadResistance ? parallelResistance(input.bottomResistanceOhms, loadResistance) : input.bottomResistanceOhms;
  const nominalOutput = dividerOutput(input.inputVoltage, input.topResistanceOhms, effectiveBottom);
  const minTop = input.topResistanceOhms * (1 + topTolerance);
  const maxTop = input.topResistanceOhms * (1 - topTolerance);
  const minBottomRaw = input.bottomResistanceOhms * (1 - bottomTolerance);
  const maxBottomRaw = input.bottomResistanceOhms * (1 + bottomTolerance);
  const minBottom = loadResistance ? parallelResistance(minBottomRaw, loadResistance) : minBottomRaw;
  const maxBottom = loadResistance ? parallelResistance(maxBottomRaw, loadResistance) : maxBottomRaw;
  const minOutput = dividerOutput(input.inputVoltage, minTop, minBottom);
  const maxOutput = dividerOutput(input.inputVoltage, maxTop, maxBottom);
  const outputSpreadPercent = nominalOutput > 0 ? ((maxOutput - minOutput) / nominalOutput) * 100 : 0;
  const dividerCurrentMilliamps = (input.inputVoltage / (input.topResistanceOhms + input.bottomResistanceOhms)) * 1000;
  const loadErrorPercent = loadResistance ? ((nominalOutput - unloadedOutput) / unloadedOutput) * 100 : 0;
  const topPowerMilliwatts = Math.pow(input.inputVoltage / (input.topResistanceOhms + input.bottomResistanceOhms), 2) * input.topResistanceOhms * 1000;
  const bottomPowerMilliwatts = Math.pow(input.inputVoltage / (input.topResistanceOhms + input.bottomResistanceOhms), 2) * input.bottomResistanceOhms * 1000;
  const tone = getVoltageDividerTone(outputSpreadPercent, Math.abs(loadErrorPercent));
  const headline = `Vout ${formatVolts(nominalOutput)} (${formatVolts(minOutput)} to ${formatVolts(maxOutput)})`;
  const evidenceNote = [
    "EE Library tools note - voltage divider check",
    `Input: Vin ${formatVolts(input.inputVoltage)}, Rtop ${formatOhms(input.topResistanceOhms)} +/- ${formatPercent(input.topTolerancePercent)}, Rbottom ${formatOhms(input.bottomResistanceOhms)} +/- ${formatPercent(input.bottomTolerancePercent)}.`,
    loadResistance ? `Load: ${formatOhms(loadResistance)} in parallel with the bottom leg; estimated load shift ${formatSignedPercent(loadErrorPercent)} from unloaded output.` : "Load: none entered; output is unloaded divider estimate.",
    `Result: nominal ${formatVolts(nominalOutput)}, tolerance window ${formatVolts(minOutput)} to ${formatVolts(maxOutput)} (${formatPercent(outputSpreadPercent)} span).`,
    `Divider current: ${formatMilliamps(dividerCurrentMilliamps)}. Resistor dissipation estimate: top ${formatMilliwatts(topPowerMilliwatts)}, bottom ${formatMilliwatts(bottomPowerMilliwatts)}.`,
    "Boundary: scratchpad math only; attach this note as evidence and verify against the schematic, ADC/input leakage, package ratings, and datasheet before approval or export."
  ].join("\n");

  return {
    boundary: SCRATCHPAD_BOUNDARY,
    dividerCurrentMilliamps,
    evidenceNote,
    facts: [
      {
        detail: loadResistance ? `Includes ${formatOhms(loadResistance)} load in parallel with the lower leg.` : "No load entered, so this is the unloaded divider output.",
        label: "Nominal output",
        tone,
        value: formatVolts(nominalOutput)
      },
      {
        detail: "Worst case uses high top resistor plus low bottom resistor for min, and the inverse for max.",
        label: "Tolerance window",
        tone: outputSpreadPercent > 2 ? "review" : "verified",
        value: `${formatVolts(minOutput)} - ${formatVolts(maxOutput)}`
      },
      {
        detail: loadResistance ? "Load shift compares the loaded result against the same divider with no load." : "Add ADC/input leakage or load resistance when it matters.",
        label: "Load shift",
        tone: Math.abs(loadErrorPercent) > 5 ? "danger" : Math.abs(loadErrorPercent) > 1 ? "review" : "verified",
        value: formatSignedPercent(loadErrorPercent)
      },
      {
        detail: "Static current through the unloaded divider legs.",
        label: "Divider current",
        tone: dividerCurrentMilliamps > 5 ? "review" : "neutral",
        value: formatMilliamps(dividerCurrentMilliamps)
      }
    ],
    headline,
    inputIssues: [],
    loadErrorPercent,
    maxOutputVoltage: maxOutput,
    minOutputVoltage: minOutput,
    nominalOutputVoltage: nominalOutput,
    outputSpreadPercent,
    tone
  };
}

/**
 * Calculates a first-order RC edge estimate for pull-up networks.
 */
export function calculatePullupEdge(input: PullupEdgeInput): PullupEdgeResult {
  const issues = collectPositiveInputIssues([
    ["Supply voltage", input.supplyVoltage],
    ["Pull-up resistance", input.pullupResistanceOhms],
    ["Bus capacitance", input.busCapacitancePicofarads],
    ["Rise-time limit", input.riseTimeLimitMicroseconds]
  ]);

  if (issues.length > 0) {
    return buildInvalidPullupResult(issues);
  }

  const capacitanceFarads = input.busCapacitancePicofarads * 1e-12;
  const timeConstantMicroseconds = input.pullupResistanceOhms * capacitanceFarads * 1e6;
  const riseTimeMicroseconds = timeConstantMicroseconds * 2.2;
  const lowLevelCurrentMilliamps = (input.supplyVoltage / input.pullupResistanceOhms) * 1000;
  const timingRatio = riseTimeMicroseconds / input.riseTimeLimitMicroseconds;
  const tone = getPullupTone(timingRatio, lowLevelCurrentMilliamps);
  const headline = `Rise time ${formatMicroseconds(riseTimeMicroseconds)} against ${formatMicroseconds(input.riseTimeLimitMicroseconds)} limit`;
  const evidenceNote = [
    "EE Library tools note - pull-up edge check",
    `Input: Vdd ${formatVolts(input.supplyVoltage)}, pull-up ${formatOhms(input.pullupResistanceOhms)}, estimated bus capacitance ${formatPicofarads(input.busCapacitancePicofarads)}, rise-time target ${formatMicroseconds(input.riseTimeLimitMicroseconds)}.`,
    `Result: first-order tau ${formatMicroseconds(timeConstantMicroseconds)}, 10-90% rise time about ${formatMicroseconds(riseTimeMicroseconds)}.`,
    `Static low-level sink current estimate: ${formatMilliamps(lowLevelCurrentMilliamps)}.`,
    "Boundary: scratchpad math only; verify input thresholds, bus mode, trace capacitance, device sink current, and measured waveform before approving the design."
  ].join("\n");

  return {
    boundary: SCRATCHPAD_BOUNDARY,
    evidenceNote,
    facts: [
      {
        detail: "Approximation uses 2.2 x R x C for a 10-90% edge.",
        label: "10-90% rise",
        tone,
        value: formatMicroseconds(riseTimeMicroseconds)
      },
      {
        detail: "Single-pole RC time constant before threshold-specific interpretation.",
        label: "Time constant",
        tone: "neutral",
        value: formatMicroseconds(timeConstantMicroseconds)
      },
      {
        detail: "Current a device must sink while holding the line low.",
        label: "Low-level current",
        tone: lowLevelCurrentMilliamps > 3 ? "review" : "verified",
        value: formatMilliamps(lowLevelCurrentMilliamps)
      },
      {
        detail: timingRatio <= 1 ? "Estimated edge is within the entered limit." : "Estimated edge is slower than the entered limit.",
        label: "Timing margin",
        tone,
        value: formatSignedPercent((1 - timingRatio) * 100)
      }
    ],
    headline,
    inputIssues: [],
    lowLevelCurrentMilliamps,
    riseTimeMicroseconds,
    timeConstantMicroseconds,
    tone
  };
}

/**
 * Calculates package dissipation, derating, and rough junction-temperature margin.
 */
export function calculatePowerDerating(input: PowerDeratingInput): PowerDeratingResult {
  const issues = collectPositiveInputIssues([
    ["Load current", input.loadCurrentAmps],
    ["Voltage drop", input.voltageDropVolts],
    ["Package rating", input.packagePowerRatingWatts],
    ["Derating target", input.deratingTargetPercent],
    ["Thermal resistance", input.thermalResistanceCPerWatt],
    ["Maximum junction", input.maxJunctionCelsius]
  ]);

  if (!Number.isFinite(input.ambientCelsius)) {
    issues.push("Ambient temperature must be a finite number.");
  }

  if (issues.length > 0) {
    return buildInvalidPowerResult(issues);
  }

  const powerWatts = input.loadCurrentAmps * input.voltageDropVolts;
  const allowedPowerWatts = input.packagePowerRatingWatts * (percentToRatio(input.deratingTargetPercent));
  const estimatedJunctionCelsius = input.ambientCelsius + powerWatts * input.thermalResistanceCPerWatt;
  const thermalMarginCelsius = input.maxJunctionCelsius - estimatedJunctionCelsius;
  const powerMarginWatts = allowedPowerWatts - powerWatts;
  const tone = getPowerTone(powerWatts, allowedPowerWatts, input.packagePowerRatingWatts, thermalMarginCelsius);
  const headline = `${formatWatts(powerWatts)} dissipation, ${formatCelsius(estimatedJunctionCelsius)} estimated junction`;
  const evidenceNote = [
    "EE Library tools note - power derating check",
    `Input: current ${formatAmps(input.loadCurrentAmps)}, voltage drop ${formatVolts(input.voltageDropVolts)}, package rating ${formatWatts(input.packagePowerRatingWatts)}, derating target ${formatPercent(input.deratingTargetPercent)}.`,
    `Thermal: ambient ${formatCelsius(input.ambientCelsius)}, theta JA ${formatCelsiusPerWatt(input.thermalResistanceCPerWatt)}, max junction ${formatCelsius(input.maxJunctionCelsius)}.`,
    `Result: dissipation ${formatWatts(powerWatts)}, derated allowance ${formatWatts(allowedPowerWatts)}, power margin ${formatSignedWatts(powerMarginWatts)}, estimated junction ${formatCelsius(estimatedJunctionCelsius)}, thermal margin ${formatSignedCelsius(thermalMarginCelsius)}.`,
    "Boundary: scratchpad math only; verify package thermal data, copper area, airflow, duty cycle, and measured board temperature before approval or export."
  ].join("\n");

  return {
    allowedPowerWatts,
    boundary: SCRATCHPAD_BOUNDARY,
    estimatedJunctionCelsius,
    evidenceNote,
    facts: [
      {
        detail: "Current multiplied by voltage drop.",
        label: "Dissipation",
        tone,
        value: formatWatts(powerWatts)
      },
      {
        detail: `Uses ${formatPercent(input.deratingTargetPercent)} of the package rating as the design target.`,
        label: "Derated allowance",
        tone: powerWatts <= allowedPowerWatts ? "verified" : "review",
        value: formatWatts(allowedPowerWatts)
      },
      {
        detail: "Ambient plus dissipation multiplied by theta JA.",
        label: "Estimated junction",
        tone: thermalMarginCelsius >= 15 ? "verified" : thermalMarginCelsius >= 0 ? "review" : "danger",
        value: formatCelsius(estimatedJunctionCelsius)
      },
      {
        detail: "Positive margin means the rough junction estimate stays below the entered maximum.",
        label: "Thermal margin",
        tone: thermalMarginCelsius >= 15 ? "verified" : thermalMarginCelsius >= 0 ? "review" : "danger",
        value: formatSignedCelsius(thermalMarginCelsius)
      }
    ],
    headline,
    inputIssues: [],
    powerWatts,
    thermalMarginCelsius,
    tone
  };
}

/**
 * Builds the standard invalid-result envelope for voltage divider inputs.
 */
function buildInvalidVoltageDividerResult(inputIssues: string[]): VoltageDividerResult {
  return {
    boundary: SCRATCHPAD_BOUNDARY,
    dividerCurrentMilliamps: null,
    evidenceNote: buildInvalidEvidenceNote("voltage divider", inputIssues),
    facts: [],
    headline: "Enter positive divider values to calculate.",
    inputIssues,
    loadErrorPercent: null,
    maxOutputVoltage: null,
    minOutputVoltage: null,
    nominalOutputVoltage: null,
    outputSpreadPercent: null,
    tone: "danger"
  };
}

/**
 * Builds the standard invalid-result envelope for pull-up timing inputs.
 */
function buildInvalidPullupResult(inputIssues: string[]): PullupEdgeResult {
  return {
    boundary: SCRATCHPAD_BOUNDARY,
    evidenceNote: buildInvalidEvidenceNote("pull-up edge", inputIssues),
    facts: [],
    headline: "Enter positive pull-up values to calculate.",
    inputIssues,
    lowLevelCurrentMilliamps: null,
    riseTimeMicroseconds: null,
    timeConstantMicroseconds: null,
    tone: "danger"
  };
}

/**
 * Builds the standard invalid-result envelope for power derating inputs.
 */
function buildInvalidPowerResult(inputIssues: string[]): PowerDeratingResult {
  return {
    allowedPowerWatts: null,
    boundary: SCRATCHPAD_BOUNDARY,
    estimatedJunctionCelsius: null,
    evidenceNote: buildInvalidEvidenceNote("power derating", inputIssues),
    facts: [],
    headline: "Enter positive power and thermal values to calculate.",
    inputIssues,
    powerWatts: null,
    thermalMarginCelsius: null,
    tone: "danger"
  };
}

/**
 * Builds a copyable invalid-input note so the UI has a stable textarea value.
 */
function buildInvalidEvidenceNote(toolName: string, inputIssues: string[]): string {
  return [
    `EE Library tools note - ${toolName} check`,
    "Result: inputs are incomplete or invalid.",
    ...inputIssues.map((issue) => `- ${issue}`),
    "Boundary: no engineering decision should be made from this scratchpad until the inputs are corrected."
  ].join("\n");
}

/**
 * Collects positive-number validation messages for calculator inputs.
 */
function collectPositiveInputIssues(fields: Array<[string, number]>): string[] {
  return fields
    .filter(([, value]) => !Number.isFinite(value) || value <= 0)
    .map(([label]) => `${label} must be greater than zero.`);
}

/**
 * Converts a percent value into a non-negative fractional ratio.
 */
function percentToRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value) / 100;
}

/**
 * Calculates two-resistor parallel resistance.
 */
function parallelResistance(a: number, b: number): number {
  return (a * b) / (a + b);
}

/**
 * Calculates the divider output for a given top and bottom leg.
 */
function dividerOutput(inputVoltage: number, topResistance: number, bottomResistance: number): number {
  return inputVoltage * (bottomResistance / (topResistance + bottomResistance));
}

/**
 * Maps divider spread and load error into an operator-facing tone.
 */
function getVoltageDividerTone(outputSpreadPercent: number, absoluteLoadErrorPercent: number): EngineeringToolTone {
  if (outputSpreadPercent > 10 || absoluteLoadErrorPercent > 5) {
    return "danger";
  }

  if (outputSpreadPercent > 2 || absoluteLoadErrorPercent > 1) {
    return "review";
  }

  return "verified";
}

/**
 * Maps pull-up timing and sink current into an operator-facing tone.
 */
function getPullupTone(timingRatio: number, lowLevelCurrentMilliamps: number): EngineeringToolTone {
  if (timingRatio > 1) {
    return "danger";
  }

  if (timingRatio > 0.8 || lowLevelCurrentMilliamps > 3) {
    return "review";
  }

  return "verified";
}

/**
 * Maps dissipation and thermal margin into an operator-facing tone.
 */
function getPowerTone(powerWatts: number, allowedPowerWatts: number, packagePowerRatingWatts: number, thermalMarginCelsius: number): EngineeringToolTone {
  if (powerWatts > packagePowerRatingWatts || thermalMarginCelsius < 0) {
    return "danger";
  }

  if (powerWatts > allowedPowerWatts || thermalMarginCelsius < 15) {
    return "review";
  }

  return "verified";
}

/**
 * Formats volts with compact precision.
 */
function formatVolts(value: number): string {
  return `${formatNumber(value, 3)} V`;
}

/**
 * Formats amperes with compact precision.
 */
function formatAmps(value: number): string {
  return `${formatNumber(value, 3)} A`;
}

/**
 * Formats milliamps with compact precision.
 */
function formatMilliamps(value: number): string {
  return `${formatNumber(value, 3)} mA`;
}

/**
 * Formats watts with compact precision.
 */
function formatWatts(value: number): string {
  return `${formatNumber(value, 4)} W`;
}

/**
 * Formats signed watts with a leading sign for evidence notes.
 */
function formatSignedWatts(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatWatts(value)}`;
}

/**
 * Formats milliwatts with compact precision.
 */
function formatMilliwatts(value: number): string {
  return `${formatNumber(value, 3)} mW`;
}

/**
 * Formats microseconds with compact precision.
 */
function formatMicroseconds(value: number): string {
  return `${formatNumber(value, 3)} us`;
}

/**
 * Formats capacitance in picofarads with compact precision.
 */
function formatPicofarads(value: number): string {
  return `${formatNumber(value, 3)} pF`;
}

/**
 * Formats Celsius values with compact precision.
 */
function formatCelsius(value: number): string {
  return `${formatNumber(value, 3)} C`;
}

/**
 * Formats signed Celsius values with a leading sign for evidence notes.
 */
function formatSignedCelsius(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCelsius(value)}`;
}

/**
 * Formats thermal resistance using Celsius-per-watt units.
 */
function formatCelsiusPerWatt(value: number): string {
  return `${formatNumber(value, 3)} C/W`;
}

/**
 * Formats percentages without adding extra certainty.
 */
function formatPercent(value: number): string {
  return `${formatNumber(value, 3)}%`;
}

/**
 * Formats signed percentages with a leading sign for deltas.
 */
function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`;
}

/**
 * Formats resistance in ohms, kohms, or Mohms for dense result text.
 */
function formatOhms(value: number): string {
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000) {
    return `${formatNumber(value / 1_000_000, 3)} Mohm`;
  }

  if (absolute >= 1_000) {
    return `${formatNumber(value / 1_000, 3)} kohm`;
  }

  return `${formatNumber(value, 3)} ohm`;
}

/**
 * Formats numbers with a stable number of meaningful decimals and no trailing zeros.
 */
function formatNumber(value: number, fractionDigits: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0
  });
}
