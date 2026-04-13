# Product Requirements

## Vision
Create a serious EE component platform that centralizes:
- component discovery
- normalized metrics
- connector intelligence
- datasheets
- symbols
- footprints
- 3D models
- mechanical drawings
- export bundles for CAD tools

The product should feel like an **engineering workspace**, not a generic distributor clone.

## Core user problem
Engineers burn time:
- hunting across distributor and manufacturer sites
- checking package and connector mating constraints manually
- looking for trustworthy CAD assets
- determining whether a connector set is actually buildable
- translating files into ECAD/MCAD workflows
- re-comparing similar parts over and over

## MVP
### 1. Search
- MPN search
- manufacturer/category filters
- package/lifecycle/CAD-availability filters
- connector class filters (plug, receptacle, accessory, cable)

### 2. Component detail page
- hero summary
- normalized specs
- package dimensions
- datasheet panel
- Engineering Asset Status panel
- Recommended Buildable Set panel for connectors
- fallback generation actions for missing CAD assets
- export actions that reflect real file availability

### 3. Asset intelligence (first-class)
Track first-class assets:
- symbol
- footprint
- 3D model
- datasheet
- mechanical drawing

For each asset, track:
- provenance type: official, trusted_external, generated, manual_internal
- review status: reviewed, verified_for_export
- validation + preview readiness

Generated assets must always be explicitly labeled as generated and must never be presented as official.

### 4. Connector intelligence (first-class)
Connector relationships must support:
- best mate
- alternate mates
- requires accessory
- optional accessory
- supports cable
- tooling requirement
- buildable mating set recommendation

### 5. Datasheet-driven generation workflow
When file-backed CAD assets are missing:
- generate footprint from datasheet/mechanical dimensions
- generate symbol from pin/function tables
- generate 3D model from mechanical drawing geometry

The workflow must preserve provenance and confidence metadata at each stage.

### 6. Export
- Altium bundle
- SolidWorks bundle
- neutral STEP/CAD package
- manifest + warnings output

Exports may only include assets that are truly available and appropriately verified.

## Valuable later features
- side-by-side compare
- alternates
- BOM ingestion
- validation/trust automation for generated assets
- EE calculators
- team-approved parts vault
