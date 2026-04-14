# Product Requirements

## Product thesis

EE Library is a serious engineering platform for electrical engineers.

It is built to solve a specific class of problems that common part search and CAD library sites do not solve well:

- finding the correct part is not enough
- finding a file is not enough
- knowing a connector name is not enough

The platform must help engineers answer the full practical question:

- What is the right part?
- What mates with it?
- What else is required to build with it?
- Which engineering assets actually exist?
- How trustworthy are those assets?
- Can missing assets be recovered from source material?
- Is this part truly ready for export into ECAD/MCAD workflows?

EE Library should feel like an **engineering workspace**, not a generic distributor clone and not a passive footprint download site.

---

## Core product pillars

### 1. Component discovery
Users must be able to discover parts quickly through search, filtering, and normalized technical data.

### 2. Connector intelligence
For connectors, the platform must do more than list a part number.
It must help users understand:

- best mate
- alternate mates
- required accessories
- optional accessories
- cable compatibility
- tooling requirements
- whether the connector set is actually buildable

### 3. Engineering asset truth
Engineering assets must be treated as first-class objects, with explicit truth about:

- what exists
- what is only referenced
- what has been downloaded
- what has been validated
- what has been reviewed
- what is truly verified for export

The platform must not imply that a part is export-ready unless the underlying assets actually support that claim.

### 4. Missing-CAD recovery
When symbol, footprint, or 3D assets do not exist, the platform must provide a typed recovery path based on available source material such as:

- datasheets
- pin/function tables
- mechanical drawings
- package/mechanical dimensions

Generated assets must always remain visibly marked as generated unless they are later reviewed and approved through explicit workflow.

### 5. Buildable engineering workflows
The platform must help users move from “I found a part” to “I can actually use this in a design.”

This includes:
- buildable mating sets
- companion part guidance
- honest export readiness
- clear warnings and trust boundaries

---

## Core user problem

Electrical engineers routinely waste time on work that should not be this painful:

- hunting across distributor and manufacturer sites
- manually comparing inconsistent package data
- figuring out which connector mates are actually correct
- determining whether a connector selection is truly buildable
- searching for trustworthy symbols, footprints, and 3D models
- discovering that an available file is incomplete, outdated, or misleading
- repeating the same comparison work for similar parts
- struggling to move part data cleanly into ECAD/MCAD tools

The product must reduce this friction by centralizing engineering truth, compatibility, and asset readiness in one place.

---

## Primary user outcomes

A successful product allows a user to:

1. find a part quickly
2. understand the part’s normalized engineering data
3. see which assets exist and how trustworthy they are
4. resolve the best connector mate and required accessories
5. understand whether the part is buildable in a real design context
6. request recovery of missing CAD assets when source material allows it
7. export only when the asset bundle is truly ready

---

## MVP scope

### 1. Search and discovery
The platform must support:

- MPN search
- manufacturer filters
- category and subcategory filters
- package filters
- lifecycle filters
- CAD availability filters
- connector class filters such as plug, receptacle, accessory, and cable

The search experience should feel like an engineering tool, not a shopping catalog.

### 2. Component detail workspace
Each part must have a detail page that acts as the core engineering workspace.

Minimum requirements:
- hero summary
- normalized specs
- package dimensions
- datasheet panel
- Engineering Assets panel
- bundle readiness summary
- Similar Parts panel
- Typical Companion Parts panel
- Recommended Buildable Set panel for connectors
- fallback generation actions for missing CAD assets
- export actions that reflect real file availability and trust state

### 3. Engineering assets
The platform must treat these as first-class asset types:

- symbol
- footprint
- 3D model
- datasheet
- mechanical drawing

For each asset, the system must track:
- provenance type
- availability state
- validation state
- review state
- export readiness
- preview readiness

Allowed provenance types:
- official
- trusted_external
- generated
- manual_internal

Generated assets must never be presented as official.

### 4. Connector intelligence
Connector relationships must support:
- best mate
- alternate mates
- requires accessory
- optional accessory
- supports cable
- tooling requirement

The product must also resolve a **Buildable Mating Set** that surfaces:
- the selected connector
- the best mate
- required accessories
- optional accessories
- compatible cable option where applicable

This is one of the core differentiators of the platform.

### 5. Similar parts and companion parts
The system must clearly distinguish between:

#### Similar Parts
Alternates or near-equivalents that may substitute for the selected part.

#### Typical Companion Parts
Parts commonly used alongside the selected part in real circuits.

Examples:
- LDO + capacitors
- MCU + crystal + decoupling
- transceiver + termination + TVS
- connector + contacts + backshell + cable

The product must not blur these concepts together.

### 6. Datasheet-driven generation workflow
When file-backed CAD assets are missing, the product must support typed recovery workflows such as:

- generate footprint from datasheet or package/mechanical dimensions
- generate symbol from pin/function tables
- generate 3D model from mechanical drawing geometry

The workflow must preserve:
- provenance
- readiness status
- confidence metadata
- review state

The product must be explicit when generation is unavailable due to insufficient source data.

### 7. Export
The platform must support:
- Altium bundle
- SolidWorks bundle
- neutral STEP/CAD package
- manifest and warnings output

Exports may only include assets that are truly available and appropriately verified.
Referenced URLs alone do not count as export-ready files.

---

## Trust and honesty requirements

The platform must be strict about engineering truth.

### The system must never:
- imply a file exists when it does not
- imply a referenced asset is the same as a downloaded asset
- imply a generated asset is official
- imply a reviewed asset is automatically verified for export
- imply a connector set is buildable if required relationships are incomplete

### The system must always:
- preserve provenance
- preserve workflow state
- preserve confidence and uncertainty where applicable
- make trust boundaries visible to the user

---

## Non-goals for the MVP

The MVP should not attempt to:
- scrape the entire internet in real time
- support every CAD tool immediately
- auto-generate perfect CAD assets for arbitrary parts
- provide full team permissions/auth complexity
- become a distributor marketplace
- replace formal engineering review for production-critical designs

---

## Valuable later features

### Comparison and selection
- side-by-side compare
- alternate ranking
- package risk warnings
- lifecycle and sourcing risk overlays

### Workflow and productivity
- BOM ingestion
- approved parts vault
- project-aware part recommendations
- internal review queue
- validation/trust automation for generated assets

### Engineering utilities
- EE calculators
- reference circuit patterns
- package/footprint validation helpers
- cable and connector assembly guidance

### Data and ingestion
- real provider integrations
- richer source conflict resolution
- datasheet extraction pipeline
- automated asset generation pipeline
- freshness tracking and sync scheduling

---

## Success criteria

The product is succeeding when a user can say:

- I found the right part quickly.
- I know what mates with it.
- I know what else I need to build with it.
- I know which files are real and trustworthy.
- I know what can be exported now.
- I know what can be recovered when files are missing.

That is the standard.