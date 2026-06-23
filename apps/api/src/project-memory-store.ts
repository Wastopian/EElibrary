/**
 * File header: Reads persisted project and BOM memory records from Postgres for the API service.
 */

import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { BomCsvParseError, buildBomImportPreview, countMappedBomFields, hasMappedHeader, mapBomRowsToDrafts, parseBomCsv, parseBomXlsx } from "@ee-library/shared/bom-csv";
import {
  getCircuitBlockReuseHeadlineVerdict,
  matchesCircuitBlockReuseReadinessFilter
} from "@ee-library/shared/circuit-block-readiness";
import type { FileStorageClient } from "@ee-library/shared/file-storage";
import { CatalogStoreError } from "./catalog-store";
import { searchInterconnectWhereUsed } from "./interconnect-store";
import { searchProjectDocumentsForWhereUsed } from "./project-files";
import { searchProjectDocumentExtractions } from "./project-document-extraction-store";
import type {
  ApprovalBatchAction,
  ApprovalBatchCandidate,
  ApprovalBatchCandidatesResponse,
  ApprovalBatchOutcome,
  ApprovalBatchRequest,
  ApprovalBatchResponse,
  AssetProvenance,
  AssetType,
  BomColumnMapping,
  BomImport,
  BomImportCreateInput,
  BomImportCreateResponse,
  BomImportDiagnosticsResponse,
  BomImportDiagnosticsRow,
  BomImportMatchResponse,
  BomImportMatchSummary,
  BomImportLinesResponse,
  BomLine,
  BomLineImportCandidate,
  BomLineMatchStatus,
  BomRevisionCompareResponse,
  BomRevisionCompareRow,
  ConnectorClass,
  ConnectorSetClassGroup,
  ConnectorSetEntry,
  ConnectorSetListResponse,
  ConnectorSetMatePair,
  LifecycleStatus,
  PartApprovalStatus,
  PartReadinessStatus,
  ProjectRevisionCompareChangeKind,
  ProjectRevisionCompareIdentityKind,
  ProjectRevisionCompareResponse,
  ProjectRevisionCompareRow,
  ProjectRevisionCompareSide,
  ProjectRevisionApprovalGate,
  ProjectRevisionApprovalGateDiffSummary,
  ProjectRevisionApprovalGateListResponse,
  ProjectRevisionApprovalGateRequest,
  ProjectRevisionApprovalGateResponse,
  ProjectRevisionApprovalGateStatus,
  CircuitBlock,
  CircuitBlockCreateInput,
  CircuitBlockCreateResponse,
  CircuitBlockDetailResponse,
  CircuitBlockInstantiation,
  CircuitBlockInstantiationCreateInput,
  CircuitBlockInstantiationCreateResponse,
  CircuitBlockInstantiationHistoryRecord,
  CircuitBlockKnownRisk,
  CircuitBlockKnownRiskCreateInput,
  CircuitBlockKnownRiskMutationResponse,
  CircuitBlockKnownRiskResolveInput,
  CircuitBlockKnownRiskSeverity,
  CircuitBlockListFilters,
  CircuitBlockListResponse,
  CircuitBlockPart,
  CircuitBlockPartCatalogSummary,
  CircuitBlockPartCreateInput,
  CircuitBlockPartCreateResponse,
  CircuitBlockPartRecord,
  CircuitBlockPartSubstitutionPolicy,
  CircuitBlockPartUpdateInput,
  CircuitBlockPartUpdateResponse,
  CircuitBlockStatus,
  CircuitBlockSummary,
  CircuitBlockType,
  CircuitBlockUpdateInput,
  CircuitBlockUpdateResponse,
  EvidenceAttachment,
  EvidenceAttachmentCreateInput,
  EvidenceAttachmentCreateResponse,
  EvidenceAttachmentListFilters,
  EvidenceAttachmentListResponse,
  EvidenceAttachmentType,
  EvidenceAttachmentUpdateInput,
  EvidenceAttachmentUpdateResponse,
  EvidenceReviewStatus,
  EvidenceStorageState,
  EvidenceTargetType,
  DocumentAccessLevel,
  DocumentControlType,
  ExportBundle,
  ExportBundleAssemblyError,
  ExportBundleAssemblyStatus,
  ExportBundleControlSummary,
  ExportBundleControlledAsset,
  ExportBundleCreateInput,
  ExportBundleCreateResponse,
  ExportBundleFileAvailability,
  ExportBundleFormat,
  ExportBundleIncludedAsset,
  ExportBundleListResponse,
  ExportBundleManifest,
  ExportBundleOmission,
  ExportBundlePartProvenance,
  ExportBundleProvenanceMemoryRecord,
  ExportBundleProvenanceTrustedAsset,
  ExportBundleSignatureStatus,
  ExportBundleVerificationReason,
  ExportBundleVerifyResponse,
  FileFormat,
  FollowUpListResponse,
  FollowUpRecord,
  FollowUpSourceType,
  FollowUpStatus,
  FollowUpSyncResponse,
  FollowUpTargetType,
  FollowUpUpdateInput,
  FollowUpUpdateResponse,
  ApprovedSubstituteHint,
  PartSubstitution,
  PartSubstitutionCreateInput,
  PartSubstitutionCreateResponse,
  PartSubstitutionListResponse,
  PartSubstitutionRevokeResponse,
  PartSubstitutionScope,
  PartSubstitutionStatus,
  PartSubstitutionSummary,
  PartEngineeringRecord,
  PartEngineeringRecordCreateInput,
  PartEngineeringRecordDraftDecisionInput,
  PartEngineeringRecordDraftSource,
  PartEngineeringRecordKind,
  PartEngineeringRecordListResponse,
  PartEngineeringRecordMutationResponse,
  PartEngineeringRecordOutcome,
  PartEngineeringRecordResolveInput,
  PartEngineeringRecordSeverity,
  PartCircuitBlockDependencyRecord,
  PartWhereUsedRecord,
  PartWhereUsedResponse,
  ProjectBomHealthResponse,
  ProjectBomHealthSummary,
  ProjectBomRiskFinding,
  ProjectBomRiskFindingCode,
  ProjectCreateInput,
  ProjectCreateResponse,
  ProjectFromCsvInput,
  ProjectFromCsvResponse,
  ProjectFromCsvSummary,
  Project,
  ProjectBomImportsResponse,
  ProjectDetailResponse,
  ProjectEvidenceAttachmentsResponse,
  ProjectFleetRiskResponse,
  ProjectFleetRiskRow,
  ProjectListResponse,
  ProjectMemoryCapability,
  ProjectOverlapCircuitBlockRolePreview,
  ProjectOverlapMemoryWarning,
  ProjectOverlapPanelResponse,
  ProjectOverlapPriorProject,
  ProjectOverlapSharedPartPreview,
  ProjectPartUsage,
  ProjectPartUsagesResponse,
  ProjectRevision,
  ProjectRevisionStatus,
  ProjectRevisionUpdateInput,
  ProjectRevisionUpdateResponse,
  ProjectRevisionsResponse,
  ProjectSummary,
  ProjectUpdateInput,
  ProjectUpdateResponse,
  CircuitBlockProjectDependency,
  WhereUsedAssetExportRecord,
  WhereUsedCircuitBlockDependencyRecord,
  WhereUsedDocumentHitRecord,
  WhereUsedInterconnectHitRecord,
  WhereUsedProjectUsageRecord,
  WhereUsedSearchResponse,
  WhereUsedTargetType
} from "@ee-library/shared/types";

/** ProjectListReadResult reports list availability without falling back to fake project memory. */
export type ProjectListReadResult = { status: "available"; response: ProjectListResponse } | { status: "not_configured" };

/** ProjectFleetRiskReadResult reports the cross-project risk dashboard. */
export type ProjectFleetRiskReadResult =
  | { status: "available"; response: ProjectFleetRiskResponse }
  | { status: "not_configured" };

/** ProjectCreateResult reports project creation or safe conflict/setup failures. */
export type ProjectCreateResult =
  | { status: "created"; response: ProjectCreateResponse }
  | { status: "conflict"; message: string }
  | { status: "not_configured" };

/** ProjectUpdateResult reports project metadata edits without touching trust records. */
export type ProjectUpdateResult =
  | { status: "updated"; response: ProjectUpdateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ProjectRevisionUpdateResult reports revision metadata edits scoped to one project. */
export type ProjectRevisionUpdateResult =
  | { status: "updated"; response: ProjectRevisionUpdateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** ProjectDetailReadResult reports one project detail read or an honest persistence boundary failure. */
export type ProjectDetailReadResult =
  | { status: "available"; response: ProjectDetailResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ProjectChildReadResult reports child collections scoped to an existing project. */
export type ProjectChildReadResult<TResponse> =
  | { status: "available"; response: TResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** BomImportLinesReadResult reports BOM line reads scoped to a persisted BOM import. */
export type BomImportLinesReadResult =
  | { status: "available"; response: BomImportLinesResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** BomImportCreateResult reports mapped CSV persistence without running part matching. */
export type BomImportCreateResult =
  | { status: "created"; response: BomImportCreateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** BomImportMatchResult reports one internal matching run without hiding setup boundaries. */
export type BomImportMatchResult =
  | { status: "matched"; response: BomImportMatchResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** PartWhereUsedReadResult reports usage history availability for one internal part. */
export type PartWhereUsedReadResult =
  | { status: "available"; response: PartWhereUsedResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** WhereUsedSearchReadResult reports global where-used search availability. */
export type WhereUsedSearchReadResult =
  | { status: "available"; response: WhereUsedSearchResponse }
  | { status: "not_configured" };

/** ProjectOverlapPanelReadResult reports overlap panel availability for one project. */
export type ProjectOverlapPanelReadResult =
  | { status: "available"; response: ProjectOverlapPanelResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ProjectBomHealthReadResult reports computed BOM health availability for one project. */
export type ProjectBomHealthReadResult =
  | { status: "available"; response: ProjectBomHealthResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** EvidenceAttachmentCreateResult reports validated evidence persistence boundaries. */
export type EvidenceAttachmentCreateResult =
  | { status: "created"; response: EvidenceAttachmentCreateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** EvidenceAttachmentListReadResult reports global evidence vault availability. */
export type EvidenceAttachmentListReadResult =
  | { status: "available"; response: EvidenceAttachmentListResponse }
  | { status: "not_configured" };

/** EvidenceAttachmentUpdateResult reports review metadata edits for one evidence row. */
export type EvidenceAttachmentUpdateResult =
  | { status: "updated"; response: EvidenceAttachmentUpdateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ProjectEvidenceReadResult reports evidence reads scoped to one project. */
export type ProjectEvidenceReadResult =
  | { status: "available"; response: ProjectEvidenceAttachmentsResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** FollowUpListReadResult reports persisted follow-up queue availability. */
export type FollowUpListReadResult =
  | { status: "available"; response: FollowUpListResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** FollowUpSyncResult reports generated or refreshed persistent follow-up work. */
export type FollowUpSyncResult =
  | { status: "synced"; response: FollowUpSyncResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** FollowUpUpdateResult reports follow-up workflow edits. */
export type FollowUpUpdateResult =
  | { status: "updated"; response: FollowUpUpdateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** CircuitBlockListReadResult reports reusable circuit library availability. */
export type CircuitBlockListReadResult =
  | { status: "available"; response: CircuitBlockListResponse }
  | { status: "not_configured" };

/** CircuitBlockDetailReadResult reports one circuit block detail or setup/not-found state. */
export type CircuitBlockDetailReadResult =
  | { status: "available"; response: CircuitBlockDetailResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** CircuitBlockCreateResult reports circuit block creation and safe conflict/setup failures. */
export type CircuitBlockCreateResult =
  | { status: "created"; response: CircuitBlockCreateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "conflict"; message: string }
  | { status: "not_configured" };

/** CircuitBlockUpdateResult reports editable circuit metadata outcomes. */
export type CircuitBlockUpdateResult =
  | { status: "updated"; response: CircuitBlockUpdateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** CircuitBlockPartCreateResult reports part-role persistence for one circuit block. */
export type CircuitBlockPartCreateResult =
  | { status: "created"; response: CircuitBlockPartCreateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** CircuitBlockPartUpdateResult reports editable role metadata outcomes. */
export type CircuitBlockPartUpdateResult =
  | { status: "updated"; response: CircuitBlockPartUpdateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** CircuitBlockKnownRiskCreateResult reports persistence of one new known-risk row. */
export type CircuitBlockKnownRiskCreateResult =
  | { status: "created"; response: CircuitBlockKnownRiskMutationResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** CircuitBlockKnownRiskResolveResult reports the lifecycle transition of one known-risk row. */
export type CircuitBlockKnownRiskResolveResult =
  | { status: "resolved"; response: CircuitBlockKnownRiskMutationResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** PartEngineeringRecordCreateResult reports persistence of one new part engineering-memory row. */
export type PartEngineeringRecordCreateResult =
  | { status: "created"; response: PartEngineeringRecordMutationResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** PartEngineeringRecordResolveResult reports the lifecycle transition of one engineering-memory row. */
export type PartEngineeringRecordResolveResult =
  | { status: "resolved"; response: PartEngineeringRecordMutationResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** PartEngineeringRecordDraftDecisionResult reports confirm/dismiss of one proposed auto-draft. */
export type PartEngineeringRecordDraftDecisionResult =
  | { status: "decided"; response: PartEngineeringRecordMutationResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** PartEngineeringRecordListReadResult reports a read of all engineering-memory rows for one part. */
export type PartEngineeringRecordListReadResult =
  | { status: "available"; response: PartEngineeringRecordListResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** PartSubstitutionCreateResult reports approval persistence and validation outcomes for one substitution. */
export type PartSubstitutionCreateResult =
  | { status: "created"; response: PartSubstitutionCreateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "conflict"; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** PartSubstitutionListReadResult reports the active + revoked substitutions for one part. */
export type PartSubstitutionListReadResult =
  | { status: "available"; response: PartSubstitutionListResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** PartSubstitutionRevokeResult reports a revoke action and its trust boundary. */
export type PartSubstitutionRevokeResult =
  | { status: "revoked"; response: PartSubstitutionRevokeResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** CircuitBlockInstantiationCreateResult reports synthetic-BOM generation from a reusable block. */
export type CircuitBlockInstantiationCreateResult =
  | { status: "created"; response: CircuitBlockInstantiationCreateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** ExportBundleCreateResult reports bundle generation and manifest persistence. */
export type ExportBundleCreateResult =
  | { status: "created"; response: ExportBundleCreateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ExportBundleListReadResult reports export bundle history for one project. */
export type ExportBundleListReadResult =
  | { status: "available"; response: ExportBundleListResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** BomImportDiagnosticsReadResult reports match-status diagnostics for one import. */
export type BomImportDiagnosticsReadResult =
  | { status: "available"; response: BomImportDiagnosticsResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** BomRevisionCompareReadResult reports the diff between two BOM imports. */
export type BomRevisionCompareReadResult =
  | { status: "available"; response: BomRevisionCompareResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ProjectRevisionCompareReadResult reports the revision-vs-revision BOM diff for one project. */
export type ProjectRevisionCompareReadResult =
  | { status: "available"; response: ProjectRevisionCompareResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** ProjectRevisionApprovalGateListReadResult reports persisted BOM approval gates for one project. */
export type ProjectRevisionApprovalGateListReadResult =
  | { status: "available"; response: ProjectRevisionApprovalGateListResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ProjectRevisionApprovalGateActionResult reports one gate open/approval/request-changes action. */
export type ProjectRevisionApprovalGateActionResult =
  | { status: "applied"; response: ProjectRevisionApprovalGateResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found"; code: string; message: string };

/** CircuitBlockProjectDependenciesReadResult reports projects that use parts from one circuit block. */
export type CircuitBlockProjectDependenciesReadResult =
  | { status: "available"; dependencies: CircuitBlockProjectDependency[] }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ConnectorSetListReadResult reports connector-set catalog availability. */
export type ConnectorSetListReadResult =
  | { status: "available"; response: ConnectorSetListResponse }
  | { status: "not_configured" };

/** ApprovalBatchCandidatesReadResult reports the project-scoped approval candidate queue. */
export type ApprovalBatchCandidatesReadResult =
  | { status: "available"; response: ApprovalBatchCandidatesResponse }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ApprovalBatchActionResult reports the outcome of a bulk approval action triggered from project context. */
export type ApprovalBatchActionResult =
  | { status: "applied"; response: ApprovalBatchResponse }
  | { status: "invalid"; code: string; message: string }
  | { status: "not_configured" }
  | { status: "not_found" };

/** ProjectMemoryCapability list labels read foundations and planned workflows for honest API consumers. */
const PROJECT_MEMORY_CAPABILITIES: ProjectMemoryCapability[] = [
  {
    detail: "Project records can be read when they exist in the database.",
    id: "project_records",
    label: "Project records",
    state: "foundation"
  },
  {
    detail: "BOM import metadata and persisted rows can be read after CSV intake creates them.",
    id: "bom_import_records",
    label: "BOM import records",
    state: "foundation"
  },
  {
    detail: "CSV BOM upload and column mapping can persist raw and mapped BOM lines without part matching.",
    id: "bom_upload",
    label: "BOM upload",
    state: "foundation"
  },
  {
    detail: "BOM row matching can confirm exact internal MPN/manufacturer rows while keeping weak and ambiguous rows out of usage history.",
    id: "bom_matching",
    label: "BOM matching",
    state: "foundation"
  },
  {
    detail: "Where-used reads expose confirmed project usage by part while staying separate from approval and export readiness.",
    id: "where_used",
    label: "Where-used",
    state: "foundation"
  },
  {
    detail: "BOM health derives explainable risk findings from persisted BOM rows, confirmed usage, assets, lifecycle, and evidence.",
    id: "bom_health",
    label: "BOM health",
    state: "foundation"
  },
  {
    detail: "Revision approval gates preserve the exact BOM diff fingerprint an engineer reviewed without changing part approval or export readiness.",
    id: "revision_approval_gates",
    label: "Revision approval gates",
    state: "foundation"
  },
  {
    detail: "Evidence attachment metadata can be preserved for projects, parts, BOM rows, usage, assets, and risk findings without changing trust state.",
    id: "evidence_vault",
    label: "Evidence vault",
    state: "foundation"
  },
  {
    detail: "Circuit block records preserve structured reusable circuit knowledge, constraints, linked parts, and evidence without overriding part readiness.",
    id: "circuit_blocks",
    label: "Circuit blocks",
    state: "foundation"
  }
];

/** pool is initialized lazily so project-memory reads do not require DATABASE_URL in tests. */
let pool: Pool | null = null;

/** DatabaseProjectSummaryRow is one project row plus project-memory child counts. */
interface DatabaseProjectSummaryRow extends DatabaseProjectRow {
  revision_count: string | number;
  bom_import_count: string | number;
  usage_count: string | number;
  latest_revision_updated_at: Date | string | null;
  latest_bom_import_updated_at: Date | string | null;
  latest_usage_updated_at: Date | string | null;
}

/** DatabaseProjectRow is the persisted project root shape. */
interface DatabaseProjectRow {
  id: string;
  project_key: string;
  name: string;
  description: string;
  owner: string | null;
  status: Project["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseProjectRevisionRow is the persisted project revision shape. */
interface DatabaseProjectRevisionRow {
  id: string;
  project_id: string;
  revision_label: string;
  revision_status: ProjectRevision["revisionStatus"];
  source_reference: string | null;
  released_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseProjectRevisionApprovalGateRow is the persisted BOM approval gate shape. */
interface DatabaseProjectRevisionApprovalGateRow {
  id: string;
  project_id: string;
  from_project_revision_id: string;
  to_project_revision_id: string;
  gate_status: ProjectRevisionApprovalGateStatus;
  diff_fingerprint: string;
  diff_summary: unknown;
  decision_notes: string;
  created_by: string;
  decided_by: string | null;
  decided_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseBomImportRow is the persisted BOM import metadata shape. */
interface DatabaseBomImportRow {
  id: string;
  project_id: string;
  project_revision_id: string;
  source_filename: string;
  source_format: BomImport["sourceFormat"];
  storage_key: string | null;
  import_status: BomImport["importStatus"];
  column_mapping: unknown;
  import_summary: unknown;
  imported_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseBomLineRow is the persisted raw and mapped BOM line shape. */
interface DatabaseBomLineRow {
  id: string;
  bom_import_id: string;
  project_id: string;
  project_revision_id: string;
  row_number: number;
  designators: unknown;
  quantity: string | number | null;
  raw_mpn: string | null;
  raw_manufacturer: string | null;
  raw_description: string | null;
  raw_supplier_reference: string | null;
  raw_notes: string | null;
  raw_row_payload: unknown;
  matched_part_id: string | null;
  match_status: BomLine["matchStatus"];
  match_confidence_score: string | number | null;
  instantiated_from_circuit_block_id: string | null;
  instantiated_from_circuit_block_part_id: string | null;
  instantiated_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseProjectPartUsageRow is one confirmed project usage row. */
interface DatabaseProjectPartUsageRow {
  id: string;
  project_id: string;
  project_revision_id: string;
  bom_line_id: string | null;
  part_id: string;
  part_mpn?: string;
  manufacturer_name?: string;
  usage_context: string | null;
  designators: unknown;
  quantity: string | number | null;
  usage_status: ProjectPartUsage["usageStatus"];
  approval_snapshot: unknown;
  readiness_snapshot: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabasePartWhereUsedRow is one usage row joined to project, revision, and optional BOM-line context. */
interface DatabasePartWhereUsedRow {
  usage_id: string;
  usage_project_id: string;
  usage_project_revision_id: string;
  usage_bom_line_id: string | null;
  usage_part_id: string;
  usage_context: string | null;
  usage_designators: unknown;
  usage_quantity: string | number | null;
  usage_status: ProjectPartUsage["usageStatus"];
  usage_approval_snapshot: unknown;
  usage_readiness_snapshot: unknown;
  usage_created_at: Date | string;
  usage_updated_at: Date | string;
  project_id: string;
  project_key: string;
  project_name: string;
  project_description: string;
  project_owner: string | null;
  project_status: Project["status"];
  project_created_at: Date | string;
  project_updated_at: Date | string;
  revision_id: string;
  revision_project_id: string;
  revision_label: string;
  revision_status: ProjectRevision["revisionStatus"];
  revision_source_reference: string | null;
  revision_released_at: Date | string | null;
  revision_created_at: Date | string;
  revision_updated_at: Date | string;
  line_id: string | null;
  line_bom_import_id: string | null;
  line_project_id: string | null;
  line_project_revision_id: string | null;
  line_row_number: number | null;
  line_designators: unknown;
  line_quantity: string | number | null;
  line_raw_mpn: string | null;
  line_raw_manufacturer: string | null;
  line_raw_description: string | null;
  line_raw_supplier_reference: string | null;
  line_raw_notes: string | null;
  line_raw_row_payload: unknown;
  line_matched_part_id: string | null;
  line_match_status: BomLine["matchStatus"] | null;
  line_match_confidence_score: string | number | null;
  line_created_at: Date | string | null;
  line_updated_at: Date | string | null;
}

/** DatabaseProjectBomHealthRow carries one BOM line plus matched-part health inputs. */
interface DatabaseProjectBomHealthRow extends DatabaseBomLineRow {
  lifecycle_status: string | null;
  matched_part_last_updated_at: Date | string | null;
  approval_status: string | null;
  readiness_status: string | null;
  connector_class: string | null;
  blocker_count: string | number | null;
  verified_cad_count: string | number;
  file_backed_cad_count: string | number;
  referenced_cad_count: string | number;
  evidence_count: string | number;
}

/** DatabaseEvidenceAttachmentRow is one persisted decision-evidence metadata row. */
interface DatabaseEvidenceAttachmentRow {
  id: string;
  target_type: EvidenceTargetType;
  target_id: string;
  evidence_type: EvidenceAttachmentType;
  title: string;
  source_url: string | null;
  storage_key: string | null;
  file_hash: string | null;
  mime_type: string | null;
  notes: string | null;
  provenance: string;
  review_status: EvidenceReviewStatus;
  uploaded_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseFollowUpRecordRow is one persisted assignable follow-up work item. */
interface DatabaseFollowUpRecordRow {
  id: string;
  target_type: FollowUpTargetType;
  target_id: string;
  source_type: FollowUpRecord["sourceType"];
  source_finding_id: string;
  title: string;
  detail: string;
  next_action: string;
  severity: FollowUpRecord["severity"];
  status: FollowUpStatus;
  assigned_to: string | null;
  source_inputs: unknown;
  evidence_attachment_ids: unknown;
  resolution_notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
}

/** DatabaseCircuitBlockRow is one reusable circuit knowledge record. */
interface DatabaseCircuitBlockRow {
  id: string;
  block_key: string;
  name: string;
  description: string;
  block_type: CircuitBlockType;
  owner: string | null;
  status: CircuitBlockStatus;
  reuse_scope: string;
  constraints: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseCircuitBlockSummaryRow adds explainable list counts to one block row. */
interface DatabaseCircuitBlockSummaryRow extends DatabaseCircuitBlockRow {
  total_part_count: string | number;
  required_part_count: string | number;
  optional_part_count: string | number;
  approved_part_count: string | number;
  readiness_gap_count: string | number;
  lifecycle_risk_count: string | number;
  strict_substitution_count: string | number;
  evidence_attachment_count: string | number;
  project_usage_count: string | number;
  active_known_risk_count: string | number;
  active_blocking_risk_count: string | number;
}

/** DatabaseCircuitBlockKnownRiskRow models one persisted known-risk row. */
interface DatabaseCircuitBlockKnownRiskRow {
  id: string;
  circuit_block_id: string;
  title: string;
  detail: string;
  severity: string;
  recorded_by: string | null;
  recorded_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  evidence_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabasePartEngineeringRecordRow models one persisted part engineering-memory row. */
interface DatabasePartEngineeringRecordRow {
  id: string;
  part_id: string;
  record_kind: string;
  title: string;
  detail: string;
  severity: string;
  outcome: string | null;
  related_asset_id: string | null;
  datasheet_revision_id: string | null;
  related_mpn: string | null;
  depended_on_by: string | null;
  recorded_by: string | null;
  recorded_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  evidence_url: string | null;
  draft_status: string;
  draft_source: string;
  trigger_ref: string | null;
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseCircuitBlockProjectDependencyRow is one project that has confirmed usages of block parts. */
interface DatabaseCircuitBlockProjectDependencyRow {
  project_id: string;
  project_key: string;
  project_name: string;
  project_status: string;
  project_created_at: Date | string;
  project_updated_at: Date | string;
  matched_part_count: string | number;
  total_block_part_count: string | number;
}

/** DatabaseCircuitBlockPartRow is one part role inside a reusable circuit block. */
interface DatabaseCircuitBlockPartRow {
  id: string;
  circuit_block_id: string;
  part_id: string;
  role: string;
  quantity: string | number | null;
  is_required: boolean;
  substitution_policy: CircuitBlockPartSubstitutionPolicy;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** DatabaseCircuitBlockPartDetailRow joins a block part to current catalog health signals. */
interface DatabaseCircuitBlockPartDetailRow extends DatabaseCircuitBlockPartRow {
  mpn: string;
  manufacturer_name: string;
  lifecycle_status: CircuitBlockPartCatalogSummary["lifecycleStatus"];
  approval_status: CircuitBlockPartCatalogSummary["approvalStatus"];
  readiness_status: CircuitBlockPartCatalogSummary["readinessStatus"];
  connector_class: CircuitBlockPartCatalogSummary["connectorClass"];
  blocker_count: string | number | null;
}

/** DatabaseWhereUsedPartSummaryRow is a compact part identity plus current readiness context. */
interface DatabaseWhereUsedPartSummaryRow {
  part_id: string;
  mpn: string;
  manufacturer_name: string;
  lifecycle_status: CircuitBlockPartCatalogSummary["lifecycleStatus"];
  approval_status: CircuitBlockPartCatalogSummary["approvalStatus"];
  readiness_status: CircuitBlockPartCatalogSummary["readinessStatus"];
  connector_class: CircuitBlockPartCatalogSummary["connectorClass"];
  blocker_count: string | number | null;
}

/** DatabaseWhereUsedCircuitBlockDependencyRow joins a circuit block role to its part summary. */
interface DatabaseWhereUsedCircuitBlockDependencyRow extends DatabaseCircuitBlockPartDetailRow {
  block_id: string;
  block_key: string;
  block_name: string;
  block_description: string;
  block_type: CircuitBlockType;
  block_owner: string | null;
  block_status: CircuitBlockStatus;
  block_reuse_scope: string;
  block_constraints: unknown;
  block_created_at: Date | string;
  block_updated_at: Date | string;
}

/** DatabasePartMatchCandidateRow is the canonical internal part identity used for BOM matching. */
interface DatabasePartMatchCandidateRow {
  part_id: string;
  mpn: string;
  manufacturer_id: string;
  manufacturer_name: string;
  manufacturer_aliases: unknown;
}

/** DatabasePartApprovalSnapshotRow is the approval evidence captured onto confirmed usage. */
interface DatabasePartApprovalSnapshotRow {
  approval_status: string;
  summary: string;
  detail: string;
  evidence: unknown;
  decided_by: string | null;
  decided_at: Date | string | null;
  last_updated_at: Date | string;
}

/** DatabasePartReadinessSnapshotRow is the readiness evidence captured onto confirmed usage. */
interface DatabasePartReadinessSnapshotRow {
  readiness_status: string;
  identity_status: string;
  connector_class: string;
  blocker_count: string | number;
  blocker_summary: unknown;
  recommended_actions: unknown;
  detail: string;
  last_evaluated_at: Date | string;
}

/** BomLineMatchOutcome is the deterministic result of matching one BOM line. */
interface BomLineMatchOutcome {
  matchConfidenceScore: number | null;
  matchedPartId: string | null;
  matchStatus: BomLineMatchStatus;
}

/** NormalizedProjectUpdateInput is validated project edit input ready for SQL parameters. */
interface NormalizedProjectUpdateInput {
  description: string;
  name: string;
  owner: string | null;
  status: Project["status"];
}

/** NormalizedProjectRevisionUpdateInput is validated revision edit input ready for SQL parameters. */
interface NormalizedProjectRevisionUpdateInput {
  releasedAt: Date | null;
  revisionStatus: ProjectRevisionStatus;
  sourceReference: string | null;
}

/** NormalizedCircuitBlockCreateInput is validated write input ready for SQL parameters. */
interface NormalizedCircuitBlockCreateInput {
  blockKey: string;
  blockType: CircuitBlockType;
  constraints: Record<string, unknown>;
  description: string;
  name: string;
  owner: string | null;
  reuseScope: string;
  status: CircuitBlockStatus;
}

/** NormalizedCircuitBlockUpdateInput is validated block edit input ready for SQL parameters. */
interface NormalizedCircuitBlockUpdateInput {
  blockType: CircuitBlockType;
  constraints: Record<string, unknown>;
  description: string;
  name: string;
  owner: string | null;
  reuseScope: string;
  status: CircuitBlockStatus;
}

/** NormalizedCircuitBlockPartCreateInput is validated part-role input ready for SQL parameters. */
interface NormalizedCircuitBlockPartCreateInput {
  isRequired: boolean;
  notes: string | null;
  partId: string;
  quantity: number | null;
  role: string;
  substitutionPolicy: CircuitBlockPartSubstitutionPolicy;
}

/** NormalizedCircuitBlockPartUpdateInput is validated role edit input ready for SQL parameters. */
interface NormalizedCircuitBlockPartUpdateInput {
  isRequired: boolean;
  notes: string | null;
  quantity: number | null;
  substitutionPolicy: CircuitBlockPartSubstitutionPolicy;
}

/** NormalizedFollowUpUpdateInput is validated workflow metadata for one follow-up row. */
interface NormalizedFollowUpUpdateInput {
  assignedTo: string | null;
  evidenceAttachmentIds: string[] | undefined;
  resolutionNotes: string | null;
  status: FollowUpStatus;
}

/** FollowUpSeedRecord is a computed gap ready to upsert as assignable work. */
interface FollowUpSeedRecord {
  detail: string;
  evidenceAttachmentIds: string[];
  nextAction: string;
  severity: FollowUpRecord["severity"];
  sourceFindingId: string;
  sourceInputs: string[];
  sourceType: FollowUpSourceType;
  targetId: string;
  targetType: FollowUpTargetType;
  title: string;
}

/** ProjectMemoryInputError reports validated request problems from write helpers. */
class ProjectMemoryInputError extends Error {
  readonly code: string;

  /**
   * Creates a stable input error for project-memory API write responses.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectMemoryInputError";
    this.code = code;
  }
}

/**
 * Replaces the project-memory database pool for tests that use an in-memory Postgres adapter.
 */
export function setProjectMemoryStorePoolForTests(databasePool: Pool | null): void {
  pool = databasePool;
}

/**
 * Creates a project root and first revision so BOM uploads have a durable memory scope.
 */
export async function createProjectInDatabase(input: ProjectCreateInput): Promise<ProjectCreateResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const normalizedProjectKey = normalizeProjectKey(input.projectKey);
  const normalizedName = input.name.trim();
  const revisionLabel = normalizeOptionalText(input.initialRevisionLabel) ?? "Working";

  try {
    const client = await databasePool.connect();

    try {
      await client.query("BEGIN");

      const projectId = buildProjectId(normalizedProjectKey);
      const revisionId = buildProjectRevisionId(projectId, revisionLabel);
      const now = new Date();
      const projectResult = await client.query<DatabaseProjectRow>(
        `
          INSERT INTO projects (id, project_key, name, description, owner, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          RETURNING id, project_key, name, description, owner, status, created_at, updated_at
        `,
        [
          projectId,
          normalizedProjectKey,
          normalizedName,
          normalizeOptionalText(input.description) ?? "",
          normalizeOptionalText(input.owner),
          input.status ?? "active",
          now
        ]
      );
      const revisionResult = await client.query<DatabaseProjectRevisionRow>(
        `
          INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference, created_at, updated_at)
          VALUES ($1, $2, $3, 'draft', $4, $5, $5)
          RETURNING id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
        `,
        [revisionId, projectId, revisionLabel, "Created with project memory setup", now]
      );

      await client.query("COMMIT");

      const detail = await readProjectDetailFromDatabase(projectId);

      if (detail.status !== "available") {
        throw new CatalogStoreError("query_failed", "Created project could not be read back from project memory.", new Error("project_readback_failed"));
      }

      const projectRow = projectResult.rows[0];
      const revisionRow = revisionResult.rows[0];

      if (!projectRow || !revisionRow) {
        throw new CatalogStoreError("query_failed", "Project creation returned no persisted rows.", new Error("missing_project_create_rows"));
      }

      return {
        response: {
          detail: detail.response,
          initialRevision: mapProjectRevisionRow(revisionRow),
          project: mapProjectRow(projectRow)
        },
        status: "created"
      };
    } catch (error) {
      await client.query("ROLLBACK");

      if (isUniqueViolation(error)) {
        return {
          message: "A project with that key already exists.",
          status: "conflict"
        };
      }

      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        message: "A project with that key already exists.",
        status: "conflict"
      };
    }

    throw toProjectMemoryStoreError(error);
  }
}

/** PROJECT_FROM_CSV_BOUNDARY_COPY reinforces the trust contract for the chained onboarding flow. */
export const PROJECT_FROM_CSV_BOUNDARY_COPY =
  "Saving and matching BOM rows is not approval. Matched lines are confirmed project usage; unmatched and weak rows are remembered explicitly and stay separate from approved part records.";

/** ProjectFromCsvResult reports each failure path so callers can render targeted recovery copy. */
export type ProjectFromCsvResult =
  | { status: "created"; response: ProjectFromCsvResponse }
  | { status: "not_configured" }
  | { status: "invalid_csv"; code: string; message: string }
  | { status: "missing_mpn_mapping"; headers: string[]; suggestedMapping: BomColumnMapping }
  | { status: "project_conflict"; message: string }
  | { status: "invalid"; code: string; message: string };

/**
 * Composes project creation, BOM import, and deterministic matching into one
 * server action so a brand-new operator can land on the diagnostics view by
 * dropping a single CSV. Each underlying helper still manages its own transaction;
 * we chain them deliberately so a partial failure leaves work behind that the
 * operator can recover from (e.g. project created, BOM import failed -> retry
 * upload from the project page) rather than rolling back to nothing.
 *
 * The chained helper does NOT invent catalog identity. The MPN column must be
 * recognizable in the CSV's headers; otherwise the caller is told to fall back
 * to the manual mapping panel. Matched vs unmatched-but-saved is preserved on
 * the response so the UI can be honest about what was confirmed.
 */
export async function createProjectFromCsvInDatabase(
  input: ProjectFromCsvInput,
  actor: string
): Promise<ProjectFromCsvResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  // Parse + auto-mapping happen entirely in shared helpers; we surface the same
  // BomCsvParseError shape the manual mapping panel already produces so the
  // recovery copy can stay consistent across both entry points.
  let preview;
  try {
    preview = buildBomImportPreview({
      rawContent: input.rawContent,
      sourceFilename: input.sourceFilename,
      sourceFormat: input.sourceFormat
    });
  } catch (error) {
    if (error instanceof BomCsvParseError) {
      return { status: "invalid_csv", code: error.code, message: error.message };
    }
    throw error;
  }

  if (!hasMappedHeader(preview.headers, preview.suggestedMapping.mpn)) {
    return {
      status: "missing_mpn_mapping",
      headers: preview.headers,
      suggestedMapping: preview.suggestedMapping
    };
  }

  const projectName = deriveProjectName(input.projectName, input.sourceFilename);
  const projectKey = deriveProjectKey(input.projectKey, projectName);

  const projectResult = await createProjectInDatabase({
    description: input.description ?? null,
    initialRevisionLabel: input.initialRevisionLabel ?? null,
    name: projectName,
    projectKey
  });

  if (projectResult.status === "not_configured") {
    return { status: "not_configured" };
  }
  if (projectResult.status === "conflict") {
    return { status: "project_conflict", message: projectResult.message };
  }

  const importResult = await createBomImportInDatabase(
    projectResult.response.project.id,
    {
      columnMapping: preview.suggestedMapping,
      projectRevisionId: projectResult.response.initialRevision.id,
      rawContent: input.rawContent,
      sourceFilename: input.sourceFilename,
      sourceFormat: input.sourceFormat
    },
    actor
  );

  if (importResult.status === "not_configured") {
    return { status: "not_configured" };
  }
  if (importResult.status === "not_found") {
    // Should not happen because we just created the project; treat as invalid for honest reporting.
    return {
      status: "invalid",
      code: "PROJECT_DISAPPEARED",
      message: "The new project record was not found when persisting the BOM import."
    };
  }
  if (importResult.status === "invalid") {
    return { status: "invalid", code: importResult.code, message: importResult.message };
  }

  const matchResult = await matchBomImportRowsInDatabase(importResult.response.bomImport.id);

  if (matchResult.status === "not_configured") {
    return { status: "not_configured" };
  }
  if (matchResult.status === "not_found") {
    return {
      status: "invalid",
      code: "BOM_IMPORT_DISAPPEARED",
      message: "The new BOM import record was not found when running deterministic row matching."
    };
  }

  const summary: ProjectFromCsvSummary = {
    ambiguousLineCount: matchResult.response.summary.ambiguousLineCount,
    matchedLineCount: matchResult.response.summary.matchedLineCount,
    parsedRowCount: preview.rowCount,
    savedLineCount: importResult.response.lineCount,
    skippedBlankRowCount: preview.skippedBlankRowCount,
    unmatchedLineCount: matchResult.response.summary.unmatchedLineCount,
    warnings: preview.warnings,
    weakMatchLineCount: matchResult.response.summary.weakMatchLineCount
  };

  return {
    status: "created",
    response: {
      boundary: PROJECT_FROM_CSV_BOUNDARY_COPY,
      bomImport: matchResult.response.bomImport,
      columnMapping: preview.suggestedMapping,
      initialRevision: projectResult.response.initialRevision,
      project: projectResult.response.project,
      summary
    }
  };
}

/**
 * Produces a sensible project name when the caller did not supply one. Strips
 * the file extension and any trailing version suffixes so an upload like
 * "MotorController_BOM_v3.csv" yields "MotorController BOM".
 */
function deriveProjectName(suppliedName: string | null | undefined, sourceFilename: string): string {
  const explicit = suppliedName?.trim();
  if (explicit) return explicit;

  const stem = sourceFilename
    .replace(/\.[^/.]+$/u, "")
    .replace(/[_-]+/gu, " ")
    .replace(/\s*v?\d+(\.\d+)*\s*$/iu, "")
    .replace(/\s+bom$/iu, " BOM")
    .trim();

  return stem.length > 0 ? stem : "Imported BOM";
}

/**
 * Produces a deterministic project key when the caller did not supply one.
 * Strips whitespace and non-ASCII-alphanumeric characters and upper-cases the
 * result so the key satisfies the existing unique-index constraint without the
 * caller having to do the normalization manually.
 */
function deriveProjectKey(suppliedKey: string | null | undefined, projectName: string): string {
  const explicit = suppliedKey?.trim();
  if (explicit) return explicit;

  const slug = projectName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32);

  if (slug.length > 0) return slug;

  return `IMPORT-${new Date().toISOString().slice(0, 10).replace(/-/gu, "")}`;
}

/**
 * Updates project metadata without approving parts, rematching BOM rows, or changing export readiness.
 */
export async function updateProjectInDatabase(projectId: string, input: ProjectUpdateInput): Promise<ProjectUpdateResult> {
  const normalized = normalizeProjectUpdateInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const now = new Date();
    const result = await databasePool.query<DatabaseProjectRow>(
      `
        UPDATE projects
        SET name = $2,
          description = $3,
          owner = $4,
          status = $5,
          updated_at = $6
        WHERE id = $1
        RETURNING id, project_key, name, description, owner, status, created_at, updated_at
      `,
      [
        projectId,
        normalized.input.name,
        normalized.input.description,
        normalized.input.owner,
        normalized.input.status,
        now
      ]
    );
    const row = result.rows[0];

    if (!row) {
      return { status: "not_found" };
    }

    const detail = await readProjectDetailFromDatabase(projectId);

    if (detail.status !== "available") {
      throw new CatalogStoreError("query_failed", "Updated project could not be read back from project memory.", new Error("project_update_readback_failed"));
    }

    return {
      response: {
        boundary: "Project metadata edits do not approve parts, validate evidence, or alter export readiness.",
        detail: detail.response,
        project: mapProjectRow(row)
      },
      status: "updated"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Updates project revision metadata without changing persisted BOM rows or confirmed usage records.
 */
export async function updateProjectRevisionInDatabase(projectId: string, revisionId: string, input: ProjectRevisionUpdateInput): Promise<ProjectRevisionUpdateResult> {
  const normalized = normalizeProjectRevisionUpdateInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return {
        code: "PROJECT_NOT_FOUND",
        message: "Project not found.",
        status: "not_found"
      };
    }

    const now = new Date();
    const result = await databasePool.query<DatabaseProjectRevisionRow>(
      `
        UPDATE project_revisions
        SET revision_status = $3,
          source_reference = $4,
          released_at = $5,
          updated_at = $6
        WHERE project_id = $1 AND id = $2
        RETURNING id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
      `,
      [
        projectId,
        revisionId,
        normalized.input.revisionStatus,
        normalized.input.sourceReference,
        normalized.input.releasedAt,
        now
      ]
    );
    const row = result.rows[0];

    if (!row) {
      return {
        code: "PROJECT_REVISION_NOT_FOUND",
        message: "Project revision not found.",
        status: "not_found"
      };
    }

    await databasePool.query("UPDATE projects SET updated_at = $2 WHERE id = $1", [projectId, now]);

    const detail = await readProjectDetailFromDatabase(projectId);

    if (detail.status !== "available") {
      throw new CatalogStoreError("query_failed", "Updated project revision could not be read back from project memory.", new Error("project_revision_update_readback_failed"));
    }

    return {
      response: {
        boundary: "Revision metadata edits do not remap BOM rows or create confirmed part usage.",
        detail: detail.response,
        revision: mapProjectRevisionRow(row)
      },
      status: "updated"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads the project list from persisted project-memory tables.
 */
export async function readProjectsFromDatabase(): Promise<ProjectListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const projects = await readProjectSummaries(databasePool);

    return {
      response: {
        capabilities: PROJECT_MEMORY_CAPABILITIES,
        projects,
        state: projects.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads a cross-project risk dashboard with explainable BOM, approval, lifecycle, CAD, and follow-up counts.
 */
export async function readProjectFleetRiskFromDatabase(): Promise<ProjectFleetRiskReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const summaries = await readProjectSummaries(databasePool);

    const rows: ProjectFleetRiskRow[] = [];
    for (const summary of summaries) {
      const projectId = summary.project.id;
      const [healthRows, openFollowUpCount] = await Promise.all([
        readProjectBomHealthRows(databasePool, projectId),
        readOpenProjectFollowUpCount(databasePool, projectId)
      ]);

      const counts = computeProjectFleetCounts(healthRows);
      const row: ProjectFleetRiskRow = {
        approvalGapCount: counts.approvalGapCount,
        lifecycleRiskCount: counts.lifecycleRiskCount,
        missingVerifiedCadCount: counts.missingVerifiedCadCount,
        openFollowUpCount,
        project: summary.project,
        totalRiskCount:
          counts.unmatchedLineCount +
          counts.weakOrAmbiguousLineCount +
          counts.approvalGapCount +
          counts.lifecycleRiskCount +
          counts.missingVerifiedCadCount +
          openFollowUpCount,
        unmatchedLineCount: counts.unmatchedLineCount,
        weakOrAmbiguousLineCount: counts.weakOrAmbiguousLineCount
      };
      rows.push(row);
    }

    rows.sort((left, right) => {
      if (right.totalRiskCount !== left.totalRiskCount) {
        return right.totalRiskCount - left.totalRiskCount;
      }
      return left.project.name.localeCompare(right.project.name);
    });

    return {
      response: {
        boundary:
          "Counts are explainable inputs derived from persisted BOM rows, confirmed usage, lifecycle, CAD, and follow-up records. They do not approve parts, validate assets, or unlock export.",
        rows,
        state: rows.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Counts open follow-up records targeting one project.
 */
async function readOpenProjectFollowUpCount(databasePool: Pool | PoolClient, projectId: string): Promise<number> {
  const result = await databasePool.query<{ open_count: string | number }>(
    `SELECT COUNT(*)::text AS open_count
       FROM follow_up_records
       WHERE target_type = 'project' AND target_id = $1 AND status = 'open'`,
    [projectId]
  );
  return Number(result.rows[0]?.open_count ?? 0);
}

/**
 * Aggregates one project's BOM health rows into the fleet-row count fields.
 */
function computeProjectFleetCounts(rows: DatabaseProjectBomHealthRow[]): {
  unmatchedLineCount: number;
  weakOrAmbiguousLineCount: number;
  approvalGapCount: number;
  lifecycleRiskCount: number;
  missingVerifiedCadCount: number;
} {
  let unmatchedLineCount = 0;
  let weakOrAmbiguousLineCount = 0;
  let approvalGapCount = 0;
  let lifecycleRiskCount = 0;
  let missingVerifiedCadCount = 0;

  for (const row of rows) {
    const matchStatus = row.match_status;
    if (matchStatus === "unmatched") unmatchedLineCount += 1;
    if (matchStatus === "weak_match" || matchStatus === "ambiguous") weakOrAmbiguousLineCount += 1;

    if (matchStatus === "matched" && row.matched_part_id) {
      if (row.approval_status !== "approved") {
        approvalGapCount += 1;
      }
      if (row.lifecycle_status === "obsolete" || row.lifecycle_status === "not_recommended") {
        lifecycleRiskCount += 1;
      }
      const verifiedCadCount = Number(row.verified_cad_count ?? 0);
      if (!Number.isFinite(verifiedCadCount) || verifiedCadCount === 0) {
        missingVerifiedCadCount += 1;
      }
    }
  }

  return { approvalGapCount, lifecycleRiskCount, missingVerifiedCadCount, unmatchedLineCount, weakOrAmbiguousLineCount };
}

/**
 * Reads one project and its immediate persisted memory collections.
 */
export async function readProjectDetailFromDatabase(projectId: string): Promise<ProjectDetailReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const summary = await readProjectSummary(databasePool, projectId);

    if (!summary) {
      return { status: "not_found" };
    }

    const [revisions, bomImports, usages] = await Promise.all([
      readProjectRevisions(databasePool, projectId),
      readProjectBomImports(databasePool, projectId),
      readProjectPartUsages(databasePool, projectId)
    ]);

    return {
      response: {
        bomImports,
        capabilities: PROJECT_MEMORY_CAPABILITIES,
        project: summary.project,
        revisions,
        state: "available",
        summary,
        usages
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Persists one mapped CSV BOM import and raw BOM lines without creating part matches.
 */
export async function createBomImportInDatabase(projectId: string, input: BomImportCreateInput, importedBy: string): Promise<BomImportCreateResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const parsedCsv = input.sourceFormat === "xlsx"
      ? parseBomXlsx(input.rawContent)
      : parseBomCsv(input.rawContent);
    const columnMapping = normalizeBomColumnMapping(input.columnMapping);

    if (!hasMappedHeader(parsedCsv.headers, columnMapping.mpn)) {
      return {
        code: "BOM_MPN_MAPPING_REQUIRED",
        message: "Map an MPN column before saving the BOM import.",
        status: "invalid"
      };
    }

    const lineDrafts = mapBomRowsToDrafts(parsedCsv.rows, columnMapping);

    if (lineDrafts.length === 0) {
      return {
        code: "BOM_HAS_NO_ROWS",
        message: "The BOM CSV contains no nonblank rows to save.",
        status: "invalid"
      };
    }

    const client = await databasePool.connect();

    try {
      await client.query("BEGIN");

      if (!(await projectExists(client, projectId))) {
        await client.query("ROLLBACK");
        return { status: "not_found" };
      }

      const revision = await resolveProjectRevisionForBomImport(client, projectId, input);
      const now = new Date();
      const bomImportId = `bomimp-${randomUUID()}`;
      const importSummary = {
        createdBy: "p0-mem4",
        mappedFieldCount: countMappedBomFields(columnMapping),
        matchStatus: "unmatched",
        persistedLineCount: lineDrafts.length,
        rowCount: parsedCsv.rowCount,
        skippedBlankRowCount: parsedCsv.skippedBlankRowCount,
        warnings: parsedCsv.warnings
      };
      const bomImportResult = await client.query<DatabaseBomImportRow>(
        `
          INSERT INTO bom_imports (id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'mapped', $7::jsonb, $8::jsonb, $9, $10, $10)
          RETURNING id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at
        `,
        [
          bomImportId,
          projectId,
          revision.id,
          input.sourceFilename.trim(),
          input.sourceFormat ?? "csv",
          null,
          JSON.stringify(columnMapping),
          JSON.stringify(importSummary),
          importedBy,
          now
        ]
      );
      const savedLines: BomLine[] = [];

      for (const draft of lineDrafts) {
        const lineResult = await client.query<DatabaseBomLineRow>(
          `
            INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes, raw_row_payload, matched_part_id, match_status, match_confidence_score, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, NULL, $14, NULL, $15, $15)
            RETURNING id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes, raw_row_payload, matched_part_id, match_status, match_confidence_score, instantiated_from_circuit_block_id, instantiated_from_circuit_block_part_id, instantiated_at, created_at, updated_at
          `,
          [
            `bomline-${randomUUID()}`,
            bomImportId,
            projectId,
            revision.id,
            draft.rowNumber,
            draft.designators,
            draft.quantity,
            draft.rawMpn,
            draft.rawManufacturer,
            draft.rawDescription,
            draft.rawSupplierReference,
            draft.rawNotes,
            JSON.stringify(draft.rawRowPayload),
            "unmatched" satisfies BomLineMatchStatus,
            now
          ]
        );
        const lineRow = lineResult.rows[0];

        if (lineRow) {
          savedLines.push(mapBomLineRow(lineRow));
        }
      }

      await client.query("UPDATE project_revisions SET updated_at = $2 WHERE id = $1", [revision.id, now]);
      await client.query("UPDATE projects SET updated_at = $2 WHERE id = $1", [projectId, now]);
      await client.query("COMMIT");

      const bomImportRow = bomImportResult.rows[0];

      if (!bomImportRow) {
        throw new CatalogStoreError("query_failed", "BOM import creation returned no persisted import row.", new Error("missing_bom_import_row"));
      }

      return {
        response: {
          bomImport: mapBomImportRow(bomImportRow),
          lineCount: savedLines.length,
          linesPreview: savedLines.slice(0, 25),
          summary: {
            mappedFieldCount: countMappedBomFields(columnMapping),
            matchStatus: "unmatched",
            persistedLineCount: savedLines.length,
            skippedBlankRowCount: parsedCsv.skippedBlankRowCount
          }
        },
        status: "created"
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof ProjectMemoryInputError || error instanceof BomCsvParseError) {
      return {
        code: error instanceof BomCsvParseError ? error.code : error.code,
        message: error.message,
        status: "invalid"
      };
    }

    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Matches one persisted BOM import against internal catalog rows and creates usage only for confirmed rows.
 */
export async function matchBomImportRowsInDatabase(bomImportId: string): Promise<BomImportMatchResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const client = await databasePool.connect();

    try {
      await client.query("BEGIN");

      const bomImportResult = await client.query<DatabaseBomImportRow>(
        `
          SELECT id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at
          FROM bom_imports
          WHERE id = $1
          LIMIT 1
        `,
        [bomImportId]
      );
      const bomImport = bomImportResult.rows[0];

      if (!bomImport) {
        await client.query("ROLLBACK");
        return { status: "not_found" };
      }

      const sourceLines = await readBomImportLines(client, bomImportId);
      const now = new Date();
      const updatedLines: BomLine[] = [];
      const updatedUsages: ProjectPartUsage[] = [];
      const importCandidates: BomLineImportCandidate[] = [];
      const matchedPartIds = new Set<string>();
      const candidatesByMpn = await prefetchPartMatchCandidatesByMpn(client, sourceLines.map((line) => line.rawMpn));

      // Pass 1: resolve every line's outcome in memory (no DB) so the matched part ids are known
      // before any write, letting the usage snapshot reads batch once per import.
      const lineOutcomes = sourceLines.map((line) => ({
        line,
        outcome: line.matchStatus === "ignored"
          ? ({ matchConfidenceScore: line.matchConfidenceScore, matchedPartId: line.matchedPartId, matchStatus: "ignored" } satisfies BomLineMatchOutcome)
          : resolveBomLineMatch(line, candidatesByMpn)
      }));

      for (const { outcome } of lineOutcomes) {
        if (outcome.matchStatus === "matched" && outcome.matchedPartId) {
          matchedPartIds.add(outcome.matchedPartId);
        }
      }

      const usagePrefetch: MatchUsagePrefetch = {
        approvalRowByPart: await prefetchPartApprovalRows(client, [...matchedPartIds]),
        readinessRowByPart: await prefetchPartReadinessRows(client, [...matchedPartIds]),
        usageIdByBomLine: await prefetchProjectPartUsageIdsByBomLine(client, sourceLines.map((line) => line.id))
      };

      // Pass 2: writes, in the same per-line order as before.
      for (const { line, outcome } of lineOutcomes) {
        const updatedLine = await updateBomLineMatch(client, line, outcome, now);

        updatedLines.push(updatedLine);

        if (outcome.matchStatus === "matched" && outcome.matchedPartId) {
          updatedUsages.push(await upsertProjectPartUsageForMatchedLine(client, updatedLine, outcome.matchedPartId, now, usagePrefetch));
        } else {
          await deleteProjectPartUsageForBomLine(client, line.id);

          const importCandidate = buildLineImportCandidate(updatedLine);

          if (importCandidate) {
            importCandidates.push(importCandidate);
          }
        }
      }

      const summary = buildBomImportMatchSummary(updatedLines, updatedUsages.length, importCandidates.length);
      const nextImportSummary = {
        ...toRecord(bomImport.import_summary),
        matching: {
          ...summary,
          engine: "internal_exact_mpn_manufacturer_v1",
          matchedAt: now.toISOString()
        },
        matchStatus: "processed"
      };
      const updatedBomImportResult = await client.query<DatabaseBomImportRow>(
        `
          UPDATE bom_imports
          SET import_status = 'processed',
            import_summary = $2::jsonb,
            updated_at = $3
          WHERE id = $1
          RETURNING id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at
        `,
        [bomImportId, JSON.stringify(nextImportSummary), now]
      );
      const updatedBomImport = updatedBomImportResult.rows[0];

      if (!updatedBomImport) {
        throw new CatalogStoreError("query_failed", "BOM import matching returned no persisted import row.", new Error("missing_bom_match_row"));
      }

      await client.query("UPDATE project_revisions SET updated_at = $2 WHERE id = $1", [updatedBomImport.project_revision_id, now]);
      await client.query("UPDATE projects SET updated_at = $2 WHERE id = $1", [updatedBomImport.project_id, now]);
      await client.query("COMMIT");

      // Post-commit, best-effort: only committed matches feed passive capture, and a draft failure
      // must never roll back or fail the BOM match the engineer just ran.
      await autoDraftLifecycleRiskFromBomMatch(databasePool, updatedBomImport.project_id, bomImportId, [...matchedPartIds]);

      return {
        response: {
          bomImport: mapBomImportRow(updatedBomImport),
          importCandidates,
          linesPreview: updatedLines.slice(0, 50),
          summary,
          usagesPreview: updatedUsages.slice(0, 50)
        },
        status: "matched"
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads project revisions for one persisted project.
 */
export async function readProjectRevisionsFromDatabase(projectId: string): Promise<ProjectChildReadResult<ProjectRevisionsResponse>> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const revisions = await readProjectRevisions(databasePool, projectId);

    return {
      response: {
        projectId,
        revisions,
        state: revisions.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads persisted BOM import metadata for one project.
 */
export async function readProjectBomImportsFromDatabase(projectId: string): Promise<ProjectChildReadResult<ProjectBomImportsResponse>> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const bomImports = await readProjectBomImports(databasePool, projectId);

    return {
      response: {
        bomImports,
        projectId,
        state: bomImports.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads BOM lines for one persisted BOM import.
 */
export async function readBomImportLinesFromDatabase(bomImportId: string): Promise<BomImportLinesReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await bomImportExists(databasePool, bomImportId))) {
      return { status: "not_found" };
    }

    const lines = await readBomImportLines(databasePool, bomImportId);

    return {
      response: {
        bomImportId,
        lines,
        state: lines.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads confirmed project part usage rows for one project.
 */
export async function readProjectPartUsagesFromDatabase(projectId: string): Promise<ProjectChildReadResult<ProjectPartUsagesResponse>> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const usages = await readProjectPartUsages(databasePool, projectId);

    return {
      response: {
        projectId,
        state: usages.length > 0 ? "available" : "empty",
        usages
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads confirmed where-used history for one internal part id.
 *
 * The response now bundles two distinct engineering-memory signals:
 *   - `usages`: confirmed project-part usage rows (the existing contract).
 *   - `circuitBlockDependencies`: circuit blocks whose persisted part roles link to this part.
 *
 * Both surfaces are *reference context only*. Neither row implies the part is approved,
 * validated, or export-ready; the boundary is preserved at the UI layer with explicit copy
 * and at the contract layer by keeping these rows in distinct collections.
 */
export async function readPartWhereUsedFromDatabase(partId: string): Promise<PartWhereUsedReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await partExists(databasePool, partId))) {
      return { status: "not_found" };
    }

    const [usages, circuitBlockDependencies] = await Promise.all([
      readPartWhereUsed(databasePool, partId),
      readPartCircuitBlockDependencies(databasePool, partId)
    ]);

    return {
      response: {
        circuitBlockDependencies,
        partId,
        state: usages.length > 0 || circuitBlockDependencies.length > 0 ? "available" : "empty",
        usages
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads the day-zero overlap panel data for one project. Returns the top prior projects
 * ranked by shared confirmed-usage parts plus informational counts of connector-class
 * and circuit-block where-used hits in this project's confirmed usage.
 *
 * Honesty rules baked in:
 *  - Overlap is computed against *confirmed* `project_part_usages` only. BOM rows that
 *    were uploaded but never matched do not inflate the overlap.
 *  - Prior projects are returned with the full Project row so the UI can render the
 *    project name without a second fetch; no readiness/approval flags are joined in
 *    because overlap is a reuse signal, not a trust signal.
 *  - `sharedPartCount` is the *actual* overlap (never truncated). `sharedPartIds` is
 *    capped so the UI can render a scannable list, and the caller is expected to phrase
 *    any "and N more" affordance using the (count - displayed) difference.
 *  - Returns `state: "empty"` when this project has no confirmed usage yet so the panel
 *    can render a clear "upload a BOM and match rows first" empty state. Returns
 *    `state: "available"` when the project has confirmed usage even if no prior project
 *    shares anything — that's also an honest signal.
 */
export async function readProjectOverlapPanelFromDatabase(
  projectId: string,
  topProjectsLimit = 5,
  sharedPartIdsPerProjectLimit = 8,
  circuitBlockRolePreviewLimit = 6
): Promise<ProjectOverlapPanelReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const scannedParts = await readDistinctConfirmedPartIdsForProject(databasePool, projectId);

    if (scannedParts.length === 0) {
      return {
        response: {
          circuitBlockRoleHitsPreview: [],
          circuitBlockWhereUsedHitCount: 0,
          connectorWhereUsedHitCount: 0,
          priorEngineeringMemoryWarnings: [],
          priorProjects: [],
          projectId,
          scannedPartCount: 0,
          state: "empty"
        },
        status: "available"
      };
    }

    const [
      priorProjects,
      connectorWhereUsedHitCount,
      circuitBlockWhereUsedHitCount,
      circuitBlockRoleHitsPreview,
      priorEngineeringMemoryWarnings
    ] = await Promise.all([
      readPriorProjectOverlap(databasePool, projectId, scannedParts, topProjectsLimit, sharedPartIdsPerProjectLimit),
      readConnectorWhereUsedHitCount(databasePool, projectId, scannedParts),
      readCircuitBlockWhereUsedHitCount(databasePool, scannedParts),
      readCircuitBlockWhereUsedPreview(databasePool, scannedParts, circuitBlockRolePreviewLimit),
      readPriorEngineeringMemoryWarnings(databasePool, scannedParts, PRIOR_ENGINEERING_MEMORY_WARNING_LIMIT)
    ]);

    return {
      response: {
        circuitBlockRoleHitsPreview,
        circuitBlockWhereUsedHitCount,
        connectorWhereUsedHitCount,
        priorEngineeringMemoryWarnings,
        priorProjects,
        projectId,
        scannedPartCount: scannedParts.length,
        state: priorProjects.length > 0 || connectorWhereUsedHitCount > 0 || circuitBlockWhereUsedHitCount > 0 || priorEngineeringMemoryWarnings.length > 0
          ? "available"
          : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads the distinct set of internal part ids that appear in this project's confirmed
 * usage. Unmatched and ambiguous BOM rows are excluded so the overlap signal stays honest.
 */
async function readDistinctConfirmedPartIdsForProject(
  databasePool: Pool,
  projectId: string
): Promise<string[]> {
  const result = await databasePool.query<{ part_id: string }>(
    `
      SELECT DISTINCT part_id
      FROM project_part_usages
      WHERE project_id = $1
        AND part_id IS NOT NULL
    `,
    [projectId]
  );

  return result.rows.map((row) => row.part_id);
}

/**
 * Reads the top prior projects ranked by shared confirmed-usage parts with the current
 * project. The current project is excluded so the panel never shows the project ranking
 * itself first. `sharedPartIds` is capped per project so the UI list stays scannable.
 */
async function readPriorProjectOverlap(
  databasePool: Pool,
  currentProjectId: string,
  scannedPartIds: string[],
  topProjectsLimit: number,
  sharedPartIdsPerProjectLimit: number
): Promise<ProjectOverlapPriorProject[]> {
  if (scannedPartIds.length === 0) {
    return [];
  }

  const result = await databasePool.query<{
    project_id: string;
    shared_part_count: string;
    shared_part_ids: string[];
  }>(
    `
      SELECT
        ppu.project_id AS project_id,
        COUNT(DISTINCT ppu.part_id)::text AS shared_part_count,
        ARRAY_AGG(DISTINCT ppu.part_id) AS shared_part_ids
      FROM project_part_usages ppu
      WHERE ppu.project_id <> $1
        AND ppu.part_id = ANY ($2::text[])
      GROUP BY ppu.project_id
      ORDER BY COUNT(DISTINCT ppu.part_id) DESC, ppu.project_id ASC
      LIMIT $3
    `,
    [currentProjectId, scannedPartIds, topProjectsLimit]
  );

  if (result.rows.length === 0) {
    return [];
  }

  const projectIds = result.rows.map((row) => row.project_id);
  // Dynamic placeholder IN-list keeps this query compatible with both Postgres and
  // pg-mem (pg-mem's planner currently mis-handles `WHERE pk = ANY ($1::text[])` against
  // primary-key columns and returns zero rows). Since `topProjectsLimit` is small (5 by
  // default), expanding to `IN ($1, $2, ...)` is both safe and inexpensive.
  const placeholders = projectIds.map((_, index) => `$${index + 1}`).join(", ");
  const projectsResult = await databasePool.query<DatabaseProjectRow>(
    `
      SELECT id, project_key, name, description, owner, status, created_at, updated_at
      FROM projects
      WHERE id IN (${placeholders})
    `,
    projectIds
  );
  const projectsById = new Map(projectsResult.rows.map((row) => [row.id, mapProjectRow(row)] as const));

  const candidates = result.rows
    .map((row) => {
      const project = projectsById.get(row.project_id);
      if (!project) {
        return null;
      }
      const sharedPartIds = (row.shared_part_ids ?? []).slice(0, sharedPartIdsPerProjectLimit);
      return {
        project,
        sharedPartCount: Number.parseInt(row.shared_part_count, 10) || 0,
        sharedPartIds
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const usagePreviewsByProjectPart = await readSharedPartUsagePreviews(databasePool, candidates);

  return candidates.map((row) => ({
    project: row.project,
    sharedPartCount: row.sharedPartCount,
    sharedPartIds: row.sharedPartIds,
    sharedPartsPreview: row.sharedPartIds.map((partId) => (
      usagePreviewsByProjectPart.get(makeProjectPartPreviewKey(row.project.id, partId)) ?? {
        designatorsPreview: [],
        mpn: partId,
        partId,
        projectRevisionLabel: null,
        quantityTotal: null,
        usageCount: 0,
        usageStatus: null
      }
    ))
  }));
}

/** Bounds the "this bit us / this is blocked" memory list so the overlap panel stays scannable. */
const PRIOR_ENGINEERING_MEMORY_WARNING_LIMIT = 12;

/**
 * Reads durable "this bit us / this is blocked" engineering memory for the parts this project's
 * BOM confirmed. This is the passive-capture payoff: the past mistake interrupts at import/overlap
 * time instead of waiting for someone to open the part detail. Only confirmed, unresolved records
 * with a `bit_us` outcome or `blocking` severity surface; proposed/dismissed rows never do. This is
 * a reuse warning, never a gate — it does not change approval, validation, or export state.
 */
async function readPriorEngineeringMemoryWarnings(
  databasePool: Pool,
  scannedPartIds: string[],
  limit: number
): Promise<ProjectOverlapMemoryWarning[]> {
  if (scannedPartIds.length === 0) {
    return [];
  }

  // Dynamic placeholder IN-list (not ANY($::text[])) for the same pg-mem PK-planner reason
  // documented in readPriorProjectOverlap.
  const placeholders = scannedPartIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await databasePool.query<{
    part_id: string;
    part_mpn: string;
    record_id: string;
    record_kind: string;
    severity: string;
    outcome: string | null;
    title: string;
    detail: string;
    related_mpn: string | null;
    recorded_by: string | null;
    recorded_at: Date | string;
  }>(
    `
      SELECT per.part_id AS part_id, p.mpn AS part_mpn, per.id AS record_id,
             per.record_kind AS record_kind, per.severity AS severity, per.outcome AS outcome,
             per.title AS title, per.detail AS detail, per.related_mpn AS related_mpn,
             per.recorded_by AS recorded_by, per.recorded_at AS recorded_at
      FROM part_engineering_records per
      JOIN parts p ON p.id = per.part_id
      WHERE per.part_id IN (${placeholders})
        AND per.draft_status = 'confirmed'
        AND per.resolved_at IS NULL
        AND (per.outcome = 'bit_us' OR per.severity = 'blocking')
      ORDER BY CASE WHEN per.severity = 'blocking' THEN 0 ELSE 1 END, per.recorded_at DESC, per.id ASC
      LIMIT $${scannedPartIds.length + 1}
    `,
    [...scannedPartIds, limit]
  );

  return result.rows.map((row) => ({
    detail: row.detail,
    outcome: (row.outcome as PartEngineeringRecordOutcome | null) ?? null,
    partId: row.part_id,
    partMpn: row.part_mpn,
    recordId: row.record_id,
    recordKind: row.record_kind as PartEngineeringRecordKind,
    recordedAt: toIsoTimestamp(row.recorded_at),
    recordedBy: row.recorded_by,
    relatedMpn: row.related_mpn,
    severity: row.severity as PartEngineeringRecordSeverity,
    title: row.title
  }));
}

/**
 * Reads a bounded set of prior-project usage clues for each shared part preview.
 *
 * The overlap table remains count-first, but these usage clues let the UI show engineers
 * which designator/revision/quantity made the overlap meaningful without claiming reuse
 * approval. Aggregation stays in TypeScript so Postgres and pg-mem behave identically.
 */
async function readSharedPartUsagePreviews(
  databasePool: Pool,
  candidates: Array<{ project: Project; sharedPartIds: string[] }>
): Promise<Map<string, ProjectOverlapSharedPartPreview>> {
  const projectIds = [...new Set(candidates.map((row) => row.project.id))];
  const partIds = [...new Set(candidates.flatMap((row) => row.sharedPartIds))];

  if (projectIds.length === 0 || partIds.length === 0) {
    return new Map();
  }

  const projectPlaceholders = projectIds.map((_, index) => `$${index + 1}`).join(", ");
  const partPlaceholders = partIds.map((_, index) => `$${projectIds.length + index + 1}`).join(", ");
  const result = await databasePool.query<{
    project_id: string;
    part_id: string;
    mpn: string | null;
    designators: unknown;
    quantity: string | number | null;
    usage_status: ProjectPartUsage["usageStatus"];
    revision_label: string | null;
  }>(
    `
      SELECT
        ppu.project_id,
        ppu.part_id,
        p.mpn,
        ppu.designators,
        ppu.quantity,
        ppu.usage_status,
        pr.revision_label
      FROM project_part_usages ppu
      LEFT JOIN parts p ON p.id = ppu.part_id
      LEFT JOIN project_revisions pr ON pr.id = ppu.project_revision_id
      WHERE ppu.project_id IN (${projectPlaceholders})
        AND ppu.part_id IN (${partPlaceholders})
      ORDER BY ppu.project_id ASC, ppu.part_id ASC, ppu.updated_at DESC, ppu.id ASC
    `,
    [...projectIds, ...partIds]
  );

  const previewsByKey = new Map<string, ProjectOverlapSharedPartPreview>();
  for (const row of result.rows) {
    const key = makeProjectPartPreviewKey(row.project_id, row.part_id);
    const quantity = toNullableNumber(row.quantity);
    const designators = toStringArray(row.designators);
    const existing = previewsByKey.get(key);

    if (!existing) {
      previewsByKey.set(key, {
        designatorsPreview: designators.slice(0, 4),
        mpn: row.mpn ?? row.part_id,
        partId: row.part_id,
        projectRevisionLabel: row.revision_label,
        quantityTotal: quantity,
        usageCount: 1,
        usageStatus: row.usage_status
      });
      continue;
    }

    existing.usageCount += 1;
    existing.quantityTotal = mergeOptionalQuantityTotals(existing.quantityTotal, quantity);
    for (const designator of designators) {
      if (existing.designatorsPreview.length >= 4) break;
      if (!existing.designatorsPreview.includes(designator)) {
        existing.designatorsPreview.push(designator);
      }
    }
  }

  return previewsByKey;
}

/** Builds the composite key used for per-project, per-part overlap previews. */
function makeProjectPartPreviewKey(projectId: string, partId: string): string {
  return `${projectId}\u0000${partId}`;
}

/** Adds two nullable usage quantities without treating "unknown" as zero. */
function mergeOptionalQuantityTotals(current: number | null, next: number | null): number | null {
  if (current === null) return next;
  if (next === null) return current;
  return current + next;
}

/**
 * Counts how many distinct connector-class catalog parts from this project's confirmed
 * usage have at least one *other* project's confirmed usage (i.e. at least one prior
 * reuse). This is an informational signal: "your BOM uses N connectors someone else has
 * already wired into a confirmed project."
 *
 * Connector-class is determined by `parts.category = 'Connector'` to match the seed
 * data convention; we deliberately do not join the buildable-mating-set tables since
 * absence of mating data is not the same as absence of connector identity.
 */
async function readConnectorWhereUsedHitCount(
  databasePool: Pool,
  currentProjectId: string,
  scannedPartIds: string[]
): Promise<number> {
  if (scannedPartIds.length === 0) {
    return 0;
  }

  // The query avoids two pg-mem compatibility traps:
  //  1) correlated EXISTS subqueries against `parts.id` (pg-mem fails to resolve the
  //     outer alias in some planner paths),
  //  2) `WHERE pk_col = ANY ($::text[])` against the primary-key column (pg-mem's
  //     planner returns zero rows for parameter arrays against PK indexes).
  // Both are avoided by expanding the part-id list into a dynamic `IN ($1, $2, ...)`
  // placeholder list. This is identical to `= ANY` in Postgres' planner.
  const partIdPlaceholders = scannedPartIds.map((_, index) => `$${index + 1}`).join(", ");
  const currentProjectIdPlaceholder = `$${scannedPartIds.length + 1}`;
  const result = await databasePool.query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT p.id)::text AS count
      FROM parts p
      WHERE p.id IN (${partIdPlaceholders})
        AND lower(p.category) LIKE '%connector%'
        AND p.id IN (
          SELECT other_usage.part_id
          FROM project_part_usages other_usage
          WHERE other_usage.project_id <> ${currentProjectIdPlaceholder}
            AND other_usage.part_id IN (${partIdPlaceholders})
        )
    `,
    [...scannedPartIds, currentProjectId]
  );

  return Number.parseInt(result.rows[0]?.count ?? "0", 10) || 0;
}

/**
 * Counts how many distinct circuit-block role rows point at parts confirmed in this
 * project. "This BOM uses parts already proven in N reusable block roles."
 */
async function readCircuitBlockWhereUsedHitCount(
  databasePool: Pool,
  scannedPartIds: string[]
): Promise<number> {
  if (scannedPartIds.length === 0) {
    return 0;
  }

  const partIdPlaceholders = scannedPartIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await databasePool.query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT cbp.id)::text AS count
      FROM circuit_block_parts cbp
      WHERE cbp.part_id IN (${partIdPlaceholders})
    `,
    scannedPartIds
  );

  return Number.parseInt(result.rows[0]?.count ?? "0", 10) || 0;
}

/**
 * Reads a bounded preview of circuit-block role rows that depend on the current
 * project's confirmed parts. This keeps the overlap panel useful at a glance while the
 * count above remains the full, untruncated role count.
 */
async function readCircuitBlockWhereUsedPreview(
  databasePool: Pool,
  scannedPartIds: string[],
  limit: number
): Promise<ProjectOverlapCircuitBlockRolePreview[]> {
  if (scannedPartIds.length === 0 || limit <= 0) {
    return [];
  }

  const partIdPlaceholders = scannedPartIds.map((_, index) => `$${index + 1}`).join(", ");
  const limitPlaceholder = `$${scannedPartIds.length + 1}`;
  const result = await databasePool.query<{
    block_part_id: string;
    circuit_block_id: string;
    block_key: string;
    block_name: string;
    block_status: CircuitBlockStatus;
    part_id: string;
    mpn: string | null;
    role: string;
    quantity: string | number | null;
    is_required: boolean;
    substitution_policy: CircuitBlockPartSubstitutionPolicy;
  }>(
    `
      SELECT
        cbp.id AS block_part_id,
        cbp.circuit_block_id,
        cb.block_key,
        cb.name AS block_name,
        cb.status AS block_status,
        cbp.part_id,
        p.mpn,
        cbp.role,
        cbp.quantity,
        cbp.is_required,
        cbp.substitution_policy
      FROM circuit_block_parts cbp
      JOIN circuit_blocks cb ON cb.id = cbp.circuit_block_id
      LEFT JOIN parts p ON p.id = cbp.part_id
      WHERE cbp.part_id IN (${partIdPlaceholders})
      ORDER BY cb.block_key ASC, cbp.is_required DESC, cbp.role ASC, cbp.id ASC
      LIMIT ${limitPlaceholder}
    `,
    [...scannedPartIds, limit]
  );

  return result.rows.map((row) => ({
    blockKey: row.block_key,
    blockName: row.block_name,
    blockPartId: row.block_part_id,
    blockStatus: row.block_status,
    circuitBlockId: row.circuit_block_id,
    isRequired: row.is_required,
    mpn: row.mpn ?? row.part_id,
    partId: row.part_id,
    quantity: toNullableNumber(row.quantity),
    role: row.role,
    substitutionPolicy: row.substitution_policy
  }));
}

/**
 * Reads circuit blocks that depend on one internal part, grouped per block.
 *
 * Multiple role rows of the same block that point at the inspected part are collapsed into
 * one `PartCircuitBlockDependencyRecord` so the UI can render a per-block row with the
 * full list of roles (eg `Main LDO`, `Reference LDO`) under the same reuse-readiness verdict.
 */
async function readPartCircuitBlockDependencies(
  databasePool: Pool,
  partId: string
): Promise<PartCircuitBlockDependencyRecord[]> {
  const rawDependencies = await readWhereUsedCircuitBlockDependenciesForPartIds(databasePool, [partId]);

  if (rawDependencies.length === 0) {
    return [];
  }

  const groupedRoles = new Map<string, { circuitBlockId: string; blockParts: CircuitBlockPart[] }>();
  for (const dependency of rawDependencies) {
    const existing = groupedRoles.get(dependency.circuitBlock.id);
    if (existing) {
      existing.blockParts.push(dependency.blockPart);
    } else {
      groupedRoles.set(dependency.circuitBlock.id, {
        blockParts: [dependency.blockPart],
        circuitBlockId: dependency.circuitBlock.id
      });
    }
  }

  const records: PartCircuitBlockDependencyRecord[] = [];
  for (const { circuitBlockId, blockParts } of groupedRoles.values()) {
    const summary = await readCircuitBlockSummary(databasePool, circuitBlockId);
    if (!summary) continue;
    records.push({ blockParts, summary });
  }

  records.sort((a, b) => a.summary.circuitBlock.blockKey.localeCompare(b.summary.circuitBlock.blockKey));
  return records;
}

/**
 * Reads global where-used search results across confirmed usage and circuit block dependencies.
 */
export async function readWhereUsedSearchFromDatabase(targetType: WhereUsedTargetType, query: string): Promise<WhereUsedSearchReadResult> {
  const normalizedTargetType = normalizeWhereUsedTargetType(targetType);
  const normalizedQuery = normalizeOptionalText(query) ?? "";
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const unsupportedReason = getUnsupportedWhereUsedReason(normalizedTargetType);

    if (unsupportedReason || normalizedQuery.length === 0) {
      return {
        response: buildWhereUsedSearchResponse({
          assetExports: [],
          circuitBlockDependencies: [],
          documentHits: [],
          matchedCircuitBlocks: [],
          matchedParts: [],
          projectUsages: [],
          query: normalizedQuery,
          supportedTarget: !unsupportedReason,
          targetType: normalizedTargetType,
          unsupportedReason
        }),
        status: "available"
      };
    }

    if (normalizedTargetType === "part") {
      const matchedParts = await readWhereUsedPartMatches(databasePool, normalizedQuery);
      const [projectUsages, circuitBlockDependencies] = await Promise.all([
        readWhereUsedProjectUsagesForParts(databasePool, matchedParts),
        readWhereUsedCircuitBlockDependenciesForPartIds(databasePool, matchedParts.map((part) => part.partId))
      ]);

      return {
        response: buildWhereUsedSearchResponse({
          assetExports: [],
          circuitBlockDependencies,
          documentHits: [],
          matchedCircuitBlocks: [],
          matchedParts,
          projectUsages,
          query: normalizedQuery,
          supportedTarget: true,
          targetType: normalizedTargetType,
          unsupportedReason: null
        }),
        status: "available"
      };
    }

    if (normalizedTargetType === "asset") {
      const matchedParts = await readWhereUsedPartMatches(databasePool, normalizedQuery);
      const [projectUsages, assetExports] = await Promise.all([
        readWhereUsedProjectUsagesForParts(databasePool, matchedParts),
        readWhereUsedAssetExports(databasePool, matchedParts)
      ]);

      return {
        response: buildWhereUsedSearchResponse({
          assetExports,
          circuitBlockDependencies: [],
          documentHits: [],
          matchedCircuitBlocks: [],
          matchedParts,
          projectUsages,
          query: normalizedQuery,
          supportedTarget: true,
          targetType: normalizedTargetType,
          unsupportedReason: null
        }),
        status: "available"
      };
    }

    if (normalizedTargetType === "connector_set") {
      const matchedParts = await readWhereUsedConnectorMatches(databasePool, normalizedQuery);
      const [projectUsages, circuitBlockDependencies] = await Promise.all([
        readWhereUsedProjectUsagesForParts(databasePool, matchedParts),
        readWhereUsedCircuitBlockDependenciesForPartIds(databasePool, matchedParts.map((p) => p.partId))
      ]);

      return {
        response: buildWhereUsedSearchResponse({
          assetExports: [],
          circuitBlockDependencies,
          documentHits: [],
          matchedCircuitBlocks: [],
          matchedParts,
          projectUsages,
          query: normalizedQuery,
          supportedTarget: true,
          targetType: normalizedTargetType,
          unsupportedReason: null
        }),
        status: "available"
      };
    }

    if (normalizedTargetType === "document") {
      const projectSummaries = await readProjectSummaries(databasePool);
      const documentHits = await searchProjectDocumentsForWhereUsed(
        projectSummaries.map((summary) => summary.project),
        normalizedQuery,
        searchProjectDocumentExtractions
      );

      return {
        response: buildWhereUsedSearchResponse({
          assetExports: [],
          circuitBlockDependencies: [],
          documentHits,
          matchedCircuitBlocks: [],
          matchedParts: [],
          projectUsages: [],
          query: normalizedQuery,
          supportedTarget: true,
          targetType: normalizedTargetType,
          unsupportedReason: null
        }),
        status: "available"
      };
    }

    if (normalizedTargetType === "interconnect") {
      const interconnectHits = await searchInterconnectWhereUsed(databasePool, normalizedQuery);

      return {
        response: buildWhereUsedSearchResponse({
          assetExports: [],
          circuitBlockDependencies: [],
          documentHits: [],
          interconnectHits,
          matchedCircuitBlocks: [],
          matchedParts: [],
          projectUsages: [],
          query: normalizedQuery,
          supportedTarget: true,
          targetType: normalizedTargetType,
          unsupportedReason: null
        }),
        status: "available"
      };
    }

    const matchedCircuitBlocks = await readWhereUsedCircuitBlockMatches(databasePool, normalizedQuery);
    const circuitBlockDependencies = await readWhereUsedCircuitBlockDependenciesForBlockIds(databasePool, matchedCircuitBlocks.map((summary) => summary.circuitBlock.id));
    const projectUsages = await readWhereUsedProjectUsagesForDependencies(databasePool, circuitBlockDependencies);

    return {
      response: buildWhereUsedSearchResponse({
        assetExports: [],
        circuitBlockDependencies,
        documentHits: [],
        matchedCircuitBlocks,
        matchedParts: [],
        projectUsages,
        query: normalizedQuery,
        supportedTarget: true,
        targetType: normalizedTargetType,
        unsupportedReason: null
      }),
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads explainable BOM health for one project without persisting opaque scores.
 */
export async function readProjectBomHealthFromDatabase(projectId: string): Promise<ProjectBomHealthReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const [rows, evidenceAttachments, lifecycleReviewCheckpointAt] = await Promise.all([
      readProjectBomHealthRows(databasePool, projectId),
      readProjectEvidenceAttachments(databasePool, projectId),
      readProjectBomHealthReviewCheckpointAt(databasePool, projectId)
    ]);

    return {
      response: buildProjectBomHealthResponse(projectId, rows, evidenceAttachments.length, lifecycleReviewCheckpointAt),
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads evidence metadata attached to one project or its project-memory child records.
 */
export async function readProjectEvidenceAttachmentsFromDatabase(projectId: string): Promise<ProjectEvidenceReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const attachments = await readProjectEvidenceAttachments(databasePool, projectId);

    return {
      response: {
        attachments,
        projectId,
        state: attachments.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads global evidence rows for the evidence vault with honest storage/review filters.
 */
export async function readEvidenceAttachmentsFromDatabase(filters: EvidenceAttachmentListFilters = {}): Promise<EvidenceAttachmentListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const normalizedFilters = normalizeEvidenceAttachmentListFilters(filters);
    const attachments = await readEvidenceAttachments(databasePool, normalizedFilters);

    return {
      response: {
        attachments,
        boundary: "Evidence review is provenance review only; it does not approve parts, validate assets, or unlock export.",
        filters: normalizedFilters,
        state: attachments.length > 0 ? "available" : "empty",
        summary: buildEvidenceAttachmentListSummary(attachments)
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Persists one evidence attachment metadata row without mutating validation, approval, or export state.
 */
export async function createEvidenceAttachmentInDatabase(input: EvidenceAttachmentCreateInput, uploadedBy: string | null): Promise<EvidenceAttachmentCreateResult> {
  const normalized = normalizeEvidenceAttachmentInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const target = await evidenceTargetExists(databasePool, normalized.input.targetType, normalized.input.targetId);

    if (!target.exists) {
      return {
        code: target.code,
        message: target.message,
        status: "not_found"
      };
    }

    const now = new Date();
    const result = await databasePool.query<DatabaseEvidenceAttachmentRow>(
      `
        INSERT INTO evidence_attachments (id, target_type, target_id, evidence_type, title, source_url, storage_key, file_hash, mime_type, notes, provenance, review_status, uploaded_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
        RETURNING id, target_type, target_id, evidence_type, title, source_url, storage_key, file_hash, mime_type, notes, provenance, review_status, uploaded_by, created_at, updated_at
      `,
      [
        `evidence-${randomUUID()}`,
        normalized.input.targetType,
        normalized.input.targetId,
        normalized.input.evidenceType,
        normalized.input.title,
        normalized.input.sourceUrl,
        normalized.input.storageKey,
        normalized.input.fileHash,
        normalized.input.mimeType,
        normalized.input.notes,
        normalized.input.provenance,
        normalized.input.reviewStatus,
        uploadedBy,
        now
      ]
    );
    const row = result.rows[0];

    if (!row) {
      throw new CatalogStoreError("query_failed", "Evidence attachment creation returned no persisted row.", new Error("missing_evidence_create_row"));
    }

    return {
      response: {
        attachment: mapEvidenceAttachmentRow(row),
        boundary: "Evidence preserves decision context only; it does not validate assets, approve parts, or unlock export."
      },
      status: "created"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Updates evidence review metadata without changing the trust state of the target object.
 */
export async function updateEvidenceAttachmentInDatabase(evidenceAttachmentId: string, input: EvidenceAttachmentUpdateInput): Promise<EvidenceAttachmentUpdateResult> {
  const normalized = normalizeEvidenceAttachmentUpdateInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const now = new Date();
    const result = await databasePool.query<DatabaseEvidenceAttachmentRow>(
      `
        UPDATE evidence_attachments
        SET review_status = $2,
          notes = $3,
          updated_at = $4
        WHERE id = $1
        RETURNING id, target_type, target_id, evidence_type, title, source_url, storage_key, file_hash, mime_type, notes, provenance, review_status, uploaded_by, created_at, updated_at
      `,
      [evidenceAttachmentId, normalized.input.reviewStatus, normalized.input.notes, now]
    );
    const row = result.rows[0];

    if (!row) {
      return { status: "not_found" };
    }

    return {
      response: {
        attachment: mapEvidenceAttachmentRow(row),
        boundary: "Evidence review status changed only the evidence row; target approval, validation, and export readiness remain unchanged."
      },
      status: "updated"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads follow-up records for one project, preserving workflow status apart from computed BOM health.
 */
export async function readProjectFollowUpsFromDatabase(projectId: string): Promise<FollowUpListReadResult> {
  return readFollowUpsFromDatabase("project", projectId);
}

/**
 * Reads follow-up records for one circuit block, preserving linked-part readiness as separate truth.
 */
export async function readCircuitBlockFollowUpsFromDatabase(circuitBlockId: string): Promise<FollowUpListReadResult> {
  return readFollowUpsFromDatabase("circuit_block", circuitBlockId);
}

/**
 * Converts current BOM health findings into stable, assignable project follow-up work.
 */
export async function syncProjectFollowUpsFromBomHealthInDatabase(projectId: string): Promise<FollowUpSyncResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const client = await databasePool.connect();

    try {
      if (!(await projectExists(client, projectId))) {
        return { status: "not_found" };
      }

      const [rows, evidenceAttachments, lifecycleReviewCheckpointAt] = await Promise.all([
        readProjectBomHealthRows(client, projectId),
        readProjectEvidenceAttachments(client, projectId),
        readProjectBomHealthReviewCheckpointAt(client, projectId)
      ]);
      const health = buildProjectBomHealthResponse(projectId, rows, evidenceAttachments.length, lifecycleReviewCheckpointAt);
      const seeds = health.findings.map((finding) => buildProjectBomHealthFollowUpSeed(finding));
      const now = new Date();

      await client.query("BEGIN");
      const counts = await upsertFollowUpSeeds(client, seeds, now);
      await client.query("COMMIT");

      const followUps = await readFollowUpRows(client, "project", projectId);

      return {
        response: {
          boundary: "Follow-ups track assignable work only; status changes do not approve parts, validate evidence, or alter export readiness.",
          createdCount: counts.createdCount,
          followUps,
          refreshedCount: counts.refreshedCount,
          targetId: projectId,
          targetType: "project"
        },
        status: "synced"
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Converts required circuit block readiness gaps into stable, assignable follow-up work.
 */
export async function syncCircuitBlockFollowUpsFromReadinessInDatabase(circuitBlockId: string): Promise<FollowUpSyncResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const client = await databasePool.connect();

    try {
      const summary = await readCircuitBlockSummary(client, circuitBlockId);

      if (!summary) {
        return { status: "not_found" };
      }

      const parts = await readCircuitBlockPartRecords(client, circuitBlockId);
      const seeds = parts
        .filter(isCircuitBlockPartReadinessGap)
        .map((record) => buildCircuitBlockGapFollowUpSeed(summary.circuitBlock.id, record));
      const now = new Date();

      await client.query("BEGIN");
      const counts = await upsertFollowUpSeeds(client, seeds, now);
      await client.query("COMMIT");

      const followUps = await readFollowUpRows(client, "circuit_block", circuitBlockId);

      return {
        response: {
          boundary: "Circuit follow-ups track reuse review work only; linked parts keep their own approval, readiness, validation, and export state.",
          createdCount: counts.createdCount,
          followUps,
          refreshedCount: counts.refreshedCount,
          targetId: circuitBlockId,
          targetType: "circuit_block"
        },
        status: "synced"
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Updates one follow-up workflow row without changing the source BOM, part, evidence, or export truth.
 */
export async function updateFollowUpInDatabase(followUpId: string, input: FollowUpUpdateInput): Promise<FollowUpUpdateResult> {
  const normalized = normalizeFollowUpUpdateInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (normalized.input.evidenceAttachmentIds && !(await evidenceAttachmentsExist(databasePool, normalized.input.evidenceAttachmentIds))) {
      return {
        code: "EVIDENCE_ATTACHMENT_NOT_FOUND",
        message: "Every related evidence id must reference an existing evidence attachment.",
        status: "invalid"
      };
    }

    const now = new Date();
    const hasEvidenceAttachmentIds = normalized.input.evidenceAttachmentIds !== undefined;
    const evidenceAttachmentIdsJson = JSON.stringify(normalized.input.evidenceAttachmentIds ?? []);
    const resolvedAt = normalized.input.status === "resolved" || normalized.input.status === "dismissed" ? now : null;
    const result = await databasePool.query<DatabaseFollowUpRecordRow>(
      `
        UPDATE follow_up_records
        SET status = $2,
          assigned_to = $3,
          resolution_notes = $4,
          evidence_attachment_ids = CASE WHEN $5 THEN $6::jsonb ELSE evidence_attachment_ids END,
          resolved_at = $7,
          updated_at = $8
        WHERE id = $1
        RETURNING id, target_type, target_id, source_type, source_finding_id, title, detail, next_action, severity, status, assigned_to, source_inputs, evidence_attachment_ids, resolution_notes, created_at, updated_at, resolved_at
      `,
      [followUpId, normalized.input.status, normalized.input.assignedTo, normalized.input.resolutionNotes, hasEvidenceAttachmentIds, evidenceAttachmentIdsJson, resolvedAt, now]
    );
    const row = result.rows[0];

    if (!row) {
      return { status: "not_found" };
    }

    return {
      response: {
        boundary: "Follow-up status changed only the work queue row; source readiness, approval, evidence review, and export state remain unchanged.",
        followUp: mapFollowUpRecordRow(row)
      },
      status: "updated"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads the reusable circuit block library without converting block state into part readiness.
 *
 * The `filters` parameter narrows the library so the UI never has to hide rows after the
 * fact. q/type/status/owner are applied in SQL; reuseReadiness is applied after summary
 * aggregation because it is derived from the same aggregated readiness counts.
 */
export async function readCircuitBlocksFromDatabase(
  filters: CircuitBlockListFilters = NO_CIRCUIT_BLOCK_LIST_FILTERS
): Promise<CircuitBlockListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const fetched = await readCircuitBlockSummaries(databasePool, {
      blockType: filters.blockType,
      owner: filters.owner,
      query: filters.query,
      status: filters.status
    });

    const circuitBlocks = filters.reuseReadiness
      ? fetched.filter((summary) =>
          matchesCircuitBlockReuseReadinessFilter(
            getCircuitBlockReuseHeadlineVerdict(summary),
            filters.reuseReadiness
          )
        )
      : fetched;

    return {
      response: {
        circuitBlocks,
        filters,
        state: circuitBlocks.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/** NO_CIRCUIT_BLOCK_LIST_FILTERS represents the unfiltered library (all blocks returned). */
const NO_CIRCUIT_BLOCK_LIST_FILTERS: CircuitBlockListFilters = {
  blockType: null,
  owner: null,
  query: null,
  reuseReadiness: null,
  status: null
};

/**
 * Reads one reusable circuit block with linked parts and evidence metadata.
 */
export async function readCircuitBlockDetailFromDatabase(circuitBlockId: string): Promise<CircuitBlockDetailReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const detail = await buildCircuitBlockDetail(databasePool, circuitBlockId);

    if (!detail) {
      return { status: "not_found" };
    }

    return {
      response: detail,
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Creates a structured reusable circuit block without implying its parts are approved or export-ready.
 */
export async function createCircuitBlockInDatabase(input: CircuitBlockCreateInput): Promise<CircuitBlockCreateResult> {
  const normalized = normalizeCircuitBlockCreateInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const now = new Date();
    const result = await databasePool.query<DatabaseCircuitBlockRow>(
      `
        INSERT INTO circuit_blocks (id, block_key, name, description, block_type, owner, status, reuse_scope, constraints, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10)
        RETURNING id, block_key, name, description, block_type, owner, status, reuse_scope, constraints, created_at, updated_at
      `,
      [
        buildCircuitBlockId(normalized.input.blockKey),
        normalized.input.blockKey,
        normalized.input.name,
        normalized.input.description,
        normalized.input.blockType,
        normalized.input.owner,
        normalized.input.status,
        normalized.input.reuseScope,
        JSON.stringify(normalized.input.constraints),
        now
      ]
    );
    const row = result.rows[0];

    if (!row) {
      throw new CatalogStoreError("query_failed", "Circuit block creation returned no persisted row.", new Error("missing_circuit_block_create_row"));
    }

    const detail = await buildCircuitBlockDetail(databasePool, row.id);

    if (!detail) {
      throw new CatalogStoreError("query_failed", "Circuit block detail was missing immediately after creation.", new Error("missing_circuit_block_detail_after_create"));
    }

    return {
      response: {
        boundary: "Circuit block status is reusable knowledge only; linked parts keep their own approval, readiness, and export state.",
        circuitBlock: mapCircuitBlockRow(row),
        detail
      },
      status: "created"
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        message: "A circuit block with that key already exists.",
        status: "conflict"
      };
    }

    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Updates reusable circuit metadata without changing linked part approval, validation, or export readiness.
 */
export async function updateCircuitBlockInDatabase(circuitBlockId: string, input: CircuitBlockUpdateInput): Promise<CircuitBlockUpdateResult> {
  const normalized = normalizeCircuitBlockUpdateInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const now = new Date();
    const result = await databasePool.query<DatabaseCircuitBlockRow>(
      `
        UPDATE circuit_blocks
        SET name = $2,
          description = $3,
          block_type = $4,
          owner = $5,
          status = $6,
          reuse_scope = $7,
          constraints = $8::jsonb,
          updated_at = $9
        WHERE id = $1
        RETURNING id, block_key, name, description, block_type, owner, status, reuse_scope, constraints, created_at, updated_at
      `,
      [
        circuitBlockId,
        normalized.input.name,
        normalized.input.description,
        normalized.input.blockType,
        normalized.input.owner,
        normalized.input.status,
        normalized.input.reuseScope,
        JSON.stringify(normalized.input.constraints),
        now
      ]
    );
    const row = result.rows[0];

    if (!row) {
      return { status: "not_found" };
    }

    const detail = await buildCircuitBlockDetail(databasePool, circuitBlockId);

    if (!detail) {
      throw new CatalogStoreError("query_failed", "Circuit block detail was missing immediately after update.", new Error("missing_circuit_block_detail_after_update"));
    }

    return {
      response: {
        boundary: "Circuit block edits update reusable knowledge only; linked parts keep their own approval, readiness, and export state.",
        circuitBlock: mapCircuitBlockRow(row),
        detail
      },
      status: "updated"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Creates or refreshes one part role inside a reusable circuit block.
 */
export async function createCircuitBlockPartInDatabase(circuitBlockId: string, input: CircuitBlockPartCreateInput): Promise<CircuitBlockPartCreateResult> {
  const normalized = normalizeCircuitBlockPartCreateInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await circuitBlockExists(databasePool, circuitBlockId))) {
      return {
        code: "CIRCUIT_BLOCK_NOT_FOUND",
        message: "Circuit block not found.",
        status: "not_found"
      };
    }

    if (!(await partExists(databasePool, normalized.input.partId))) {
      return {
        code: "PART_NOT_FOUND",
        message: "Part not found.",
        status: "not_found"
      };
    }

    const now = new Date();
    const result = await databasePool.query<DatabaseCircuitBlockPartRow>(
      `
        INSERT INTO circuit_block_parts (id, circuit_block_id, part_id, role, quantity, is_required, substitution_policy, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        ON CONFLICT (circuit_block_id, part_id, role) DO UPDATE
        SET quantity = EXCLUDED.quantity,
          is_required = EXCLUDED.is_required,
          substitution_policy = EXCLUDED.substitution_policy,
          notes = EXCLUDED.notes,
          updated_at = EXCLUDED.updated_at
        RETURNING id, circuit_block_id, part_id, role, quantity, is_required, substitution_policy, notes, created_at, updated_at
      `,
      [
        buildCircuitBlockPartId(circuitBlockId, normalized.input.partId, normalized.input.role),
        circuitBlockId,
        normalized.input.partId,
        normalized.input.role,
        normalized.input.quantity,
        normalized.input.isRequired,
        normalized.input.substitutionPolicy,
        normalized.input.notes,
        now
      ]
    );
    const row = result.rows[0];

    if (!row) {
      throw new CatalogStoreError("query_failed", "Circuit block part creation returned no persisted row.", new Error("missing_circuit_block_part_create_row"));
    }

    await databasePool.query("UPDATE circuit_blocks SET updated_at = $2 WHERE id = $1", [circuitBlockId, now]);

    const detail = await buildCircuitBlockDetail(databasePool, circuitBlockId);

    if (!detail) {
      throw new CatalogStoreError("query_failed", "Circuit block detail was missing immediately after adding a part.", new Error("missing_circuit_block_detail_after_part_create"));
    }

    return {
      response: {
        boundary: "Adding a part role to a circuit block does not approve the part or verify its export assets.",
        circuitBlockPart: mapCircuitBlockPartRow(row),
        detail
      },
      status: "created"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Updates one existing circuit-block role without changing the linked internal part identity.
 */
export async function updateCircuitBlockPartInDatabase(circuitBlockId: string, circuitBlockPartId: string, input: CircuitBlockPartUpdateInput): Promise<CircuitBlockPartUpdateResult> {
  const normalized = normalizeCircuitBlockPartUpdateInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await circuitBlockExists(databasePool, circuitBlockId))) {
      return {
        code: "CIRCUIT_BLOCK_NOT_FOUND",
        message: "Circuit block not found.",
        status: "not_found"
      };
    }

    const now = new Date();
    const result = await databasePool.query<DatabaseCircuitBlockPartRow>(
      `
        UPDATE circuit_block_parts
        SET quantity = $3,
          is_required = $4,
          substitution_policy = $5,
          notes = $6,
          updated_at = $7
        WHERE circuit_block_id = $1 AND id = $2
        RETURNING id, circuit_block_id, part_id, role, quantity, is_required, substitution_policy, notes, created_at, updated_at
      `,
      [
        circuitBlockId,
        circuitBlockPartId,
        normalized.input.quantity,
        normalized.input.isRequired,
        normalized.input.substitutionPolicy,
        normalized.input.notes,
        now
      ]
    );
    const row = result.rows[0];

    if (!row) {
      return {
        code: "CIRCUIT_BLOCK_PART_NOT_FOUND",
        message: "Circuit block part role not found.",
        status: "not_found"
      };
    }

    await databasePool.query("UPDATE circuit_blocks SET updated_at = $2 WHERE id = $1", [circuitBlockId, now]);

    const detail = await buildCircuitBlockDetail(databasePool, circuitBlockId);

    if (!detail) {
      throw new CatalogStoreError("query_failed", "Circuit block detail was missing immediately after editing a part role.", new Error("missing_circuit_block_detail_after_part_update"));
    }

    return {
      response: {
        boundary: "Editing a part role does not approve the part or verify its export assets.",
        circuitBlockPart: mapCircuitBlockPartRow(row),
        detail
      },
      status: "updated"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Records one known-risk observation against a reusable circuit block.
 *
 * Honesty contract:
 *   * The `title` is required and trimmed; an empty title is a 400 (engineering memory must
 *     be discoverable when scanning a list).
 *   * `severity` defaults to `caution` if the caller does not specify one.
 *   * Persisting a known risk does NOT change any linked part's approval, validation, or
 *     export status. It changes only the reusable-stage verdict of this block, and only
 *     when severity is `blocking` AND the risk is unresolved.
 *
 * The response carries both the persisted risk and a freshly-built detail payload so the
 * UI can refresh the strip, counts, and history without a follow-up read.
 */
export async function createCircuitBlockKnownRiskInDatabase(
  circuitBlockId: string,
  input: CircuitBlockKnownRiskCreateInput
): Promise<CircuitBlockKnownRiskCreateResult> {
  const normalized = normalizeCircuitBlockKnownRiskCreateInput(input);

  if (!normalized.ok) {
    return {
      code: normalized.code,
      message: normalized.message,
      status: "invalid"
    };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await circuitBlockExists(databasePool, circuitBlockId))) {
      return {
        code: "CIRCUIT_BLOCK_NOT_FOUND",
        message: "Circuit block not found.",
        status: "not_found"
      };
    }

    const now = new Date();
    const riskId = `cbrisk-${slugify(circuitBlockId)}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await databasePool.query<DatabaseCircuitBlockKnownRiskRow>(
      `
        INSERT INTO circuit_block_known_risks (
          id, circuit_block_id, title, detail, severity, recorded_by, recorded_at, evidence_url, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $7)
        RETURNING id, circuit_block_id, title, detail, severity, recorded_by, recorded_at,
                  resolved_at, resolved_by, resolution_notes, evidence_url, created_at, updated_at
      `,
      [
        riskId,
        circuitBlockId,
        normalized.input.title,
        normalized.input.detail,
        normalized.input.severity,
        normalized.input.recordedBy,
        now,
        normalized.input.evidenceUrl
      ]
    );

    const row = result.rows[0];

    if (!row) {
      throw new CatalogStoreError("query_failed", "Known-risk creation returned no persisted row.", new Error("missing_known_risk_create_row"));
    }

    await databasePool.query("UPDATE circuit_blocks SET updated_at = $2 WHERE id = $1", [circuitBlockId, now]);

    const detail = await buildCircuitBlockDetail(databasePool, circuitBlockId);

    if (!detail) {
      throw new CatalogStoreError(
        "query_failed",
        "Circuit block detail was missing immediately after recording a known risk.",
        new Error("missing_circuit_block_detail_after_known_risk_create")
      );
    }

    return {
      response: {
        boundary: "Recording a known risk preserves engineering memory; it does not approve linked parts, validate assets, or unlock export.",
        detail,
        knownRisk: mapCircuitBlockKnownRiskRow(row)
      },
      status: "created"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Marks one known-risk row as resolved. The row is never deleted; resolution preserves the
 * original observation and adds resolution provenance so audits remain consistent.
 *
 * Resolving a `blocking` risk lifts the reusable-stage block (assuming no other unresolved
 * blocking risks exist). Lower severities do not gate reuse, so resolving them is purely a
 * housekeeping action — but still recorded.
 */
export async function resolveCircuitBlockKnownRiskInDatabase(
  circuitBlockId: string,
  knownRiskId: string,
  input: CircuitBlockKnownRiskResolveInput
): Promise<CircuitBlockKnownRiskResolveResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const resolvedBy = normalizeOptionalText(input.resolvedBy ?? null);
  const resolutionNotes = normalizeOptionalText(input.resolutionNotes ?? null);

  try {
    const now = new Date();
    const result = await databasePool.query<DatabaseCircuitBlockKnownRiskRow>(
      `
        UPDATE circuit_block_known_risks
        SET resolved_at = $3,
            resolved_by = $4,
            resolution_notes = $5,
            updated_at = $3
        WHERE id = $2 AND circuit_block_id = $1 AND resolved_at IS NULL
        RETURNING id, circuit_block_id, title, detail, severity, recorded_by, recorded_at,
                  resolved_at, resolved_by, resolution_notes, evidence_url, created_at, updated_at
      `,
      [circuitBlockId, knownRiskId, now, resolvedBy, resolutionNotes]
    );

    const row = result.rows[0];

    if (!row) {
      return {
        code: "CIRCUIT_BLOCK_KNOWN_RISK_NOT_FOUND",
        message: "Known risk not found or already resolved.",
        status: "not_found"
      };
    }

    await databasePool.query("UPDATE circuit_blocks SET updated_at = $2 WHERE id = $1", [circuitBlockId, now]);

    const detail = await buildCircuitBlockDetail(databasePool, circuitBlockId);

    if (!detail) {
      throw new CatalogStoreError(
        "query_failed",
        "Circuit block detail was missing immediately after resolving a known risk.",
        new Error("missing_circuit_block_detail_after_known_risk_resolve")
      );
    }

    return {
      response: {
        boundary: "Resolving a known risk records that the underlying issue was addressed; it does not approve linked parts, validate assets, or unlock export.",
        detail,
        knownRisk: mapCircuitBlockKnownRiskRow(row)
      },
      status: "resolved"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/** NormalizedCircuitBlockKnownRiskCreateInput is the validated shape applied by the create path. */
type NormalizedCircuitBlockKnownRiskCreateInput = {
  title: string;
  detail: string;
  severity: CircuitBlockKnownRiskSeverity;
  recordedBy: string | null;
  evidenceUrl: string | null;
};

/** Allowed known-risk severities. Kept in sync with the SQL CHECK constraint. */
const ALLOWED_CIRCUIT_BLOCK_KNOWN_RISK_SEVERITIES: ReadonlySet<CircuitBlockKnownRiskSeverity> = new Set<CircuitBlockKnownRiskSeverity>([
  "info",
  "limitation",
  "caution",
  "blocking"
]);

/**
 * Validates and trims a known-risk create payload into a persistence-ready shape.
 *
 * Validation owns three guarantees:
 *   * a non-empty, trimmed `title` (the most-scanned field in the UI),
 *   * a severity matching the SQL CHECK constraint (defaulting to `caution`),
 *   * provenance fields that round-trip as null when blank so the DB does not store " ".
 */
function normalizeCircuitBlockKnownRiskCreateInput(
  input: CircuitBlockKnownRiskCreateInput | null | undefined
): { ok: true; input: NormalizedCircuitBlockKnownRiskCreateInput } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object") {
    return { code: "INVALID_CIRCUIT_BLOCK_KNOWN_RISK", message: "Known risk creation requires a JSON body with at least a title.", ok: false };
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0) {
    return { code: "INVALID_CIRCUIT_BLOCK_KNOWN_RISK_TITLE", message: "Known risk title is required.", ok: false };
  }

  const severityRaw = (input.severity ?? "caution") as CircuitBlockKnownRiskSeverity;
  if (!ALLOWED_CIRCUIT_BLOCK_KNOWN_RISK_SEVERITIES.has(severityRaw)) {
    return {
      code: "INVALID_CIRCUIT_BLOCK_KNOWN_RISK_SEVERITY",
      message: "Severity must be one of info, limitation, caution, or blocking.",
      ok: false
    };
  }

  return {
    input: {
      detail: typeof input.detail === "string" ? input.detail.trim() : "",
      evidenceUrl: normalizeOptionalText(input.evidenceUrl ?? null),
      recordedBy: normalizeOptionalText(input.recordedBy ?? null),
      severity: severityRaw,
      title
    },
    ok: true
  };
}

/** Boundary copy repeated to callers: engineering memory never changes part trust state. */
const PART_ENGINEERING_RECORD_BOUNDARY =
  "Recording or resolving an engineering record preserves private engineering memory; it does not approve the part, validate assets, or unlock export.";

/** Allowed engineering-record kinds. Kept in sync with the SQL CHECK constraint. */
const ALLOWED_PART_ENGINEERING_RECORD_KINDS: ReadonlySet<PartEngineeringRecordKind> = new Set<PartEngineeringRecordKind>([
  "outcome",
  "harness_mate_verified",
  "cad_physical_verified",
  "dependency",
  "decision_blocked",
  "note"
]);

/** Allowed engineering-record severities. Kept in sync with the SQL CHECK constraint. */
const ALLOWED_PART_ENGINEERING_RECORD_SEVERITIES: ReadonlySet<PartEngineeringRecordSeverity> = new Set<PartEngineeringRecordSeverity>([
  "info",
  "limitation",
  "caution",
  "blocking"
]);

/** Allowed engineering-record outcomes. Kept in sync with the SQL CHECK constraint. */
const ALLOWED_PART_ENGINEERING_RECORD_OUTCOMES: ReadonlySet<PartEngineeringRecordOutcome> = new Set<PartEngineeringRecordOutcome>([
  "worked",
  "worked_with_caveats",
  "bit_us",
  "not_verified"
]);

/** Columns returned by every engineering-record query, in a stable order. */
const PART_ENGINEERING_RECORD_RETURNING =
  "id, part_id, record_kind, title, detail, severity, outcome, related_asset_id, datasheet_revision_id, related_mpn, depended_on_by, recorded_by, recorded_at, resolved_at, resolved_by, resolution_notes, evidence_url, draft_status, draft_source, trigger_ref, confirmed_by, confirmed_at, created_at, updated_at";

/** NormalizedPartEngineeringRecordCreateInput is the validated shape applied by the create path. */
interface NormalizedPartEngineeringRecordCreateInput {
  recordKind: PartEngineeringRecordKind;
  title: string;
  detail: string;
  severity: PartEngineeringRecordSeverity;
  outcome: PartEngineeringRecordOutcome | null;
  relatedAssetId: string | null;
  datasheetRevisionId: string | null;
  relatedMpn: string | null;
  dependedOnBy: string | null;
  recordedBy: string | null;
  evidenceUrl: string | null;
}

/**
 * Maps one persisted engineering-record row into the provider-neutral API shape.
 */
function mapPartEngineeringRecordRow(row: DatabasePartEngineeringRecordRow): PartEngineeringRecord {
  return {
    confirmedAt: row.confirmed_at ? toIsoTimestamp(row.confirmed_at) : null,
    confirmedBy: row.confirmed_by,
    createdAt: toIsoTimestamp(row.created_at),
    datasheetRevisionId: row.datasheet_revision_id,
    dependedOnBy: row.depended_on_by,
    detail: row.detail,
    draftSource: row.draft_source as PartEngineeringRecordDraftSource,
    draftStatus: row.draft_status as PartEngineeringRecord["draftStatus"],
    evidenceUrl: row.evidence_url,
    id: row.id,
    outcome: (row.outcome as PartEngineeringRecordOutcome | null) ?? null,
    partId: row.part_id,
    recordKind: row.record_kind as PartEngineeringRecordKind,
    recordedAt: toIsoTimestamp(row.recorded_at),
    recordedBy: row.recorded_by,
    relatedAssetId: row.related_asset_id,
    relatedMpn: row.related_mpn,
    resolutionNotes: row.resolution_notes,
    resolvedAt: row.resolved_at ? toIsoTimestamp(row.resolved_at) : null,
    resolvedBy: row.resolved_by,
    severity: row.severity as PartEngineeringRecordSeverity,
    title: row.title,
    triggerRef: row.trigger_ref,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Validates and trims an engineering-record create payload into a persistence-ready shape.
 */
function normalizePartEngineeringRecordCreateInput(
  input: PartEngineeringRecordCreateInput | null | undefined
): { ok: true; input: NormalizedPartEngineeringRecordCreateInput } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object") {
    return { code: "INVALID_PART_ENGINEERING_RECORD", message: "Engineering record creation requires a JSON body with a kind and title.", ok: false };
  }

  const recordKind = input.recordKind as PartEngineeringRecordKind;
  if (!ALLOWED_PART_ENGINEERING_RECORD_KINDS.has(recordKind)) {
    return {
      code: "INVALID_PART_ENGINEERING_RECORD_KIND",
      message: "Kind must be one of outcome, harness_mate_verified, cad_physical_verified, dependency, decision_blocked, or note.",
      ok: false
    };
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0) {
    return { code: "INVALID_PART_ENGINEERING_RECORD_TITLE", message: "Engineering record title is required.", ok: false };
  }

  const severity = (input.severity ?? "info") as PartEngineeringRecordSeverity;
  if (!ALLOWED_PART_ENGINEERING_RECORD_SEVERITIES.has(severity)) {
    return {
      code: "INVALID_PART_ENGINEERING_RECORD_SEVERITY",
      message: "Severity must be one of info, limitation, caution, or blocking.",
      ok: false
    };
  }

  const outcomeRaw = input.outcome ?? null;
  if (outcomeRaw !== null && !ALLOWED_PART_ENGINEERING_RECORD_OUTCOMES.has(outcomeRaw)) {
    return {
      code: "INVALID_PART_ENGINEERING_RECORD_OUTCOME",
      message: "Outcome must be one of worked, worked_with_caveats, bit_us, or not_verified.",
      ok: false
    };
  }

  return {
    input: {
      datasheetRevisionId: normalizeOptionalText(input.datasheetRevisionId ?? null),
      dependedOnBy: normalizeOptionalText(input.dependedOnBy ?? null),
      detail: typeof input.detail === "string" ? input.detail.trim() : "",
      evidenceUrl: normalizeOptionalText(input.evidenceUrl ?? null),
      outcome: outcomeRaw,
      recordKind,
      recordedBy: normalizeOptionalText(input.recordedBy ?? null),
      relatedAssetId: normalizeOptionalText(input.relatedAssetId ?? null),
      relatedMpn: normalizeOptionalText(input.relatedMpn ?? null),
      severity,
      title
    },
    ok: true
  };
}

/**
 * Reads all engineering-memory rows for one part, split into still-open and resolved (history).
 */
async function buildPartEngineeringRecordList(databasePool: Pool, partId: string): Promise<PartEngineeringRecordListResponse> {
  const result = await databasePool.query<DatabasePartEngineeringRecordRow>(
    `
      SELECT ${PART_ENGINEERING_RECORD_RETURNING}
      FROM part_engineering_records
      WHERE part_id = $1
      ORDER BY recorded_at DESC, id ASC
    `,
    [partId]
  );
  const records = result.rows.map(mapPartEngineeringRecordRow);

  return {
    boundary: PART_ENGINEERING_RECORD_BOUNDARY,
    open: records.filter((record) => record.draftStatus === "confirmed" && record.resolvedAt === null),
    partId,
    proposed: records.filter((record) => record.draftStatus === "proposed"),
    resolved: records.filter((record) => record.draftStatus === "dismissed" || record.resolvedAt !== null)
  };
}

/**
 * Reads the full engineering-memory history for one part.
 */
export async function readPartEngineeringRecordsForPartFromDatabase(partId: string): Promise<PartEngineeringRecordListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const partCheck = await databasePool.query<{ id: string }>("SELECT id FROM parts WHERE id = $1", [partId]);
    if (partCheck.rowCount === 0) {
      return { status: "not_found" };
    }

    return { response: await buildPartEngineeringRecordList(databasePool, partId), status: "available" };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Records one piece of private engineering memory against a part.
 *
 * Honesty contract: persisting a record never changes the part's approval, validation, review,
 * or export state. It is durable institutional knowledge, not a trust decision.
 */
export async function createPartEngineeringRecordInDatabase(
  partId: string,
  input: PartEngineeringRecordCreateInput
): Promise<PartEngineeringRecordCreateResult> {
  const normalized = normalizePartEngineeringRecordCreateInput(input);

  if (!normalized.ok) {
    return { code: normalized.code, message: normalized.message, status: "invalid" };
  }

  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const partCheck = await databasePool.query<{ id: string }>("SELECT id FROM parts WHERE id = $1", [partId]);
    if (partCheck.rowCount === 0) {
      return { code: "PART_NOT_FOUND", message: "Part not found.", status: "not_found" };
    }

    const now = new Date();
    const recordId = `perec-${slugify(partId)}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await databasePool.query<DatabasePartEngineeringRecordRow>(
      `
        INSERT INTO part_engineering_records (
          id, part_id, record_kind, title, detail, severity, outcome,
          related_asset_id, datasheet_revision_id, related_mpn, depended_on_by,
          recorded_by, recorded_at, evidence_url, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $13, $13)
        RETURNING ${PART_ENGINEERING_RECORD_RETURNING}
      `,
      [
        recordId,
        partId,
        normalized.input.recordKind,
        normalized.input.title,
        normalized.input.detail,
        normalized.input.severity,
        normalized.input.outcome,
        normalized.input.relatedAssetId,
        normalized.input.datasheetRevisionId,
        normalized.input.relatedMpn,
        normalized.input.dependedOnBy,
        normalized.input.recordedBy,
        now,
        normalized.input.evidenceUrl
      ]
    );

    const row = result.rows[0];

    if (!row) {
      throw new CatalogStoreError("query_failed", "Engineering record creation returned no persisted row.", new Error("missing_part_engineering_record_create_row"));
    }

    return {
      response: {
        boundary: PART_ENGINEERING_RECORD_BOUNDARY,
        list: await buildPartEngineeringRecordList(databasePool, partId),
        record: mapPartEngineeringRecordRow(row)
      },
      status: "created"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Marks one engineering-memory row as resolved. The row is never deleted; resolution preserves
 * the original observation and adds resolution provenance so audits stay consistent.
 */
export async function resolvePartEngineeringRecordInDatabase(
  partId: string,
  recordId: string,
  input: PartEngineeringRecordResolveInput
): Promise<PartEngineeringRecordResolveResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const resolvedBy = normalizeOptionalText(input.resolvedBy ?? null);
  const resolutionNotes = normalizeOptionalText(input.resolutionNotes ?? null);

  try {
    const now = new Date();
    const result = await databasePool.query<DatabasePartEngineeringRecordRow>(
      `
        UPDATE part_engineering_records
        SET resolved_at = $3, resolved_by = $4, resolution_notes = $5, updated_at = $3
        WHERE id = $2 AND part_id = $1 AND resolved_at IS NULL
        RETURNING ${PART_ENGINEERING_RECORD_RETURNING}
      `,
      [partId, recordId, now, resolvedBy, resolutionNotes]
    );

    const row = result.rows[0];

    if (!row) {
      return {
        code: "PART_ENGINEERING_RECORD_NOT_FOUND",
        message: "Engineering record not found or already resolved.",
        status: "not_found"
      };
    }

    return {
      response: {
        boundary: PART_ENGINEERING_RECORD_BOUNDARY,
        list: await buildPartEngineeringRecordList(databasePool, partId),
        record: mapPartEngineeringRecordRow(row)
      },
      status: "resolved"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/** AutoDraftPartEngineeringRecordParams is the provider-neutral input for one passive-capture draft. */
interface AutoDraftPartEngineeringRecordParams {
  partId: string;
  draftSource: Exclude<PartEngineeringRecordDraftSource, "manual">;
  /** Stable per-trigger key (substitution id, or `${bundleId}:${assetId}`) — drives idempotent dedup. */
  dedupeKey: string;
  /** Originating substitution/bundle id stored for correlation. */
  triggerRef: string;
  recordKind: PartEngineeringRecordKind;
  title: string;
  detail: string;
  severity?: PartEngineeringRecordSeverity;
  outcome?: PartEngineeringRecordOutcome | null;
  relatedAssetId?: string | null;
  datasheetRevisionId?: string | null;
  relatedMpn?: string | null;
  recordedBy?: string | null;
}

/**
 * Best-effort passive capture: drafts one PROPOSED engineering-memory row from an action an
 * engineer already performed. This is the heart of the "memory writes itself" bet — manual entry
 * is the fallback, not the path.
 *
 * Contract:
 *   * The row enters `draft_status = 'proposed'`; it is a suggestion, never durable memory, and
 *     never counts toward any gate until a human confirms it.
 *   * Idempotent: the id is derived deterministically from (source, dedupeKey, part) with
 *     `ON CONFLICT (id) DO NOTHING`, so re-approving a substitution or re-exporting a bundle does
 *     not flood the part with duplicates.
 *   * Never throws: drafting must not fail or slow the triggering action. Any failure is logged
 *     and swallowed — a substitution/export still succeeds even if drafting breaks.
 */
async function autoDraftPartEngineeringRecord(databasePool: Pool, params: AutoDraftPartEngineeringRecordParams): Promise<void> {
  try {
    const recordId = `perec-auto-${slugify(params.draftSource)}-${slugify(params.dedupeKey)}`.slice(0, 200);
    const now = new Date();

    await databasePool.query(
      `
        INSERT INTO part_engineering_records (
          id, part_id, record_kind, title, detail, severity, outcome,
          related_asset_id, datasheet_revision_id, related_mpn, depended_on_by,
          recorded_by, recorded_at, evidence_url,
          draft_status, draft_source, trigger_ref,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, NULL, 'proposed', $13, $14, $12, $12)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        recordId,
        params.partId,
        params.recordKind,
        params.title,
        params.detail,
        params.severity ?? "info",
        params.outcome ?? null,
        params.relatedAssetId ?? null,
        params.datasheetRevisionId ?? null,
        params.relatedMpn ?? null,
        params.recordedBy ?? null,
        now,
        params.draftSource,
        params.triggerRef
      ]
    );
  } catch (error) {
    // Passive capture is best-effort: never let a draft failure surface to the triggering action.
    console.error(
      JSON.stringify({
        draftSource: params.draftSource,
        message: "Passive-capture engineering-memory draft failed and was skipped.",
        partId: params.partId,
        reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        triggerRef: params.triggerRef
      })
    );
  }
}

/**
 * Narrow passive capture at BOM match time: when a BOM row matches a part that is (a) no longer
 * active in its lifecycle AND (b) already used in a prior project, that is the "we are about to
 * repeat a part we already know is fading" signal. Draft one PROPOSED record so it surfaces for
 * review instead of silently riding into another build.
 *
 * Deliberately narrow to avoid noise: a part that is active, or never used before, produces
 * nothing. Idempotent per (bom import, part) so re-running matching does not duplicate. Best
 * effort and post-commit — it never blocks or fails BOM matching.
 */
async function autoDraftLifecycleRiskFromBomMatch(
  databasePool: Pool,
  projectId: string,
  bomImportId: string,
  matchedPartIds: string[]
): Promise<void> {
  if (matchedPartIds.length === 0) {
    return;
  }

  try {
    // $1 is projectId; matched part ids start at $2. Dynamic IN-list for pg-mem PK-planner parity.
    const placeholders = matchedPartIds.map((_, index) => `$${index + 2}`).join(", ");
    const result = await databasePool.query<{ part_id: string; mpn: string; lifecycle_status: string }>(
      `
        SELECT DISTINCT p.id AS part_id, p.mpn AS mpn, p.lifecycle_status AS lifecycle_status
        FROM parts p
        WHERE p.id IN (${placeholders})
          AND p.lifecycle_status <> 'active'
          AND p.id IN (
            SELECT ppu.part_id FROM project_part_usages ppu WHERE ppu.project_id <> $1
          )
      `,
      [projectId, ...matchedPartIds]
    );

    for (const row of result.rows) {
      await autoDraftPartEngineeringRecord(databasePool, {
        dedupeKey: `${bomImportId}:${row.part_id}`,
        detail: `This part is reused from a prior project but is no longer active (lifecycle: ${row.lifecycle_status}). Confirm only if this is a known, accepted risk you intend to repeat.`,
        draftSource: "auto_bom_lifecycle",
        partId: row.part_id,
        recordKind: "decision_blocked",
        recordedBy: null,
        severity: "caution",
        title: `Reused part ${row.mpn} is ${row.lifecycle_status}, not active`,
        triggerRef: bomImportId
      });
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        bomImportId,
        message: "Passive-capture lifecycle-risk draft scan failed and was skipped.",
        reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      })
    );
  }
}

/**
 * Confirms (accepts into durable memory) or dismisses (rejects, preserved for audit) one PROPOSED
 * auto-draft. Only `proposed` rows are decidable; confirming a manual or already-decided row is a
 * no-op not_found. Neither decision changes part approval, validation, review, or export state.
 */
export async function decidePartEngineeringRecordDraftInDatabase(
  partId: string,
  recordId: string,
  decision: "confirm" | "dismiss",
  actor: string,
  input: PartEngineeringRecordDraftDecisionInput
): Promise<PartEngineeringRecordDraftDecisionResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const notes = normalizeOptionalText(input.notes ?? null);

  try {
    const now = new Date();
    const result = decision === "confirm"
      ? await databasePool.query<DatabasePartEngineeringRecordRow>(
          `
            UPDATE part_engineering_records
            SET draft_status = 'confirmed', confirmed_by = $3, confirmed_at = $4, updated_at = $4
            WHERE id = $2 AND part_id = $1 AND draft_status = 'proposed'
            RETURNING ${PART_ENGINEERING_RECORD_RETURNING}
          `,
          [partId, recordId, actor, now]
        )
      : await databasePool.query<DatabasePartEngineeringRecordRow>(
          `
            UPDATE part_engineering_records
            SET draft_status = 'dismissed', resolved_at = $4, resolved_by = $3, resolution_notes = $5, updated_at = $4
            WHERE id = $2 AND part_id = $1 AND draft_status = 'proposed'
            RETURNING ${PART_ENGINEERING_RECORD_RETURNING}
          `,
          [partId, recordId, actor, now, notes]
        );

    const row = result.rows[0];

    if (!row) {
      return {
        code: "PART_ENGINEERING_RECORD_DRAFT_NOT_FOUND",
        message: "Proposed engineering-memory draft not found, or it was already confirmed or dismissed.",
        status: "not_found"
      };
    }

    return {
      response: {
        boundary: PART_ENGINEERING_RECORD_BOUNDARY,
        list: await buildPartEngineeringRecordList(databasePool, partId),
        record: mapPartEngineeringRecordRow(row)
      },
      status: "decided"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads compact project summaries in stable workbench order.
 */
async function readProjectSummaries(databasePool: Pool): Promise<ProjectSummary[]> {
  const result = await databasePool.query<DatabaseProjectSummaryRow>(`${PROJECT_SUMMARIES_SQL}\nORDER BY p.updated_at DESC, p.project_key ASC, p.id ASC`);

  return result.rows.map(mapProjectSummaryRow);
}

/**
 * Reads one compact project summary by project id.
 */
async function readProjectSummary(databasePool: Pool, projectId: string): Promise<ProjectSummary | null> {
  const result = await databasePool.query<DatabaseProjectSummaryRow>(`${PROJECT_SUMMARIES_SQL}\nWHERE p.id = $1`, [projectId]);

  return result.rows[0] ? mapProjectSummaryRow(result.rows[0]) : null;
}

/**
 * Reads persisted revisions for one project id.
 */
async function readProjectRevisions(databasePool: Pool, projectId: string): Promise<ProjectRevision[]> {
  const result = await databasePool.query<DatabaseProjectRevisionRow>(
    `
      SELECT id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
      FROM project_revisions
      WHERE project_id = $1
      ORDER BY created_at DESC, revision_label ASC, id ASC
    `,
    [projectId]
  );

  return result.rows.map(mapProjectRevisionRow);
}

/**
 * Reads persisted BOM import records for one project id.
 */
async function readProjectBomImports(databasePool: Pool, projectId: string): Promise<BomImport[]> {
  const result = await databasePool.query<DatabaseBomImportRow>(
    `
      SELECT id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at
      FROM bom_imports
      WHERE project_id = $1
      ORDER BY created_at DESC, id ASC
    `,
    [projectId]
  );

  return result.rows.map(mapBomImportRow);
}

/**
 * Reads persisted BOM lines for one BOM import id.
 */
async function readBomImportLines(databasePool: Pool | PoolClient, bomImportId: string): Promise<BomLine[]> {
  const result = await databasePool.query<DatabaseBomLineRow>(
    `
      SELECT id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes, raw_row_payload, matched_part_id, match_status, match_confidence_score, instantiated_from_circuit_block_id, instantiated_from_circuit_block_part_id, instantiated_at, created_at, updated_at
      FROM bom_lines
      WHERE bom_import_id = $1
      ORDER BY row_number ASC, id ASC
    `,
    [bomImportId]
  );

  return result.rows.map(mapBomLineRow);
}

/**
 * Reads confirmed project usage records for one project id.
 */
async function readProjectPartUsages(databasePool: Pool, projectId: string): Promise<ProjectPartUsage[]> {
  const result = await databasePool.query<DatabaseProjectPartUsageRow>(
    `
      SELECT
        u.id,
        u.project_id,
        u.project_revision_id,
        u.bom_line_id,
        u.part_id,
        p.mpn AS part_mpn,
        m.name AS manufacturer_name,
        u.usage_context,
        u.designators,
        u.quantity,
        u.usage_status,
        u.approval_snapshot,
        u.readiness_snapshot,
        u.created_at,
        u.updated_at
      FROM project_part_usages u
      JOIN parts p ON p.id = u.part_id
      JOIN manufacturers m ON m.id = p.manufacturer_id
      WHERE project_id = $1
      ORDER BY u.updated_at DESC, u.id ASC
    `,
    [projectId]
  );

  return result.rows.map(mapProjectPartUsageRow);
}

/**
 * Reads confirmed project usage rows for one part with enough context to answer where-used.
 */
async function readPartWhereUsed(databasePool: Pool, partId: string): Promise<PartWhereUsedRecord[]> {
  const result = await databasePool.query<DatabasePartWhereUsedRow>(
    `
      SELECT
        u.id AS usage_id,
        u.project_id AS usage_project_id,
        u.project_revision_id AS usage_project_revision_id,
        u.bom_line_id AS usage_bom_line_id,
        u.part_id AS usage_part_id,
        u.usage_context AS usage_context,
        u.designators AS usage_designators,
        u.quantity AS usage_quantity,
        u.usage_status AS usage_status,
        u.approval_snapshot AS usage_approval_snapshot,
        u.readiness_snapshot AS usage_readiness_snapshot,
        u.created_at AS usage_created_at,
        u.updated_at AS usage_updated_at,
        p.id AS project_id,
        p.project_key AS project_key,
        p.name AS project_name,
        p.description AS project_description,
        p.owner AS project_owner,
        p.status AS project_status,
        p.created_at AS project_created_at,
        p.updated_at AS project_updated_at,
        r.id AS revision_id,
        r.project_id AS revision_project_id,
        r.revision_label AS revision_label,
        r.revision_status AS revision_status,
        r.source_reference AS revision_source_reference,
        r.released_at AS revision_released_at,
        r.created_at AS revision_created_at,
        r.updated_at AS revision_updated_at,
        bl.id AS line_id,
        bl.bom_import_id AS line_bom_import_id,
        bl.project_id AS line_project_id,
        bl.project_revision_id AS line_project_revision_id,
        bl.row_number AS line_row_number,
        bl.designators AS line_designators,
        bl.quantity AS line_quantity,
        bl.raw_mpn AS line_raw_mpn,
        bl.raw_manufacturer AS line_raw_manufacturer,
        bl.raw_description AS line_raw_description,
        bl.raw_supplier_reference AS line_raw_supplier_reference,
        bl.raw_notes AS line_raw_notes,
        bl.raw_row_payload AS line_raw_row_payload,
        bl.matched_part_id AS line_matched_part_id,
        bl.match_status AS line_match_status,
        bl.match_confidence_score AS line_match_confidence_score,
        bl.created_at AS line_created_at,
        bl.updated_at AS line_updated_at
      FROM project_part_usages u
      JOIN projects p ON p.id = u.project_id
      JOIN project_revisions r ON r.id = u.project_revision_id
      LEFT JOIN bom_lines bl ON bl.id = u.bom_line_id
      WHERE u.part_id = $1
      ORDER BY p.project_key ASC, r.created_at DESC, u.updated_at DESC, u.id ASC
    `,
    [partId]
  );

  return result.rows.map(mapPartWhereUsedRow);
}

/**
 * Finds internal parts by id or MPN for the global where-used workspace.
 */
async function readWhereUsedPartMatches(databasePool: Pool, query: string): Promise<CircuitBlockPartCatalogSummary[]> {
  const result = await databasePool.query<DatabaseWhereUsedPartSummaryRow>(
    `
      SELECT
        p.id AS part_id,
        p.mpn,
        m.name AS manufacturer_name,
        p.lifecycle_status,
        pa.approval_status,
        prs.readiness_status,
        prs.connector_class,
        prs.blocker_count
      FROM parts p
      JOIN manufacturers m ON m.id = p.manufacturer_id
      LEFT JOIN part_approvals pa ON pa.part_id = p.id
      LEFT JOIN part_readiness_summaries prs ON prs.part_id = p.id
      WHERE lower(p.id) = lower($1)
        OR lower(p.mpn) = lower($1)
        OR lower(p.mpn) LIKE '%' || lower($1) || '%'
      ORDER BY
        CASE
          WHEN lower(p.id) = lower($1) THEN 0
          WHEN lower(p.mpn) = lower($1) THEN 1
          ELSE 2
        END,
        m.name ASC,
        p.mpn ASC,
        p.id ASC
      LIMIT 12
    `,
    [query]
  );

  return result.rows.map(mapWhereUsedPartSummaryRow);
}

/**
 * Finds circuit blocks by id, key, or name for the global where-used workspace.
 */
async function readWhereUsedCircuitBlockMatches(databasePool: Pool, query: string): Promise<CircuitBlockSummary[]> {
  const result = await databasePool.query<DatabaseCircuitBlockSummaryRow>(
    `
      ${CIRCUIT_BLOCK_SUMMARIES_SQL}
      WHERE lower(cb.id) = lower($1)
        OR lower(cb.block_key) = lower($1)
        OR lower(cb.block_key) LIKE '%' || lower($1) || '%'
        OR lower(cb.name) LIKE '%' || lower($1) || '%'
      ORDER BY
        CASE
          WHEN lower(cb.id) = lower($1) THEN 0
          WHEN lower(cb.block_key) = lower($1) THEN 1
          ELSE 2
        END,
        cb.block_key ASC,
        cb.id ASC
      LIMIT 12
    `,
    [query]
  );

  return result.rows.map(mapCircuitBlockSummaryRow);
}

/**
 * Reads circuit block dependencies for matched part ids.
 */
async function readWhereUsedCircuitBlockDependenciesForPartIds(databasePool: Pool, partIds: string[]): Promise<WhereUsedCircuitBlockDependencyRecord[]> {
  if (partIds.length === 0) {
    return [];
  }

  const result = await databasePool.query<DatabaseWhereUsedCircuitBlockDependencyRow>(
    `
      ${WHERE_USED_CIRCUIT_BLOCK_DEPENDENCIES_SQL}
      WHERE cbp.part_id = ANY($1::text[])
      ORDER BY cb.block_key ASC, cbp.is_required DESC, cbp.role ASC, p.mpn ASC, cbp.id ASC
    `,
    [partIds]
  );

  return result.rows.map(mapWhereUsedCircuitBlockDependencyRow);
}

/**
 * Reads circuit block dependencies for matched circuit block ids.
 */
async function readWhereUsedCircuitBlockDependenciesForBlockIds(databasePool: Pool, circuitBlockIds: string[]): Promise<WhereUsedCircuitBlockDependencyRecord[]> {
  if (circuitBlockIds.length === 0) {
    return [];
  }

  const result = await databasePool.query<DatabaseWhereUsedCircuitBlockDependencyRow>(
    `
      ${WHERE_USED_CIRCUIT_BLOCK_DEPENDENCIES_SQL}
      WHERE cbp.circuit_block_id = ANY($1::text[])
      ORDER BY cb.block_key ASC, cbp.is_required DESC, cbp.role ASC, p.mpn ASC, cbp.id ASC
    `,
    [circuitBlockIds]
  );

  return result.rows.map(mapWhereUsedCircuitBlockDependencyRow);
}

/**
 * Expands matched parts into project usage rows for the global where-used workspace.
 */
async function readWhereUsedProjectUsagesForParts(databasePool: Pool, parts: CircuitBlockPartCatalogSummary[]): Promise<WhereUsedProjectUsageRecord[]> {
  const rows = await Promise.all(
    parts.map(async (part) => {
      const usages = await readPartWhereUsed(databasePool, part.partId);

      return usages.map((record) => mapWhereUsedProjectUsageRecord(record, part, null));
    })
  );

  return sortWhereUsedProjectUsages(rows.flat());
}

/**
 * Expands circuit block dependencies into project usage rows while preserving each block role.
 */
async function readWhereUsedProjectUsagesForDependencies(databasePool: Pool, dependencies: WhereUsedCircuitBlockDependencyRecord[]): Promise<WhereUsedProjectUsageRecord[]> {
  const rows = await Promise.all(
    dependencies.map(async (dependency) => {
      const usages = await readPartWhereUsed(databasePool, dependency.part.partId);

      return usages.map((record) => mapWhereUsedProjectUsageRecord(record, dependency.part, dependency));
    })
  );

  return sortWhereUsedProjectUsages(rows.flat());
}

/**
 * Builds the global where-used response and its honest trust boundary copy.
 */
function buildWhereUsedSearchResponse(input: {
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
  interconnectHits?: WhereUsedInterconnectHitRecord[];
}): WhereUsedSearchResponse {
  const interconnectHits = input.interconnectHits ?? [];
  const hasResults =
    input.matchedParts.length > 0 ||
    input.matchedCircuitBlocks.length > 0 ||
    input.projectUsages.length > 0 ||
    input.circuitBlockDependencies.length > 0 ||
    input.assetExports.length > 0 ||
    input.documentHits.length > 0 ||
    interconnectHits.length > 0;

  return {
    assetExports: input.assetExports,
    boundary: "Where-used results are historical dependency and usage context only; they do not approve reuse, validate evidence, or unlock export.",
    circuitBlockDependencies: input.circuitBlockDependencies,
    documentHits: input.documentHits,
    interconnectHits,
    matchedCircuitBlocks: input.matchedCircuitBlocks,
    matchedParts: input.matchedParts,
    projectUsages: input.projectUsages,
    query: input.query,
    state: hasResults ? "available" : "empty",
    supportedTarget: input.supportedTarget,
    targetType: input.targetType,
    unsupportedReason: input.unsupportedReason
  };
}

/**
 * Reads the latest BOM health review checkpoint: resolved follow-ups or accepted evidence on computed risk findings.
 */
async function readProjectBomHealthReviewCheckpointAt(databasePool: Pool | PoolClient, projectId: string): Promise<Date | null> {
  const riskFindingPattern = `${projectId}:bom-health:%`;
  const [followUpResult, evidenceResult] = await Promise.all([
    databasePool.query<{ max: Date | string | null }>(
      `
        SELECT MAX(resolved_at) AS max
        FROM follow_up_records
        WHERE target_type = 'project'
          AND target_id = $1
          AND source_type = 'bom_health'
          AND status IN ('resolved', 'dismissed')
          AND resolved_at IS NOT NULL
      `,
      [projectId]
    ),
    databasePool.query<{ max: Date | string | null }>(
      `
        SELECT MAX(ea.updated_at) AS max
        FROM evidence_attachments ea
        WHERE ea.target_type = 'risk_finding'
          AND ea.target_id LIKE $1
          AND ea.review_status = 'accepted'
      `,
      [riskFindingPattern]
    )
  ]);

  const candidates: Date[] = [];
  const followUpMax = followUpResult.rows[0]?.max;
  const evidenceMax = evidenceResult.rows[0]?.max;

  if (followUpMax) {
    candidates.push(followUpMax instanceof Date ? followUpMax : new Date(followUpMax));
  }
  if (evidenceMax) {
    candidates.push(evidenceMax instanceof Date ? evidenceMax : new Date(evidenceMax));
  }

  if (candidates.length === 0) {
    return null;
  }

  return new Date(Math.max(...candidates.map((value) => value.getTime())));
}

/**
 * Reads BOM lines with matched-part readiness, CAD, lifecycle, and evidence inputs for health projection.
 */
async function readProjectBomHealthRows(databasePool: Pool | PoolClient, projectId: string): Promise<DatabaseProjectBomHealthRow[]> {
  const result = await databasePool.query<DatabaseProjectBomHealthRow>(
    `
      SELECT
        bl.id,
        bl.bom_import_id,
        bl.project_id,
        bl.project_revision_id,
        bl.row_number,
        bl.designators,
        bl.quantity,
        bl.raw_mpn,
        bl.raw_manufacturer,
        bl.raw_description,
        bl.raw_supplier_reference,
        bl.raw_notes,
        bl.raw_row_payload,
        bl.matched_part_id,
        bl.match_status,
        bl.match_confidence_score,
        bl.created_at,
        bl.updated_at,
        p.lifecycle_status,
        p.last_updated_at AS matched_part_last_updated_at,
        pa.approval_status,
        prs.readiness_status,
        prs.connector_class,
        prs.blocker_count,
        COALESCE(cad_counts.verified_cad_count, 0)::text AS verified_cad_count,
        COALESCE(cad_counts.file_backed_cad_count, 0)::text AS file_backed_cad_count,
        COALESCE(cad_counts.referenced_cad_count, 0)::text AS referenced_cad_count,
        COALESCE(evidence_counts.evidence_count, 0)::text AS evidence_count
      FROM bom_lines bl
      LEFT JOIN parts p ON p.id = bl.matched_part_id
      LEFT JOIN part_approvals pa ON pa.part_id = p.id
      LEFT JOIN part_readiness_summaries prs ON prs.part_id = p.id
      LEFT JOIN (
        SELECT
          part_id,
          SUM(CASE WHEN asset_type IN ('footprint', 'symbol', 'three_d_model') AND export_status = 'verified_for_export' AND validation_status = 'verified' AND storage_key IS NOT NULL AND file_hash IS NOT NULL THEN 1 ELSE 0 END) AS verified_cad_count,
          SUM(CASE WHEN asset_type IN ('footprint', 'symbol', 'three_d_model') AND storage_key IS NOT NULL AND file_hash IS NOT NULL THEN 1 ELSE 0 END) AS file_backed_cad_count,
          SUM(CASE WHEN asset_type IN ('footprint', 'symbol', 'three_d_model') AND source_url IS NOT NULL AND (storage_key IS NULL OR file_hash IS NULL) THEN 1 ELSE 0 END) AS referenced_cad_count
        FROM assets
        GROUP BY part_id
      ) cad_counts ON cad_counts.part_id = p.id
      LEFT JOIN (
        SELECT
          bl_inner.id AS bom_line_id,
          COALESCE(part_evidence.evidence_count, 0) + COALESCE(line_evidence.evidence_count, 0) + COALESCE(usage_evidence.evidence_count, 0) AS evidence_count
        FROM bom_lines bl_inner
        LEFT JOIN (
          SELECT target_id, COUNT(*) AS evidence_count
          FROM evidence_attachments
          WHERE target_type = 'part'
          GROUP BY target_id
        ) part_evidence ON part_evidence.target_id = bl_inner.matched_part_id
        LEFT JOIN (
          SELECT target_id, COUNT(*) AS evidence_count
          FROM evidence_attachments
          WHERE target_type = 'bom_line'
          GROUP BY target_id
        ) line_evidence ON line_evidence.target_id = bl_inner.id
        LEFT JOIN project_part_usages usage_inner ON usage_inner.bom_line_id = bl_inner.id
        LEFT JOIN (
          SELECT target_id, COUNT(*) AS evidence_count
          FROM evidence_attachments
          WHERE target_type = 'project_part_usage'
          GROUP BY target_id
        ) usage_evidence ON usage_evidence.target_id = usage_inner.id
      ) evidence_counts ON evidence_counts.bom_line_id = bl.id
      WHERE bl.project_id = $1
      ORDER BY bl.project_revision_id ASC, bl.row_number ASC, bl.id ASC
    `,
    [projectId]
  );

  return result.rows;
}

/**
 * Reads evidence rows attached to a project, its child project-memory records, or deterministic risk findings.
 */
async function readProjectEvidenceAttachments(databasePool: Pool | PoolClient, projectId: string): Promise<EvidenceAttachment[]> {
  const result = await databasePool.query<DatabaseEvidenceAttachmentRow>(
    `
      SELECT id, target_type, target_id, evidence_type, title, source_url, storage_key, file_hash, mime_type, notes, provenance, review_status, uploaded_by, created_at, updated_at
      FROM evidence_attachments
      WHERE (target_type = 'project' AND target_id = $1)
        OR (target_type = 'bom_import' AND target_id IN (SELECT id FROM bom_imports WHERE project_id = $1))
        OR (target_type = 'bom_line' AND target_id IN (SELECT id FROM bom_lines WHERE project_id = $1))
        OR (target_type = 'project_part_usage' AND target_id IN (SELECT id FROM project_part_usages WHERE project_id = $1))
        OR (target_type = 'part' AND target_id IN (SELECT DISTINCT part_id FROM project_part_usages WHERE project_id = $1))
        OR (target_type = 'asset' AND target_id IN (
          SELECT a.id
          FROM assets a
          JOIN project_part_usages u ON u.part_id = a.part_id
          WHERE u.project_id = $1
        ))
        OR (target_type = 'risk_finding' AND target_id LIKE $2)
      ORDER BY created_at DESC, id ASC
    `,
    [projectId, `${projectId}:bom-health:%`]
  );

  return result.rows.map(mapEvidenceAttachmentRow);
}

/**
 * Reads global evidence rows using only whitelisted filters from the shared vault contract.
 */
async function readEvidenceAttachments(databasePool: Pool | PoolClient, filters: EvidenceAttachmentListFilters): Promise<EvidenceAttachment[]> {
  const clauses: string[] = [];
  const values: Array<string> = [];

  if (filters.targetType) {
    values.push(filters.targetType);
    clauses.push(`target_type = $${values.length}`);
  }

  if (filters.evidenceType) {
    values.push(filters.evidenceType);
    clauses.push(`evidence_type = $${values.length}`);
  }

  if (filters.reviewStatus) {
    values.push(filters.reviewStatus);
    clauses.push(`review_status = $${values.length}`);
  }

  if (filters.storageState === "file_backed") {
    clauses.push("storage_key IS NOT NULL");
  } else if (filters.storageState === "link_only") {
    clauses.push("storage_key IS NULL AND source_url IS NOT NULL");
  } else if (filters.storageState === "note_only") {
    clauses.push("storage_key IS NULL AND source_url IS NULL AND notes IS NOT NULL");
  }

  if (filters.sourceSystem) {
    values.push(filters.sourceSystem.toLowerCase());
    clauses.push(`LOWER(provenance) = $${values.length}`);
  }

  if (filters.query) {
    values.push(`%${filters.query.toLowerCase()}%`);
    clauses.push(`(
      LOWER(id) LIKE $${values.length}
      OR LOWER(target_id) LIKE $${values.length}
      OR LOWER(title) LIKE $${values.length}
      OR LOWER(COALESCE(notes, '')) LIKE $${values.length}
      OR LOWER(COALESCE(provenance, '')) LIKE $${values.length}
      OR LOWER(COALESCE(source_url, '')) LIKE $${values.length}
      OR LOWER(COALESCE(storage_key, '')) LIKE $${values.length}
    )`);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await databasePool.query<DatabaseEvidenceAttachmentRow>(
    `
      SELECT id, target_type, target_id, evidence_type, title, source_url, storage_key, file_hash, mime_type, notes, provenance, review_status, uploaded_by, created_at, updated_at
      FROM evidence_attachments
      ${whereSql}
      ORDER BY updated_at DESC, created_at DESC, id ASC
      LIMIT 500
    `,
    values
  );

  return result.rows.map(mapEvidenceAttachmentRow);
}

/**
 * Reads follow-up records for an optional target filter in queue-first order.
 */
async function readFollowUpsFromDatabase(targetType: FollowUpTargetType, targetId: string): Promise<FollowUpListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (targetType === "project" && !(await projectExists(databasePool, targetId))) {
      return { status: "not_found" };
    }

    if (targetType === "circuit_block" && !(await circuitBlockExists(databasePool, targetId))) {
      return { status: "not_found" };
    }

    const followUps = await readFollowUpRows(databasePool, targetType, targetId);

    return {
      response: {
        followUps,
        state: followUps.length > 0 ? "available" : "empty",
        summary: buildFollowUpListSummary(followUps),
        targetId,
        targetType
      },
      status: "available"
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads persisted follow-up rows after target existence has already been checked.
 */
async function readFollowUpRows(databasePool: Pool | PoolClient, targetType: FollowUpTargetType, targetId: string): Promise<FollowUpRecord[]> {
  const result = await databasePool.query<DatabaseFollowUpRecordRow>(
    `
      SELECT id, target_type, target_id, source_type, source_finding_id, title, detail, next_action, severity, status, assigned_to, source_inputs, evidence_attachment_ids, resolution_notes, created_at, updated_at, resolved_at
      FROM follow_up_records
      WHERE target_type = $1 AND target_id = $2
      ORDER BY
        CASE status
          WHEN 'open' THEN 0
          WHEN 'in_progress' THEN 1
          WHEN 'resolved' THEN 2
          ELSE 3
        END ASC,
        CASE severity WHEN 'danger' THEN 0 ELSE 1 END ASC,
        updated_at DESC,
        id ASC
    `,
    [targetType, targetId]
  );

  return result.rows.map(mapFollowUpRecordRow);
}

/**
 * Upserts computed follow-up seeds while preserving operator-owned workflow fields.
 */
async function upsertFollowUpSeeds(client: PoolClient, seeds: FollowUpSeedRecord[], now: Date): Promise<{ createdCount: number; refreshedCount: number }> {
  if (seeds.length === 0) {
    return {
      createdCount: 0,
      refreshedCount: 0
    };
  }

  const targetType = seeds[0]?.targetType ?? "project";
  const targetId = seeds[0]?.targetId ?? "";
  const sourceType = seeds[0]?.sourceType ?? "bom_health";
  const sourceFindingIds = seeds.map((seed) => seed.sourceFindingId);
  const sourceFindingPlaceholders = sourceFindingIds.map((_, index) => `$${index + 4}`).join(", ");
  const existingResult = await client.query<{ source_finding_id: string }>(
    `
      SELECT source_finding_id
      FROM follow_up_records
      WHERE target_type = $1
        AND target_id = $2
        AND source_type = $3
        AND source_finding_id IN (${sourceFindingPlaceholders})
    `,
    [targetType, targetId, sourceType, ...sourceFindingIds]
  );
  const existingFindingIds = new Set(existingResult.rows.map((row) => row.source_finding_id));
  let createdCount = 0;
  let refreshedCount = 0;

  for (const seed of seeds) {
    if (existingFindingIds.has(seed.sourceFindingId)) {
      refreshedCount += 1;
    } else {
      createdCount += 1;
    }

    await client.query(
      `
        INSERT INTO follow_up_records (id, target_type, target_id, source_type, source_finding_id, title, detail, next_action, severity, status, source_inputs, evidence_attachment_ids, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10::jsonb, $11::jsonb, $12, $12)
        ON CONFLICT (target_type, target_id, source_type, source_finding_id) DO UPDATE
        SET title = EXCLUDED.title,
          detail = EXCLUDED.detail,
          next_action = EXCLUDED.next_action,
          severity = EXCLUDED.severity,
          source_inputs = EXCLUDED.source_inputs,
          updated_at = EXCLUDED.updated_at
      `,
      [
        buildFollowUpRecordId(seed),
        seed.targetType,
        seed.targetId,
        seed.sourceType,
        seed.sourceFindingId,
        seed.title,
        seed.detail,
        seed.nextAction,
        seed.severity,
        JSON.stringify(seed.sourceInputs),
        JSON.stringify(seed.evidenceAttachmentIds),
        now
      ]
    );
  }

  return {
    createdCount,
    refreshedCount
  };
}

/**
 * Reads circuit block summaries in stable library order.
 *
 * Filters narrow the result set in SQL (q/type/status/owner) so the API does not return rows
 * the UI then has to hide. The readiness filter is applied by the caller after summary
 * aggregation because the readiness verdict is derived from the same aggregated counts.
 */
async function readCircuitBlockSummaries(
  databasePool: Pool,
  filters: CircuitBlockSummarySqlFilters
): Promise<CircuitBlockSummary[]> {
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (filters.query) {
    params.push(`%${filters.query.toLowerCase()}%`);
    const placeholder = `$${params.length}`;
    whereClauses.push(
      `(LOWER(cb.block_key) LIKE ${placeholder} OR LOWER(cb.name) LIKE ${placeholder} OR LOWER(cb.description) LIKE ${placeholder} OR LOWER(COALESCE(cb.owner, '')) LIKE ${placeholder} OR LOWER(cb.reuse_scope) LIKE ${placeholder})`
    );
  }

  if (filters.blockType) {
    params.push(filters.blockType);
    whereClauses.push(`cb.block_type = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    whereClauses.push(`cb.status = $${params.length}`);
  }

  if (filters.owner) {
    params.push(filters.owner.toLowerCase());
    whereClauses.push(`LOWER(COALESCE(cb.owner, '')) = $${params.length}`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const result = await databasePool.query<DatabaseCircuitBlockSummaryRow>(
    `
      ${CIRCUIT_BLOCK_SUMMARIES_SQL}
      ${whereSql}
      ORDER BY cb.updated_at DESC, cb.block_key ASC, cb.id ASC
    `,
    params
  );

  return result.rows.map(mapCircuitBlockSummaryRow);
}

/** CircuitBlockSummarySqlFilters carries the subset of library filters resolved in SQL. */
interface CircuitBlockSummarySqlFilters {
  query: string | null;
  blockType: CircuitBlockType | null;
  status: CircuitBlockStatus | null;
  owner: string | null;
}

/**
 * Reads one circuit block summary by id.
 */
async function readCircuitBlockSummary(databasePool: Pool | PoolClient, circuitBlockId: string): Promise<CircuitBlockSummary | null> {
  const result = await databasePool.query<DatabaseCircuitBlockSummaryRow>(
    `
      ${CIRCUIT_BLOCK_SUMMARIES_SQL}
      WHERE cb.id = $1
    `,
    [circuitBlockId]
  );

  return result.rows[0] ? mapCircuitBlockSummaryRow(result.rows[0]) : null;
}

/**
 * Reads linked part roles with current part approval and readiness signals.
 */
async function readCircuitBlockPartRecords(databasePool: Pool | PoolClient, circuitBlockId: string): Promise<CircuitBlockPartRecord[]> {
  const result = await databasePool.query<DatabaseCircuitBlockPartDetailRow>(
    `
      SELECT
        cbp.id,
        cbp.circuit_block_id,
        cbp.part_id,
        cbp.role,
        cbp.quantity,
        cbp.is_required,
        cbp.substitution_policy,
        cbp.notes,
        cbp.created_at,
        cbp.updated_at,
        p.mpn,
        m.name AS manufacturer_name,
        p.lifecycle_status,
        pa.approval_status,
        prs.readiness_status,
        prs.connector_class,
        prs.blocker_count
      FROM circuit_block_parts cbp
      JOIN parts p ON p.id = cbp.part_id
      JOIN manufacturers m ON m.id = p.manufacturer_id
      LEFT JOIN part_approvals pa ON pa.part_id = p.id
      LEFT JOIN part_readiness_summaries prs ON prs.part_id = p.id
      WHERE cbp.circuit_block_id = $1
      ORDER BY cbp.is_required DESC, cbp.role ASC, p.mpn ASC, cbp.id ASC
    `,
    [circuitBlockId]
  );

  return result.rows.map(mapCircuitBlockPartDetailRow);
}

/**
 * Reads evidence attached to a circuit block or one of its part-role rows.
 */
async function readCircuitBlockEvidenceAttachments(databasePool: Pool | PoolClient, circuitBlockId: string): Promise<EvidenceAttachment[]> {
  const result = await databasePool.query<DatabaseEvidenceAttachmentRow>(
    `
      SELECT id, target_type, target_id, evidence_type, title, source_url, storage_key, file_hash, mime_type, notes, provenance, review_status, uploaded_by, created_at, updated_at
      FROM evidence_attachments
      WHERE (target_type = 'circuit_block' AND target_id = $1)
        OR (target_type = 'circuit_block_part' AND target_id IN (SELECT id FROM circuit_block_parts WHERE circuit_block_id = $1))
      ORDER BY created_at DESC, id ASC
    `,
    [circuitBlockId]
  );

  return result.rows.map(mapEvidenceAttachmentRow);
}

/**
 * Reads the instantiation history for one circuit block, joined with project, revision, and BOM import context.
 *
 * Returns events in newest-first order. Each row reports the count of BOM lines that still record
 * `instantiated_from_circuit_block_id = $1`, so engineers can see how many BOM rows the reuse event
 * actually placed (without making that count a trust signal — instantiation is engineering memory,
 * not part approval).
 */
async function readCircuitBlockInstantiationHistory(
  databasePool: Pool | PoolClient,
  circuitBlockId: string
): Promise<CircuitBlockInstantiationHistoryRecord[]> {
  const result = await databasePool.query<DatabaseCircuitBlockInstantiationHistoryRow>(
    `
      SELECT
        cbi.id AS inst_id,
        cbi.circuit_block_id AS inst_circuit_block_id,
        cbi.project_id AS inst_project_id,
        cbi.project_revision_id AS inst_project_revision_id,
        cbi.bom_import_id AS inst_bom_import_id,
        cbi.include_optional AS inst_include_optional,
        cbi.designator_prefix AS inst_designator_prefix,
        cbi.notes AS inst_notes,
        cbi.created_by AS inst_created_by,
        cbi.created_at AS inst_created_at,
        p.id AS project_id,
        p.project_key AS project_key,
        p.name AS project_name,
        p.description AS project_description,
        p.owner AS project_owner,
        p.status AS project_status,
        p.created_at AS project_created_at,
        p.updated_at AS project_updated_at,
        pr.id AS revision_id,
        pr.project_id AS revision_project_id,
        pr.revision_label AS revision_label,
        pr.revision_status AS revision_status,
        pr.source_reference AS revision_source_reference,
        pr.released_at AS revision_released_at,
        pr.created_at AS revision_created_at,
        pr.updated_at AS revision_updated_at,
        bi.id AS bom_import_id,
        bi.project_id AS bom_import_project_id,
        bi.project_revision_id AS bom_import_project_revision_id,
        bi.source_filename AS bom_import_source_filename,
        bi.source_format AS bom_import_source_format,
        bi.storage_key AS bom_import_storage_key,
        bi.import_status AS bom_import_status,
        bi.column_mapping AS bom_import_column_mapping,
        bi.import_summary AS bom_import_summary,
        bi.imported_by AS bom_import_imported_by,
        bi.created_at AS bom_import_created_at,
        bi.updated_at AS bom_import_updated_at,
        COALESCE(line_summary.bom_line_count, '0') AS bom_line_count
      FROM circuit_block_instantiations cbi
      JOIN projects p ON p.id = cbi.project_id
      JOIN project_revisions pr ON pr.id = cbi.project_revision_id
      LEFT JOIN bom_imports bi ON bi.id = cbi.bom_import_id
      LEFT JOIN (
        SELECT
          bl.bom_import_id AS bom_import_id,
          bl.instantiated_from_circuit_block_id AS block_id,
          COUNT(*)::text AS bom_line_count
        FROM bom_lines bl
        WHERE bl.instantiated_from_circuit_block_id IS NOT NULL
        GROUP BY bl.bom_import_id, bl.instantiated_from_circuit_block_id
      ) line_summary
        ON line_summary.bom_import_id = cbi.bom_import_id
       AND line_summary.block_id = cbi.circuit_block_id
      WHERE cbi.circuit_block_id = $1
      ORDER BY cbi.created_at DESC, cbi.id ASC
    `,
    [circuitBlockId]
  );

  return result.rows.map(mapCircuitBlockInstantiationHistoryRow);
}

/**
 * Maps one joined instantiation row into the shared history record.
 */
function mapCircuitBlockInstantiationHistoryRow(
  row: DatabaseCircuitBlockInstantiationHistoryRow
): CircuitBlockInstantiationHistoryRecord {
  const project: Project = {
    createdAt: toIsoTimestamp(row.project_created_at),
    description: row.project_description,
    id: row.project_id,
    name: row.project_name,
    owner: row.project_owner,
    projectKey: row.project_key,
    status: row.project_status,
    updatedAt: toIsoTimestamp(row.project_updated_at)
  };

  const revision: ProjectRevision = {
    createdAt: toIsoTimestamp(row.revision_created_at),
    id: row.revision_id,
    projectId: row.revision_project_id,
    releasedAt: row.revision_released_at ? toIsoTimestamp(row.revision_released_at) : null,
    revisionLabel: row.revision_label,
    revisionStatus: row.revision_status,
    sourceReference: row.revision_source_reference,
    updatedAt: toIsoTimestamp(row.revision_updated_at)
  };

  const bomImport: BomImport | null = row.bom_import_id
    ? {
        columnMapping: toRecord(row.bom_import_column_mapping),
        createdAt: toIsoTimestamp(row.bom_import_created_at as Date | string),
        id: row.bom_import_id,
        importStatus: row.bom_import_status as BomImport["importStatus"],
        importSummary: toRecord(row.bom_import_summary),
        importedBy: row.bom_import_imported_by,
        projectId: row.bom_import_project_id as string,
        projectRevisionId: row.bom_import_project_revision_id as string,
        sourceFilename: row.bom_import_source_filename as string,
        sourceFormat: row.bom_import_source_format as BomImport["sourceFormat"],
        storageKey: row.bom_import_storage_key,
        updatedAt: toIsoTimestamp(row.bom_import_updated_at as Date | string)
      }
    : null;

  const instantiation: CircuitBlockInstantiation = {
    bomImportId: row.inst_bom_import_id,
    circuitBlockId: row.inst_circuit_block_id,
    createdAt: toIsoTimestamp(row.inst_created_at),
    createdBy: row.inst_created_by,
    designatorPrefix: row.inst_designator_prefix,
    id: row.inst_id,
    includeOptional: row.inst_include_optional,
    notes: row.inst_notes,
    projectId: row.inst_project_id,
    projectRevisionId: row.inst_project_revision_id
  };

  return {
    bomImport,
    instantiatedBomLineCount: toNumber(row.bom_line_count),
    instantiation,
    project,
    revision
  };
}

/**
 * Builds one full circuit block detail response from summary, parts, evidence, dependencies,
 * instantiation history, and known engineering-memory risks.
 */
async function buildCircuitBlockDetail(databasePool: Pool | PoolClient, circuitBlockId: string): Promise<CircuitBlockDetailResponse | null> {
  const summary = await readCircuitBlockSummary(databasePool, circuitBlockId);

  if (!summary) {
    return null;
  }

  const [parts, evidence, projectDependenciesResult, instantiations, knownRisks] = await Promise.all([
    readCircuitBlockPartRecords(databasePool, circuitBlockId),
    readCircuitBlockEvidenceAttachments(databasePool, circuitBlockId),
    readCircuitBlockProjectDependenciesFromDatabase(circuitBlockId),
    readCircuitBlockInstantiationHistory(databasePool, circuitBlockId),
    readCircuitBlockKnownRisks(databasePool, circuitBlockId)
  ]);

  const projectDependencies = projectDependenciesResult.status === "available" ? projectDependenciesResult.dependencies : [];

  return {
    boundary: "Circuit blocks preserve reusable design knowledge; linked part approval, readiness, validation, and export status remain independent.",
    circuitBlock: summary.circuitBlock,
    evidence,
    instantiations,
    knownRisks,
    parts,
    projectDependencies,
    state: "available",
    summary
  };
}

/**
 * Reads every known-risk row recorded for one circuit block, including resolved ones.
 *
 * Newest-first by `recorded_at`. Resolved rows are preserved so the UI can render a
 * "history" view (or filter to active only) and so an audit can prove a block was in a
 * particular known-risk state when a project reused it.
 */
async function readCircuitBlockKnownRisks(databasePool: Pool | PoolClient, circuitBlockId: string): Promise<CircuitBlockKnownRisk[]> {
  const result = await databasePool.query<DatabaseCircuitBlockKnownRiskRow>(
    `
      SELECT id, circuit_block_id, title, detail, severity, recorded_by, recorded_at,
             resolved_at, resolved_by, resolution_notes, evidence_url, created_at, updated_at
      FROM circuit_block_known_risks
      WHERE circuit_block_id = $1
      ORDER BY recorded_at DESC, id ASC
    `,
    [circuitBlockId]
  );

  return result.rows.map(mapCircuitBlockKnownRiskRow);
}

/**
 * Maps one persisted known-risk row into the shared structured-memory type.
 *
 * `severity` is narrowed back to `CircuitBlockKnownRiskSeverity`; the CHECK constraint on
 * the column guarantees the value is one of the four documented severities, so an unknown
 * value would mean schema drift that should fail loudly.
 */
function mapCircuitBlockKnownRiskRow(row: DatabaseCircuitBlockKnownRiskRow): CircuitBlockKnownRisk {
  const severity = row.severity as CircuitBlockKnownRiskSeverity;
  return {
    circuitBlockId: row.circuit_block_id,
    createdAt: toIsoTimestamp(row.created_at),
    detail: row.detail,
    evidenceUrl: row.evidence_url,
    id: row.id,
    recordedAt: toIsoTimestamp(row.recorded_at),
    recordedBy: row.recorded_by,
    resolutionNotes: row.resolution_notes,
    resolvedAt: row.resolved_at ? toIsoTimestamp(row.resolved_at) : null,
    resolvedBy: row.resolved_by,
    severity,
    title: row.title,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Resolves one BOM line into a conservative internal-catalog match outcome.
 */
function resolveBomLineMatch(line: BomLine, candidatesByMpn: Map<string, DatabasePartMatchCandidateRow[]>): BomLineMatchOutcome {
  const rawMpn = normalizeOptionalText(line.rawMpn);

  if (!rawMpn) {
    return {
      matchConfidenceScore: null,
      matchedPartId: null,
      matchStatus: "unmatched"
    };
  }

  const candidates = candidatesByMpn.get(rawMpn.toLowerCase()) ?? [];

  if (candidates.length === 0) {
    return {
      matchConfidenceScore: null,
      matchedPartId: null,
      matchStatus: "unmatched"
    };
  }

  const rawManufacturer = normalizeOptionalText(line.rawManufacturer);

  if (!rawManufacturer) {
    return {
      matchConfidenceScore: candidates.length === 1 ? 0.6 : 0.45,
      matchedPartId: null,
      matchStatus: candidates.length === 1 ? "weak_match" : "ambiguous"
    };
  }

  const manufacturerMatches = candidates.filter((candidate) => partCandidateMatchesManufacturer(candidate, rawManufacturer));

  if (manufacturerMatches.length === 1) {
    return {
      matchConfidenceScore: 1,
      matchedPartId: manufacturerMatches[0]?.part_id ?? null,
      matchStatus: "matched"
    };
  }

  if (manufacturerMatches.length > 1) {
    return {
      matchConfidenceScore: 0.5,
      matchedPartId: null,
      matchStatus: "ambiguous"
    };
  }

  return {
    matchConfidenceScore: candidates.length === 1 ? 0.6 : 0.4,
    matchedPartId: null,
    matchStatus: "weak_match"
  };
}

/**
 * Prefetches every exact-MPN part candidate for a whole BOM import in one query, grouped by
 * lowercased MPN. This replaces a per-line `WHERE lower(p.mpn) = lower($1)` SELECT — a 5k-line
 * BOM previously issued ~5k serial candidate reads inside the match transaction; now it issues
 * one. Match semantics are unchanged: each line's candidate set and ordering are identical to
 * the old per-line query (`lower(p.mpn) ASC` only groups buckets; `m.name ASC, p.id ASC`
 * preserves the original within-MPN order).
 */
async function prefetchPartMatchCandidatesByMpn(
  client: PoolClient,
  rawMpns: Array<string | null>
): Promise<Map<string, DatabasePartMatchCandidateRow[]>> {
  const byMpn = new Map<string, DatabasePartMatchCandidateRow[]>();
  const distinctLowerMpns = [
    ...new Set(
      rawMpns
        .map((value) => normalizeOptionalText(value)?.toLowerCase())
        .filter((value): value is string => Boolean(value))
    )
  ];

  if (distinctLowerMpns.length === 0) {
    return byMpn;
  }

  // Dynamic placeholder IN-list (not `= ANY($1::text[])`) for pg-mem planner parity, consistent
  // with the rest of this module.
  const placeholders = distinctLowerMpns.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query<DatabasePartMatchCandidateRow>(
    `
      SELECT
        p.id AS part_id,
        p.mpn,
        p.manufacturer_id,
        m.name AS manufacturer_name,
        m.aliases AS manufacturer_aliases
      FROM parts p
      JOIN manufacturers m ON m.id = p.manufacturer_id
      WHERE lower(p.mpn) IN (${placeholders})
      ORDER BY lower(p.mpn) ASC, m.name ASC, p.id ASC
    `,
    distinctLowerMpns
  );

  for (const row of result.rows) {
    const key = row.mpn.toLowerCase();
    const bucket = byMpn.get(key);

    if (bucket) {
      bucket.push(row);
    } else {
      byMpn.set(key, [row]);
    }
  }

  return byMpn;
}

/**
 * Updates the persisted BOM line with match truth and returns the mapped line.
 */
async function updateBomLineMatch(client: PoolClient, line: BomLine, outcome: BomLineMatchOutcome, now: Date): Promise<BomLine> {
  const result = await client.query<DatabaseBomLineRow>(
    `
      UPDATE bom_lines
      SET matched_part_id = $2,
        match_status = $3,
        match_confidence_score = $4,
        updated_at = $5
      WHERE id = $1
      RETURNING id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes, raw_row_payload, matched_part_id, match_status, match_confidence_score, instantiated_from_circuit_block_id, instantiated_from_circuit_block_part_id, instantiated_at, created_at, updated_at
    `,
    [line.id, outcome.matchedPartId, outcome.matchStatus, outcome.matchConfidenceScore, now]
  );
  const updatedLine = result.rows[0];

  if (!updatedLine) {
    throw new CatalogStoreError("query_failed", "BOM line matching returned no persisted line row.", new Error("missing_bom_line_match_row"));
  }

  return mapBomLineRow(updatedLine);
}

/**
 * Creates or refreshes the confirmed usage row for one exact BOM line match.
 */
async function upsertProjectPartUsageForMatchedLine(
  client: PoolClient,
  line: BomLine,
  partId: string,
  now: Date,
  prefetch: MatchUsagePrefetch
): Promise<ProjectPartUsage> {
  const usageId = prefetch.usageIdByBomLine.get(line.id) ?? buildProjectPartUsageId(line.id);
  const approvalSnapshot = buildPartApprovalSnapshot(prefetch.approvalRowByPart.get(partId), now);
  const readinessSnapshot = buildPartReadinessSnapshot(prefetch.readinessRowByPart.get(partId), now);

  await client.query("DELETE FROM project_part_usages WHERE bom_line_id = $1 AND id <> $2", [line.id, usageId]);

  const result = await client.query<DatabaseProjectPartUsageRow>(
    `
      INSERT INTO project_part_usages (id, project_id, project_revision_id, bom_line_id, part_id, usage_context, designators, quantity, usage_status, approval_snapshot, readiness_snapshot, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'proposed', $9::jsonb, $10::jsonb, $11, $11)
      ON CONFLICT (id) DO UPDATE
      SET project_id = EXCLUDED.project_id,
        project_revision_id = EXCLUDED.project_revision_id,
        bom_line_id = EXCLUDED.bom_line_id,
        part_id = EXCLUDED.part_id,
        usage_context = EXCLUDED.usage_context,
        designators = EXCLUDED.designators,
        quantity = EXCLUDED.quantity,
        usage_status = EXCLUDED.usage_status,
        approval_snapshot = EXCLUDED.approval_snapshot,
        readiness_snapshot = EXCLUDED.readiness_snapshot,
        updated_at = EXCLUDED.updated_at
      RETURNING id, project_id, project_revision_id, bom_line_id, part_id, usage_context, designators, quantity, usage_status, approval_snapshot, readiness_snapshot, created_at, updated_at
    `,
    [
      usageId,
      line.projectId,
      line.projectRevisionId,
      line.id,
      partId,
      buildUsageContext(line),
      line.designators,
      line.quantity,
      JSON.stringify(approvalSnapshot),
      JSON.stringify(readinessSnapshot),
      now
    ]
  );
  const usage = result.rows[0];

  if (!usage) {
    throw new CatalogStoreError("query_failed", "Project part usage upsert returned no persisted row.", new Error("missing_usage_upsert_row"));
  }

  return mapProjectPartUsageRow(usage);
}

/**
 * Deletes stale usage when a line is no longer a confirmed match.
 */
async function deleteProjectPartUsageForBomLine(client: PoolClient, bomLineId: string): Promise<void> {
  await client.query("DELETE FROM project_part_usages WHERE bom_line_id = $1", [bomLineId]);
}

/**
 * MatchUsagePrefetch carries the per-import reads the usage upsert used to do per matched line.
 * One query each replaces ~3 serial SELECTs per matched line; the snapshot builders below are
 * pure transforms of these rows + the shared capture time, so output is byte-identical.
 */
interface MatchUsagePrefetch {
  /** Existing usage id keyed by bom_line_id (idempotent re-run reuses the same row). */
  usageIdByBomLine: Map<string, string>;
  /** part_approvals row keyed by part_id (PK ⇒ exactly one row per part). */
  approvalRowByPart: Map<string, DatabasePartApprovalSnapshotRow>;
  /** part_readiness_summaries row keyed by part_id (PK ⇒ exactly one row per part). */
  readinessRowByPart: Map<string, DatabasePartReadinessSnapshotRow>;
}

/**
 * Reads the existing usage id for every BOM line in the import in one query, preserving the old
 * per-line `ORDER BY created_at ASC, id ASC LIMIT 1` selection (lines never share bom_line_id, and
 * no line's upsert/delete touches another line's rows, so prefetching before the write loop is
 * equivalent to resolving each just-in-time).
 */
async function prefetchProjectPartUsageIdsByBomLine(client: PoolClient, bomLineIds: string[]): Promise<Map<string, string>> {
  const byBomLine = new Map<string, string>();
  const distinctIds = [...new Set(bomLineIds)];

  if (distinctIds.length === 0) {
    return byBomLine;
  }

  const placeholders = distinctIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query<{ id: string; bom_line_id: string }>(
    `
      SELECT id, bom_line_id
      FROM project_part_usages
      WHERE bom_line_id IN (${placeholders})
      ORDER BY created_at ASC, id ASC
    `,
    distinctIds
  );

  for (const row of result.rows) {
    if (!byBomLine.has(row.bom_line_id)) {
      byBomLine.set(row.bom_line_id, row.id);
    }
  }

  return byBomLine;
}

/**
 * Reads the part_approvals row for every matched part in one query, keyed by part_id (PK).
 */
async function prefetchPartApprovalRows(client: PoolClient, partIds: string[]): Promise<Map<string, DatabasePartApprovalSnapshotRow>> {
  const byPart = new Map<string, DatabasePartApprovalSnapshotRow>();
  const distinctIds = [...new Set(partIds)];

  if (distinctIds.length === 0) {
    return byPart;
  }

  const placeholders = distinctIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query<DatabasePartApprovalSnapshotRow & { part_id: string }>(
    `
      SELECT part_id, approval_status, summary, detail, evidence, decided_by, decided_at, last_updated_at
      FROM part_approvals
      WHERE part_id IN (${placeholders})
    `,
    distinctIds
  );

  for (const row of result.rows) {
    byPart.set(row.part_id, row);
  }

  return byPart;
}

/**
 * Reads the part_readiness_summaries row for every matched part in one query, keyed by part_id (PK).
 */
async function prefetchPartReadinessRows(client: PoolClient, partIds: string[]): Promise<Map<string, DatabasePartReadinessSnapshotRow>> {
  const byPart = new Map<string, DatabasePartReadinessSnapshotRow>();
  const distinctIds = [...new Set(partIds)];

  if (distinctIds.length === 0) {
    return byPart;
  }

  const placeholders = distinctIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query<DatabasePartReadinessSnapshotRow & { part_id: string }>(
    `
      SELECT part_id, readiness_status, identity_status, connector_class, blocker_count, blocker_summary, recommended_actions, detail, last_evaluated_at
      FROM part_readiness_summaries
      WHERE part_id IN (${placeholders})
    `,
    distinctIds
  );

  for (const row of result.rows) {
    byPart.set(row.part_id, row);
  }

  return byPart;
}

/**
 * Builds the approval-evidence snapshot from a prefetched row. Pure transform; identical output
 * to the previous per-line read. Recording a usage never changes part approval state.
 */
function buildPartApprovalSnapshot(row: DatabasePartApprovalSnapshotRow | undefined, capturedAt: Date): Record<string, unknown> {
  const capturedAtIso = capturedAt.toISOString();

  if (!row) {
    return {
      capturedAt: capturedAtIso,
      source: "part_approvals",
      state: "not_recorded"
    };
  }

  return {
    capturedAt: capturedAtIso,
    decidedAt: row.decided_at ? toIsoTimestamp(row.decided_at) : null,
    decidedBy: row.decided_by,
    detail: row.detail,
    evidence: toStringArray(row.evidence),
    lastUpdatedAt: toIsoTimestamp(row.last_updated_at),
    source: "part_approvals",
    state: "available",
    status: row.approval_status,
    summary: row.summary
  };
}

/**
 * Builds the readiness-evidence snapshot from a prefetched row. Pure transform; identical output
 * to the previous per-line read. Recording a usage never changes part readiness state.
 */
function buildPartReadinessSnapshot(row: DatabasePartReadinessSnapshotRow | undefined, capturedAt: Date): Record<string, unknown> {
  const capturedAtIso = capturedAt.toISOString();

  if (!row) {
    return {
      capturedAt: capturedAtIso,
      source: "part_readiness_summaries",
      state: "not_recorded"
    };
  }

  return {
    blockerCount: toNumber(row.blocker_count),
    blockerSummary: toStringArray(row.blocker_summary),
    capturedAt: capturedAtIso,
    connectorClass: row.connector_class,
    detail: row.detail,
    identityStatus: row.identity_status,
    lastEvaluatedAt: toIsoTimestamp(row.last_evaluated_at),
    recommendedActions: toStringArray(row.recommended_actions),
    source: "part_readiness_summaries",
    state: "available",
    status: row.readiness_status
  };
}

/**
 * Builds the match-run summary from updated lines and usage/import candidate counts.
 */
function buildBomImportMatchSummary(lines: BomLine[], usageCreatedOrUpdatedCount: number, importableExactMpnLineCount: number): BomImportMatchSummary {
  return {
    ambiguousLineCount: lines.filter((line) => line.matchStatus === "ambiguous").length,
    ignoredLineCount: lines.filter((line) => line.matchStatus === "ignored").length,
    importableExactMpnLineCount,
    matchedLineCount: lines.filter((line) => line.matchStatus === "matched").length,
    totalLineCount: lines.length,
    unmatchedLineCount: lines.filter((line) => line.matchStatus === "unmatched").length,
    usageCreatedOrUpdatedCount,
    weakMatchLineCount: lines.filter((line) => line.matchStatus === "weak_match").length
  };
}

/**
 * Builds an import candidate only for exact-MPN rows that remain unmatched after internal matching.
 */
function buildLineImportCandidate(line: BomLine): BomLineImportCandidate | null {
  const rawMpn = normalizeOptionalText(line.rawMpn);

  if (line.matchStatus !== "unmatched" || !rawMpn) {
    return null;
  }

  return {
    bomLineId: line.id,
    manufacturerName: normalizeOptionalText(line.rawManufacturer),
    mpn: rawMpn,
    rowNumber: line.rowNumber
  };
}

/**
 * Checks whether a raw BOM manufacturer exactly matches a canonical manufacturer or alias.
 */
function partCandidateMatchesManufacturer(candidate: DatabasePartMatchCandidateRow, rawManufacturer: string): boolean {
  const manufacturerNames = [candidate.manufacturer_name, ...toStringArray(candidate.manufacturer_aliases)];
  const normalizedRawManufacturer = normalizeManufacturerName(rawManufacturer);

  return manufacturerNames.some((manufacturerName) => normalizeManufacturerName(manufacturerName) === normalizedRawManufacturer);
}

/**
 * Builds a concise usage context from BOM row evidence without implying design approval.
 */
function buildUsageContext(line: BomLine): string {
  const rawDescription = normalizeOptionalText(line.rawDescription);

  return rawDescription ? `BOM row ${line.rowNumber}: ${rawDescription}` : `BOM row ${line.rowNumber}: exact internal match`;
}

/**
 * Builds an explainable BOM health response from raw BOM-line and part evidence inputs.
 */
function buildProjectBomHealthResponse(
  projectId: string,
  rows: DatabaseProjectBomHealthRow[],
  evidenceAttachmentCount: number,
  lifecycleReviewCheckpointAt: Date | null
): ProjectBomHealthResponse {
  const matchedRows = rows.filter((row) => row.match_status === "matched" && row.matched_part_id);
  const unmatchedRows = rows.filter((row) => row.match_status === "unmatched");
  const ambiguousRows = rows.filter((row) => row.match_status === "ambiguous");
  const weakRows = rows.filter((row) => row.match_status === "weak_match");
  const ignoredRows = rows.filter((row) => row.match_status === "ignored");
  const approvalGapRows = matchedRows.filter((row) => row.approval_status !== "approved");
  const lifecycleRiskRows = matchedRows.filter((row) => row.lifecycle_status !== "active");
  const lifecycleRegressionRows =
    lifecycleReviewCheckpointAt === null
      ? []
      : matchedRows.filter((row) => {
          const status = row.lifecycle_status;
          if (status !== "obsolete" && status !== "not_recommended") {
            return false;
          }

          const catalogTouch = parseNullableDate(row.matched_part_last_updated_at);
          return (
            catalogTouch !== null && catalogTouch.getTime() > lifecycleReviewCheckpointAt.getTime()
          );
        });
  const missingVerifiedCadRows = matchedRows.filter((row) => toNumber(row.verified_cad_count) < 3);
  const referencedCadOnlyRows = missingVerifiedCadRows.filter((row) => toNumber(row.referenced_cad_count) > 0 && toNumber(row.file_backed_cad_count) === 0);
  const connectorGapRows = matchedRows.filter((row) => isConnectorHealthGap(row));
  const missingEvidenceRows = matchedRows.filter((row) => toNumber(row.evidence_count) === 0);
  const summary: ProjectBomHealthSummary = {
    ambiguousLineCount: ambiguousRows.length,
    approvalGapCount: approvalGapRows.length,
    connectorBuildabilityGapCount: connectorGapRows.length,
    evidenceAttachmentCount,
    ignoredLineCount: ignoredRows.length,
    lifecycleRiskCount: lifecycleRiskRows.length,
    lifecycleRegressionCount: lifecycleRegressionRows.length,
    matchedLineCount: matchedRows.length,
    missingEvidenceCount: missingEvidenceRows.length,
    missingVerifiedCadCount: missingVerifiedCadRows.length,
    referencedCadOnlyCount: referencedCadOnlyRows.length,
    totalLineCount: rows.length,
    unmatchedLineCount: unmatchedRows.length,
    weakMatchLineCount: weakRows.length
  };

  return {
    findings: buildProjectBomRiskFindings(
      projectId,
      {
        ambiguousRows,
        approvalGapRows,
        connectorGapRows,
        lifecycleRegressionRows,
        lifecycleRiskRows,
        missingEvidenceRows,
        missingVerifiedCadRows,
        unmatchedRows,
        weakRows
      },
      lifecycleReviewCheckpointAt
    ),
    generatedAt: new Date().toISOString(),
    lifecycleReviewCheckpointAt: lifecycleReviewCheckpointAt ? toIsoTimestamp(lifecycleReviewCheckpointAt) : null,
    projectId,
    state: rows.length > 0 ? "available" : "empty",
    summary
  };
}

/**
 * Builds one finding per explainable health category that currently has affected BOM rows.
 */
function buildProjectBomRiskFindings(
  projectId: string,
  groups: {
    ambiguousRows: DatabaseProjectBomHealthRow[];
    approvalGapRows: DatabaseProjectBomHealthRow[];
    connectorGapRows: DatabaseProjectBomHealthRow[];
    lifecycleRegressionRows: DatabaseProjectBomHealthRow[];
    lifecycleRiskRows: DatabaseProjectBomHealthRow[];
    missingEvidenceRows: DatabaseProjectBomHealthRow[];
    missingVerifiedCadRows: DatabaseProjectBomHealthRow[];
    unmatchedRows: DatabaseProjectBomHealthRow[];
    weakRows: DatabaseProjectBomHealthRow[];
  },
  lifecycleReviewCheckpointAt: Date | null
): ProjectBomRiskFinding[] {
  const findings: ProjectBomRiskFinding[] = [];

  pushFinding(findings, projectId, "unmatched_bom_rows", groups.unmatchedRows, {
    detail: `${groups.unmatchedRows.length} BOM rows have no confirmed internal part match.`,
    nextAction: "Import or create internal parts, then rerun exact BOM matching.",
    severity: "review",
    title: "Unmatched BOM rows"
  });
  pushFinding(findings, projectId, "ambiguous_or_weak_matches", [...groups.ambiguousRows, ...groups.weakRows], {
    detail: `${groups.ambiguousRows.length} ambiguous and ${groups.weakRows.length} weak rows need human review before they become usage history.`,
    nextAction: "Resolve manufacturer identity or choose the correct internal part before creating usage.",
    severity: "review",
    title: "Ambiguous or weak matches"
  });
  pushFinding(findings, projectId, "approval_gap", groups.approvalGapRows, {
    detail: `${groups.approvalGapRows.length} matched BOM rows point to parts without explicit approved status.`,
    nextAction: "Review part approval records before reusing these parts in released project revisions.",
    severity: "review",
    title: "Part approval gaps"
  });
  pushFinding(findings, projectId, "lifecycle_risk", groups.lifecycleRiskRows, {
    detail: `${groups.lifecycleRiskRows.length} matched BOM rows point to parts whose lifecycle is not active (current catalog state, not the BOM match snapshot).`,
    nextAction: "Check lifecycle status and confirm whether replacements or approved exceptions are needed.",
    severity: groups.lifecycleRiskRows.some((row) => row.lifecycle_status === "obsolete") ? "danger" : "review",
    title: "Lifecycle risk"
  });
  pushLifecycleRegressionFinding(findings, projectId, groups.lifecycleRegressionRows, lifecycleReviewCheckpointAt);
  pushFinding(findings, projectId, "missing_verified_cad", groups.missingVerifiedCadRows, {
    detail: `${groups.missingVerifiedCadRows.length} matched BOM rows do not have a complete verified file-backed CAD/export set.`,
    nextAction: "Review symbol, footprint, and 3D model coverage; referenced CAD alone does not unlock export.",
    severity: "review",
    title: "Missing verified CAD/export assets"
  });
  pushFinding(findings, projectId, "connector_buildability_gap", groups.connectorGapRows, {
    detail: `${groups.connectorGapRows.length} connector-related rows still have buildability or readiness blockers.`,
    nextAction: "Inspect mate, accessory, cable, and tooling evidence before layout reuse.",
    severity: "review",
    title: "Connector buildability gaps"
  });
  pushFinding(findings, projectId, "missing_evidence", groups.missingEvidenceRows, {
    detail: `${groups.missingEvidenceRows.length} matched BOM rows have no attached project, BOM-line, usage, or part evidence metadata.`,
    nextAction: "Attach design review notes, links, or file metadata so future reuse decisions have provenance.",
    severity: "review",
    title: "Missing decision evidence"
  });

  return findings;
}

/**
 * Adds a risk finding when a category has affected rows.
 */
function pushFinding(
  findings: ProjectBomRiskFinding[],
  projectId: string,
  code: ProjectBomRiskFindingCode,
  rows: DatabaseProjectBomHealthRow[],
  copy: { detail: string; nextAction: string; severity: ProjectBomRiskFinding["severity"]; title: string }
): void {
  if (rows.length === 0) {
    return;
  }

  findings.push({
    affectedBomLineIds: uniqueStrings(rows.map((row) => row.id)),
    affectedPartIds: uniqueStrings(rows.map((row) => row.matched_part_id).filter((partId): partId is string => Boolean(partId))),
    code,
    detail: copy.detail,
    id: `${projectId}:bom-health:${code}`,
    inputs: rows.slice(0, 6).map(formatBomHealthInput),
    nextAction: copy.nextAction,
    projectId,
    severity: copy.severity,
    title: copy.title
  });
}

/**
 * Adds a regression finding when obsolete or not_recommended catalog state moved in after the review checkpoint.
 */
function pushLifecycleRegressionFinding(
  findings: ProjectBomRiskFinding[],
  projectId: string,
  rows: DatabaseProjectBomHealthRow[],
  lifecycleReviewCheckpointAt: Date | null
): void {
  if (rows.length === 0 || !lifecycleReviewCheckpointAt) {
    return;
  }

  const checkpointIso = toIsoTimestamp(lifecycleReviewCheckpointAt);

  findings.push({
    affectedBomLineIds: uniqueStrings(rows.map((row) => row.id)),
    affectedPartIds: uniqueStrings(rows.map((row) => row.matched_part_id).filter((partId): partId is string => Boolean(partId))),
    code: "lifecycle_risk_changed",
    detail: `${rows.length} matched BOM rows reference parts that are now obsolete or not recommended, and the catalog part record was touched after the last BOM health review checkpoint (${checkpointIso}).`,
    id: `${projectId}:bom-health:lifecycle_risk_changed`,
    inputs: rows.slice(0, 6).map((row) => formatBomHealthLifecycleRegressionInput(row, checkpointIso)),
    nextAction:
      "Treat this as a sourcing regression: confirm substitutes, re-approve exceptions with provenance, or update the BOM to a supported MPN.",
    projectId,
    severity: rows.some((row) => row.lifecycle_status === "obsolete") ? "danger" : "review",
    title: "Lifecycle regression since last BOM health review"
  });
}

/**
 * Formats a regression row with catalog touch time relative to the review checkpoint.
 */
function formatBomHealthLifecycleRegressionInput(row: DatabaseProjectBomHealthRow, checkpointIso: string): string {
  const base = formatBomHealthInput(row);
  const touch = row.matched_part_last_updated_at
    ? toIsoTimestamp(row.matched_part_last_updated_at as Date | string)
    : "unknown catalog touch time";

  return `${base} Catalog last touched ${touch}; checkpoint ${checkpointIso}.`;
}

/**
 * Formats one compact input line so risk findings stay explainable in the UI.
 */
function formatBomHealthInput(row: DatabaseProjectBomHealthRow): string {
  const rawMpn = row.raw_mpn ?? "unknown MPN";
  const designators = toStringArray(row.designators);
  const reference = designators.length > 0 ? designators.join(", ") : `row ${row.row_number}`;

  if (row.match_status !== "matched") {
    return `${reference}: ${rawMpn} is ${row.match_status}.`;
  }

  return `${reference}: ${rawMpn}, lifecycle=${row.lifecycle_status ?? "unknown"}, approval=${row.approval_status ?? "missing"}, verifiedCad=${toNumber(row.verified_cad_count)}/3, referencedCad=${toNumber(row.referenced_cad_count)}, evidence=${toNumber(row.evidence_count)}.`;
}

/**
 * Detects connector-specific readiness gaps without treating all asset gaps as connector gaps.
 */
function isConnectorHealthGap(row: DatabaseProjectBomHealthRow): boolean {
  if (!row.connector_class || row.connector_class === "non_connector") {
    return false;
  }

  return row.readiness_status !== "ready_for_export_review" || toNumber(row.blocker_count ?? 0) > 0;
}

/**
 * Converts one computed BOM health finding into assignable project work.
 */
function buildProjectBomHealthFollowUpSeed(finding: ProjectBomRiskFinding): FollowUpSeedRecord {
  return {
    detail: finding.detail,
    evidenceAttachmentIds: [],
    nextAction: finding.nextAction,
    severity: finding.severity,
    sourceFindingId: finding.id,
    sourceInputs: finding.inputs,
    sourceType: "bom_health",
    targetId: finding.projectId,
    targetType: "project",
    title: finding.title
  };
}

/**
 * Checks whether a required circuit block role still has approval or readiness work.
 */
function isCircuitBlockPartReadinessGap(record: CircuitBlockPartRecord): boolean {
  if (!record.blockPart.isRequired) {
    return false;
  }

  return record.part.approvalStatus !== "approved" ||
    record.part.readinessStatus !== "ready_for_export_review" ||
    (record.part.blockerCount ?? 0) > 0;
}

/**
 * Converts one required circuit role gap into assignable circuit follow-up work.
 */
function buildCircuitBlockGapFollowUpSeed(circuitBlockId: string, record: CircuitBlockPartRecord): FollowUpSeedRecord {
  const blockerCount = record.part.blockerCount ?? 0;
  const issueSummary = [
    record.part.approvalStatus === "approved" ? null : `approval=${record.part.approvalStatus ?? "missing"}`,
    record.part.readinessStatus === "ready_for_export_review" ? null : `readiness=${record.part.readinessStatus ?? "missing"}`,
    blockerCount > 0 ? `blockers=${blockerCount}` : null
  ].filter((issue): issue is string => Boolean(issue));
  const sourceInput = `${record.blockPart.role}: ${record.part.mpn}, manufacturer=${record.part.manufacturerName}, ${issueSummary.join(", ")}.`;

  return {
    detail: `Required role "${record.blockPart.role}" uses ${record.part.mpn} (${record.part.manufacturerName}) and still has ${issueSummary.join(", ")}.`,
    evidenceAttachmentIds: [],
    nextAction: "Resolve linked part approval/readiness blockers or attach supporting circuit evidence before treating this block as reusable for export-bound designs.",
    severity: record.part.approvalStatus === "approved" ? "review" : "danger",
    sourceFindingId: `${circuitBlockId}:circuit-gap:${record.blockPart.id}`,
    sourceInputs: [sourceInput],
    sourceType: "circuit_block_gap",
    targetId: circuitBlockId,
    targetType: "circuit_block",
    title: `${record.blockPart.role} needs reuse readiness review`
  };
}

/**
 * Returns unique non-empty strings in first-seen order for stable API payloads.
 */
function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

/**
 * Checks whether one project id exists before returning scoped empty child reads.
 */
async function projectExists(databasePool: Pool | PoolClient, projectId: string): Promise<boolean> {
  const result = await databasePool.query<{ id: string }>("SELECT id FROM projects WHERE id = $1 LIMIT 1", [projectId]);

  return result.rows.length > 0;
}

/**
 * Checks whether one internal catalog part exists before returning where-used reads.
 */
async function partExists(databasePool: Pool | PoolClient, partId: string): Promise<boolean> {
  const result = await databasePool.query<{ id: string }>("SELECT id FROM parts WHERE id = $1 LIMIT 1", [partId]);

  return result.rows.length > 0;
}

/**
 * Checks whether one BOM import exists before returning scoped empty line reads.
 */
async function bomImportExists(databasePool: Pool | PoolClient, bomImportId: string): Promise<boolean> {
  const result = await databasePool.query<{ id: string }>("SELECT id FROM bom_imports WHERE id = $1 LIMIT 1", [bomImportId]);

  return result.rows.length > 0;
}

/**
 * Checks whether one reusable circuit block exists before returning scoped reads or writes.
 */
async function circuitBlockExists(databasePool: Pool | PoolClient, circuitBlockId: string): Promise<boolean> {
  const result = await databasePool.query<{ id: string }>("SELECT id FROM circuit_blocks WHERE id = $1 LIMIT 1", [circuitBlockId]);

  return result.rows.length > 0;
}

/**
 * Checks one evidence target before accepting metadata for durable project memory.
 */
async function evidenceTargetExists(databasePool: Pool | PoolClient, targetType: EvidenceTargetType, targetId: string): Promise<{ exists: true } | { exists: false; code: string; message: string }> {
  if (targetType === "risk_finding") {
    return { exists: true };
  }

  const tableByTarget: Record<Exclude<EvidenceTargetType, "risk_finding">, { code: string; label: string; table: string }> = {
    asset: { code: "ASSET_NOT_FOUND", label: "Asset", table: "assets" },
    bom_import: { code: "BOM_IMPORT_NOT_FOUND", label: "BOM import", table: "bom_imports" },
    bom_line: { code: "BOM_LINE_NOT_FOUND", label: "BOM line", table: "bom_lines" },
    circuit_block: { code: "CIRCUIT_BLOCK_NOT_FOUND", label: "Circuit block", table: "circuit_blocks" },
    circuit_block_part: { code: "CIRCUIT_BLOCK_PART_NOT_FOUND", label: "Circuit block part", table: "circuit_block_parts" },
    part: { code: "PART_NOT_FOUND", label: "Part", table: "parts" },
    project: { code: "PROJECT_NOT_FOUND", label: "Project", table: "projects" },
    project_part_usage: { code: "PROJECT_PART_USAGE_NOT_FOUND", label: "Project part usage", table: "project_part_usages" }
  };
  const target = tableByTarget[targetType];
  const result = await databasePool.query<{ id: string }>(`SELECT id FROM ${target.table} WHERE id = $1 LIMIT 1`, [targetId]);

  if (result.rows.length > 0) {
    return { exists: true };
  }

  return {
    code: target.code,
    exists: false,
    message: `${target.label} target not found.`
  };
}

/**
 * Checks related evidence ids before a follow-up references them.
 */
async function evidenceAttachmentsExist(databasePool: Pool | PoolClient, evidenceAttachmentIds: string[]): Promise<boolean> {
  const uniqueEvidenceAttachmentIds = uniqueStrings(evidenceAttachmentIds);

  if (uniqueEvidenceAttachmentIds.length === 0) {
    return true;
  }

  const placeholders = uniqueEvidenceAttachmentIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await databasePool.query<{ id: string }>(
    `
      SELECT id
      FROM evidence_attachments
      WHERE id IN (${placeholders})
    `,
    uniqueEvidenceAttachmentIds
  );

  return result.rows.length === uniqueEvidenceAttachmentIds.length;
}

/**
 * Resolves an existing revision or creates a new draft revision for one BOM upload.
 */
async function resolveProjectRevisionForBomImport(client: PoolClient, projectId: string, input: BomImportCreateInput): Promise<ProjectRevision> {
  const requestedRevisionId = normalizeOptionalText(input.projectRevisionId);

  if (requestedRevisionId) {
    const revisionResult = await client.query<DatabaseProjectRevisionRow>(
      `
        SELECT id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
        FROM project_revisions
        WHERE id = $1 AND project_id = $2
        LIMIT 1
      `,
      [requestedRevisionId, projectId]
    );
    const revisionRow = revisionResult.rows[0];

    if (!revisionRow) {
      throw new ProjectMemoryInputError("PROJECT_REVISION_NOT_FOUND", "The selected project revision does not exist for this project.");
    }

    return mapProjectRevisionRow(revisionRow);
  }

  const revisionLabel = normalizeOptionalText(input.revisionLabel);

  if (!revisionLabel) {
    throw new ProjectMemoryInputError("PROJECT_REVISION_REQUIRED", "Choose an existing project revision or enter a revision label before saving the BOM.");
  }

  const existingRevisionResult = await client.query<DatabaseProjectRevisionRow>(
    `
      SELECT id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
      FROM project_revisions
      WHERE project_id = $1 AND revision_label = $2
      LIMIT 1
    `,
    [projectId, revisionLabel]
  );
  const existingRevision = existingRevisionResult.rows[0];

  if (existingRevision) {
    return mapProjectRevisionRow(existingRevision);
  }

  const now = new Date();
  const revisionResult = await client.query<DatabaseProjectRevisionRow>(
    `
      INSERT INTO project_revisions (id, project_id, revision_label, revision_status, source_reference, created_at, updated_at)
      VALUES ($1, $2, $3, 'draft', $4, $5, $5)
      RETURNING id, project_id, revision_label, revision_status, source_reference, released_at, created_at, updated_at
    `,
    [buildProjectRevisionId(projectId, revisionLabel), projectId, revisionLabel, "Created during BOM import", now]
  );
  const revisionRow = revisionResult.rows[0];

  if (!revisionRow) {
    throw new CatalogStoreError("query_failed", "Project revision creation returned no persisted row.", new Error("missing_revision_create_row"));
  }

  return mapProjectRevisionRow(revisionRow);
}

/** PROJECT_SUMMARIES_SQL reads project rows plus child counts and latest child update timestamps. */
const PROJECT_SUMMARIES_SQL = `
  SELECT
    p.id,
    p.project_key,
    p.name,
    p.description,
    p.owner,
    p.status,
    p.created_at,
    p.updated_at,
    COALESCE(revision_summary.revision_count, '0') AS revision_count,
    COALESCE(bom_import_summary.bom_import_count, '0') AS bom_import_count,
    COALESCE(usage_summary.usage_count, '0') AS usage_count,
    revision_summary.latest_revision_updated_at,
    bom_import_summary.latest_bom_import_updated_at,
    usage_summary.latest_usage_updated_at
  FROM projects p
  LEFT JOIN (
    SELECT project_id, COUNT(*)::text AS revision_count, MAX(updated_at) AS latest_revision_updated_at
    FROM project_revisions
    GROUP BY project_id
  ) revision_summary ON revision_summary.project_id = p.id
  LEFT JOIN (
    SELECT project_id, COUNT(*)::text AS bom_import_count, MAX(updated_at) AS latest_bom_import_updated_at
    FROM bom_imports
    GROUP BY project_id
  ) bom_import_summary ON bom_import_summary.project_id = p.id
  LEFT JOIN (
    SELECT project_id, COUNT(*)::text AS usage_count, MAX(updated_at) AS latest_usage_updated_at
    FROM project_part_usages
    GROUP BY project_id
  ) usage_summary ON usage_summary.project_id = p.id
`;

/** CIRCUIT_BLOCK_SUMMARIES_SQL reads reusable circuit rows plus explainable linked-part counts. */
const CIRCUIT_BLOCK_SUMMARIES_SQL = `
  SELECT
    cb.id,
    cb.block_key,
    cb.name,
    cb.description,
    cb.block_type,
    cb.owner,
    cb.status,
    cb.reuse_scope,
    cb.constraints,
    cb.created_at,
    cb.updated_at,
    COALESCE(part_summary.total_part_count, '0') AS total_part_count,
    COALESCE(part_summary.required_part_count, '0') AS required_part_count,
    COALESCE(part_summary.optional_part_count, '0') AS optional_part_count,
    COALESCE(part_summary.approved_part_count, '0') AS approved_part_count,
    COALESCE(part_summary.readiness_gap_count, '0') AS readiness_gap_count,
    COALESCE(part_summary.lifecycle_risk_count, '0') AS lifecycle_risk_count,
    COALESCE(part_summary.strict_substitution_count, '0') AS strict_substitution_count,
    COALESCE(evidence_summary.evidence_attachment_count, '0') AS evidence_attachment_count,
    COALESCE(usage_summary.project_usage_count, '0') AS project_usage_count,
    COALESCE(known_risk_summary.active_known_risk_count, '0') AS active_known_risk_count,
    COALESCE(known_risk_summary.active_blocking_risk_count, '0') AS active_blocking_risk_count
  FROM circuit_blocks cb
  LEFT JOIN (
    SELECT
      cbp.circuit_block_id,
      COUNT(*)::text AS total_part_count,
      SUM(CASE WHEN cbp.is_required THEN 1 ELSE 0 END)::text AS required_part_count,
      SUM(CASE WHEN cbp.is_required THEN 0 ELSE 1 END)::text AS optional_part_count,
      SUM(CASE WHEN pa.approval_status = 'approved' THEN 1 ELSE 0 END)::text AS approved_part_count,
      SUM(CASE WHEN cbp.is_required AND (pa.approval_status IS NULL OR pa.approval_status <> 'approved' OR prs.readiness_status IS NULL OR prs.readiness_status <> 'ready_for_export_review' OR COALESCE(prs.blocker_count, 0) > 0) THEN 1 ELSE 0 END)::text AS readiness_gap_count,
      SUM(CASE WHEN cbp.is_required AND p.lifecycle_status IN ('obsolete', 'not_recommended') THEN 1 ELSE 0 END)::text AS lifecycle_risk_count,
      SUM(CASE WHEN cbp.substitution_policy IN ('exact_required', 'do_not_substitute') THEN 1 ELSE 0 END)::text AS strict_substitution_count
    FROM circuit_block_parts cbp
    JOIN parts p ON p.id = cbp.part_id
    LEFT JOIN part_approvals pa ON pa.part_id = cbp.part_id
    LEFT JOIN part_readiness_summaries prs ON prs.part_id = cbp.part_id
    GROUP BY cbp.circuit_block_id
  ) part_summary ON part_summary.circuit_block_id = cb.id
  LEFT JOIN (
    SELECT
      target_id,
      COUNT(*)::text AS evidence_attachment_count
    FROM evidence_attachments
    WHERE target_type = 'circuit_block'
    GROUP BY target_id
  ) evidence_summary ON evidence_summary.target_id = cb.id
  LEFT JOIN (
    SELECT
      cbp.circuit_block_id,
      COUNT(DISTINCT u.id)::text AS project_usage_count
    FROM circuit_block_parts cbp
    JOIN project_part_usages u ON u.part_id = cbp.part_id
    GROUP BY cbp.circuit_block_id
  ) usage_summary ON usage_summary.circuit_block_id = cb.id
  LEFT JOIN (
    SELECT
      circuit_block_id,
      COUNT(*)::text AS active_known_risk_count,
      SUM(CASE WHEN severity = 'blocking' THEN 1 ELSE 0 END)::text AS active_blocking_risk_count
    FROM circuit_block_known_risks
    WHERE resolved_at IS NULL
    GROUP BY circuit_block_id
  ) known_risk_summary ON known_risk_summary.circuit_block_id = cb.id
`;

/** WHERE_USED_CIRCUIT_BLOCK_DEPENDENCIES_SQL reads block roles with block and part context. */
const WHERE_USED_CIRCUIT_BLOCK_DEPENDENCIES_SQL = `
  SELECT
    cb.id AS block_id,
    cb.block_key AS block_key,
    cb.name AS block_name,
    cb.description AS block_description,
    cb.block_type AS block_type,
    cb.owner AS block_owner,
    cb.status AS block_status,
    cb.reuse_scope AS block_reuse_scope,
    cb.constraints AS block_constraints,
    cb.created_at AS block_created_at,
    cb.updated_at AS block_updated_at,
    cbp.id,
    cbp.circuit_block_id,
    cbp.part_id,
    cbp.role,
    cbp.quantity,
    cbp.is_required,
    cbp.substitution_policy,
    cbp.notes,
    cbp.created_at,
    cbp.updated_at,
    p.mpn,
    m.name AS manufacturer_name,
    p.lifecycle_status,
    pa.approval_status,
    prs.readiness_status,
    prs.connector_class,
    prs.blocker_count
  FROM circuit_block_parts cbp
  JOIN circuit_blocks cb ON cb.id = cbp.circuit_block_id
  JOIN parts p ON p.id = cbp.part_id
  JOIN manufacturers m ON m.id = p.manufacturer_id
  LEFT JOIN part_approvals pa ON pa.part_id = p.id
  LEFT JOIN part_readiness_summaries prs ON prs.part_id = p.id
`;

/**
 * Lazily creates the Postgres pool when DATABASE_URL exists.
 */
function getProjectMemoryDatabasePool(): Pool | null {
  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL
  });

  return pool;
}

/**
 * Maps one project summary row into the shared API contract.
 */
function mapProjectSummaryRow(row: DatabaseProjectSummaryRow): ProjectSummary {
  const project = mapProjectRow(row);

  return {
    bomImportCount: toNumber(row.bom_import_count),
    latestActivityAt: latestTimestamp([
      project.updatedAt,
      row.latest_revision_updated_at ? toIsoTimestamp(row.latest_revision_updated_at) : null,
      row.latest_bom_import_updated_at ? toIsoTimestamp(row.latest_bom_import_updated_at) : null,
      row.latest_usage_updated_at ? toIsoTimestamp(row.latest_usage_updated_at) : null
    ]),
    project,
    revisionCount: toNumber(row.revision_count),
    usageCount: toNumber(row.usage_count)
  };
}

/**
 * Maps a persisted project row into the shared Project type.
 */
function mapProjectRow(row: DatabaseProjectRow): Project {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    description: row.description,
    id: row.id,
    name: row.name,
    owner: row.owner,
    projectKey: row.project_key,
    status: row.status,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a persisted project revision row into the shared ProjectRevision type.
 */
function mapProjectRevisionRow(row: DatabaseProjectRevisionRow): ProjectRevision {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    id: row.id,
    projectId: row.project_id,
    releasedAt: row.released_at ? toIsoTimestamp(row.released_at) : null,
    revisionLabel: row.revision_label,
    revisionStatus: row.revision_status,
    sourceReference: row.source_reference,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a persisted BOM import row into the shared BomImport type.
 */
function mapBomImportRow(row: DatabaseBomImportRow): BomImport {
  return {
    columnMapping: toRecord(row.column_mapping),
    createdAt: toIsoTimestamp(row.created_at),
    id: row.id,
    importStatus: row.import_status,
    importSummary: toRecord(row.import_summary),
    importedBy: row.imported_by,
    projectId: row.project_id,
    projectRevisionId: row.project_revision_id,
    sourceFilename: row.source_filename,
    sourceFormat: row.source_format,
    storageKey: row.storage_key,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a persisted BOM line row into the shared BomLine type.
 */
function mapBomLineRow(row: DatabaseBomLineRow): BomLine {
  return {
    bomImportId: row.bom_import_id,
    createdAt: toIsoTimestamp(row.created_at),
    designators: toStringArray(row.designators),
    id: row.id,
    instantiatedAt: row.instantiated_at ? toIsoTimestamp(row.instantiated_at) : null,
    instantiatedFromCircuitBlockId: row.instantiated_from_circuit_block_id,
    instantiatedFromCircuitBlockPartId: row.instantiated_from_circuit_block_part_id,
    matchConfidenceScore: toNullableNumber(row.match_confidence_score),
    matchedPartId: row.matched_part_id,
    matchStatus: row.match_status,
    projectId: row.project_id,
    projectRevisionId: row.project_revision_id,
    quantity: toNullableNumber(row.quantity),
    rawDescription: row.raw_description,
    rawManufacturer: row.raw_manufacturer,
    rawMpn: row.raw_mpn,
    rawNotes: row.raw_notes,
    rawRowPayload: toRecord(row.raw_row_payload),
    rawSupplierReference: row.raw_supplier_reference,
    rowNumber: row.row_number,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a joined where-used row into usage, project, revision, and optional BOM-line context.
 */
function mapPartWhereUsedRow(row: DatabasePartWhereUsedRow): PartWhereUsedRecord {
  return {
    bomLine: mapPartWhereUsedBomLine(row),
    project: mapProjectRow({
      created_at: row.project_created_at,
      description: row.project_description,
      id: row.project_id,
      name: row.project_name,
      owner: row.project_owner,
      project_key: row.project_key,
      status: row.project_status,
      updated_at: row.project_updated_at
    }),
    projectRevision: mapProjectRevisionRow({
      created_at: row.revision_created_at,
      id: row.revision_id,
      project_id: row.revision_project_id,
      released_at: row.revision_released_at,
      revision_label: row.revision_label,
      revision_status: row.revision_status,
      source_reference: row.revision_source_reference,
      updated_at: row.revision_updated_at
    }),
    usage: mapProjectPartUsageRow({
      approval_snapshot: row.usage_approval_snapshot,
      bom_line_id: row.usage_bom_line_id,
      created_at: row.usage_created_at,
      designators: row.usage_designators,
      id: row.usage_id,
      part_id: row.usage_part_id,
      project_id: row.usage_project_id,
      project_revision_id: row.usage_project_revision_id,
      quantity: row.usage_quantity,
      readiness_snapshot: row.usage_readiness_snapshot,
      updated_at: row.usage_updated_at,
      usage_context: row.usage_context,
      usage_status: row.usage_status
    })
  };
}

/**
 * Maps optional joined BOM-line evidence while failing loudly on inconsistent joined rows.
 */
function mapPartWhereUsedBomLine(row: DatabasePartWhereUsedRow): BomLine | null {
  if (!row.line_id) {
    return null;
  }

  if (
    !row.line_bom_import_id ||
    !row.line_project_id ||
    !row.line_project_revision_id ||
    row.line_row_number === null ||
    !row.line_match_status ||
    row.line_created_at === null ||
    row.line_updated_at === null
  ) {
    throw new CatalogStoreError("query_failed", "Part where-used BOM line join returned an incomplete row.", new Error("incomplete_where_used_bom_line"));
  }

  return mapBomLineRow({
    bom_import_id: row.line_bom_import_id,
    created_at: row.line_created_at,
    designators: row.line_designators,
    id: row.line_id,
    match_confidence_score: row.line_match_confidence_score,
    match_status: row.line_match_status,
    matched_part_id: row.line_matched_part_id,
    project_id: row.line_project_id,
    project_revision_id: row.line_project_revision_id,
    quantity: row.line_quantity,
    raw_description: row.line_raw_description,
    raw_manufacturer: row.line_raw_manufacturer,
    raw_mpn: row.line_raw_mpn,
    raw_notes: row.line_raw_notes,
    raw_row_payload: row.line_raw_row_payload,
    raw_supplier_reference: row.line_raw_supplier_reference,
    row_number: row.line_row_number,
    instantiated_from_circuit_block_id: null,
    instantiated_from_circuit_block_part_id: null,
    instantiated_at: null,
    updated_at: row.line_updated_at
  });
}

/**
 * Maps a persisted usage row into the shared ProjectPartUsage type.
 */
function mapProjectPartUsageRow(row: DatabaseProjectPartUsageRow): ProjectPartUsage {
  return {
    approvalSnapshot: toRecord(row.approval_snapshot),
    bomLineId: row.bom_line_id,
    createdAt: toIsoTimestamp(row.created_at),
    designators: toStringArray(row.designators),
    id: row.id,
    ...(row.manufacturer_name !== undefined ? { manufacturerName: row.manufacturer_name } : {}),
    partId: row.part_id,
    ...(row.part_mpn !== undefined ? { partMpn: row.part_mpn } : {}),
    projectId: row.project_id,
    projectRevisionId: row.project_revision_id,
    quantity: toNullableNumber(row.quantity),
    readinessSnapshot: toRecord(row.readiness_snapshot),
    updatedAt: toIsoTimestamp(row.updated_at),
    usageContext: row.usage_context,
    usageStatus: row.usage_status
  };
}

/**
 * Maps a persisted evidence metadata row into the shared EvidenceAttachment type.
 */
function mapEvidenceAttachmentRow(row: DatabaseEvidenceAttachmentRow): EvidenceAttachment {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    evidenceType: row.evidence_type,
    fileHash: row.file_hash,
    id: row.id,
    mimeType: row.mime_type,
    notes: row.notes,
    provenance: row.provenance,
    reviewStatus: row.review_status,
    sourceUrl: row.source_url,
    storageKey: row.storage_key,
    targetId: row.target_id,
    targetType: row.target_type,
    title: row.title,
    updatedAt: toIsoTimestamp(row.updated_at),
    uploadedBy: row.uploaded_by
  };
}

/**
 * Maps a persisted follow-up row into the shared queue contract.
 */
function mapFollowUpRecordRow(row: DatabaseFollowUpRecordRow): FollowUpRecord {
  return {
    assignedTo: row.assigned_to,
    createdAt: toIsoTimestamp(row.created_at),
    detail: row.detail,
    evidenceAttachmentIds: toStringArray(row.evidence_attachment_ids),
    id: row.id,
    nextAction: row.next_action,
    resolutionNotes: row.resolution_notes,
    resolvedAt: row.resolved_at ? toIsoTimestamp(row.resolved_at) : null,
    severity: row.severity,
    sourceFindingId: row.source_finding_id,
    sourceInputs: toStringArray(row.source_inputs),
    sourceType: row.source_type,
    status: row.status,
    targetId: row.target_id,
    targetType: row.target_type,
    title: row.title,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a circuit block row into the shared structured-memory type.
 */
function mapCircuitBlockRow(row: DatabaseCircuitBlockRow): CircuitBlock {
  return {
    blockKey: row.block_key,
    blockType: row.block_type,
    constraints: toRecord(row.constraints),
    createdAt: toIsoTimestamp(row.created_at),
    description: row.description,
    id: row.id,
    name: row.name,
    owner: row.owner,
    reuseScope: row.reuse_scope,
    status: row.status,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps one circuit block summary row into explainable list counts.
 */
function mapCircuitBlockSummaryRow(row: DatabaseCircuitBlockSummaryRow): CircuitBlockSummary {
  return {
    activeBlockingRiskCount: toNumber(row.active_blocking_risk_count),
    activeKnownRiskCount: toNumber(row.active_known_risk_count),
    approvedPartCount: toNumber(row.approved_part_count),
    circuitBlock: mapCircuitBlockRow(row),
    evidenceAttachmentCount: toNumber(row.evidence_attachment_count),
    lifecycleRiskCount: toNumber(row.lifecycle_risk_count),
    optionalPartCount: toNumber(row.optional_part_count),
    projectUsageCount: toNumber(row.project_usage_count),
    readinessGapCount: toNumber(row.readiness_gap_count),
    requiredPartCount: toNumber(row.required_part_count),
    strictSubstitutionCount: toNumber(row.strict_substitution_count),
    totalPartCount: toNumber(row.total_part_count)
  };
}

/**
 * Maps one circuit block part role into the shared type.
 */
function mapCircuitBlockPartRow(row: DatabaseCircuitBlockPartRow): CircuitBlockPart {
  return {
    circuitBlockId: row.circuit_block_id,
    createdAt: toIsoTimestamp(row.created_at),
    id: row.id,
    isRequired: row.is_required,
    notes: row.notes,
    partId: row.part_id,
    quantity: toNullableNumber(row.quantity),
    role: row.role,
    substitutionPolicy: row.substitution_policy,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Maps a circuit block part detail row while preserving linked-part readiness truth.
 */
function mapCircuitBlockPartDetailRow(row: DatabaseCircuitBlockPartDetailRow): CircuitBlockPartRecord {
  return {
    blockPart: mapCircuitBlockPartRow(row),
    part: {
      approvalStatus: row.approval_status,
      blockerCount: row.blocker_count === null ? null : toNumber(row.blocker_count),
      connectorClass: row.connector_class,
      lifecycleStatus: row.lifecycle_status,
      manufacturerName: row.manufacturer_name,
      mpn: row.mpn,
      partId: row.part_id,
      readinessStatus: row.readiness_status
    }
  };
}

/**
 * Maps a compact part summary for global where-used search results.
 */
function mapWhereUsedPartSummaryRow(row: DatabaseWhereUsedPartSummaryRow): CircuitBlockPartCatalogSummary {
  return {
    approvalStatus: row.approval_status,
    blockerCount: row.blocker_count === null ? null : toNumber(row.blocker_count),
    connectorClass: row.connector_class,
    lifecycleStatus: row.lifecycle_status,
    manufacturerName: row.manufacturer_name,
    mpn: row.mpn,
    partId: row.part_id,
    readinessStatus: row.readiness_status
  };
}

/**
 * Maps one circuit block dependency row into the global where-used contract.
 */
function mapWhereUsedCircuitBlockDependencyRow(row: DatabaseWhereUsedCircuitBlockDependencyRow): WhereUsedCircuitBlockDependencyRecord {
  return {
    blockPart: mapCircuitBlockPartRow(row),
    circuitBlock: mapCircuitBlockRow({
      block_key: row.block_key,
      block_type: row.block_type,
      constraints: row.block_constraints,
      created_at: row.block_created_at,
      description: row.block_description,
      id: row.block_id,
      name: row.block_name,
      owner: row.block_owner,
      reuse_scope: row.block_reuse_scope,
      status: row.block_status,
      updated_at: row.block_updated_at
    }),
    part: mapWhereUsedPartSummaryRow({
      approval_status: row.approval_status,
      blocker_count: row.blocker_count,
      connector_class: row.connector_class,
      lifecycle_status: row.lifecycle_status,
      manufacturer_name: row.manufacturer_name,
      mpn: row.mpn,
      part_id: row.part_id,
      readiness_status: row.readiness_status
    })
  };
}

/**
 * Adds part and optional circuit-role context to a confirmed project usage row.
 */
function mapWhereUsedProjectUsageRecord(record: PartWhereUsedRecord, part: CircuitBlockPartCatalogSummary, dependency: WhereUsedCircuitBlockDependencyRecord | null): WhereUsedProjectUsageRecord {
  return {
    blockPart: dependency?.blockPart ?? null,
    bomLine: record.bomLine,
    circuitBlock: dependency?.circuitBlock ?? null,
    part,
    project: record.project,
    projectRevision: record.projectRevision,
    usage: record.usage
  };
}

/**
 * Sorts global where-used project rows by project, revision recency, role, and usage id.
 */
function sortWhereUsedProjectUsages(records: WhereUsedProjectUsageRecord[]): WhereUsedProjectUsageRecord[] {
  return [...records].sort((left, right) => (
    left.project.projectKey.localeCompare(right.project.projectKey) ||
    right.projectRevision.createdAt.localeCompare(left.projectRevision.createdAt) ||
    (left.circuitBlock?.blockKey ?? "").localeCompare(right.circuitBlock?.blockKey ?? "") ||
    (left.blockPart?.role ?? "").localeCompare(right.blockPart?.role ?? "") ||
    left.usage.id.localeCompare(right.usage.id)
  ));
}

/**
 * Converts unknown Postgres/network failures into explicit project-memory store failures.
 */
function toProjectMemoryStoreError(error: unknown): CatalogStoreError {
  if (error instanceof CatalogStoreError) {
    return error;
  }

  if (isSchemaMismatchError(error)) {
    return new CatalogStoreError("schema_mismatch", "Project memory database schema does not match the API query contract.", error);
  }

  if (isDatabaseUnavailableError(error)) {
    return new CatalogStoreError("database_unavailable", "Project memory database is configured but unavailable.", error);
  }

  return new CatalogStoreError("query_failed", "Project memory database query failed.", error);
}

/**
 * Checks common Postgres SQLSTATE codes for missing tables, columns, or functions.
 */
function isSchemaMismatchError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "42P01" || code === "42703" || code === "42883";
}

/**
 * Checks common network and server SQLSTATE codes for unavailable databases.
 */
function isDatabaseUnavailableError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "57P01" || code === "57P03";
}

/**
 * Reads a Postgres or Node error code without depending on one concrete error class.
 */
function getErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/**
 * Checks whether Postgres rejected a unique project or revision key.
 */
function isUniqueViolation(error: unknown): boolean {
  return getErrorCode(error) === "23505";
}

/**
 * Normalizes project keys for stable ids and lookups.
 */
function normalizeProjectKey(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/gu, "-");
}

/**
 * Normalizes circuit block keys for stable user-facing ids.
 */
function normalizeCircuitBlockKey(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/gu, "-");
}

/**
 * Converts optional text into null when empty.
 */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}

/**
 * Normalizes global where-used target type strings while defaulting to part search.
 */
function normalizeWhereUsedTargetType(value: string | null | undefined): WhereUsedTargetType {
  if (value === "circuit_block" || value === "connector_set" || value === "asset" || value === "document" || value === "interconnect") {
    return value;
  }

  return "part";
}

/**
 * Explains target types that are visible but not yet backed by persisted where-used links.
 * All four target types are now backed, so this always returns null.
 */
function getUnsupportedWhereUsedReason(_targetType: WhereUsedTargetType): string | null {
  return null;
}

/**
 * Normalizes a BOM column mapping so blank headers do not persist as field claims.
 */
function normalizeBomColumnMapping(mapping: BomImportCreateInput["columnMapping"]): BomImportCreateInput["columnMapping"] {
  return {
    description: normalizeOptionalText(mapping.description),
    designators: normalizeOptionalText(mapping.designators),
    manufacturer: normalizeOptionalText(mapping.manufacturer),
    mpn: normalizeOptionalText(mapping.mpn),
    notes: normalizeOptionalText(mapping.notes),
    quantity: normalizeOptionalText(mapping.quantity),
    supplierReference: normalizeOptionalText(mapping.supplierReference)
  };
}

/**
 * Validates and normalizes project metadata edit input.
 */
function normalizeProjectUpdateInput(input: ProjectUpdateInput): { ok: true; input: NormalizedProjectUpdateInput } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object") {
    return {
      code: "INVALID_PROJECT_UPDATE",
      message: "Project edits require a name and valid status.",
      ok: false
    };
  }

  const name = normalizeOptionalText(input.name);
  const description = normalizeOptionalText(input.description) ?? "";
  const owner = normalizeOptionalText(input.owner);

  if (!name || !isProjectStatus(input.status)) {
    return {
      code: "INVALID_PROJECT_UPDATE",
      message: "Project edits require a non-empty name and supported status.",
      ok: false
    };
  }

  return {
    input: {
      description,
      name,
      owner,
      status: input.status
    },
    ok: true
  };
}

/**
 * Validates and normalizes project revision edit input.
 */
function normalizeProjectRevisionUpdateInput(input: ProjectRevisionUpdateInput): { ok: true; input: NormalizedProjectRevisionUpdateInput } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object" || !isProjectRevisionStatus(input.revisionStatus)) {
    return {
      code: "INVALID_PROJECT_REVISION_UPDATE",
      message: "Project revision edits require a supported revision status.",
      ok: false
    };
  }

  const releasedAt = normalizeReleasedAt(input.releasedAt);

  if (releasedAt === "invalid") {
    return {
      code: "INVALID_PROJECT_REVISION_RELEASED_AT",
      message: "Released-at must be a valid ISO timestamp when provided.",
      ok: false
    };
  }

  return {
    input: {
      releasedAt,
      revisionStatus: input.revisionStatus,
      sourceReference: normalizeOptionalText(input.sourceReference)
    },
    ok: true
  };
}

/**
 * Validates and normalizes circuit block creation input.
 */
function normalizeCircuitBlockCreateInput(input: CircuitBlockCreateInput): { ok: true; input: NormalizedCircuitBlockCreateInput } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object") {
    return {
      code: "INVALID_CIRCUIT_BLOCK",
      message: "Circuit blocks require a block key, name, and supported block type.",
      ok: false
    };
  }

  const blockKey = normalizeCircuitBlockKey(input.blockKey);
  const name = normalizeOptionalText(input.name);
  const description = normalizeOptionalText(input.description) ?? "";
  const owner = normalizeOptionalText(input.owner);
  const reuseScope = normalizeOptionalText(input.reuseScope) ?? "";
  const status = input.status ?? "draft";
  const constraints = input.constraints && typeof input.constraints === "object" && !Array.isArray(input.constraints) ? input.constraints : {};

  if (!blockKey || !name || !isCircuitBlockType(input.blockType) || !isCircuitBlockStatus(status)) {
    return {
      code: "INVALID_CIRCUIT_BLOCK",
      message: "Circuit blocks require a block key, name, supported type, and valid status.",
      ok: false
    };
  }

  return {
    input: {
      blockKey,
      blockType: input.blockType,
      constraints,
      description,
      name,
      owner,
      reuseScope,
      status
    },
    ok: true
  };
}

/**
 * Validates and normalizes circuit block metadata edit input.
 */
function normalizeCircuitBlockUpdateInput(input: CircuitBlockUpdateInput): { ok: true; input: NormalizedCircuitBlockUpdateInput } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object") {
    return {
      code: "INVALID_CIRCUIT_BLOCK_UPDATE",
      message: "Circuit block edits require a name, supported type, and valid status.",
      ok: false
    };
  }

  const name = normalizeOptionalText(input.name);
  const description = normalizeOptionalText(input.description) ?? "";
  const owner = normalizeOptionalText(input.owner);
  const reuseScope = normalizeOptionalText(input.reuseScope) ?? "";
  const constraints = input.constraints && typeof input.constraints === "object" && !Array.isArray(input.constraints) ? input.constraints : {};

  if (!name || !isCircuitBlockType(input.blockType) || !isCircuitBlockStatus(input.status)) {
    return {
      code: "INVALID_CIRCUIT_BLOCK_UPDATE",
      message: "Circuit block edits require a non-empty name, supported type, and valid status.",
      ok: false
    };
  }

  return {
    input: {
      blockType: input.blockType,
      constraints,
      description,
      name,
      owner,
      reuseScope,
      status: input.status
    },
    ok: true
  };
}

/**
 * Validates and normalizes one circuit block part role input.
 */
function normalizeCircuitBlockPartCreateInput(input: CircuitBlockPartCreateInput): { ok: true; input: NormalizedCircuitBlockPartCreateInput } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object") {
    return {
      code: "INVALID_CIRCUIT_BLOCK_PART",
      message: "Circuit block parts require a part id and role.",
      ok: false
    };
  }

  const partId = normalizeOptionalText(input.partId);
  const role = normalizeOptionalText(input.role);
  const quantity = input.quantity === undefined ? null : input.quantity;
  const substitutionPolicy = input.substitutionPolicy ?? "exact_required";

  if (!partId || !role || (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) || !isCircuitBlockPartSubstitutionPolicy(substitutionPolicy)) {
    return {
      code: "INVALID_CIRCUIT_BLOCK_PART",
      message: "Circuit block parts require a part id, role, optional positive quantity, and valid substitution policy.",
      ok: false
    };
  }

  return {
    input: {
      isRequired: input.isRequired ?? true,
      notes: normalizeOptionalText(input.notes),
      partId,
      quantity,
      role,
      substitutionPolicy
    },
    ok: true
  };
}

/**
 * Validates and normalizes circuit block part-role edit input.
 */
function normalizeCircuitBlockPartUpdateInput(input: CircuitBlockPartUpdateInput): { ok: true; input: NormalizedCircuitBlockPartUpdateInput } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object") {
    return {
      code: "INVALID_CIRCUIT_BLOCK_PART_UPDATE",
      message: "Circuit block part edits require requirement, quantity, and substitution metadata.",
      ok: false
    };
  }

  const quantity = input.quantity === undefined ? null : input.quantity;

  if (typeof input.isRequired !== "boolean" || (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) || !isCircuitBlockPartSubstitutionPolicy(input.substitutionPolicy)) {
    return {
      code: "INVALID_CIRCUIT_BLOCK_PART_UPDATE",
      message: "Circuit block part edits require a boolean requirement flag, optional positive quantity, and valid substitution policy.",
      ok: false
    };
  }

  return {
    input: {
      isRequired: input.isRequired,
      notes: normalizeOptionalText(input.notes),
      quantity,
      substitutionPolicy: input.substitutionPolicy
    },
    ok: true
  };
}

/**
 * Validates and normalizes evidence attachment metadata before database writes.
 */
function normalizeEvidenceAttachmentInput(input: EvidenceAttachmentCreateInput): { ok: true; input: Required<EvidenceAttachmentCreateInput> } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object" || !isEvidenceTargetType(input.targetType) || !isEvidenceAttachmentType(input.evidenceType)) {
    return {
      code: "INVALID_EVIDENCE_ATTACHMENT",
      message: "Evidence attachments require a supported targetType and evidenceType.",
      ok: false
    };
  }

  const targetId = normalizeOptionalText(input.targetId);
  const title = normalizeOptionalText(input.title);
  const sourceUrl = normalizeOptionalText(input.sourceUrl);
  const storageKey = normalizeOptionalText(input.storageKey);
  const fileHash = normalizeOptionalText(input.fileHash);
  const mimeType = normalizeOptionalText(input.mimeType);
  const notes = normalizeOptionalText(input.notes);
  const provenance = normalizeOptionalText(input.provenance) ?? "manual_internal";
  const reviewStatus = input.reviewStatus ?? "unreviewed";

  if (!targetId || !title || !isEvidenceReviewStatus(reviewStatus)) {
    return {
      code: "INVALID_EVIDENCE_ATTACHMENT",
      message: "Evidence attachments require a target id, title, and valid review status.",
      ok: false
    };
  }

  if (input.evidenceType === "link" && !sourceUrl) {
    return {
      code: "EVIDENCE_LINK_REQUIRED",
      message: "Link evidence requires a sourceUrl.",
      ok: false
    };
  }

  if (input.evidenceType === "file" && !storageKey) {
    return {
      code: "EVIDENCE_FILE_REQUIRED",
      message: "File evidence requires a storageKey.",
      ok: false
    };
  }

  if (input.evidenceType === "note" && !notes) {
    return {
      code: "EVIDENCE_NOTE_REQUIRED",
      message: "Note evidence requires notes.",
      ok: false
    };
  }

  return {
    input: {
      evidenceType: input.evidenceType,
      fileHash,
      mimeType,
      notes,
      provenance,
      reviewStatus,
      sourceUrl,
      storageKey,
      targetId,
      targetType: input.targetType,
      title
    },
    ok: true
  };
}

/**
 * Normalizes evidence-vault filters without turning bad query params into SQL predicates.
 */
function normalizeEvidenceAttachmentListFilters(filters: EvidenceAttachmentListFilters): EvidenceAttachmentListFilters {
  return {
    evidenceType: isEvidenceAttachmentType(filters.evidenceType) ? filters.evidenceType : null,
    query: normalizeOptionalText(filters.query),
    reviewStatus: isEvidenceReviewStatus(filters.reviewStatus) ? filters.reviewStatus : null,
    sourceSystem: normalizeOptionalText(filters.sourceSystem),
    storageState: isEvidenceStorageState(filters.storageState) ? filters.storageState : null,
    targetType: isEvidenceTargetType(filters.targetType) ? filters.targetType : null
  };
}

/**
 * Summarizes visible evidence rows without converting review state into validation.
 */
function buildEvidenceAttachmentListSummary(attachments: EvidenceAttachment[]): EvidenceAttachmentListResponse["summary"] {
  return {
    acceptedCount: attachments.filter((attachment) => attachment.reviewStatus === "accepted").length,
    fileBackedCount: attachments.filter((attachment) => attachment.storageKey).length,
    linkOnlyCount: attachments.filter((attachment) => !attachment.storageKey && attachment.sourceUrl).length,
    noteOnlyCount: attachments.filter((attachment) => !attachment.storageKey && !attachment.sourceUrl && attachment.notes).length,
    rejectedCount: attachments.filter((attachment) => attachment.reviewStatus === "rejected").length,
    supersededCount: attachments.filter((attachment) => attachment.reviewStatus === "superseded").length,
    totalCount: attachments.length,
    unreviewedCount: attachments.filter((attachment) => attachment.reviewStatus === "unreviewed").length
  };
}

/**
 * Validates evidence review edits while keeping target trust untouched.
 */
function normalizeEvidenceAttachmentUpdateInput(input: EvidenceAttachmentUpdateInput): { ok: true; input: Required<EvidenceAttachmentUpdateInput> } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object" || !isEvidenceReviewStatus(input.reviewStatus) || !isOptionalBodyString(input.notes)) {
    return {
      code: "INVALID_EVIDENCE_ATTACHMENT_UPDATE",
      message: "Evidence review edits require a valid review status and optional notes.",
      ok: false
    };
  }

  return {
    input: {
      notes: normalizeOptionalText(input.notes),
      reviewStatus: input.reviewStatus
    },
    ok: true
  };
}

/**
 * Summarizes follow-up rows by workflow and severity without hiding source detail.
 */
function buildFollowUpListSummary(followUps: FollowUpRecord[]): FollowUpListResponse["summary"] {
  return {
    dangerCount: followUps.filter((followUp) => followUp.severity === "danger").length,
    dismissedCount: followUps.filter((followUp) => followUp.status === "dismissed").length,
    inProgressCount: followUps.filter((followUp) => followUp.status === "in_progress").length,
    openCount: followUps.filter((followUp) => followUp.status === "open").length,
    resolvedCount: followUps.filter((followUp) => followUp.status === "resolved").length,
    reviewCount: followUps.filter((followUp) => followUp.severity === "review").length,
    totalCount: followUps.length
  };
}

/**
 * Validates follow-up workflow edits before they reach SQL.
 */
function normalizeFollowUpUpdateInput(input: FollowUpUpdateInput): { ok: true; input: NormalizedFollowUpUpdateInput } | { ok: false; code: string; message: string } {
  if (!input || typeof input !== "object" || !isFollowUpStatus(input.status) || !isOptionalBodyString(input.assignedTo) || !isOptionalBodyString(input.resolutionNotes)) {
    return {
      code: "INVALID_FOLLOW_UP_UPDATE",
      message: "Follow-up edits require a valid status, optional assignee, and optional resolution notes.",
      ok: false
    };
  }

  const evidenceAttachmentIds = normalizeFollowUpEvidenceIds(input.evidenceAttachmentIds);

  if (evidenceAttachmentIds === "invalid") {
    return {
      code: "INVALID_FOLLOW_UP_EVIDENCE",
      message: "Related evidence ids must be strings when provided.",
      ok: false
    };
  }

  return {
    input: {
      assignedTo: normalizeOptionalText(input.assignedTo),
      evidenceAttachmentIds,
      resolutionNotes: normalizeOptionalText(input.resolutionNotes),
      status: input.status
    },
    ok: true
  };
}

/**
 * Normalizes optional follow-up evidence ids, preserving undefined as "no edit".
 */
function normalizeFollowUpEvidenceIds(value: string[] | null | undefined): string[] | undefined | "invalid" {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return "invalid";
  }

  return uniqueStrings(value.map((item) => item.trim()));
}

/**
 * Checks evidence target type values without accepting arbitrary table names.
 */
function isEvidenceTargetType(value: unknown): value is EvidenceTargetType {
  return value === "part" ||
    value === "asset" ||
    value === "project" ||
    value === "bom_import" ||
    value === "bom_line" ||
    value === "project_part_usage" ||
    value === "risk_finding" ||
    value === "circuit_block" ||
    value === "circuit_block_part";
}

/**
 * Checks project lifecycle status values before writing request data.
 */
function isProjectStatus(value: unknown): value is Project["status"] {
  return value === "active" || value === "archived" || value === "prototype" || value === "production" || value === "deprecated";
}

/**
 * Checks revision lifecycle status values before writing request data.
 */
function isProjectRevisionStatus(value: unknown): value is ProjectRevisionStatus {
  return value === "draft" || value === "in_review" || value === "released" || value === "superseded" || value === "archived";
}

/**
 * Checks circuit block category values without accepting arbitrary taxonomy.
 */
function isCircuitBlockType(value: unknown): value is CircuitBlockType {
  return value === "power" || value === "mcu_support" || value === "interface" || value === "protection" || value === "connector_set" || value === "sensor_front_end" || value === "other";
}

/**
 * Checks circuit block lifecycle states without inferring part approval.
 */
function isCircuitBlockStatus(value: unknown): value is CircuitBlockStatus {
  return value === "draft" || value === "in_review" || value === "approved" || value === "restricted" || value === "deprecated";
}

/**
 * Checks role-level substitution policy values.
 */
function isCircuitBlockPartSubstitutionPolicy(value: unknown): value is CircuitBlockPartSubstitutionPolicy {
  return value === "exact_required" || value === "approved_alternate_allowed" || value === "equivalent_allowed" || value === "do_not_substitute";
}

/**
 * Checks evidence attachment type values.
 */
function isEvidenceAttachmentType(value: unknown): value is EvidenceAttachmentType {
  return value === "note" || value === "link" || value === "file";
}

/**
 * Checks evidence review state values without inferring approval from accepted evidence.
 */
function isEvidenceReviewStatus(value: unknown): value is EvidenceReviewStatus {
  return value === "unreviewed" || value === "accepted" || value === "rejected" || value === "superseded";
}

/**
 * Checks evidence storage filters without implying a stored file is exportable.
 */
function isEvidenceStorageState(value: unknown): value is EvidenceStorageState {
  return value === "file_backed" || value === "link_only" || value === "note_only";
}

/**
 * Checks follow-up workflow status values.
 */
function isFollowUpStatus(value: unknown): value is FollowUpStatus {
  return value === "open" || value === "in_progress" || value === "resolved" || value === "dismissed";
}

/**
 * Checks optional text inputs without accepting arrays or objects.
 */
function isOptionalBodyString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

/**
 * Converts optional released-at input into a Date while rejecting malformed timestamps.
 */
function normalizeReleasedAt(value: string | null | undefined): Date | null | "invalid" {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

/**
 * Builds a deterministic project id from the unique project key.
 */
function buildProjectId(projectKey: string): string {
  return `project-${slugify(projectKey)}`;
}

/**
 * Builds a deterministic project revision id within one project.
 */
function buildProjectRevisionId(projectId: string, revisionLabel: string): string {
  return `rev-${slugify(projectId)}-${slugify(revisionLabel)}`;
}

/**
 * Builds a deterministic usage id from one BOM line id.
 */
function buildProjectPartUsageId(bomLineId: string): string {
  return `usage-${slugify(bomLineId)}`;
}

/**
 * Builds a deterministic circuit block id from the block key.
 */
function buildCircuitBlockId(blockKey: string): string {
  return `cblock-${slugify(blockKey)}`;
}

/**
 * Builds a deterministic circuit block part-role id.
 */
function buildCircuitBlockPartId(circuitBlockId: string, partId: string, role: string): string {
  return `cbpart-${slugify(circuitBlockId)}-${slugify(partId)}-${slugify(role)}`;
}

/**
 * Builds a deterministic follow-up id from target and computed source identity.
 */
function buildFollowUpRecordId(seed: FollowUpSeedRecord): string {
  return `followup-${slugify(seed.targetType)}-${slugify(seed.targetId)}-${slugify(seed.sourceType)}-${slugify(seed.sourceFindingId)}`;
}

/**
 * Normalizes manufacturer names for exact case-insensitive alias matching.
 */
function normalizeManufacturerName(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Converts operator labels into stable lowercase id segments.
 */
function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "item";
}

/**
 * Converts a Postgres numeric/count value into a JavaScript number.
 */
function toNumber(value: string | number): number {
  return Number(value);
}

/**
 * Converts a nullable Postgres numeric value into a JavaScript number or null.
 */
function toNullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Converts database timestamps into ISO strings.
 */
function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Parses nullable database timestamps for comparisons without treating invalid strings as valid dates.
 */
function parseNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Converts database JSON into a plain record without trusting arbitrary payloads.
 */
function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Converts database array output into a clean string array.
 */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Returns the newest non-null timestamp from a set of ISO timestamp candidates.
 */
function latestTimestamp(values: Array<string | null>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? new Date(0).toISOString();
}

// ---------------------------------------------------------------------------
// P0-FUNC5: Export bundle store functions
// ---------------------------------------------------------------------------

/** ALTIUM_ASSET_TYPES lists the asset types included in Altium export bundles. */
const ALTIUM_ASSET_TYPES: AssetType[] = ["footprint", "symbol"];

/** SOLIDWORKS_ASSET_TYPES lists the asset types included in SolidWorks export bundles. */
const SOLIDWORKS_ASSET_TYPES: AssetType[] = ["three_d_model", "mechanical_drawing"];

/** NEUTRAL_ASSET_TYPES lists all asset types included in neutral export bundles. */
const NEUTRAL_ASSET_TYPES: AssetType[] = ["datasheet", "footprint", "symbol", "three_d_model", "mechanical_drawing"];

interface DatabaseExportBundleRow {
  id: string;
  project_id: string;
  revision_label: string | null;
  bundle_format: string;
  storage_key: string | null;
  archive_storage_key: string | null;
  manifest: unknown;
  part_count: number | string;
  included_asset_count: number | string;
  omitted_asset_count: number | string;
  warning_count: number | string;
  assembly_status: string | null;
  assembly_error: unknown;
  assembly_completed_at: Date | string | null;
  assembly_attempt_count: number | string | null;
  archive_sha256: string | null;
  manifest_sha256: string | null;
  signature_status: string | null;
  signature_algorithm: string | null;
  signature_public_key_fingerprint: string | null;
  signature_storage_key: string | null;
  signature_signed_at: Date | string | null;
  created_by: string | null;
  created_at: Date | string;
}

interface DatabaseBundleAssetRow {
  part_id: string;
  part_mpn: string;
  manufacturer_name: string;
  asset_id: string;
  asset_type: string;
  file_format: string;
  storage_key: string;
  file_hash: string | null;
  provenance: string;
}

interface DatabaseBundleOmissionRow {
  part_id: string;
  part_mpn: string;
  asset_type: string;
  omission_reason: string;
}

/**
 * Generates a manifest-first export bundle for all verified parts in a project.
 *
 * When `storage` is provided, an archive payload is also written so download links can
 * point at a concrete file. Storage write failures are surfaced as manifest warnings.
 */
export async function createExportBundleInDatabase(
  projectId: string,
  input: ExportBundleCreateInput,
  actor: string,
  storage?: FileStorageClient
): Promise<ExportBundleCreateResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const format = input.bundleFormat;

  if (!["altium", "solidworks", "neutral"].includes(format)) {
    return { status: "invalid", code: "INVALID_BUNDLE_FORMAT", message: "Bundle format must be altium, solidworks, or neutral." };
  }

  const applicableTypes = format === "altium"
    ? ALTIUM_ASSET_TYPES
    : format === "solidworks"
      ? SOLIDWORKS_ASSET_TYPES
      : NEUTRAL_ASSET_TYPES;

  const applicableTypeSql = applicableTypes.map((t) => `'${t}'`).join(", ");

  try {
    const projectCheck = await databasePool.query<{ id: string }>("SELECT id FROM projects WHERE id = $1", [projectId]);

    if (projectCheck.rowCount === 0) {
      return { status: "not_found" };
    }

    const usageFilter = input.revisionLabel
      ? "AND pr.revision_label = $2"
      : "";
    const usageParams: unknown[] = input.revisionLabel ? [projectId, input.revisionLabel] : [projectId];

    const usedPartIds = await databasePool.query<{ part_id: string }>(
      `SELECT DISTINCT ppu.part_id
         FROM project_part_usages ppu
         JOIN project_revisions pr ON pr.id = ppu.project_revision_id
         WHERE ppu.project_id = $1 ${usageFilter}`,
      usageParams
    );

    const partIds = usedPartIds.rows.map((r) => r.part_id);
    const warnings: string[] = [];

    if (partIds.length === 0) {
      warnings.push("No confirmed part usages found for this project. Add a BOM import and run matching first.");
    }

    const includedAssets: ExportBundleIncludedAsset[] = [];
    const omissions: ExportBundleOmission[] = [];

    if (partIds.length > 0) {
      const partIdPlaceholders = partIds.map((_, i) => `$${i + 1}`).join(", ");

      const verifiedRows = await databasePool.query<DatabaseBundleAssetRow>(
        `SELECT a.part_id, p.mpn AS part_mpn, m.name AS manufacturer_name,
                a.id AS asset_id, a.asset_type, a.file_format,
                a.storage_key, a.file_hash, a.provenance
           FROM assets a
           JOIN parts p ON p.id = a.part_id
           JOIN manufacturers m ON m.id = p.manufacturer_id
           WHERE a.part_id IN (${partIdPlaceholders})
             AND a.asset_type IN (${applicableTypeSql})
             AND a.export_status = 'verified_for_export'
             AND a.storage_key IS NOT NULL
           ORDER BY m.name, p.mpn, a.part_id, a.asset_type, a.id`,
        partIds
      );

      const coveredKeys = new Set(verifiedRows.rows.map((r) => `${r.part_id}:${r.asset_type}`));
      const usedBundlePaths = new Set<string>();

      for (const row of verifiedRows.rows) {
        const bundlePath = buildIncludedAssetBundlePath(row, usedBundlePaths);
        includedAssets.push({
          assetId: row.asset_id,
          assetType: row.asset_type as AssetType,
          bundlePath,
          fileFormat: row.file_format as FileFormat,
          fileHash: row.file_hash,
          manufacturerName: row.manufacturer_name,
          partId: row.part_id,
          partMpn: row.part_mpn,
          provenance: row.provenance as AssetProvenance,
          storageKey: row.storage_key
        });
      }

      const omissionRows = await databasePool.query<DatabaseBundleOmissionRow>(
        `SELECT DISTINCT ON (a.part_id, a.asset_type)
                a.part_id, p.mpn AS part_mpn, a.asset_type,
                CASE
                  WHEN a.export_status != 'verified_for_export' THEN 'not_verified_for_export'
                  WHEN a.storage_key IS NULL AND a.source_url IS NOT NULL THEN 'referenced_only'
                  WHEN a.storage_key IS NULL THEN 'no_storage_key'
                  ELSE 'missing'
                END AS omission_reason
           FROM assets a
           JOIN parts p ON p.id = a.part_id
           WHERE a.part_id IN (${partIdPlaceholders})
             AND a.asset_type IN (${applicableTypeSql})
             AND (a.export_status != 'verified_for_export' OR a.storage_key IS NULL)
           ORDER BY a.part_id, a.asset_type, a.export_status DESC`,
        partIds
      );

      for (const row of omissionRows.rows) {
        const key = `${row.part_id}:${row.asset_type}`;
        if (!coveredKeys.has(key)) {
          omissions.push({
            assetType: row.asset_type as AssetType,
            partId: row.part_id,
            partMpn: row.part_mpn,
            reason: row.omission_reason as ExportBundleOmission["reason"]
          });
        }
      }

      for (const partId of partIds) {
        for (const assetType of applicableTypes) {
          const key = `${partId}:${assetType}`;
          const hasIncluded = coveredKeys.has(key);
          const hasOmission = omissions.some((o) => o.partId === partId && o.assetType === assetType);
          if (!hasIncluded && !hasOmission) {
            const partMpn = verifiedRows.rows.find((r) => r.part_id === partId)?.part_mpn
              ?? omissionRows.rows.find((r) => r.part_id === partId)?.part_mpn
              ?? partId;
            omissions.push({
              assetType,
              partId,
              partMpn,
              reason: "missing"
            });
          }
        }
      }

      if (omissions.length > 0) {
        warnings.push(`${omissions.length} asset${omissions.length === 1 ? "" : "s"} omitted from bundle. See manifest omissions for details.`);
      }
    }

    const bundleId = `ebundle-${randomUUID()}`;
    const generatedAt = new Date().toISOString();

    const { controlledAssets, controlSummary } = await buildBundleControlContext(databasePool, includedAssets);
    const partProvenance = await buildExportBundlePartProvenance(databasePool, partIds, includedAssets);

    if (controlSummary.highestAccessLevel === "itar_controlled") {
      warnings.push(`Bundle contains ${controlSummary.itarControlledCount} ITAR-controlled asset${controlSummary.itarControlledCount === 1 ? "" : "s"}. Confirm export authorization before transmitting.`);
    } else if (controlSummary.highestAccessLevel === "restricted") {
      warnings.push(`Bundle contains ${controlSummary.restrictedCount} restricted asset${controlSummary.restrictedCount === 1 ? "" : "s"}. Confirm access controls before transmitting.`);
    }

    const manifest: ExportBundleManifest = {
      bundleFormat: format,
      bundleId,
      controlledAssets,
      controlSummary,
      generatedAt,
      includedAssets,
      omissions,
      partProvenance,
      projectId,
      revisionLabel: input.revisionLabel ?? null,
      warnings
    };

    let storageKey: string | null = null;
    if (storage) {
      const nextStorageKey = buildExportBundleStorageKey(projectId, format, generatedAt, bundleId);
      try {
        await storage.write(nextStorageKey, buildExportBundleArchiveContent(manifest));
        storageKey = nextStorageKey;
      } catch (error) {
        const detail = error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "unknown storage write failure";
        warnings.push(`Bundle archive write failed (${detail}). Manifest is still persisted for audit and regeneration.`);
      }
    }

    const assemblyStatus: ExportBundleAssemblyStatus = includedAssets.length === 0 ? "not_required" : "pending";

    const bundle: ExportBundle = {
      archiveAvailability: "manifest_only",
      archiveSha256: null,
      archiveStorageKey: null,
      assemblyAttemptCount: 0,
      assemblyCompletedAt: null,
      assemblyError: null,
      assemblyStatus,
      bundleFormat: format,
      createdAt: generatedAt,
      createdBy: actor,
      fileAvailability: storageKey ? "available" : "manifest_only",
      id: bundleId,
      includedAssetCount: includedAssets.length,
      manifest,
      manifestSha256: null,
      omittedAssetCount: omissions.length,
      partCount: partIds.length,
      projectId,
      revisionLabel: input.revisionLabel ?? null,
      signatureAlgorithm: null,
      signaturePublicKeyFingerprint: null,
      signatureSignedAt: null,
      signatureStatus: "unsigned",
      signatureStorageKey: null,
      storageKey,
      warningCount: warnings.length
    };

    await databasePool.query(
      `INSERT INTO export_bundles (id, project_id, revision_label, bundle_format, storage_key, manifest,
         part_count, included_asset_count, omitted_asset_count, warning_count, created_by, created_at,
         assembly_status, assembly_error, assembly_completed_at, assembly_attempt_count, archive_storage_key)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, NULL, NULL, 0, NULL)`,
      [
        bundleId, projectId, input.revisionLabel ?? null, format, storageKey,
        JSON.stringify(manifest), partIds.length, includedAssets.length,
        omissions.length, warnings.length, actor, new Date(generatedAt),
        assemblyStatus
      ]
    );

    // Passive capture: shipping a bundle is the team committing to a specific trusted footprint /
    // 3D model / datasheet revision. Stamp that as proposed engineering memory per included asset
    // so the defensible "what did we stand behind" provenance writes itself at export time.
    for (const includedAsset of includedAssets) {
      await autoDraftPartEngineeringRecord(databasePool, {
        datasheetRevisionId: null,
        dedupeKey: `${bundleId}:${includedAsset.assetId}`,
        detail: `${includedAsset.assetType} • provenance ${includedAsset.provenance}${includedAsset.fileHash ? ` • sha256 ${includedAsset.fileHash.slice(0, 12)}…` : ""}`,
        draftSource: "auto_export",
        partId: includedAsset.partId,
        recordKind: "cad_physical_verified",
        recordedBy: actor,
        relatedAssetId: includedAsset.assetId,
        severity: "info",
        title: `Trusted in export bundle ${bundleId}`,
        triggerRef: bundleId
      });
    }

    return { status: "created", response: { bundle } };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Export bundle creation failed.", error);
  }
}

/**
 * Resolves controlled-document context for each included bundle asset so the manifest
 * carries explicit restricted/ITAR markings. Returns an empty list and zero counts
 * when no included asset is bound to a non-archived restricted/itar_controlled
 * revision; older bundles created before this query existed default to the same
 * empty values on read via {@link readEmptyBundleControlSummary}.
 */
async function buildBundleControlContext(
  databasePool: Pool,
  includedAssets: ExportBundleIncludedAsset[]
): Promise<{ controlledAssets: ExportBundleControlledAsset[]; controlSummary: ExportBundleControlSummary }> {
  if (includedAssets.length === 0) {
    return { controlledAssets: [], controlSummary: readEmptyBundleControlSummary() };
  }

  const assetIdPlaceholders = includedAssets.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await databasePool.query<{
    asset_id: string;
    id: string;
    revision_label: string;
    document_type: DocumentControlType;
    access_level: DocumentAccessLevel;
  }>(
    `
      SELECT DISTINCT ON (asset_id)
        asset_id,
        id,
        revision_label,
        document_type,
        access_level
      FROM document_revisions
      WHERE asset_id IN (${assetIdPlaceholders})
        AND lifecycle_status != 'archived'
        AND access_level IN ('restricted', 'itar_controlled')
      ORDER BY
        asset_id,
        CASE access_level WHEN 'itar_controlled' THEN 1 WHEN 'restricted' THEN 2 ELSE 3 END,
        updated_at DESC
    `,
    includedAssets.map((asset) => asset.assetId)
  );

  const includedByAssetId = new Map(includedAssets.map((asset) => [asset.assetId, asset]));
  const controlledAssets: ExportBundleControlledAsset[] = [];
  let restrictedCount = 0;
  let itarControlledCount = 0;

  for (const row of rows.rows) {
    const included = includedByAssetId.get(row.asset_id);
    if (!included) continue;

    controlledAssets.push({
      accessLevel: row.access_level,
      assetId: row.asset_id,
      documentRevisionId: row.id,
      documentType: row.document_type,
      partId: included.partId,
      partMpn: included.partMpn,
      revisionLabel: row.revision_label
    });

    if (row.access_level === "itar_controlled") {
      itarControlledCount += 1;
    } else if (row.access_level === "restricted") {
      restrictedCount += 1;
    }
  }

  const highestAccessLevel: DocumentAccessLevel | null =
    itarControlledCount > 0 ? "itar_controlled" : restrictedCount > 0 ? "restricted" : null;

  return {
    controlledAssets,
    controlSummary: {
      highestAccessLevel,
      itarControlledCount,
      restrictedCount
    }
  };
}

/**
 * Returns the all-zero control summary for bundles created before controlled-asset
 * tracking existed. Reads default to this shape so older manifests stay valid.
 */
function readEmptyBundleControlSummary(): ExportBundleControlSummary {
  return { highestAccessLevel: null, itarControlledCount: 0, restrictedCount: 0 };
}

/**
 * Builds the defensible per-part provenance embedded in the signed manifest: who approved the
 * part and when, the datasheet revision designed from, the verified file-backed assets the team
 * stood behind, and the confirmed engineering memory around it.
 *
 * Determinism matters: the manifest is serialized into the signed, hashed archive, so every
 * collection is ordered (parts and trusted assets sorted by stable keys, memory ordered in SQL)
 * to keep bundle bytes reproducible. The confirmed-memory read is best-effort — an absent table
 * or query failure yields no memory rather than failing bundle generation.
 */
async function buildExportBundlePartProvenance(
  databasePool: Pool,
  partIds: string[],
  includedAssets: ExportBundleIncludedAsset[]
): Promise<ExportBundlePartProvenance[]> {
  try {
    return await buildExportBundlePartProvenanceFromTables(databasePool, partIds, includedAssets);
  } catch {
    // Best-effort: provenance enriches the signed manifest but must never fail bundle
    // generation (e.g. an optional table absent in a partial deployment). Degrade to empty.
    return [];
  }
}

/**
 * Inner provenance builder. Throws if a source table is unavailable; the resilient wrapper
 * {@link buildExportBundlePartProvenance} degrades that to an empty provenance list.
 */
async function buildExportBundlePartProvenanceFromTables(
  databasePool: Pool,
  partIds: string[],
  includedAssets: ExportBundleIncludedAsset[]
): Promise<ExportBundlePartProvenance[]> {
  if (partIds.length === 0) {
    return [];
  }

  const orderedPartIds = [...new Set(partIds)].sort((first, second) => first.localeCompare(second));
  const placeholders = orderedPartIds.map((_, index) => `$${index + 1}`).join(", ");

  const identityRows = await databasePool.query<{ id: string; mpn: string; manufacturer_name: string }>(
    `SELECT p.id AS id, p.mpn AS mpn, m.name AS manufacturer_name
       FROM parts p
       JOIN manufacturers m ON m.id = p.manufacturer_id
       WHERE p.id IN (${placeholders})`,
    orderedPartIds
  );
  const identityByPart = new Map(identityRows.rows.map((row) => [row.id, row]));

  const approvalRows = await databasePool.query<{
    part_id: string;
    approval_status: PartApprovalStatus;
    summary: string;
    decided_by: string | null;
    decided_at: Date | string | null;
  }>(
    `SELECT part_id, approval_status, summary, decided_by, decided_at
       FROM part_approvals
       WHERE part_id IN (${placeholders})`,
    orderedPartIds
  );
  const approvalByPart = new Map(approvalRows.rows.map((row) => [row.part_id, row]));

  const datasheetRows = await databasePool.query<{
    part_id: string;
    id: string;
    revision_label: string | null;
    revision_date: Date | string | null;
  }>(
    `SELECT DISTINCT ON (part_id) part_id, id, revision_label, revision_date
       FROM datasheet_revisions
       WHERE part_id IN (${placeholders})
       ORDER BY part_id, revision_date DESC, id DESC`,
    orderedPartIds
  );
  const datasheetByPart = new Map(datasheetRows.rows.map((row) => [row.part_id, row]));

  const memoryByPart = new Map<string, ExportBundleProvenanceMemoryRecord[]>();
  try {
    const memoryRows = await databasePool.query<{
      part_id: string;
      id: string;
      record_kind: string;
      severity: string;
      outcome: string | null;
      title: string;
      recorded_by: string | null;
      recorded_at: Date | string;
    }>(
      `SELECT part_id, id, record_kind, severity, outcome, title, recorded_by, recorded_at
         FROM part_engineering_records
         WHERE part_id IN (${placeholders})
           AND draft_status = 'confirmed'
           AND resolved_at IS NULL
         ORDER BY part_id, recorded_at DESC, id ASC`,
      orderedPartIds
    );

    for (const row of memoryRows.rows) {
      const list = memoryByPart.get(row.part_id) ?? [];
      list.push({
        outcome: (row.outcome as PartEngineeringRecordOutcome | null) ?? null,
        recordedAt: toIsoTimestamp(row.recorded_at),
        recordedBy: row.recorded_by,
        recordId: row.id,
        recordKind: row.record_kind as PartEngineeringRecordKind,
        severity: row.severity as PartEngineeringRecordSeverity,
        title: row.title
      });
      memoryByPart.set(row.part_id, list);
    }
  } catch {
    // Best-effort: confirmed-memory provenance is omitted, not fatal, if unavailable.
  }

  const trustedAssetsByPart = new Map<string, ExportBundleProvenanceTrustedAsset[]>();
  for (const asset of includedAssets) {
    const list = trustedAssetsByPart.get(asset.partId) ?? [];
    list.push({
      assetId: asset.assetId,
      assetType: asset.assetType,
      fileFormat: asset.fileFormat,
      fileHash: asset.fileHash,
      provenance: asset.provenance
    });
    trustedAssetsByPart.set(asset.partId, list);
  }

  return orderedPartIds.map((partId) => {
    const identity = identityByPart.get(partId);
    const approval = approvalByPart.get(partId);
    const datasheet = datasheetByPart.get(partId);
    const trustedAssets = (trustedAssetsByPart.get(partId) ?? []).sort(
      (first, second) => first.assetType.localeCompare(second.assetType) || first.assetId.localeCompare(second.assetId)
    );

    return {
      approval: approval
        ? {
            decidedAt: approval.decided_at ? toIsoTimestamp(approval.decided_at) : null,
            decidedBy: approval.decided_by,
            status: approval.approval_status,
            summary: approval.summary
          }
        : null,
      confirmedEngineeringMemory: memoryByPart.get(partId) ?? [],
      datasheetRevision: datasheet
        ? {
            datasheetRevisionId: datasheet.id,
            revisionDate: datasheet.revision_date ? toIsoTimestamp(datasheet.revision_date) : null,
            revisionLabel: datasheet.revision_label
          }
        : null,
      manufacturerName: identity?.manufacturer_name ?? "Unknown manufacturer",
      partId,
      partMpn: identity?.mpn ?? partId,
      trustedAssets
    } satisfies ExportBundlePartProvenance;
  });
}

/**
 * Normalizes a manifest read from storage so optional controlled-asset fields exist
 * even on older bundles. Keeps read paths unconditional and lets readers iterate
 * `controlledAssets` without nil-checks.
 */
function normalizeManifestForRead(manifest: ExportBundleManifest): ExportBundleManifest {
  if (manifest.controlledAssets && manifest.controlSummary && manifest.partProvenance) {
    return manifest;
  }
  return {
    ...manifest,
    controlledAssets: manifest.controlledAssets ?? [],
    controlSummary: manifest.controlSummary ?? readEmptyBundleControlSummary(),
    partProvenance: manifest.partProvenance ?? []
  };
}

/**
 * Builds a deterministic storage key for one generated export bundle archive.
 */
function buildExportBundleStorageKey(
  projectId: string,
  format: ExportBundleFormat,
  generatedAtIso: string,
  bundleId: string
): string {
  const timestamp = generatedAtIso.replace(/[-:.TZ]/gu, "");
  return `export-bundles/${projectId}/${timestamp}-${format}-${bundleId}.json`;
}

/**
 * Builds a stable archive path for one included asset without trusting provider/BOM text as path
 * syntax. Manufacturer/MPN keep the extracted bundle readable; short deterministic IDs prevent
 * second-source parts or duplicate verified assets from overwriting each other.
 */
function buildIncludedAssetBundlePath(row: DatabaseBundleAssetRow, usedBundlePaths: Set<string>): string {
  const manufacturer = sanitizeBundlePathSegment(row.manufacturer_name, "mfg", 14);
  const mpn = sanitizeBundlePathSegment(row.part_mpn, "part", 24);
  const partSuffix = shortBundlePathHash(row.part_id);
  const assetSuffix = shortBundlePathHash(row.asset_id);
  const assetType = sanitizeBundlePathSegment(row.asset_type, "asset", 18);
  const extension = extractBundleFileExtension(row.storage_key, row.file_format);
  const directory = `${manufacturer}-${mpn}-${partSuffix}`;
  const baseName = `${assetType}-${assetSuffix}`;
  let candidate = `${directory}/${baseName}.${extension}`;
  let collisionIndex = 2;

  while (usedBundlePaths.has(candidate)) {
    candidate = `${directory}/${baseName}-${collisionIndex}.${extension}`;
    collisionIndex += 1;
  }

  usedBundlePaths.add(candidate);
  return candidate;
}

/**
 * Restricts archive path text to a simple ASCII segment so extracted bundles cannot contain
 * absolute paths, parent-directory segments, or platform-specific separators.
 */
function sanitizeBundlePathSegment(value: string | null | undefined, fallback: string, maxLength: number): string {
  const sanitized = (value ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, maxLength)
    .replace(/-$/u, "");

  return sanitized.length > 0 ? sanitized : fallback;
}

/**
 * Uses the stored filename extension when available, falling back to file_format. Both values are
 * normalized because storage keys can come from imported metadata.
 */
function extractBundleFileExtension(storageKey: string, fileFormat: string): string {
  const filename = storageKey.split(/[\\/]/u).pop() ?? "";
  const dotIndex = filename.lastIndexOf(".");
  const rawExtension = dotIndex >= 0 ? filename.slice(dotIndex + 1) : fileFormat;
  return sanitizeBundlePathSegment(rawExtension, "bin", 10).toLowerCase();
}

/** Builds the short deterministic suffix used to disambiguate bundle archive paths. */
function shortBundlePathHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Serializes a deterministic manifest archive payload for storage.
 */
function buildExportBundleArchiveContent(manifest: ExportBundleManifest): Buffer {
  const includedAssets = [...manifest.includedAssets].sort((left, right) =>
    left.bundlePath.localeCompare(right.bundlePath)
    || left.assetId.localeCompare(right.assetId)
  );
  const omissions = [...manifest.omissions].sort((left, right) =>
    left.partMpn.localeCompare(right.partMpn)
    || left.assetType.localeCompare(right.assetType)
    || left.reason.localeCompare(right.reason)
  );
  const payload = {
    bundleId: manifest.bundleId,
    bundleFormat: manifest.bundleFormat,
    generatedAt: manifest.generatedAt,
    includedAssets,
    omissions,
    projectId: manifest.projectId,
    revisionLabel: manifest.revisionLabel,
    warnings: [...manifest.warnings]
  };

  return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Reads all export bundles for one project.
 *
 * `storage` is optional; when provided, each bundle's `fileAvailability` is computed by
 * checking whether the storage backend can still find the file. When omitted, all bundles
 * fall back to `manifest_only` (the manifest still survives storage loss) so the UI never
 * advertises a download link for a file the API cannot serve.
 */
export async function readExportBundlesFromDatabase(
  projectId: string,
  storage?: FileStorageClient
): Promise<ExportBundleListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const projectCheck = await databasePool.query<{ id: string }>("SELECT id FROM projects WHERE id = $1", [projectId]);

    if (projectCheck.rowCount === 0) {
      return { status: "not_found" };
    }

    const rows = await databasePool.query<DatabaseExportBundleRow>(
      `SELECT id, project_id, revision_label, bundle_format, storage_key, archive_storage_key, manifest,
              part_count, included_asset_count, omitted_asset_count, warning_count,
              assembly_status, assembly_error, assembly_completed_at, assembly_attempt_count,
              archive_sha256, manifest_sha256, signature_status, signature_algorithm,
              signature_public_key_fingerprint, signature_storage_key, signature_signed_at,
              created_by, created_at
         FROM export_bundles
         WHERE project_id = $1
         ORDER BY created_at DESC`,
      [projectId]
    );

    const bundles: ExportBundle[] = await Promise.all(
      rows.rows.map(async (row) => {
        const [fileAvailability, archiveAvailability] = await Promise.all([
          resolveExportBundleFileAvailability(row.storage_key, storage),
          resolveExportBundleFileAvailability(row.archive_storage_key, storage)
        ]);
        return mapExportBundleRow(row, fileAvailability, archiveAvailability);
      })
    );

    return { status: "available", response: { bundles, projectId } };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Export bundle list read failed.", error);
  }
}

/**
 * Resolves the honest file-availability state for one bundle row given the storage backend.
 *
 * - `null` storage_key → `manifest_only` (no file write was attempted).
 * - storage_key present + no storage client passed → `manifest_only` (we cannot prove
 *   the file is reachable, so we refuse to advertise a download link).
 * - storage_key present + storage reports the file exists → `available`.
 * - storage_key present + storage reports the file is missing → `file_missing`.
 *
 * Exported for direct unit testing; production callers reach it through
 * {@link readExportBundlesFromDatabase}.
 */
export async function resolveExportBundleFileAvailability(
  storageKey: string | null,
  storage: FileStorageClient | undefined
): Promise<ExportBundleFileAvailability> {
  if (!storageKey) {
    return "manifest_only";
  }

  if (!storage) {
    return "manifest_only";
  }

  try {
    return (await storage.exists(storageKey)) ? "available" : "file_missing";
  } catch {
    return "file_missing";
  }
}

/**
 * Maps one export bundle database row into the shared contract.
 */
function mapExportBundleRow(
  row: DatabaseExportBundleRow,
  fileAvailability: ExportBundleFileAvailability,
  archiveAvailability: ExportBundleFileAvailability
): ExportBundle {
  return {
    archiveAvailability,
    archiveSha256: row.archive_sha256,
    archiveStorageKey: row.archive_storage_key,
    assemblyAttemptCount: toNumber(row.assembly_attempt_count ?? 0),
    assemblyCompletedAt: row.assembly_completed_at ? toIsoTimestamp(row.assembly_completed_at) : null,
    assemblyError: parseExportBundleAssemblyError(row.assembly_error),
    assemblyStatus: normalizeExportBundleAssemblyStatus(row.assembly_status),
    bundleFormat: row.bundle_format as ExportBundleFormat,
    createdAt: toIsoTimestamp(row.created_at),
    createdBy: row.created_by,
    fileAvailability,
    id: row.id,
    includedAssetCount: toNumber(row.included_asset_count),
    manifest: normalizeManifestForRead(row.manifest as ExportBundleManifest),
    manifestSha256: row.manifest_sha256,
    omittedAssetCount: toNumber(row.omitted_asset_count),
    partCount: toNumber(row.part_count),
    projectId: row.project_id,
    revisionLabel: row.revision_label,
    signatureAlgorithm: row.signature_algorithm,
    signaturePublicKeyFingerprint: row.signature_public_key_fingerprint,
    signatureSignedAt: row.signature_signed_at ? toIsoTimestamp(row.signature_signed_at) : null,
    signatureStatus: normalizeExportBundleSignatureStatus(row.signature_status),
    signatureStorageKey: row.signature_storage_key,
    storageKey: row.storage_key,
    warningCount: toNumber(row.warning_count)
  };
}

/**
 * Normalizes a raw DB string into the typed signature status, defaulting to `unsigned` for
 * legacy rows persisted before migration 039. Honesty discipline: an unrecognized value falls
 * back to `unsigned` rather than being treated as `signed`, so a corrupted column never causes
 * the UI to claim verification that has not happened.
 */
function normalizeExportBundleSignatureStatus(raw: string | null): ExportBundleSignatureStatus {
  if (raw === "signed" || raw === "verification_failed" || raw === "unsigned") {
    return raw;
  }

  return "unsigned";
}

/**
 * ExportBundleVerifyReadResult is the read-side envelope for the on-demand verification
 * endpoint. Mirrors the rest of the project-memory store's three-state read pattern
 * (`available` / `not_found` / `not_configured`) so the HTTP handler can map outcomes to
 * status codes without duplicating the dispatch table.
 */
export type ExportBundleVerifyReadResult =
  | { status: "available"; response: ExportBundleVerifyResponse }
  | { status: "not_found" }
  | { status: "not_configured" };

/**
 * Re-verifies one assembled bundle against its persisted hashes and signature, then writes the
 * (possibly updated) signature_status back to the database. The verify helper itself lives in
 * `@ee-library/worker/export-bundle-verification` so the worker batch process and the API
 * route share identical algorithm semantics -- one bug-fix, two consumers.
 *
 * Honesty discipline:
 *   - A bundle that was previously `signed` but whose archive bytes changed transitions to
 *     `verification_failed` (with a structured reason). It does NOT silently fall back to
 *     `unsigned` -- silently downgrading would let a tampered bundle stop reporting as failed.
 *   - A bundle that was never signed stays `unsigned`. The verifier never invents a verification
 *     it did not perform.
 *   - The recomputed archive hash is returned even when verification fails so the UI can show
 *     the recorded vs recomputed hashes side-by-side for forensics.
 */
export async function verifyExportBundleInDatabase(
  bundleId: string,
  storage: FileStorageClient
): Promise<ExportBundleVerifyReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  let workerVerifier: typeof import("@ee-library/worker/export-bundle-verification");
  try {
    workerVerifier = await import("@ee-library/worker/export-bundle-verification");
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Bundle verification helper failed to load.", error);
  }

  try {
    const rows = await databasePool.query<DatabaseExportBundleRow>(
      `SELECT id, project_id, revision_label, bundle_format, storage_key, archive_storage_key, manifest,
              part_count, included_asset_count, omitted_asset_count, warning_count,
              assembly_status, assembly_error, assembly_completed_at, assembly_attempt_count,
              archive_sha256, manifest_sha256, signature_status, signature_algorithm,
              signature_public_key_fingerprint, signature_storage_key, signature_signed_at,
              created_by, created_at
         FROM export_bundles
         WHERE id = $1`,
      [bundleId]
    );

    const row = rows.rows[0];
    if (!row) {
      return { status: "not_found" };
    }

    let verificationKey: import("@ee-library/worker/export-bundle-verification").VerificationKeyMaterial | null = null;
    try {
      verificationKey = workerVerifier.readBundleVerificationKeyMaterial();
    } catch (error) {
      // A misconfigured key is reported as the dedicated `verification_key_unavailable` failure
      // rather than a 500 -- the operator gets a structured, actionable response.
      const detail = error instanceof Error ? error.message : String(error);
      throw new CatalogStoreError("query_failed", `Bundle verification key parse failed: ${detail}`, error);
    }

    const outcome = await workerVerifier.verifyAssembledExportBundle(
      storage,
      {
        archiveSha256: row.archive_sha256,
        archiveStorageKey: row.archive_storage_key,
        id: row.id,
        signatureAlgorithm: row.signature_algorithm,
        signaturePublicKeyFingerprint: row.signature_public_key_fingerprint,
        signatureStatus: normalizeExportBundleSignatureStatus(row.signature_status),
        signatureStorageKey: row.signature_storage_key
      },
      { verificationKey }
    );

    // Persist the new status. The recomputed hash is intentionally NOT written back over the
    // recorded one -- the recorded value is the audit anchor. If the recomputed hash differs
    // we want the row to keep showing the original recorded hash so an auditor can see the
    // discrepancy; the new hash is returned in the response for forensics only.
    const persistedStatus: ExportBundleSignatureStatus = outcome.status;
    await databasePool.query(
      `UPDATE export_bundles SET signature_status = $1 WHERE id = $2`,
      [persistedStatus, bundleId]
    );

    const updatedRow = { ...row, signature_status: persistedStatus };
    const [fileAvailability, archiveAvailability] = await Promise.all([
      resolveExportBundleFileAvailability(updatedRow.storage_key, storage),
      resolveExportBundleFileAvailability(updatedRow.archive_storage_key, storage)
    ]);
    const bundle = mapExportBundleRow(updatedRow, fileAvailability, archiveAvailability);

    const reason: ExportBundleVerificationReason | null =
      outcome.status === "verification_failed" ? outcome.reason : null;

    return {
      response: {
        boundary:
          "Cryptographic verification confirms the archive matches its recorded hash and signature. It is never a substitute for review, approval, or export-readiness gates.",
        bundle,
        outcome: {
          reason,
          recomputedArchiveSha256: outcome.recomputedArchiveSha256,
          status: outcome.status,
          verifiedAt: outcome.status === "signed" ? outcome.verifiedAt : null
        }
      },
      status: "available"
    };
  } catch (error) {
    if (error instanceof CatalogStoreError) {
      throw error;
    }
    throw new CatalogStoreError("query_failed", "Export bundle verification failed.", error);
  }
}

/**
 * Normalizes a raw DB string into the typed assembly status, defaulting to `not_required` for
 * legacy rows persisted before migration 031.
 */
function normalizeExportBundleAssemblyStatus(raw: string | null): ExportBundleAssemblyStatus {
  if (raw === "pending" || raw === "assembled" || raw === "assembly_failed" || raw === "not_required") {
    return raw;
  }

  return "not_required";
}

/**
 * Parses one persisted JSONB telemetry record back into the structured assembly error contract.
 *
 * Returns null when the column is empty or the value is not a recognizable telemetry object so the
 * UI never shows an unexplained "failure" badge built from corrupted data.
 */
function parseExportBundleAssemblyError(raw: unknown): ExportBundleAssemblyError | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const phaseRaw = typeof candidate["phase"] === "string" ? candidate["phase"] : null;
  const phase = phaseRaw === "fetch_asset" || phaseRaw === "write_asset" || phaseRaw === "unknown" ? phaseRaw : null;
  const message = typeof candidate["message"] === "string" ? candidate["message"] : null;
  const failedAt = typeof candidate["failedAt"] === "string" ? candidate["failedAt"] : null;

  if (!phase || !message || !failedAt) {
    return null;
  }

  return {
    failedAssetId: typeof candidate["failedAssetId"] === "string" ? candidate["failedAssetId"] : null,
    failedAt,
    failedBundlePath: typeof candidate["failedBundlePath"] === "string" ? candidate["failedBundlePath"] : null,
    message,
    phase
  };
}

// ---------------------------------------------------------------------------
// P1-FUNC6: BOM import diagnostics and revision compare store functions
// ---------------------------------------------------------------------------

interface DatabaseDiagnosticsRow {
  line_id: string;
  row_number: number | string;
  designators: string[] | null;
  quantity: string | null;
  raw_mpn: string | null;
  raw_manufacturer: string | null;
  raw_description: string | null;
  match_status: string;
  match_confidence_score: string | null;
  matched_part_id: string | null;
  matched_part_mpn: string | null;
  matched_manufacturer_name: string | null;
}

interface DatabaseRevisionCompareRow {
  raw_mpn: string | null;
  raw_manufacturer: string | null;
  raw_description: string | null;
  quantity: string | null;
  designators: string[] | null;
  match_status: string;
  matched_part_id: string | null;
  in_import1: boolean;
  in_import2: boolean;
  qty_changed: boolean;
  match_changed: boolean;
}

/**
 * Reads diagnostics for one BOM import: match counts and per-row triage context.
 */
export async function readBomImportDiagnosticsFromDatabase(importId: string): Promise<BomImportDiagnosticsReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const importCheck = await databasePool.query<{ id: string; project_id: string }>(
      "SELECT id, project_id FROM bom_imports WHERE id = $1",
      [importId]
    );

    if (importCheck.rowCount === 0) {
      return { status: "not_found" };
    }

    const projectId = importCheck.rows[0]!.project_id;

    const rows = await databasePool.query<DatabaseDiagnosticsRow>(
      `SELECT bl.id AS line_id, bl.row_number, bl.designators, bl.quantity,
              bl.raw_mpn, bl.raw_manufacturer, bl.raw_description,
              bl.match_status, bl.match_confidence_score, bl.matched_part_id,
              p.mpn AS matched_part_mpn, m.name AS matched_manufacturer_name
         FROM bom_lines bl
         LEFT JOIN parts p ON p.id = bl.matched_part_id
         LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
         WHERE bl.bom_import_id = $1
         ORDER BY bl.row_number`,
      [importId]
    );

    const diagnosticRows: BomImportDiagnosticsRow[] = await Promise.all(
      rows.rows.map(async (row) => {
        const matchStatus = row.match_status as BomLineMatchStatus;
        const triageActions = buildTriageActions(matchStatus, row.raw_mpn);
        const approvedSubstituteHints = matchStatus !== "matched" && matchStatus !== "ignored" && row.raw_mpn
          ? await readApprovedSubstituteHintsForRawMpn(databasePool, row.raw_mpn, projectId)
          : [];
        if (approvedSubstituteHints.length > 0) {
          for (const hint of approvedSubstituteHints) {
            triageActions.push(`Approved substitute available: ${hint.candidatePartMpn} (${hint.candidateManufacturerName}, scope=${hint.scope})`);
          }
        }

        return {
          approvedSubstituteHints,
          designators: toStringArray(row.designators),
          lineId: row.line_id,
          matchConfidenceScore: toNullableNumber(row.match_confidence_score),
          matchStatus,
          matchedManufacturerName: row.matched_manufacturer_name,
          matchedPartId: row.matched_part_id,
          matchedPartMpn: row.matched_part_mpn,
          quantity: toNullableNumber(row.quantity),
          rawDescription: row.raw_description,
          rawManufacturer: row.raw_manufacturer,
          rawMpn: row.raw_mpn,
          rowNumber: toNumber(row.row_number),
          triageActions
        };
      })
    );

    const counts = {
      ambiguousCount: diagnosticRows.filter((r) => r.matchStatus === "ambiguous").length,
      ignoredCount: diagnosticRows.filter((r) => r.matchStatus === "ignored").length,
      matchedCount: diagnosticRows.filter((r) => r.matchStatus === "matched").length,
      unmatchedCount: diagnosticRows.filter((r) => r.matchStatus === "unmatched").length,
      weakMatchCount: diagnosticRows.filter((r) => r.matchStatus === "weak_match").length
    };

    return {
      status: "available",
      response: {
        importId,
        projectId,
        rows: diagnosticRows,
        ...counts
      }
    };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "BOM import diagnostics read failed.", error);
  }
}

/**
 * Compares two BOM imports row-by-row, keyed by normalized MPN.
 */
export async function readBomRevisionCompareFromDatabase(projectId: string, importId1: string, importId2: string): Promise<BomRevisionCompareReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  if (importId1 === importId2) {
    return { status: "invalid", code: "IDENTICAL_IMPORTS", message: "Revision compare requires two different BOM import ids." };
  }

  try {
    const importCheck = await databasePool.query<{ id: string; project_id: string }>(
      "SELECT id, project_id FROM bom_imports WHERE id = ANY($1::text[]) AND project_id = $2",
      [[importId1, importId2], projectId]
    );

    if ((importCheck.rowCount ?? 0) === 0) {
      return { status: "not_found" };
    }

    if ((importCheck.rowCount ?? 0) < 2) {
      return { status: "invalid", code: "IMPORT_NOT_IN_PROJECT", message: "Both BOM import ids must belong to the specified project." };
    }

    const rows = await databasePool.query<DatabaseRevisionCompareRow>(
      `WITH
         i1 AS (
           SELECT COALESCE(LOWER(TRIM(raw_mpn)), '#row-' || row_number::text) AS key,
                  raw_mpn, raw_manufacturer, raw_description, quantity, designators,
                  match_status, matched_part_id
             FROM bom_lines WHERE bom_import_id = $2
         ),
         i2 AS (
           SELECT COALESCE(LOWER(TRIM(raw_mpn)), '#row-' || row_number::text) AS key,
                  raw_mpn, raw_manufacturer, raw_description, quantity, designators,
                  match_status, matched_part_id
             FROM bom_lines WHERE bom_import_id = $3
         )
       SELECT
         COALESCE(i1.raw_mpn, i2.raw_mpn) AS raw_mpn,
         COALESCE(i1.raw_manufacturer, i2.raw_manufacturer) AS raw_manufacturer,
         COALESCE(i1.raw_description, i2.raw_description) AS raw_description,
         COALESCE(i2.quantity, i1.quantity) AS quantity,
         COALESCE(i2.designators, i1.designators) AS designators,
         COALESCE(i2.match_status, i1.match_status) AS match_status,
         COALESCE(i2.matched_part_id, i1.matched_part_id) AS matched_part_id,
         (i1.key IS NOT NULL) AS in_import1,
         (i2.key IS NOT NULL) AS in_import2,
         (i1.quantity IS DISTINCT FROM i2.quantity) AS qty_changed,
         (i1.match_status IS DISTINCT FROM i2.match_status) AS match_changed
       FROM i1 FULL OUTER JOIN i2 ON i1.key = i2.key
       ORDER BY raw_mpn NULLS LAST`,
      [projectId, importId1, importId2]
    );

    const compareRows: BomRevisionCompareRow[] = rows.rows.map((row) => {
      let kind: BomRevisionCompareRow["kind"];
      let changeDetail: string | null = null;

      if (row.in_import1 && !row.in_import2) {
        kind = "removed";
      } else if (!row.in_import1 && row.in_import2) {
        kind = "added";
      } else if (row.qty_changed || row.match_changed) {
        kind = "changed";
        const details: string[] = [];
        if (row.qty_changed) details.push("quantity changed");
        if (row.match_changed) details.push("match status changed");
        changeDetail = details.join(", ");
      } else {
        kind = "unchanged";
      }

      return {
        changeDetail,
        designators: toStringArray(row.designators),
        kind,
        matchStatus: row.match_status as BomLineMatchStatus,
        matchedPartId: row.matched_part_id,
        quantity: toNullableNumber(row.quantity),
        rawDescription: row.raw_description,
        rawManufacturer: row.raw_manufacturer,
        rawMpn: row.raw_mpn
      };
    });

    const addedCount = compareRows.filter((r) => r.kind === "added").length;
    const removedCount = compareRows.filter((r) => r.kind === "removed").length;
    const changedCount = compareRows.filter((r) => r.kind === "changed").length;
    const unchangedCount = compareRows.filter((r) => r.kind === "unchanged").length;

    return {
      status: "available",
      response: { addedCount, changedCount, importId1, importId2, projectId, removedCount, rows: compareRows, unchangedCount }
    };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "BOM revision compare read failed.", error);
  }
}

/** AggregatedRevisionLineRow is the union of BOM lines across all imports in one revision. */
interface AggregatedRevisionLineRow {
  bom_import_id: string;
  matched_part_id: string | null;
  matched_part_mpn: string | null;
  raw_mpn: string | null;
  raw_manufacturer: string | null;
  raw_description: string | null;
  quantity: string | number | null;
  designators: string[] | null;
  match_status: string;
  row_number: number;
}

/** AggregatedRevisionLine is the per-identity collapsed view used to diff two revisions. */
interface AggregatedRevisionLine {
  identityKey: string;
  identityKind: ProjectRevisionCompareIdentityKind;
  matchedPartId: string | null;
  matchedPartMpn: string | null;
  rawMpns: Set<string>;
  rawManufacturer: string | null;
  rawDescription: string | null;
  totalQuantity: number | null;
  designators: string[];
  matchStatus: BomLineMatchStatus | null;
  bomImportIds: Set<string>;
}

/**
 * Compares the BOM contents of two project revisions, grouping changes into added/removed/quantity/designator/MPN-swap.
 */
export async function readProjectRevisionCompareFromDatabase(
  projectId: string,
  fromRevisionId: string,
  toRevisionId: string
): Promise<ProjectRevisionCompareReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  if (fromRevisionId === toRevisionId) {
    return {
      status: "invalid",
      code: "IDENTICAL_REVISIONS",
      message: "Revision compare requires two different revision ids."
    };
  }

  try {
    const projectCheck = await databasePool.query<{ id: string }>("SELECT id FROM projects WHERE id = $1", [projectId]);

    if ((projectCheck.rowCount ?? 0) === 0) {
      return { status: "not_found", code: "PROJECT_NOT_FOUND", message: "Project was not found." };
    }

    const revisionCheck = await databasePool.query<{ id: string; project_id: string }>(
      "SELECT id, project_id FROM project_revisions WHERE project_id = $1 AND id IN ($2, $3)",
      [projectId, fromRevisionId, toRevisionId]
    );

    const foundIds = new Set(revisionCheck.rows.map((row) => row.id));
    if (!foundIds.has(fromRevisionId) || !foundIds.has(toRevisionId)) {
      return {
        status: "not_found",
        code: "REVISIONS_NOT_FOUND",
        message: "Both revision ids must exist on the specified project."
      };
    }

    const [fromLines, toLines] = await Promise.all([
      readAggregatedRevisionLines(databasePool, fromRevisionId),
      readAggregatedRevisionLines(databasePool, toRevisionId)
    ]);

    return {
      status: "available",
      response: buildProjectRevisionCompareResponseFromLines({
        fromLines,
        fromRevisionId,
        projectId,
        toLines,
        toRevisionId
      })
    };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Project revision compare read failed.", error);
  }
}

/**
 * Builds the public compare response from already-aggregated revision lines.
 */
function buildProjectRevisionCompareResponseFromLines({
  fromLines,
  fromRevisionId,
  projectId,
  toLines,
  toRevisionId
}: {
  fromLines: Map<string, AggregatedRevisionLine>;
  fromRevisionId: string;
  projectId: string;
  toLines: Map<string, AggregatedRevisionLine>;
  toRevisionId: string;
}): ProjectRevisionCompareResponse {
  const rows = diffAggregatedRevisionLines(fromLines, toLines);

  return {
    addedCount: countProjectRevisionCompareRows(rows, "added"),
    designatorChangedCount: countProjectRevisionCompareRows(rows, "designator_changed"),
    fromBomImportIds: collectBomImportIds(fromLines),
    fromRevisionId,
    mpnSwapCount: countProjectRevisionCompareRows(rows, "mpn_swap"),
    projectId,
    quantityChangedCount: countProjectRevisionCompareRows(rows, "quantity_changed"),
    removedCount: countProjectRevisionCompareRows(rows, "removed"),
    rows,
    toBomImportIds: collectBomImportIds(toLines),
    toRevisionId,
    unchangedCount: countProjectRevisionCompareRows(rows, "unchanged")
  };
}

/**
 * Counts compare rows for one change kind while keeping compare response assembly deterministic.
 */
function countProjectRevisionCompareRows(
  rows: ProjectRevisionCompareResponse["rows"],
  changeKind: ProjectRevisionCompareResponse["rows"][number]["changeKind"]
): number {
  return rows.filter((row) => row.changeKind === changeKind).length;
}

/**
 * Reads BOM lines for one revision and aggregates them by part identity (matched_part_id else normalized raw_mpn).
 */
async function readAggregatedRevisionLines(
  databasePool: Pool | PoolClient,
  revisionId: string
): Promise<Map<string, AggregatedRevisionLine>> {
  const result = await databasePool.query<AggregatedRevisionLineRow>(
    `SELECT bl.bom_import_id, bl.matched_part_id, p.mpn AS matched_part_mpn,
            bl.raw_mpn, bl.raw_manufacturer, bl.raw_description,
            bl.quantity, bl.designators, bl.match_status, bl.row_number
       FROM bom_lines bl
       LEFT JOIN parts p ON p.id = bl.matched_part_id
       WHERE bl.project_revision_id = $1
       ORDER BY bl.bom_import_id, bl.row_number`,
    [revisionId]
  );

  const aggregated = new Map<string, AggregatedRevisionLine>();

  for (const row of result.rows) {
    const identity = deriveRevisionLineIdentity(row);
    const existing = aggregated.get(identity.key);
    const quantity = toNullableNumber(row.quantity ?? null);

    if (!existing) {
      aggregated.set(identity.key, {
        bomImportIds: new Set([row.bom_import_id]),
        designators: toStringArray(row.designators),
        identityKey: identity.key,
        identityKind: identity.kind,
        matchStatus: row.match_status as BomLineMatchStatus,
        matchedPartId: row.matched_part_id,
        matchedPartMpn: row.matched_part_mpn,
        rawDescription: row.raw_description,
        rawManufacturer: row.raw_manufacturer,
        rawMpns: row.raw_mpn ? new Set([row.raw_mpn]) : new Set(),
        totalQuantity: quantity
      });
      continue;
    }

    existing.bomImportIds.add(row.bom_import_id);
    existing.designators = mergeDesignatorLists(existing.designators, toStringArray(row.designators));
    if (quantity !== null) {
      existing.totalQuantity = (existing.totalQuantity ?? 0) + quantity;
    }
    if (row.raw_mpn) existing.rawMpns.add(row.raw_mpn);
    existing.rawManufacturer ??= row.raw_manufacturer;
    existing.rawDescription ??= row.raw_description;
    if (existing.matchStatus !== "matched" && row.match_status === "matched") {
      existing.matchStatus = "matched";
      existing.matchedPartId ??= row.matched_part_id;
      existing.matchedPartMpn ??= row.matched_part_mpn;
    }
  }

  return aggregated;
}

/**
 * Picks an identity key for a BOM line: matched_part_id when present, else normalized raw_mpn, else row-scoped key.
 */
function deriveRevisionLineIdentity(row: AggregatedRevisionLineRow): {
  key: string;
  kind: ProjectRevisionCompareIdentityKind;
} {
  if (row.matched_part_id) {
    return { key: `part:${row.matched_part_id}`, kind: "matched_part" };
  }

  const normalizedMpn = row.raw_mpn?.trim().toLowerCase();
  if (normalizedMpn) {
    return { key: `mpn:${normalizedMpn}`, kind: "raw_mpn" };
  }

  return { key: `row:${row.bom_import_id}:${row.row_number}`, kind: "raw_row" };
}

/**
 * Merges two designator lists while preserving deterministic order and dropping duplicates.
 */
function mergeDesignatorLists(left: string[], right: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...left, ...right]) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }

  return merged;
}

/**
 * Diffs two aggregated revision line maps into compare rows with explicit change groupings.
 */
function diffAggregatedRevisionLines(
  fromLines: Map<string, AggregatedRevisionLine>,
  toLines: Map<string, AggregatedRevisionLine>
): ProjectRevisionCompareRow[] {
  const rows: ProjectRevisionCompareRow[] = [];
  const seenKeys = new Set<string>();

  for (const [key, fromLine] of fromLines) {
    seenKeys.add(key);
    const toLine = toLines.get(key);

    if (!toLine) {
      rows.push(buildCompareRow("removed", fromLine, null, null));
      continue;
    }

    rows.push(buildChangedOrUnchangedRow(fromLine, toLine));
  }

  for (const [key, toLine] of toLines) {
    if (seenKeys.has(key)) continue;
    rows.push(buildCompareRow("added", null, toLine, null));
  }

  return rows.sort(compareRowSortKey);
}

/**
 * Decides whether a row is an MPN swap, quantity/designator change, or unchanged.
 */
function buildChangedOrUnchangedRow(
  fromLine: AggregatedRevisionLine,
  toLine: AggregatedRevisionLine
): ProjectRevisionCompareRow {
  const quantityChanged = (fromLine.totalQuantity ?? null) !== (toLine.totalQuantity ?? null);
  const designatorChanged = !designatorListsMatch(fromLine.designators, toLine.designators);
  const mpnSwap =
    fromLine.identityKind === "matched_part" &&
    toLine.identityKind === "matched_part" &&
    !rawMpnSetsMatch(fromLine.rawMpns, toLine.rawMpns);

  if (mpnSwap) {
    const fromList = Array.from(fromLine.rawMpns).join(", ") || "(no raw MPN)";
    const toList = Array.from(toLine.rawMpns).join(", ") || "(no raw MPN)";
    return buildCompareRow("mpn_swap", fromLine, toLine, `Raw MPN swapped: ${fromList} -> ${toList}`);
  }

  if (quantityChanged && designatorChanged) {
    return buildCompareRow(
      "quantity_changed",
      fromLine,
      toLine,
      `Quantity ${formatQuantity(fromLine.totalQuantity)} -> ${formatQuantity(toLine.totalQuantity)}; designators changed`
    );
  }

  if (quantityChanged) {
    return buildCompareRow(
      "quantity_changed",
      fromLine,
      toLine,
      `Quantity ${formatQuantity(fromLine.totalQuantity)} -> ${formatQuantity(toLine.totalQuantity)}`
    );
  }

  if (designatorChanged) {
    return buildCompareRow(
      "designator_changed",
      fromLine,
      toLine,
      `Designators ${formatDesignators(fromLine.designators)} -> ${formatDesignators(toLine.designators)}`
    );
  }

  return buildCompareRow("unchanged", fromLine, toLine, null);
}

/**
 * Builds one compare row from optional from/to aggregated lines.
 */
function buildCompareRow(
  changeKind: ProjectRevisionCompareChangeKind,
  fromLine: AggregatedRevisionLine | null,
  toLine: AggregatedRevisionLine | null,
  changeDetail: string | null
): ProjectRevisionCompareRow {
  const reference = (toLine ?? fromLine)!;

  return {
    changeDetail,
    changeKind,
    from: fromLine ? toCompareSide(fromLine) : null,
    identityKey: reference.identityKey,
    identityKind: reference.identityKind,
    matchedPartId: reference.matchedPartId,
    rawMpn: pickRawMpnLabel(toLine, fromLine),
    to: toLine ? toCompareSide(toLine) : null
  };
}

/**
 * Projects the aggregated line into the side payload returned by the API.
 */
function toCompareSide(line: AggregatedRevisionLine): ProjectRevisionCompareSide {
  return {
    designators: line.designators,
    matchStatus: line.matchStatus,
    matchedPartId: line.matchedPartId,
    matchedPartMpn: line.matchedPartMpn,
    quantity: line.totalQuantity,
    rawDescription: line.rawDescription,
    rawManufacturer: line.rawManufacturer,
    rawMpn: pickRawMpnLabel(line, null)
  };
}

/**
 * Picks the most specific raw MPN label for a row, preferring the to-side, then from-side.
 */
function pickRawMpnLabel(primary: AggregatedRevisionLine | null, secondary: AggregatedRevisionLine | null): string | null {
  for (const candidate of [primary, secondary]) {
    if (!candidate) continue;
    const first = candidate.rawMpns.values().next();
    if (!first.done) return first.value;
  }
  return null;
}

/**
 * Returns true when two normalized designator sets match exactly.
 */
function designatorListsMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * Returns true when two raw-MPN sets contain the same case-insensitive entries.
 */
function rawMpnSetsMatch(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  const normalize = (value: string) => value.trim().toLowerCase();
  const leftNormalized = new Set(Array.from(left, normalize));
  for (const value of right) {
    if (!leftNormalized.has(normalize(value))) return false;
  }
  return true;
}

/**
 * Formats a quantity value or "?" when unknown.
 */
function formatQuantity(quantity: number | null): string {
  return quantity === null ? "?" : String(quantity);
}

/**
 * Formats a designator list compactly for the change detail string.
 */
function formatDesignators(designators: string[]): string {
  return designators.length === 0 ? "(none)" : designators.join(", ");
}

/**
 * Returns a deterministic sort key so the API output stays stable across runs.
 */
function compareRowSortKey(left: ProjectRevisionCompareRow, right: ProjectRevisionCompareRow): number {
  const order: Record<ProjectRevisionCompareChangeKind, number> = {
    added: 0,
    removed: 1,
    mpn_swap: 2,
    quantity_changed: 3,
    designator_changed: 4,
    unchanged: 5
  };
  if (order[left.changeKind] !== order[right.changeKind]) {
    return order[left.changeKind] - order[right.changeKind];
  }
  const leftLabel = left.rawMpn ?? left.identityKey;
  const rightLabel = right.rawMpn ?? right.identityKey;
  return leftLabel.localeCompare(rightLabel);
}

/**
 * Collects the unique BOM import ids that contributed to one side of the compare.
 */
function collectBomImportIds(lines: Map<string, AggregatedRevisionLine>): string[] {
  const ids = new Set<string>();
  for (const line of lines.values()) {
    for (const id of line.bomImportIds) {
      ids.add(id);
    }
  }
  return Array.from(ids).sort();
}

// ---------------------------------------------------------------------------
// Versioned BOM approval gates
// ---------------------------------------------------------------------------

/** PROJECT_REVISION_APPROVAL_GATE_BOUNDARY_COPY keeps the gate scope narrow and auditable. */
const PROJECT_REVISION_APPROVAL_GATE_BOUNDARY_COPY =
  "A BOM approval gate records review of one computed revision diff only. It does not approve parts, validate evidence, release the revision, or unlock export.";

/**
 * Reads every persisted BOM revision approval gate for one project.
 */
export async function readProjectRevisionApprovalGatesFromDatabase(projectId: string): Promise<ProjectRevisionApprovalGateListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const result = await databasePool.query<DatabaseProjectRevisionApprovalGateRow>(
      `
        SELECT
          id,
          project_id,
          from_project_revision_id,
          to_project_revision_id,
          gate_status,
          diff_fingerprint,
          diff_summary,
          decision_notes,
          created_by,
          decided_by,
          decided_at,
          created_at,
          updated_at
        FROM project_revision_approval_gates
        WHERE project_id = $1
        ORDER BY updated_at DESC, id ASC
      `,
      [projectId]
    );

    const gates: ProjectRevisionApprovalGate[] = [];
    for (const row of result.rows) {
      gates.push(mapProjectRevisionApprovalGateRow(row, await isRevisionApprovalGateCurrent(databasePool, row)));
    }

    return {
      status: "available",
      response: {
        boundary: PROJECT_REVISION_APPROVAL_GATE_BOUNDARY_COPY,
        gates,
        projectId,
        state: gates.length > 0 ? "available" : "empty"
      }
    };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Project revision approval gate read failed.", error);
  }
}

/**
 * Creates or updates the approval gate for the current revision diff fingerprint.
 */
export async function upsertProjectRevisionApprovalGateInDatabase(
  projectId: string,
  input: ProjectRevisionApprovalGateRequest,
  actor: string
): Promise<ProjectRevisionApprovalGateActionResult> {
  const validation = validateProjectRevisionApprovalGateInput(input);
  if (validation) {
    return validation;
  }

  const compareResult = await readProjectRevisionCompareFromDatabase(projectId, input.fromRevisionId, input.toRevisionId);
  if (compareResult.status !== "available") {
    return compareResult;
  }

  const databasePool = getProjectMemoryDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  const approvalBlockers = input.decision === "approve"
    ? await collectRevisionApprovalBlockers(databasePool, input.toRevisionId, compareResult.response)
    : [];
  if (approvalBlockers.length > 0) {
    return {
      code: "APPROVAL_GATE_BLOCKED",
      message: `BOM revision approval is blocked: ${approvalBlockers.join(" ")}`,
      status: "invalid"
    };
  }

  const diffSummary = buildProjectRevisionApprovalGateDiffSummary(compareResult.response);
  const diffFingerprint = buildProjectRevisionDiffFingerprint(compareResult.response);
  const gateStatus = mapApprovalGateDecisionToStatus(input.decision);
  const now = new Date();
  const decidedBy = input.decision === "open" ? null : actor;
  const decidedAt = input.decision === "open" ? null : now;
  const decisionNotes = (input.notes ?? "").trim();

  try {
    const result = await databasePool.query<DatabaseProjectRevisionApprovalGateRow>(
      `
        INSERT INTO project_revision_approval_gates (
          id,
          project_id,
          from_project_revision_id,
          to_project_revision_id,
          gate_status,
          diff_fingerprint,
          diff_summary,
          decision_notes,
          created_by,
          decided_by,
          decided_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $12)
        ON CONFLICT (project_id, from_project_revision_id, to_project_revision_id, diff_fingerprint)
        DO UPDATE SET
          gate_status = EXCLUDED.gate_status,
          diff_summary = EXCLUDED.diff_summary,
          decision_notes = EXCLUDED.decision_notes,
          decided_by = EXCLUDED.decided_by,
          decided_at = EXCLUDED.decided_at,
          updated_at = EXCLUDED.updated_at
        RETURNING
          id,
          project_id,
          from_project_revision_id,
          to_project_revision_id,
          gate_status,
          diff_fingerprint,
          diff_summary,
          decision_notes,
          created_by,
          decided_by,
          decided_at,
          created_at,
          updated_at
      `,
      [
        randomUUID(),
        projectId,
        input.fromRevisionId,
        input.toRevisionId,
        gateStatus,
        diffFingerprint,
        JSON.stringify(diffSummary),
        decisionNotes,
        actor,
        decidedBy,
        decidedAt,
        now
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Approval gate upsert returned no row.");
    }

    const isCurrent = await isRevisionApprovalGateCurrent(databasePool, row);

    return {
      status: "applied",
      response: {
        boundary: PROJECT_REVISION_APPROVAL_GATE_BOUNDARY_COPY,
        compare: compareResult.response,
        gate: mapProjectRevisionApprovalGateRow(row, isCurrent)
      }
    };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Project revision approval gate write failed.", error);
  }
}

/**
 * Validates a gate request before computing the diff.
 */
function validateProjectRevisionApprovalGateInput(
  input: ProjectRevisionApprovalGateRequest
): { status: "invalid"; code: string; message: string } | null {
  if (!input || typeof input.fromRevisionId !== "string" || input.fromRevisionId.trim().length === 0) {
    return {
      code: "FROM_REVISION_REQUIRED",
      message: "BOM approval gate requires a fromRevisionId.",
      status: "invalid"
    };
  }
  if (typeof input.toRevisionId !== "string" || input.toRevisionId.trim().length === 0) {
    return {
      code: "TO_REVISION_REQUIRED",
      message: "BOM approval gate requires a toRevisionId.",
      status: "invalid"
    };
  }
  if (input.decision !== "open" && input.decision !== "approve" && input.decision !== "request_changes") {
    return {
      code: "INVALID_GATE_DECISION",
      message: "BOM approval gate decision must be open, approve, or request_changes.",
      status: "invalid"
    };
  }
  return null;
}

/**
 * Maps an operator action into the persisted gate status.
 */
function mapApprovalGateDecisionToStatus(decision: ProjectRevisionApprovalGateRequest["decision"]): ProjectRevisionApprovalGateStatus {
  if (decision === "approve") {
    return "approved";
  }
  if (decision === "request_changes") {
    return "changes_requested";
  }
  return "pending_review";
}

/**
 * Collects hard blockers for marking a revision diff approved.
 */
async function collectRevisionApprovalBlockers(
  databasePool: Pool | PoolClient,
  revisionId: string,
  compare: ProjectRevisionCompareResponse
): Promise<string[]> {
  const blockers: string[] = [];

  if (compare.toBomImportIds.length === 0) {
    blockers.push("The target revision has no BOM imports.");
  }

  const unresolved = await databasePool.query<{ match_status: BomLineMatchStatus; line_count: string | number }>(
    `
      SELECT match_status, COUNT(*)::text AS line_count
      FROM bom_lines
      WHERE project_revision_id = $1
        AND match_status IN ('unmatched', 'weak_match', 'ambiguous')
      GROUP BY match_status
      ORDER BY match_status ASC
    `,
    [revisionId]
  );

  for (const row of unresolved.rows) {
    blockers.push(`${toNumber(row.line_count)} ${row.match_status.replace(/_/gu, " ")} row(s) remain on the target revision.`);
  }

  return blockers;
}

/**
 * Builds the compact summary stored with the approval gate.
 */
function buildProjectRevisionApprovalGateDiffSummary(compare: ProjectRevisionCompareResponse): ProjectRevisionApprovalGateDiffSummary {
  const totalChangedCount =
    compare.addedCount +
    compare.removedCount +
    compare.mpnSwapCount +
    compare.quantityChangedCount +
    compare.designatorChangedCount;

  return {
    addedCount: compare.addedCount,
    designatorChangedCount: compare.designatorChangedCount,
    fromBomImportIds: compare.fromBomImportIds,
    mpnSwapCount: compare.mpnSwapCount,
    quantityChangedCount: compare.quantityChangedCount,
    removedCount: compare.removedCount,
    toBomImportIds: compare.toBomImportIds,
    totalChangedCount,
    unchangedCount: compare.unchangedCount
  };
}

/**
 * Hashes the exact compare payload that a gate decision reviewed.
 */
function buildProjectRevisionDiffFingerprint(compare: ProjectRevisionCompareResponse): string {
  const payload = {
    fromBomImportIds: compare.fromBomImportIds,
    fromRevisionId: compare.fromRevisionId,
    projectId: compare.projectId,
    rows: compare.rows.map((row) => ({
      changeDetail: row.changeDetail,
      changeKind: row.changeKind,
      from: row.from,
      identityKey: row.identityKey,
      identityKind: row.identityKind,
      matchedPartId: row.matchedPartId,
      rawMpn: row.rawMpn,
      to: row.to
    })),
    toBomImportIds: compare.toBomImportIds,
    toRevisionId: compare.toRevisionId
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Checks whether a persisted gate still matches the current diff between its two revisions.
 */
async function isRevisionApprovalGateCurrent(
  databasePool: Pool | PoolClient,
  row: DatabaseProjectRevisionApprovalGateRow
): Promise<boolean> {
  try {
    const currentFromLines = await readAggregatedRevisionLines(databasePool, row.from_project_revision_id);
    const currentToLines = await readAggregatedRevisionLines(databasePool, row.to_project_revision_id);
    const currentCompare = buildProjectRevisionCompareResponseFromLines({
      fromLines: currentFromLines,
      fromRevisionId: row.from_project_revision_id,
      projectId: row.project_id,
      toLines: currentToLines,
      toRevisionId: row.to_project_revision_id
    });

    return buildProjectRevisionDiffFingerprint(currentCompare) === row.diff_fingerprint;
  } catch {
    return false;
  }
}

/**
 * Maps a database gate row into the shared response shape.
 */
function mapProjectRevisionApprovalGateRow(
  row: DatabaseProjectRevisionApprovalGateRow,
  isCurrent: boolean
): ProjectRevisionApprovalGate {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    createdBy: row.created_by,
    decidedAt: row.decided_at ? toIsoTimestamp(row.decided_at) : null,
    decidedBy: row.decided_by,
    decisionNotes: row.decision_notes,
    diffFingerprint: row.diff_fingerprint,
    diffSummary: mapApprovalGateDiffSummary(row.diff_summary),
    fromRevisionId: row.from_project_revision_id,
    gateStatus: row.gate_status,
    id: row.id,
    isCurrent,
    projectId: row.project_id,
    toRevisionId: row.to_project_revision_id,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

/**
 * Normalizes diff summary JSON into numbers and arrays for API consumers.
 */
function mapApprovalGateDiffSummary(value: unknown): ProjectRevisionApprovalGateDiffSummary {
  const record = toRecord(value);

  return {
    addedCount: Number(record["addedCount"] ?? 0),
    designatorChangedCount: Number(record["designatorChangedCount"] ?? 0),
    fromBomImportIds: toStringArray(record["fromBomImportIds"]),
    mpnSwapCount: Number(record["mpnSwapCount"] ?? 0),
    quantityChangedCount: Number(record["quantityChangedCount"] ?? 0),
    removedCount: Number(record["removedCount"] ?? 0),
    toBomImportIds: toStringArray(record["toBomImportIds"]),
    totalChangedCount: Number(record["totalChangedCount"] ?? 0),
    unchangedCount: Number(record["unchangedCount"] ?? 0)
  };
}

/**
 * Reads projects that have confirmed usages overlapping with a circuit block's part roles.
 */
export async function readCircuitBlockProjectDependenciesFromDatabase(blockId: string): Promise<CircuitBlockProjectDependenciesReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const blockCheck = await databasePool.query<{ id: string }>("SELECT id FROM circuit_blocks WHERE id = $1", [blockId]);

    if ((blockCheck.rowCount ?? 0) === 0) {
      return { status: "not_found" };
    }

    const rows = await databasePool.query<DatabaseCircuitBlockProjectDependencyRow>(
      `
        SELECT
          p.id AS project_id,
          p.project_key,
          p.name AS project_name,
          p.status AS project_status,
          p.created_at AS project_created_at,
          p.updated_at AS project_updated_at,
          COUNT(DISTINCT ppu.part_id)::text AS matched_part_count,
          (SELECT COUNT(*)::text FROM circuit_block_parts WHERE circuit_block_id = $1) AS total_block_part_count
        FROM circuit_block_parts cbp
        JOIN project_part_usages ppu ON ppu.part_id = cbp.part_id
        JOIN projects p ON p.id = ppu.project_id
        WHERE cbp.circuit_block_id = $1
        GROUP BY p.id, p.project_key, p.name, p.status, p.created_at, p.updated_at
        ORDER BY COUNT(DISTINCT ppu.part_id) DESC, p.project_key ASC
      `,
      [blockId]
    );

    const dependencies: CircuitBlockProjectDependency[] = rows.rows.map((row) => ({
      matchedPartCount: toNumber(row.matched_part_count),
      project: {
        createdAt: toIsoTimestamp(row.project_created_at),
        description: "",
        id: row.project_id,
        name: row.project_name,
        owner: null,
        projectKey: row.project_key,
        status: row.project_status as Project["status"],
        updatedAt: toIsoTimestamp(row.project_updated_at)
      },
      totalBlockPartCount: toNumber(row.total_block_part_count)
    }));

    return { dependencies, status: "available" };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Circuit block project dependencies read failed.", error);
  }
}

/** DatabaseAssetExportRow is one asset-in-bundle row from a JSONB manifest query. */
interface DatabaseAssetExportRow {
  bundle_id: string;
  bundle_format: string;
  bundle_created_at: Date | string;
  project_id: string;
  project_key: string;
  project_name: string;
  asset_id: string;
  asset_type: string;
  part_mpn: string;
  manufacturer_name: string;
  file_format: string | null;
}

/**
 * Finds export bundles that included assets for parts matching the query.
 */
async function readWhereUsedAssetExports(databasePool: Pool, parts: CircuitBlockPartCatalogSummary[]): Promise<WhereUsedAssetExportRecord[]> {
  if (parts.length === 0) {
    return [];
  }

  const mpns = parts.map((p) => p.mpn);

  const result = await databasePool.query<DatabaseAssetExportRow>(
    `
      SELECT
        eb.id AS bundle_id,
        eb.bundle_format,
        eb.created_at AS bundle_created_at,
        eb.project_id,
        proj.project_key,
        proj.name AS project_name,
        asset_item->>'assetId' AS asset_id,
        asset_item->>'assetType' AS asset_type,
        asset_item->>'partMpn' AS part_mpn,
        asset_item->>'manufacturerName' AS manufacturer_name,
        asset_item->>'fileFormat' AS file_format
      FROM export_bundles eb
      JOIN projects proj ON proj.id = eb.project_id,
      LATERAL jsonb_array_elements(eb.manifest->'includedAssets') AS asset_item
      WHERE asset_item->>'partMpn' = ANY($1::text[])
      ORDER BY eb.created_at DESC
      LIMIT 50
    `,
    [mpns]
  );

  return result.rows.map((row) => ({
    assetId: row.asset_id,
    assetType: row.asset_type,
    bundleCreatedAt: toIsoTimestamp(row.bundle_created_at),
    bundleFormat: row.bundle_format as WhereUsedAssetExportRecord["bundleFormat"],
    bundleId: row.bundle_id,
    fileFormat: row.file_format,
    manufacturerName: row.manufacturer_name,
    partMpn: row.part_mpn,
    projectId: row.project_id,
    projectKey: row.project_key,
    projectName: row.project_name
  }));
}

/**
 * Finds connector parts and their mates for the global where-used connector-set search.
 */
async function readWhereUsedConnectorMatches(databasePool: Pool, query: string): Promise<CircuitBlockPartCatalogSummary[]> {
  const connectors = await databasePool.query<DatabaseWhereUsedPartSummaryRow>(
    `
      SELECT
        p.id AS part_id,
        p.mpn,
        m.name AS manufacturer_name,
        p.lifecycle_status,
        pa.approval_status,
        prs.readiness_status,
        prs.connector_class,
        prs.blocker_count
      FROM parts p
      JOIN manufacturers m ON m.id = p.manufacturer_id
      LEFT JOIN part_approvals pa ON pa.part_id = p.id
      LEFT JOIN part_readiness_summaries prs ON prs.part_id = p.id
      WHERE prs.connector_class IS NOT NULL
        AND (LOWER(p.id) = LOWER($1) OR LOWER(p.mpn) = LOWER($1) OR LOWER(p.mpn) LIKE '%' || LOWER($1) || '%')
      ORDER BY
        CASE WHEN LOWER(p.mpn) = LOWER($1) THEN 0 ELSE 1 END,
        p.mpn ASC
      LIMIT 12
    `,
    [query]
  );

  const matchedConnectors = connectors.rows.map(mapWhereUsedPartSummaryRow);

  if (matchedConnectors.length === 0) {
    return [];
  }

  const connectorPartIds = matchedConnectors.map((c) => c.partId);

  const mates = await databasePool.query<DatabaseWhereUsedPartSummaryRow>(
    `
      SELECT DISTINCT
        p.id AS part_id,
        p.mpn,
        m.name AS manufacturer_name,
        p.lifecycle_status,
        pa.approval_status,
        prs.readiness_status,
        prs.connector_class,
        prs.blocker_count
      FROM mate_relations mr
      JOIN parts p ON p.id = mr.mate_part_id
      JOIN manufacturers m ON m.id = p.manufacturer_id
      LEFT JOIN part_approvals pa ON pa.part_id = p.id
      LEFT JOIN part_readiness_summaries prs ON prs.part_id = p.id
      WHERE mr.part_id = ANY($1::text[])
        AND mr.relationship_type IN ('best_mate', 'alternate_mate')
      ORDER BY p.mpn ASC
      LIMIT 24
    `,
    [connectorPartIds]
  );

  const mateIds = new Set(matchedConnectors.map((c) => c.partId));
  const dedupedMates = mates.rows.map(mapWhereUsedPartSummaryRow).filter((m) => !mateIds.has(m.partId));

  return [...matchedConnectors, ...dedupedMates];
}

// ---------------------------------------------------------------------------
// P2-FUNC13: Part substitution management
// ---------------------------------------------------------------------------

/** SUBSTITUTION_BOUNDARY_COPY is the trust boundary surfaced wherever substitutions appear. */
const SUBSTITUTION_BOUNDARY_COPY =
  "Approved substitutions are decision records signed off by an engineer. They do not change part approval, validation, lifecycle, or export readiness.";

/** DatabasePartSubstitutionRow is one persisted substitution record joined with both catalog identities. */
interface DatabasePartSubstitutionRow {
  id: string;
  original_part_id: string;
  substitute_part_id: string;
  scope: PartSubstitutionScope;
  project_id: string | null;
  signoff_notes: string;
  approved_by: string;
  approval_status: PartSubstitutionStatus;
  created_at: Date | string;
  revoked_at: Date | string | null;
  revoked_by: string | null;
  original_part_mpn: string;
  original_manufacturer_name: string;
  substitute_part_mpn: string;
  substitute_manufacturer_name: string;
  project_name: string | null;
}

/**
 * Persists one engineering-signed-off substitution after validating both parts and (when scoped) the project.
 */
export async function createPartSubstitutionInDatabase(
  originalPartId: string,
  input: PartSubstitutionCreateInput,
  approvedBy: string
): Promise<PartSubstitutionCreateResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const validation = validatePartSubstitutionInput(originalPartId, input);
  if (validation) {
    return validation;
  }

  const scope: PartSubstitutionScope = input.scope;
  const projectId = scope === "project" ? input.projectId ?? null : null;
  const signoffNotes = (input.signoffNotes ?? "").trim();

  try {
    const partsCheck = await databasePool.query<{ id: string }>(
      "SELECT id FROM parts WHERE id IN ($1, $2)",
      [originalPartId, input.substitutePartId]
    );
    const foundIds = new Set(partsCheck.rows.map((row) => row.id));
    if (!foundIds.has(originalPartId)) {
      return { status: "not_found", code: "ORIGINAL_PART_NOT_FOUND", message: "The original part does not exist." };
    }
    if (!foundIds.has(input.substitutePartId)) {
      return { status: "not_found", code: "SUBSTITUTE_PART_NOT_FOUND", message: "The substitute part does not exist." };
    }

    if (projectId !== null) {
      const projectCheck = await databasePool.query<{ id: string }>("SELECT id FROM projects WHERE id = $1", [projectId]);
      if (projectCheck.rowCount === 0) {
        return { status: "not_found", code: "PROJECT_NOT_FOUND", message: "Scoped project not found." };
      }
    }

    const duplicateCheck = await databasePool.query<{ id: string }>(
      `SELECT id FROM part_substitutions
         WHERE approval_status = 'approved'
           AND original_part_id = $1
           AND substitute_part_id = $2
           AND COALESCE(project_id, '') = COALESCE($3, '')`,
      [originalPartId, input.substitutePartId, projectId]
    );
    if ((duplicateCheck.rowCount ?? 0) > 0) {
      return {
        status: "conflict",
        message: "An approved substitution already exists for this original/substitute/scope combination."
      };
    }

    const id = `psub-${randomUUID()}`;
    const now = new Date();
    await databasePool.query(
      `INSERT INTO part_substitutions
         (id, original_part_id, substitute_part_id, scope, project_id, signoff_notes, approved_by, approval_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8)`,
      [id, originalPartId, input.substitutePartId, scope, projectId, signoffNotes, approvedBy, now]
    );

    const summary = await readOnePartSubstitutionSummary(databasePool, id);
    if (!summary) {
      throw new CatalogStoreError("query_failed", "Substitution insert returned no row.", new Error("missing_substitution_row"));
    }

    // Passive capture: approving a substitute is an engineering decision worth remembering on the
    // original part. Drafted as a proposed suggestion; one Confirm turns it into durable memory.
    await autoDraftPartEngineeringRecord(databasePool, {
      dedupeKey: id,
      detail: signoffNotes,
      draftSource: "auto_substitution",
      partId: originalPartId,
      recordKind: "decision_blocked",
      recordedBy: approvedBy,
      severity: "info",
      title: `Substitute approved → ${summary.substitutePartMpn} (${scope})`,
      triggerRef: id
    });

    return {
      status: "created",
      response: {
        boundary: SUBSTITUTION_BOUNDARY_COPY,
        substitution: summary
      }
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Reads every active and revoked substitution that touches one part as either side.
 */
export async function readPartSubstitutionsForPartFromDatabase(partId: string): Promise<PartSubstitutionListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const partCheck = await databasePool.query<{ id: string }>("SELECT id FROM parts WHERE id = $1", [partId]);
    if (partCheck.rowCount === 0) {
      return { status: "not_found" };
    }

    const result = await databasePool.query<DatabasePartSubstitutionRow>(
      `${PART_SUBSTITUTION_SELECT_SQL}
         WHERE ps.original_part_id = $1 OR ps.substitute_part_id = $1
         ORDER BY ps.approval_status ASC, ps.created_at DESC`,
      [partId]
    );
    const summaries = result.rows.map(mapPartSubstitutionSummary);

    return {
      status: "available",
      response: {
        active: summaries.filter((entry) => entry.substitution.approvalStatus === "approved"),
        boundary: SUBSTITUTION_BOUNDARY_COPY,
        partId,
        revoked: summaries.filter((entry) => entry.substitution.approvalStatus === "revoked")
      }
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Marks one previously-approved substitution as revoked while preserving the audit trail.
 */
export async function revokePartSubstitutionInDatabase(
  substitutionId: string,
  revokedBy: string
): Promise<PartSubstitutionRevokeResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const existing = await databasePool.query<{ id: string; approval_status: PartSubstitutionStatus }>(
      "SELECT id, approval_status FROM part_substitutions WHERE id = $1",
      [substitutionId]
    );
    if (existing.rowCount === 0) {
      return { status: "not_found" };
    }
    if (existing.rows[0]!.approval_status === "revoked") {
      return {
        status: "invalid",
        code: "ALREADY_REVOKED",
        message: "This substitution has already been revoked."
      };
    }

    const now = new Date();
    await databasePool.query(
      "UPDATE part_substitutions SET approval_status = 'revoked', revoked_at = $2, revoked_by = $3 WHERE id = $1",
      [substitutionId, now, revokedBy]
    );

    const summary = await readOnePartSubstitutionSummary(databasePool, substitutionId);
    if (!summary) {
      throw new CatalogStoreError("query_failed", "Substitution revoke returned no row.", new Error("missing_substitution_row"));
    }

    return {
      status: "revoked",
      response: {
        boundary: SUBSTITUTION_BOUNDARY_COPY,
        substitution: summary
      }
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Validates incoming substitution input against the obvious self/scope/projectId rules.
 */
function validatePartSubstitutionInput(
  originalPartId: string,
  input: PartSubstitutionCreateInput
): { status: "invalid"; code: string; message: string } | null {
  if (!originalPartId || originalPartId.trim() === "") {
    return { status: "invalid", code: "ORIGINAL_PART_ID_REQUIRED", message: "Original part id is required." };
  }
  if (!input.substitutePartId || input.substitutePartId.trim() === "") {
    return { status: "invalid", code: "SUBSTITUTE_PART_ID_REQUIRED", message: "Substitute part id is required." };
  }
  if (input.substitutePartId === originalPartId) {
    return { status: "invalid", code: "SELF_SUBSTITUTION", message: "A part cannot be its own substitute." };
  }
  if (input.scope !== "global" && input.scope !== "project") {
    return { status: "invalid", code: "INVALID_SCOPE", message: "scope must be 'global' or 'project'." };
  }
  if (input.scope === "project" && (!input.projectId || input.projectId.trim() === "")) {
    return {
      status: "invalid",
      code: "PROJECT_ID_REQUIRED",
      message: "projectId is required for project-scoped substitutions."
    };
  }
  if (input.scope === "global" && input.projectId) {
    return {
      status: "invalid",
      code: "PROJECT_ID_NOT_ALLOWED",
      message: "projectId must be omitted for global substitutions."
    };
  }
  return null;
}

/**
 * Reads one substitution row joined with catalog identity for both sides.
 */
async function readOnePartSubstitutionSummary(
  databasePool: Pool | PoolClient,
  substitutionId: string
): Promise<PartSubstitutionSummary | null> {
  const result = await databasePool.query<DatabasePartSubstitutionRow>(
    `${PART_SUBSTITUTION_SELECT_SQL} WHERE ps.id = $1`,
    [substitutionId]
  );
  return result.rows[0] ? mapPartSubstitutionSummary(result.rows[0]) : null;
}

/** PART_SUBSTITUTION_SELECT_SQL is the shared join used wherever substitutions are read. */
const PART_SUBSTITUTION_SELECT_SQL = `
  SELECT
    ps.id, ps.original_part_id, ps.substitute_part_id, ps.scope, ps.project_id,
    ps.signoff_notes, ps.approved_by, ps.approval_status, ps.created_at, ps.revoked_at, ps.revoked_by,
    op.mpn AS original_part_mpn, om.name AS original_manufacturer_name,
    sp.mpn AS substitute_part_mpn, sm.name AS substitute_manufacturer_name,
    pr.name AS project_name
  FROM part_substitutions ps
  JOIN parts op ON op.id = ps.original_part_id
  JOIN manufacturers om ON om.id = op.manufacturer_id
  JOIN parts sp ON sp.id = ps.substitute_part_id
  JOIN manufacturers sm ON sm.id = sp.manufacturer_id
  LEFT JOIN projects pr ON pr.id = ps.project_id
`;

/**
 * Maps a database substitution row into the shared summary type.
 */
function mapPartSubstitutionSummary(row: DatabasePartSubstitutionRow): PartSubstitutionSummary {
  const substitution: PartSubstitution = {
    approvalStatus: row.approval_status,
    approvedBy: row.approved_by,
    createdAt: toIsoTimestamp(row.created_at),
    id: row.id,
    originalPartId: row.original_part_id,
    projectId: row.project_id,
    revokedAt: row.revoked_at ? toIsoTimestamp(row.revoked_at) : null,
    revokedBy: row.revoked_by,
    scope: row.scope,
    signoffNotes: row.signoff_notes,
    substitutePartId: row.substitute_part_id
  };
  return {
    originalManufacturerName: row.original_manufacturer_name,
    originalPartMpn: row.original_part_mpn,
    projectName: row.project_name,
    substituteManufacturerName: row.substitute_manufacturer_name,
    substitutePartMpn: row.substitute_part_mpn,
    substitution
  };
}

/**
 * Looks up approved substitutions whose either side matches a raw BOM MPN, scoped to a project + global.
 */
async function readApprovedSubstituteHintsForRawMpn(
  databasePool: Pool | PoolClient,
  rawMpn: string,
  projectId: string
): Promise<ApprovedSubstituteHint[]> {
  const normalized = rawMpn.trim();
  if (!normalized) {
    return [];
  }
  const result = await databasePool.query<{
    id: string;
    scope: PartSubstitutionScope;
    approved_by: string;
    signoff_notes: string;
    candidate_part_id: string;
    candidate_part_mpn: string;
    candidate_manufacturer_name: string;
  }>(
    `WITH matched AS (
       SELECT id FROM parts WHERE LOWER(mpn) = LOWER($1)
     )
     SELECT ps.id, ps.scope, ps.approved_by, ps.signoff_notes,
            sp.id AS candidate_part_id, sp.mpn AS candidate_part_mpn, sm.name AS candidate_manufacturer_name
       FROM part_substitutions ps
       JOIN matched m ON m.id = ps.original_part_id
       JOIN parts sp ON sp.id = ps.substitute_part_id
       JOIN manufacturers sm ON sm.id = sp.manufacturer_id
       WHERE ps.approval_status = 'approved'
         AND (ps.scope = 'global' OR ps.project_id = $2)
     UNION
     SELECT ps.id, ps.scope, ps.approved_by, ps.signoff_notes,
            op.id AS candidate_part_id, op.mpn AS candidate_part_mpn, om.name AS candidate_manufacturer_name
       FROM part_substitutions ps
       JOIN matched m ON m.id = ps.substitute_part_id
       JOIN parts op ON op.id = ps.original_part_id
       JOIN manufacturers om ON om.id = op.manufacturer_id
       WHERE ps.approval_status = 'approved'
         AND (ps.scope = 'global' OR ps.project_id = $2)`,
    [normalized, projectId]
  );
  return result.rows.map((row) => ({
    approvedBy: row.approved_by,
    candidateManufacturerName: row.candidate_manufacturer_name,
    candidatePartId: row.candidate_part_id,
    candidatePartMpn: row.candidate_part_mpn,
    scope: row.scope,
    signoffNotes: row.signoff_notes,
    substitutionId: row.id
  }));
}

// ---------------------------------------------------------------------------
// P1-FUNC11: Circuit block instantiation into project BOM
// ---------------------------------------------------------------------------

/** DatabaseCircuitBlockInstantiationRow is the persisted instantiation envelope. */
interface DatabaseCircuitBlockInstantiationRow {
  id: string;
  circuit_block_id: string;
  project_id: string;
  project_revision_id: string;
  bom_import_id: string;
  include_optional: boolean;
  designator_prefix: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date | string;
}

/** DatabaseCircuitBlockInstantiationHistoryRow joins an instantiation event with its project, revision, BOM import, and BOM line count. */
interface DatabaseCircuitBlockInstantiationHistoryRow {
  inst_id: string;
  inst_circuit_block_id: string;
  inst_project_id: string;
  inst_project_revision_id: string;
  inst_bom_import_id: string;
  inst_include_optional: boolean;
  inst_designator_prefix: string | null;
  inst_notes: string | null;
  inst_created_by: string | null;
  inst_created_at: Date | string;
  project_id: string;
  project_key: string;
  project_name: string;
  project_description: string;
  project_owner: string | null;
  project_status: Project["status"];
  project_created_at: Date | string;
  project_updated_at: Date | string;
  revision_id: string;
  revision_project_id: string;
  revision_label: string;
  revision_status: ProjectRevision["revisionStatus"];
  revision_source_reference: string | null;
  revision_released_at: Date | string | null;
  revision_created_at: Date | string;
  revision_updated_at: Date | string;
  bom_import_id: string | null;
  bom_import_project_id: string | null;
  bom_import_project_revision_id: string | null;
  bom_import_source_filename: string | null;
  bom_import_source_format: string | null;
  bom_import_storage_key: string | null;
  bom_import_status: string | null;
  bom_import_column_mapping: unknown;
  bom_import_summary: unknown;
  bom_import_imported_by: string | null;
  bom_import_created_at: Date | string | null;
  bom_import_updated_at: Date | string | null;
  bom_line_count: string | number;
}

/** DatabaseCircuitBlockPartLookupRow is the part-role row used to build instantiated BOM lines. */
interface DatabaseCircuitBlockPartLookupRow {
  id: string;
  circuit_block_id: string;
  part_id: string;
  role: string;
  quantity: string | number | null;
  is_required: boolean;
  notes: string | null;
  part_mpn: string;
  part_manufacturer_name: string;
}

/**
 * Generates a synthetic BOM import for one circuit block instantiation, with confirmed-match BOM lines and usage records.
 */
export async function instantiateCircuitBlockIntoProjectBomInDatabase(
  projectId: string,
  input: CircuitBlockInstantiationCreateInput,
  createdBy: string
): Promise<CircuitBlockInstantiationCreateResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const validation = validateInstantiationInput(input);
  if (validation) {
    return validation;
  }

  const includeOptional = input.includeOptional === true;
  const designatorPrefix = normalizeDesignatorPrefix(input.designatorPrefix ?? null);
  const notes = (input.notes ?? null)?.trim() || null;

  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");

    if (!(await projectExists(client, projectId))) {
      await client.query("ROLLBACK");
      return { status: "not_found", code: "PROJECT_NOT_FOUND", message: "Project not found." };
    }

    const revisionResult = await client.query<{ id: string; project_id: string }>(
      "SELECT id, project_id FROM project_revisions WHERE id = $1 AND project_id = $2",
      [input.projectRevisionId, projectId]
    );
    if (revisionResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return {
        status: "not_found",
        code: "PROJECT_REVISION_NOT_FOUND",
        message: "Project revision not found on this project."
      };
    }

    const blockResult = await client.query<{ id: string; name: string; block_key: string }>(
      "SELECT id, name, block_key FROM circuit_blocks WHERE id = $1",
      [input.circuitBlockId]
    );
    if (blockResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "not_found", code: "CIRCUIT_BLOCK_NOT_FOUND", message: "Circuit block not found." };
    }
    const block = blockResult.rows[0]!;

    const blockPartsResult = await client.query<DatabaseCircuitBlockPartLookupRow>(
      `SELECT cbp.id, cbp.circuit_block_id, cbp.part_id, cbp.role, cbp.quantity, cbp.is_required, cbp.notes,
              p.mpn AS part_mpn, m.name AS part_manufacturer_name
         FROM circuit_block_parts cbp
         JOIN parts p ON p.id = cbp.part_id
         JOIN manufacturers m ON m.id = p.manufacturer_id
         WHERE cbp.circuit_block_id = $1
         ORDER BY cbp.is_required DESC, cbp.role ASC, cbp.id ASC`,
      [input.circuitBlockId]
    );
    const allRoles = blockPartsResult.rows;
    const eligibleRoles = includeOptional ? allRoles : allRoles.filter((row) => row.is_required);

    if (eligibleRoles.length === 0) {
      await client.query("ROLLBACK");
      return {
        status: "invalid",
        code: "CIRCUIT_BLOCK_HAS_NO_ELIGIBLE_PARTS",
        message: includeOptional
          ? "The circuit block has no part roles to instantiate."
          : "The circuit block has no required part roles. Toggle includeOptional to instantiate optional parts."
      };
    }

    const now = new Date();
    const bomImportId = `bomimp-${randomUUID()}`;
    const importSummary = {
      circuitBlockId: input.circuitBlockId,
      circuitBlockKey: block.block_key,
      circuitBlockName: block.name,
      createdBy: "p1-func11",
      includeOptional,
      instantiatedRoleCount: eligibleRoles.length,
      matchStatus: "processed",
      persistedLineCount: eligibleRoles.length
    };
    const bomImportResult = await client.query<DatabaseBomImportRow>(
      `INSERT INTO bom_imports (id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'manual', NULL, 'processed', '{}'::jsonb, $5::jsonb, $6, $7, $7)
         RETURNING id, project_id, project_revision_id, source_filename, source_format, storage_key, import_status, column_mapping, import_summary, imported_by, created_at, updated_at`,
      [
        bomImportId,
        projectId,
        input.projectRevisionId,
        `Circuit block: ${block.name} (${block.block_key})`,
        JSON.stringify(importSummary),
        createdBy,
        now
      ]
    );
    const bomImportRow = bomImportResult.rows[0];

    if (!bomImportRow) {
      await client.query("ROLLBACK");
      throw new CatalogStoreError("query_failed", "Circuit block instantiation produced no BOM import row.", new Error("missing_bom_import_row"));
    }

    const savedLines: BomLine[] = [];

    for (let index = 0; index < eligibleRoles.length; index += 1) {
      const role = eligibleRoles[index]!;
      const rowNumber = index + 1;
      const quantity = toNullableNumber(role.quantity ?? null);
      const designators = buildInstantiatedDesignators(designatorPrefix, rowNumber, quantity);
      const rawRowPayload = {
        circuitBlockId: input.circuitBlockId,
        circuitBlockPartId: role.id,
        circuitBlockPartRole: role.role,
        instantiationOrigin: "p1-func11",
        isRequired: role.is_required
      };
      const lineResult = await client.query<DatabaseBomLineRow>(
        `INSERT INTO bom_lines (id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes, raw_row_payload, matched_part_id, match_status, match_confidence_score, instantiated_from_circuit_block_id, instantiated_from_circuit_block_part_id, instantiated_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12::jsonb, $13, 'matched', 1, $14, $15, $16, $16, $16)
           RETURNING id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity, raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes, raw_row_payload, matched_part_id, match_status, match_confidence_score, instantiated_from_circuit_block_id, instantiated_from_circuit_block_part_id, instantiated_at, created_at, updated_at`,
        [
          `bomline-${randomUUID()}`,
          bomImportId,
          projectId,
          input.projectRevisionId,
          rowNumber,
          designators,
          quantity,
          role.part_mpn,
          role.part_manufacturer_name,
          `Instantiated from circuit block ${block.name} role: ${role.role}`,
          role.notes,
          JSON.stringify(rawRowPayload),
          role.part_id,
          input.circuitBlockId,
          role.id,
          now
        ]
      );
      const lineRow = lineResult.rows[0];

      if (!lineRow) {
        await client.query("ROLLBACK");
        throw new CatalogStoreError("query_failed", "Circuit block instantiation produced no BOM line row.", new Error("missing_bom_line_row"));
      }

      const persistedLine = mapBomLineRow(lineRow);
      savedLines.push(persistedLine);
      const rolePrefetch: MatchUsagePrefetch = {
        approvalRowByPart: await prefetchPartApprovalRows(client, [role.part_id]),
        readinessRowByPart: await prefetchPartReadinessRows(client, [role.part_id]),
        usageIdByBomLine: await prefetchProjectPartUsageIdsByBomLine(client, [persistedLine.id])
      };
      await upsertProjectPartUsageForMatchedLine(client, persistedLine, role.part_id, now, rolePrefetch);
    }

    const instantiationId = `cbinst-${randomUUID()}`;
    const instantiationResult = await client.query<DatabaseCircuitBlockInstantiationRow>(
      `INSERT INTO circuit_block_instantiations (id, circuit_block_id, project_id, project_revision_id, bom_import_id, include_optional, designator_prefix, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, circuit_block_id, project_id, project_revision_id, bom_import_id, include_optional, designator_prefix, notes, created_by, created_at`,
      [
        instantiationId,
        input.circuitBlockId,
        projectId,
        input.projectRevisionId,
        bomImportId,
        includeOptional,
        designatorPrefix,
        notes,
        createdBy,
        now
      ]
    );
    const instantiationRow = instantiationResult.rows[0];

    if (!instantiationRow) {
      await client.query("ROLLBACK");
      throw new CatalogStoreError("query_failed", "Circuit block instantiation produced no record row.", new Error("missing_instantiation_row"));
    }

    await client.query("UPDATE project_revisions SET updated_at = $2 WHERE id = $1", [input.projectRevisionId, now]);
    await client.query("UPDATE projects SET updated_at = $2 WHERE id = $1", [projectId, now]);
    await client.query("COMMIT");

    return {
      status: "created",
      response: {
        bomImport: mapBomImportRow(bomImportRow),
        bomLines: savedLines,
        boundary:
          "Instantiated BOM lines mark these parts as confirmed usage. They do not change part approval, readiness, or export verification.",
        instantiation: mapCircuitBlockInstantiationRow(instantiationRow),
        matchedLineCount: savedLines.length,
        skippedOptionalCount: includeOptional ? 0 : allRoles.length - eligibleRoles.length
      }
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw toProjectMemoryStoreError(error);
  } finally {
    client.release();
  }
}

/**
 * Validates instantiation input for required identifiers and supplied prefix shape.
 */
function validateInstantiationInput(
  input: CircuitBlockInstantiationCreateInput
): { status: "invalid"; code: string; message: string } | null {
  if (!input.circuitBlockId || input.circuitBlockId.trim() === "") {
    return { status: "invalid", code: "CIRCUIT_BLOCK_ID_REQUIRED", message: "circuitBlockId is required." };
  }
  if (!input.projectRevisionId || input.projectRevisionId.trim() === "") {
    return { status: "invalid", code: "PROJECT_REVISION_ID_REQUIRED", message: "projectRevisionId is required." };
  }
  if (input.designatorPrefix !== undefined && input.designatorPrefix !== null) {
    if (typeof input.designatorPrefix !== "string") {
      return { status: "invalid", code: "INVALID_DESIGNATOR_PREFIX", message: "designatorPrefix must be a string." };
    }
    if (input.designatorPrefix.length > 16) {
      return {
        status: "invalid",
        code: "INVALID_DESIGNATOR_PREFIX",
        message: "designatorPrefix must be 16 characters or fewer."
      };
    }
  }
  return null;
}

/**
 * Normalizes a designator prefix, returning null when blank.
 */
function normalizeDesignatorPrefix(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Builds the designator list for one instantiated BOM line.
 * Auto-numbers when a prefix is provided so multi-quantity roles get distinct designators.
 */
function buildInstantiatedDesignators(prefix: string | null, rowNumber: number, quantity: number | null): string[] {
  if (!prefix) {
    return [];
  }
  const count = quantity && Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  const designators: string[] = [];
  const baseIndex = rowNumber === 1 ? 1 : (rowNumber - 1) * 1 + 1;
  for (let offset = 0; offset < count; offset += 1) {
    designators.push(`${prefix}${baseIndex + offset}`);
  }
  return designators;
}

/**
 * Maps a persisted instantiation row into the shared CircuitBlockInstantiation type.
 */
function mapCircuitBlockInstantiationRow(row: DatabaseCircuitBlockInstantiationRow): CircuitBlockInstantiation {
  return {
    bomImportId: row.bom_import_id,
    circuitBlockId: row.circuit_block_id,
    createdAt: toIsoTimestamp(row.created_at),
    createdBy: row.created_by,
    designatorPrefix: row.designator_prefix,
    id: row.id,
    includeOptional: row.include_optional,
    notes: row.notes,
    projectId: row.project_id,
    projectRevisionId: row.project_revision_id
  };
}

/**
 * Builds triage action hints for a BOM line based on its match status.
 */
function buildTriageActions(matchStatus: BomLineMatchStatus, rawMpn: string | null): string[] {
  switch (matchStatus) {
    case "matched":
      return [];
    case "unmatched":
      return rawMpn ? ["Import this part from a provider", "Add part manually if it exists internally"] : ["Add MPN to this row, then re-run matching"];
    case "weak_match":
      return ["Review candidate parts and confirm the correct match", "Re-run matching after adding manufacturer info"];
    case "ambiguous":
      return ["Review duplicate MPN candidates and confirm the correct part", "Resolve duplicate parts in the catalog first"];
    case "ignored":
      return ["Un-ignore this row if it requires a part match"];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// P2-FUNC15: Connector set catalog view
// ---------------------------------------------------------------------------

/** CONNECTOR_SET_BOUNDARY_COPY explains that the catalog view does not approve reuse or unlock export. */
const CONNECTOR_SET_BOUNDARY_COPY =
  "Connector set browsing is reference context. Listing a connector or mate pair does not approve the part, validate evidence, or unlock export readiness.";

/** ConnectorSetMaxConnectors caps the per-listing connector count so the page stays bounded. */
const CONNECTOR_SET_MAX_CONNECTORS = 200;

/** DatabaseConnectorRow is one connector part row joined to its current readiness/approval state. */
interface DatabaseConnectorRow {
  part_id: string;
  mpn: string;
  manufacturer_name: string;
  lifecycle_status: LifecycleStatus | null;
  approval_status: PartApprovalStatus | null;
  readiness_status: PartReadinessStatus | null;
  connector_class: ConnectorClass | null;
  blocker_count: string | number | null;
  project_usage_count: string | number;
}

/** DatabaseConnectorMateRow is one mate or alternate-mate row joined to its target part state. */
interface DatabaseConnectorMateRow {
  primary_part_id: string;
  mate_part_id: string;
  mate_mpn: string;
  mate_manufacturer_name: string;
  mate_lifecycle_status: LifecycleStatus | null;
  mate_approval_status: PartApprovalStatus | null;
  mate_readiness_status: PartReadinessStatus | null;
  mate_connector_class: ConnectorClass | null;
  relationship_type: "best_mate" | "alternate_mate";
  confidence_score: string | number | null;
  project_usage_count: string | number;
}

/**
 * Reads the connector set catalog grouped by `connector_class`, optionally filtered.
 * Reuses existing `parts`, `manufacturers`, `part_readiness_summaries`, `part_approvals`,
 * `mate_relations`, and `project_part_usages` tables. No new schema is created here.
 */
export async function readConnectorSetCatalogFromDatabase(
  filters: { connectorClass?: ConnectorClass | null; query?: string | null } = {}
): Promise<ConnectorSetListReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const connectorClassFilter = filters.connectorClass ?? null;
  const queryFilter = (filters.query ?? "").trim();
  const sqlParams: (string | number | null)[] = [];

  const whereClauses = ["prs.connector_class IS NOT NULL", "prs.connector_class <> 'non_connector'"];
  if (connectorClassFilter) {
    sqlParams.push(connectorClassFilter);
    whereClauses.push(`prs.connector_class = $${sqlParams.length}`);
  }
  if (queryFilter.length > 0) {
    sqlParams.push(queryFilter);
    const placeholder = `$${sqlParams.length}`;
    whereClauses.push(`(LOWER(p.mpn) LIKE '%' || LOWER(${placeholder}) || '%' OR LOWER(m.name) LIKE '%' || LOWER(${placeholder}) || '%')`);
  }
  sqlParams.push(CONNECTOR_SET_MAX_CONNECTORS);
  const limitPlaceholder = `$${sqlParams.length}`;

  try {
    const connectors = await databasePool.query<DatabaseConnectorRow>(
      `
        SELECT
          p.id AS part_id,
          p.mpn,
          m.name AS manufacturer_name,
          p.lifecycle_status,
          pa.approval_status,
          prs.readiness_status,
          prs.connector_class,
          prs.blocker_count,
          COALESCE(usage_counts.usage_count, 0)::text AS project_usage_count
        FROM parts p
        JOIN manufacturers m ON m.id = p.manufacturer_id
        JOIN part_readiness_summaries prs ON prs.part_id = p.id
        LEFT JOIN part_approvals pa ON pa.part_id = p.id
        LEFT JOIN (
          SELECT part_id, COUNT(*) AS usage_count
          FROM project_part_usages
          GROUP BY part_id
        ) usage_counts ON usage_counts.part_id = p.id
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY prs.connector_class ASC, m.name ASC, p.mpn ASC
        LIMIT ${limitPlaceholder}
      `,
      sqlParams
    );

    const connectorEntries = connectors.rows.map(mapConnectorRow);
    const connectorIds = connectorEntries.map((entry) => entry.partId);

    let mateRows: DatabaseConnectorMateRow[] = [];
    if (connectorIds.length > 0) {
      const mateResult = await databasePool.query<DatabaseConnectorMateRow>(
        `
          SELECT
            mr.part_id AS primary_part_id,
            mp.id AS mate_part_id,
            mp.mpn AS mate_mpn,
            mm.name AS mate_manufacturer_name,
            mp.lifecycle_status AS mate_lifecycle_status,
            mpa.approval_status AS mate_approval_status,
            mprs.readiness_status AS mate_readiness_status,
            mprs.connector_class AS mate_connector_class,
            mr.relationship_type,
            mr.confidence_score,
            COALESCE(mate_usage.usage_count, 0)::text AS project_usage_count
          FROM mate_relations mr
          JOIN parts mp ON mp.id = mr.mate_part_id
          JOIN manufacturers mm ON mm.id = mp.manufacturer_id
          LEFT JOIN part_approvals mpa ON mpa.part_id = mp.id
          LEFT JOIN part_readiness_summaries mprs ON mprs.part_id = mp.id
          LEFT JOIN (
            SELECT part_id, COUNT(*) AS usage_count
            FROM project_part_usages
            GROUP BY part_id
          ) mate_usage ON mate_usage.part_id = mp.id
          WHERE mr.part_id = ANY($1::text[])
            AND mr.relationship_type IN ('best_mate', 'alternate_mate')
          ORDER BY mr.part_id ASC,
            CASE mr.relationship_type WHEN 'best_mate' THEN 0 ELSE 1 END,
            mp.mpn ASC
        `,
        [connectorIds]
      );
      mateRows = mateResult.rows;
    }

    const matesByConnector = new Map<string, ConnectorSetMatePair[]>();
    for (const row of mateRows) {
      const list = matesByConnector.get(row.primary_part_id) ?? [];
      list.push(mapConnectorMateRow(row));
      matesByConnector.set(row.primary_part_id, list);
    }

    const enriched = connectorEntries.map((entry) => ({
      ...entry,
      matePairs: matesByConnector.get(entry.partId) ?? []
    }));

    const groupsMap = new Map<ConnectorClass, ConnectorSetEntry[]>();
    for (const entry of enriched) {
      const list = groupsMap.get(entry.connectorClass) ?? [];
      list.push(entry);
      groupsMap.set(entry.connectorClass, list);
    }

    const groups: ConnectorSetClassGroup[] = Array.from(groupsMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([connectorClass, entries]) => ({ connectorClass, entries }));

    const totalMatePairCount = enriched.reduce((sum, entry) => sum + entry.matePairs.length, 0);

    return {
      status: "available",
      response: {
        boundary: CONNECTOR_SET_BOUNDARY_COPY,
        connectorClassFilter,
        groups,
        query: queryFilter.length > 0 ? queryFilter : null,
        state: enriched.length > 0 ? "available" : "empty",
        totalConnectorCount: enriched.length,
        totalMatePairCount
      }
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Maps a connector row into a typed list entry without mate context.
 */
function mapConnectorRow(row: DatabaseConnectorRow): ConnectorSetEntry {
  return {
    approvalStatus: row.approval_status,
    blockerCount: row.blocker_count === null ? null : toNumber(row.blocker_count),
    connectorClass: (row.connector_class ?? "connector") as ConnectorClass,
    lifecycleStatus: (row.lifecycle_status ?? "unknown") as LifecycleStatus,
    manufacturerName: row.manufacturer_name,
    matePairs: [],
    mpn: row.mpn,
    partId: row.part_id,
    projectUsageCount: toNumber(row.project_usage_count),
    readinessStatus: row.readiness_status
  };
}

/**
 * Maps a mate row into a typed mate-pair record for the catalog response.
 */
function mapConnectorMateRow(row: DatabaseConnectorMateRow): ConnectorSetMatePair {
  return {
    confidenceScore: row.confidence_score === null ? null : toNumber(row.confidence_score),
    matePartApprovalStatus: row.mate_approval_status,
    matePartConnectorClass: row.mate_connector_class,
    matePartId: row.mate_part_id,
    matePartLifecycleStatus: (row.mate_lifecycle_status ?? "unknown") as LifecycleStatus,
    matePartReadinessStatus: row.mate_readiness_status,
    mateManufacturerName: row.mate_manufacturer_name,
    mateMpn: row.mate_mpn,
    projectUsageCount: toNumber(row.project_usage_count),
    relationshipType: row.relationship_type
  };
}

// ---------------------------------------------------------------------------
// P2-FUNC16: Approval batch workflow from project BOM context
// ---------------------------------------------------------------------------

/** APPROVAL_BATCH_BOUNDARY_COPY clarifies that approval changes do not validate or export. */
const APPROVAL_BATCH_BOUNDARY_COPY =
  "Bulk approval records project context as the trigger. Approval state does not validate evidence, finalize CAD, or unlock export. Triggering this action records part-level approval rows only.";

/** APPROVAL_BATCH_MAX_PARTS caps a single batch so a runaway request cannot rewrite the catalog. */
const APPROVAL_BATCH_MAX_PARTS = 200;

/** DatabaseApprovalBatchSourceRow is one (part_id, bom_line_id, designators) source row collected before aggregation. */
interface DatabaseApprovalBatchSourceRow {
  part_id: string;
  bom_line_id: string | null;
  designators: unknown;
}

/** DatabaseApprovalBatchPartRow is one catalog identity joined to its current approval/lifecycle state. */
interface DatabaseApprovalBatchPartRow {
  part_id: string;
  mpn: string;
  manufacturer_name: string;
  approval_status: PartApprovalStatus | null;
  lifecycle_status: LifecycleStatus | null;
  readiness_status: PartReadinessStatus | null;
}

/**
 * Reads the project-scoped approval candidate queue: matched usage parts whose approval is missing.
 *
 * Source rows come from BOM lines (matched_part_id with match_status='matched') and confirmed
 * project_part_usages. Aggregation runs in JS to keep the SQL portable across pg-mem and Postgres.
 */
export async function readApprovalBatchCandidatesFromDatabase(projectId: string): Promise<ApprovalBatchCandidatesReadResult> {
  const databasePool = getProjectMemoryDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    if (!(await projectExists(databasePool, projectId))) {
      return { status: "not_found" };
    }

    const sourceRows = await databasePool.query<DatabaseApprovalBatchSourceRow>(
      `
        SELECT bl.matched_part_id AS part_id, bl.id AS bom_line_id, bl.designators
        FROM bom_lines bl
        WHERE bl.project_id = $1
          AND bl.match_status = 'matched'
          AND bl.matched_part_id IS NOT NULL
        UNION ALL
        SELECT ppu.part_id, ppu.bom_line_id, ppu.designators
        FROM project_part_usages ppu
        WHERE ppu.project_id = $1
      `,
      [projectId]
    );

    const aggregated = new Map<string, { bomLineIds: Set<string>; designators: Set<string> }>();
    for (const row of sourceRows.rows) {
      if (!row.part_id) continue;
      const bucket = aggregated.get(row.part_id) ?? { bomLineIds: new Set<string>(), designators: new Set<string>() };
      if (row.bom_line_id) bucket.bomLineIds.add(row.bom_line_id);
      for (const designator of toStringArray(row.designators)) {
        bucket.designators.add(designator);
      }
      aggregated.set(row.part_id, bucket);
    }

    const candidates: ApprovalBatchCandidate[] = [];
    for (const [partId, bucket] of aggregated.entries()) {
      const partRow = await databasePool.query<DatabaseApprovalBatchPartRow>(
        `
          SELECT
            p.id AS part_id,
            p.mpn,
            m.name AS manufacturer_name,
            pa.approval_status,
            p.lifecycle_status,
            prs.readiness_status
          FROM parts p
          JOIN manufacturers m ON m.id = p.manufacturer_id
          LEFT JOIN part_approvals pa ON pa.part_id = p.id
          LEFT JOIN part_readiness_summaries prs ON prs.part_id = p.id
          WHERE p.id = $1
          LIMIT 1
        `,
        [partId]
      );
      const row = partRow.rows[0];
      if (!row) continue;
      const approvalStatus = row.approval_status ?? null;
      if (approvalStatus === "approved") continue;
      candidates.push({
        approvalStatus,
        bomLineCount: bucket.bomLineIds.size,
        bomLineIds: Array.from(bucket.bomLineIds).sort(),
        designators: Array.from(bucket.designators).sort().slice(0, 24),
        lifecycleStatus: row.lifecycle_status,
        manufacturerName: row.manufacturer_name,
        mpn: row.mpn,
        partId: row.part_id,
        readinessStatus: row.readiness_status
      });
    }

    candidates.sort((a, b) => (a.manufacturerName ?? "").localeCompare(b.manufacturerName ?? "") || a.mpn.localeCompare(b.mpn));
    const limited = candidates.slice(0, APPROVAL_BATCH_MAX_PARTS);

    return {
      status: "available",
      response: {
        boundary: APPROVAL_BATCH_BOUNDARY_COPY,
        candidates: limited,
        generatedAt: new Date().toISOString(),
        projectId,
        state: limited.length > 0 ? "available" : "empty"
      }
    };
  } catch (error) {
    throw toProjectMemoryStoreError(error);
  }
}

/**
 * Applies a bulk approval action triggered from a project BOM context.
 *
 * `approve` upserts an `approved` row in `part_approvals` with project-context evidence.
 * `flag_for_review` upserts a `pending_review` row with the same evidence.
 *
 * Approval is the only state changed; readiness, asset validation, and export verification are not touched.
 * Approval triggered by this batch records project context in the evidence array so the decision is traceable.
 */
export async function applyApprovalBatchInDatabase(
  projectId: string,
  input: ApprovalBatchRequest,
  decidedBy: string
): Promise<ApprovalBatchActionResult> {
  const validation = validateApprovalBatchInput(input);
  if (validation) {
    return validation;
  }

  const databasePool = getProjectMemoryDatabasePool();
  if (!databasePool) {
    return { status: "not_configured" };
  }

  const partIds = Array.from(new Set(input.partIds.map((id) => id.trim()).filter((id) => id.length > 0)));

  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");

    if (!(await projectExists(client, projectId))) {
      await client.query("ROLLBACK");
      return { status: "not_found" };
    }

    const projectKeyResult = await client.query<{ project_key: string; name: string }>(
      "SELECT project_key, name FROM projects WHERE id = $1",
      [projectId]
    );
    const projectRow = projectKeyResult.rows[0];

    const existingMap = new Map<string, PartApprovalStatus>();
    const presentPartIds = new Set<string>();
    for (const partId of partIds) {
      const existing = await client.query<{ approval_status: PartApprovalStatus }>(
        "SELECT approval_status FROM part_approvals WHERE part_id = $1 LIMIT 1",
        [partId]
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        existingMap.set(partId, existingRow.approval_status);
      }
      const partsCheck = await client.query<{ id: string }>("SELECT id FROM parts WHERE id = $1 LIMIT 1", [partId]);
      if (partsCheck.rows.length > 0) {
        presentPartIds.add(partId);
      }
    }

    const targetStatus: PartApprovalStatus = input.action === "approve" ? "approved" : "pending_review";
    const summary = input.action === "approve"
      ? `Approved via project ${projectRow?.project_key ?? projectId} batch`
      : `Flagged for review via project ${projectRow?.project_key ?? projectId} batch`;
    const trimmedNotes = (input.notes ?? "").trim();
    const detail = trimmedNotes.length > 0
      ? `${summary}. Notes: ${trimmedNotes}`
      : `${summary}. No notes provided.`;
    const evidence = [
      `project:${projectId}`,
      `project_key:${projectRow?.project_key ?? "unknown"}`,
      `triggered_by:approval_batch`,
      `decided_by:${decidedBy}`
    ];
    const now = new Date();

    const outcomes: ApprovalBatchOutcome[] = [];
    let appliedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;

    for (const partId of partIds) {
      if (!presentPartIds.has(partId)) {
        notFoundCount += 1;
        outcomes.push({
          message: "Part not found in catalog.",
          newApprovalStatus: null,
          partId,
          previousApprovalStatus: null,
          status: "not_found"
        });
        continue;
      }

      const previous = existingMap.get(partId) ?? null;
      if (previous === targetStatus) {
        skippedCount += 1;
        outcomes.push({
          message: `Part already ${targetStatus.replace(/_/gu, " ")}.`,
          newApprovalStatus: targetStatus,
          partId,
          previousApprovalStatus: previous,
          status: targetStatus === "approved" ? "skipped_already_approved" : "skipped_no_change"
        });
        continue;
      }

      await client.query(
        `
          INSERT INTO part_approvals (part_id, approval_status, summary, detail, evidence, decided_by, decided_at, last_updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          ON CONFLICT (part_id) DO UPDATE SET
            approval_status = EXCLUDED.approval_status,
            summary = EXCLUDED.summary,
            detail = EXCLUDED.detail,
            evidence = EXCLUDED.evidence,
            decided_by = EXCLUDED.decided_by,
            decided_at = EXCLUDED.decided_at,
            last_updated_at = EXCLUDED.last_updated_at
        `,
        [partId, targetStatus, summary, detail, evidence, decidedBy, now]
      );

      appliedCount += 1;
      outcomes.push({
        message: `Approval status set to ${targetStatus.replace(/_/gu, " ")}.`,
        newApprovalStatus: targetStatus,
        partId,
        previousApprovalStatus: previous,
        status: "applied"
      });
    }

    await client.query("COMMIT");

    return {
      status: "applied",
      response: {
        action: input.action,
        appliedCount,
        boundary: APPROVAL_BATCH_BOUNDARY_COPY,
        notFoundCount,
        outcomes,
        projectId,
        skippedCount
      }
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw toProjectMemoryStoreError(error);
  } finally {
    client.release();
  }
}

/**
 * Validates an approval batch request body before any database work runs.
 */
function validateApprovalBatchInput(
  input: ApprovalBatchRequest
): { status: "invalid"; code: string; message: string } | null {
  if (!input || !Array.isArray(input.partIds) || input.partIds.length === 0) {
    return {
      code: "PART_IDS_REQUIRED",
      message: "Approval batch requires at least one partId.",
      status: "invalid"
    };
  }
  if (input.partIds.length > APPROVAL_BATCH_MAX_PARTS) {
    return {
      code: "TOO_MANY_PART_IDS",
      message: `Approval batch is limited to ${APPROVAL_BATCH_MAX_PARTS} parts per request.`,
      status: "invalid"
    };
  }
  if (input.action !== "approve" && input.action !== "flag_for_review") {
    return {
      code: "INVALID_ACTION",
      message: "Approval batch action must be 'approve' or 'flag_for_review'.",
      status: "invalid"
    };
  }
  for (const partId of input.partIds) {
    if (typeof partId !== "string" || partId.trim().length === 0) {
      return {
        code: "INVALID_PART_ID",
        message: "Every entry in partIds must be a non-empty string.",
        status: "invalid"
      };
    }
  }
  return null;
}
