/**
 * File header: Renders the /tools workspace — small, focused EE calculators.
 *
 * The first MVP ships two everyday calculators (voltage divider, RC time
 * constant). They are pure client-side math — no API, no database, no setup
 * state — so they work even when the rest of the stack is offline.
 */

import React from "react";
import { SectionHeading } from "@ee-library/ui";
import { WorkspaceJumpNav } from "../../components/WorkspaceJumpNav";
import { RCTimeConstantCalculator } from "./RCTimeConstantCalculator";
import { VoltageDividerCalculator } from "./VoltageDividerCalculator";

export const dynamic = "force-static";

/**
 * Renders the /tools workspace with the available EE calculators.
 */
export default function ToolsPage(): React.ReactElement {
  return (
    <main className="projects-layout">
      <section className="projects-hero">
        <div className="projects-hero__layout">
          <div className="projects-hero__copy">
            <p className="app-kicker">Tools</p>
            <h1>Engineering calculators</h1>
            <p className="projects-hero__lede">
              Small, focused calculators for everyday EE math. Each one shows the formula it uses, takes inputs in plain engineering units, and never sends your numbers anywhere.
            </p>
          </div>
        </div>
      </section>

      <WorkspaceJumpNav
        ariaLabel="Tools sections"
        items={[
          { href: "#voltage-divider-heading", label: "Voltage divider" },
          { href: "#rc-time-constant-heading", label: "RC time constant" }
        ]}
      />

      <section aria-labelledby="voltage-divider-heading" className="detail-section">
        <SectionHeading
          id="voltage-divider-heading"
          index="01"
          subtitle="Compute Vout from Vin, R1, R2 — or solve for one resistor when you know the target Vout."
          title="Voltage divider"
        />
        <VoltageDividerCalculator />
      </section>

      <section aria-labelledby="rc-time-constant-heading" className="detail-section">
        <SectionHeading
          id="rc-time-constant-heading"
          index="02"
          subtitle="Compute τ = R × C, common settling times, and the matching low-pass cutoff frequency."
          title="RC time constant"
        />
        <RCTimeConstantCalculator />
      </section>
    </main>
  );
}
