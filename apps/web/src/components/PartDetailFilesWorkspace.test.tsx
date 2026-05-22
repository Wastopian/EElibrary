/**
 * File header: Tests part detail file-row actions for project-scoped uploads.
 */

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PartDetailFilesWorkspace } from "./PartDetailFilesWorkspace";
import type { Asset, AssetType } from "@ee-library/shared/types";

test("PartDetailFilesWorkspace offers add buttons for missing project-context files", () => {
  const html = renderToStaticMarkup(
    <PartDetailFilesWorkspace
      assetGroups={[]}
      partId="part-1"
      partMpn="TPS7A02DBVR"
      projectId="project-alpha"
      projectMirrorAvailable={true}
      source="database"
      supplierUrl={null}
      validationSummaries={[]}
    />
  );

  assert.equal(countText(html, ">Add file</span>"), 5);
});

test("PartDetailFilesWorkspace uses direct add file controls outside project context", () => {
  const html = renderToStaticMarkup(
    <PartDetailFilesWorkspace
      assetGroups={[]}
      partId="part-1"
      partMpn="TPS7A02DBVR"
      source="database"
      supplierUrl={null}
      validationSummaries={[]}
    />
  );

  assert.equal(countText(html, ">Add file</span>"), 5);
  assert.doesNotMatch(html, /Add from project/u);
});

test("PartDetailFilesWorkspace offers change when a catalog file is already present", () => {
  const html = renderToStaticMarkup(
    <PartDetailFilesWorkspace
      assetGroups={[
        {
          assetType: "datasheet",
          assets: [buildAsset("datasheet")],
          bestAsset: buildAsset("datasheet"),
          readiness: "downloaded_file"
        }
      ]}
      partId="part-1"
      partMpn="TPS7A02DBVR"
      projectId="project-alpha"
      projectMirrorAvailable={true}
      source="database"
      supplierUrl={null}
      validationSummaries={[]}
    />
  );

  assert.match(html, /Change file/u);
});

/**
 * Builds the minimum file-backed asset needed for file-action rendering.
 */
function buildAsset(assetType: AssetType): Asset {
  return {
    assetState: "downloaded",
    assetStatus: "downloaded",
    assetType,
    availabilityStatus: "downloaded",
    exportStatus: "partially_exportable",
    fileFormat: "pdf",
    fileHash: "hash",
    generationMethod: null,
    generationSourceAssetId: null,
    id: `asset-${assetType}`,
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    licenseMode: "redistribution_allowed",
    partId: "part-1",
    previewArtifactFormat: null,
    previewArtifactGeneratedAt: null,
    previewArtifactSource: null,
    previewArtifactStorageKey: null,
    previewStatus: "not_available",
    provenance: "manual_internal",
    providerId: null,
    reviewStatus: "not_reviewed",
    sourceRecordId: null,
    sourceUrl: null,
    storageKey: "datasheets/part-1.pdf",
    validationStatus: "not_validated"
  };
}

/**
 * Counts exact text occurrences in rendered HTML.
 */
function countText(html: string, text: string): number {
  return html.split(text).length - 1;
}
