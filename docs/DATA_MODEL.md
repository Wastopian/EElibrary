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
- asset_type
- file_format
- storage_key
- file_hash
- provider_id
- license_mode
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

## Ingestion stages
1. Fetch raw source payload
2. Parse into adapter contract
3. Normalize fields and units
4. Validate files and metadata
5. Publish searchable record

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
