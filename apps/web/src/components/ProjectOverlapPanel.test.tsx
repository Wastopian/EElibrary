/**
 * File header: Tests the project-overlap panel's engineer-facing drill-down clues.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectOverlapPanel } from "./ProjectOverlapPanel";
import type { ProjectOverlapPanelResponse } from "@ee-library/shared/types";

/**
 * Verifies shared-part rows include the prior usage clues engineers need at scan time.
 */
test("ProjectOverlapPanel renders shared usage clues and circuit-block role previews", () => {
  const html = renderToStaticMarkup(<ProjectOverlapPanel overlap={buildOverlapResponse()} />);

  assert.match(html, /Beta Build/u);
  assert.match(html, /TPS7A02DBVR/u);
  assert.match(html, /Rev A/u);
  assert.match(html, /U1/u);
  assert.match(html, /qty 1/u);
  assert.match(html, /used/u);
  assert.match(html, /Open usage rows for BETA/u);
  assert.match(html, /Circuit-block role hits/u);
  assert.match(html, /Alpha power rail/u);
  assert.match(html, /ALPHA-POWER/u);
  assert.match(html, /Main LDO/u);
  assert.match(html, /Required/u);
  assert.match(html, /exact required/u);
});

/**
 * Builds a representative overlap payload with both prior-project and block-role context.
 */
function buildOverlapResponse(): ProjectOverlapPanelResponse {
  return {
    circuitBlockRoleHitsPreview: [
      {
        blockKey: "ALPHA-POWER",
        blockName: "Alpha power rail",
        blockPartId: "cbpart-alpha-power-ldo",
        blockStatus: "approved",
        circuitBlockId: "cblock-alpha-power",
        isRequired: true,
        mpn: "TPS7A02DBVR",
        partId: "part-memory-ldo",
        quantity: 1,
        role: "Main LDO",
        substitutionPolicy: "exact_required"
      }
    ],
    circuitBlockWhereUsedHitCount: 1,
    connectorWhereUsedHitCount: 1,
    priorProjects: [
      {
        project: {
          createdAt: "2026-04-15T00:00:00.000Z",
          description: "Prior confirmed design.",
          id: "project-beta",
          name: "Beta Build",
          owner: "Hardware",
          projectKey: "BETA",
          status: "active",
          updatedAt: "2026-04-16T00:00:00.000Z"
        },
        sharedPartCount: 1,
        sharedPartIds: ["part-memory-ldo"],
        sharedPartsPreview: [
          {
            designatorsPreview: ["U1"],
            mpn: "TPS7A02DBVR",
            partId: "part-memory-ldo",
            projectRevisionLabel: "A",
            quantityTotal: 1,
            usageCount: 1,
            usageStatus: "used"
          }
        ]
      }
    ],
    projectId: "project-alpha",
    scannedPartCount: 2,
    state: "available"
  };
}
