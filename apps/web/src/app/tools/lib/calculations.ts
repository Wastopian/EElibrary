/**
 * File header: Pure calculation helpers for the /tools workspace.
 *
 * Each function takes engineer-shaped inputs (volts, ohms, farads, seconds) and
 * returns either a result object or an error string. Nothing here touches React
 * or the DOM — the UI components import these directly.
 */

/** VoltageDividerInputs are the raw numeric inputs for a two-resistor divider. */
export interface VoltageDividerInputs {
  /** Input voltage in volts. */
  vin: number;
  /** Top resistor in ohms. */
  r1: number;
  /** Bottom resistor in ohms. */
  r2: number;
}

/** VoltageDividerResult is the divider result plus useful derived numbers. */
export interface VoltageDividerResult {
  /** Output voltage at the R1/R2 node in volts. */
  vout: number;
  /** Quiescent current through the divider in amps (Vin / (R1 + R2)). */
  current: number;
  /** Steady-state power dissipated by the divider in watts (Vin * current). */
  power: number;
  /** Ratio of Vout to Vin as a fraction between 0 and 1. */
  ratio: number;
}

/**
 * Computes Vout, divider current, dissipated power, and the divider ratio.
 *
 * Returns a string explaining the problem when any input is invalid so the UI
 * can show a plain-language error message without throwing.
 */
export function computeVoltageDivider(inputs: VoltageDividerInputs): VoltageDividerResult | string {
  const { vin, r1, r2 } = inputs;

  if (!Number.isFinite(vin) || !Number.isFinite(r1) || !Number.isFinite(r2)) {
    return "Enter a number in every field.";
  }

  if (r1 < 0 || r2 < 0) {
    return "Resistance cannot be negative.";
  }

  if (r1 === 0 && r2 === 0) {
    return "Both resistors are zero. Set at least one resistor to a positive value.";
  }

  const totalR = r1 + r2;
  const current = totalR === 0 ? 0 : vin / totalR;
  const vout = totalR === 0 ? 0 : vin * (r2 / totalR);
  const ratio = totalR === 0 ? 0 : r2 / totalR;
  const power = vin * current;

  return { vout, current, power, ratio };
}

/**
 * Solves for the unknown resistor in a voltage divider when Vin, Vout, and one
 * resistor are known. Returns the missing resistor in ohms, or a plain-language
 * error string.
 *
 * `knownResistor` controls which resistor is given; the other one is computed.
 * Useful when an engineer knows the target output voltage and one available
 * resistor and wants the matching partner.
 */
export function solveVoltageDividerResistor(
  vin: number,
  vout: number,
  knownResistorOhms: number,
  knownResistor: "r1" | "r2"
): number | string {
  if (!Number.isFinite(vin) || !Number.isFinite(vout) || !Number.isFinite(knownResistorOhms)) {
    return "Enter a number in every field.";
  }

  if (vin === 0) {
    return "Vin cannot be zero when solving for a resistor.";
  }

  if (knownResistorOhms < 0) {
    return "Resistance cannot be negative.";
  }

  if (knownResistor === "r2") {
    // vout = vin * r2 / (r1 + r2)  =>  r1 = r2 * (vin / vout - 1)
    if (vout === 0) {
      return "Vout = 0 means R2 must be 0 or R1 must be infinite.";
    }
    if (vout >= vin) {
      return "Vout must be less than Vin for a passive divider.";
    }
    return knownResistorOhms * (vin / vout - 1);
  }

  // knownResistor === "r1"
  // vout = vin * r2 / (r1 + r2)  =>  r2 = r1 * vout / (vin - vout)
  if (vin === vout) {
    return "Vout cannot equal Vin in a passive divider — R2 would be infinite.";
  }
  if (vout > vin) {
    return "Vout must be less than Vin for a passive divider.";
  }
  return (knownResistorOhms * vout) / (vin - vout);
}

/** RcTimeConstantInputs are the raw numeric inputs for an RC time constant. */
export interface RcTimeConstantInputs {
  /** Resistance in ohms. */
  resistanceOhms: number;
  /** Capacitance in farads. */
  capacitanceFarads: number;
}

/** RcTimeConstantResult exposes tau plus useful settling-time multiples. */
export interface RcTimeConstantResult {
  /** Time constant tau (R * C) in seconds. */
  tau: number;
  /** Time to reach ~63% of the step (one tau) in seconds. */
  toSixtyThreePercent: number;
  /** Time to reach ~95% of the step (three tau) in seconds. */
  toNinetyFivePercent: number;
  /** Time to reach ~99% of the step (five tau) in seconds. */
  toNinetyNinePercent: number;
  /** Cut-off frequency for an RC low-pass filter in hertz (1 / (2 * pi * R * C)). */
  cutoffFrequencyHz: number;
}

/**
 * Computes tau and common settling-time multiples for an RC pair.
 *
 * Returns a string explaining the problem when any input is invalid so the UI
 * can show a plain-language error message without throwing.
 */
export function computeRcTimeConstant(inputs: RcTimeConstantInputs): RcTimeConstantResult | string {
  const { resistanceOhms, capacitanceFarads } = inputs;

  if (!Number.isFinite(resistanceOhms) || !Number.isFinite(capacitanceFarads)) {
    return "Enter a number in both fields.";
  }

  if (resistanceOhms <= 0 || capacitanceFarads <= 0) {
    return "Resistance and capacitance must both be positive.";
  }

  const tau = resistanceOhms * capacitanceFarads;
  const cutoffFrequencyHz = 1 / (2 * Math.PI * tau);

  return {
    tau,
    toSixtyThreePercent: tau,
    toNinetyFivePercent: 3 * tau,
    toNinetyNinePercent: 5 * tau,
    cutoffFrequencyHz
  };
}

/** EngineeringUnit holds a numeric value and the SI prefix to format it with. */
export interface EngineeringUnit {
  /** Numeric coefficient (always 1 <= |coefficient| < 1000 unless value is 0). */
  coefficient: number;
  /** SI prefix symbol (e.g. "k", "M", "m", "µ", "n", "p", ""). */
  prefix: string;
  /** Multiplier the prefix represents (e.g. 1e3 for "k"). */
  multiplier: number;
}

const ENGINEERING_PREFIXES: Array<{ prefix: string; multiplier: number }> = [
  { prefix: "T", multiplier: 1e12 },
  { prefix: "G", multiplier: 1e9 },
  { prefix: "M", multiplier: 1e6 },
  { prefix: "k", multiplier: 1e3 },
  { prefix: "", multiplier: 1 },
  { prefix: "m", multiplier: 1e-3 },
  { prefix: "µ", multiplier: 1e-6 },
  { prefix: "n", multiplier: 1e-9 },
  { prefix: "p", multiplier: 1e-12 },
  { prefix: "f", multiplier: 1e-15 }
];

/**
 * Picks the best SI engineering prefix for a numeric value so the coefficient
 * lands in the [1, 1000) range. Returns the raw value with an empty prefix when
 * the value is zero, NaN, or non-finite.
 */
export function pickEngineeringPrefix(value: number): EngineeringUnit {
  if (!Number.isFinite(value) || value === 0) {
    return { coefficient: value, prefix: "", multiplier: 1 };
  }

  const absValue = Math.abs(value);
  const match = ENGINEERING_PREFIXES.find((candidate) => absValue >= candidate.multiplier) ?? { prefix: "f", multiplier: 1e-15 };

  return {
    coefficient: value / match.multiplier,
    prefix: match.prefix,
    multiplier: match.multiplier
  };
}

/**
 * Formats a number with an SI engineering prefix and unit symbol, picking up
 * to four significant figures so the result is readable to engineers.
 *
 * Examples: `formatEngineering(12345, "Ω")` -> `"12.3 kΩ"`,
 * `formatEngineering(0.000022, "F")` -> `"22 µF"`.
 */
export function formatEngineering(value: number, unit: string): string {
  if (!Number.isFinite(value)) {
    return `— ${unit}`.trim();
  }

  if (value === 0) {
    return `0 ${unit}`.trim();
  }

  const picked = pickEngineeringPrefix(value);
  const absCoefficient = Math.abs(picked.coefficient);
  // Target three significant figures so the coefficient stays readable across decades.
  const fractionDigits = absCoefficient >= 100 ? 0 : absCoefficient >= 10 ? 1 : 2;
  const rounded = Number(picked.coefficient.toFixed(fractionDigits));

  return `${rounded.toString()} ${picked.prefix}${unit}`;
}
