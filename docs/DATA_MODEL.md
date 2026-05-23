# Data Model

This document describes the canonical target model. For current shipped entities and projections, use `docs/IMPLEMENTATION_STATUS.md`.

EE Library is not just a part catalog.

It is a **private engineering memory system for hardware teams**. Public provider and catalog data are input; the durable product value is the internal record of parts, BOMs, connectors, reusable circuit blocks, evidence, approvals, and risk over time.

The currently shipped foundation centers on part readiness. The planned model expands that foundation into project/BOM memory so the system can answer these questions clearly:

- What is the correct part?
- Is the part identity verified or ambiguous?
- Where has this part or connector set been used before?
- Which project or BOM introduced this decision?
- What mates with it?
- What other parts are required to build with it?
- Which engineering assets actually exist?
- How trustworthy are those assets?
- Can missing assets be recovered from source material?
- Which evidence supports the decision?
- Which reusable circuit blocks depend on this part?
- What risks exist across a full BOM?
- Are there near-match or family-confusion risks?
- Is this part approved for design use?
- Is this part truly ready for export into CAD workflows?

This data model is designed around **truth, provenance, compatibility, recovery, readiness, project memory, and risk** rather than naive part scraping.

---

## Design principles

- The database stores a **canonical part record**, not raw source chaos.
- Source-derived facts must be **traceable**.
- Provider imports must remain **explicitly attributable** and **freshness-aware**.
- Connector relationships are **structured records**, not text notes.
- Asset existence, trust, review, and export readiness must be **explicit**.
- Generated assets never pretend to be official.
- Missing assets should support **typed recovery workflows** when source material is sufficient.
- Part readiness is a **first-class concept**, not an implied side effect of import success.
- Part approval for engineering use is **separate** from asset review or source ingestion.
- Import failures must be captured honestly without implying that a canonical part was created.
- Project and BOM history should become **first-class memory**, not detached notes.
- Reusable circuit blocks should be **structured engineering knowledge**, not loose text.
- Planned project/BOM, where-used, circuit-block, evidence-vault, and BOM-health concepts must stay clearly labeled until shipped.

---

## Core identity entities

### Manufacturer
Represents the canonical manufacturer identity.

Fields:
- `id`
- `name`
- `aliases`
- `website`
- `created_at`
- `updated_at`

### Provider
Represents an external or internal source of part data or assets.

Fields:
- `id`
- `name`
- `provider_type` (`distributor`, `manufacturer`, `internal_catalog`, `external_asset_source`)
- `base_url`
- `trust_rank`
- `is_active`
- `created_at`
- `updated_at`

Purpose:
- normalizes provider identity across imports, sourcing views, and asset provenance
- allows provider-neutral UI and workflow logic

### Part
Represents the canonical engineering part record.

Fields:
- `id`
- `mpn`
- `manufacturer_id`
- `category`
- `subcategory`
- `description`
- `lifecycle_status`
- `package_id`
- `connector_family_id` (nullable)
- `trust_score`
- `created_at`
- `updated_at`

Purpose:
- is the canonical part identity used across readiness, assets, sourcing, and compatibility workflows
- does not assume the part is automatically ready for engineering use

### Package
Represents the canonical package or mechanical identity for a part.

Fields:
- `id`
- `package_name`
- `pin_count`
- `pitch_mm`
- `body_length_mm`
- `body_width_mm`
- `body_height_mm`
- `mounting_style`
- `notes`
- `created_at`
- `updated_at`

---

## Source truth entities

### SourceRecord
Represents a normalized source snapshot used to derive facts for a part.

Fields:
- `id`
- `part_id` (nullable)
- `provider_id`
- `provider_part_key`
- `provider_mpn`
- `source_url`
- `source_kind` (`provider_catalog`, `manufacturer_page`, `external_asset_source`, `internal_catalog`)
- `fetched_at`
- `normalized_at`
- `source_last_seen_at`
- `source_last_imported_at`
- `import_status` (`pending`, `imported`, `failed`, `skipped`)
- `import_error_code`
- `import_error_details`
- `raw_payload`
- `last_updated_at`

Purpose:
- provides provenance for metrics, relationships, and assets
- allows conflict handling and source freshness tracking
- records provider import failures without implying a canonical part was created
- preserves provider-specific context while keeping the core part record normalized

### SupplyOffering
Represents a provider-specific commercial or sourcing view of a part.

Fields:
- `id`
- `part_id`
- `provider_id`
- `source_record_id`
- `provider_part_key`
- `provider_sku`
- `inventory_status`
- `inventory_quantity`
- `moq`
- `lead_time_days`
- `packaging`
- `currency_code`
- `preferred_rank`
- `last_seen_at`
- `created_at`
- `updated_at`

Purpose:
- captures provider-specific sourcing data without polluting the canonical part record
- supports preferred-vendor and local-catalog workflows
- helps distinguish engineering truth from commercial availability

### PriceBreak
Represents one provider price tier for a supply offering.

Fields:
- `id`
- `supply_offering_id`
- `min_quantity`
- `unit_price`
- `currency_code`
- `captured_at`

Purpose:
- supports lightweight sourcing visibility while remaining provider-specific

### PartMetric
Represents a normalized technical metric for a part.

Fields:
- `id`
- `part_id`
- `metric_key`
- `metric_value`
- `unit`
- `min_value`
- `max_value`
- `confidence_score`
- `source_record_id`
- `created_at`
- `updated_at`

Examples:
- voltage input max
- current output
- ESR range
- operating temperature
- insertion cycles
- contact resistance

Purpose:
- stores normalized engineering facts with explicit provenance and confidence

---

## Engineering asset entities

### Asset
Represents a known engineering asset or asset reference for a part.

Fields:
- `id`
- `part_id`
- `asset_type` (`datasheet`, `footprint`, `symbol`, `three_d_model`, `mechanical_drawing`)
- `file_format`
- `storage_key`
- `external_url`
- `file_hash`
- `license_mode`
- `provenance`
- `availability_status`
- `review_status`
- `export_status`
- `validation_status`
- `preview_status`
- `generation_method`
- `generation_source_asset_id`
- `source_record_id`
- `created_at`
- `updated_at`

Purpose:
- represents both local and referenced engineering assets
- keeps asset truth and usability explicit

### Asset provenance
Allowed values:
- `official`
- `trusted_external`
- `generated`
- `manual_internal`

### Asset availability status
Allowed values:
- `missing`
- `referenced`
- `downloaded`
- `validated`
- `failed`

Purpose:
- answers whether the asset actually exists and is usable locally

### Asset review status
Allowed values:
- `not_reviewed`
- `review_required`
- `approved`
- `rejected`
- `changes_requested`

Purpose:
- separates review truth from raw availability truth

### Asset export status
Allowed values:
- `not_exportable`
- `partially_exportable`
- `verified_for_export`

Purpose:
- prevents vague or misleading “download/export” claims

### DatasheetRevision
Represents a specific datasheet revision linked to a part.

Fields:
- `id`
- `part_id`
- `revision_label`
- `revision_date`
- `page_count`
- `file_asset_id`
- `parse_confidence`
- `source_record_id`
- `created_at`
- `updated_at`

Purpose:
- gives generation and review workflows a traceable datasheet source

### SourceExtractionSignal
Represents one explicit source-readiness signal extracted or mapped for CAD recovery.

Fields:
- `id`
- `part_id`
- `source_record_id`
- `datasheet_revision_id`
- `asset_id`
- `signal_type` (`package_mechanical_dimensions`, `pin_table`, `mechanical_drawing`)
- `extraction_status` (`available`, `needs_review`, `not_available`)
- `confidence_score`
- `extraction_source` (`provider_structured_metadata`, `datasheet_metadata`, `asset_reference`, `manual_internal`)
- `notes`
- `last_updated_at`

Purpose:
- improves source-readiness decisions without claiming full PDF intelligence
- keeps missing-CAD requestability grounded in explicit evidence
- records partial and review-required extraction states honestly

---

## Connector intelligence entities

### ConnectorFamily
Represents a connector family or series.

Fields:
- `id`
- `name`
- `series`
- `description`
- `created_at`
- `updated_at`

### MateRelation
Represents connector mating compatibility between two parts.

Fields:
- `id`
- `part_id`
- `mate_part_id`
- `relationship_type` (`best_mate`, `alternate_mate`)
- `compatibility_status` (`verified`, `probable`, `uncertain`, `rejected`)
- `confidence_score`
- `evidence_kind` (`provider_direct`, `datasheet_reference`, `family_inference`, `manual_review`, `catalog_fixture`)
- `source_record_id`
- `notes`
- `created_at`
- `updated_at`

Purpose:
- powers “Best Mate” and alternate mate recommendations
- distinguishes high-confidence compatibility from weaker or unresolved suggestions
- supports evidence-weighted confidence so inferred relationships do not look equal to directly sourced ones

### AccessoryRequirement
Represents accessories or companion hardware needed to build with a connector.

Fields:
- `id`
- `part_id`
- `accessory_part_id`
- `relationship_type` (`requires_accessory`, `optional_accessory`, `tooling_requirement`)
- `required_for_context`
- `quantity_rule`
- `compatibility_status` (`verified`, `probable`, `uncertain`, `rejected`)
- `confidence_score`
- `evidence_kind` (`provider_direct`, `datasheet_reference`, `family_inference`, `manual_review`, `catalog_fixture`)
- `source_record_id`
- `notes`
- `created_at`
- `updated_at`

Examples:
- contacts
- backshells
- hoods
- wedges
- strain relief
- crimp tools

Purpose:
- captures required and optional companion parts for real buildability
- keeps inferred accessory mappings visually and operationally distinct from direct connector evidence

### CableCompatibility
Represents compatible cable options for a connector.

Fields:
- `id`
- `part_id`
- `cable_part_id`
- `relationship_type` (`supports_cable`)
- `wire_gauge_min`
- `wire_gauge_max`
- `shielding_requirement`
- `termination_style`
- `compatibility_status` (`verified`, `probable`, `uncertain`, `rejected`)
- `confidence_score`
- `source_record_id`
- `notes`
- `created_at`
- `updated_at`

Purpose:
- powers buildable mating sets and cable-side recommendations
- persists explicit wire-gauge, shielding, termination-style, and support-status evidence so cable warnings do not rely on note parsing alone

### ConnectorFamilyConflict
Represents a persisted near-match or family-confusion candidate derived from connector evidence.

Fields:
- `id`
- `part_id`
- `candidate_part_id`
- `candidate_connector_family_id` (nullable)
- `conflict_type` (`near_match_variant`, `family_confusion`)
- `confidence_score`
- `summary`
- `detail`
- `source_record_id` (nullable)
- `last_updated_at`

Purpose:
- keeps connector-family ambiguity as a first-class persisted record instead of a UI-only warning
- supports detail/admin review surfaces and related-part summaries for ambiguity follow-up
- allows stronger family-confusion detection from provider-backed best-mate and alternate-mate evidence, not only UI heuristics

---

## Similar-part, companion-part, and risk entities

### SimilarPartRelation
Represents alternate or near-equivalent parts.

Fields:
- `id`
- `part_id`
- `similar_part_id`
- `confidence_score`
- `reason`
- `created_at`
- `updated_at`

Purpose:
- used for substitution and alternate selection

### CompanionRecommendation
Represents common parts used alongside a selected part in a real circuit or subsystem.

Fields:
- `id`
- `part_id`
- `companion_part_id`
- `confidence_score`
- `usage_context`
- `created_at`
- `updated_at`

Examples:
- LDO input/output capacitors
- MCU crystal and decouplers
- RS-485 termination resistors
- TVS protection devices

Purpose:
- keeps “similar parts” separate from “parts commonly used together”

### PartRiskFlag
Represents a known risk, warning, or near-match ambiguity for a part.

Fields:
- `id`
- `part_id`
- `warning_type` (`near_match_variant`, `family_confusion`, `pinout_risk`, `gender_mismatch`, `mounting_mismatch`, `plating_difference`, `accessory_dependency`, `lifecycle_risk`, `source_conflict`)
- `severity` (`low`, `medium`, `high`, `critical`)
- `related_part_id` (nullable)
- `source_record_id` (nullable)
- `confidence_score`
- `message`
- `status` (`active`, `dismissed`, `resolved`)
- `created_at`
- `updated_at`

Purpose:
- makes variant confusion and engineering risk visible
- supports readiness blockers and engineer-facing warnings

---

## Part readiness and operational workflow entities

### PartReadiness
Represents the current readiness summary for a part as a whole.

Fields:
- `id`
- `part_id`
- `identity_status` (`verified`, `ambiguous`, `conflicted`, `unverified`)
- `connector_readiness_status` (`complete`, `partial`, `missing`, `not_applicable`)
- `cad_readiness_status` (`ready`, `partial`, `references_only`, `missing`)
- `sourcing_readiness_status` (`active`, `risky`, `obsolete`, `unknown`)
- `approval_status` (`draft`, `pending_review`, `approved_for_design`, `restricted`, `rejected`)
- `overall_readiness_status` (`engineer_ready`, `needs_review`, `blocked`)
- `readiness_score`
- `blocker_count`
- `blocker_summary`
- `last_evaluated_at`
- `created_at`
- `updated_at`

Purpose:
- provides the engineer-facing answer to “Can I use this part yet?”
- keeps part-level readiness separate from raw import success
- supports homepage readiness checks, detail views, and admin queues

### PartIssue
Represents one open or resolved issue that affects part readiness.

Fields:
- `id`
- `part_id`
- `issue_type` (`missing_mate`, `missing_accessory`, `missing_footprint`, `missing_symbol`, `missing_3d`, `low_confidence_identity`, `duplicate_candidate`, `conflicting_source_data`, `approval_required`, `obsolete_risk`)
- `severity` (`low`, `medium`, `high`, `critical`)
- `status` (`open`, `in_review`, `resolved`, `ignored`)
- `assigned_to`
- `resolution_notes`
- `resolved_at`
- `created_at`
- `updated_at`

Purpose:
- powers admin review queues and operational triage
- makes blockers visible and assignable instead of burying them in transient UI logic

### SourceReconciliationRecord
Represents an operator decision about how to handle mixed or conflicting source evidence for one part.

Fields:
- `part_id`
- `preferred_source_record_id` (nullable)
- `resolution_status` (`unreviewed`, `canonical_source_selected`, `mixed_sources_accepted`)
- `notes`
- `updated_by`
- `updated_at`

Purpose:
- records source-conflict handling without pretending the underlying provider evidence disappeared
- supports admin reconciliation flows and part-level source conflict context

### PartApprovalRecord
Represents a part-level approval decision for engineering use.

Fields:
- `id`
- `part_id`
- `approval_status` (`draft`, `pending_review`, `approved_for_design`, `restricted`, `rejected`)
- `approved_scope` (`design_use`, `prototype_only`, `internal_only`)
- `decision_reason`
- `reviewer`
- `review_notes`
- `reviewed_at`
- `created_at`
- `updated_at`

Purpose:
- separates “part exists” from “part is approved for engineering use”
- prevents asset-level approvals from standing in for full part onboarding approval

---

## Generation and recovery entities

### GenerationRequest
Represents a user- or system-triggered request to generate a missing asset.

Fields:
- `id`
- `part_id`
- `target_asset_type` (`footprint`, `symbol`, `three_d_model`)
- `requested_from_datasheet_revision_id`
- `requested_from_asset_id`
- `request_status`
- `request_reason`
- `created_at`
- `updated_at`

### Generation request status
Allowed values:
- `unavailable`
- `available_to_request`
- `requested`
- `queued`
- `processing`
- `generated`
- `review_required`
- `approved`
- `failed`

Purpose:
- powers the missing-CAD recovery path
- makes generation availability and status explicit

### GenerationWorkflow
Represents the workflow state for a specific generation attempt.

Fields:
- `id`
- `generation_request_id`
- `part_id`
- `target_asset_type`
- `source_datasheet_revision_id`
- `source_asset_id`
- `generation_status`
- `confidence_score`
- `output_asset_id`
- `notes`
- `created_at`
- `updated_at`

Purpose:
- tracks an actual generation run separately from the higher-level request

---

## Review and validation entities

### ReviewRecord
Represents a review decision on a generated or sourced asset or workflow.

Fields:
- `id`
- `part_id`
- `asset_id` (nullable)
- `generation_workflow_id` (nullable)
- `review_status`
- `reviewer_name`
- `review_notes`
- `reviewed_at`
- `created_at`
- `updated_at`

Purpose:
- creates a clear trust boundary between:
  - generated
  - reviewed
  - verified for export

### AssetValidationRecord
Represents durable validation evidence for one engineering asset.

Fields:
- `id`
- `part_id`
- `asset_id`
- `validation_status`
- `validation_type`
- `validation_notes`
- `validated_at`
- `validator`
- `last_updated_at`

Purpose:
- records the evidence used to decide whether an asset can be promoted
- prevents review approval from standing in for export validation

### AssetPromotionAuditRecord
Represents one attempt to promote an asset into `verified_for_export`.

Fields:
- `id`
- `part_id`
- `asset_id`
- `prior_export_status`
- `new_export_status`
- `promotion_outcome`
- `blocker_reasons`
- `validation_record_id`
- `actor`
- `created_at`

Purpose:
- records successful and denied promotion attempts
- keeps blocker reasons reviewable instead of hidden in transient API logic

---

## Internal engineering memory entities

The entities in this section are planned/future unless `docs/IMPLEMENTATION_STATUS.md` says they are shipped. They support project/BOM memory, where-used search, evidence-based validation, circuit reuse, and BOM health/risk review.

### Project
Represents a hardware project or product program that owns revisions, BOM imports, usage records, evidence, and risk findings.

Fields:
- `id`
- `project_key`
- `name`
- `description`
- `owner`
- `status` (`active`, `archived`, `prototype`, `production`, `deprecated`)
- `created_at`
- `updated_at`

Purpose:
- makes project history a first-class product concept
- provides the anchor for BOM imports, usage history, evidence, and risk review
- supports future project dashboards and project-scoped search

### ProjectRevision
Represents a specific design, hardware, or BOM revision for a project.

Fields:
- `id`
- `project_id`
- `revision_label`
- `revision_status` (`draft`, `in_review`, `released`, `superseded`, `archived`)
- `source_reference`
- `released_at`
- `created_at`
- `updated_at`

Purpose:
- preserves revision-specific engineering context
- lets where-used answers distinguish prototype, review, released, and superseded designs
- supports BOM health over time instead of only current state

### BomImport
Represents one uploaded or ingested BOM source for a project revision.

Fields:
- `id`
- `project_id`
- `project_revision_id`
- `source_filename`
- `source_format` (`csv`, `xlsx`, `json`, `eda_export`, `manual`)
- `storage_key`
- `import_status` (`uploaded`, `mapping_required`, `mapped`, `processing`, `processed`, `failed`)
- `column_mapping`
- `import_summary`
- `imported_by`
- `created_at`
- `updated_at`

Purpose:
- preserves BOM intake provenance
- supports future BOM upload and column-mapping flows
- keeps import state separate from part readiness or approval

### BomLine
Represents one normalized row from a BOM import while preserving original row context.

Fields:
- `id`
- `bom_import_id`
- `project_id`
- `project_revision_id`
- `row_number`
- `designators`
- `quantity`
- `raw_mpn`
- `raw_manufacturer`
- `raw_description`
- `raw_supplier_reference`
- `raw_notes`
- `raw_row_payload`
- `matched_part_id` (nullable)
- `match_status` (`unmatched`, `matched`, `ambiguous`, `weak_match`, `ignored`)
- `match_confidence_score`
- `created_at`
- `updated_at`

Purpose:
- keeps original BOM row evidence intact
- supports BOM column mapping, part matching, and follow-up work
- prevents weak or ambiguous BOM rows from becoming confirmed parts silently

### ProjectPartUsage
Represents a part's use in a project revision, usually derived from one or more BOM lines.

Fields:
- `id`
- `project_id`
- `project_revision_id`
- `bom_line_id` (nullable)
- `part_id`
- `usage_context`
- `designators`
- `quantity`
- `usage_status` (`proposed`, `in_review`, `used`, `released`, `deprecated`)
- `approval_snapshot`
- `readiness_snapshot`
- `created_at`
- `updated_at`

Purpose:
- powers future where-used search
- preserves part-to-project usage history
- lets teams distinguish internal reuse from new or risky part introduction

### CircuitBlock
Represents a reusable circuit or subsystem pattern as structured engineering knowledge.

Fields:
- `id`
- `block_key`
- `name`
- `description`
- `block_type` (`power`, `mcu_support`, `interface`, `protection`, `connector_set`, `sensor_front_end`, `other`)
- `owner`
- `status` (`draft`, `in_review`, `approved`, `restricted`, `deprecated`)
- `reuse_scope`
- `constraints`
- `created_at`
- `updated_at`

Purpose:
- treats reusable circuits as first-class engineering memory
- supports future circuit block libraries and reuse decisions
- keeps circuit knowledge tied to evidence, constraints, parts, and project history

### CircuitBlockPart
Represents a part role inside a reusable circuit block.

Fields:
- `id`
- `circuit_block_id`
- `part_id`
- `role`
- `quantity`
- `is_required`
- `substitution_policy`
- `notes`
- `created_at`
- `updated_at`

Purpose:
- connects circuit blocks to approved or review-required parts
- supports reusable circuit risk review when a part changes state
- enables future where-used answers for circuit block dependencies

### EvidenceAttachment
Represents a file, link, report, source snapshot, or note used as evidence for a decision.

Fields:
- `id`
- `attached_to_type` (`part`, `asset`, `project`, `project_revision`, `bom_import`, `bom_line`, `project_part_usage`, `circuit_block`, `risk_finding`)
- `attached_to_id`
- `evidence_type` (`datasheet`, `validation_report`, `review_note`, `source_snapshot`, `test_result`, `photo`, `file_hash`, `other`)
- `title`
- `storage_key`
- `external_url`
- `file_hash`
- `provenance`
- `review_status`
- `created_by`
- `created_at`
- `updated_at`

Purpose:
- supports a future evidence vault without treating every attachment as an export-ready asset
- makes validation and review decisions auditable
- lets evidence attach to projects, BOM rows, circuit blocks, and risks, not only parts

### RiskFinding
Represents a project, BOM, part, connector, asset, or circuit-level risk that needs review or follow-up.

Fields:
- `id`
- `scope_type` (`part`, `project`, `project_revision`, `bom_import`, `bom_line`, `project_part_usage`, `circuit_block`, `asset`, `connector_set`)
- `scope_id`
- `risk_type` (`lifecycle`, `sourcing`, `approval_gap`, `missing_evidence`, `missing_verified_cad`, `connector_buildability`, `source_conflict`, `duplicate_candidate`, `reuse_scope`, `other`)
- `severity` (`low`, `medium`, `high`, `critical`)
- `status` (`open`, `in_review`, `resolved`, `accepted`, `ignored`)
- `summary`
- `detail`
- `recommended_action`
- `assigned_to`
- `source_record_id` (nullable)
- `created_at`
- `updated_at`

Purpose:
- powers future BOM health and risk review dashboards
- keeps next actions explicit and assignable
- allows risks to exist at project/BOM/circuit scope, not only part scope

### PartUsageRecord
Represents a known internal usage of a part.

Fields:
- `id`
- `part_id`
- `project_name`
- `usage_context`
- `usage_status` (`proposed`, `used`, `validated`, `deprecated`)
- `notes`
- `created_at`
- `updated_at`

Purpose:
- captures institutional knowledge about where a part has already been used
- supports engineer trust and internal decision-making
- should be superseded or normalized into `ProjectPartUsage` as project memory is implemented

### PartEngineeringRecord
Represents one durable, provenance-bearing piece of private engineering memory about a part.
This is the shipped entity (`infra/postgres/041_part_engineering_records.sql`) that supersedes
the older `PartNote` sketch: it answers the questions a public component aggregator structurally
cannot.

Fields:
- `id`
- `part_id`
- `record_kind` (`outcome`, `harness_mate_verified`, `cad_physical_verified`, `dependency`, `decision_blocked`, `note`)
- `title`
- `detail`
- `severity` (`info`, `limitation`, `caution`, `blocking`)
- `outcome` (`worked`, `worked_with_caveats`, `bit_us`, `not_verified`; null for note/dependency/decision rows)
- `related_asset_id` (nullable; the trusted footprint/symbol/3D asset this record is about — ON DELETE SET NULL)
- `datasheet_revision_id` (nullable; the datasheet revision the team designed from — ON DELETE SET NULL)
- `related_mpn` (nullable; counterpart connector MPN that actually mated in the real harness)
- `depended_on_by` (nullable; test fixture / board / cable / program identifier)
- `recorded_by`
- `recorded_at`
- `resolved_at` / `resolved_by` / `resolution_notes` (resolution preserves the original row)
- `evidence_url`
- `created_at`
- `updated_at`

Purpose:
- captures "have we used this / did it work or bite us / who approved it / which footprint and
  datasheet revision did we trust / what mated in the real harness / which CAD was verified
  against the physical part / what depended on it / what mistake must we not repeat"
- append-only and provenance-first: resolving never deletes, so a project that reused the part
  while a record was open stays auditable
- Honesty contract: recording or resolving a record never changes part approval, asset
  validation, review, or export state

### PartNote (superseded)
Original sketch for a part-level note (`note_type`, `author`, `body`). Superseded by
`PartEngineeringRecord` (`record_kind = 'note'` covers the free-form case). Retained here only
to document the design lineage.

---

## Team collaboration and governance entities

These entities make the engineering memory usable by a **team**: accountable actions, controlled
change, and controlled documents. The first four are **shipped**; the role entities at the end are
**planned**. Defer to `docs/IMPLEMENTATION_STATUS.md` for status.

### AuditEvent (shipped — `infra/postgres/034_audit_events.sql`)
Represents one recorded API user action for accountability.

Fields:
- `id`
- `request_id`
- `occurred_at`
- `actor_id`
- `actor_role`
- `action`
- `target_type` (`api_route`, `part`, `asset`, `project`, `project_revision`, `project_revision_approval_gate`, `bom_import`, `circuit_block`, `circuit_block_part`, `document_revision`, `evidence_attachment`, `follow_up`, `provider_acquisition_job`, `provider_import`, `substitution`, `vendor`)
- `target_id`
- `method`
- `path`
- `operation`
- `status_code`
- `outcome` (`succeeded`, `denied`, `failed`)
- `request_ip_hash`
- `user_agent_hash`
- `metadata` (JSONB; scalar/string-array values only)

Purpose:
- records who did what, to which target, with what outcome — the governance spine for RBAC, ECN/ECO, and document control
- intentionally never stores request bodies, secrets, evidence bytes, or controlled-document contents
- writing an audit event never changes approval, validation, review, or export state

### ProjectRevisionApprovalGate (shipped — `infra/postgres/033_project_revision_approval_gates.sql`)
Represents a review decision over the diff between two project revisions.

Fields:
- `id`
- `project_id`
- `from_project_revision_id`
- `to_project_revision_id`
- `gate_status` (`pending_review`, `approved`, `changes_requested`)
- `diff_fingerprint`
- `diff_summary` (JSONB)
- `decision_notes`
- `created_by`
- `decided_by`
- `decided_at`
- `created_at`
- `updated_at`
- unique on (`project_id`, `from_project_revision_id`, `to_project_revision_id`, `diff_fingerprint`)

Purpose:
- makes BOM change review visible and auditable, pinned to the exact diff reviewed so approval cannot silently cover later edits
- single-stage today; multi-stage ECN/ECO is planned
- the gate decides revision review only — it does not approve parts, validate assets, or unlock export

### DocumentRevision / DocumentAclEntry / DocumentRedline (shipped — `infra/postgres/035_document_control.sql`)
Controlled-document foundation attached to existing catalog assets.

`DocumentRevision` fields:
- `id`, `part_id`, `asset_id`
- `document_type` (`datasheet`, `mechanical_drawing`, `controlled_drawing`, `specification`, `other`)
- `revision_label`, `revision_date`
- `lifecycle_status` (`draft`, `in_review`, `released`, `superseded`, `expired`, `archived`)
- `access_level` (`public`, `internal`, `restricted`, `itar_controlled`)
- `access_notes`, `effective_at`, `expires_at`
- `supersedes_document_revision_id`
- `source_asset_hash`, `created_by`, `created_at`, `updated_at`

`DocumentAclEntry` fields:
- `id`, `document_revision_id`
- `principal_type` (`user`, `team`, `role`), `principal_id`
- `permission` (`view`, `review`, `approve`, `admin`)
- `granted_by`, `expires_at`, `created_at`

`DocumentRedline` fields:
- `id`, `document_revision_id`
- `redline_status` (`open`, `resolved`, `rejected`, `superseded`)
- `page_number`, `anchor_text`, `note`
- `severity` (`info`, `review`, `blocker`)
- `created_by`, `resolved_by`, `resolved_at`, `created_at`, `updated_at`

Purpose:
- gives datasheets/drawings revision, lifecycle, expiry, supersession, access control, and review history while preserving their stored file provenance
- the `principal_type`/`permission` model is the seed for platform-wide RBAC; a per-asset download-grant resolver reads access level + ACL (the ITAR/EAR download-gating foundation)
- document control never changes part approval or export readiness

### Vendor (shipped)
Represents a trusted supplier (fabrication, assembly, sheet metal, etc.) a team wants to remember.

Purpose:
- captures vendor trust as team memory, with per-vendor files and usage references back into project work
- provider-neutral; vendor trust is not a procurement or part-approval signal

### UserRole / RoleAssignment (planned)
Represents scoped role-based access beyond the current `admin | user` model.

Planned shape:
- roles such as `viewer`, `contributor`, `reviewer`, `approver`, `exporter`, `admin`
- assignments scoped globally or per project / per program
- generalizes the shipped `DocumentAclEntry` principal/permission model into a platform-wide policy enforced at the API boundary

Purpose:
- lets access match responsibility so "who may approve" and "who may export" are first-class, enforced concepts
- pairs with the shipped `AuditEvent`: roles decide who *may* act, audit records what they *did*

---

## Derived platform concepts

These do not always need to be stored as primary entities, but the system must resolve them consistently.

### BuildableMatingSet
A derived recommendation set for connector implementation.

Includes:
- main connector part
- best mate
- alternate mates that still need family/keying review
- required accessories
- optional accessories
- compatible cable option
- note-derived cable assumptions such as gauge, shielding, and termination hints
- structured warning details and an evidence-weighted confidence breakdown

Purpose:
- this is one of the main differentiators of the platform

### AssetBundleReadiness
A derived summary of whether a part has a usable CAD/export bundle.

Possible outputs:
- `bundle_ready`
- `partial_bundle`
- `references_only`
- `no_usable_assets`

Purpose:
- keeps export wording honest and understandable

### SourceReadiness
A derived summary of whether enough source material exists to request missing asset generation.

Examples:
- package/mechanical data available for footprint generation
- pin table data available for symbol generation
- mechanical drawing available for 3D generation

Purpose:
- powers missing-asset recovery actions

### PartReadinessSummary
A derived or materialized summary resolved from:
- source truth
- asset truth
- compatibility records
- risk flags
- sourcing data
- approval state
- open issues

Purpose:
- powers quick readiness checks, part detail summaries, and admin queue views
- provides a stable engineer-facing readiness answer even when the raw source graph is complex

### WhereUsedSummary
A planned derived summary resolved from project, BOM, usage, and circuit block records.

Includes:
- project count
- revision count
- latest usage
- released vs prototype usage
- circuit block dependencies
- risk findings tied to usage

Purpose:
- powers future where-used search and part detail usage panels
- helps distinguish proven internal reuse from unreviewed or obsolete usage

### BomHealthSummary
A planned derived summary resolved from BOM lines, matched parts, readiness, approval, assets, connector intelligence, and risk findings.

Includes:
- matched, unmatched, ambiguous, and weak-match row counts
- approval gaps
- lifecycle and sourcing risks
- missing evidence
- missing verified CAD/export assets
- connector buildability gaps
- source-conflict and duplicate warnings
- recommended next actions

Purpose:
- powers future BOM health dashboards
- lets hardware leads review project risk across a full BOM instead of one part at a time

### CircuitBlockReadiness
A planned derived summary resolved from circuit block parts, evidence, constraints, risk findings, and project usage.

Includes:
- approval status
- required part readiness
- evidence completeness
- reuse constraints
- known risks
- where-used summary

Purpose:
- keeps reusable circuit blocks honest and evidence-backed
- prevents circuit blocks from becoming loose notes with hidden part risk

---

## Ingestion and generation stages

### Ingestion flow
1. Fetch raw source payload
2. Parse into provider adapter contract
3. Normalize fields and units
4. Register source record
5. Resolve or create canonical manufacturer and part identity
6. Register supply offerings and provider freshness
7. Register assets and provenance
8. Register connector and recommendation relationships
9. Derive or refresh readiness issues and warnings
10. Run validation and approval workflow
11. Publish or update searchable canonical record

### Planned project/BOM memory flow
1. Create or select project and project revision
2. Upload or ingest BOM source file
3. Map columns for MPN, manufacturer, quantity, designator, supplier reference, and notes
4. Preserve raw BOM rows and original source file context
5. Match rows to canonical parts or mark them unmatched, ambiguous, or weak
6. Create project part usage records for matched rows
7. Attach supporting evidence where available
8. Derive where-used summaries
9. Derive BOM health and risk findings
10. Create follow-up work for unresolved risks

### Generation recovery flow
1. Detect missing asset
2. Evaluate source readiness
3. Create generation request
4. Create generation workflow
5. Generate draft output
6. Route to review
7. Approve or reject
8. Promote to export verification explicitly when rules pass
9. Mark export readiness explicitly

---

## Connector intelligence policy

- compatibility is stored as structured, provenance-backed records
- buildable mating set recommendations must include required accessories
- uncertain compatibility remains labeled as uncertain
- “best mate” should prefer one high-confidence recommendation, not noisy long lists
- cable compatibility should remain explicit about wire and termination assumptions
- connector family similarity must not silently substitute for actual verified mating compatibility

---

## Asset truth policy

- referenced assets are not the same as downloaded assets
- downloaded assets are not the same as validated assets
- validated assets are not the same as reviewed assets
- reviewed assets are not automatically verified for export
- approved generated drafts remain non-exportable until an explicit promotion step succeeds
- generated assets must always remain visibly marked as generated unless superseded by approved internal review logic

---

## Part readiness policy

- successful import does not imply engineering readiness
- part approval is separate from source ingestion
- open high-severity issues block readiness
- unresolved identity conflicts block approval
- connector parts are not considered fully ready if required mates or accessories remain unresolved
- parts with only referenced CAD remain visible, but not fully export-ready
- readiness must be explainable through explicit blockers, not opaque scoring alone

---

## Project memory policy

- project/BOM records are planned until implemented in code
- BOM import must preserve original row context
- weak BOM matches must not silently create confirmed part usage
- where-used answers must be backed by project usage records
- circuit block reuse must remain tied to evidence, constraints, and risk state
- evidence attachments must not imply validation or export readiness by themselves
- BOM health must be explainable through risk findings and next actions, not opaque scores alone

---

## Unit policy

Normalize internally to:
- `V`
- `A`
- `F`
- `H`
- `ohm`
- `mm`
- `Hz`
- `deg C`

Store original source units only in raw payload or source context, not in canonical engineering metrics.
