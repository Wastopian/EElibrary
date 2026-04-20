# Product Requirements

## Product thesis

EE Library is an **engineering part onboarding and readiness platform** for electrical and hardware engineers.

It is built to solve a specific class of problems that common part search sites, distributor catalogs, and CAD library tools do not solve well:

- finding the correct part is not enough
- finding a file is not enough
- knowing a connector name is not enough
- a successful import is not enough

The platform must help engineers answer the full practical question:

- What is the right part?
- Is the identity verified or ambiguous?
- What mates with it?
- What else is required to build with it?
- Which engineering assets actually exist?
- How trustworthy are those assets?
- Can missing assets be recovered from source material?
- Are there near-match or family-confusion risks?
- Is this part approved for design use?
- Is this part truly ready for export into ECAD and MCAD workflows?

EE Library should feel like an **engineering workspace**, not a generic distributor clone, not a passive footprint download site, and not a pretty wrapper around provider imports.

The product is especially valuable for **connectors and electromechanical parts**, where practical engineering readiness depends on more than basic catalog data.

---

## Core product pillars

### 1. Part readiness
The product centers on **part readiness**, not just part existence.

A part is not considered useful merely because it appears in a source catalog or has some metadata attached to it.  
The system must help users determine whether a part is actually ready to use in design work.

This includes:
- identity confidence
- normalized technical data
- mate and accessory completeness
- CAD asset readiness
- sourcing and lifecycle visibility
- approval state
- explicit blockers and warnings

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
- whether there are near-match or family-confusion risks

Connector intelligence is one of the primary differentiators of the product.

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
- structured provider metadata where applicable

Generated assets must always remain visibly marked as generated unless they are later reviewed and approved through explicit workflow.

### 5. Approval and trust
The platform must separate:
- source ingestion
- asset review
- export validation
- part approval for engineering use

The product must preserve trust boundaries clearly so a user can understand what is:
- imported
- inferred
- generated
- reviewed
- approved
- blocked

### 6. Buildable engineering workflows
The platform must help users move from “I found a part” to “I can actually use this in a design.”

This includes:
- readiness summaries
- buildable mating sets
- companion part guidance
- explicit warnings and blockers
- honest export readiness
- review and approval workflows
- admin queues for unresolved part issues

---

## Core user problem

Electrical and hardware engineers routinely waste time on work that should not be this painful:

- hunting across distributor and manufacturer sites
- manually comparing inconsistent package data
- figuring out which connector mates are actually correct
- determining whether a connector selection is truly buildable
- searching for trustworthy symbols, footprints, and 3D models
- discovering that an available file is incomplete, outdated, or misleading
- repeating the same comparison work for similar parts
- discovering late that a part family has subtle but critical variant differences
- struggling to move part data cleanly into ECAD and MCAD tools
- lacking a trustworthy internal record of what is actually approved and ready

The product must reduce this friction by centralizing engineering truth, compatibility, readiness, and trust in one place.

---

## Primary user outcomes

A successful product allows a user to:

1. enter a raw MPN and quickly resolve the intended part
2. understand the part’s normalized engineering data
3. determine whether identity is verified or ambiguous
4. see which assets exist and how trustworthy they are
5. resolve the best connector mate and required accessories
6. understand whether the part is buildable in a real design context
7. see risk flags such as family confusion, near-match variants, or incomplete dependencies
8. request recovery of missing CAD assets when source material allows it
9. understand whether the part is approved for engineering use
10. export only when the asset bundle is truly ready

---

## Primary users

The product is designed primarily for:

- electrical engineers
- hardware engineers
- ECAD librarians / component librarians
- integration and test engineers
- procurement-adjacent technical users
- technical admins reviewing part readiness and asset workflows

There are two major user modes:

### Quick engineering user
A user who wants a fast answer to:
- what is this part
- is it ready
- what mates with it
- what files exist
- what am I missing

### Technical admin / librarian user
A user who needs to:
- review unresolved issues
- manage provider imports
- approve parts
- validate assets
- resolve duplicates, conflicts, and missing data
- manage workflows for recovery and promotion

---

## MVP scope

### 1. Quick Part Readiness Check
The platform must support a primary intake flow where a user can provide:

- MPN
- optional manufacturer
- optional provider part reference
- optional provider URL
- optional datasheet URL

The result must provide a readiness-oriented summary that includes:
- identity status
- category / package summary
- readiness summary
- key warnings
- asset status
- mate/accessory status where applicable
- next actions

This flow should feel like a practical engineering tool, not a shopping catalog.

### 2. Search and discovery
The platform must support:

- MPN search
- manufacturer filters
- category and subcategory filters
- package filters
- lifecycle filters
- readiness filters
- CAD availability filters
- connector class filters such as plug, receptacle, accessory, and cable

The search experience should support engineering triage and part selection, not ecommerce-style browsing.

### 3. Part detail / readiness workspace
Each part must have a detail page that acts as the core engineering workspace.

Minimum requirements:
- hero summary
- readiness summary
- normalized specs
- package dimensions
- datasheet panel
- Engineering Assets panel
- bundle readiness summary
- mates and accessories panel for connectors
- Similar Parts panel
- Typical Companion Parts panel
- risk / warning panel
- approval summary
- fallback generation actions for missing CAD assets
- export actions that reflect real file availability and trust state
- provenance or audit summary

This page should answer “Can I use this part?” not just “What metadata do we have?”

### 4. Engineering assets
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

### 5. Connector intelligence
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

Connector views must also support:
- compatibility confidence
- uncertainty labeling
- family-confusion warnings where relevant

This is one of the core differentiators of the platform.

### 6. Similar parts, companion parts, and risk warnings
The system must clearly distinguish between:

#### Similar Parts
Alternates or near-equivalents that may substitute for the selected part.

#### Typical Companion Parts
Parts commonly used alongside the selected part in real circuits or assemblies.

Examples:
- LDO + capacitors
- MCU + crystal + decoupling
- transceiver + termination + TVS
- connector + contacts + backshell + cable

#### Risk Flags / Warnings
Warnings that help prevent engineering mistakes, such as:
- near-match variant confusion
- family ambiguity
- mounting mismatch
- pinout risk
- unresolved accessory dependency
- lifecycle risk
- conflicting source data

The product must not blur these concepts together.

### 7. Datasheet-driven generation workflow
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

### 8. Approval workflow
The platform must support a part-level approval model that is separate from import success and separate from asset review.

A part should be able to move through states such as:
- draft
- pending review
- approved for design
- restricted
- rejected

Approval workflows must make it clear:
- who reviewed a part
- why a decision was made
- what blockers remain
- what scope of use is approved

### 9. Admin review queue
The platform must provide an operational review queue for unresolved readiness issues.

Minimum queue categories:
- failed intake or import
- low-confidence identity
- missing mates
- missing accessories
- missing footprint
- missing symbol
- missing 3D model
- conflicting source data
- duplicate candidates
- pending approval
- obsolete or risky parts

The admin queue should support triage, assignment, review, and resolution.

### 10. Export
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
- imply a successful import means a part is approved for design use
- hide blockers behind vague readiness labels

### The system must always:
- preserve provenance
- preserve workflow state
- preserve confidence and uncertainty where applicable
- make trust boundaries visible to the user
- explain readiness through explicit warnings, blockers, and state
- keep asset truth and part approval clearly separated

---

## UX and interaction requirements

The product should feel like an **engineering work surface**.

### The UI must prioritize:
- fast MPN-driven workflows
- structured data presentation
- clear status communication
- readable technical density
- practical next actions
- calm, explicit error and warning states

### The UI should avoid:
- marketing-site hero layouts
- decorative emptiness
- vague status language
- flashy dashboard aesthetics that reduce clarity
- hiding technical truth behind oversimplified polish

### Key user-facing concepts that must be legible:
- readiness
- blockers
- confidence
- provenance
- approval
- export truth
- compatibility confidence

---

## Non-goals for the MVP

The MVP should not attempt to:
- scrape the entire internet in real time
- support every CAD tool immediately
- auto-generate perfect CAD assets for arbitrary parts
- provide full enterprise permissions/auth complexity
- become a distributor marketplace
- replace formal engineering review for production-critical designs
- claim universal connector compatibility across every vendor family without evidence

---

## Valuable later features

### Comparison and selection
- side-by-side compare
- alternate ranking
- package risk warnings
- lifecycle and sourcing risk overlays
- variant confusion diff views

### Workflow and productivity
- BOM ingestion
- approved parts vault
- project-aware part recommendations
- richer internal review queue
- validation and trust automation for generated assets
- issue assignment and workflow automation

### Engineering utilities
- EE calculators
- reference circuit patterns
- package and footprint validation helpers
- cable and connector assembly guidance
- compatibility explanation tools

### Data and ingestion
- real provider integrations
- richer source conflict resolution
- datasheet extraction pipeline
- automated asset generation pipeline
- freshness tracking and sync scheduling
- broader internal knowledge capture

---

## Success criteria

The product is succeeding when a user can say:

- I found the right part quickly.
- I know whether the identity is trustworthy.
- I know what mates with it.
- I know what else I need to build with it.
- I know which files are real and trustworthy.
- I know whether this part is actually approved for use.
- I know what can be exported now.
- I know what can be recovered when files are missing.
- I know what is blocking readiness if the part is not ready.

That is the standard.