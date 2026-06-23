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

/** E96_SERIES is the standard 1% resistor decade (96 values from 100 to 976). */
export const E96_SERIES: ReadonlyArray<number> = [
  100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143,
  147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210,
  215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309,
  316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453,
  464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665,
  681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976
];

/** NearestE96Pair holds the closest E96 1% resistance value below and above a target. */
export interface NearestE96Pair {
  /** Closest E96 value at or below the target, in ohms. */
  lower: number;
  /** Closest E96 value at or above the target, in ohms. */
  upper: number;
}

/**
 * Returns the closest E96 1% resistor value below and above the requested
 * resistance, in ohms. Returns null when the target is non-positive or NaN.
 */
export function nearestE96Pair(targetOhms: number): NearestE96Pair | null {
  if (!Number.isFinite(targetOhms) || targetOhms <= 0) {
    return null;
  }

  const decade = Math.floor(Math.log10(targetOhms / 100));
  const decadeMultiplier = Math.pow(10, decade);
  const normalized = targetOhms / decadeMultiplier;

  let lowerInSeries = E96_SERIES[0] ?? 100;
  let upperInSeries = E96_SERIES[E96_SERIES.length - 1] ?? 976;

  for (const candidate of E96_SERIES) {
    if (candidate <= normalized) {
      lowerInSeries = candidate;
    }
    if (candidate >= normalized && upperInSeries > candidate) {
      upperInSeries = candidate;
    }
  }

  return {
    lower: lowerInSeries * decadeMultiplier,
    upper: upperInSeries * decadeMultiplier
  };
}

/** OhmsLawQuantity names one of the four solvable quantities in Ohm's law + power. */
export type OhmsLawQuantity = "voltage" | "current" | "resistance" | "power";

/** OhmsLawKnown holds one of the two known quantities the operator supplied. */
export interface OhmsLawKnown {
  /** Which quantity this value represents. */
  quantity: OhmsLawQuantity;
  /** The numeric value in SI base units (volts, amps, ohms, watts). */
  value: number;
}

/** OhmsLawResult is the full V/I/R/P solved set. */
export interface OhmsLawResult {
  /** Voltage in volts. */
  voltage: number;
  /** Current in amps. */
  current: number;
  /** Resistance in ohms. */
  resistance: number;
  /** Power in watts. */
  power: number;
}

/**
 * Solves Ohm's law plus the power equation for the remaining two quantities
 * when any two of {V, I, R, P} are known.
 *
 * Returns a plain-language error string when the inputs are inconsistent or
 * the requested unknown is undetermined (e.g. P known with R = 0).
 */
export function solveOhmsLaw(a: OhmsLawKnown, b: OhmsLawKnown): OhmsLawResult | string {
  if (a.quantity === b.quantity) {
    return "Pick two different quantities to solve from.";
  }

  if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) {
    return "Enter a number in both fields.";
  }

  if (a.value < 0 || b.value < 0) {
    return "All values must be zero or positive.";
  }

  const known = new Map<OhmsLawQuantity, number>();
  known.set(a.quantity, a.value);
  known.set(b.quantity, b.value);

  const v = known.get("voltage");
  const i = known.get("current");
  const r = known.get("resistance");
  const p = known.get("power");

  // V + I: trivial — derive R and P.
  if (v !== undefined && i !== undefined) {
    if (i === 0) {
      return "Current is 0, so resistance cannot be determined.";
    }
    return {
      voltage: v,
      current: i,
      resistance: v / i,
      power: v * i
    };
  }

  // V + R: derive I and P.
  if (v !== undefined && r !== undefined) {
    if (r === 0) {
      return "Resistance is 0 — current would be infinite.";
    }
    const computedI = v / r;
    return {
      voltage: v,
      current: computedI,
      resistance: r,
      power: v * computedI
    };
  }

  // V + P: derive I and R.
  if (v !== undefined && p !== undefined) {
    if (v === 0) {
      return "Voltage is 0, so current and resistance cannot be determined from power alone.";
    }
    const computedI = p / v;
    if (computedI === 0) {
      return "Current would be 0; resistance is undefined.";
    }
    return {
      voltage: v,
      current: computedI,
      resistance: v / computedI,
      power: p
    };
  }

  // I + R: derive V and P.
  if (i !== undefined && r !== undefined) {
    const computedV = i * r;
    return {
      voltage: computedV,
      current: i,
      resistance: r,
      power: computedV * i
    };
  }

  // I + P: derive V and R.
  if (i !== undefined && p !== undefined) {
    if (i === 0) {
      return "Current is 0, so voltage and resistance cannot be determined from power alone.";
    }
    const computedV = p / i;
    return {
      voltage: computedV,
      current: i,
      resistance: computedV / i,
      power: p
    };
  }

  // R + P: derive V and I.
  if (r !== undefined && p !== undefined) {
    if (r === 0) {
      return "Resistance is 0, so voltage and current cannot be determined from power alone.";
    }
    const computedI = Math.sqrt(p / r);
    return {
      voltage: computedI * r,
      current: computedI,
      resistance: r,
      power: p
    };
  }

  return "Pick two known quantities.";
}

/** LedCurrentLimitInputs are the raw numeric inputs for an LED current-limit calc. */
export interface LedCurrentLimitInputs {
  /** Source voltage feeding the LED + resistor in volts. */
  supplyVoltageVolts: number;
  /** LED forward voltage drop in volts. */
  forwardVoltageVolts: number;
  /** Target LED forward current in amps. */
  forwardCurrentAmps: number;
}

/** LedCurrentLimitResult holds the resistor value, its dissipation, and headroom. */
export interface LedCurrentLimitResult {
  /** Series resistor in ohms. */
  resistanceOhms: number;
  /** Power dissipated by the resistor in watts. */
  resistorPowerWatts: number;
  /** Power dissipated by the LED in watts (informational). */
  ledPowerWatts: number;
  /** Voltage across the resistor in volts (V_supply − V_forward). */
  voltageAcrossResistorVolts: number;
}

/**
 * Computes the series resistor needed to limit an LED to the target forward
 * current, the resulting resistor dissipation, and the LED dissipation.
 *
 * Returns a plain-language error when inputs are invalid (negative, missing,
 * or supply ≤ forward voltage — meaning the LED cannot turn on).
 */
export function computeLedCurrentLimit(inputs: LedCurrentLimitInputs): LedCurrentLimitResult | string {
  const { supplyVoltageVolts, forwardVoltageVolts, forwardCurrentAmps } = inputs;

  if (!Number.isFinite(supplyVoltageVolts) || !Number.isFinite(forwardVoltageVolts) || !Number.isFinite(forwardCurrentAmps)) {
    return "Enter a number in every field.";
  }

  if (supplyVoltageVolts < 0 || forwardVoltageVolts < 0 || forwardCurrentAmps <= 0) {
    return "Supply voltage and LED forward voltage must be zero or positive, and the LED current must be positive.";
  }

  if (supplyVoltageVolts <= forwardVoltageVolts) {
    return "Supply voltage must be higher than the LED forward voltage, or the LED will not light.";
  }

  const voltageAcrossResistorVolts = supplyVoltageVolts - forwardVoltageVolts;
  const resistanceOhms = voltageAcrossResistorVolts / forwardCurrentAmps;
  const resistorPowerWatts = voltageAcrossResistorVolts * forwardCurrentAmps;
  const ledPowerWatts = forwardVoltageVolts * forwardCurrentAmps;

  return {
    resistanceOhms,
    resistorPowerWatts,
    ledPowerWatts,
    voltageAcrossResistorVolts
  };
}
