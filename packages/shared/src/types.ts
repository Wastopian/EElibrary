/**
 * File header: Defines the shared EE Library domain types from docs/DATA_MODEL.md.
 */

/** Lifecycle values keep lifecycle uncertainty explicit instead of hiding it in strings. */
export type LifecycleStatus = "active" | "not_recommended" | "obsolete" | "unknown";

/** Normalized units follow the unit policy from docs/DATA_MODEL.md. */
export type MetricUnit = "V" | "A" | "F" | "H" | "ohm" | "mm" | "Hz" | "deg C";

/** Asset kinds match the MVP asset registry without naming a specific provider. */
export type AssetType = "datasheet" | "footprint" | "symbol" | "three_d_model" | "mechanical_drawing";

/** EngineeringAssetClass names first-class asset classes used by the detail API. */
export type EngineeringAssetClass = AssetType;

/** File formats describe storage content without implying availability. */
export type FileFormat = "pdf" | "png" | "jpg" | "jpeg" | "webp" | "step" | "glb" | "gltf" | "kicad_mod" | "kicad_sym" | "dxf" | "unknown";

/**
 * AssetPreviewArtifactFormat names the formats the inline previewer knows how to render in a
 * browser. Kept narrower than FileFormat so the preview channel cannot silently smuggle a
 * non-embeddable format past the conversion gate.
 */
export type AssetPreviewArtifactFormat = "glb" | "gltf" | "png" | "jpg" | "jpeg" | "webp" | "pdf";

/**
 * AssetPreviewArtifactSource records where the rendering bytes came from. `source_native`
 * mirrors `storage_key` for assets whose source format is already embeddable (PDF, PNG/JPG/etc).
 * `converter_step_to_gltf` marks bytes produced by a worker conversion job. `manual_upload`
 * leaves room for a future operator-uploaded preview without conflating it with the source.
 */
export type AssetPreviewArtifactSource = "source_native" | "converter_step_to_gltf" | "manual_upload";

/** License modes prevent the UI from promising redistribution when it is not known. */
export type LicenseMode = "metadata_only" | "redistribution_allowed" | "unknown";

/** Provenance makes source trust explicit without assuming correctness. */
export type AssetProvenance = "official" | "trusted_external" | "generated" | "manual_internal";

/** AssetAvailabilityStatus answers whether an asset actually exists locally or only as a reference. */
export type AssetAvailabilityStatus = "missing" | "referenced" | "downloaded" | "validated" | "failed";

/** AssetReviewStatus keeps engineering review separate from storage and export readiness. */
export type AssetReviewStatus = "not_reviewed" | "review_required" | "approved" | "rejected" | "changes_requested";

/** AssetExportStatus prevents vague export claims when only partial or referenced evidence exists. */
export type AssetExportStatus = "not_exportable" | "partially_exportable" | "verified_for_export";

/** AssetState is the legacy storage-field name retained while migrations carry compatibility columns. */
export type AssetState = AssetAvailabilityStatus;

/** AssetStatus is the legacy combined status retained for older fixtures and rows. */
export type AssetStatus = AssetAvailabilityStatus | "reviewed" | "verified_for_export";

/** Validation status describes trust in the asset or metadata. */
export type ValidationStatus = "verified" | "needs_review" | "not_validated" | "failed";

/** AssetValidationType names reviewable evidence without claiming a broad validation engine. */
export type AssetValidationType = "file_integrity" | "footprint_geometry" | "symbol_pin_mapping" | "three_d_geometry" | "manual_engineering_review";

/** AssetPromotionOutcome records whether an export-promotion attempt succeeded or was denied. */
export type AssetPromotionOutcome = "promoted" | "denied";

/** Preview status describes whether a visual preview can be rendered. */
export type PreviewStatus = "ready" | "pending" | "not_available";

/** Connector relationship types model mating and accessory intelligence. */
export type ConnectorRelationshipType =
  | "best_mate"
  | "alternate_mate"
  | "requires_accessory"
  | "optional_accessory"
  | "supports_cable"
  | "tooling_requirement";

/** ConnectorClass keeps connector-specific filtering explicit without leaking provider categories into the UI. */
export type ConnectorClass = "connector" | "accessory" | "tooling" | "cable" | "non_connector";

/** ConnectorRelationCompatibilityStatus keeps mate and accessory certainty explicit instead of flattening it into one score. */
export type ConnectorRelationCompatibilityStatus = "verified" | "probable" | "uncertain" | "rejected";

/** ConnectorEvidenceKind keeps direct provider evidence distinct from weaker family-inference paths. */
export type ConnectorEvidenceKind = "provider_direct" | "datasheet_reference" | "family_inference" | "manual_review" | "catalog_fixture";

/** CableShieldingRequirement keeps cable-side shielding assumptions explicit instead of flattening them into notes. */
export type CableShieldingRequirement = "shielded" | "unshielded" | "either" | "unknown";

/** CableTerminationStyle keeps cable-side termination assumptions queryable and reviewable. */
export type CableTerminationStyle = "idc" | "crimp" | "solder" | "unknown";

/** CableCompatibilityStatus keeps cable support honest when the evidence is tentative or rejected. */
export type CableCompatibilityStatus = "verified" | "probable" | "uncertain" | "rejected";

/** PartIdentityStatus keeps record identity confidence explicit instead of inferring certainty from one field. */
export type PartIdentityStatus = "confirmed" | "low_confidence" | "unknown";

/** PartReadinessStatus is the whole-part readiness state exposed by API and UI. */
export type PartReadinessStatus = "ready_for_export_review" | "needs_attention" | "blocked" | "unknown";

/** PartApprovalStatus keeps part approval separate from asset review and export verification. */
export type PartApprovalStatus = "approved" | "pending_review" | "not_requested" | "not_applicable";

/** PartIssueSeverity distinguishes hard blockers from follow-up work. */
export type PartIssueSeverity = "error" | "warning";

/** PartIssueWorkflowStatus keeps operational queue workflow separate from the underlying evidence. */
export type PartIssueWorkflowStatus = "open" | "in_review" | "resolved" | "ignored";

/** PartIssueCode names backend-derived part-level queue and blocker categories. */
export type PartIssueCode =
  | "low_confidence_identity"
  | "pending_approval"
  | "missing_verified_cad"
  | "missing_datasheet"
  | "missing_connector_mate"
  | "missing_connector_accessories"
  | "connector_low_confidence"
  | "lifecycle_risk"
  | "source_conflict"
  | "duplicate_candidate";

/** PartRiskFlagCode names compact risk chips shown in detail and admin surfaces. */
export type PartRiskFlagCode =
  | "lifecycle_not_active"
  | "generated_assets_present"
  | "source_conflict"
  | "connector_low_confidence"
  | "partial_readiness_data";

/** Generation targets for datasheet-driven CAD creation workflows. */
export type GenerationTargetAssetType = "footprint" | "symbol" | "three_d_model";

/** Datasheet extraction status tracks reviewed source material without claiming full PDF parsing. */
export type DatasheetExtractionStatus = "not_available" | "available" | "needs_review";

/** Workflow status for generated asset pipelines from requestability through review. */
export type GenerationWorkflowState = "unavailable" | "available_to_request" | "requested" | "queued" | "processing" | "generated" | "review_required" | "approved" | "failed";

/** GenerationStatus keeps existing workflow fields aligned with the Phase 3B state model. */
export type GenerationStatus = GenerationWorkflowState;

/** GenerationRequestStatus is the persisted state for user-created generation requests. */
export type GenerationRequestStatus = Exclude<GenerationWorkflowState, "unavailable" | "available_to_request">;

/** ReviewTargetType names the durable entities that can receive engineering review outcomes. */
export type ReviewTargetType = "asset" | "generation_workflow";

/** ReviewOutcome records explicit reviewer decisions without inferring export verification. */
export type ReviewOutcome = "approved" | "rejected" | "changes_requested";

/** ReviewState is the resolved status shown by API/UI for reviewable targets. */
export type ReviewState = "pending_review" | "approved" | "rejected" | "changes_requested" | "verified_for_export" | "not_required";

/** SourceImportStatus makes provider import outcomes queryable without provider-specific strings. */
export type SourceImportStatus = "imported" | "failed";

/** ProviderLookupMatchType keeps Phase 1 provider lookup results strictly exact-match only. */
export type ProviderLookupMatchType = "exact_mpn" | "exact_provider_part_id";

/** ProviderAcquisitionJobStatus is the durable queued-to-terminal lifecycle for provider acquisition. */
export type ProviderAcquisitionJobStatus = "queued" | "running" | "succeeded" | "failed";

/** ProviderAcquisitionJobEventType keeps the first queued-job event stream coarse and explicit. */
export type ProviderAcquisitionJobEventType = ProviderAcquisitionJobStatus;

/** PartAcquisitionSummaryState keeps part-detail acquisition history explicit without changing search records. */
export type PartAcquisitionSummaryState = "available" | "legacy_source_only" | "not_recorded" | "unavailable";

/** ProviderEnrichmentJobType keeps Phase 2C.1 explicit while only datasheet capture is supported. */
export type ProviderEnrichmentJobType = "datasheet_capture";

/** ProviderEnrichmentJobStatus is the durable queued-to-terminal lifecycle for provider enrichment work. */
export type ProviderEnrichmentJobStatus = "queued" | "running" | "succeeded" | "failed";

/** ProviderEnrichmentJobEventType keeps enrichment lifecycle events coarse and aligned with job status. */
export type ProviderEnrichmentJobEventType = ProviderEnrichmentJobStatus;

/** PartEnrichmentSummaryState keeps part-detail enrichment visibility explicit without changing readiness truth. */
export type PartEnrichmentSummaryState = "available" | "not_recorded" | "unavailable";

/** SourceReconciliationStatus records how an operator has handled mixed provider/source evidence. */
export type SourceReconciliationStatus = "unreviewed" | "canonical_source_selected" | "mixed_sources_accepted";

/** ProjectStatus names planned project-memory lifecycle states without implying BOM workflows are shipped. */
export type ProjectStatus = "active" | "archived" | "prototype" | "production" | "deprecated";

/** ProjectRevisionStatus keeps released and in-review project revisions distinct for future where-used views. */
export type ProjectRevisionStatus = "draft" | "in_review" | "released" | "superseded" | "archived";

/** BomSourceFormat records the source file family for a planned BOM import. */
export type BomSourceFormat = "csv" | "xlsx" | "json" | "eda_export" | "manual";

/** BomImportStatus tracks intake progress before matching rows to confirmed internal parts. */
export type BomImportStatus = "uploaded" | "mapping_required" | "mapped" | "processing" | "processed" | "failed";

/** BomLineMatchStatus prevents weak or ambiguous BOM rows from becoming confirmed usage. */
export type BomLineMatchStatus = "unmatched" | "matched" | "ambiguous" | "weak_match" | "ignored";

/** ProjectPartUsageStatus distinguishes historical context from released, reusable project usage. */
export type ProjectPartUsageStatus = "proposed" | "in_review" | "used" | "released" | "deprecated";

/** CircuitBlockType names reusable circuit categories without forcing provider taxonomy into the UI. */
export type CircuitBlockType = "power" | "mcu_support" | "interface" | "protection" | "connector_set" | "sensor_front_end" | "other";

/** CircuitBlockStatus keeps block review state separate from part approval and export readiness. */
export type CircuitBlockStatus = "draft" | "in_review" | "approved" | "restricted" | "deprecated";

/** CircuitBlockPartSubstitutionPolicy records how strictly one role must use its linked part. */
export type CircuitBlockPartSubstitutionPolicy = "exact_required" | "approved_alternate_allowed" | "equivalent_allowed" | "do_not_substitute";

/** ProjectBomRiskFindingCode names explainable project BOM health gaps. */
export type ProjectBomRiskFindingCode =
  | "unmatched_bom_rows"
  | "ambiguous_or_weak_matches"
  | "approval_gap"
  | "lifecycle_risk"
  | "lifecycle_risk_changed"
  | "missing_verified_cad"
  | "connector_buildability_gap"
  | "missing_evidence";

/** ProjectBomRiskSeverity keeps risk badges direct without opaque scoring. */
export type ProjectBomRiskSeverity = "review" | "danger";

/** EvidenceTargetType names durable entities that can receive engineering evidence. */
export type EvidenceTargetType = "part" | "asset" | "project" | "bom_import" | "bom_line" | "project_part_usage" | "risk_finding" | "circuit_block" | "circuit_block_part";

/** EvidenceAttachmentType distinguishes metadata-only notes, links, and stored files. */
export type EvidenceAttachmentType = "note" | "link" | "file";

/** EvidenceReviewStatus keeps evidence review separate from validation, approval, and export. */
export type EvidenceReviewStatus = "unreviewed" | "accepted" | "rejected" | "superseded";

/** EvidenceStorageState distinguishes link-only, note-only, and file-backed evidence rows. */
export type EvidenceStorageState = "file_backed" | "link_only" | "note_only";

/** FollowUpTargetType names objects that can own assignable follow-up work. */
export type FollowUpTargetType = "project" | "circuit_block";

/** FollowUpSourceType names computed sources that can seed persistent follow-up records. */
export type FollowUpSourceType = "bom_health" | "circuit_block_gap";

/** FollowUpStatus tracks work lifecycle without changing readiness or approval state. */
export type FollowUpStatus = "open" | "in_progress" | "resolved" | "dismissed";

/** FollowUpSeverity mirrors explainable finding severity without opaque scoring. */
export type FollowUpSeverity = ProjectBomRiskSeverity;

/** SourceExtractionSignalType names explicit source material extracted for CAD recovery. */
export type SourceExtractionSignalType = "package_mechanical_dimensions" | "pin_table" | "mechanical_drawing";

/** SourceExtractionStatus keeps extraction evidence honest and review-aware. */
export type SourceExtractionStatus = "available" | "needs_review" | "not_available";

/** SourceExtractionSource identifies the source class without leaking provider-specific parsers. */
export type SourceExtractionSource = "provider_structured_metadata" | "datasheet_metadata" | "asset_reference" | "manual_internal";

/** DocumentControlType names controlled document classes without adding provider-specific document names. */
export type DocumentControlType = "datasheet" | "mechanical_drawing" | "controlled_drawing" | "specification" | "other";

/** DocumentRevisionLifecycleStatus tracks controlled document state separately from asset review/export state. */
export type DocumentRevisionLifecycleStatus = "draft" | "in_review" | "released" | "superseded" | "expired" | "archived";

/** DocumentAccessLevel records the intended access boundary before future RBAC/ITAR policy enforcement. */
export type DocumentAccessLevel = "public" | "internal" | "restricted" | "itar_controlled";

/** DocumentAclPrincipalType keeps ACL grants provider-neutral and independent from a future identity directory. */
export type DocumentAclPrincipalType = "user" | "team" | "role";

/** DocumentAclPermission names review permissions without claiming full policy enforcement exists yet. */
export type DocumentAclPermission = "view" | "review" | "approve" | "admin";

/** DocumentRedlineStatus tracks review-note lifecycle without changing release state by itself. */
export type DocumentRedlineStatus = "open" | "resolved" | "rejected" | "superseded";

/** DocumentRedlineSeverity lets engineering notes distinguish comments from release blockers. */
export type DocumentRedlineSeverity = "info" | "review" | "blocker";

/** InventoryStatus records commercial availability snapshots without claiming live stock truth. */
export type InventoryStatus = "in_stock" | "out_of_stock" | "backorder" | "unknown";

/** Manufacturer is the normalized maker entity used by search and detail pages. */
export interface Manufacturer {
  id: string;
  name: string;
  aliases: string[];
  website: string | null;
}

/** Package is the normalized physical package entity from the data model. */
export interface Package {
  id: string;
  packageName: string;
  pinCount: number | null;
  pitchMm: number | null;
  bodyLengthMm: number | null;
  bodyWidthMm: number | null;
  bodyHeightMm: number | null;
}

/** ConnectorFamily groups mechanically compatible connector lines. */
export interface ConnectorFamily {
  id: string;
  name: string;
  series: string;
  description: string;
}

/** Part is the normalized catalog entity that search results are built around. */
export interface Part {
  id: string;
  mpn: string;
  description: string;
  manufacturerId: string;
  category: string;
  lifecycleStatus: LifecycleStatus;
  packageId: string;
  connectorFamilyId: string | null;
  trustScore: number;
  /** ISO timestamp for the latest canonical record update. */
  lastUpdatedAt: string;
}

/** SourceRecord preserves raw provider payload provenance for normalized records. */
export interface SourceRecord {
  id: string;
  providerId: string;
  providerPartKey: string;
  partId: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
  rawPayload: unknown;
  normalizedAt: string | null;
  sourceLastSeenAt: string;
  sourceLastImportedAt: string | null;
  importStatus: SourceImportStatus;
  importErrorDetails: string | null;
  lastUpdatedAt: string;
}

/** PriceBreak is one provider-specific price tier captured from a supply snapshot. */
export interface PriceBreak {
  id: string;
  supplyOfferingId: string;
  minQuantity: number;
  unitPrice: number;
  currencyCode: string;
  capturedAt: string;
}

/** SupplyOffering stores provider-specific commercial context without changing canonical part truth. */
export interface SupplyOffering {
  id: string;
  partId: string;
  providerId: string;
  sourceRecordId: string;
  providerPartKey: string;
  supplierName: string | null;
  providerSku: string | null;
  inventoryStatus: InventoryStatus;
  inventoryQuantity: number | null;
  moq: number | null;
  leadTimeDays: number | null;
  packaging: string | null;
  currencyCode: string;
  preferredRank: number | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  sourceUrl: string | null;
  priceBreaks: PriceBreak[];
}

/** LowestSupplyPriceSummary identifies the lowest recorded price tier without turning it into procurement approval. */
export interface LowestSupplyPriceSummary {
  offeringId: string;
  providerId: string;
  supplierName: string | null;
  minQuantity: number;
  unitPrice: number;
  currencyCode: string;
}

/** PartSupplyOfferSummary counts freshness and stock signals for one part's commercial snapshots. */
export interface PartSupplyOfferSummary {
  offerCount: number;
  inStockOfferCount: number;
  staleOfferCount: number;
  lastSeenAt: string | null;
  lowestUnitPrice: LowestSupplyPriceSummary | null;
}

/** PartSupplyOffersResponse returns source-linked supply snapshots beside part detail truth. */
export interface PartSupplyOffersResponse {
  state: "available" | "empty";
  partId: string;
  staleAfterDays: number;
  summary: PartSupplyOfferSummary;
  offers: SupplyOffering[];
  boundary: string;
}

/** ProviderImportDiagnostic is the compact debug view for provider import health. */
export interface ProviderImportDiagnostic {
  id: string;
  providerId: string;
  providerPartKey: string;
  partId: string | null;
  sourceUrl: string | null;
  importStatus: SourceImportStatus;
  importErrorDetails: string | null;
  sourceLastSeenAt: string;
  sourceLastImportedAt: string | null;
  lastUpdatedAt: string;
}

/** SourceExtractionSignal stores one structured readiness signal for CAD recovery. */
export interface SourceExtractionSignal {
  id: string;
  partId: string;
  sourceRecordId: string | null;
  datasheetRevisionId: string | null;
  assetId: string | null;
  signalType: SourceExtractionSignalType;
  extractionStatus: SourceExtractionStatus;
  confidenceScore: number;
  extractionSource: SourceExtractionSource;
  notes: string | null;
  lastUpdatedAt: string;
}

/** Project is the planned top-level project-memory root for BOM and where-used history. */
export interface Project {
  id: string;
  projectKey: string;
  name: string;
  description: string;
  owner: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

/** ProjectRevision scopes BOM imports and usage records to a concrete project revision. */
export interface ProjectRevision {
  id: string;
  projectId: string;
  revisionLabel: string;
  revisionStatus: ProjectRevisionStatus;
  sourceReference: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** BomImport stores upload and mapping provenance before any row is treated as matched. */
export interface BomImport {
  id: string;
  projectId: string;
  projectRevisionId: string;
  sourceFilename: string;
  sourceFormat: BomSourceFormat;
  storageKey: string | null;
  importStatus: BomImportStatus;
  columnMapping: Record<string, unknown>;
  importSummary: Record<string, unknown>;
  importedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** BomLine preserves raw and mapped BOM row evidence with explicit match state. */
export interface BomLine {
  id: string;
  bomImportId: string;
  projectId: string;
  projectRevisionId: string;
  rowNumber: number;
  designators: string[];
  quantity: number | null;
  rawMpn: string | null;
  rawManufacturer: string | null;
  rawDescription: string | null;
  rawSupplierReference: string | null;
  rawNotes: string | null;
  rawRowPayload: Record<string, unknown>;
  matchedPartId: string | null;
  matchStatus: BomLineMatchStatus;
  matchConfidenceScore: number | null;
  /** Circuit block id when this BOM line was generated by instantiating a reusable block. */
  instantiatedFromCircuitBlockId: string | null;
  /** Specific block-part role id this line was instantiated from, when applicable. */
  instantiatedFromCircuitBlockPartId: string | null;
  /** ISO timestamp when the line was instantiated from a block, when applicable. */
  instantiatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** ProjectPartUsage records confirmed internal usage for future where-used search. */
export interface ProjectPartUsage {
  id: string;
  projectId: string;
  projectRevisionId: string;
  bomLineId: string | null;
  partId: string;
  /** Optional denormalized part identity for high-usability project tables. */
  partMpn?: string;
  /** Optional denormalized manufacturer identity for high-usability project tables. */
  manufacturerName?: string;
  usageContext: string | null;
  designators: string[];
  quantity: number | null;
  usageStatus: ProjectPartUsageStatus;
  approvalSnapshot: Record<string, unknown>;
  readinessSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** ProjectCreateInput is the first write path for project-memory records from the web app. */
export interface ProjectCreateInput {
  projectKey: string;
  name: string;
  description?: string | null;
  owner?: string | null;
  status?: ProjectStatus;
  initialRevisionLabel?: string | null;
}

/** ProjectUpdateInput edits project metadata without changing BOM matching or trust state. */
export interface ProjectUpdateInput {
  name: string;
  description?: string | null;
  owner?: string | null;
  status: ProjectStatus;
}

/** ProjectCreateResponse returns the created project and its first revision. */
export interface ProjectCreateResponse {
  project: Project;
  initialRevision: ProjectRevision;
  detail: ProjectDetailResponse;
}

/** ProjectUpdateResponse returns the updated project detail and trust-boundary copy. */
export interface ProjectUpdateResponse {
  project: Project;
  detail: ProjectDetailResponse;
  boundary: string;
}

/** ProjectRevisionUpdateInput edits revision metadata without remapping BOM rows. */
export interface ProjectRevisionUpdateInput {
  revisionStatus: ProjectRevisionStatus;
  sourceReference?: string | null;
  releasedAt?: string | null;
}

/** ProjectRevisionUpdateResponse returns a refreshed project detail after revision edits. */
export interface ProjectRevisionUpdateResponse {
  revision: ProjectRevision;
  detail: ProjectDetailResponse;
  boundary: string;
}

/** BomColumnMapping maps source CSV headers into canonical BOM line fields. */
export interface BomColumnMapping {
  mpn?: string | null;
  manufacturer?: string | null;
  quantity?: string | null;
  designators?: string | null;
  description?: string | null;
  notes?: string | null;
  supplierReference?: string | null;
}

/** BomImportPreviewRow preserves one parsed CSV row before any database writes happen. */
export interface BomImportPreviewRow {
  rowNumber: number;
  values: Record<string, string>;
}

/** BomImportPreviewInput carries file content for a no-write preview parse. CSV is plain text; XLSX is base64-encoded binary. */
export interface BomImportPreviewInput {
  sourceFilename: string;
  sourceFormat: "csv" | "xlsx";
  rawContent: string;
}

/** BomImportPreviewResponse returns headers, preview rows, and suggested mapping without persistence. */
export interface BomImportPreviewResponse {
  sourceFilename: string;
  sourceFormat: "csv" | "xlsx";
  headers: string[];
  rowsPreview: BomImportPreviewRow[];
  rowCount: number;
  skippedBlankRowCount: number;
  suggestedMapping: BomColumnMapping;
  warnings: string[];
}

/** BomImportCreateInput persists a parsed and mapped CSV BOM into project memory. */
export interface BomImportCreateInput extends BomImportPreviewInput {
  projectRevisionId?: string | null;
  revisionLabel?: string | null;
  columnMapping: BomColumnMapping;
}

/** BomImportPersistSummary reports saved BOM rows without implying part matching has run. */
export interface BomImportPersistSummary {
  persistedLineCount: number;
  skippedBlankRowCount: number;
  mappedFieldCount: number;
  matchStatus: "unmatched";
}

/** BomImportCreateResponse returns saved import metadata plus a bounded preview of saved lines. */
export interface BomImportCreateResponse {
  bomImport: BomImport;
  lineCount: number;
  linesPreview: BomLine[];
  summary: BomImportPersistSummary;
}

/** BomImportMatchSummary reports one deterministic matching pass without hiding weak rows. */
export interface BomImportMatchSummary {
  totalLineCount: number;
  matchedLineCount: number;
  unmatchedLineCount: number;
  ambiguousLineCount: number;
  weakMatchLineCount: number;
  ignoredLineCount: number;
  usageCreatedOrUpdatedCount: number;
  importableExactMpnLineCount: number;
}

/** BomLineImportCandidate routes unmatched exact-MPN rows toward the existing provider import flow. */
export interface BomLineImportCandidate {
  bomLineId: string;
  rowNumber: number;
  mpn: string;
  manufacturerName: string | null;
}

/** BomImportMatchResponse returns updated lines, import metadata, usage previews, and import candidates. */
export interface BomImportMatchResponse {
  bomImport: BomImport;
  importCandidates: BomLineImportCandidate[];
  linesPreview: BomLine[];
  summary: BomImportMatchSummary;
  usagesPreview: ProjectPartUsage[];
}

/**
 * ProjectFromCsvInput drives the one-click day-zero onboarding flow.
 *
 * The CSV / XLSX is parsed and column-mapped server-side using the same heuristic
 * the BOM import panel uses; missing required mappings (specifically MPN) cause an
 * explicit `missing_mpn_mapping` failure so the caller can fall back to manual
 * mapping rather than silently inventing identity. The project name is auto-derived
 * from the supplied filename when `projectName` is omitted.
 */
export interface ProjectFromCsvInput {
  /** Raw CSV text or base64-encoded XLSX bytes, matching BomImportPreviewInput. */
  rawContent: string;
  /** Source filename used to derive the project name and persisted on the BOM import. */
  sourceFilename: string;
  /** Either "csv" or "xlsx"; mirrors BomImportPreviewInput. */
  sourceFormat: "csv" | "xlsx";
  /** Optional explicit project name. Auto-derived from sourceFilename when omitted. */
  projectName?: string | null;
  /** Optional unique project key. Auto-derived from the project name when omitted. */
  projectKey?: string | null;
  /** Optional description recorded on the project metadata. */
  description?: string | null;
  /** Optional initial revision label; defaults to "Working" when omitted. */
  initialRevisionLabel?: string | null;
}

/**
 * ProjectFromCsvSummary rolls up the three persistence stages of the onboarding flow
 * so the caller can render a single-screen "what happened" panel without having to
 * walk back through the import + match envelopes.
 *
 * Honesty discipline: the summary distinguishes between rows that were *saved* and
 * rows that were *matched to existing internal parts*. Saved rows count as
 * remembered work even when no internal identity matches; matched rows count as
 * confirmed project_part_usages.
 */
export interface ProjectFromCsvSummary {
  parsedRowCount: number;
  skippedBlankRowCount: number;
  savedLineCount: number;
  matchedLineCount: number;
  unmatchedLineCount: number;
  ambiguousLineCount: number;
  weakMatchLineCount: number;
  warnings: string[];
}

/** ProjectFromCsvResponse returns the chained outcome so the caller can land on diagnostics. */
export interface ProjectFromCsvResponse {
  project: Project;
  initialRevision: ProjectRevision;
  bomImport: BomImport;
  summary: ProjectFromCsvSummary;
  /**
   * The deterministic `column_mapping` actually persisted on the BOM import. Echoes
   * the suggested mapping so the caller can re-display it without re-parsing.
   */
  columnMapping: BomColumnMapping;
  /** Trust-boundary copy reminding the operator that saving and matching are not approval. */
  boundary: string;
}

/** ProjectMemoryReadState distinguishes populated reads from configured-but-empty project memory. */
export type ProjectMemoryReadState = "available" | "empty";

/** ProjectMemoryCapabilityState labels foundations and planned workflows without presenting plans as shipped. */
export type ProjectMemoryCapabilityState = "foundation" | "planned";

/** ProjectMemoryCapability names one project-memory capability and whether it is foundation-only or planned. */
export interface ProjectMemoryCapability {
  id: "project_records" | "bom_import_records" | "bom_upload" | "bom_matching" | "where_used" | "bom_health" | "revision_approval_gates" | "evidence_vault" | "circuit_blocks";
  label: string;
  state: ProjectMemoryCapabilityState;
  detail: string;
}

/** ProjectSummary is the compact project row used by project-list API reads. */
export interface ProjectSummary {
  project: Project;
  revisionCount: number;
  bomImportCount: number;
  usageCount: number;
  latestActivityAt: string;
}

/** ProjectListResponse is the read-only project-memory list contract. */
export interface ProjectListResponse {
  state: ProjectMemoryReadState;
  projects: ProjectSummary[];
  capabilities: ProjectMemoryCapability[];
}

/**
 * ProjectFolderCategory enumerates the first-class subfolders the project file mirror
 * creates per project. Categories are the only top-level directories the API exposes;
 * deeper folders are shown as entries instead of traversed blindly.
 */
export type ProjectFolderCategory = "parts_list" | "datasheets" | "models" | "hardware" | "notes";

/**
 * ProjectFolderEntry describes one file persisted inside a project folder category.
 * Sizes and timestamps come straight from the filesystem so the UI can show calm,
 * factual file info without re-deriving anything.
 */
export interface ProjectFolderEntry {
  /** Bare filename (no path components). */
  name: string;
  /** Bytes on disk; null when the entry is a sub-directory the API refuses to traverse. */
  sizeBytes: number | null;
  /** ISO-8601 timestamp captured from the filesystem mtime, or null when unavailable. */
  modifiedAt: string | null;
  /** True when the entry is a regular file; false when it is a directory or symlink. */
  isFile: boolean;
}

/** ProjectFolderListing groups one category's filesystem entries with its absolute path. */
export interface ProjectFolderListing {
  /** Stable category identifier; matches ProjectFolderCategory. */
  category: ProjectFolderCategory;
  /** Human-readable category label rendered above the file list. */
  label: string;
  /** Short description of what should live in this folder. */
  description: string;
  /** Absolute path to this category's folder on the API host. */
  absolutePath: string;
  /** Files and directories observed inside this category folder. */
  entries: ProjectFolderEntry[];
}

/** ProjectCustomHardwareFolderState separates real design folders from BOM-only references. */
export type ProjectCustomHardwareFolderState = "folder_backed" | "parts_list_reference_only";

/**
 * ProjectCustomHardwareRecord describes one internally-designed custom item found
 * through project file reads. Note fields stay nullable so the UI never presents an
 * undocumented connection, test intent, or project attachment as known.
 */
export interface ProjectCustomHardwareRecord {
  /** Canonical internal hardware part number such as PTA-1001, PCA-2042, or ICD-17. */
  partNumber: string;
  /** Folder name on disk when a design folder exists; null for parts-list-only references. */
  folderName: string | null;
  /** Absolute design folder path on the API host when one exists. */
  absolutePath: string | null;
  /** What this hardware connects to, copied from metadata when recorded. */
  connectsTo: string | null;
  /** What this hardware tests, copied from metadata when recorded. */
  tests: string | null;
  /** Project or program attachment copied from custom design metadata when recorded. */
  attachedProject: string | null;
  /** Extra note text copied from custom design metadata when recorded. */
  notes: string | null;
  /** Metadata filename that supplied the note fields, or null when none was found. */
  metadataSource: string | null;
  /** Parts-list files where this hardware part number was observed. */
  mentionedInPartsListFiles: string[];
  /** Latest filesystem mtime for the design folder or metadata source, when available. */
  modifiedAt: string | null;
  /** Whether the record came from a design folder or only from a parts-list mention. */
  folderState: ProjectCustomHardwareFolderState;
}

/**
 * ProjectCustomHardwareListing groups custom design reads for one project. The boundary
 * is explicit because filesystem notes are provenance, not validation or release approval.
 */
export interface ProjectCustomHardwareListing {
  /** Absolute path to the custom design folder for this project. */
  hardwareFolderPath: string;
  /** Uppercase configured or folder-discovered prefixes recognized during this read. */
  recognizedPrefixes: string[];
  /** Design folder and parts-list reference records, sorted by part number. */
  records: ProjectCustomHardwareRecord[];
  /** Short honesty reminder for UI surfaces. */
  boundary: string;
}

/** ProjectDocumentType names the first-pass document families found during a folder scan. */
export type ProjectDocumentType =
  | "archive"
  | "cad_model"
  | "cable_doc"
  | "datasheet"
  | "drawing"
  | "fixture_doc"
  | "parts_list"
  | "pinout"
  | "requirements"
  | "review_note"
  | "schematic"
  | "test_procedure"
  | "unknown";

/** ProjectDocumentExtractionFormat names document formats handled by the background reader. */
export type ProjectDocumentExtractionFormat = "pdf" | "docx" | "xlsx" | "pptx";

/** ProjectDocumentExtractionStatus tracks background text-reading progress for one project file. */
export type ProjectDocumentExtractionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "unsupported";

/**
 * ProjectDocumentExtractionSourceLocation preserves a human-readable page, sheet, slide,
 * or paragraph reference beside a short extracted-text preview.
 */
export interface ProjectDocumentExtractionSourceLocation {
  /** Stable source label such as "Page 4", "Sheet: Pin Map", or "Slide 8". */
  label: string;
  /** Short text excerpt from that location; never the full source document. */
  textPreview: string;
}

/**
 * ProjectDocumentExtractionState is the user-facing background-reader state attached
 * to one document-map row.
 */
export interface ProjectDocumentExtractionState {
  /** Supported format selected from the file extension. */
  format: ProjectDocumentExtractionFormat;
  /** Current background-reader state. */
  status: ProjectDocumentExtractionStatus;
  /** Integer progress from 0 through 100. */
  progressPercent: number;
  /** Plain-language current activity or result message. */
  progressMessage: string;
  /** Approximate seconds remaining; null when no useful estimate is available. */
  estimatedWaitSeconds: number | null;
  /** Number of queued files ahead of this one when the latest status was read. */
  queuePosition: number | null;
  /** Number of pages, sheets, slides, or paragraph groups read when known. */
  sourceUnitCount: number | null;
  /** Number of extracted characters retained for search. */
  extractedCharacterCount: number;
  /** True when extracted text is available to classification and where-used search. */
  searchableTextAvailable: boolean;
  /** Bounded page/sheet/slide excerpts that preserve source context. */
  sourceLocations: ProjectDocumentExtractionSourceLocation[];
  /** Extractor implementation version for provenance and safe reprocessing. */
  extractorVersion: string;
  /** Time extraction started, when available. */
  startedAt: string | null;
  /** Time extraction completed or failed, when available. */
  completedAt: string | null;
  /** Stable failure code when extraction failed. */
  errorCode: string | null;
  /** Calm user-facing recovery detail when extraction failed. */
  errorMessage: string | null;
}

/** ProjectDocumentExtractionStatusRecord carries one lightweight polling update. */
export interface ProjectDocumentExtractionStatusRecord {
  /** Relative path used to merge the state into the current document map. */
  relativePath: string;
  /** Current persisted reader state without full extracted document text. */
  extraction: ProjectDocumentExtractionState;
}

/** ProjectDocumentExtractionStatusResponse is returned by the status-only polling route. */
export interface ProjectDocumentExtractionStatusResponse {
  /** Number of queued or running files in this project. */
  activeCount: number;
  /** Current supported-document states for this project. */
  records: ProjectDocumentExtractionStatusRecord[];
}

/** ProjectDocumentSignals preserves searchable engineering clues found in filenames or text. */
export interface ProjectDocumentSignals {
  /** Connector references such as J202 found during the scan. */
  connectorRefs: string[];
  /** Pin references such as 47 or A12 found near pin wording or connector refs. */
  pinRefs: string[];
  /** Cable or harness identifiers found during the scan. */
  cableKeys: string[];
  /** Fixture, jig, or custom hardware identifiers found during the scan. */
  fixtureKeys: string[];
  /** Revision labels such as Rev C or R0.2 found during the scan. */
  revisionLabels: string[];
  /** Signal-like names such as RS422_TX+ found during the scan. */
  signalNames: string[];
}

/** ProjectDocumentSortAction names the safe next step for one mapped document. */
export type ProjectDocumentSortAction = "leave_in_place" | "move_to_standard_folder" | "choose_destination" | "review_unknown";

/** ProjectDocumentFolderPatternAction names the safe next step for one folder trend. */
export type ProjectDocumentFolderPatternAction =
  | "use_file_copy_buttons"
  | "sort_each_file"
  | "open_folder"
  | "leave_folder";

/**
 * ProjectDocumentSortPlan is a non-mutating cleanup suggestion. It tells an engineer
 * where a file appears to belong without moving or copying anything automatically.
 */
export interface ProjectDocumentSortPlan {
  /** Recommended cleanup action for this file. */
  action: ProjectDocumentSortAction;
  /** Original relative path preserved for traceability. */
  sourceRelativePath: string;
  /** Suggested standard folder, when the scan found one. */
  targetCategory: ProjectFolderCategory | null;
  /** Human-readable standard folder label, when available. */
  targetFolderLabel: string | null;
  /** Suggested relative destination path, when available. */
  targetRelativePath: string | null;
  /** Short explanation for the suggested action. */
  reason: string;
}

/**
 * ProjectDocumentMapEntry describes one file found under the project folder. The
 * classification is a scan hint only; nullable fields prevent uncertain files from
 * looking reviewed.
 */
export interface ProjectDocumentMapEntry {
  /** Stable id derived from the relative path for list rendering. */
  id: string;
  /** Bare filename as observed on disk. */
  filename: string;
  /** Relative path from the project root. */
  relativePath: string;
  /** Relative parent folder, or "." for project-root files. */
  parentFolder: string;
  /** Filesystem size in bytes. */
  sizeBytes: number;
  /** ISO-8601 filesystem mtime, or null when unavailable. */
  modifiedAt: string | null;
  /** First-pass document family. */
  documentType: ProjectDocumentType;
  /** Confidence score for the first-pass document family. */
  confidenceScore: number;
  /** Short explanation for the first-pass document family. */
  reason: string;
  /** Standard folder category where this file appears today, if any. */
  currentCategory: ProjectFolderCategory | null;
  /** Suggested standard folder when the scan sees a better fit. */
  suggestedCategory: ProjectFolderCategory | null;
  /** True when the file is outside the standard project folders. */
  outsideStandardFolders: boolean;
  /** True when the row deserves human sorting or review. */
  needsAttention: boolean;
  /** Searchable engineering clues found in filenames or text. */
  signals: ProjectDocumentSignals;
  /** Non-mutating cleanup suggestion for messy project folders. */
  sortPlan: ProjectDocumentSortPlan;
  /** Background PDF/Office reading state, or null for formats that do not need it. */
  extraction: ProjectDocumentExtractionState | null;
}

/** ProjectDocumentTypeCount keeps folder trend mix counts explicit and bounded. */
export interface ProjectDocumentTypeCount {
  /** Document family counted inside the folder. */
  documentType: ProjectDocumentType;
  /** Number of files with this scan family. */
  count: number;
}

/**
 * ProjectDocumentFolderPattern describes a repeated folder-level hint from the same
 * bounded document scan. It is not a reviewed taxonomy; it only helps engineers decide
 * which messy folders to open first.
 */
export interface ProjectDocumentFolderPattern {
  /** Stable id derived from the folder path for list rendering. */
  id: string;
  /** Relative folder path from the project root. */
  folderPath: string;
  /** Standard folder category when the folder already lives under one. */
  currentCategory: ProjectFolderCategory | null;
  /** Number of mapped files grouped into this folder. */
  fileCount: number;
  /** True when this folder is outside the standard project folders. */
  outsideStandardFolders: boolean;
  /** Document family mix, sorted by count. */
  typeCounts: ProjectDocumentTypeCount[];
  /** Dominant document family when one exists. */
  dominantDocumentType: ProjectDocumentType | null;
  /** Number of files using the dominant document family. */
  dominantTypeCount: number;
  /** Suggested standard folder when a strong folder-level trend exists. */
  suggestedCategory: ProjectFolderCategory | null;
  /** Human-readable standard folder label, when available. */
  suggestedFolderLabel: string | null;
  /** Safe next step for this folder trend. */
  suggestedAction: ProjectDocumentFolderPatternAction;
  /** Confidence score for the folder-level trend, not review status. */
  confidenceScore: number;
  /** Short explanation for why this folder was grouped this way. */
  reason: string;
  /** Example filenames from this folder for quick visual confirmation. */
  exampleFilenames: string[];
  /** Count of files in this folder with individual move suggestions. */
  moveSuggestionCount: number;
  /** Count of files still classified as unknown. */
  unknownDocumentCount: number;
  /** Aggregated searchable engineering clues found in this folder. */
  signals: ProjectDocumentSignals;
}

/** ProjectDocumentMapSummary keeps the messy-folder scan bounded and scannable. */
export interface ProjectDocumentMapSummary {
  /** Number of files returned in the map. */
  documentCount: number;
  /** Number of folders visited during the scan. */
  folderCount: number;
  /** Number of repeated folder trends found during the scan. */
  folderPatternCount: number;
  /** Number of folder trends whose files point to more than one likely destination. */
  mixedFolderCount: number;
  /** Files outside the standard project folders. */
  outsideStandardFolderCount: number;
  /** Files classified as unknown. */
  unknownDocumentCount: number;
  /** Files whose score is below the confident threshold. */
  lowConfidenceCount: number;
  /** Files containing at least one connector reference. */
  connectorMentionCount: number;
  /** Files containing at least one pin reference. */
  pinMentionCount: number;
  /** PDF/Office files waiting for the background reader. */
  extractionQueuedCount: number;
  /** PDF/Office files currently being read. */
  extractionRunningCount: number;
  /** PDF/Office files with searchable extracted text. */
  extractionSucceededCount: number;
  /** PDF/Office files whose latest extraction failed. */
  extractionFailedCount: number;
  /** Legacy Office files that need conversion before reading. */
  extractionUnsupportedCount: number;
  /** Files with a high-confidence standard-folder move suggestion. */
  moveSuggestionCount: number;
  /** Files skipped because scan caps were reached or the folder could not be read. */
  skippedCount: number;
}

/**
 * ProjectDocumentMap is the Area 1 first-pass folder scan. It maps what is on disk
 * without claiming the files are reviewed, current, or safe to reuse.
 */
export interface ProjectDocumentMap {
  /** Honesty reminder rendered above the scan results. */
  boundary: string;
  /** Absolute project folder scanned by the API. */
  scanRootPath: string;
  /** ISO-8601 timestamp for this scan. */
  generatedAt: string;
  /** Maximum recursion depth allowed for this scan. */
  maxDepth: number;
  /** Maximum files returned by this scan. */
  maxFiles: number;
  /** Aggregate counts for the document map. */
  summary: ProjectDocumentMapSummary;
  /** Folder-level trends inferred from repeated file names and document families. */
  folderPatterns: ProjectDocumentFolderPattern[];
  /** Bounded document rows sorted for workstation review. */
  documents: ProjectDocumentMapEntry[];
}

/**
 * ProjectFilesAvailability tracks whether the file mirror is reachable. "configured"
 * means the API can read and write the project root; "not_configured" means the env
 * var has been disabled so the panel must show a clean, honest disabled state.
 */
export type ProjectFilesAvailability = "configured" | "not_configured" | "error";

/** ProjectFilesResponse is the read-only project file mirror contract. */
export interface ProjectFilesResponse {
  /** Whether the project file mirror is configured and reachable. */
  availability: ProjectFilesAvailability;
  /** Absolute path to the project root folder, when configured. */
  rootPath: string | null;
  /** The project this listing belongs to. */
  projectId: string;
  /** Project key used as the on-disk folder name. */
  projectKey: string;
  /** Per-category listings; empty when availability is not_configured. */
  folders: ProjectFolderListing[];
  /** Custom internal designs found under the custom design folder and parts-list files. */
  customHardware: ProjectCustomHardwareListing | null;
  /** First-pass document map for messy project folders, or null when unavailable. */
  documentMap: ProjectDocumentMap | null;
  /** Human-readable detail when availability is "error". */
  message: string | null;
}

/**
 * ProjectFileUploadInput is the request body for `POST /projects/:id/files/:category`.
 *
 * Either `contentBase64` or `content` must be present:
 *   - `contentBase64` is for arbitrary binary uploads (PDF datasheets, STEP models, BOM
 *     CSVs). Standard base64 with optional `data:...,` prefix.
 *   - `content` is for plain UTF-8 text written directly. Used for notes the engineer
 *     types in the browser so the file is human-readable on disk.
 */
export interface ProjectFileUploadInput {
  /** Suggested filename. The server sanitizes it and may append a collision suffix. */
  filename: string;
  /** Base64 payload for binary uploads. */
  contentBase64?: string;
  /** UTF-8 text payload for note composition. */
  content?: string;
}

/** ProjectFileUploadResponse is the success envelope returned after a successful upload. */
export interface ProjectFileUploadResponse {
  /** Category the new file was written into. */
  category: ProjectFolderCategory;
  /** Final on-disk filename after sanitization and collision handling. */
  entry: ProjectFolderEntry;
  /** Absolute path the file was written to. */
  absolutePath: string;
}

/** ProjectDocumentCopyInput names the mapped source file the engineer wants copied. */
export interface ProjectDocumentCopyInput {
  /** Relative path from the project root. Must match one current document-map row. */
  sourceRelativePath: string;
}

/** ProjectDocumentExtractionRetryInput identifies one failed extraction to retry. */
export interface ProjectDocumentExtractionRetryInput {
  /** Relative path from the project root. Must match one current document-map row. */
  sourceRelativePath: string;
}

/** ProjectDocumentCopyResponse is returned after a safe copy from a sort suggestion. */
export interface ProjectDocumentCopyResponse {
  /** Original path that was copied. */
  sourceRelativePath: string;
  /** Suggested path from the sort plan before collision handling. */
  suggestedRelativePath: string;
  /** Final relative path written after collision handling. */
  targetRelativePath: string;
  /** Absolute path written on the API host. */
  targetAbsolutePath: string;
  /** Standard folder where the copy was written. */
  targetCategory: ProjectFolderCategory;
  /** Final copied file entry. */
  entry: ProjectFolderEntry;
  /** Plain reminder that the messy source file remains in place. */
  boundary: string;
}

/** InterconnectRecordStatus keeps cable and fixture state separate from part approval. */
export type InterconnectRecordStatus = "draft" | "in_review" | "approved" | "restricted" | "retired";

/** InterconnectProvenance records how cable or fixture knowledge entered the system. */
export type InterconnectProvenance = "manual_internal" | "project_file" | "bom_import" | "connector_catalog";

/** CableAssemblyEndLabel names the physical connector ends currently supported by the first slice. */
export type CableAssemblyEndLabel = "A" | "B" | "C" | "D" | "other";

/** InterconnectPartSummary is the compact part identity used by cable and fixture rows. */
export interface InterconnectPartSummary {
  /** Internal part id, or null when the connector has not been matched to a catalog part record. */
  partId: string | null;
  /** Manufacturer part number, or null for unmatched connector references. */
  mpn: string | null;
  /** Manufacturer display name, or null when identity only exists as a source reference. */
  manufacturerName: string | null;
}

/** CableAssemblyEnd records one physical end of a cable assembly. */
export interface CableAssemblyEnd {
  id: string;
  cableAssemblyId: string;
  endLabel: CableAssemblyEndLabel;
  connectorRef: string;
  connectorPart: InterconnectPartSummary;
  matePart: InterconnectPartSummary;
  backshellPart: InterconnectPartSummary;
  notes: string | null;
}

/** CableAssembly is one revision-scoped cable or adapter-like assembly record. */
export interface CableAssembly {
  id: string;
  cableKey: string;
  revisionLabel: string;
  assemblyStatus: InterconnectRecordStatus;
  projectId: string | null;
  projectKey: string | null;
  projectName: string | null;
  projectRevisionId: string | null;
  projectRevisionLabel: string | null;
  owner: string | null;
  description: string | null;
  sourceDocumentRef: string | null;
  provenance: InterconnectProvenance;
  ends: CableAssemblyEnd[];
  pinRowCount: number;
  fixturePortCount: number;
  createdAt: string;
  updatedAt: string;
}

/** FixturePort records one J-number or other connector reference on a test fixture. */
export interface FixturePort {
  id: string;
  fixtureId: string;
  connectorRef: string;
  connectorPart: InterconnectPartSummary;
  matePart: InterconnectPartSummary;
  cableAssemblyId: string | null;
  cableKey: string | null;
  portRole: string | null;
  notes: string | null;
}

/** TestFixture is the revision-scoped record for bench hardware that cables plug into. */
export interface TestFixture {
  id: string;
  fixtureKey: string;
  revisionLabel: string;
  fixtureStatus: InterconnectRecordStatus;
  projectId: string | null;
  projectKey: string | null;
  projectName: string | null;
  owner: string | null;
  purpose: string | null;
  sourceDocumentRef: string | null;
  provenance: InterconnectProvenance;
  ports: FixturePort[];
  pinRowCount: number;
  createdAt: string;
  updatedAt: string;
}

/** CablePinMapRow is one searchable pin-to-signal row with provenance and confidence. */
export interface CablePinMapRow {
  id: string;
  cableAssemblyId: string;
  cableKey: string;
  revisionLabel: string;
  cableEndId: string | null;
  fixturePortId: string | null;
  endLabel: CableAssemblyEndLabel;
  connectorRef: string;
  pinNumber: string;
  signalName: string;
  wireColor: string | null;
  wireGauge: number | null;
  destinationConnectorRef: string | null;
  destinationPinNumber: string | null;
  confidenceScore: number;
  evidenceAttachmentId: string | null;
  sourceDocumentRef: string | null;
  notes: string | null;
}

/** InterconnectDashboardSummary gives the workspace scannable counts without implying approval. */
export interface InterconnectDashboardSummary {
  cableAssemblyCount: number;
  fixtureCount: number;
  fixturePortCount: number;
  pinMapRowCount: number;
  approvedCableAssemblyCount: number;
  restrictedRecordCount: number;
  lowConfidencePinRowCount: number;
}

/** InterconnectDashboardResponse is the first read model for the Area 2 workspace. */
export interface InterconnectDashboardResponse {
  state: ProjectMemoryReadState;
  boundary: string;
  summary: InterconnectDashboardSummary;
  cableAssemblies: CableAssembly[];
  fixtures: TestFixture[];
  pinMapRows: CablePinMapRow[];
}

/**
 * VendorCategory enumerates the supplier classes the team tracks. The list is fixed so
 * the UI can render consistent labels and group views without a free-form taxonomy.
 * Add categories here when the team starts working with a new class of supplier.
 */
export type VendorCategory =
  | "pcb_fab"
  | "sheet_metal"
  | "machining"
  | "finishing"
  | "electronics_assembly"
  | "distributor"
  | "other";

/**
 * VendorAvailability mirrors ProjectFilesAvailability: "configured" means the vendor
 * notes folder is reachable, "not_configured" means the env var has been disabled, and
 * "error" surfaces filesystem failures honestly to the UI.
 */
export type VendorAvailability = "configured" | "not_configured" | "error";

/**
 * Vendor is the institutional record for one supplier. Slugs are derived from the name
 * and are stable across renames-of-display so URLs and folders do not move silently.
 */
export interface Vendor {
  /** URL slug derived from the vendor name; also the on-disk folder name. */
  slug: string;
  /** Display name. */
  name: string;
  /** Supplier class. */
  category: VendorCategory;
  /** One-line description that surfaces in the list view. */
  summary: string;
  /** ISO timestamp when the vendor record was created. */
  createdAt: string;
  /** ISO timestamp when the vendor record was last updated. */
  updatedAt: string;
}

/** VendorSummary couples a Vendor with note/file counts for the list view. */
export interface VendorSummary {
  /** Vendor record itself. */
  vendor: Vendor;
  /** Number of Markdown notes saved under this vendor. */
  noteCount: number;
  /** Number of reference files saved under this vendor. */
  fileCount: number;
}

/** VendorListResponse returns every vendor record alongside reachability metadata. */
export interface VendorListResponse {
  /** Whether the vendor notes mirror is configured and reachable. */
  availability: VendorAvailability;
  /** Absolute path to the vendor notes root, when configured. */
  rootPath: string | null;
  /** Per-vendor summaries; empty when availability is not_configured. */
  vendors: VendorSummary[];
  /** Human-readable detail when availability is "error". */
  message: string | null;
}

/**
 * VendorFolderSection enumerates the two on-disk folders inside a vendor record. Notes
 * are Markdown decisions and observations the engineer types; files are uploaded
 * reference docs (capability sheets, drawing standards, sample reports).
 */
export type VendorFolderSection = "notes" | "files";

/** VendorDetailResponse returns one vendor with its notes and files folder listings. */
export interface VendorDetailResponse {
  /** Whether the vendor notes mirror is configured and reachable. */
  availability: VendorAvailability;
  /** Absolute path to the vendor notes root, when configured. */
  rootPath: string | null;
  /** Vendor record itself; null when not_configured or not_found. */
  vendor: Vendor | null;
  /** Engineer notes folder listing. */
  notes: ProjectFolderEntry[];
  /** Reference files folder listing. */
  files: ProjectFolderEntry[];
  /** Absolute path to this vendor's notes/ folder, when configured. */
  notesPath: string | null;
  /** Absolute path to this vendor's files/ folder, when configured. */
  filesPath: string | null;
  /** Human-readable detail when availability is "error". */
  message: string | null;
}

/** VendorCreateInput is the request body for `POST /vendors`. */
export interface VendorCreateInput {
  /** Display name; required. */
  name: string;
  /** Supplier class; required. */
  category: VendorCategory;
  /** Optional one-liner shown in the list view. */
  summary?: string;
}

/** VendorCreateResponse returns the newly created vendor record. */
export interface VendorCreateResponse {
  vendor: Vendor;
}

/** VendorFileUploadInput is the request body for `POST /vendors/:slug/files/:section`. */
export interface VendorFileUploadInput {
  /** Suggested filename. The server sanitizes it and may append a collision suffix. */
  filename: string;
  /** Base64 payload for binary uploads. */
  contentBase64?: string;
  /** UTF-8 text payload for note composition. */
  content?: string;
}

/** VendorFileUploadResponse is the success envelope returned after a successful upload. */
export interface VendorFileUploadResponse {
  /** Section the file was written into. */
  section: VendorFolderSection;
  /** Final on-disk filename after sanitization and collision handling. */
  entry: ProjectFolderEntry;
  /** Absolute path the file was written to. */
  absolutePath: string;
}

/** ProjectFleetRiskRow reports per-project explainable BOM risk counts for the fleet dashboard. */
export interface ProjectFleetRiskRow {
  project: Project;
  /** BOM lines that did not match any internal part. */
  unmatchedLineCount: number;
  /** BOM lines that matched weakly or ambiguously and need review. */
  weakOrAmbiguousLineCount: number;
  /** Confirmed-usage parts that lack an approved approval record. */
  approvalGapCount: number;
  /** Confirmed-usage parts whose lifecycle is obsolete or not_recommended. */
  lifecycleRiskCount: number;
  /** Confirmed-usage parts missing a complete verified file-backed CAD set. */
  missingVerifiedCadCount: number;
  /** Open follow-up records targeting this project. */
  openFollowUpCount: number;
  /** Sum of every count column above; transparent additive total, not an opaque score. */
  totalRiskCount: number;
}

/** ProjectFleetRiskResponse is the explainable cross-project risk dashboard payload. */
export interface ProjectFleetRiskResponse {
  state: ProjectMemoryReadState;
  rows: ProjectFleetRiskRow[];
  /** Trust-boundary copy explaining what counts mean and what they do not unlock. */
  boundary: string;
}

/** ProjectDetailResponse is the read-only project-memory detail contract. */
export interface ProjectDetailResponse {
  state: "available";
  project: Project;
  summary: ProjectSummary;
  revisions: ProjectRevision[];
  bomImports: BomImport[];
  usages: ProjectPartUsage[];
  capabilities: ProjectMemoryCapability[];
}

/** ProjectRevisionsResponse returns persisted revisions for one project. */
export interface ProjectRevisionsResponse {
  state: ProjectMemoryReadState;
  projectId: string;
  revisions: ProjectRevision[];
}

/** ProjectBomImportsResponse returns persisted BOM import records for one project. */
export interface ProjectBomImportsResponse {
  state: ProjectMemoryReadState;
  projectId: string;
  bomImports: BomImport[];
}

/** BomImportLinesResponse returns raw and mapped BOM rows for one persisted BOM import. */
export interface BomImportLinesResponse {
  state: ProjectMemoryReadState;
  bomImportId: string;
  lines: BomLine[];
}

/** ProjectPartUsagesResponse returns confirmed persisted usage records for one project. */
export interface ProjectPartUsagesResponse {
  state: ProjectMemoryReadState;
  projectId: string;
  usages: ProjectPartUsage[];
}

/** PartWhereUsedRecord joins confirmed usage to the project context that created it. */
export interface PartWhereUsedRecord {
  usage: ProjectPartUsage;
  project: Project;
  projectRevision: ProjectRevision;
  bomLine: BomLine | null;
}

/** PartWhereUsedResponse answers where one internal part has confirmed project usage. */
export interface PartWhereUsedResponse {
  state: ProjectMemoryReadState;
  partId: string;
  usages: PartWhereUsedRecord[];
  /**
   * Circuit blocks that depend on this part through one or more part-role rows. Each entry
   * collects every role in that block that links to the inspected part (a single block may
   * use the same part as `Main LDO` and `Reference LDO`, for example), and carries the full
   * `CircuitBlockSummary` so the UI can derive the reuse-readiness verdict from the same
   * shared helper used by the library and detail strip — without doing a per-row detail fetch.
   *
   * Circuit-block dependency is engineering memory, never an approval signal. A part being
   * linked to a block role does not approve the part, validate its assets, or unlock export.
   */
  circuitBlockDependencies: PartCircuitBlockDependencyRecord[];
}

/**
 * PartCircuitBlockDependencyRecord reports one circuit block that depends on the inspected
 * part through one or more role rows. The `summary` carries the aggregated counts the UI
 * needs to derive the same reuse-readiness verdict shown on the circuit-block detail strip.
 */
export interface PartCircuitBlockDependencyRecord {
  summary: CircuitBlockSummary;
  /** Role rows inside this block that point at the inspected part. */
  blockParts: CircuitBlockPart[];
}

export interface ProjectOverlapSharedPartPreview {
  partId: string;
  /** Catalog MPN when the part row exists; falls back to `partId` if missing. */
  mpn: string;
  /** Number of confirmed usage rows in the prior project that point at this shared part. */
  usageCount: number;
  /** Sum of known quantities across the matching usage rows; null means no usage row carried quantity. */
  quantityTotal: number | null;
  /** First few designators from the matching prior-project usage rows. */
  designatorsPreview: string[];
  /** Usage status from the newest matching usage row in the prior project. */
  usageStatus: ProjectPartUsageStatus | null;
  /** Revision label from the newest matching usage row, if that revision still exists. */
  projectRevisionLabel: string | null;
}

/** ProjectOverlapCircuitBlockRolePreview shows which reusable block role matched this BOM. */
export interface ProjectOverlapCircuitBlockRolePreview {
  circuitBlockId: string;
  blockPartId: string;
  blockKey: string;
  blockName: string;
  blockStatus: CircuitBlockStatus;
  partId: string;
  /** Catalog MPN when the part row exists; falls back to `partId` if missing. */
  mpn: string;
  role: string;
  quantity: number | null;
  isRequired: boolean;
  substitutionPolicy: CircuitBlockPartSubstitutionPolicy;
}

/**
 * ProjectOverlapPriorProject ranks one prior project against the current one by shared
 * confirmed-usage parts. The `sharedPartIds` array is bounded so the UI can render a
 * scannable list; the underlying count `sharedPartCount` is always the full overlap so a
 * "+N more" affordance can describe what was truncated honestly.
 *
 * Reuse honesty: shared MPN count is a *signal*, never a guarantee. Two projects sharing
 * 12 confirmed parts does not mean either project's assets are approved or verified for
 * export, and no copy in the UI should pretend otherwise.
 */
export interface ProjectOverlapPriorProject {
  project: Project;
  sharedPartCount: number;
  sharedPartIds: string[];
  /** Parallel to `sharedPartIds`: readable MPN labels for the same preview slice. */
  sharedPartsPreview: ProjectOverlapSharedPartPreview[];
}

/**
 * ProjectOverlapMemoryWarning surfaces durable "this bit us / this is blocked" engineering
 * memory for a part this project's BOM confirmed, so the mistake interrupts at import/overlap
 * time instead of waiting for someone to open the part. Only confirmed, unresolved records with
 * a `bit_us` outcome or `blocking` severity are surfaced; this is a reuse warning, never a gate.
 */
export interface ProjectOverlapMemoryWarning {
  partId: string;
  partMpn: string;
  recordId: string;
  recordKind: PartEngineeringRecordKind;
  severity: PartEngineeringRecordSeverity;
  outcome: PartEngineeringRecordOutcome | null;
  title: string;
  detail: string;
  relatedMpn: string | null;
  recordedBy: string | null;
  recordedAt: string;
}

/**
 * ProjectOverlapPanelResponse is the read-only payload that drives the day-zero overlap
 * panel on a project's detail page. The panel surfaces these things, each derived from
 * existing project-memory tables (no new schema):
 *  - the top prior projects ranked by shared confirmed-usage parts,
 *  - the count of connector-class parts present in this project's confirmed usage that
 *    also appear in prior project usages (the "this BOM uses a connector someone has
 *    wired before" hint),
 *  - the count of circuit-block roles that point at parts confirmed in this project
 *    (the "this BOM uses a part already proven in a reusable block" hint).
 *
 * Empty values are explicit so the UI can render an honest empty state rather than
 * hiding the panel and giving the impression that the data was never computed.
 */
export interface ProjectOverlapPanelResponse {
  state: ProjectMemoryReadState;
  projectId: string;
  /** Number of distinct confirmed-usage part ids that drove the overlap search. */
  scannedPartCount: number;
  /** Top prior projects ranked by shared confirmed-usage parts, descending. */
  priorProjects: ProjectOverlapPriorProject[];
  /** Distinct connector-class parts confirmed in this project (informational only). */
  connectorWhereUsedHitCount: number;
  /** Distinct circuit-block roles depending on parts confirmed in this project. */
  circuitBlockWhereUsedHitCount: number;
  /** Bounded preview of the circuit-block roles that depend on this project's confirmed parts. */
  circuitBlockRoleHitsPreview: ProjectOverlapCircuitBlockRolePreview[];
  /**
   * Confirmed "this bit us / this is blocked" engineering memory for parts this BOM confirmed —
   * the past mistake about to be repeated, surfaced at import time. Empty when none exist.
   */
  priorEngineeringMemoryWarnings: ProjectOverlapMemoryWarning[];
}

/** WhereUsedTargetType names supported and explicitly planned global where-used search targets. */
export type WhereUsedTargetType = "part" | "circuit_block" | "connector_set" | "asset" | "document" | "interconnect";

/** WhereUsedProjectUsageRecord joins global where-used rows to part and optional circuit-role context. */
export interface WhereUsedProjectUsageRecord {
  usage: ProjectPartUsage;
  project: Project;
  projectRevision: ProjectRevision;
  bomLine: BomLine | null;
  part: CircuitBlockPartCatalogSummary;
  circuitBlock: CircuitBlock | null;
  blockPart: CircuitBlockPart | null;
}

/** WhereUsedCircuitBlockDependencyRecord shows one circuit block role that depends on an internal part. */
export interface WhereUsedCircuitBlockDependencyRecord {
  circuitBlock: CircuitBlock;
  blockPart: CircuitBlockPart;
  part: CircuitBlockPartCatalogSummary;
}

/** WhereUsedAssetExportRecord reports one export bundle that included an asset matching the search query. */
export interface WhereUsedAssetExportRecord {
  bundleId: string;
  bundleFormat: ExportBundleFormat;
  bundleCreatedAt: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  assetId: string;
  assetType: string;
  partMpn: string;
  manufacturerName: string;
  fileFormat: string | null;
}

/** WhereUsedDocumentHitRecord reports one mapped project file that matched a clue search. */
export interface WhereUsedDocumentHitRecord {
  /** Project that owns the file mirror where the document was found. */
  project: Project;
  /** Current document-map row. This is a scan hint, not reviewed document metadata. */
  document: ProjectDocumentMapEntry;
  /** Plain labels explaining why the row matched the query. */
  matchedLabels: string[];
}

/** WhereUsedInterconnectHitKind names which interconnect record a where-used hit came from. */
export type WhereUsedInterconnectHitKind = "pin_map_row" | "cable_end" | "fixture_port";

/**
 * WhereUsedInterconnectHitRecord reports one persisted cable, fixture, or pin-map row that
 * matched a connector ref, cable id, fixture id, pin number, or signal name. It is recorded
 * interconnect memory, never proof a bench setup is safe, approved, or export-ready.
 */
export interface WhereUsedInterconnectHitRecord {
  kind: WhereUsedInterconnectHitKind;
  recordId: string;
  cableKey: string | null;
  fixtureKey: string | null;
  revisionLabel: string | null;
  status: InterconnectRecordStatus | null;
  endLabel: CableAssemblyEndLabel | null;
  connectorRef: string | null;
  pinNumber: string | null;
  signalName: string | null;
  destinationConnectorRef: string | null;
  destinationPinNumber: string | null;
  wireColor: string | null;
  wireGauge: number | null;
  confidenceScore: number | null;
  projectKey: string | null;
  /** Plain labels explaining why the row matched the query (e.g. "Connector ref J202", "Signal CAN_H"). */
  matchedLabels: string[];
}

/** WhereUsedSearchResponse powers the global where-used workspace without implying approved reuse. */
export interface WhereUsedSearchResponse {
  state: ProjectMemoryReadState;
  targetType: WhereUsedTargetType;
  query: string;
  supportedTarget: boolean;
  unsupportedReason: string | null;
  matchedParts: CircuitBlockPartCatalogSummary[];
  matchedCircuitBlocks: CircuitBlockSummary[];
  projectUsages: WhereUsedProjectUsageRecord[];
  circuitBlockDependencies: WhereUsedCircuitBlockDependencyRecord[];
  assetExports: WhereUsedAssetExportRecord[];
  documentHits: WhereUsedDocumentHitRecord[];
  interconnectHits: WhereUsedInterconnectHitRecord[];
  boundary: string;
}

/** ProjectBomHealthSummary counts explainable BOM health inputs without compressing them into a score. */
export interface ProjectBomHealthSummary {
  totalLineCount: number;
  matchedLineCount: number;
  unmatchedLineCount: number;
  ambiguousLineCount: number;
  weakMatchLineCount: number;
  ignoredLineCount: number;
  approvalGapCount: number;
  lifecycleRiskCount: number;
  /** Matched rows whose catalog lifecycle is obsolete or not_recommended and the part record was touched after the review checkpoint (zero when no checkpoint exists). */
  lifecycleRegressionCount: number;
  missingVerifiedCadCount: number;
  referencedCadOnlyCount: number;
  connectorBuildabilityGapCount: number;
  missingEvidenceCount: number;
  evidenceAttachmentCount: number;
}

/** ProjectBomRiskFinding explains one project BOM health gap with affected records and next action. */
export interface ProjectBomRiskFinding {
  id: string;
  projectId: string;
  code: ProjectBomRiskFindingCode;
  severity: ProjectBomRiskSeverity;
  title: string;
  detail: string;
  nextAction: string;
  affectedBomLineIds: string[];
  affectedPartIds: string[];
  inputs: string[];
}

/** ProjectBomHealthResponse returns the derived health dashboard for one project. */
export interface ProjectBomHealthResponse {
  state: ProjectMemoryReadState;
  projectId: string;
  generatedAt: string;
  /** Latest resolved/dismissed BOM health follow-up or accepted risk-finding evidence review time; regressions compare catalog part touch time after this instant. */
  lifecycleReviewCheckpointAt: string | null;
  summary: ProjectBomHealthSummary;
  findings: ProjectBomRiskFinding[];
}

/** EvidenceAttachment preserves decision evidence metadata without changing trust state. */
export interface EvidenceAttachment {
  id: string;
  targetType: EvidenceTargetType;
  targetId: string;
  evidenceType: EvidenceAttachmentType;
  title: string;
  sourceUrl: string | null;
  storageKey: string | null;
  fileHash: string | null;
  mimeType: string | null;
  notes: string | null;
  provenance: string;
  reviewStatus: EvidenceReviewStatus;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** EvidenceAttachmentCreateInput creates metadata-only decision evidence for a supported target. */
export interface EvidenceAttachmentCreateInput {
  targetType: EvidenceTargetType;
  targetId: string;
  evidenceType: EvidenceAttachmentType;
  title: string;
  sourceUrl?: string | null;
  storageKey?: string | null;
  fileHash?: string | null;
  mimeType?: string | null;
  notes?: string | null;
  provenance?: string | null;
  reviewStatus?: EvidenceReviewStatus;
}

/** EvidenceAttachmentCreateResponse returns the persisted evidence row and trust boundary copy. */
export interface EvidenceAttachmentCreateResponse {
  attachment: EvidenceAttachment;
  boundary: string;
}

/** EvidenceAttachmentFileUploadInput carries a browser-selected file through the API storage layer. */
export interface EvidenceAttachmentFileUploadInput {
  targetType: EvidenceTargetType;
  targetId: string;
  title: string;
  fileName: string;
  contentBase64: string;
  mimeType?: string | null;
  notes?: string | null;
  provenance?: string | null;
  reviewStatus?: EvidenceReviewStatus;
}

/** EvidenceAttachmentUpdateInput changes evidence review metadata without changing target trust state. */
export interface EvidenceAttachmentUpdateInput {
  reviewStatus: EvidenceReviewStatus;
  notes?: string | null;
}

/** EvidenceAttachmentUpdateResponse returns the edited evidence row and trust-boundary copy. */
export interface EvidenceAttachmentUpdateResponse {
  attachment: EvidenceAttachment;
  boundary: string;
}

/** EvidenceAttachmentListFilters are provider-neutral filters for the evidence vault. */
export interface EvidenceAttachmentListFilters {
  targetType?: EvidenceTargetType | null;
  evidenceType?: EvidenceAttachmentType | null;
  reviewStatus?: EvidenceReviewStatus | null;
  storageState?: EvidenceStorageState | null;
  sourceSystem?: string | null;
  query?: string | null;
}

/** EvidenceAttachmentListSummary counts visible evidence rows by storage and review state. */
export interface EvidenceAttachmentListSummary {
  totalCount: number;
  fileBackedCount: number;
  linkOnlyCount: number;
  noteOnlyCount: number;
  unreviewedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  supersededCount: number;
}

/** EvidenceAttachmentListResponse powers the global evidence vault workspace. */
export interface EvidenceAttachmentListResponse {
  state: ProjectMemoryReadState;
  filters: EvidenceAttachmentListFilters;
  summary: EvidenceAttachmentListSummary;
  attachments: EvidenceAttachment[];
  boundary: string;
}

/** ProjectEvidenceAttachmentsResponse lists evidence attached to a project or its project-memory children. */
export interface ProjectEvidenceAttachmentsResponse {
  state: ProjectMemoryReadState;
  projectId: string;
  attachments: EvidenceAttachment[];
}

/** FollowUpRecord stores assignable work derived from computed engineering-memory gaps. */
export interface FollowUpRecord {
  id: string;
  targetType: FollowUpTargetType;
  targetId: string;
  sourceType: FollowUpSourceType;
  sourceFindingId: string;
  title: string;
  detail: string;
  nextAction: string;
  severity: FollowUpSeverity;
  status: FollowUpStatus;
  assignedTo: string | null;
  sourceInputs: string[];
  evidenceAttachmentIds: string[];
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/** FollowUpListSummary counts work lifecycle states without rolling them into a score. */
export interface FollowUpListSummary {
  totalCount: number;
  openCount: number;
  inProgressCount: number;
  resolvedCount: number;
  dismissedCount: number;
  dangerCount: number;
  reviewCount: number;
}

/** FollowUpListResponse returns persisted follow-up queues for projects or circuit blocks. */
export interface FollowUpListResponse {
  state: ProjectMemoryReadState;
  targetType: FollowUpTargetType | null;
  targetId: string | null;
  followUps: FollowUpRecord[];
  summary: FollowUpListSummary;
}

/** FollowUpSyncResponse reports generated or refreshed follow-ups from computed inputs. */
export interface FollowUpSyncResponse {
  targetType: FollowUpTargetType;
  targetId: string;
  createdCount: number;
  refreshedCount: number;
  followUps: FollowUpRecord[];
  boundary: string;
}

/** FollowUpUpdateInput changes work ownership/status without changing underlying readiness truth. */
export interface FollowUpUpdateInput {
  status: FollowUpStatus;
  assignedTo?: string | null;
  resolutionNotes?: string | null;
  evidenceAttachmentIds?: string[] | null;
}

/** FollowUpUpdateResponse returns the edited follow-up and trust-boundary copy. */
export interface FollowUpUpdateResponse {
  followUp: FollowUpRecord;
  boundary: string;
}

/** CircuitBlock stores a reusable circuit as structured engineering memory. */
export interface CircuitBlock {
  id: string;
  blockKey: string;
  name: string;
  description: string;
  blockType: CircuitBlockType;
  owner: string | null;
  status: CircuitBlockStatus;
  reuseScope: string;
  constraints: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** CircuitBlockPart stores one part role inside a reusable circuit block. */
export interface CircuitBlockPart {
  id: string;
  circuitBlockId: string;
  partId: string;
  role: string;
  quantity: number | null;
  isRequired: boolean;
  substitutionPolicy: CircuitBlockPartSubstitutionPolicy;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** CircuitBlockPartCatalogSummary keeps block detail honest about current linked-part state. */
export interface CircuitBlockPartCatalogSummary {
  partId: string;
  mpn: string;
  manufacturerName: string;
  lifecycleStatus: LifecycleStatus;
  approvalStatus: PartApprovalStatus | null;
  readinessStatus: PartReadinessStatus | null;
  connectorClass: ConnectorClass | null;
  blockerCount: number | null;
}

/** CircuitBlockPartRecord joins a block role to the current catalog summary for that part. */
export interface CircuitBlockPartRecord {
  blockPart: CircuitBlockPart;
  part: CircuitBlockPartCatalogSummary;
}

/** CircuitBlockSummary reports list-level counts without converting them into opaque readiness scores. */
export interface CircuitBlockSummary {
  circuitBlock: CircuitBlock;
  totalPartCount: number;
  requiredPartCount: number;
  optionalPartCount: number;
  approvedPartCount: number;
  readinessGapCount: number;
  lifecycleRiskCount: number;
  strictSubstitutionCount: number;
  evidenceAttachmentCount: number;
  projectUsageCount: number;
  /** Count of unresolved known-risk rows on this block, across all severities. */
  activeKnownRiskCount: number;
  /** Count of unresolved known-risk rows on this block whose severity is `blocking`. */
  activeBlockingRiskCount: number;
}

/**
 * CircuitBlockKnownRiskSeverity classifies one engineering-memory observation by how the recording
 * engineer wants reuse to handle it. Lower severities are surfaced; only unresolved `blocking` rows
 * change reuse-readiness.
 *   - `info`        — neutral context (eg "Tested only with X-brand output capacitor").
 *   - `limitation`  — design constraint (eg "Max sustained 1.2A load").
 *   - `caution`     — review before reuse (eg "Inrush spike on cold start exceeded LDO ICC").
 *   - `blocking`    — do not reuse until resolved (eg "Silicon erratum makes this unsafe").
 */
export type CircuitBlockKnownRiskSeverity = "info" | "limitation" | "caution" | "blocking";

/**
 * CircuitBlockKnownRisk records one engineering-memory observation about a reusable circuit block.
 *
 * Provenance is first-class. `recordedBy` and `recordedAt` document who saw what, when; `resolvedAt`
 * preserves the original observation even after the team fixes the underlying issue. Resolving a risk
 * never deletes the row — projects that reused the block while the risk was open must still be auditable.
 */
export interface CircuitBlockKnownRisk {
  id: string;
  circuitBlockId: string;
  title: string;
  detail: string;
  severity: CircuitBlockKnownRiskSeverity;
  recordedBy: string | null;
  recordedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  evidenceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** CircuitBlockKnownRiskCreateInput defines the body of a known-risk create request. */
export interface CircuitBlockKnownRiskCreateInput {
  title: string;
  detail?: string | null;
  severity?: CircuitBlockKnownRiskSeverity;
  recordedBy?: string | null;
  evidenceUrl?: string | null;
}

/** CircuitBlockKnownRiskResolveInput defines the body of a known-risk resolve request. */
export interface CircuitBlockKnownRiskResolveInput {
  resolvedBy?: string | null;
  resolutionNotes?: string | null;
}

/**
 * CircuitBlockKnownRiskMutationResponse returns both the affected risk row and the rebuilt
 * circuit-block detail (so the UI can refresh the strip and any derived counts in one round-trip).
 * The boundary copy repeats the honesty contract that recording or resolving a risk does not
 * approve linked parts, validate assets, or unlock export.
 */
export interface CircuitBlockKnownRiskMutationResponse {
  knownRisk: CircuitBlockKnownRisk;
  detail: CircuitBlockDetailResponse;
  boundary: string;
}

/** CircuitBlockProjectDependency records a project whose confirmed usages overlap with a circuit block's part roles. */
export interface CircuitBlockProjectDependency {
  project: Project;
  matchedPartCount: number;
  totalBlockPartCount: number;
}

/** CircuitBlockListResponse returns the reusable circuit library. */
export interface CircuitBlockListResponse {
  state: ProjectMemoryReadState;
  circuitBlocks: CircuitBlockSummary[];
  /** Filters that were applied to produce this response (echoed so the UI can reflect server-side state). */
  filters: CircuitBlockListFilters;
}

/** CircuitBlockReuseReadinessFilter narrows the library to blocks that match a derived reuse-readiness verdict. */
export type CircuitBlockReuseReadinessFilter = "reusable" | "pending" | "blocked";

/** CircuitBlockListFilters describes optional library filters. None of these change linked-part trust. */
export interface CircuitBlockListFilters {
  /** Free-text search across block key, name, description, owner, and reuse scope. */
  query: string | null;
  /** Optional block type filter. */
  blockType: CircuitBlockType | null;
  /** Optional block status filter. */
  status: CircuitBlockStatus | null;
  /** Optional owner filter (exact, case-insensitive match). */
  owner: string | null;
  /** Optional reuse-readiness verdict filter applied after summary aggregation. */
  reuseReadiness: CircuitBlockReuseReadinessFilter | null;
}

/** CircuitBlockDetailResponse returns one circuit block with parts, evidence, project dependencies, and trust boundaries. */
export interface CircuitBlockDetailResponse {
  state: "available";
  circuitBlock: CircuitBlock;
  summary: CircuitBlockSummary;
  parts: CircuitBlockPartRecord[];
  evidence: EvidenceAttachment[];
  projectDependencies: CircuitBlockProjectDependency[];
  instantiations: CircuitBlockInstantiationHistoryRecord[];
  /**
   * Known risks and limitations recorded against this block. Rows are newest-first by `recordedAt`,
   * with unresolved rows always returned (engineering memory never disappears). Resolved rows are
   * included so the UI can render historical context and so audits can prove a block was in a
   * particular state when a project reused it.
   */
  knownRisks: CircuitBlockKnownRisk[];
  boundary: string;
}

/**
 * PartEngineeringRecordKind classifies one piece of private engineering memory about a part.
 * These are the questions a public component aggregator structurally cannot answer:
 *   - `outcome`               — did this part work in real designs, or did it bite us?
 *   - `harness_mate_verified` — a connector that actually mated correctly in a real harness.
 *   - `cad_physical_verified` — a CAD/footprint/3D asset checked against the physical part.
 *   - `dependency`            — a test fixture, board, cable, or program that depended on it.
 *   - `decision_blocked`      — why this part was restricted/blocked; the mistake not to repeat.
 *   - `note`                  — free-form tribal knowledge for the next engineer.
 */
export type PartEngineeringRecordKind =
  | "outcome"
  | "harness_mate_verified"
  | "cad_physical_verified"
  | "dependency"
  | "decision_blocked"
  | "note";

/** PartEngineeringRecordSeverity reuses the known-risk severity ladder; only the engineer sets it. */
export type PartEngineeringRecordSeverity = CircuitBlockKnownRiskSeverity;

/**
 * PartEngineeringRecordOutcome is the recording engineer's verdict for outcome/verification
 * records. `not_verified` explicitly preserves "we tried to verify and could not", which is
 * itself engineering memory worth keeping.
 */
export type PartEngineeringRecordOutcome = "worked" | "worked_with_caveats" | "bit_us" | "not_verified";

/**
 * PartEngineeringRecord is one durable, provenance-bearing observation or decision about a part.
 *
 * Provenance is first-class. `recordedBy`/`recordedAt` document who saw what, when; `resolvedAt`
 * preserves the original observation even after the underlying issue is addressed. Recording or
 * resolving a record never approves the part, validates an asset, or unlocks export.
 */
export interface PartEngineeringRecord {
  id: string;
  partId: string;
  recordKind: PartEngineeringRecordKind;
  title: string;
  detail: string;
  severity: PartEngineeringRecordSeverity;
  /** Engineer verdict for outcome/verification kinds; null for note/dependency/decision rows. */
  outcome: PartEngineeringRecordOutcome | null;
  /** Trusted footprint/symbol/3D asset this record is about (Q5/Q8), null when not asset-scoped. */
  relatedAssetId: string | null;
  /** Datasheet revision the team designed from (Q6), null when not revision-scoped. */
  datasheetRevisionId: string | null;
  /** Counterpart connector MPN actually mated in the real harness (Q7). */
  relatedMpn: string | null;
  /** Test fixture / board / cable / program that depended on this part (Q9). */
  dependedOnBy: string | null;
  recordedBy: string | null;
  recordedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  evidenceUrl: string | null;
  /**
   * Draft lifecycle. `confirmed` is durable engineering memory (all manual records, and
   * auto-drafts a human accepted). `proposed` is a machine suggestion awaiting review — it never
   * counts toward any gate. `dismissed` is a rejected suggestion, preserved for audit.
   */
  draftStatus: PartEngineeringRecordDraftStatus;
  /** How the row originated; `manual` for hand-entered, `auto_*` for passive capture. */
  draftSource: PartEngineeringRecordDraftSource;
  /** Originating substitution/bundle id for an auto-draft, used for idempotent dedup. */
  triggerRef: string | null;
  /** Who accepted a proposed auto-draft into durable memory, and when. */
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** PartEngineeringRecordDraftStatus is the review lifecycle of one record. */
export type PartEngineeringRecordDraftStatus = "proposed" | "confirmed" | "dismissed";

/** PartEngineeringRecordDraftSource records whether a row was hand-entered or passively captured. */
export type PartEngineeringRecordDraftSource = "manual" | "auto_substitution" | "auto_export" | "auto_bom_lifecycle";

/** PartEngineeringRecordCreateInput defines the body of a create request. */
export interface PartEngineeringRecordCreateInput {
  recordKind: PartEngineeringRecordKind;
  title: string;
  detail?: string | null;
  severity?: PartEngineeringRecordSeverity;
  outcome?: PartEngineeringRecordOutcome | null;
  relatedAssetId?: string | null;
  datasheetRevisionId?: string | null;
  relatedMpn?: string | null;
  dependedOnBy?: string | null;
  recordedBy?: string | null;
  evidenceUrl?: string | null;
}

/** PartEngineeringRecordResolveInput defines the body of a resolve request. */
export interface PartEngineeringRecordResolveInput {
  resolvedBy?: string | null;
  resolutionNotes?: string | null;
}

/**
 * PartEngineeringRecordDraftDecisionInput is the body of a confirm/dismiss request on a proposed
 * auto-draft. The acting user comes from the session; notes are optional dismissal context.
 */
export interface PartEngineeringRecordDraftDecisionInput {
  notes?: string | null;
}

/**
 * PartEngineeringRecordListResponse buckets records for the UI:
 *   - `proposed`: machine suggestions from passive capture awaiting human review (never a gate)
 *   - `open`: confirmed, durable, unresolved engineering memory
 *   - `resolved`: resolved or dismissed rows, retained for audit
 * The boundary copy repeats the honesty contract.
 */
export interface PartEngineeringRecordListResponse {
  partId: string;
  proposed: PartEngineeringRecord[];
  open: PartEngineeringRecord[];
  resolved: PartEngineeringRecord[];
  boundary: string;
}

/**
 * PartEngineeringRecordMutationResponse returns the affected record plus the rebuilt list so the
 * UI can refresh in one round-trip without a follow-up read.
 */
export interface PartEngineeringRecordMutationResponse {
  record: PartEngineeringRecord;
  list: PartEngineeringRecordListResponse;
  boundary: string;
}

/**
 * PartEngineeringMemoryWarningPreview is one scan-time line of durable "this bit us / blocking"
 * memory, used to interrupt at part-selection surfaces (catalog search, part detail, BOM match).
 */
export interface PartEngineeringMemoryWarningPreview {
  recordId: string;
  recordKind: PartEngineeringRecordKind;
  severity: PartEngineeringRecordSeverity;
  outcome: PartEngineeringRecordOutcome | null;
  title: string;
}

/**
 * PartEngineeringMemoryWarningSummary is a read-only per-part projection of confirmed, unresolved
 * `bit_us`/`blocking` engineering memory. It is a reuse warning surfaced where engineers choose a
 * part; it never changes approval, validation, readiness, or export state.
 */
export interface PartEngineeringMemoryWarningSummary {
  /** Confirmed, unresolved records with a `bit_us` outcome or `blocking` severity. */
  warningCount: number;
  /** Subset of `warningCount` whose severity is `blocking`. */
  blockingCount: number;
  /** Newest-first, severity-first bounded preview for scan-time context. */
  preview: PartEngineeringMemoryWarningPreview[];
}

/** CircuitBlockInstantiationHistoryRecord pairs one instantiation event with its project, revision, and BOM import context. */
export interface CircuitBlockInstantiationHistoryRecord {
  instantiation: CircuitBlockInstantiation;
  project: Project;
  revision: ProjectRevision;
  bomImport: BomImport | null;
  /** Count of BOM lines that were generated from this instantiation. Recorded as engineering memory, not a trust signal. */
  instantiatedBomLineCount: number;
}

/** CircuitBlockInstantiation records one event of generating BOM lines from a reusable circuit block. */
export interface CircuitBlockInstantiation {
  id: string;
  circuitBlockId: string;
  projectId: string;
  projectRevisionId: string;
  bomImportId: string;
  includeOptional: boolean;
  designatorPrefix: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** CircuitBlockInstantiationCreateInput requests a new BOM import from a reusable circuit block. */
export interface CircuitBlockInstantiationCreateInput {
  circuitBlockId: string;
  projectRevisionId: string;
  /** When true, optional block-part roles are also instantiated. Required parts are always included. */
  includeOptional?: boolean;
  /** Optional designator prefix; when set, designators are auto-generated as "<prefix>1, <prefix>2, ..." per quantity. */
  designatorPrefix?: string | null;
  notes?: string | null;
}

/** CircuitBlockInstantiationCreateResponse returns the new BOM import, lines, and instantiation record. */
export interface CircuitBlockInstantiationCreateResponse {
  instantiation: CircuitBlockInstantiation;
  bomImport: BomImport;
  bomLines: BomLine[];
  matchedLineCount: number;
  skippedOptionalCount: number;
  boundary: string;
}

/** CircuitBlockCreateInput creates a structured reusable circuit record. */
export interface CircuitBlockCreateInput {
  blockKey: string;
  name: string;
  description?: string | null;
  blockType: CircuitBlockType;
  owner?: string | null;
  status?: CircuitBlockStatus;
  reuseScope?: string | null;
  constraints?: Record<string, unknown> | null;
}

/** CircuitBlockUpdateInput edits reusable circuit metadata without changing linked part trust. */
export interface CircuitBlockUpdateInput {
  name: string;
  description?: string | null;
  blockType: CircuitBlockType;
  owner?: string | null;
  status: CircuitBlockStatus;
  reuseScope?: string | null;
  constraints?: Record<string, unknown> | null;
}

/** CircuitBlockCreateResponse returns the saved block and its empty detail shell. */
export interface CircuitBlockCreateResponse {
  circuitBlock: CircuitBlock;
  detail: CircuitBlockDetailResponse;
  boundary: string;
}

/** CircuitBlockUpdateResponse returns the updated block and refreshed detail shell. */
export interface CircuitBlockUpdateResponse {
  circuitBlock: CircuitBlock;
  detail: CircuitBlockDetailResponse;
  boundary: string;
}

/** CircuitBlockPartCreateInput links one internal part into a circuit block role. */
export interface CircuitBlockPartCreateInput {
  partId: string;
  role: string;
  quantity?: number | null;
  isRequired?: boolean;
  substitutionPolicy?: CircuitBlockPartSubstitutionPolicy;
  notes?: string | null;
}

/** CircuitBlockPartUpdateInput edits role metadata without changing the linked part identity. */
export interface CircuitBlockPartUpdateInput {
  quantity?: number | null;
  isRequired: boolean;
  substitutionPolicy: CircuitBlockPartSubstitutionPolicy;
  notes?: string | null;
}

/** CircuitBlockPartCreateResponse returns the saved role and refreshed block detail. */
export interface CircuitBlockPartCreateResponse {
  circuitBlockPart: CircuitBlockPart;
  detail: CircuitBlockDetailResponse;
  boundary: string;
}

/** CircuitBlockPartUpdateResponse returns the updated role and refreshed block detail. */
export interface CircuitBlockPartUpdateResponse {
  circuitBlockPart: CircuitBlockPart;
  detail: CircuitBlockDetailResponse;
  boundary: string;
}

/** PartMetric stores one normalized datasheet metric with confidence and provenance. */
export interface PartMetric {
  id: string;
  partId: string;
  metricKey: string;
  metricValue: number | null;
  unit: MetricUnit;
  minValue: number | null;
  maxValue: number | null;
  confidenceScore: number;
  sourceRevisionId: string;
  sourceRecordId: string | null;
  lastUpdatedAt: string;
}

/** Asset tracks metadata, storage, validation, preview, and source provenance for files. */
export interface Asset {
  id: string;
  partId: string;
  assetType: AssetType;
  fileFormat: FileFormat;
  storageKey: string | null;
  fileHash: string | null;
  providerId: string | null;
  licenseMode: LicenseMode;
  provenance: AssetProvenance;
  availabilityStatus: AssetAvailabilityStatus;
  reviewStatus: AssetReviewStatus;
  exportStatus: AssetExportStatus;
  /** Legacy availability mirror for older code paths and migrations. */
  assetState: AssetState;
  /** Legacy combined review/export mirror for older code paths and migrations. */
  assetStatus: AssetStatus;
  generationMethod: string | null;
  generationSourceAssetId: string | null;
  validationStatus: ValidationStatus;
  previewStatus: PreviewStatus;
  /**
   * Storage key for the derived bytes the inline previewer should render. Null when the
   * preview channel has no rendering target -- either because the source format is non-
   * embeddable and no converter has produced an artifact yet, or because the asset has no
   * preview at all. A null artifact key combined with a `previewStatus` of `ready` is only
   * valid when the source `fileFormat` is itself directly embeddable (pdf / png / jpg / jpeg /
   * webp / glb / gltf); the worker normalization helper enforces this discipline at write time.
   */
  previewArtifactStorageKey: string | null;
  /** Format of the bytes at `previewArtifactStorageKey`; null mirrors a null artifact key. */
  previewArtifactFormat: AssetPreviewArtifactFormat | null;
  /** ISO timestamp when the preview artifact was generated; null when no artifact exists. */
  previewArtifactGeneratedAt: string | null;
  /** Where the preview artifact bytes came from; null when no artifact exists. */
  previewArtifactSource: AssetPreviewArtifactSource | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  lastUpdatedAt: string;
}

/** DatasheetRevision stores parsed datasheet revision metadata and parse confidence. */
export interface DatasheetRevision {
  id: string;
  partId: string;
  revisionLabel: string;
  revisionDate: string | null;
  pageCount: number | null;
  fileAssetId: string | null;
  parseConfidence: number;
  pinTableStatus: DatasheetExtractionStatus;
  sourceRecordId: string | null;
  lastUpdatedAt: string;
}

/** DocumentControlAssetSummary exposes only asset metadata needed to review a controlled document row. */
export interface DocumentControlAssetSummary {
  id: string;
  partId: string;
  assetType: AssetType;
  fileFormat: FileFormat;
  storageKey: string | null;
  fileHash: string | null;
  provenance: AssetProvenance;
  availabilityStatus: AssetAvailabilityStatus;
  sourceUrl: string | null;
}

/** ControlledDocumentAclEntry records a review/access grant without embedding directory-specific user data. */
export interface ControlledDocumentAclEntry {
  id: string;
  documentRevisionId: string;
  principalType: DocumentAclPrincipalType;
  principalId: string;
  permission: DocumentAclPermission;
  grantedBy: string;
  expiresAt: string | null;
  createdAt: string;
}

/** DocumentRedline is one engineering review note tied to a controlled document revision. */
export interface DocumentRedline {
  id: string;
  documentRevisionId: string;
  redlineStatus: DocumentRedlineStatus;
  pageNumber: number | null;
  anchorText: string | null;
  note: string;
  severity: DocumentRedlineSeverity;
  createdBy: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** ControlledDocumentRevision links one catalog asset to revision, supersession, access, and review history. */
export interface ControlledDocumentRevision {
  id: string;
  partId: string;
  assetId: string;
  documentType: DocumentControlType;
  revisionLabel: string;
  revisionDate: string | null;
  lifecycleStatus: DocumentRevisionLifecycleStatus;
  accessLevel: DocumentAccessLevel;
  accessNotes: string;
  effectiveAt: string | null;
  expiresAt: string | null;
  supersedesDocumentRevisionId: string | null;
  supersededByDocumentRevisionId: string | null;
  sourceAssetHash: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  asset: DocumentControlAssetSummary;
  aclEntries: ControlledDocumentAclEntry[];
  redlines: DocumentRedline[];
}

/** DocumentAclEntryCreateInput records one initial grant when creating a controlled revision. */
export interface DocumentAclEntryCreateInput {
  principalType: DocumentAclPrincipalType;
  principalId: string;
  permission: DocumentAclPermission;
  expiresAt?: string | null;
}

/** DocumentRevisionCreateInput creates a controlled revision from an existing document asset. */
export interface DocumentRevisionCreateInput {
  assetId: string;
  documentType?: DocumentControlType;
  revisionLabel: string;
  revisionDate?: string | null;
  lifecycleStatus?: DocumentRevisionLifecycleStatus;
  accessLevel?: DocumentAccessLevel;
  accessNotes?: string | null;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  supersedesDocumentRevisionId?: string | null;
  aclEntries?: DocumentAclEntryCreateInput[];
}

/** DocumentRedlineCreateInput captures an engineering redline note without changing document release state. */
export interface DocumentRedlineCreateInput {
  note: string;
  severity?: DocumentRedlineSeverity;
  pageNumber?: number | null;
  anchorText?: string | null;
}

/** DocumentRedlineUpdateInput changes review-note state or text without mutating the underlying asset. */
export interface DocumentRedlineUpdateInput {
  redlineStatus: DocumentRedlineStatus;
  note?: string | null;
}

/** DocumentRevisionListResponse returns controlled document history for one part workspace. */
export interface DocumentRevisionListResponse {
  partId: string;
  state: ProjectMemoryReadState;
  revisions: ControlledDocumentRevision[];
  boundary: string;
}

/** DocumentRevisionCreateResponse returns the created revision plus refreshed document-control history. */
export interface DocumentRevisionCreateResponse {
  revision: ControlledDocumentRevision;
  documentControl: DocumentRevisionListResponse;
  boundary: string;
}

/** DocumentRedlineCreateResponse returns the created redline plus refreshed document-control history. */
export interface DocumentRedlineCreateResponse {
  redline: DocumentRedline;
  documentControl: DocumentRevisionListResponse;
  boundary: string;
}

/** DocumentRedlineUpdateResponse returns the updated redline plus refreshed document-control history. */
export interface DocumentRedlineUpdateResponse {
  redline: DocumentRedline;
  documentControl: DocumentRevisionListResponse;
  boundary: string;
}

/** MateRelation stores best/alternate mating connector relationships. */
export interface MateRelation {
  id: string;
  partId: string;
  matePartId: string;
  relationshipType: "best_mate" | "alternate_mate";
  compatibilityStatus: ConnectorRelationCompatibilityStatus;
  evidenceKind: ConnectorEvidenceKind;
  confidenceScore: number;
  sourceRevisionId: string;
  sourceRecordId: string | null;
  notes: string | null;
}

/** AccessoryRequirement stores required, optional, and tooling accessory relationships. */
export interface AccessoryRequirement {
  id: string;
  partId: string;
  accessoryPartId: string;
  relationshipType: "requires_accessory" | "optional_accessory" | "tooling_requirement";
  compatibilityStatus: ConnectorRelationCompatibilityStatus;
  evidenceKind: ConnectorEvidenceKind;
  confidenceScore: number;
  sourceRevisionId: string;
  sourceRecordId: string | null;
  notes: string | null;
}

/** CableCompatibility tracks compatible cables for connector parts. */
export interface CableCompatibility {
  id: string;
  partId: string;
  cablePartId: string;
  relationshipType: "supports_cable";
  wireGaugeMin: number | null;
  wireGaugeMax: number | null;
  shieldingRequirement: CableShieldingRequirement;
  terminationStyle: CableTerminationStyle;
  compatibilityStatus: CableCompatibilityStatus;
  confidenceScore: number;
  sourceRevisionId: string;
  sourceRecordId: string | null;
  notes: string | null;
}

/** ConnectorFamilyConflictType distinguishes near-match variants from true family confusion. */
export type ConnectorFamilyConflictType = "near_match_variant" | "family_confusion";

/** ConnectorFamilyConflict stores one persisted connector-family ambiguity candidate. */
export interface ConnectorFamilyConflict {
  id: string;
  partId: string;
  candidatePartId: string;
  candidateConnectorFamilyId: string | null;
  conflictType: ConnectorFamilyConflictType;
  confidenceScore: number;
  summary: string;
  detail: string;
  sourceRecordId: string | null;
  lastUpdatedAt: string;
}

/** SimilarPartRelation stores cross-suggested alternatives with confidence. */
export interface SimilarPartRelation {
  id: string;
  partId: string;
  similarPartId: string;
  confidenceScore: number;
  reason: string;
}

/** CompanionRecommendation stores frequently paired companion components. */
export interface CompanionRecommendation {
  id: string;
  partId: string;
  companionPartId: string;
  confidenceScore: number;
  usageContext: string;
}

/** GenerationWorkflow tracks datasheet-driven CAD generation opportunities and status. */
export interface GenerationWorkflow {
  id: string;
  partId: string;
  targetAssetType: GenerationTargetAssetType;
  sourceDatasheetRevisionId: string | null;
  sourceAssetId: string | null;
  generationStatus: GenerationStatus;
  confidenceScore: number;
  outputAssetId: string | null;
}

/** GenerationRequest persists an explicit request without implying the output exists. */
export interface GenerationRequest {
  id: string;
  partId: string;
  targetAssetType: GenerationTargetAssetType;
  sourceDatasheetRevisionId: string | null;
  sourceAssetId: string | null;
  requestStatus: GenerationRequestStatus;
  requestedAt: string;
  requestedBy: string;
  workflowId: string | null;
  lastUpdatedAt: string;
}

/** ReviewRecord persists one explicit asset or workflow review decision. */
export interface ReviewRecord {
  id: string;
  partId: string;
  targetType: ReviewTargetType;
  assetId: string | null;
  generationWorkflowId: string | null;
  outcome: ReviewOutcome;
  reviewer: string;
  notes: string | null;
  reviewedAt: string;
  lastUpdatedAt: string;
}

/** AssetValidationRecord persists one concrete validation evidence item for an asset. */
export interface AssetValidationRecord {
  id: string;
  partId: string;
  assetId: string;
  validationStatus: ValidationStatus;
  validationType: AssetValidationType;
  validationNotes: string | null;
  validatedAt: string;
  validator: string;
  lastUpdatedAt: string;
}

/** AssetPromotionAuditRecord persists one explicit export-promotion attempt. */
export interface AssetPromotionAuditRecord {
  id: string;
  partId: string;
  assetId: string;
  priorExportStatus: AssetExportStatus;
  newExportStatus: AssetExportStatus;
  promotionOutcome: AssetPromotionOutcome;
  blockerReasons: string[];
  validationRecordId: string | null;
  actor: string;
  createdAt: string;
}

/** ReviewStatusSummary is the API-ready latest review state for one target. */
export interface ReviewStatusSummary {
  targetType: ReviewTargetType;
  targetId: string;
  state: ReviewState;
  latestReview: ReviewRecord | null;
}

/** AssetValidationSummary exposes latest validation evidence without making the UI infer it. */
export interface AssetValidationSummary {
  assetId: string;
  latestValidation: AssetValidationRecord | null;
  label: string;
  reason: string;
}

/** AssetPromotionSummary exposes promotion history and current blocker reasons for one asset. */
export interface AssetPromotionSummary {
  assetId: string;
  latestPromotion: AssetPromotionAuditRecord | null;
  promotionHistory: AssetPromotionAuditRecord[];
  canPromote: boolean;
  blockerReasons: string[];
  label: string;
}

/** SourceReadinessRequirement names the source material checked before a request can be made. */
export type SourceReadinessRequirement = "package_mechanical_data" | "pin_table_data" | "mechanical_drawing";

/** GenerationSourceReadiness explains whether a target has enough reviewed source material. */
export interface GenerationSourceReadiness {
  targetAssetType: GenerationTargetAssetType;
  requiredMaterial: SourceReadinessRequirement;
  ready: boolean;
  reasons: string[];
  sourceDatasheetRevisionId: string | null;
  sourceAssetId: string | null;
  extractionSignalIds: string[];
  extractionConfidence: number;
}

/** AssetClassReadiness summarizes the best concrete evidence for one asset class. */
export type AssetClassReadiness = "export_ready" | "validated_file" | "downloaded_file" | "reference_only" | "missing" | "failed";

/** AssetClassSummary groups all assets for one class and identifies the best candidate. */
export interface AssetClassSummary {
  assetType: EngineeringAssetClass;
  assets: Asset[];
  bestAsset: Asset | null;
  readiness: AssetClassReadiness;
}

/** BundleReadinessState names the honest export readiness state shown by API and UI. */
export type BundleReadinessState = "bundle_ready" | "partial_bundle" | "references_only" | "no_usable_assets";

/** BundleReadinessSummary describes bundle readiness without implying nonexistent files. */
export interface BundleReadinessSummary {
  state: BundleReadinessState;
  label: string;
  reason: string;
  verifiedCadAssetCount: number;
  fileBackedCadAssetCount: number;
  referencedAssetCount: number;
  exportActions: ExportAvailability[];
}

/** AssetGenerationOption is the typed request foundation for a missing asset workflow. */
export interface AssetGenerationOption {
  targetAssetType: GenerationTargetAssetType;
  label: string;
  reason: string;
  actionLabel: string;
  canRequest: boolean;
  workflowStatus: GenerationWorkflowState;
  workflowStatusLabel: string;
  sourceReadiness: GenerationSourceReadiness;
  latestRequest: GenerationRequest | null;
  workflow: GenerationWorkflow | null;
  workflowId: string | null;
  generationStatus: GenerationStatus;
  confidenceScore: number;
  sourceAssetId: string | null;
  sourceDatasheetRevisionId: string | null;
}

/** ConnectorWarningCode keeps compatibility concerns structured instead of flattening everything into one string list. */
export type ConnectorWarningCode =
  | "support_without_best_mate"
  | "best_mate_low_confidence"
  | "near_match_alternates"
  | "family_confusion"
  | "missing_accessory_coverage"
  | "required_accessory_low_confidence"
  | "tooling_low_confidence"
  | "cable_without_best_mate"
  | "cable_low_confidence";

/** ConnectorWarningTone keeps connector warnings visually aligned with existing review and danger surfaces. */
export type ConnectorWarningTone = "review" | "danger";

/** ConnectorWarning stores one structured connector-compatibility concern for detail, search, and admin surfaces. */
export interface ConnectorWarning {
  code: ConnectorWarningCode;
  summary: string;
  detail: string;
  tone: ConnectorWarningTone;
}

/** ConnectorCableAssumptionType identifies the kind of cable-side assumption extracted from stored notes. */
export type ConnectorCableAssumptionType = "wire_gauge" | "shielding" | "termination_style" | "environment";

/** ConnectorCableAssumption keeps cable constraints explicit without pretending they were fully validated. */
export interface ConnectorCableAssumption {
  cablePartId: string;
  sourceNote: string;
  summary: string;
  type: ConnectorCableAssumptionType;
}

/** ConnectorConfidenceBreakdown exposes how the buildable-set confidence was derived across relationship groups. */
export interface ConnectorConfidenceBreakdown {
  bestMateScore: number | null;
  cableScore: number | null;
  directEvidenceCount: number;
  evidenceCount: number;
  inferredEvidenceCount: number;
  optionalAccessoryScore: number | null;
  overallScore: number | null;
  requiredAccessoryScore: number | null;
  toolingScore: number | null;
  uncertainEvidenceCount: number;
  verifiedEvidenceCount: number;
}

/** BuildableMatingSet is the API-ready recommendation for procurement-friendly assembly. */
export interface BuildableMatingSet {
  bestMate: MateRelation | null;
  alternateMates: MateRelation[];
  cableAssumptions: ConnectorCableAssumption[];
  familyConflicts: ConnectorFamilyConflict[];
  optionalAccessories: AccessoryRequirement[];
  requiredAccessories: AccessoryRequirement[];
  toolingRequirements: AccessoryRequirement[];
  cableOptions: CableCompatibility[];
  /** Aggregate relationship confidence for the current buildable set, or null when no evidence exists. */
  confidenceScore: number | null;
  /** Relationship-group confidence makes the overall score auditable instead of opaque. */
  confidenceBreakdown: ConnectorConfidenceBreakdown;
  /** Compact warnings when connector evidence is incomplete or low-confidence. */
  warnings: string[];
  /** Structured warning details power richer connector review surfaces without UI-only heuristics. */
  warningDetails: ConnectorWarning[];
}

/** ConnectorSetIntentInput is the structured and free-text resolver request. */
export interface ConnectorSetIntentInput {
  /** Family, series, or application class requested by the engineer, such as "JST PH". */
  class: string;
  /** Optional free-text query from the connector-set workspace search box. */
  query?: string | null;
  /** Optional requested circuit count or contact count. */
  pinCount?: number | null;
  /** Optional environmental sealing intent, such as sealed, unsealed, or IP67. */
  sealing?: string | null;
  /** Optional cable gauge intent in AWG. */
  cableGauge?: number | null;
}

/** ConnectorSetBuildabilityState keeps missing evidence visible instead of hiding incomplete sets. */
export type ConnectorSetBuildabilityState = "buildable" | "pending" | "not_buildable";

/** ConnectorSetResolvedPartSummary is the compact identity used inside resolver candidates. */
export interface ConnectorSetResolvedPartSummary {
  partId: string;
  mpn: string;
  manufacturerName: string;
  connectorClass: ConnectorClass;
  lifecycleStatus: LifecycleStatus;
  packagePinCount: number | null;
  connectorFamilyName: string | null;
}

/** ConnectorSetResolvedRelation keeps related-part provenance and confidence together. */
export interface ConnectorSetResolvedRelation {
  part: ConnectorSetResolvedPartSummary;
  confidenceScore: number;
  compatibilityStatus: ConnectorRelationCompatibilityStatus | CableCompatibilityStatus;
  evidenceKind: ConnectorEvidenceKind | "cable_compatibility";
  notes: string | null;
}

/** ConnectorSetIntentCandidate is one possible connector plus mate/accessory/cable/tooling set. */
export interface ConnectorSetIntentCandidate {
  connector: ConnectorSetResolvedPartSummary;
  mate: ConnectorSetResolvedRelation | null;
  requiredAccessories: ConnectorSetResolvedRelation[];
  optionalAccessories: ConnectorSetResolvedRelation[];
  cableOption: ConnectorSetResolvedRelation | null;
  tooling: ConnectorSetResolvedRelation[];
  buildabilityState: ConnectorSetBuildabilityState;
  confidenceScore: number;
  familyConfusionWarnings: ConnectorWarning[];
  warnings: ConnectorWarning[];
}

/** ConnectorSetIntentResolution returns candidates without treating warnings as buildability proof. */
export interface ConnectorSetIntentResolution {
  state: ProjectMemoryReadState;
  intent: ConnectorSetIntentInput;
  candidates: ConnectorSetIntentCandidate[];
  boundary: string;
}

/** CAD availability filters let search distinguish exportable records from unavailable ones. */
export type CadAvailabilityFilter = "any" | "available" | "unavailable";

/** PartSearchSort names stable SQL-backed search sort modes. */
export type PartSearchSort = "mpn_asc" | "mpn_desc" | "updated_desc" | "trust_desc";

/** PartSearchFilters are provider-neutral search filters accepted by API and UI. */
export interface PartSearchFilters {
  query?: string | undefined;
  manufacturerId?: string | undefined;
  category?: string | undefined;
  packageId?: string | undefined;
  lifecycleStatus?: LifecycleStatus | undefined;
  cadAvailability?: CadAvailabilityFilter | undefined;
  providerPartId?: string | undefined;
  providerUrl?: string | undefined;
  datasheetUrl?: string | undefined;
  readinessStatus?: PartReadinessStatus | undefined;
  approvalStatus?: PartApprovalStatus | undefined;
  connectorClass?: ConnectorClass | undefined;
  /** One-based result page used by SQL-backed search. */
  page?: number | undefined;
  /** Bounded page size used by SQL-backed search. */
  pageSize?: number | undefined;
  /** Stable sort mode used by SQL-backed search. */
  sort?: PartSearchSort | undefined;
}

/** PartReadinessSummary exposes whole-part readiness as API truth instead of UI-only inference. */
export interface PartReadinessSummary {
  partId: string;
  status: PartReadinessStatus;
  label: string;
  detail: string;
  identityStatus: PartIdentityStatus;
  connectorClass: ConnectorClass;
  blockerCount: number;
  blockerSummary: string[];
  recommendedActions: string[];
  lastEvaluatedAt: string;
}

/** PartApproval exposes part-level approval separately from asset review and export promotion. */
export interface PartApproval {
  partId: string;
  status: PartApprovalStatus;
  summary: string;
  detail: string;
  evidence: string[];
  decidedBy: string | null;
  decidedAt: string | null;
  lastUpdatedAt: string;
}

/** PartDuplicateCandidate stores one DB-backed possible duplicate match for an existing part. */
export interface PartDuplicateCandidate {
  id: string;
  partId: string;
  duplicatePartId: string;
  duplicatePartMpn: string;
  duplicateManufacturerName: string;
  detectionSource: string;
  confidenceScore: number;
  summary: string;
  detail: string;
  lastUpdatedAt: string;
}

/** PartIssue stores one backend-derived blocker or follow-up task for a part record. */
export interface PartIssue {
  id: string;
  partId: string;
  code: PartIssueCode;
  severity: PartIssueSeverity;
  status: PartIssueWorkflowStatus;
  assignedTo: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  summary: string;
  detail: string;
  source: string;
  lastUpdatedAt: string;
}

/** PartRiskFlag stores one compact risk chip for dense search/detail/admin rendering. */
export interface PartRiskFlag {
  id: string;
  partId: string;
  code: PartRiskFlagCode;
  label: string;
  detail: string;
  tone: "review" | "danger";
  lastUpdatedAt: string;
}

/** SourceReconciliationRecord stores operator-selected source handling for source-conflict follow-up. */
export interface SourceReconciliationRecord {
  partId: string;
  preferredSourceRecordId: string | null;
  resolutionStatus: SourceReconciliationStatus;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

/** SearchPagination describes a bounded result window without changing result truth. */
export interface SearchPagination {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  sort: PartSearchSort;
}

/** PartSearchRecord is the joined record shape consumed by API and web search/detail pages. */
export interface PartSearchRecord {
  part: Part;
  manufacturer: Manufacturer;
  package: Package;
  connectorFamily: ConnectorFamily | null;
  metrics: PartMetric[];
  assets: Asset[];
  datasheetRevision: DatasheetRevision | null;
  sources: SourceRecord[];
  mateRelations: MateRelation[];
  accessoryRequirements: AccessoryRequirement[];
  cableCompatibilities: CableCompatibility[];
  connectorFamilyConflicts: ConnectorFamilyConflict[];
  buildableMatingSet: BuildableMatingSet;
  similarParts: SimilarPartRelation[];
  companionRecommendations: CompanionRecommendation[];
  generationWorkflows: GenerationWorkflow[];
  generationRequests: GenerationRequest[];
  extractionSignals: SourceExtractionSignal[];
  reviewRecords: ReviewRecord[];
  validationRecords: AssetValidationRecord[];
  promotionAudits: AssetPromotionAuditRecord[];
  /** Optional export-bundle readiness projection when a search API precomputes it. */
  bundleReadiness?: BundleReadinessSummary;
  /**
   * Optional read-only "this part bit us / is blocked" projection from confirmed engineering
   * memory, surfaced at part-selection time. Null/absent when none or when not computed. Never a
   * gate — it does not change readiness, approval, validation, or export state.
   */
  engineeringMemoryWarning?: PartEngineeringMemoryWarningSummary | null;
  readinessSummary: PartReadinessSummary;
  approval: PartApproval;
  duplicateCandidates: PartDuplicateCandidate[];
  issues: PartIssue[];
  riskFlags: PartRiskFlag[];
  sourceReconciliation: SourceReconciliationRecord | null;
  /** ISO timestamp for the latest joined record update. */
  lastUpdatedAt: string;
}

/** RelatedPartSummary provides lightweight display data for relationship sections. */
export interface RelatedPartSummary {
  id: string;
  mpn: string;
  manufacturerName: string;
  category: string;
}

/** PartAcquisitionSummary exposes detail-safe acquisition/job provenance without leaking internal user ids. */
export interface PartAcquisitionSummary {
  /** State explains whether the detail page has job history, only legacy source evidence, or no acquisition record. */
  state: PartAcquisitionSummaryState;
  /** Provider id from the latest matching acquisition or source evidence when available. */
  providerId: string | null;
  /** Provider-specific part key attached to the latest matching acquisition or source row when available. */
  providerPartKey: string | null;
  /** Exact lookup that created the latest acquisition job, or null when no job record exists. */
  requestedLookup: string | null;
  /** Manufacturer part number shown in the acquisition summary when it is recorded or can be safely inferred from the canonical part. */
  mpn: string | null;
  /** Manufacturer name shown in the acquisition summary when it is recorded or can be safely inferred from the canonical part. */
  manufacturerName: string | null;
  /** Provider source URL for the latest acquisition or source evidence when available. */
  sourceUrl: string | null;
  /** Latest matching acquisition job status, or null when no acquisition job exists for this part. */
  lastJobStatus: ProviderAcquisitionJobStatus | null;
  /** When the latest matching acquisition job was requested, or null when no job is recorded. */
  requestedAt: string | null;
  /** When the latest matching acquisition job completed, or null when it has not completed or was never recorded. */
  completedAt: string | null;
  /** Public detail routes do not expose raw internal requester ids, so this stays null until a safe display label exists. */
  requestedBy: string | null;
  /** Human-readable reason for unavailable or legacy/no-history states. */
  reason: string | null;
}

/** ProviderEnrichmentJob stores one background enrichment attempt without implying approval or export readiness. */
export interface ProviderEnrichmentJob {
  id: string;
  partId: string;
  sourceAcquisitionJobId: string;
  jobType: ProviderEnrichmentJobType;
  jobStatus: ProviderEnrichmentJobStatus;
  requestedBy: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastUpdatedAt: string;
}

/** ProviderEnrichmentJobEvent records one coarse lifecycle event for a background enrichment job. */
export interface ProviderEnrichmentJobEvent {
  id: string;
  jobId: string;
  eventType: ProviderEnrichmentJobEventType;
  message: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** PartEnrichmentJobSummary is the detail-safe view of one enrichment job on the public part detail route. */
export interface PartEnrichmentJobSummary {
  id: string;
  jobType: ProviderEnrichmentJobType;
  jobStatus: ProviderEnrichmentJobStatus;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastUpdatedAt: string;
}

/** PartEnrichmentSummary exposes read-only enrichment activity without changing approval or export truth. */
export interface PartEnrichmentSummary {
  /** State explains whether enrichment jobs are recorded, absent, or unavailable for this detail response. */
  state: PartEnrichmentSummaryState;
  /** Recorded enrichment jobs in newest-first order. */
  jobs: PartEnrichmentJobSummary[];
  /** Latest recorded enrichment status, or null when no jobs exist. */
  latestJobStatus: ProviderEnrichmentJobStatus | null;
  /** Count of queued or running enrichment jobs still in progress for this part. */
  activeJobCount: number;
  /** Human-readable reason for unavailable or no-history states. */
  reason: string | null;
}

/** PartDetailResponse enriches the base record with resolved related-part summaries. */
export interface PartDetailResponse {
  record: PartSearchRecord;
  relatedPartSummaries: RelatedPartSummary[];
  assetGroups: AssetClassSummary[];
  bundleReadiness: BundleReadinessSummary;
  generationOptions: AssetGenerationOption[];
  assetReviewStatuses: ReviewStatusSummary[];
  workflowReviewStatuses: ReviewStatusSummary[];
  assetValidationSummaries: AssetValidationSummary[];
  assetPromotionSummaries: AssetPromotionSummary[];
  acquisitionSummary: PartAcquisitionSummary;
  enrichmentSummary: PartEnrichmentSummary;
}

/** GenerationRequestCreateInput is the minimal API body for requesting missing CAD generation. */
export interface GenerationRequestCreateInput {
  targetAssetType: GenerationTargetAssetType;
}

/** GenerationRequestCreateResponse returns the persisted request and refreshed workflow summary. */
export interface GenerationRequestCreateResponse {
  request: GenerationRequest;
  generationOption: AssetGenerationOption;
}

/** ReviewActionInput is the minimal local/dev-safe body for asset and workflow review decisions. */
export interface ReviewActionInput {
  targetType: ReviewTargetType;
  targetId: string;
  outcome: ReviewOutcome;
  notes?: string | null;
}

/** ReviewActionResponse returns the persisted review plus the updated target when applicable. */
export interface ReviewActionResponse {
  review: ReviewRecord;
  updatedAsset?: Asset;
  updatedWorkflow?: GenerationWorkflow;
}

/** PartIssueWorkflowUpdateInput is the operator-facing body for issue assignment and resolve/reopen actions. */
export interface PartIssueWorkflowUpdateInput {
  status: PartIssueWorkflowStatus;
  assignedTo?: string | null;
  resolutionNotes?: string | null;
}

/** PartIssueWorkflowUpdateResponse returns the updated issue workflow state from the API. */
export interface PartIssueWorkflowUpdateResponse {
  issue: PartIssue;
}

/** SourceReconciliationUpdateInput stores operator reconciliation state for source-conflict follow-up. */
export interface SourceReconciliationUpdateInput {
  resolutionStatus: SourceReconciliationStatus;
  preferredSourceRecordId?: string | null;
  notes?: string | null;
}

/** SourceReconciliationUpdateResponse returns the latest persisted source reconciliation record. */
export interface SourceReconciliationUpdateResponse {
  reconciliation: SourceReconciliationRecord;
}

/** AssetPromotionInput is the explicit request to promote one reviewed asset for export. */
export interface AssetPromotionInput {
  assetId: string;
}

/** AssetPromotionResponse returns the asset after an explicit export-verification promotion. */
export interface AssetPromotionResponse {
  updatedAsset: Asset;
  promotionAudit: AssetPromotionAuditRecord;
}

/** ProviderImportCreateInput is the operator-facing body for one provider catalog import. */
export interface ProviderImportCreateInput {
  /** Registered provider adapter id, such as jlcparts or local-catalog. */
  providerId: string;
  /** Manufacturer part number; used when providerPartId is not provided. */
  mpn?: string | null;
  /** Provider-specific part identifier (for example an LCSC code) when it differs from MPN. */
  providerPartId?: string | null;
  /** Optional provider product URL that can be used as lookup context or parsed for a provider key. */
  providerUrl?: string | null;
  /** Optional datasheet URL retained as operator context for intake and later traceability. */
  datasheetUrl?: string | null;
  /** Optional manufacturer hint for providers that support disambiguation. */
  manufacturerName?: string | null;
}

/** ProviderImportOutcome labels whether the import created a new source row or refreshed an existing one. */
export type ProviderImportOutcome = "new_import" | "refreshed_existing";

/** ProviderLookupRequestInput is the explicit exact-match lookup body for supported providers. */
export interface ProviderLookupRequestInput {
  /** Exact lookup text entered by the user, such as an MPN or supported provider part id. */
  query: string;
  /** Optional manufacturer hint retained only for exact provider disambiguation. */
  manufacturerName?: string | null;
}

/** ProviderLookupCandidateBase is the provider-neutral exact-match row produced before auth-derived import gating. */
export interface ProviderLookupCandidateBase {
  providerId: string;
  providerPartKey: string;
  manufacturerName: string;
  mpn: string;
  package: string;
  sourceUrl: string | null;
  matchType: ProviderLookupMatchType;
  matchConfidence: number;
}

/** ProviderLookupCandidate adds request-time import gating without leaking auth rules into worker adapters. */
export interface ProviderLookupCandidate extends ProviderLookupCandidateBase {
  /** True only when the current request context could use the existing admin-gated import route. */
  importAllowed: boolean;
}

/** ProviderAcquisitionJob stores one admin-gated provider intake job without implying part approval. */
export interface ProviderAcquisitionJob {
  id: string;
  providerId: string;
  providerPartKey: string;
  requestedLookup: string;
  manufacturerName: string | null;
  mpn: string | null;
  package: string | null;
  sourceUrl: string | null;
  matchType: ProviderLookupMatchType;
  matchConfidence: number;
  jobStatus: ProviderAcquisitionJobStatus;
  requestedBy: string;
  requestedAt: string;
  partId: string | null;
  importOutcome: ProviderImportOutcome | null;
  previousImportStatus: SourceImportStatus | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastUpdatedAt: string;
}

/** ProviderAcquisitionJobEvent records coarse queue lifecycle transitions and error context. */
export interface ProviderAcquisitionJobEvent {
  id: string;
  jobId: string;
  eventType: ProviderAcquisitionJobEventType;
  message: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** ProviderAcquisitionJobCreateInput is the admin-facing intake body built from an exact lookup candidate. */
export interface ProviderAcquisitionJobCreateInput {
  providerId: string;
  providerPartKey: string;
  requestedLookup: string;
  manufacturerName?: string | null;
  mpn?: string | null;
  package?: string | null;
  sourceUrl?: string | null;
  matchType: ProviderLookupMatchType;
  matchConfidence: number;
}

/** ProviderAcquisitionJobDetailResponse returns one job plus its coarse lifecycle events. */
export interface ProviderAcquisitionJobDetailResponse {
  job: ProviderAcquisitionJob;
  events: ProviderAcquisitionJobEvent[];
}

/** ProviderImportCreateResponse summarizes one successful provider import without implying CAD readiness. */
export interface ProviderImportCreateResponse {
  partId: string;
  providerId: string;
  providerPartKey: string;
  importStatus: SourceImportStatus;
  requestedLookup: string;
  /** Whether a prior source row existed for this provider + part key. */
  outcome: ProviderImportOutcome;
  /** Prior source row import status, or null when no prior row existed. */
  previousImportStatus: SourceImportStatus | null;
}

/** SearchFacets contains the provider-neutral filter data for the search surface. */
export interface SearchFacets {
  manufacturers: Manufacturer[];
  categories: string[];
  packages: Package[];
  lifecycleStatuses: LifecycleStatus[];
  readinessStatuses: PartReadinessStatus[];
  approvalStatuses: PartApprovalStatus[];
  connectorClasses: ConnectorClass[];
  /** Optional per-facet counts for DB-backed and seed-fallback consistency checks. */
  counts?: {
    manufacturers: Record<string, number>;
    categories: Record<string, number>;
    packages: Record<string, number>;
    lifecycleStatuses: Record<LifecycleStatus, number>;
    cadAvailability: Record<CadAvailabilityFilter, number>;
    readinessStatuses: Record<PartReadinessStatus, number>;
    approvalStatuses: Record<PartApprovalStatus, number>;
    connectorClasses: Record<ConnectorClass, number>;
  };
}

/** ExportAvailability describes one export action and why it is enabled or disabled. */
export interface ExportAvailability {
  id: "altium" | "solidworks" | "neutral_cad";
  label: string;
  /** True only when required verified file-backed assets exist. */
  available: boolean;
  reason: string;
}

/** CatalogDataSource names the backing source used by an API response. */
export type CatalogDataSource = "database" | "seed_fallback";

/** ApiEnvelope defines the typed JSON response envelope used by apps/api. */
export interface ApiEnvelope<TData> {
  data: TData;
  source?: CatalogDataSource;
  /** Optional pagination metadata for paged search responses. */
  pagination?: SearchPagination;
  /** Explicit degraded-state warnings, such as allowed local seed fallback. */
  warnings?: string[];
}

/** ApiErrorEnvelope defines typed error responses used by apps/api. */
export interface ApiErrorEnvelope {
  error: {
    /** Stable machine-readable API error code. */
    code: string;
    /** User-facing explanation that avoids implying healthy DB-backed data. */
    message: string;
  };
  /** Explicit degraded-state warnings when applicable. */
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Security foundation: user action audit events
// ---------------------------------------------------------------------------

/** AuditActorRole mirrors the authenticated role captured at the API boundary. */
export type AuditActorRole = "admin" | "user";

/** AuditEventOutcome records whether a user action succeeded, failed validation, or was denied. */
export type AuditEventOutcome = "succeeded" | "failed" | "denied";

/** AuditEventTargetType keeps user-action targets broad enough for future RBAC and ECO workflows. */
export type AuditEventTargetType =
  | "api_route"
  | "asset"
  | "bom_import"
  | "circuit_block"
  | "circuit_block_part"
  | "document_revision"
  | "evidence_attachment"
  | "follow_up"
  | "part"
  | "project"
  | "project_revision"
  | "project_revision_approval_gate"
  | "provider_acquisition_job"
  | "provider_import"
  | "substitution"
  | "vendor";

/** AuditEventMetadata stores safe request context only; request bodies and secrets are intentionally excluded. */
export type AuditEventMetadata = Record<string, string | number | boolean | null | string[]>;

/** AuditEvent is one immutable API action record used for security review and future policy gates. */
export interface AuditEvent {
  id: string;
  requestId: string;
  occurredAt: string;
  actorId: string | null;
  actorRole: AuditActorRole | null;
  action: string;
  targetType: AuditEventTargetType;
  targetId: string | null;
  method: string;
  path: string;
  operation: string;
  statusCode: number;
  outcome: AuditEventOutcome;
  requestIpHash: string | null;
  userAgentHash: string | null;
  metadata: AuditEventMetadata;
}

/** AuditEventListResponse returns recent action events plus the logging boundary reviewers need. */
export interface AuditEventListResponse {
  state: ProjectMemoryReadState;
  events: AuditEvent[];
  boundary: string;
}

// ---------------------------------------------------------------------------
// P0-FUNC5: Export bundle types
// ---------------------------------------------------------------------------

/** ExportBundleFormat names the three export target environments. */
export type ExportBundleFormat = "altium" | "solidworks" | "neutral";

/** ExportBundleIncludedAsset describes one verified file-backed asset included in a bundle. */
export interface ExportBundleIncludedAsset {
  partId: string;
  partMpn: string;
  manufacturerName: string;
  assetId: string;
  assetType: AssetType;
  fileFormat: FileFormat;
  storageKey: string;
  fileHash: string | null;
  provenance: AssetProvenance;
  bundlePath: string;
}

/** ExportBundleOmission records why a part asset was excluded from a bundle. */
export interface ExportBundleOmission {
  partId: string;
  partMpn: string;
  assetType: AssetType;
  reason: "not_verified_for_export" | "no_storage_key" | "referenced_only" | "missing" | "format_not_applicable";
}

/**
 * ExportBundleControlledAsset records that an included bundle asset is bound to a
 * controlled document revision. The revision's access level is the most-restrictive
 * non-archived revision found for that asset at bundle generation time.
 *
 * The bundle manifest carries this so a downstream reviewer can see exactly which
 * assets in the bundle are restricted or ITAR-controlled before transmitting it.
 */
export interface ExportBundleControlledAsset {
  assetId: string;
  partId: string;
  partMpn: string;
  documentRevisionId: string;
  revisionLabel: string;
  documentType: DocumentControlType;
  accessLevel: DocumentAccessLevel;
}

/**
 * ExportBundleControlSummary counts controlled assets per access level so the UI can
 * surface a single banner ("This bundle contains 2 ITAR-controlled assets") without
 * scanning the full list.
 */
export interface ExportBundleControlSummary {
  restrictedCount: number;
  itarControlledCount: number;
  highestAccessLevel: DocumentAccessLevel | null;
}

/** ExportBundleProvenanceApproval is the part-approval decision captured at bundle generation. */
export interface ExportBundleProvenanceApproval {
  status: PartApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  summary: string;
}

/** ExportBundleProvenanceDatasheet records which datasheet revision the team designed from. */
export interface ExportBundleProvenanceDatasheet {
  datasheetRevisionId: string;
  revisionLabel: string | null;
  revisionDate: string | null;
}

/** ExportBundleProvenanceTrustedAsset is one verified file-backed asset the team stood behind. */
export interface ExportBundleProvenanceTrustedAsset {
  assetId: string;
  assetType: AssetType;
  fileFormat: FileFormat;
  fileHash: string | null;
  provenance: AssetProvenance;
}

/** ExportBundleProvenanceMemoryRecord is one confirmed engineering-memory record for the part. */
export interface ExportBundleProvenanceMemoryRecord {
  recordId: string;
  recordKind: PartEngineeringRecordKind;
  severity: PartEngineeringRecordSeverity;
  outcome: PartEngineeringRecordOutcome | null;
  title: string;
  recordedBy: string | null;
  recordedAt: string;
}

/**
 * ExportBundlePartProvenance is the defensible per-part provenance record embedded in the
 * signed manifest: who approved the part and when, the datasheet revision designed from, the
 * verified footprint/symbol/3D assets the team stood behind, and the confirmed engineering
 * memory around it. Because the manifest is serialized into the signed, hashed archive, this
 * provenance is tamper-evident — an auditor or customer can verify it was not altered. It is a
 * point-in-time record, never a re-derived trust gate.
 */
export interface ExportBundlePartProvenance {
  partId: string;
  partMpn: string;
  manufacturerName: string;
  approval: ExportBundleProvenanceApproval | null;
  datasheetRevision: ExportBundleProvenanceDatasheet | null;
  trustedAssets: ExportBundleProvenanceTrustedAsset[];
  confirmedEngineeringMemory: ExportBundleProvenanceMemoryRecord[];
}

/** ExportBundleManifest is the deterministic record of what is and is not in a bundle. */
export interface ExportBundleManifest {
  bundleId: string;
  bundleFormat: ExportBundleFormat;
  projectId: string;
  revisionLabel: string | null;
  generatedAt: string;
  includedAssets: ExportBundleIncludedAsset[];
  omissions: ExportBundleOmission[];
  warnings: string[];
  /**
   * Controlled-document context for the bundle's included assets. Populated at
   * generation time; empty when the bundle has no controlled assets. Older bundles
   * generated before this field existed default to an empty array on read.
   */
  controlledAssets: ExportBundleControlledAsset[];
  /**
   * Roll-up of controlled-asset counts and the highest access level present. Older
   * bundles default to all-zero with `highestAccessLevel: null` on read.
   */
  controlSummary: ExportBundleControlSummary;
  /**
   * Defensible per-part provenance (approval, datasheet revision, trusted assets, confirmed
   * engineering memory) captured at generation time and covered by the bundle signature. Older
   * bundles generated before this field existed default to an empty array on read.
   */
  partProvenance: ExportBundlePartProvenance[];
}

/**
 * ExportBundleFileAvailability distinguishes the three honest states a stored bundle file can be in.
 *
 * - `manifest_only` — bundle was generated as a manifest record only (no file write was attempted).
 *   This is the current default while file-backed bundle generation is still foundation-stage.
 * - `available` — bundle has a `storageKey` AND the file is currently present on the storage backend.
 * - `file_missing` — bundle has a `storageKey` but the file is absent from the storage backend
 *   (e.g. retention sweep, manual delete). Surfacing this prevents broken Download links from
 *   appearing in bundle history.
 */
export type ExportBundleFileAvailability = "manifest_only" | "available" | "file_missing";

/**
 * ExportBundleAssemblyStatus distinguishes the four honest states of worker-side asset-byte assembly.
 *
 * Assembly is separate from the synchronous manifest archive write. The manifest is recorded by the
 * API at bundle creation; asset bytes (per-included-asset payloads) are copied into deterministic
 * per-bundle storage paths by the worker so an archive download can be produced without blocking
 * the API request.
 *
 * - `not_required` — bundle had zero included assets, so no asset-byte work is queued.
 * - `pending` — bundle is waiting for the worker to copy each included asset's bytes.
 * - `assembled` — every included asset's bytes were copied to the per-bundle storage prefix.
 * - `assembly_failed` — assembly stopped on a specific asset; see `assemblyError` for telemetry.
 */
export type ExportBundleAssemblyStatus = "not_required" | "pending" | "assembled" | "assembly_failed";

/**
 * ExportBundleAssemblyErrorPhase identifies which step of the asset-byte assembly failed.
 *
 * - `fetch_asset` — reading the source asset bytes from storage failed.
 * - `write_asset` — writing the per-bundle copy of the asset bytes to storage failed.
 * - `unknown` — the failure was not classifiable into either phase.
 */
export type ExportBundleAssemblyErrorPhase = "fetch_asset" | "write_asset" | "unknown";

/**
 * ExportBundleAssemblyError records structured failure telemetry for one assembly attempt.
 *
 * Failure telemetry is intentionally per-asset so operators see exactly which asset failed and why,
 * rather than scanning a free-text manifest warning.
 */
export interface ExportBundleAssemblyError {
  phase: ExportBundleAssemblyErrorPhase;
  message: string;
  failedAssetId: string | null;
  failedBundlePath: string | null;
  failedAt: string;
}

/** ExportBundle is the persisted bundle record with its manifest. */
export interface ExportBundle {
  id: string;
  projectId: string;
  revisionLabel: string | null;
  bundleFormat: ExportBundleFormat;
  storageKey: string | null;
  /**
   * Storage key for the worker-assembled single-archive (`.tar.gz`). Null until assembly succeeds.
   * Distinct from `storageKey` so the manifest archive (JSON) and the engineering-friendly bundle
   * download stay separable — readable manifest for audit, single archive for download.
   */
  archiveStorageKey: string | null;
  /**
   * Honest availability signal for the bundle file. Computed at read time so a download link
   * is only offered when the file is actually present on the storage backend.
   */
  fileAvailability: ExportBundleFileAvailability;
  /**
   * Honest availability signal for the assembled `.tar.gz` archive, computed at read time the same
   * way as `fileAvailability` so a "Download archive" link never points at a missing file.
   */
  archiveAvailability: ExportBundleFileAvailability;
  manifest: ExportBundleManifest;
  partCount: number;
  includedAssetCount: number;
  omittedAssetCount: number;
  warningCount: number;
  /**
   * Worker-side asset-byte assembly status. Separate from `fileAvailability` so manifest persistence
   * (synchronous, API-side) is not conflated with per-asset byte copying (async, worker-side).
   */
  assemblyStatus: ExportBundleAssemblyStatus;
  /** Structured telemetry for the latest failed assembly attempt; null when never failed. */
  assemblyError: ExportBundleAssemblyError | null;
  /** ISO timestamp the worker last completed (or last failed) an assembly attempt; null until first attempt. */
  assemblyCompletedAt: string | null;
  /** Number of assembly attempts the worker has executed for this bundle. */
  assemblyAttemptCount: number;
  /**
   * Hex SHA-256 of the assembled `.tar.gz` archive bytes, computed by the worker after the
   * deterministic gzip step so identical inputs produce identical recorded hashes. Null until
   * the archive has been assembled successfully (or for legacy bundles persisted before
   * migration 039).
   */
  archiveSha256: string | null;
  /**
   * Hex SHA-256 of the embedded `manifest.json` body inside the assembled archive. Distinct
   * from `archiveSha256` because the manifest is also persisted as the standalone audit-readable
   * record; surfacing both lets an auditor confirm the manifest content matches the archive
   * even when only one of the two files is downloaded.
   */
  manifestSha256: string | null;
  /**
   * Honest signature state for the assembled archive.
   * - `unsigned` — no signing key configured at assembly time, or assembly predates migration 039.
   * - `signed` — a configured Ed25519 key signed the archive's SHA-256 hex string at assembly.
   * - `verification_failed` — a previously-signed bundle's signature could not be re-verified at
   *   read time (key rotated out of the trust set, signature file missing, archive hash mismatch).
   */
  signatureStatus: ExportBundleSignatureStatus;
  /** Signature algorithm identifier (e.g. `ed25519`); null when the bundle is unsigned. */
  signatureAlgorithm: string | null;
  /**
   * Hex SHA-256 of the public-verification key. Recorded at signing time so the UI can identify
   * which signer produced the bundle without exposing or trusting the public key itself.
   */
  signaturePublicKeyFingerprint: string | null;
  /** Storage key for the detached `.sig` payload; null when the bundle is unsigned. */
  signatureStorageKey: string | null;
  /** ISO timestamp the bundle was signed at; null when the bundle is unsigned. */
  signatureSignedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

/**
 * ExportBundleSignatureStatus distinguishes the three honest states a bundle's cryptographic
 * provenance can be in. A bundle without a configured signing key is `unsigned`, not
 * `verified`. A signature that fails verification becomes `verification_failed` instead of
 * being silently suppressed.
 */
export type ExportBundleSignatureStatus = "unsigned" | "signed" | "verification_failed";

/**
 * ExportBundleVerificationReason names the structured cause behind a `verification_failed`
 * outcome so the UI can render targeted recovery copy instead of a single opaque red badge.
 *
 * - `archive_missing`                      — the archive file could not be read from storage.
 * - `archive_hash_mismatch`                — the recomputed SHA-256 differs from the recorded one.
 * - `signature_missing`                    — the bundle was signed but the .sig file is gone.
 * - `signature_unreadable`                 — the .sig payload could not be parsed (corrupted).
 * - `signature_algorithm_unsupported`      — the recorded algorithm is not one we can verify.
 * - `verification_key_unavailable`         — no verification key is configured on this deployment.
 * - `verification_key_fingerprint_mismatch`— the configured key does not match the recorded fingerprint.
 * - `signature_mismatch`                   — Ed25519 verify returned false against the archive hash.
 */
export type ExportBundleVerificationReason =
  | "archive_missing"
  | "archive_hash_mismatch"
  | "signature_missing"
  | "signature_unreadable"
  | "signature_algorithm_unsupported"
  | "verification_key_unavailable"
  | "verification_key_fingerprint_mismatch"
  | "signature_mismatch";

/**
 * ExportBundleVerifyResponse is the envelope returned by the on-demand verify endpoint. It
 * carries the freshly-mapped bundle row (with the new `signatureStatus` already persisted),
 * plus the structured outcome so the UI can render "verified at <when>" or
 * "<reason>: <recommended fix>" without having to re-derive intent from the row alone.
 */
export interface ExportBundleVerifyResponse {
  bundle: ExportBundle;
  outcome: {
    status: ExportBundleSignatureStatus;
    reason: ExportBundleVerificationReason | null;
    recomputedArchiveSha256: string | null;
    verifiedAt: string | null;
  };
  /**
   * Human-readable boundary copy to render alongside the outcome. Verification is an evidence
   * check on the archive; it is never a substitute for review/approval/export-readiness gates.
   */
  boundary: string;
}

/** ExportBundleCreateInput specifies the format and optional revision scope for a new bundle. */
export interface ExportBundleCreateInput {
  bundleFormat: ExportBundleFormat;
  revisionLabel?: string | null;
}

/** ExportBundleCreateResponse is returned when a bundle is generated. */
export interface ExportBundleCreateResponse {
  bundle: ExportBundle;
}

/** ExportBundleListResponse lists all bundles for a project. */
export interface ExportBundleListResponse {
  bundles: ExportBundle[];
  projectId: string;
}

// ---------------------------------------------------------------------------
// P2-FUNC13: Part substitution management types
// ---------------------------------------------------------------------------

/** PartSubstitutionScope decides whether a substitution applies globally or to one project only. */
export type PartSubstitutionScope = "global" | "project";

/** PartSubstitutionStatus lets engineers revoke a previously-approved substitution while keeping history. */
export type PartSubstitutionStatus = "approved" | "revoked";

/** PartSubstitution is the persisted engineering-signed-off substitution record. */
export interface PartSubstitution {
  id: string;
  originalPartId: string;
  substitutePartId: string;
  scope: PartSubstitutionScope;
  projectId: string | null;
  signoffNotes: string;
  approvedBy: string;
  approvalStatus: PartSubstitutionStatus;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

/** PartSubstitutionSummary joins one substitution row to the catalog identity of both sides for display. */
export interface PartSubstitutionSummary {
  substitution: PartSubstitution;
  originalPartMpn: string;
  originalManufacturerName: string;
  substitutePartMpn: string;
  substituteManufacturerName: string;
  /** Optional project name for project-scoped substitutions; null when scope is global. */
  projectName: string | null;
}

/** PartSubstitutionListResponse lists every substitution that touches one part as either side. */
export interface PartSubstitutionListResponse {
  partId: string;
  active: PartSubstitutionSummary[];
  revoked: PartSubstitutionSummary[];
  boundary: string;
}

/** PartSubstitutionCreateInput captures the engineering decision: alternate, scope, sign-off. */
export interface PartSubstitutionCreateInput {
  substitutePartId: string;
  scope: PartSubstitutionScope;
  projectId?: string | null;
  signoffNotes?: string | null;
}

/** PartSubstitutionCreateResponse returns the persisted substitution and the trust boundary. */
export interface PartSubstitutionCreateResponse {
  substitution: PartSubstitutionSummary;
  boundary: string;
}

/** PartSubstitutionRevokeResponse returns the revoked substitution and the trust boundary. */
export interface PartSubstitutionRevokeResponse {
  substitution: PartSubstitutionSummary;
  boundary: string;
}

// ---------------------------------------------------------------------------
// P1-FUNC6: BOM import diagnostics and revision compare types
// ---------------------------------------------------------------------------

/** BomImportDiagnosticsRow describes one BOM line with match context and triage hints. */
export interface BomImportDiagnosticsRow {
  lineId: string;
  rowNumber: number;
  designators: string[];
  quantity: number | null;
  rawMpn: string | null;
  rawManufacturer: string | null;
  rawDescription: string | null;
  matchStatus: BomLineMatchStatus;
  matchConfidenceScore: number | null;
  matchedPartId: string | null;
  matchedPartMpn: string | null;
  matchedManufacturerName: string | null;
  triageActions: string[];
  /** Approved substitutions that map this row's raw MPN onto an internal catalog part. */
  approvedSubstituteHints: ApprovedSubstituteHint[];
}

/** ApprovedSubstituteHint surfaces an approved substitution that may explain or rescue a BOM line. */
export interface ApprovedSubstituteHint {
  substitutionId: string;
  /** The approved substitute part the engineer can pivot to (or that this row already represents). */
  candidatePartId: string;
  candidatePartMpn: string;
  candidateManufacturerName: string;
  scope: PartSubstitutionScope;
  approvedBy: string;
  signoffNotes: string;
}

/** BomImportDiagnosticsResponse provides a full match-status breakdown for one BOM import. */
export interface BomImportDiagnosticsResponse {
  importId: string;
  projectId: string;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  weakMatchCount: number;
  ignoredCount: number;
  rows: BomImportDiagnosticsRow[];
}

/** BomRevisionCompareRow describes one BOM line in a side-by-side revision diff. */
export interface BomRevisionCompareRow {
  kind: "added" | "removed" | "changed" | "unchanged";
  rawMpn: string | null;
  rawManufacturer: string | null;
  rawDescription: string | null;
  quantity: number | null;
  designators: string[];
  matchStatus: BomLineMatchStatus;
  matchedPartId: string | null;
  changeDetail: string | null;
}

/** BomRevisionCompareResponse is the diff between two BOM imports. */
export interface BomRevisionCompareResponse {
  projectId: string;
  importId1: string;
  importId2: string;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  rows: BomRevisionCompareRow[];
}

/** ProjectRevisionCompareChangeKind groups what kind of change a row represents in a revision-level diff. */
export type ProjectRevisionCompareChangeKind =
  | "added"
  | "removed"
  | "quantity_changed"
  | "designator_changed"
  | "mpn_swap"
  | "unchanged";

/** ProjectRevisionCompareIdentityKind reports what evidence keyed two rows together across revisions. */
export type ProjectRevisionCompareIdentityKind = "matched_part" | "raw_mpn" | "raw_row";

/** ProjectRevisionCompareSide is one revision-side snapshot of an aggregated BOM line. */
export interface ProjectRevisionCompareSide {
  rawMpn: string | null;
  rawManufacturer: string | null;
  rawDescription: string | null;
  quantity: number | null;
  designators: string[];
  matchStatus: BomLineMatchStatus | null;
  matchedPartId: string | null;
  matchedPartMpn: string | null;
}

/** ProjectRevisionCompareRow describes one BOM identity in a revision-vs-revision diff. */
export interface ProjectRevisionCompareRow {
  changeKind: ProjectRevisionCompareChangeKind;
  identityKind: ProjectRevisionCompareIdentityKind;
  /** Stable per-row key derived from matched_part_id when present, otherwise normalized raw_mpn. */
  identityKey: string;
  matchedPartId: string | null;
  rawMpn: string | null;
  from: ProjectRevisionCompareSide | null;
  to: ProjectRevisionCompareSide | null;
  changeDetail: string | null;
}

/** ProjectRevisionCompareResponse is the diff between two project revisions. */
export interface ProjectRevisionCompareResponse {
  projectId: string;
  fromRevisionId: string;
  toRevisionId: string;
  /** BOM import ids that contributed BOM lines on each side, for transparency. */
  fromBomImportIds: string[];
  toBomImportIds: string[];
  addedCount: number;
  removedCount: number;
  quantityChangedCount: number;
  designatorChangedCount: number;
  mpnSwapCount: number;
  unchangedCount: number;
  rows: ProjectRevisionCompareRow[];
}

/** ProjectRevisionApprovalGateStatus records one BOM diff review decision without changing part trust state. */
export type ProjectRevisionApprovalGateStatus = "pending_review" | "approved" | "changes_requested";

/** ProjectRevisionApprovalGateDecision names the review action submitted from the project workspace. */
export type ProjectRevisionApprovalGateDecision = "open" | "approve" | "request_changes";

/** ProjectRevisionApprovalGateDiffSummary stores the compact, reviewable shape of one revision diff. */
export interface ProjectRevisionApprovalGateDiffSummary {
  addedCount: number;
  removedCount: number;
  mpnSwapCount: number;
  quantityChangedCount: number;
  designatorChangedCount: number;
  unchangedCount: number;
  totalChangedCount: number;
  fromBomImportIds: string[];
  toBomImportIds: string[];
}

/** ProjectRevisionApprovalGate is one persisted gate for a specific revision-to-revision BOM diff. */
export interface ProjectRevisionApprovalGate {
  id: string;
  projectId: string;
  fromRevisionId: string;
  toRevisionId: string;
  gateStatus: ProjectRevisionApprovalGateStatus;
  diffFingerprint: string;
  diffSummary: ProjectRevisionApprovalGateDiffSummary;
  decisionNotes: string;
  createdBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** True when the currently computed diff still matches the persisted approval fingerprint. */
  isCurrent: boolean;
}

/** ProjectRevisionApprovalGateRequest creates or updates the gate for a computed revision diff. */
export interface ProjectRevisionApprovalGateRequest {
  fromRevisionId: string;
  toRevisionId: string;
  decision: ProjectRevisionApprovalGateDecision;
  notes?: string | null;
}

/** ProjectRevisionApprovalGateListResponse lists persisted gates for one project. */
export interface ProjectRevisionApprovalGateListResponse {
  state: ProjectMemoryReadState;
  projectId: string;
  gates: ProjectRevisionApprovalGate[];
  /** Trust boundary copy reminding readers that a BOM gate is not part approval or export readiness. */
  boundary: string;
}

/** ProjectRevisionApprovalGateResponse returns the persisted gate plus the diff it reviewed. */
export interface ProjectRevisionApprovalGateResponse {
  gate: ProjectRevisionApprovalGate;
  compare: ProjectRevisionCompareResponse;
  /** Trust boundary copy shown beside the approval action. */
  boundary: string;
}

// ---------------------------------------------------------------------------
// P2-FUNC15: Connector set catalog view
// ---------------------------------------------------------------------------

/** ConnectorSetMatePairKind names how a mate row relates to its primary connector. */
export type ConnectorSetMatePairKind = "best_mate" | "alternate_mate";

/** ConnectorSetMatePair is one mate or alternate for a primary connector in the set view. */
export interface ConnectorSetMatePair {
  matePartId: string;
  mateMpn: string;
  mateManufacturerName: string;
  matePartLifecycleStatus: LifecycleStatus;
  matePartApprovalStatus: PartApprovalStatus | null;
  matePartReadinessStatus: PartReadinessStatus | null;
  matePartConnectorClass: ConnectorClass | null;
  relationshipType: ConnectorSetMatePairKind;
  /** Optional confidence score from mate_relations.confidence_score (0-1). */
  confidenceScore: number | null;
  /** Number of confirmed project usages that touch this mate. */
  projectUsageCount: number;
}

/** ConnectorSetEntry is one connector listing with its identity, current state, mates, and use count. */
export interface ConnectorSetEntry {
  partId: string;
  mpn: string;
  manufacturerName: string;
  connectorClass: ConnectorClass;
  lifecycleStatus: LifecycleStatus;
  approvalStatus: PartApprovalStatus | null;
  readinessStatus: PartReadinessStatus | null;
  blockerCount: number | null;
  /** Confirmed project usage count for the primary connector. */
  projectUsageCount: number;
  matePairs: ConnectorSetMatePair[];
}

/** ConnectorSetClassGroup groups connector entries by `connector_class` so the catalog can render families. */
export interface ConnectorSetClassGroup {
  connectorClass: ConnectorClass;
  entries: ConnectorSetEntry[];
}

/** ConnectorSetListResponse returns the connector-set catalog grouped by connector_class. */
export interface ConnectorSetListResponse {
  state: ProjectMemoryReadState;
  /** Optional connector_class filter applied; null means no filter. */
  connectorClassFilter: ConnectorClass | null;
  /** Optional MPN substring filter applied; null when no filter. */
  query: string | null;
  totalConnectorCount: number;
  totalMatePairCount: number;
  groups: ConnectorSetClassGroup[];
  /** Trust boundary copy reminding readers that listing does not approve reuse or unlock export. */
  boundary: string;
}

// ---------------------------------------------------------------------------
// P2-FUNC16: Approval batch workflow from project BOM context
// ---------------------------------------------------------------------------

/** ApprovalBatchAction names the bulk action applied to a candidate part. */
export type ApprovalBatchAction = "approve" | "flag_for_review";

/** ApprovalBatchCandidate is one matched-usage part that currently has an approval gap. */
export interface ApprovalBatchCandidate {
  partId: string;
  mpn: string;
  manufacturerName: string;
  approvalStatus: PartApprovalStatus | null;
  lifecycleStatus: LifecycleStatus | null;
  readinessStatus: PartReadinessStatus | null;
  /** Number of distinct BOM lines in this project that confirm usage of the part. */
  bomLineCount: number;
  /** Designators across BOM lines for fast triage (capped). */
  designators: string[];
  /** Stable BOM line ids for trace-back. */
  bomLineIds: string[];
}

/** ApprovalBatchCandidatesResponse returns the project-scoped approval queue. */
export interface ApprovalBatchCandidatesResponse {
  state: ProjectMemoryReadState;
  projectId: string;
  generatedAt: string;
  candidates: ApprovalBatchCandidate[];
  /** Trust boundary copy reminding readers that approval does not validate evidence or unlock export. */
  boundary: string;
}

/** ApprovalBatchRequest is the bulk approval input from the project BOM context. */
export interface ApprovalBatchRequest {
  partIds: string[];
  action: ApprovalBatchAction;
  notes?: string | null;
}

/** ApprovalBatchOutcomeStatus reports per-part processing outcome. */
export type ApprovalBatchOutcomeStatus = "applied" | "skipped_already_approved" | "not_found" | "skipped_no_change";

/** ApprovalBatchOutcome is one part's per-record outcome inside a batch. */
export interface ApprovalBatchOutcome {
  partId: string;
  status: ApprovalBatchOutcomeStatus;
  previousApprovalStatus: PartApprovalStatus | null;
  newApprovalStatus: PartApprovalStatus | null;
  message: string;
}

/** ApprovalBatchResponse summarizes a bulk approval action triggered from project BOM context. */
export interface ApprovalBatchResponse {
  projectId: string;
  action: ApprovalBatchAction;
  appliedCount: number;
  skippedCount: number;
  notFoundCount: number;
  outcomes: ApprovalBatchOutcome[];
  /** Trust boundary reminder shown beside the batch result. */
  boundary: string;
}
