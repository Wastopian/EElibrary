# Data Model

EE Library is not just a part catalog.

It is a **normalized engineering data system** built to answer these questions clearly:

- What is the correct part?
- What mates with it?
- What other parts are required to build with it?
- Which engineering assets actually exist?
- How trustworthy are those assets?
- Can missing assets be recovered from source material?
- Is this part truly ready for export into CAD workflows?

This data model is designed around **truth, provenance, compatibility, and recovery** rather than naive part scraping.

---

## Design principles

- The database stores a **canonical part record**, not raw source chaos.
- Source-derived facts must be **traceable**.
- Connector relationships are **structured records**, not text notes.
- Asset existence, trust, review, and export readiness must be **explicit**.
- Generated assets never pretend to be official.
- Missing assets should support **typed recovery workflows** when source material is sufficient.

---

## Core identity entities

### Manufacturer
Represents the canonical manufacturer identity.

Fields:
- `id`
- `name`
- `aliases`
- `website`

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

### Package
Represents the canonical package/mechanical identity for a part.

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

---

## Source truth entities

### SourceRecord
Represents a normalized source snapshot used to derive facts for a part.

Fields:
- `id`
- `part_id`
- `source_name`
- `source_type` (`manufacturer`, `distributor`, `cad_provider`, `internal`, `generated`)
- `source_part_key`
- `source_url`
- `revision_label`
- `revision_date`
- `retrieved_at`
- `raw_payload_hash`

Purpose:
- provides provenance for metrics, relationships, and assets
- allows conflict handling and source freshness tracking

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

Examples:
- voltage input max
- current output
- ESR range
- operating temperature
- insertion cycles
- contact resistance

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

Purpose:
- gives generation/review workflows a traceable datasheet source

---

## Connector intelligence entities

### ConnectorFamily
Represents a connector family or series.

Fields:
- `id`
- `name`
- `series`
- `description`

### MateRelation
Represents connector mating compatibility between two parts.

Fields:
- `id`
- `part_id`
- `mate_part_id`
- `relationship_type` (`best_mate`, `alternate_mate`)
- `confidence_score`
- `source_record_id`
- `notes`

Purpose:
- powers “Best Mate” and alternate mate recommendations

### AccessoryRequirement
Represents accessories or companion hardware needed to build with a connector.

Fields:
- `id`
- `part_id`
- `accessory_part_id`
- `relationship_type` (`requires_accessory`, `optional_accessory`, `tooling_requirement`)
- `confidence_score`
- `source_record_id`
- `notes`

Examples:
- contacts
- backshells
- hoods
- wedges
- strain relief
- crimp tools

### CableCompatibility
Represents compatible cable options for a connector.

Fields:
- `id`
- `part_id`
- `cable_part_id`
- `relationship_type` (`supports_cable`)
- `confidence_score`
- `source_record_id`
- `notes`

Purpose:
- powers buildable mating sets and cable-side recommendations

---

## Similar-part and companion-part entities

### SimilarPartRelation
Represents alternate or near-equivalent parts.

Fields:
- `id`
- `part_id`
- `similar_part_id`
- `confidence_score`
- `reason`

Purpose:
- used for substitution and alternate selection

### CompanionRecommendation
Represents common parts used alongside a selected part in a real circuit.

Fields:
- `id`
- `part_id`
- `companion_part_id`
- `confidence_score`
- `usage_context`

Examples:
- LDO input/output capacitors
- MCU crystal and decouplers
- RS-485 termination resistors
- TVS protection devices

Purpose:
- keeps “similar parts” separate from “parts commonly used together”

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

Purpose:
- tracks an actual generation run separately from the higher-level request

---

## Review entities

### ReviewRecord
Represents a review decision on a generated or sourced asset/workflow.

Fields:
- `id`
- `part_id`
- `asset_id` (nullable)
- `generation_workflow_id` (nullable)
- `review_status`
- `reviewer_name`
- `review_notes`
- `reviewed_at`

Purpose:
- creates a clear trust boundary between:
  - generated
  - reviewed
  - verified for export

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
- powers “Missing Assets / Fallback Actions”

---

## Ingestion and generation stages

### Ingestion flow
1. Fetch raw source payload
2. Parse into provider adapter contract
3. Normalize fields and units
4. Register source record
5. Register assets and provenance
6. Register connector and recommendation relationships
7. Run validation/review workflow
8. Publish searchable canonical record

### Generation recovery flow
1. Detect missing asset
2. Evaluate source readiness
3. Create generation request
4. Create generation workflow
5. Generate draft output
6. Route to review
7. Approve or reject
8. Mark export readiness explicitly

---

## Connector intelligence policy

- compatibility is stored as structured, provenance-backed records
- buildable mating set recommendations must include required accessories
- uncertain compatibility remains labeled as uncertain
- “best mate” should prefer one high-confidence recommendation, not noisy long lists

---

## Asset truth policy

- referenced assets are not the same as downloaded assets
- downloaded assets are not the same as validated assets
- validated assets are not the same as reviewed assets
- reviewed assets are not automatically verified for export
- generated assets must always remain visibly marked as generated unless superseded by approved internal review logic

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

Store original source units only in raw payload/source context, not in canonical engineering metrics.