# Data Model

## Core entities
### Manufacturer
- id
- name
- aliases
- website

### Part
- id
- mpn
- manufacturer_id
- category
- lifecycle_status
- package_id
- trust_score

### Package
- id
- package_name
- pin_count
- pitch_mm
- body_length_mm
- body_width_mm
- body_height_mm

### PartMetric
- id
- part_id
- metric_key
- metric_value
- unit
- min_value
- max_value
- confidence_score
- source_revision_id

### Asset
- id
- part_id
- asset_type (datasheet, footprint, symbol, three_d_model, mechanical_drawing)
- file_format
- storage_key
- file_hash
- provider_id
- license_mode
- provenance (official, trusted_external, generated, manual_internal)
- asset_status (missing, referenced, downloaded, validated, failed, reviewed, verified_for_export)
- generation_method
- generation_source_asset_id
- validation_status
- preview_status

### DatasheetRevision
- id
- part_id
- revision_label
- revision_date
- page_count
- file_asset_id
- parse_confidence

### ConnectorFamily
- id
- name
- series
- description

### MateRelation
- id
- part_id
- mate_part_id
- relationship_type (best_mate, alternate_mate)
- confidence_score
- source_revision_id
- notes

### AccessoryRequirement
- id
- part_id
- accessory_part_id
- relationship_type (requires_accessory, optional_accessory, tooling_requirement)
- confidence_score
- source_revision_id
- notes

### CableCompatibility
- id
- part_id
- cable_part_id
- relationship_type (supports_cable)
- confidence_score
- source_revision_id
- notes

### SimilarPartRelation
- id
- part_id
- similar_part_id
- confidence_score
- reason

### CompanionRecommendation
- id
- part_id
- companion_part_id
- confidence_score
- usage_context

### GenerationWorkflow
- id
- part_id
- target_asset_type (footprint, symbol, three_d_model)
- source_datasheet_revision_id
- source_asset_id (often mechanical_drawing for 3D generation)
- generation_status
- confidence_score
- output_asset_id

## Ingestion and generation stages
1. Fetch raw source payload
2. Parse into adapter contract
3. Normalize fields and units
4. Register asset metadata and provenance
5. Run validation / review workflow
6. Publish searchable record

## Connector intelligence policy
- relationships are provenance-backed records, not free text blobs
- buildable set recommendations must include required accessories
- uncertain compatibility remains labeled as uncertain

## Unit policy
Normalize internally to:
- V
- A
- F
- H
- ohm
- mm
- Hz
- deg C
