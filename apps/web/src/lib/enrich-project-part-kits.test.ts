/**
 * File header: Tests catalog-backed enrichment for project part kits.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { PartDetailResponse, ProjectPartKit } from "@ee-library/shared/types";
import { mergeCatalogHintsIntoPartKit } from "./enrich-project-part-kits";

test("mergeCatalogHintsIntoPartKit fills missing model when datasheet already present", () => {
  const kit: ProjectPartKit = {
    datasheet: {
      assetId: "asset-ds-1",
      category: "datasheets",
      downloadUrl: "/api/parts/part-1/assets/asset-ds-1/download",
      name: "datasheet.pdf",
      relativePath: "datasheets/datasheet.pdf",
      source: "catalog"
    },
    designators: ["U1"],
    footprint: null,
    manufacturerName: "TI",
    model: null,
    mpn: "CBJ3157",
    note: "From BOM",
    partId: "part-1",
    partUrl: "https://bom.example/link",
    usageIds: []
  };

  const detail = {
    acquisitionSummary: {
      completedAt: null,
      lastJobStatus: null,
      manufacturerName: "TI",
      mpn: "TPS7A02DBVR",
      providerId: "digikey",
      providerPartKey: "123",
      reason: null,
      requestedAt: null,
      requestedBy: null,
      requestedLookup: null,
      sourceUrl: "https://catalog.example/part",
      state: "recorded"
    },
    assetGroups: [],
    assetPromotionSummaries: [],
    assetReviewStatuses: [],
    assetValidationSummaries: [],
    bundleReadiness: {} as PartDetailResponse["bundleReadiness"],
    enrichmentSummary: {} as PartDetailResponse["enrichmentSummary"],
    generationOptions: [],
    record: {
      accessoryRequirements: [],
      approval: {} as PartDetailResponse["record"]["approval"],
      assets: [
        {
          assetState: "downloaded",
          assetStatus: "downloaded",
          assetType: "datasheet",
          availabilityStatus: "downloaded",
          exportStatus: "partially_exportable",
          fileFormat: "pdf",
          fileHash: "abc123",
          generationMethod: null,
          generationSourceAssetId: null,
          id: "asset-ds-1",
          lastUpdatedAt: "2026-01-01T00:00:00.000Z",
          licenseMode: "standard",
          partId: "part-1",
          previewArtifactFormat: null,
          previewArtifactGeneratedAt: null,
          previewArtifactSource: null,
          previewArtifactStorageKey: null,
          previewStatus: "not_available",
          provenance: "provider_import",
          providerId: "digikey",
          reviewStatus: "unreviewed",
          sourceRecordId: null,
          sourceUrl: null,
          storageKey: "datasheets/part-1.pdf",
          validationStatus: "unverified"
        },
        {
          assetState: "downloaded",
          assetStatus: "downloaded",
          assetType: "three_d_model",
          availabilityStatus: "downloaded",
          exportStatus: "partially_exportable",
          fileFormat: "step",
          fileHash: "model123",
          generationMethod: null,
          generationSourceAssetId: null,
          id: "asset-3d-1",
          lastUpdatedAt: "2026-01-02T00:00:00.000Z",
          licenseMode: "standard",
          partId: "part-1",
          previewArtifactFormat: null,
          previewArtifactGeneratedAt: null,
          previewArtifactSource: null,
          previewArtifactStorageKey: null,
          previewStatus: "not_available",
          provenance: "provider_import",
          providerId: "digikey",
          reviewStatus: "unreviewed",
          sourceRecordId: null,
          sourceUrl: null,
          storageKey: "models/part-1.step",
          validationStatus: "unverified"
        }
      ],
      buildableMatingSet: {} as PartDetailResponse["record"]["buildableMatingSet"],
      cableCompatibilities: [],
      companionRecommendations: [],
      connectorFamily: null,
      connectorFamilyConflicts: [],
      datasheetRevision: {
        fileAssetId: "asset-ds-1",
        id: "rev-1",
        lastUpdatedAt: "2026-01-01T00:00:00.000Z",
        pageCount: 12,
        parseConfidence: 0.9,
        partId: "part-1",
        pinTableStatus: "parsed",
        revisionDate: "2026-01-01",
        revisionLabel: "A",
        sourceRecordId: null
      },
      duplicateCandidates: [],
      extractionSignals: [],
      generationRequests: [],
      generationWorkflows: [],
      issues: [],
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      manufacturer: { id: "mfr-1", name: "TI", lastUpdatedAt: "2026-01-01T00:00:00.000Z" },
      mateRelations: [],
      metrics: [],
      package: {} as PartDetailResponse["record"]["package"],
      part: {
        category: "regulator",
        connectorFamilyId: null,
        description: "Catalog description",
        id: "part-1",
        lastUpdatedAt: "2026-01-01T00:00:00.000Z",
        lifecycleStatus: "active",
        manufacturerId: "mfr-1",
        mpn: "TPS7A02DBVR",
        packageId: "pkg-1",
        trustScore: 0.9
      },
      promotionAudits: [],
      readinessSummary: {} as PartDetailResponse["record"]["readinessSummary"],
      reviewRecords: [],
      riskFlags: [],
      similarParts: [],
      sourceReconciliation: null,
      sources: [],
      validationRecords: []
    },
    relatedPartSummaries: [],
    workflowReviewStatuses: []
  } satisfies PartDetailResponse;

  const merged = mergeCatalogHintsIntoPartKit(kit, detail);

  assert.equal(merged.note, "From BOM");
  assert.equal(merged.partUrl, "https://bom.example/link");
  assert.equal(merged.datasheet?.assetId, "asset-ds-1");
  assert.equal(merged.model?.assetId, "asset-3d-1");
  assert.match(merged.model?.downloadUrl ?? "", /asset-3d-1/u);
});
