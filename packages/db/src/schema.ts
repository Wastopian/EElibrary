import {
  check,
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
    check("source_records_import_status_check", `import_status IN ('imported', 'failed')`),
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
      `asset_state IN ('missing', 'referenced', 'downloaded', 'validated', 'failed')`
    ),
    check(
      "assets_provenance_check",
      `provenance IN ('official', 'trusted_external', 'generated', 'manual_internal')`
    ),
    check(
      "assets_availability_status_check",
      `availability_status IN ('missing', 'referenced', 'downloaded', 'validated', 'failed')`
    ),
    check(
      "assets_review_status_check",
      `review_status IN ('not_reviewed', 'review_required', 'approved', 'rejected', 'changes_requested')`
    ),
    check(
      "assets_export_status_check",
      `export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export')`
    ),
    check(
      "assets_asset_status_check",
      `asset_status IN ('missing', 'referenced', 'downloaded', 'validated', 'failed', 'reviewed', 'verified_for_export')`
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
      `pin_table_status IN ('not_available', 'available', 'needs_review')`
    ),
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
    confidenceScore: numeric("confidence_score").notNull(),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => datasheetRevisions.id),
    notes: text("notes"),
  },
  (t) => [
    index("idx_mate_relations_part_id").on(t.partId),
    check(
      "mate_relations_relationship_type_check",
      `relationship_type IN ('best_mate', 'alternate_mate')`
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
    confidenceScore: numeric("confidence_score").notNull(),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => datasheetRevisions.id),
    notes: text("notes"),
  },
  (t) => [
    index("idx_accessory_requirements_part_id").on(t.partId),
    check(
      "accessory_requirements_relationship_type_check",
      `relationship_type IN ('requires_accessory', 'optional_accessory', 'tooling_requirement')`
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
    confidenceScore: numeric("confidence_score").notNull(),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => datasheetRevisions.id),
    notes: text("notes"),
  },
  (t) => [index("idx_cable_compatibilities_part_id").on(t.partId)]
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
      `target_asset_type IN ('footprint', 'symbol', 'three_d_model')`
    ),
    check(
      "generation_workflows_generation_status_check",
      `generation_status IN ('unavailable', 'available_to_request', 'requested', 'queued', 'processing', 'generated', 'review_required', 'approved', 'failed')`
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
      `target_asset_type IN ('footprint', 'symbol', 'three_d_model')`
    ),
    check(
      "generation_requests_request_status_check",
      `request_status IN ('requested', 'queued', 'processing', 'generated', 'review_required', 'approved', 'failed')`
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
      `target_type IN ('asset', 'generation_workflow')`
    ),
    check(
      "review_records_outcome_check",
      `outcome IN ('approved', 'rejected', 'changes_requested')`
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
      `signal_type IN ('package_mechanical_dimensions', 'pin_table', 'mechanical_drawing')`
    ),
    check(
      "source_extraction_signals_extraction_status_check",
      `extraction_status IN ('available', 'needs_review', 'not_available')`
    ),
    check(
      "source_extraction_signals_extraction_source_check",
      `extraction_source IN ('provider_structured_metadata', 'datasheet_metadata', 'asset_reference', 'manual_internal')`
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
      `validation_status IN ('verified', 'needs_review', 'not_validated', 'failed')`
    ),
    check(
      "asset_validation_records_validation_type_check",
      `validation_type IN ('file_integrity', 'footprint_geometry', 'symbol_pin_mapping', 'three_d_geometry', 'manual_engineering_review')`
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
      `prior_export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export')`
    ),
    check(
      "asset_promotion_audits_new_export_status_check",
      `new_export_status IN ('not_exportable', 'partially_exportable', 'verified_for_export')`
    ),
    check(
      "asset_promotion_audits_promotion_outcome_check",
      `promotion_outcome IN ('promoted', 'denied')`
    ),
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
    check("users_role_check", `role IN ('admin', 'user')`),
  ]
);
