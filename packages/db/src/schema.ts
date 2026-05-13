/**
 * File header: Defines Drizzle table mappings for EE Library canonical and planned engineering-memory persistence.
 */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** literalCheck wraps a raw SQL predicate for Drizzle check constraints. */
function literalCheck(condition: string) {
  return sql.raw(condition);
}

export const manufacturers = pgTable("manufacturers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  aliases: text("aliases").array().notNull().default([]),
  website: text("website"),
});

export const packages = pgTable("packages", {
  id: text("id").primaryKey(),
  packageName: text("package_name").notNull(),
  pinCount: integer("pin_count"),
  pitchMm: numeric("pitch_mm"),
  bodyLengthMm: numeric("body_length_mm"),
  bodyWidthMm: numeric("body_width_mm"),
  bodyHeightMm: numeric("body_height_mm"),
});

export const connectorFamilies = pgTable("connector_families", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  series: text("series").notNull(),
  description: text("description").notNull(),
});

export const parts = pgTable(
  "parts",
  {
    id: text("id").primaryKey(),
    mpn: text("mpn").notNull(),
    description: text("description").notNull().default(""),
    manufacturerId: text("manufacturer_id")
      .notNull()
      .references(() => manufacturers.id),
    category: text("category").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull(),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    connectorFamilyId: text("connector_family_id").references(
      () => connectorFamilies.id
    ),
    trustScore: numeric("trust_score").notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.manufacturerId, t.mpn)]
);

export const sourceRecords = pgTable(
  "source_records",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    providerPartKey: text("provider_part_key").notNull(),
    partId: text("part_id").references(() => parts.id),
    sourceUrl: text("source_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
    normalizedAt: timestamp("normalized_at", { withTimezone: true }),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sourceLastSeenAt: timestamp("source_last_seen_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    sourceLastImportedAt: timestamp("source_last_imported_at", {
      withTimezone: true,
    }),
    importStatus: text("import_status").notNull().default("imported"),
    importErrorDetails: text("import_error_details"),
  },
  (t) => [
    unique().on(t.providerId, t.providerPartKey, t.fetchedAt),
    index("idx_source_records_part_id").on(t.partId),
    index("idx_source_records_provider_part").on(t.providerId, t.providerPartKey),
    index("idx_source_records_import_status").on(t.importStatus, t.lastUpdatedAt),
    index("idx_source_records_last_imported_at").on(t.sourceLastImportedAt),
    check("source_records_import_status_check", literalCheck(`import_status IN ('imported', 'failed')`)),
  ]
);

/** supplyOfferings stores source-linked distributor/local-catalog commercial snapshots. */
export const supplyOfferings = pgTable(
  "supply_offerings",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    providerId: text("provider_id").notNull(),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => sourceRecords.id),
    providerPartKey: text("provider_part_key").notNull(),
    providerSku: text("provider_sku"),
    inventoryStatus: text("inventory_status").notNull().default("unknown"),
    inventoryQuantity: integer("inventory_quantity"),
    moq: integer("moq"),
    leadTimeDays: integer("lead_time_days"),
    packaging: text("packaging"),
    currencyCode: text("currency_code").notNull().default("USD"),
    preferredRank: integer("preferred_rank"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_supply_offerings_provider_sku").on(t.partId, t.providerId, t.providerPartKey, t.providerSku),
    index("idx_supply_offerings_part").on(t.partId, t.inventoryStatus, t.lastSeenAt),
    index("idx_supply_offerings_source_record").on(t.sourceRecordId),
    index("idx_supply_offerings_provider_part").on(t.providerId, t.providerPartKey, t.lastSeenAt),
    check(
      "supply_offerings_inventory_status_check",
      literalCheck(`inventory_status IN ('in_stock', 'out_of_stock', 'backorder', 'unknown')`)
    ),
    check("supply_offerings_inventory_quantity_check", literalCheck(`inventory_quantity IS NULL OR inventory_quantity >= 0`)),
    check("supply_offerings_moq_check", literalCheck(`moq IS NULL OR moq >= 1`)),
    check("supply_offerings_lead_time_days_check", literalCheck(`lead_time_days IS NULL OR lead_time_days >= 0`)),
    check("supply_offerings_currency_code_check", literalCheck(`currency_code LIKE '___' AND currency_code = upper(currency_code)`)),
    check("supply_offerings_preferred_rank_check", literalCheck(`preferred_rank IS NULL OR preferred_rank >= 1`)),
  ]
);

/** priceBreaks stores provider-specific price tiers for one supply snapshot. */
export const priceBreaks = pgTable(
  "price_breaks",
  {
    id: text("id").primaryKey(),
    supplyOfferingId: text("supply_offering_id")
      .notNull()
      .references(() => supplyOfferings.id, { onDelete: "cascade" }),
    minQuantity: integer("min_quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 8 }).notNull(),
    currencyCode: text("currency_code").notNull().default("USD"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.supplyOfferingId, t.minQuantity, t.currencyCode, t.capturedAt),
    index("idx_price_breaks_offering").on(t.supplyOfferingId, t.minQuantity, t.capturedAt),
    index("idx_price_breaks_price").on(t.currencyCode, t.unitPrice, t.minQuantity),
    check("price_breaks_min_quantity_check", literalCheck(`min_quantity >= 1`)),
    check("price_breaks_unit_price_check", literalCheck(`unit_price >= 0`)),
    check("price_breaks_currency_code_check", literalCheck(`currency_code LIKE '___' AND currency_code = upper(currency_code)`)),
  ]
);

export const providerAcquisitionJobs = pgTable(
  "provider_acquisition_jobs",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    providerPartKey: text("provider_part_key").notNull(),
    requestedLookup: text("requested_lookup").notNull(),
    manufacturerName: text("manufacturer_name"),
    mpn: text("mpn"),
    packageName: text("package_name"),
    sourceUrl: text("source_url"),
    matchType: text("match_type").notNull(),
    matchConfidence: numeric("match_confidence").notNull(),
    jobStatus: text("job_status").notNull().default("queued"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    partId: text("part_id").references(() => parts.id),
    importOutcome: text("import_outcome"),
    previousImportStatus: text("previous_import_status"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_provider_acquisition_jobs_active_provider_part")
      .on(t.providerId, t.providerPartKey)
      .where(sql`${t.jobStatus} IN ('queued', 'running')`),
    index("idx_provider_acquisition_jobs_status_requested_at").on(t.jobStatus, t.requestedAt, t.id),
    index("idx_provider_acquisition_jobs_provider_part").on(t.providerId, t.providerPartKey, t.requestedAt),
    index("idx_provider_acquisition_jobs_part_completed_at").on(t.partId, t.completedAt),
    check(
      "provider_acquisition_jobs_match_type_check",
      literalCheck(`match_type IN ('exact_mpn', 'exact_provider_part_id')`)
    ),
    check(
      "provider_acquisition_jobs_status_check",
      literalCheck(`job_status IN ('queued', 'running', 'succeeded', 'failed')`)
    ),
    check(
      "provider_acquisition_jobs_import_outcome_check",
      literalCheck(`import_outcome IS NULL OR import_outcome IN ('new_import', 'refreshed_existing')`)
    ),
    check(
      "provider_acquisition_jobs_previous_import_status_check",
      literalCheck(`previous_import_status IS NULL OR previous_import_status IN ('imported', 'failed')`)
    ),
  ]
);

export const providerAcquisitionJobEvents = pgTable(
  "provider_acquisition_job_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => providerAcquisitionJobs.id),
    eventType: text("event_type").notNull(),
    message: text("message").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_provider_acquisition_job_events_job_created_at").on(t.jobId, t.createdAt),
    index("idx_provider_acquisition_job_events_type_created_at").on(t.eventType, t.createdAt),
    check(
      "provider_acquisition_job_events_type_check",
      literalCheck(`event_type IN ('queued', 'running', 'succeeded', 'failed')`)
    ),
  ]
);

export const providerEnrichmentJobs = pgTable(
  "provider_enrichment_jobs",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    sourceAcquisitionJobId: text("source_acquisition_job_id")
      .notNull()
      .references(() => providerAcquisitionJobs.id),
    jobType: text("job_type").notNull(),
    jobStatus: text("job_status").notNull().default("queued"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_provider_enrichment_jobs_active_part_job_type")
      .on(t.partId, t.jobType)
      .where(sql`${t.jobStatus} IN ('queued', 'running')`),
    index("idx_provider_enrichment_jobs_status_requested_at").on(t.jobStatus, t.requestedAt, t.id),
    index("idx_provider_enrichment_jobs_part_requested_at").on(t.partId, t.requestedAt, t.id),
    index("idx_provider_enrichment_jobs_source_acquisition_job").on(t.sourceAcquisitionJobId, t.requestedAt),
    check(
      "provider_enrichment_jobs_type_check",
      literalCheck(`job_type IN ('datasheet_capture')`)
    ),
    check(
      "provider_enrichment_jobs_status_check",
      literalCheck(`job_status IN ('queued', 'running', 'succeeded', 'failed')`)
    ),
  ]
);

export const providerEnrichmentJobEvents = pgTable(
  "provider_enrichment_job_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => providerEnrichmentJobs.id),
    eventType: text("event_type").notNull(),
    message: text("message").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_provider_enrichment_job_events_job_created_at").on(t.jobId, t.createdAt),
    index("idx_provider_enrichment_job_events_type_created_at").on(t.eventType, t.createdAt),
    check(
      "provider_enrichment_job_events_type_check",
      literalCheck(`event_type IN ('queued', 'running', 'succeeded', 'failed')`)
    ),
  ]
);

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    assetType: text("asset_type").notNull(),
    fileFormat: text("file_format").notNull(),
    storageKey: text("storage_key"),
    fileHash: text("file_hash"),
    providerId: text("provider_id"),
    licenseMode: text("license_mode").notNull(),
    provenance: text("provenance").notNull().default("manual_internal"),
    availabilityStatus: text("availability_status").notNull().default("missing"),
    reviewStatus: text("review_status").notNull().default("not_reviewed"),
    exportStatus: text("export_status").notNull().default("not_exportable"),
    assetStatus: text("asset_status").notNull().default("missing"),
    generationMethod: text("generation_method"),
    generationSourceAssetId: text("generation_source_asset_id"),
    validationStatus: text("validation_status").notNull(),
    previewStatus: text("preview_status").notNull(),
    assetState: text("asset_state").notNull().default("missing"),
    sourceUrl: text("source_url"),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_assets_part_id").on(t.partId),
    index("idx_assets_part_id_asset_type").on(t.partId, t.assetType),
    index("idx_assets_search_cad_export").on(
      t.partId,
      t.assetType,
      t.availabilityStatus,
      t.exportStatus,
      t.validationStatus
    ),
    check(
      "assets_asset_state_check",
      literalCheck(`asset_state IN ('missing', 'referenced', 'downloaded', 'validated', 'failed')`)
    ),
    check(
      "assets_provenance_check",
      literalCheck(`provenance IN ('official', 'trusted_external', 'generated', 'manual_internal')`)
    ),
    check(
      "assets_availability_status_check",
      literalCheck(`availability_status IN ('missing', 'referenced', 'downloaded', 'validated', 'failed')`)
    ),
    check(
      "assets_review_status_check",
      literalCheck(`review_status IN ('not_reviewed', 'review_required', 'approved', 'rejected', 'changes_requested')`)
    ),
    check(
      "assets_export_status_check",
      literalCheck(`export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export')`)
    ),
    check(
      "assets_asset_status_check",
      literalCheck(`asset_status IN ('missing', 'referenced', 'downloaded', 'validated', 'failed', 'reviewed', 'verified_for_export')`)
    ),
  ]
);

export const datasheetRevisions = pgTable(
  "datasheet_revisions",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    revisionLabel: text("revision_label").notNull(),
    revisionDate: text("revision_date"),
    pageCount: integer("page_count"),
    fileAssetId: text("file_asset_id").references(() => assets.id),
    parseConfidence: numeric("parse_confidence").notNull(),
    pinTableStatus: text("pin_table_status").notNull().default("not_available"),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_datasheet_revisions_part_id").on(t.partId),
    check(
      "datasheet_revisions_pin_table_status_check",
      literalCheck(`pin_table_status IN ('not_available', 'available', 'needs_review')`)
    ),
  ]
);

/** documentRevisions stores controlled datasheet/drawing history on top of existing asset provenance. */
export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    documentType: text("document_type").notNull(),
    revisionLabel: text("revision_label").notNull(),
    revisionDate: date("revision_date"),
    lifecycleStatus: text("lifecycle_status").notNull().default("draft"),
    accessLevel: text("access_level").notNull().default("internal"),
    accessNotes: text("access_notes").notNull().default(""),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    supersedesDocumentRevisionId: text("supersedes_document_revision_id").references(
      (): AnyPgColumn => documentRevisions.id
    ),
    sourceAssetHash: text("source_asset_hash"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.partId, t.assetId, t.revisionLabel),
    index("idx_document_revisions_part").on(t.partId, t.lifecycleStatus, t.updatedAt),
    index("idx_document_revisions_asset").on(t.assetId, t.updatedAt),
    index("idx_document_revisions_supersedes").on(t.supersedesDocumentRevisionId),
    index("idx_document_revisions_expiry").on(t.expiresAt),
    index("idx_document_revisions_access").on(t.accessLevel, t.lifecycleStatus),
    check(
      "document_revisions_document_type_check",
      literalCheck(`document_type IN ('datasheet', 'mechanical_drawing', 'controlled_drawing', 'specification', 'other')`)
    ),
    check(
      "document_revisions_lifecycle_status_check",
      literalCheck(`lifecycle_status IN ('draft', 'in_review', 'released', 'superseded', 'expired', 'archived')`)
    ),
    check(
      "document_revisions_access_level_check",
      literalCheck(`access_level IN ('public', 'internal', 'restricted', 'itar_controlled')`)
    ),
  ]
);

/** documentAclEntries records intended access/review grants for future RBAC and ITAR gates. */
export const documentAclEntries = pgTable(
  "document_acl_entries",
  {
    id: text("id").primaryKey(),
    documentRevisionId: text("document_revision_id")
      .notNull()
      .references(() => documentRevisions.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    permission: text("permission").notNull(),
    grantedBy: text("granted_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.documentRevisionId, t.principalType, t.principalId, t.permission),
    index("idx_document_acl_entries_revision").on(t.documentRevisionId, t.permission),
    index("idx_document_acl_entries_principal").on(t.principalType, t.principalId, t.permission),
    check(
      "document_acl_entries_principal_type_check",
      literalCheck(`principal_type IN ('user', 'team', 'role')`)
    ),
    check(
      "document_acl_entries_permission_check",
      literalCheck(`permission IN ('view', 'review', 'approve', 'admin')`)
    ),
  ]
);

/** documentRedlines stores engineering review notes without mutating release state on its own. */
export const documentRedlines = pgTable(
  "document_redlines",
  {
    id: text("id").primaryKey(),
    documentRevisionId: text("document_revision_id")
      .notNull()
      .references(() => documentRevisions.id, { onDelete: "cascade" }),
    redlineStatus: text("redline_status").notNull().default("open"),
    pageNumber: integer("page_number"),
    anchorText: text("anchor_text"),
    note: text("note").notNull(),
    severity: text("severity").notNull().default("review"),
    createdBy: text("created_by").notNull(),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_document_redlines_revision").on(t.documentRevisionId, t.redlineStatus, t.createdAt),
    index("idx_document_redlines_status").on(t.redlineStatus, t.severity, t.updatedAt),
    check(
      "document_redlines_status_check",
      literalCheck(`redline_status IN ('open', 'resolved', 'rejected', 'superseded')`)
    ),
    check("document_redlines_page_number_check", literalCheck(`page_number IS NULL OR page_number >= 1`)),
    check("document_redlines_severity_check", literalCheck(`severity IN ('info', 'review', 'blocker')`)),
  ]
);

export const partMetrics = pgTable(
  "part_metrics",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    metricKey: text("metric_key").notNull(),
    metricValue: numeric("metric_value"),
    unit: text("unit").notNull(),
    minValue: numeric("min_value"),
    maxValue: numeric("max_value"),
    confidenceScore: numeric("confidence_score").notNull(),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => datasheetRevisions.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.partId, t.metricKey, t.sourceRevisionId),
    index("idx_part_metrics_part_id").on(t.partId),
  ]
);

export const mateRelations = pgTable(
  "mate_relations",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    matePartId: text("mate_part_id")
      .notNull()
      .references(() => parts.id),
    relationshipType: text("relationship_type").notNull(),
    compatibilityStatus: text("compatibility_status").notNull().default("probable"),
    evidenceKind: text("evidence_kind").notNull().default("catalog_fixture"),
    confidenceScore: numeric("confidence_score").notNull(),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => datasheetRevisions.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    notes: text("notes"),
  },
  (t) => [
    index("idx_mate_relations_part_id").on(t.partId),
    check(
      "mate_relations_relationship_type_check",
      literalCheck(`relationship_type IN ('best_mate', 'alternate_mate')`)
    ),
    check(
      "mate_relations_compatibility_status_check",
      literalCheck(`compatibility_status IN ('verified', 'probable', 'uncertain', 'rejected')`)
    ),
    check(
      "mate_relations_evidence_kind_check",
      literalCheck(`evidence_kind IN ('provider_direct', 'datasheet_reference', 'family_inference', 'manual_review', 'catalog_fixture')`)
    ),
  ]
);

export const accessoryRequirements = pgTable(
  "accessory_requirements",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    accessoryPartId: text("accessory_part_id")
      .notNull()
      .references(() => parts.id),
    relationshipType: text("relationship_type").notNull(),
    compatibilityStatus: text("compatibility_status").notNull().default("probable"),
    evidenceKind: text("evidence_kind").notNull().default("catalog_fixture"),
    confidenceScore: numeric("confidence_score").notNull(),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => datasheetRevisions.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    notes: text("notes"),
  },
  (t) => [
    index("idx_accessory_requirements_part_id").on(t.partId),
    check(
      "accessory_requirements_relationship_type_check",
      literalCheck(`relationship_type IN ('requires_accessory', 'optional_accessory', 'tooling_requirement')`)
    ),
    check(
      "accessory_requirements_compatibility_status_check",
      literalCheck(`compatibility_status IN ('verified', 'probable', 'uncertain', 'rejected')`)
    ),
    check(
      "accessory_requirements_evidence_kind_check",
      literalCheck(`evidence_kind IN ('provider_direct', 'datasheet_reference', 'family_inference', 'manual_review', 'catalog_fixture')`)
    ),
  ]
);

export const cableCompatibilities = pgTable(
  "cable_compatibilities",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    cablePartId: text("cable_part_id")
      .notNull()
      .references(() => parts.id),
    relationshipType: text("relationship_type").notNull().default("supports_cable"),
    wireGaugeMin: integer("wire_gauge_min"),
    wireGaugeMax: integer("wire_gauge_max"),
    shieldingRequirement: text("shielding_requirement").notNull().default("unknown"),
    terminationStyle: text("termination_style").notNull().default("unknown"),
    compatibilityStatus: text("compatibility_status").notNull().default("probable"),
    confidenceScore: numeric("confidence_score").notNull(),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => datasheetRevisions.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    notes: text("notes"),
  },
  (t) => [
    index("idx_cable_compatibilities_part_id").on(t.partId),
    index("idx_cable_compatibilities_status").on(t.compatibilityStatus, t.partId),
    check(
      "cable_compatibilities_shielding_requirement_check",
      literalCheck(`shielding_requirement IN ('shielded', 'unshielded', 'either', 'unknown')`)
    ),
    check(
      "cable_compatibilities_termination_style_check",
      literalCheck(`termination_style IN ('idc', 'crimp', 'solder', 'unknown')`)
    ),
    check(
      "cable_compatibilities_compatibility_status_check",
      literalCheck(`compatibility_status IN ('verified', 'probable', 'uncertain', 'rejected')`)
    ),
    check(
      "cable_compatibilities_wire_gauge_order_check",
      literalCheck(`wire_gauge_min IS NULL OR wire_gauge_max IS NULL OR wire_gauge_min <= wire_gauge_max`)
    ),
  ]
);

export const connectorFamilyConflicts = pgTable(
  "connector_family_conflicts",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    candidatePartId: text("candidate_part_id").notNull(),
    candidateConnectorFamilyId: text("candidate_connector_family_id").references(() => connectorFamilies.id),
    conflictType: text("conflict_type").notNull(),
    confidenceScore: numeric("confidence_score").notNull(),
    summary: text("summary").notNull(),
    detail: text("detail").notNull(),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.partId, t.candidatePartId, t.conflictType),
    index("idx_connector_family_conflicts_part_id").on(t.partId, t.conflictType, t.lastUpdatedAt),
    index("idx_connector_family_conflicts_candidate_part_id").on(t.candidatePartId, t.lastUpdatedAt),
    check(
      "connector_family_conflicts_conflict_type_check",
      literalCheck(`conflict_type IN ('near_match_variant', 'family_confusion')`)
    ),
  ]
);

export const similarPartRelations = pgTable(
  "similar_part_relations",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    similarPartId: text("similar_part_id")
      .notNull()
      .references(() => parts.id),
    confidenceScore: numeric("confidence_score").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [index("idx_similar_part_relations_part_id").on(t.partId)]
);

export const companionRecommendations = pgTable(
  "companion_recommendations",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    companionPartId: text("companion_part_id")
      .notNull()
      .references(() => parts.id),
    confidenceScore: numeric("confidence_score").notNull(),
    usageContext: text("usage_context").notNull(),
  },
  (t) => [index("idx_companion_recommendations_part_id").on(t.partId)]
);

export const generationWorkflows = pgTable(
  "generation_workflows",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    targetAssetType: text("target_asset_type").notNull(),
    sourceDatasheetRevisionId: text("source_datasheet_revision_id").references(
      () => datasheetRevisions.id
    ),
    sourceAssetId: text("source_asset_id").references(() => assets.id),
    generationStatus: text("generation_status").notNull(),
    confidenceScore: numeric("confidence_score").notNull(),
    outputAssetId: text("output_asset_id").references(() => assets.id),
  },
  (t) => [
    index("idx_generation_workflows_part_id").on(t.partId),
    index("idx_generation_workflows_part_id_target_asset_type").on(
      t.partId,
      t.targetAssetType
    ),
    index("idx_generation_workflows_status_part").on(t.generationStatus, t.partId),
    check(
      "generation_workflows_target_asset_type_check",
      literalCheck(`target_asset_type IN ('footprint', 'symbol', 'three_d_model')`)
    ),
    check(
      "generation_workflows_generation_status_check",
      literalCheck(`generation_status IN ('unavailable', 'available_to_request', 'requested', 'queued', 'processing', 'generated', 'review_required', 'approved', 'failed')`)
    ),
  ]
);

export const generationRequests = pgTable(
  "generation_requests",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    targetAssetType: text("target_asset_type").notNull(),
    sourceDatasheetRevisionId: text("source_datasheet_revision_id").references(
      () => datasheetRevisions.id
    ),
    sourceAssetId: text("source_asset_id").references(() => assets.id),
    requestStatus: text("request_status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    requestedBy: text("requested_by").notNull(),
    workflowId: text("workflow_id").references(() => generationWorkflows.id),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_generation_requests_part_id_target_asset_type").on(
      t.partId,
      t.targetAssetType,
      t.requestedAt
    ),
    index("idx_generation_requests_status_target_requested_at").on(
      t.requestStatus,
      t.targetAssetType,
      t.requestedAt,
      t.id
    ),
    check(
      "generation_requests_target_asset_type_check",
      literalCheck(`target_asset_type IN ('footprint', 'symbol', 'three_d_model')`)
    ),
    check(
      "generation_requests_request_status_check",
      literalCheck(`request_status IN ('requested', 'queued', 'processing', 'generated', 'review_required', 'approved', 'failed')`)
    ),
  ]
);

export const reviewRecords = pgTable(
  "review_records",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    targetType: text("target_type").notNull(),
    assetId: text("asset_id").references(() => assets.id),
    generationWorkflowId: text("generation_workflow_id").references(
      () => generationWorkflows.id
    ),
    outcome: text("outcome").notNull(),
    reviewer: text("reviewer").notNull(),
    notes: text("notes"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_review_records_part_id").on(t.partId, t.reviewedAt),
    index("idx_review_records_asset_id").on(t.assetId, t.reviewedAt),
    index("idx_review_records_generation_workflow_id").on(
      t.generationWorkflowId,
      t.reviewedAt
    ),
    check(
      "review_records_target_type_check",
      literalCheck(`target_type IN ('asset', 'generation_workflow')`)
    ),
    check(
      "review_records_outcome_check",
      literalCheck(`outcome IN ('approved', 'rejected', 'changes_requested')`)
    ),
  ]
);

export const sourceExtractionSignals = pgTable(
  "source_extraction_signals",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    datasheetRevisionId: text("datasheet_revision_id").references(
      () => datasheetRevisions.id
    ),
    assetId: text("asset_id").references(() => assets.id),
    signalType: text("signal_type").notNull(),
    extractionStatus: text("extraction_status").notNull(),
    confidenceScore: numeric("confidence_score").notNull(),
    extractionSource: text("extraction_source").notNull(),
    notes: text("notes"),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_source_extraction_signals_part_type").on(t.partId, t.signalType),
    index("idx_source_extraction_signals_source_record").on(t.sourceRecordId),
    index("idx_source_extraction_signals_datasheet").on(t.datasheetRevisionId),
    index("idx_source_extraction_signals_asset").on(t.assetId),
    index("idx_source_extraction_signals_generation_lookup").on(
      t.partId,
      t.signalType,
      t.extractionStatus,
      t.confidenceScore,
      t.lastUpdatedAt
    ),
    check(
      "source_extraction_signals_signal_type_check",
      literalCheck(`signal_type IN ('package_mechanical_dimensions', 'pin_table', 'mechanical_drawing')`)
    ),
    check(
      "source_extraction_signals_extraction_status_check",
      literalCheck(`extraction_status IN ('available', 'needs_review', 'not_available')`)
    ),
    check(
      "source_extraction_signals_extraction_source_check",
      literalCheck(`extraction_source IN ('provider_structured_metadata', 'datasheet_metadata', 'asset_reference', 'manual_internal')`)
    ),
  ]
);

export const assetValidationRecords = pgTable(
  "asset_validation_records",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    validationStatus: text("validation_status").notNull(),
    validationType: text("validation_type").notNull(),
    validationNotes: text("validation_notes"),
    validatedAt: timestamp("validated_at", { withTimezone: true }).notNull(),
    validator: text("validator").notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_asset_validation_records_part_id").on(t.partId, t.validatedAt),
    index("idx_asset_validation_records_asset_id").on(t.assetId, t.validatedAt),
    index("idx_asset_validation_records_type").on(
      t.assetId,
      t.validationType,
      t.validationStatus
    ),
    index("idx_asset_validation_records_validated_at").on(t.validatedAt, t.id),
    check(
      "asset_validation_records_validation_status_check",
      literalCheck(`validation_status IN ('verified', 'needs_review', 'not_validated', 'failed')`)
    ),
    check(
      "asset_validation_records_validation_type_check",
      literalCheck(`validation_type IN ('file_integrity', 'footprint_geometry', 'symbol_pin_mapping', 'three_d_geometry', 'manual_engineering_review')`)
    ),
  ]
);

export const assetPromotionAudits = pgTable(
  "asset_promotion_audits",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    priorExportStatus: text("prior_export_status").notNull(),
    newExportStatus: text("new_export_status").notNull(),
    promotionOutcome: text("promotion_outcome").notNull(),
    blockerReasons: text("blocker_reasons").array().notNull().default([]),
    validationRecordId: text("validation_record_id").references(
      () => assetValidationRecords.id
    ),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_asset_promotion_audits_part_id").on(t.partId, t.createdAt),
    index("idx_asset_promotion_audits_asset_id").on(t.assetId, t.createdAt),
    index("idx_asset_promotion_audits_outcome_created_at").on(
      t.promotionOutcome,
      t.createdAt,
      t.id
    ),
    check(
      "asset_promotion_audits_prior_export_status_check",
      literalCheck(`prior_export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export')`)
    ),
    check(
      "asset_promotion_audits_new_export_status_check",
      literalCheck(`new_export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export')`)
    ),
    check(
      "asset_promotion_audits_promotion_outcome_check",
      literalCheck(`promotion_outcome IN ('promoted', 'denied')`)
    ),
  ]
);

export const partReadinessSummaries = pgTable(
  "part_readiness_summaries",
  {
    partId: text("part_id")
      .primaryKey()
      .references(() => parts.id),
    readinessStatus: text("readiness_status").notNull(),
    identityStatus: text("identity_status").notNull(),
    connectorClass: text("connector_class").notNull(),
    blockerCount: integer("blocker_count").notNull().default(0),
    blockerSummary: text("blocker_summary").array().notNull().default([]),
    recommendedActions: text("recommended_actions").array().notNull().default([]),
    detail: text("detail").notNull(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_part_readiness_summaries_status").on(t.readinessStatus, t.lastEvaluatedAt),
    index("idx_part_readiness_summaries_connector_class").on(t.connectorClass, t.lastEvaluatedAt),
    check(
      "part_readiness_summaries_status_check",
      literalCheck(`readiness_status IN ('ready_for_export_review', 'needs_attention', 'blocked', 'unknown')`)
    ),
    check(
      "part_readiness_summaries_identity_status_check",
      literalCheck(`identity_status IN ('confirmed', 'low_confidence', 'unknown')`)
    ),
    check(
      "part_readiness_summaries_connector_class_check",
      literalCheck(`connector_class IN ('connector', 'accessory', 'tooling', 'cable', 'non_connector')`)
    ),
    check("part_readiness_summaries_blocker_count_check", literalCheck(`blocker_count >= 0`)),
  ]
);

export const partApprovals = pgTable(
  "part_approvals",
  {
    partId: text("part_id")
      .primaryKey()
      .references(() => parts.id),
    approvalStatus: text("approval_status").notNull(),
    summary: text("summary").notNull(),
    detail: text("detail").notNull(),
    evidence: text("evidence").array().notNull().default([]),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_part_approvals_status").on(t.approvalStatus, t.lastUpdatedAt),
    check(
      "part_approvals_status_check",
      literalCheck(`approval_status IN ('approved', 'pending_review', 'not_requested', 'not_applicable')`)
    ),
  ]
);

export const partIssues = pgTable(
  "part_issues",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    issueCode: text("issue_code").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull().default("open"),
    assignedTo: text("assigned_to"),
    resolutionNotes: text("resolution_notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    summary: text("summary").notNull(),
    detail: text("detail").notNull(),
    source: text("source").notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.partId, t.issueCode),
    index("idx_part_issues_part_id").on(t.partId, t.severity, t.lastUpdatedAt),
    index("idx_part_issues_code").on(t.issueCode, t.lastUpdatedAt),
    index("idx_part_issues_status").on(t.status, t.lastUpdatedAt),
    check(
      "part_issues_code_check",
      literalCheck(`issue_code IN ('low_confidence_identity', 'pending_approval', 'missing_verified_cad', 'missing_datasheet', 'missing_connector_mate', 'missing_connector_accessories', 'connector_low_confidence', 'lifecycle_risk', 'source_conflict', 'duplicate_candidate')`)
    ),
    check("part_issues_severity_check", literalCheck(`severity IN ('error', 'warning')`)),
    check("part_issues_status_check", literalCheck(`status IN ('open', 'in_review', 'resolved', 'ignored')`)),
  ]
);

export const partSourceReconciliations = pgTable(
  "part_source_reconciliations",
  {
    partId: text("part_id")
      .primaryKey()
      .references(() => parts.id),
    preferredSourceRecordId: text("preferred_source_record_id").references(() => sourceRecords.id),
    resolutionStatus: text("resolution_status").notNull().default("unreviewed"),
    notes: text("notes"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_part_source_reconciliations_status").on(t.resolutionStatus, t.updatedAt),
    check(
      "part_source_reconciliations_status_check",
      literalCheck(`resolution_status IN ('unreviewed', 'canonical_source_selected', 'mixed_sources_accepted')`)
    ),
  ]
);

export const partRiskFlags = pgTable(
  "part_risk_flags",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    riskCode: text("risk_code").notNull(),
    label: text("label").notNull(),
    detail: text("detail").notNull(),
    tone: text("tone").notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.partId, t.riskCode),
    index("idx_part_risk_flags_part_id").on(t.partId, t.tone, t.lastUpdatedAt),
    index("idx_part_risk_flags_code").on(t.riskCode, t.lastUpdatedAt),
    check(
      "part_risk_flags_code_check",
      literalCheck(`risk_code IN ('lifecycle_not_active', 'generated_assets_present', 'source_conflict', 'connector_low_confidence', 'partial_readiness_data')`)
    ),
    check("part_risk_flags_tone_check", literalCheck(`tone IN ('review', 'danger')`)),
  ]
);

/** projects stores planned project-memory roots without implying BOM workflows are complete. */
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    projectKey: text("project_key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    owner: text("owner"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_projects_project_key").on(t.projectKey),
    index("idx_projects_status_updated_at").on(t.status, t.updatedAt),
    check(
      "projects_status_check",
      literalCheck(`status IN ('active', 'archived', 'prototype', 'production', 'deprecated')`)
    ),
  ]
);

/** projectRevisions stores project revision context for planned BOM and where-used memory. */
export const projectRevisions = pgTable(
  "project_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    revisionLabel: text("revision_label").notNull(),
    revisionStatus: text("revision_status").notNull().default("draft"),
    sourceReference: text("source_reference"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.projectId, t.revisionLabel),
    index("idx_project_revisions_project_status").on(t.projectId, t.revisionStatus, t.updatedAt),
    check(
      "project_revisions_status_check",
      literalCheck(`revision_status IN ('draft', 'in_review', 'released', 'superseded', 'archived')`)
    ),
  ]
);

/** bomImports preserves BOM file and column-mapping provenance before any row matching happens. */
export const bomImports = pgTable(
  "bom_imports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    projectRevisionId: text("project_revision_id")
      .notNull()
      .references(() => projectRevisions.id),
    sourceFilename: text("source_filename").notNull(),
    sourceFormat: text("source_format").notNull().default("csv"),
    storageKey: text("storage_key"),
    importStatus: text("import_status").notNull().default("uploaded"),
    columnMapping: jsonb("column_mapping").notNull().default({}),
    importSummary: jsonb("import_summary").notNull().default({}),
    importedBy: text("imported_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_bom_imports_project_revision").on(t.projectId, t.projectRevisionId, t.createdAt),
    index("idx_bom_imports_status").on(t.importStatus, t.updatedAt),
    check(
      "bom_imports_source_format_check",
      literalCheck(`source_format IN ('csv', 'xlsx', 'json', 'eda_export', 'manual')`)
    ),
    check(
      "bom_imports_status_check",
      literalCheck(`import_status IN ('uploaded', 'mapping_required', 'mapped', 'processing', 'processed', 'failed')`)
    ),
  ]
);

/** bomLines stores original and mapped BOM row data while keeping weak matches explicit. */
export const bomLines = pgTable(
  "bom_lines",
  {
    id: text("id").primaryKey(),
    bomImportId: text("bom_import_id")
      .notNull()
      .references(() => bomImports.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    projectRevisionId: text("project_revision_id")
      .notNull()
      .references(() => projectRevisions.id),
    rowNumber: integer("row_number").notNull(),
    designators: text("designators").array().notNull().default([]),
    quantity: numeric("quantity"),
    rawMpn: text("raw_mpn"),
    rawManufacturer: text("raw_manufacturer"),
    rawDescription: text("raw_description"),
    rawSupplierReference: text("raw_supplier_reference"),
    rawNotes: text("raw_notes"),
    rawRowPayload: jsonb("raw_row_payload").notNull().default({}),
    matchedPartId: text("matched_part_id").references(() => parts.id),
    matchStatus: text("match_status").notNull().default("unmatched"),
    matchConfidenceScore: numeric("match_confidence_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.bomImportId, t.rowNumber),
    index("idx_bom_lines_import_status").on(t.bomImportId, t.matchStatus, t.rowNumber),
    index("idx_bom_lines_project_revision").on(t.projectId, t.projectRevisionId, t.rowNumber),
    index("idx_bom_lines_matched_part").on(t.matchedPartId, t.projectId, t.projectRevisionId),
    check("bom_lines_row_number_check", literalCheck(`row_number > 0`)),
    check(
      "bom_lines_match_status_check",
      literalCheck(`match_status IN ('unmatched', 'matched', 'ambiguous', 'weak_match', 'ignored')`)
    ),
    check(
      "bom_lines_match_confidence_score_check",
      literalCheck(`match_confidence_score IS NULL OR (match_confidence_score >= 0 AND match_confidence_score <= 1)`)
    ),
  ]
);

/** projectPartUsages records confirmed part use for planned where-used history. */
export const projectPartUsages = pgTable(
  "project_part_usages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    projectRevisionId: text("project_revision_id")
      .notNull()
      .references(() => projectRevisions.id),
    bomLineId: text("bom_line_id").references(() => bomLines.id),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    usageContext: text("usage_context"),
    designators: text("designators").array().notNull().default([]),
    quantity: numeric("quantity"),
    usageStatus: text("usage_status").notNull().default("proposed"),
    approvalSnapshot: jsonb("approval_snapshot").notNull().default({}),
    readinessSnapshot: jsonb("readiness_snapshot").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_project_part_usages_part").on(t.partId, t.usageStatus, t.updatedAt),
    index("idx_project_part_usages_project_revision").on(t.projectId, t.projectRevisionId, t.usageStatus),
    index("idx_project_part_usages_bom_line").on(t.bomLineId),
    check(
      "project_part_usages_status_check",
      literalCheck(`usage_status IN ('proposed', 'in_review', 'used', 'released', 'deprecated')`)
    ),
  ]
);

/** projectRevisionApprovalGates stores explicit BOM diff review gates without mutating part trust. */
export const projectRevisionApprovalGates = pgTable(
  "project_revision_approval_gates",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    fromProjectRevisionId: text("from_project_revision_id")
      .notNull()
      .references(() => projectRevisions.id),
    toProjectRevisionId: text("to_project_revision_id")
      .notNull()
      .references(() => projectRevisions.id),
    gateStatus: text("gate_status").notNull().default("pending_review"),
    diffFingerprint: text("diff_fingerprint").notNull(),
    diffSummary: jsonb("diff_summary").notNull().default({}),
    decisionNotes: text("decision_notes").notNull().default(""),
    createdBy: text("created_by").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.projectId, t.fromProjectRevisionId, t.toProjectRevisionId, t.diffFingerprint),
    index("idx_project_revision_approval_gates_project").on(t.projectId, t.updatedAt),
    index("idx_project_revision_approval_gates_target").on(t.toProjectRevisionId, t.gateStatus, t.updatedAt),
    check(
      "project_revision_approval_gates_status_check",
      literalCheck(`gate_status IN ('pending_review', 'approved', 'changes_requested')`)
    ),
  ]
);

/** circuitBlocks stores reusable circuit knowledge as structured engineering memory. */
export const circuitBlocks = pgTable(
  "circuit_blocks",
  {
    id: text("id").primaryKey(),
    blockKey: text("block_key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    blockType: text("block_type").notNull().default("other"),
    owner: text("owner"),
    status: text("status").notNull().default("draft"),
    reuseScope: text("reuse_scope").notNull().default(""),
    constraints: jsonb("constraints").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_circuit_blocks_block_key").on(t.blockKey),
    index("idx_circuit_blocks_status_updated_at").on(t.status, t.updatedAt),
    index("idx_circuit_blocks_type_status").on(t.blockType, t.status, t.updatedAt),
    check(
      "circuit_blocks_block_type_check",
      literalCheck(`block_type IN ('power', 'mcu_support', 'interface', 'protection', 'connector_set', 'sensor_front_end', 'other')`)
    ),
    check(
      "circuit_blocks_status_check",
      literalCheck(`status IN ('draft', 'in_review', 'approved', 'restricted', 'deprecated')`)
    ),
  ]
);

/** circuitBlockParts stores the part roles required by a reusable circuit block. */
export const circuitBlockParts = pgTable(
  "circuit_block_parts",
  {
    id: text("id").primaryKey(),
    circuitBlockId: text("circuit_block_id")
      .notNull()
      .references(() => circuitBlocks.id),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    role: text("role").notNull(),
    quantity: numeric("quantity"),
    isRequired: boolean("is_required").notNull().default(true),
    substitutionPolicy: text("substitution_policy").notNull().default("exact_required"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.circuitBlockId, t.partId, t.role),
    index("idx_circuit_block_parts_block_required").on(t.circuitBlockId, t.isRequired, t.role),
    index("idx_circuit_block_parts_part").on(t.partId, t.circuitBlockId),
    check(
      "circuit_block_parts_substitution_policy_check",
      literalCheck(`substitution_policy IN ('exact_required', 'approved_alternate_allowed', 'equivalent_allowed', 'do_not_substitute')`)
    ),
    check("circuit_block_parts_quantity_check", literalCheck(`quantity IS NULL OR quantity > 0`)),
  ]
);

/** evidenceAttachments stores reviewable decision evidence without changing approval or export state. */
export const evidenceAttachments = pgTable(
  "evidence_attachments",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    evidenceType: text("evidence_type").notNull(),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    storageKey: text("storage_key"),
    fileHash: text("file_hash"),
    mimeType: text("mime_type"),
    notes: text("notes"),
    provenance: text("provenance").notNull().default("manual_internal"),
    reviewStatus: text("review_status").notNull().default("unreviewed"),
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_evidence_attachments_target").on(t.targetType, t.targetId, t.createdAt),
    index("idx_evidence_attachments_review").on(t.reviewStatus, t.updatedAt),
    check(
      "evidence_attachments_target_type_check",
      literalCheck(`target_type IN ('part', 'asset', 'project', 'bom_import', 'bom_line', 'project_part_usage', 'risk_finding', 'circuit_block', 'circuit_block_part')`)
    ),
    check(
      "evidence_attachments_evidence_type_check",
      literalCheck(`evidence_type IN ('note', 'link', 'file')`)
    ),
    check(
      "evidence_attachments_review_status_check",
      literalCheck(`review_status IN ('unreviewed', 'accepted', 'rejected', 'superseded')`)
    ),
    check(
      "evidence_attachments_required_reference_check",
      literalCheck(`(evidence_type = 'link' AND source_url IS NOT NULL) OR (evidence_type = 'file' AND storage_key IS NOT NULL) OR (evidence_type = 'note' AND notes IS NOT NULL)`)
    ),
  ]
);

/** followUpRecords stores assignable work derived from computed BOM and circuit gaps. */
export const followUpRecords = pgTable(
  "follow_up_records",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceFindingId: text("source_finding_id").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    nextAction: text("next_action").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull().default("open"),
    assignedTo: text("assigned_to"),
    sourceInputs: jsonb("source_inputs").notNull().default(sql`'[]'::jsonb`),
    evidenceAttachmentIds: jsonb("evidence_attachment_ids").notNull().default(sql`'[]'::jsonb`),
    resolutionNotes: text("resolution_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique().on(t.targetType, t.targetId, t.sourceType, t.sourceFindingId),
    index("idx_follow_up_records_target").on(t.targetType, t.targetId, t.status, t.updatedAt),
    index("idx_follow_up_records_status").on(t.status, t.severity, t.updatedAt),
    index("idx_follow_up_records_source").on(t.sourceType, t.sourceFindingId),
    check("follow_up_records_target_type_check", literalCheck(`target_type IN ('project', 'circuit_block')`)),
    check("follow_up_records_source_type_check", literalCheck(`source_type IN ('bom_health', 'circuit_block_gap')`)),
    check("follow_up_records_severity_check", literalCheck(`severity IN ('review', 'danger')`)),
    check("follow_up_records_status_check", literalCheck(`status IN ('open', 'in_progress', 'resolved', 'dismissed')`)),
  ]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    check("users_role_check", literalCheck(`role IN ('admin', 'user')`)),
  ]
);

/** auditEvents stores API user-action facts without request bodies or secrets. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    method: text("method").notNull(),
    path: text("path").notNull(),
    operation: text("operation").notNull(),
    statusCode: integer("status_code").notNull(),
    outcome: text("outcome").notNull(),
    requestIpHash: text("request_ip_hash"),
    userAgentHash: text("user_agent_hash"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("idx_audit_events_occurred_at").on(t.occurredAt, t.id),
    index("idx_audit_events_actor").on(t.actorId, t.occurredAt),
    index("idx_audit_events_target").on(t.targetType, t.targetId, t.occurredAt),
    index("idx_audit_events_action").on(t.action, t.outcome, t.occurredAt),
    index("idx_audit_events_request").on(t.requestId),
    check("audit_events_actor_role_check", literalCheck(`actor_role IS NULL OR actor_role IN ('admin', 'user')`)),
    check("audit_events_status_code_check", literalCheck(`status_code >= 100 AND status_code <= 599`)),
    check("audit_events_outcome_check", literalCheck(`outcome IN ('succeeded', 'failed', 'denied')`)),
  ]
);

/** exportBundles records manifest-first export package outputs for verified project part assets. */
export const exportBundles = pgTable(
  "export_bundles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    revisionLabel: text("revision_label"),
    bundleFormat: text("bundle_format").notNull(),
    storageKey: text("storage_key"),
    manifest: jsonb("manifest").notNull().default({}),
    partCount: integer("part_count").notNull().default(0),
    includedAssetCount: integer("included_asset_count").notNull().default(0),
    omittedAssetCount: integer("omitted_asset_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_export_bundles_project").on(t.projectId, t.createdAt),
    index("idx_export_bundles_format").on(t.bundleFormat, t.createdAt),
    check("export_bundles_format_check", literalCheck(`bundle_format IN ('altium', 'solidworks', 'neutral')`)),
  ]
);
