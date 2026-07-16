/**
 * File header: Canonical parameter registry mapping provider spec labels to typed, per-part-type parameters.
 *
 * Distributor specs arrive as verbatim `{spec_key, spec_value}` text keyed by each provider's own label
 * (`part_specifications`). This registry is the single place that says, per `PartType`, which canonical
 * parameters exist, their unit and value kind, and which raw provider labels map onto them. It is the
 * typed successor to the per-adapter `SPEC_HINTS` scattered across the provider adapters. Datasheet
 * extraction (a later phase) maps onto the same registry, so parameters from any source share one shape.
 */

import type { PartType } from "./part-type";
import type { PartParameterValueKind } from "./types";

/** ParameterValueKind is the value-kind union shared with the persisted PartParameter row. */
export type ParameterValueKind = PartParameterValueKind;

/** CanonicalParameterDef defines one typed parameter and the raw provider labels that feed it. */
export interface CanonicalParameterDef {
  /** Canonical stable key, e.g. "resistance". */
  paramKey: string;
  /** Plain-language label for non-savvy engineers. */
  label: string;
  /** How the value is stored/rendered. */
  valueKind: ParameterValueKind;
  /**
   * Canonical unit as a free string (NOT MetricUnit, which is too narrow): "ohm" | "F" | "H" | "V" | "A"
   * | "Hz" | "W" | "%" | "ppm_per_c" | "deg C" | null. Null for unitless enum/text params like package.
   */
  unit: string | null;
  /** Lowercased substrings matched against a provider's spec_key to attribute a raw row to this param. */
  specKeyPatterns: string[];
  /** Existing part_metrics keys that corroborate this parameter (used later to blend metric evidence). */
  metricKeys: string[];
  /** Allowed canonical values for enum kinds (used for validation/normalization). */
  enumValues?: string[];
}

/** PARAMETER_REGISTRY lists the canonical parameters recognized for each part type. */
export const PARAMETER_REGISTRY: Record<PartType, CanonicalParameterDef[]> = {
  resistor: [
    { label: "Resistance", metricKeys: ["resistance"], paramKey: "resistance", specKeyPatterns: ["resistance"], unit: "ohm", valueKind: "numeric" },
    { label: "Tolerance", metricKeys: [], paramKey: "tolerance", specKeyPatterns: ["tolerance"], unit: "%", valueKind: "numeric" },
    { label: "Power Rating", metricKeys: [], paramKey: "power_rating", specKeyPatterns: ["power rating", "power(w)", "power"], unit: "W", valueKind: "numeric" },
    { label: "Voltage Rating", metricKeys: ["voltage_rating", "rated_voltage"], paramKey: "voltage_rating", specKeyPatterns: ["overload voltage", "voltage rating", "voltage - rated", "rated voltage"], unit: "V", valueKind: "numeric" },
    { label: "Temperature Coefficient", metricKeys: [], paramKey: "temp_coefficient", specKeyPatterns: ["temperature coefficient", "tcr"], unit: "ppm_per_c", valueKind: "numeric" },
    { label: "Package", metricKeys: [], paramKey: "package", specKeyPatterns: ["package", "case code", "case"], unit: null, valueKind: "text" }
  ],
  capacitor: [
    { label: "Capacitance", metricKeys: ["capacitance"], paramKey: "capacitance", specKeyPatterns: ["capacitance"], unit: "F", valueKind: "numeric" },
    { label: "Tolerance", metricKeys: [], paramKey: "tolerance", specKeyPatterns: ["tolerance"], unit: "%", valueKind: "numeric" },
    { label: "Voltage Rating", metricKeys: ["voltage_rating", "rated_voltage"], paramKey: "voltage_rating", specKeyPatterns: ["voltage rated", "voltage - rated", "rated voltage", "voltage rating"], unit: "V", valueKind: "numeric" },
    { enumValues: ["C0G", "NP0", "X7R", "X5R", "X6S", "X7S", "Y5V", "Z5U"], label: "Dielectric", metricKeys: [], paramKey: "dielectric", specKeyPatterns: ["dielectric", "temperature characteristic"], unit: null, valueKind: "enum" },
    { label: "Package", metricKeys: [], paramKey: "package", specKeyPatterns: ["package", "case code", "case"], unit: null, valueKind: "text" }
  ],
  inductor: [
    { label: "Inductance", metricKeys: ["inductance"], paramKey: "inductance", specKeyPatterns: ["inductance"], unit: "H", valueKind: "numeric" },
    { label: "Tolerance", metricKeys: [], paramKey: "tolerance", specKeyPatterns: ["tolerance"], unit: "%", valueKind: "numeric" },
    { label: "Current Rating", metricKeys: ["current_rating"], paramKey: "current_rating", specKeyPatterns: ["rated current", "current rating", "saturation current"], unit: "A", valueKind: "numeric" },
    { label: "DC Resistance", metricKeys: [], paramKey: "dc_resistance", specKeyPatterns: ["dc resistance", "dcr"], unit: "ohm", valueKind: "numeric" },
    { label: "Package", metricKeys: [], paramKey: "package", specKeyPatterns: ["package", "case code", "case"], unit: null, valueKind: "text" }
  ],
  // Patterns below follow DigiKey's parametric label vocabulary ("Voltage - DC Reverse (Vr) (Max)",
  // "Speed", "Current - Output") plus the spec keys the Mouser description parser emits ("Flash Size",
  // "Output Current"), so both sources feed the same canonical parameters.
  diode: [
    { label: "Forward Voltage", metricKeys: [], paramKey: "forward_voltage", specKeyPatterns: ["voltage - forward", "forward voltage"], unit: "V", valueKind: "numeric" },
    { label: "Reverse Voltage", metricKeys: [], paramKey: "reverse_voltage", specKeyPatterns: ["voltage - dc reverse", "reverse voltage", "voltage - reverse"], unit: "V", valueKind: "numeric" },
    { label: "Forward Current", metricKeys: [], paramKey: "forward_current", specKeyPatterns: ["current - average rectified", "forward current", "current - forward"], unit: "A", valueKind: "numeric" },
    { label: "Package", metricKeys: [], paramKey: "package", specKeyPatterns: ["package", "case code", "case"], unit: null, valueKind: "text" }
  ],
  mcu: [
    { label: "Clock Frequency", metricKeys: ["clock_frequency_max"], paramKey: "clock_frequency", specKeyPatterns: ["clock frequency", "speed", "frequency"], unit: "Hz", valueKind: "numeric" },
    { label: "Flash Size", metricKeys: [], paramKey: "flash_size", specKeyPatterns: ["program memory size", "flash size", "flash"], unit: "B", valueKind: "numeric" },
    { label: "RAM Size", metricKeys: [], paramKey: "ram_size", specKeyPatterns: ["ram size", "ram"], unit: "B", valueKind: "numeric" },
    { label: "Supply Voltage", metricKeys: [], paramKey: "supply_voltage_range", specKeyPatterns: ["voltage - supply", "supply voltage", "operating voltage"], unit: "V", valueKind: "range" },
    { label: "Package", metricKeys: [], paramKey: "package", specKeyPatterns: ["package", "case code", "case"], unit: null, valueKind: "text" }
  ],
  regulator: [
    { label: "Output Voltage", metricKeys: [], paramKey: "output_voltage", specKeyPatterns: ["voltage - output", "output voltage"], unit: "V", valueKind: "numeric" },
    { label: "Output Current", metricKeys: ["output_current_max"], paramKey: "output_current", specKeyPatterns: ["current - output", "output current"], unit: "A", valueKind: "numeric" },
    { label: "Quiescent Current", metricKeys: [], paramKey: "quiescent_current", specKeyPatterns: ["current - quiescent", "quiescent current", "supply current (iq)"], unit: "A", valueKind: "numeric" },
    { label: "Dropout Voltage", metricKeys: [], paramKey: "dropout_voltage", specKeyPatterns: ["voltage - dropout", "dropout voltage"], unit: "V", valueKind: "numeric" },
    { label: "Input Voltage Max", metricKeys: ["input_voltage_max"], paramKey: "input_voltage_max", specKeyPatterns: ["voltage - input", "input voltage"], unit: "V", valueKind: "numeric" },
    { label: "Package", metricKeys: [], paramKey: "package", specKeyPatterns: ["package", "case code", "case"], unit: null, valueKind: "text" }
  ],
  connector: [
    { label: "Package", metricKeys: [], paramKey: "package", specKeyPatterns: ["package", "case code", "case"], unit: null, valueKind: "text" }
  ],
  other: [
    { label: "Operating Temperature Range", metricKeys: [], paramKey: "operating_temperature_range", specKeyPatterns: ["operating temperature"], unit: "deg C", valueKind: "range" },
    { label: "Package", metricKeys: [], paramKey: "package", specKeyPatterns: ["package", "case code", "case"], unit: null, valueKind: "text" }
  ]
};

/**
 * Returns the canonical parameter definitions recognized for a part type.
 */
export function getParameterDefs(partType: PartType): CanonicalParameterDef[] {
  return PARAMETER_REGISTRY[partType];
}

/**
 * Lists every distinct canonical parameter key across all part types, in first-seen registry order.
 */
export function listCanonicalParameterKeys(): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const defs of Object.values(PARAMETER_REGISTRY)) {
    for (const def of defs) {
      if (!seen.has(def.paramKey)) {
        seen.add(def.paramKey);
        keys.push(def.paramKey);
      }
    }
  }

  return keys;
}

/**
 * Finds a canonical parameter definition by its key across every part type.
 *
 * A parameter key like "resistance" or "package" appears under multiple part types with the same unit
 * and value kind; the first match is authoritative for labelling and validating a key from search input.
 */
export function getCanonicalParamDefByKey(paramKey: string): CanonicalParameterDef | null {
  for (const defs of Object.values(PARAMETER_REGISTRY)) {
    const match = defs.find((def) => def.paramKey === paramKey);

    if (match) {
      return match;
    }
  }

  return null;
}

/**
 * Collects the legacy part_metrics keys already represented by a set of reconciled parameters, so
 * metric displays can hide rows the Specifications table covers. A parameter covers its own paramKey
 * plus every metricKey its registry definition folds in during recompute — the exact keys whose metric
 * evidence already contributed to the reconciled value, and would otherwise render twice with two
 * different confidence presentations.
 */
export function collectCoveredMetricKeys(parameters: ReadonlyArray<{ paramKey: string; partType: string }>): Set<string> {
  const covered = new Set<string>();

  for (const parameter of parameters) {
    covered.add(parameter.paramKey);

    const typedDefs = (PARAMETER_REGISTRY as Record<string, CanonicalParameterDef[] | undefined>)[parameter.partType];
    const def = typedDefs?.find((candidate) => candidate.paramKey === parameter.paramKey) ?? getCanonicalParamDefByKey(parameter.paramKey);

    for (const metricKey of def?.metricKeys ?? []) {
      covered.add(metricKey);
    }
  }

  return covered;
}

/**
 * Finds the canonical parameter a raw provider spec key maps to, preferring the most specific pattern.
 *
 * Longer patterns win so "case code" is not shadowed by "case" and "voltage rating" is not shadowed by a
 * looser hint. Returns null when no parameter for the type recognizes the key.
 */
export function findParamDefForSpecKey(partType: PartType, specKey: string): CanonicalParameterDef | null {
  const normalizedKey = specKey.trim().toLowerCase();

  if (normalizedKey.length === 0) {
    return null;
  }

  let best: { def: CanonicalParameterDef; patternLength: number } | null = null;

  for (const def of getParameterDefs(partType)) {
    for (const pattern of def.specKeyPatterns) {
      if (normalizedKey.includes(pattern) && (best === null || pattern.length > best.patternLength)) {
        best = { def, patternLength: pattern.length };
      }
    }
  }

  return best?.def ?? null;
}
