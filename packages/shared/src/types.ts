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
export type FileFormat = "pdf" | "step" | "kicad_mod" | "kicad_sym" | "dxf" | "unknown";

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

/** SourceReconciliationStatus records how an operator has handled mixed provider/source evidence. */
export type SourceReconciliationStatus = "unreviewed" | "canonical_source_selected" | "mixed_sources_accepted";

/** SourceExtractionSignalType names explicit source material extracted for CAD recovery. */
export type SourceExtractionSignalType = "package_mechanical_dimensions" | "pin_table" | "mechanical_drawing";

/** SourceExtractionStatus keeps extraction evidence honest and review-aware. */
export type SourceExtractionStatus = "available" | "needs_review" | "not_available";

/** SourceExtractionSource identifies the source class without leaking provider-specific parsers. */
export type SourceExtractionSource = "provider_structured_metadata" | "datasheet_metadata" | "asset_reference" | "manual_internal";

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
