/**
 * File header: Tests the assembly telemetry helpers used by ExportBundlePanel rows.
 *
 * The helpers are extracted as pure functions so the inline warning copy can be unit-checked
 * without having to render the Next.js panel under a DOM test runner.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BUNDLE_AUTO_REFRESH_INTERVAL_MS, buildBundleAssemblyTelemetryMessage, describeBundleAssemblyStatus, shouldAutoRefreshBundleAssembly } from "./ExportBundlePanel";
import type { ExportBundle, ExportBundleManifest } from "@ee-library/shared/types";

/**
 * Builds a stub ExportBundle matching the shared contract for telemetry-helper tests.
 */
function buildStubBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  const manifest: ExportBundleManifest = {
    bundleFormat: "neutral",
    bundleId: "ebundle-test",
    controlSummary: { highestAccessLevel: null, itarControlledCount: 0, restrictedCount: 0 },
    controlledAssets: [],
    generatedAt: "2026-05-07T10:00:00.000Z",
    includedAssets: [],
    omissions: [],
    projectId: "project-test",
    revisionLabel: null,
    warnings: []
  };

  return {
    archiveAvailability: "manifest_only",
    archiveStorageKey: null,
    assemblyAttemptCount: 0,
    assemblyCompletedAt: null,
    assemblyError: null,
    assemblyStatus: "not_required",
    bundleFormat: "neutral",
    createdAt: "2026-05-07T10:00:00.000Z",
    createdBy: null,
    fileAvailability: "manifest_only",
    id: "ebundle-test",
    includedAssetCount: 0,
    manifest,
    omittedAssetCount: 0,
    partCount: 0,
    projectId: "project-test",
    revisionLabel: null,
    storageKey: null,
    warningCount: 0,
    ...overrides
  };
}

/**
 * Verifies the telemetry helper stays quiet for assembled and not_required bundles.
 */
test("buildBundleAssemblyTelemetryMessage stays quiet when nothing actionable is happening", () => {
  assert.equal(buildBundleAssemblyTelemetryMessage(buildStubBundle({ assemblyStatus: "not_required" })), null);
  assert.equal(buildBundleAssemblyTelemetryMessage(buildStubBundle({ assemblyStatus: "assembled" })), null);
});

/**
 * Verifies pending bundles surface a plain-language progress hint based on the included count.
 */
test("buildBundleAssemblyTelemetryMessage surfaces pluralized progress copy when pending", () => {
  const single = buildBundleAssemblyTelemetryMessage(
    buildStubBundle({ assemblyStatus: "pending", includedAssetCount: 1 })
  );
  const several = buildBundleAssemblyTelemetryMessage(
    buildStubBundle({ assemblyStatus: "pending", includedAssetCount: 4 })
  );

  assert.ok(single?.includes("1 verified asset"));
  assert.ok(!/\b1 verified assets\b/u.test(single ?? ""));
  assert.ok(several?.includes("4 verified assets"));
});

/**
 * Verifies assembly_failed bundles surface the structured phase + failing asset path.
 */
test("buildBundleAssemblyTelemetryMessage spells out the failing phase and asset path", () => {
  const message = buildBundleAssemblyTelemetryMessage(
    buildStubBundle({
      assemblyError: {
        failedAssetId: "asset-2",
        failedAt: "2026-05-07T10:05:00.000Z",
        failedBundlePath: "C0805/symbol.lib",
        message: "storage key not found",
        phase: "fetch_asset"
      },
      assemblyStatus: "assembly_failed"
    })
  );

  assert.ok(message);
  assert.ok(message?.includes("reading the source asset bytes"));
  assert.ok(message?.includes("C0805/symbol.lib"));
  assert.ok(message?.includes("storage key not found"));
});

/**
 * Verifies the assembly_failed copy still works when only the asset id is recorded (no bundle path).
 */
test("buildBundleAssemblyTelemetryMessage falls back to asset id when bundle path is null", () => {
  const message = buildBundleAssemblyTelemetryMessage(
    buildStubBundle({
      assemblyError: {
        failedAssetId: "asset-2",
        failedAt: "2026-05-07T10:05:00.000Z",
        failedBundlePath: null,
        message: "disk full",
        phase: "write_asset"
      },
      assemblyStatus: "assembly_failed"
    })
  );

  assert.ok(message?.includes("writing the per-bundle copy"));
  assert.ok(message?.includes("asset-2"));
  assert.ok(message?.includes("disk full"));
});

/**
 * Verifies the printable label for each known assembly status.
 */
test("describeBundleAssemblyStatus maps every status to a plain English label", () => {
  assert.equal(describeBundleAssemblyStatus("not_required"), "Not required");
  assert.equal(describeBundleAssemblyStatus("pending"), "Assembling");
  assert.equal(describeBundleAssemblyStatus("assembled"), "Assembled");
  assert.equal(describeBundleAssemblyStatus("assembly_failed"), "Assembly failed");
});

/**
 * Verifies the auto-refresh helper polls only while a bundle is still in `pending` assembly.
 *
 * Terminal states (`assembled`, `assembly_failed`) and `not_required` must not trigger refreshes.
 * Otherwise an idle panel would burn a network request every few seconds for nothing.
 */
test("shouldAutoRefreshBundleAssembly polls only when a bundle is still pending", () => {
  const idleBundle = buildStubBundle({ assemblyStatus: "not_required" });
  const assembledBundle = buildStubBundle({ assemblyStatus: "assembled" });
  const failedBundle = buildStubBundle({ assemblyStatus: "assembly_failed" });
  const pendingBundle = buildStubBundle({ assemblyStatus: "pending" });

  assert.equal(shouldAutoRefreshBundleAssembly([]), false);
  assert.equal(shouldAutoRefreshBundleAssembly([idleBundle]), false);
  assert.equal(shouldAutoRefreshBundleAssembly([assembledBundle]), false);
  assert.equal(shouldAutoRefreshBundleAssembly([failedBundle]), false);
  assert.equal(shouldAutoRefreshBundleAssembly([assembledBundle, failedBundle, idleBundle]), false);
  assert.equal(shouldAutoRefreshBundleAssembly([pendingBundle]), true);
  // Mixed list with at least one pending bundle must keep polling so the daemon's progress shows.
  assert.equal(shouldAutoRefreshBundleAssembly([assembledBundle, pendingBundle, failedBundle]), true);
});

/**
 * Verifies the auto-refresh interval sits below the worker daemon's 30s assembly tick so the
 * panel reflects a finished archive in the next polling cycle rather than waiting two daemon ticks.
 */
test("BUNDLE_AUTO_REFRESH_INTERVAL_MS is below the worker daemon assembly cadence", () => {
  const WORKER_DAEMON_ASSEMBLY_INTERVAL_MS = 30_000;
  assert.ok(BUNDLE_AUTO_REFRESH_INTERVAL_MS > 0, "interval must be positive");
  assert.ok(
    BUNDLE_AUTO_REFRESH_INTERVAL_MS < WORKER_DAEMON_ASSEMBLY_INTERVAL_MS,
    `expected ${BUNDLE_AUTO_REFRESH_INTERVAL_MS}ms < daemon cadence ${WORKER_DAEMON_ASSEMBLY_INTERVAL_MS}ms`
  );
});
