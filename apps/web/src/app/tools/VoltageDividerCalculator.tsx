"use client";

/**
 * File header: Interactive voltage divider calculator.
 *
 * Engineers enter Vin, R1, R2 and see Vout, current, power, and the ratio update
 * live. A secondary mode solves for one resistor when Vin / Vout / one resistor
 * are known.
 */

import React, { useMemo, useState } from "react";
import { SectionPanel } from "@ee-library/ui";
import { computeVoltageDivider, formatEngineering, nearestE96Pair, solveVoltageDividerResistor } from "./lib/calculations";

/** ResistanceUnit picks the multiplier so engineers can type "1.2" and pick "kΩ". */
type ResistanceUnit = "Ω" | "kΩ" | "MΩ";

/** RESISTANCE_UNIT_TO_OHMS converts a `ResistanceUnit` to its raw-ohms multiplier. */
const RESISTANCE_UNIT_TO_OHMS: Record<ResistanceUnit, number> = {
  "Ω": 1,
  "kΩ": 1_000,
  "MΩ": 1_000_000
};

/** Forward mode: Vin/R1/R2 in, Vout out. Solve mode: Vin/Vout/one R in, partner R out. */
type DividerMode = "forward" | "solve";

/**
 * Renders the voltage divider calculator card.
 */
export function VoltageDividerCalculator(): React.ReactElement {
  const [mode, setMode] = useState<DividerMode>("forward");
  const [vin, setVin] = useState("5");
  const [r1Value, setR1Value] = useState("10");
  const [r1Unit, setR1Unit] = useState<ResistanceUnit>("kΩ");
  const [r2Value, setR2Value] = useState("10");
  const [r2Unit, setR2Unit] = useState<ResistanceUnit>("kΩ");
  const [vout, setVout] = useState("3.3");
  const [knownResistor, setKnownResistor] = useState<"r1" | "r2">("r1");

  const r1Ohms = parseRawNumber(r1Value) * RESISTANCE_UNIT_TO_OHMS[r1Unit];
  const r2Ohms = parseRawNumber(r2Value) * RESISTANCE_UNIT_TO_OHMS[r2Unit];

  const forwardResult = useMemo(
    () => computeVoltageDivider({ vin: parseRawNumber(vin), r1: r1Ohms, r2: r2Ohms }),
    [vin, r1Ohms, r2Ohms]
  );

  const solveResult = useMemo(() => {
    const knownOhms = knownResistor === "r1" ? r1Ohms : r2Ohms;
    return solveVoltageDividerResistor(parseRawNumber(vin), parseRawNumber(vout), knownOhms, knownResistor);
  }, [vin, vout, r1Ohms, r2Ohms, knownResistor]);

  return (
    <SectionPanel
      description={
        mode === "forward"
          ? "Vout = Vin × R2 / (R1 + R2). Enter Vin and both resistors to see Vout, divider current, and power."
          : "Solve for the partner resistor when Vin, Vout, and one resistor are known."
      }
      title="Voltage divider"
    >
      <div className="tools-calculator">
        <div className="tools-calculator__mode" aria-label="Voltage divider calculation mode">
          <button aria-pressed={mode === "forward"} onClick={() => setMode("forward")} type="button">
            Compute Vout
          </button>
          <button aria-pressed={mode === "solve"} onClick={() => setMode("solve")} type="button">
            Solve for a resistor
          </button>
        </div>

        <div className="tools-calculator__grid">
          <label className="tools-calculator__field">
            <span>Vin</span>
            <div className="tools-calculator__input-row">
              <input inputMode="decimal" onChange={(event) => setVin(event.currentTarget.value)} type="text" value={vin} />
              <span className="tools-calculator__unit">V</span>
            </div>
          </label>

          {mode === "solve" ? (
            <label className="tools-calculator__field">
              <span>Vout target</span>
              <div className="tools-calculator__input-row">
                <input inputMode="decimal" onChange={(event) => setVout(event.currentTarget.value)} type="text" value={vout} />
                <span className="tools-calculator__unit">V</span>
              </div>
            </label>
          ) : null}

          <label className="tools-calculator__field">
            <span>R1 {mode === "solve" && knownResistor === "r2" ? "(unknown)" : ""}</span>
            <div className="tools-calculator__input-row">
              <input
                disabled={mode === "solve" && knownResistor === "r2"}
                inputMode="decimal"
                onChange={(event) => setR1Value(event.currentTarget.value)}
                type="text"
                value={r1Value}
              />
              <select onChange={(event) => setR1Unit(event.currentTarget.value as ResistanceUnit)} value={r1Unit}>
                <option value="Ω">Ω</option>
                <option value="kΩ">kΩ</option>
                <option value="MΩ">MΩ</option>
              </select>
            </div>
          </label>

          <label className="tools-calculator__field">
            <span>R2 {mode === "solve" && knownResistor === "r1" ? "(unknown)" : ""}</span>
            <div className="tools-calculator__input-row">
              <input
                disabled={mode === "solve" && knownResistor === "r1"}
                inputMode="decimal"
                onChange={(event) => setR2Value(event.currentTarget.value)}
                type="text"
                value={r2Value}
              />
              <select onChange={(event) => setR2Unit(event.currentTarget.value as ResistanceUnit)} value={r2Unit}>
                <option value="Ω">Ω</option>
                <option value="kΩ">kΩ</option>
                <option value="MΩ">MΩ</option>
              </select>
            </div>
          </label>

          {mode === "solve" ? (
            <label className="tools-calculator__field">
              <span>Resistor you know</span>
              <select onChange={(event) => setKnownResistor(event.currentTarget.value as "r1" | "r2")} value={knownResistor}>
                <option value="r1">R1 — solve for R2</option>
                <option value="r2">R2 — solve for R1</option>
              </select>
            </label>
          ) : null}
        </div>

        {mode === "forward" ? <ForwardResult result={forwardResult} /> : <SolveResult knownResistor={knownResistor} result={solveResult} />}
      </div>
    </SectionPanel>
  );
}

/**
 * Renders the forward (Vin/R1/R2 -> Vout) result block.
 */
function ForwardResult({ result }: { result: ReturnType<typeof computeVoltageDivider> }): React.ReactElement {
  if (typeof result === "string") {
    return <p className="tools-calculator__error" role="alert">{result}</p>;
  }

  return (
    <dl className="tools-calculator__results">
      <div>
        <dt>Vout</dt>
        <dd>{formatEngineering(result.vout, "V")}</dd>
      </div>
      <div>
        <dt>Divider current</dt>
        <dd>{formatEngineering(result.current, "A")}</dd>
      </div>
      <div>
        <dt>Power dissipated</dt>
        <dd>{formatEngineering(result.power, "W")}</dd>
      </div>
      <div>
        <dt>Ratio (Vout / Vin)</dt>
        <dd>{formatRatio(result.ratio)}</dd>
      </div>
    </dl>
  );
}

/**
 * Renders the solve-for-resistor result block.
 */
function SolveResult({ knownResistor, result }: { knownResistor: "r1" | "r2"; result: number | string }): React.ReactElement {
  if (typeof result === "string") {
    return <p className="tools-calculator__error" role="alert">{result}</p>;
  }

  const targetLabel = knownResistor === "r1" ? "R2 (computed)" : "R1 (computed)";

  return (
    <dl className="tools-calculator__results">
      <div>
        <dt>{targetLabel}</dt>
        <dd>{formatEngineering(result, "Ω")}</dd>
      </div>
      <div>
        <dt>Nearest E96 1% values</dt>
        <dd>{formatE96Suggestions(result)}</dd>
      </div>
    </dl>
  );
}

/**
 * Parses a raw decimal string without throwing. Returns NaN for invalid input so
 * the calculator surfaces a plain-language error rather than guessing.
 */
function parseRawNumber(value: string): number {
  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed === "") {
    return Number.NaN;
  }
  return Number(trimmed);
}

/**
 * Formats the divider ratio as a percentage and a fraction so engineers can
 * eyeball both forms at a glance.
 */
function formatRatio(ratio: number): string {
  const percent = (ratio * 100).toFixed(1);
  return `${percent}% (${ratio.toFixed(3)})`;
}

/**
 * Returns the closest E96 1% resistor below and above the computed resistance so
 * an engineer can quickly pick a real off-the-shelf part.
 */
function formatE96Suggestions(resistance: number): string {
  const pair = nearestE96Pair(resistance);
  if (!pair) {
    return "—";
  }

  if (Math.abs(pair.lower - pair.upper) < pair.lower * 0.0001) {
    return formatEngineering(pair.lower, "Ω");
  }

  return `${formatEngineering(pair.lower, "Ω")} or ${formatEngineering(pair.upper, "Ω")}`;
}
