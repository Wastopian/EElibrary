# Data Model

EE Library is not just a part catalog.

It is an **engineering part onboarding and readiness data system** built to answer these questions clearly:

- What is the correct part?
- Is the part identity verified or ambiguous?
- What mates with it?
- What other parts are required to build with it?
- Which engineering assets actually exist?
- How trustworthy are those assets?
- Can missing assets be recovered from source material?
- Are there near-match or family-confusion risks?
- Is this part approved for design use?
- Is this part truly ready for export into CAD workflows?

This data model is designed around **truth, provenance, compatibility, recovery, and readiness** rather than naive part scraping.

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
- `evidence_type`
- `source_record_id`
- `notes`
- `created_at`
- `updated_at`

Purpose:
- powers “Best Mate” and alternate mate recommendations
- distinguishes high-confidence compatibility from weaker or unresolved suggestions

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
- `created_at`
- `updated_at`

Purpose:
- powers admin review queues and operational triage
- makes blockers visible and assignable instead of burying them in transient UI logic

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

### PartNote
Represents an internal note associated with a part.

Fields:
- `id`
- `part_id`
- `note_type` (`engineering`, `manufacturing`, `procurement`, `library`)
- `author`
- `body`
- `created_at`
- `updated_at`

Purpose:
- stores internal corrections, cautions, manufacturing notes, and team knowledge that public part sites do not capture well

---

## Derived platform concepts

These do not always need to be stored as primary entities, but the system must resolve them consistently.

### BuildableMatingSet
A derived recommendation set for connector implementation.

Includes:
- main connector part
- best mate
- required accessories
- optional accessories
- compatible cable option

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