/**
 * File header: Tests demo project seed helpers without connecting to Postgres.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDemoBomImportSummary,
  buildDemoExportManifest,
  buildDemoRouteGuide,
  DEMO_BOM_IMPORTS,
  DEMO_CABLE_ASSEMBLY_ID,
  DEMO_CIRCUIT_BLOCK_ID,
  DEMO_FIXTURE_ID,
  DEMO_INTERCONNECT_PIN_MAP_ROWS,
  DEMO_PROJECT_ID,
  DEMO_PROJECT_KEY,
  DEMO_REVISIONS,
  parseSeedDemoProjectArgs,
  PART_IDS_REQUIRED
} from "../seed-demo-project.mjs";

test("parseSeedDemoProjectArgs defaults to non-force", () => {
  const parsed = parseSeedDemoProjectArgs([]);

  assert.equal(parsed.force, false);
});

test("parseSeedDemoProjectArgs accepts --force", () => {
  const parsed = parseSeedDemoProjectArgs(["--force"]);

  assert.equal(parsed.force, true);
});

test("demo project constants stay aligned with deterministic id rules", () => {
  assert.equal(DEMO_PROJECT_KEY, "DEMO-POCKET-MCU");
  assert.equal(DEMO_PROJECT_ID, "project-demo-pocket-mcu");
  assert.equal(DEMO_REVISIONS[0]?.id, "rev-project-demo-pocket-mcu-r0-1");
  assert.equal(DEMO_REVISIONS[1]?.id, "rev-project-demo-pocket-mcu-r0-2");
  assert.equal(DEMO_CABLE_ASSEMBLY_ID, "cable-demo-pocket-mcu-jst-power");
  assert.equal(DEMO_FIXTURE_ID, "fixture-demo-pocket-mcu-bringup");
  assert.ok(PART_IDS_REQUIRED.includes("part-ci-jst-ph-housing"));
  assert.ok(PART_IDS_REQUIRED.includes("part-ci-jst-ph-mate"));
});

test("buildDemoBomImportSummary keeps weak rows separate from confirmed usage", () => {
  const summary = buildDemoBomImportSummary(DEMO_BOM_IMPORTS[0].lines);

  assert.equal(summary.matchedLineCount, 4);
  assert.equal(summary.confirmedUsageLineCount, 4);
  assert.equal(summary.weakMatchLineCount, 1);
  assert.equal(summary.unmatchedLineCount, 1);
  assert.equal(summary.ignoredLineCount, 1);
});

test("buildDemoExportManifest records omissions without claiming file availability", () => {
  const manifest = buildDemoExportManifest({
    bundleFormat: "neutral",
    bundleId: "bundle-test",
    generatedAt: "2026-05-16T12:05:00.000Z",
    projectId: DEMO_PROJECT_ID,
    revisionLabel: "R0.2"
  });

  assert.equal(manifest.includedAssets.length, 0);
  assert.equal(manifest.omissions.length > 0, true);
  assert.equal(manifest.omissions.every((omission) => omission.reason === "not_verified_for_export"), true);
  assert.equal(manifest.controlSummary.highestAccessLevel, null);
});

test("buildDemoRouteGuide exposes the primary walkthrough routes", () => {
  const routes = buildDemoRouteGuide();
  const paths = routes.map((route) => route.path);

  assert.ok(paths.includes(`/projects/${DEMO_PROJECT_ID}`));
  assert.ok(paths.includes(`/circuit-blocks/${DEMO_CIRCUIT_BLOCK_ID}`));
  assert.ok(paths.includes("/interconnects"));
  assert.ok(paths.some((path) => path.startsWith("/compare?parts=")));
  assert.ok(paths.some((path) => path.startsWith("/where-used?")));
});

test("demo interconnect pin map includes the J202 review row", () => {
  const reviewRows = DEMO_INTERCONNECT_PIN_MAP_ROWS.filter((row) => row.pinNumber === "47" || row.pinNumber === "48");

  assert.equal(DEMO_INTERCONNECT_PIN_MAP_ROWS.length, 24);
  assert.equal(reviewRows.length, 2);
  assert.equal(reviewRows.every((row) => row.confidenceScore < 0.75), true);
  assert.equal(DEMO_INTERCONNECT_PIN_MAP_ROWS.some((row) => row.signalName === "VBAT_IN"), true);
});
