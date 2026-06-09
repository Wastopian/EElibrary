"use client";

/**
 * File header: Interactive RC time constant calculator.
 *
 * Engineers enter R and C with engineering units and see tau, 1τ/3τ/5τ settling
 * times, and the matching low-pass cutoff frequency update live.
 */

import React, { useMemo, useState } from "react";
import { SectionPanel } from "@ee-library/ui";
import { computeRcTimeConstant, formatEngineering } from "./lib/calculations";

/** ResistanceUnit matches the voltage divider so engineers see consistent options. */
type ResistanceUnit = "Ω" | "kΩ" | "MΩ";

/** CapacitanceUnit picks a multiplier so engineers can type "10" + "µF" or "100" + "nF". */
type CapacitanceUnit = "pF" | "nF" | "µF" | "mF" | "F";

const RESISTANCE_UNIT_TO_OHMS: Record<ResistanceUnit, number> = {
  "Ω": 1,
  "kΩ": 1_000,
  "MΩ": 1_000_000
};

const CAPACITANCE_UNIT_TO_FARADS: Record<CapacitanceUnit, number> = {
  pF: 1e-12,
  nF: 1e-9,
  "µF": 1e-6,
  mF: 1e-3,
  F: 1
};

/**
 * Renders the RC time constant calculator card.
 */
export function RCTimeConstantCalculator(): React.ReactElement {
  const [rValue, setRValue] = useState("10");
  const [rUnit, setRUnit] = useState<ResistanceUnit>("kΩ");
  const [cValue, setCValue] = useState("1");
  const [cUnit, setCUnit] = useState<CapacitanceUnit>("µF");

  const resistanceOhms = parseRawNumber(rValue) * RESISTANCE_UNIT_TO_OHMS[rUnit];
  const capacitanceFarads = parseRawNumber(cValue) * CAPACITANCE_UNIT_TO_FARADS[cUnit];

  const result = useMemo(
    () => computeRcTimeConstant({ resistanceOhms, capacitanceFarads }),
    [resistanceOhms, capacitanceFarads]
  );

  return (
    <SectionPanel
      description="τ = R × C. Enter resistance and capacitance to see the time constant, common settling times, and the matching low-pass cutoff frequency."
      title="RC time constant"
    >
      <div className="tools-calculator">
        <div className="tools-calculator__grid">
          <label className="tools-calculator__field">
            <span>Resistance</span>
            <div className="tools-calculator__input-row">
              <input
                inputMode="decimal"
                onChange={(event) => setRValue(event.currentTarget.value)}
                type="text"
                value={rValue}
              />
              <select onChange={(event) => setRUnit(event.currentTarget.value as ResistanceUnit)} value={rUnit}>
                <option value="Ω">Ω</option>
                <option value="kΩ">kΩ</option>
                <option value="MΩ">MΩ</option>
              </select>
            </div>
          </label>

          <label className="tools-calculator__field">
            <span>Capacitance</span>
            <div className="tools-calculator__input-row">
              <input
                inputMode="decimal"
                onChange={(event) => setCValue(event.currentTarget.value)}
                type="text"
                value={cValue}
              />
              <select onChange={(event) => setCUnit(event.currentTarget.value as CapacitanceUnit)} value={cUnit}>
                <option value="pF">pF</option>
                <option value="nF">nF</option>
                <option value="µF">µF</option>
                <option value="mF">mF</option>
                <option value="F">F</option>
              </select>
            </div>
          </label>
        </div>

        {typeof result === "string" ? (
          <p className="tools-calculator__error" role="alert">{result}</p>
        ) : (
          <dl className="tools-calculator__results">
            <div>
              <dt>τ (time constant)</dt>
              <dd>{formatEngineering(result.tau, "s")}</dd>
            </div>
            <div>
              <dt>To ~63% (1τ)</dt>
              <dd>{formatEngineering(result.toSixtyThreePercent, "s")}</dd>
            </div>
            <div>
              <dt>To ~95% (3τ)</dt>
              <dd>{formatEngineering(result.toNinetyFivePercent, "s")}</dd>
            </div>
            <div>
              <dt>To ~99% (5τ)</dt>
              <dd>{formatEngineering(result.toNinetyNinePercent, "s")}</dd>
            </div>
            <div>
              <dt>Low-pass cutoff</dt>
              <dd>{formatEngineering(result.cutoffFrequencyHz, "Hz")}</dd>
            </div>
          </dl>
        )}
      </div>
    </SectionPanel>
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
