# System Architecture

This document captures the intended system shape. For current shipped behavior, use `docs/IMPLEMENTATION_STATUS.md`.

EE Library is a provider-neutral **engineering part onboarding and readiness platform**, not a distributor clone and not a passive CAD file mirror.

The architecture is designed around six core goals:

1. maintain a canonical engineering record for each part
2. model connector compatibility and buildable relationships explicitly
3. track engineering asset truth, readiness, and trust boundaries
4. support missing-CAD recovery through typed workflows
5. determine and expose **part readiness** for engineering use
6. allow export only when assets are truly ready and appropriately reviewed

The system is built to help users move from a raw manufacturer part number to an **engineer-ready internal part record** with explicit trust, compatibility, CAD readiness, risk visibility, and approval state.

---

## Architectural principles

### 1. Canonical database is the source of truth
The application must not depend on live external sites at request time.

External sources are ingested into a normalized internal model.
The web app and API read from the canonical database, not directly from distributor pages, manufacturer pages, or CAD provider pages.

### 2. Provider neutrality is mandatory
The system must use a provider adapter layer from the beginning.

No UI, shared runtime logic, or core API contract should be tightly coupled to one distributor, one CAD source, one internal catalog, or one scraping strategy.

### 3. Trust boundaries must be explicit
The architecture must preserve the distinction between:

- sourced data
- normalized data
- generated data
- reviewed data
- approved-for-design data
- verified-for-export data

Generated outputs must never silently cross into trusted or exportable status.
Asset approval must not silently stand in for part approval.

### 4. Part readiness is a first-class system concern
The architecture must support answering:

- is the part identity verified
- are connector dependencies resolved
- are CAD assets ready
- are there blockers or risk flags
- is the part approved for design use

This must be represented consistently across data model, worker pipelines, API projections, and UI surfaces.

### 5. Request-time behavior must stay deterministic
Search, readiness summaries, detail views, connector intelligence, risk flags, issue queues, and asset status must be served from internal state.

Long-running work such as ingestion, extraction, generation, validation, approval updates, and export bundling must happen asynchronously through worker pipelines.

### 6. Runtime paths must remain seed-free
Seed data may exist for controlled local development, but runtime shared logic, API reads, and worker paths must not depend on seed imports except through explicit local fallback modes.

---

## Recommended stack

### Frontend
- Next.js
- TypeScript
- Tailwind CSS or equivalent utility-first system
- reusable shared UI package

### Backend
- dedicated API service
- separate worker service for ingestion, extraction, normalization, generation, validation, approval updates, and export packaging

### Data and infrastructure
- PostgreSQL for canonical normalized entities and workflow state
- JSONB for raw provider payloads and source snapshots where appropriate
- S3-compatible object storage for datasheets, CAD files, previews, generated assets, and export bundles
- Redis-backed queue for ingestion, generation, validation, review, approval, issue, and export jobs

---

## System layers

## 1. Web application layer

The web layer is the engineering workspace presented to the user.

Responsibilities:
- quick part readiness check
- search and discovery
- part detail / readiness workspace
- connector intelligence presentation
- engineering asset presentation
- missing-asset fallback actions
- risk flag and blocker presentation
- approval and workflow state presentation
- admin / review queue tools
- compare and future engineering tools

The web layer must remain:
- provider-neutral
- trust-aware
- explicit about uncertainty
- incapable of implying file existence, readiness, approval, or exportability beyond what the API proves

### Key surfaces
- Quick Part Readiness Check
- Search
- Part Detail / Readiness Record
- Recommended Buildable Set
- Engineering Assets
- Missing Assets / Fallback Actions
- Similar Parts
- Typical Companion Parts
- Risk Flags / Warnings
- Approval Summary
- Audit / Provenance Summary
- Admin / review queue tools

---

## 2. API layer

The API is the contract boundary between the UI and the platform state.

Responsibilities:
- quick part intake and readiness resolution
- part search
- part detail resolution
- connector relationship projection
- buildable mating set projection
- grouped asset summaries
- bundle readiness summaries
- readiness summary exposure
- issue queue exposure
- generation request creation
- workflow status exposure
- review status exposure
- approval status exposure
- export request handling
- admin and review actions

The API must:
- return typed, deterministic responses
- distinguish between unavailable, incomplete, blocked, and ready states
- distinguish asset truth from part approval truth
- never silently mask DB or schema failures with fake success behavior
- expose derived projections without leaking provider-specific logic

### Important derived API concepts
- PartReadinessSummary
- BuildableMatingSet
- EngineeringAssetSummary
- AssetBundleReadiness
- SourceReadiness
- GenerationRequestability
- ReviewStatus
- ApprovalStatus
- ExportReadiness
- OpenIssueSummary
- RiskFlagSummary

---

## 3. Worker layer

The worker layer performs all long-running and source-specific operations.

Responsibilities:
- provider sync
- raw payload capture
- normalization
- connector relationship mapping
- source conflict handling
- datasheet acquisition
- mechanical drawing extraction groundwork
- CAD metadata extraction
- generation request processing
- validation runs
- review preparation
- readiness recomputation
- issue detection and refresh
- risk flag derivation
- approval workflow support
- export bundle creation

The worker layer is the correct home for:
- provider-specific mapping
- heuristics
- extraction logic
- normalization pipelines
- readiness evaluation
- issue generation
- generation orchestration

The worker layer must not push provider-specific assumptions into the API or UI.

---

## 4. Canonical data layer

The canonical data layer stores the platform’s normalized engineering truth.

Core responsibilities:
- canonical part identity
- provider and source records
- supply offerings and provider freshness
- source-backed engineering metrics
- connector families and compatibility relations
- asset metadata and availability state
- generation requests and workflows
- review records
- approval records
- issue state
- risk flags
- internal notes and usage history
- export trust state

This layer is what allows the platform to answer engineering questions consistently even when source systems are incomplete, conflicting, ambiguous, or temporarily unavailable.

---

## 5. Object storage layer

Object storage stores file-backed artifacts and generated outputs.

Examples:
- datasheets
- mechanical drawings
- symbols
- footprints
- 3D models
- generated outputs
- thumbnails and previews
- export bundles
- manifests

Important rule:
a referenced external URL is not the same thing as a stored asset.

The system must track whether an asset is:
- referenced
- downloaded
- validated
- reviewed
- approved for design use only as part of the larger part context
- verified for export

---

## 6. Queue and workflow layer

Background jobs and workflow orchestration must be explicit.

Primary workflow families:
- ingestion jobs
- normalization jobs
- readiness recomputation jobs
- issue refresh jobs
- generation request jobs
- validation jobs
- review-preparation jobs
- approval update jobs
- export bundle jobs

This layer exists to keep user-facing requests fast and deterministic while allowing the system to do heavier engineering work in the background.

---

## Core subsystems

## Part Readiness Subsystem

This subsystem is the architectural center of the product.

Responsibilities:
- resolve part identity confidence
- combine source truth, asset truth, compatibility state, approval state, and risk state
- derive overall readiness for engineering use
- surface explicit blockers
- support quick readiness checks and part detail summaries
- support readiness-based filtering and queueing

Inputs include:
- source records
- normalized metrics
- connector relationships
- asset status
- review and validation evidence
- approval records
- risk flags
- open issues

Outputs include:
- overall readiness state
- blocker count and blocker summary
- readiness score or confidence
- engineer-facing readiness explanation

Rules:
- successful import does not imply readiness
- asset availability does not imply approval for design use
- blocked readiness must be explainable through explicit reasons
- readiness logic must be deterministic and reproducible from canonical state

---

## Connector Intelligence Subsystem

This subsystem is one of the key differentiators of the platform.

Responsibilities:
- store connector relationships in normalized tables
- model best mate and alternate mates
- model required and optional accessories
- model cable compatibility
- expose a provider-neutral Buildable Mating Set
- preserve confidence and provenance for all relationship records
- support compatibility warnings such as uncertainty or family ambiguity

Rules:
- relationships must be structured records, not loose notes
- uncertain compatibility remains labeled as uncertain
- required accessories must be included in buildable-set outputs
- provider-specific heuristics stay in worker adapters, not the UI
- connector family similarity must not silently substitute for verified mating compatibility

---

## Engineering Asset Intelligence Subsystem

This subsystem treats engineering files as first-class truth-bearing objects.

Tracked asset classes:
- datasheet
- footprint
- symbol
- 3D model
- mechanical drawing

Responsibilities:
- rank best available asset per class
- preserve provenance
- preserve availability state
- preserve validation state
- preserve review state
- preserve export status
- expose bundle readiness honestly

Rules:
- provenance is separate from availability
- availability is separate from review
- review is separate from export verification
- generated assets must never be labeled as official
- export gating requires real file-backed assets plus appropriate trust state

---

## Missing-CAD Recovery Subsystem

This subsystem turns missing engineering assets into explicit workflows.

Responsibilities:
- evaluate source readiness
- determine whether generation can be requested
- create typed generation requests
- track generation workflows
- attach outputs back into the asset system
- route outputs into review workflows

Examples:
- footprint generation from package/mechanical data
- symbol generation from pin/function tables
- 3D draft generation from mechanical drawings

Rules:
- no fake generation success
- no broad claims about universal PDF intelligence
- generation availability must be based on explicit source-readiness rules
- generated outputs must enter review-aware trust flow before becoming exportable

---

## Review, Validation, and Approval Subsystem

This subsystem creates the trust boundary between “known to the system” and “safe to rely on.”

Responsibilities:
- track asset review records
- support approve / reject / changes requested workflows
- separate reviewed from verified_for_export
- store validation evidence before export promotion
- audit successful and denied export-promotion attempts
- track part-level approval for engineering use
- preserve reviewer notes and auditability
- expose review, validation, and approval state to API and UI

Rules:
- generated does not imply approved
- approved asset does not automatically imply verified_for_export
- verified_for_export requires qualifying validation evidence
- part approval is separate from asset review
- readiness and approval must remain explainable and auditable

---

## Risk and Issue Management Subsystem

This subsystem makes blockers and engineering hazards operationally visible.

Responsibilities:
- store risk flags such as near-match variants, family confusion, mounting mismatch, pinout risk, lifecycle risk, or source conflict
- maintain open issue records for missing CAD, missing mates, low-confidence identity, duplicate candidates, pending approval, and obsolete-risk cases
- feed admin review queues
- support assignment, review, and resolution
- feed readiness blocking logic

Rules:
- warnings must not be buried in freeform notes
- high-severity unresolved issues must be capable of blocking readiness
- risk flags must preserve provenance and confidence where possible
- UI should consume normalized issue and risk projections rather than inventing them ad hoc

---

## Internal Engineering Memory Subsystem

This subsystem captures knowledge that public part sites do not provide.

Responsibilities:
- store part notes
- store project usage history
- capture internal corrections, cautions, and usage context
- support approved-parts vault workflows later
- provide internal trust overlays beyond public source data

Rules:
- internal notes do not overwrite source truth
- internal memory should be additive, attributable, and reviewable
- internal usage context should inform trust, but not silently override explicit approval state

---

## Export Subsystem

This subsystem produces user-facing engineering bundles for supported tools.

Responsibilities:
- assemble validated file-backed assets
- generate manifests and warnings
- support tool-specific packaging
- surface missing or partial bundle conditions clearly

Target outputs:
- Altium bundle
- SolidWorks bundle
- neutral STEP/CAD package
- manifest and warnings output

Rules:
- referenced-only assets do not count as downloadable exports
- partially complete bundles must be labeled as partial
- export actions must reflect actual asset readiness, not optimistic intent
- export readiness must not imply part approval for all engineering contexts unless the approval scope supports that claim

---

## Ingestion architecture

The ingestion pipeline should follow this general pattern:

1. fetch source payload from provider adapter
2. store raw source snapshot
3. normalize into canonical contract
4. resolve or create provider and source record
5. resolve or create canonical manufacturer and part identity
6. record source freshness, import status, and any import failure details
7. register or update supply offerings
8. register or update extracted source-readiness signals
9. register or update part metrics
10. register or update asset metadata
11. register or update connector and recommendation relationships
12. derive or refresh risk flags and readiness issues
13. recompute part readiness summary
14. run validation, review, and approval update logic
15. publish searchable canonical state

This architecture allows the system to absorb data from multiple providers without letting any one provider dictate the internal model.

---

## Request-time architecture

Typical user request flow:

### Quick part readiness check
1. user submits MPN and optional context
2. web calls API
3. API resolves canonical match or ambiguity state
4. API returns:
   - identity status
   - part summary
   - readiness summary
   - key blockers and warnings
   - mate/accessory readiness
   - asset readiness
   - next actions
5. web renders a readiness-first result

### Search
1. user submits query
2. web calls API
3. API reads canonical DB or search projection
4. API returns normalized part summaries, readiness filters, and asset/readiness projections
5. web renders provider-neutral engineering search results

### Part detail / readiness record
1. user opens a part
2. web calls API
3. API resolves:
   - canonical part data
   - normalized metrics
   - readiness summary
   - connector intelligence
   - grouped engineering assets
   - bundle readiness
   - generation requestability
   - review / approval / export state
   - risk flags
   - open issues
   - provenance and audit summary
4. web renders the engineering workspace

### Generation request
1. user requests missing asset recovery
2. API validates requestability
3. API persists generation request
4. worker processes workflow asynchronously
5. API and UI expose workflow state
6. outputs enter review-aware asset flow

### Part approval action
1. reviewer submits approval decision
2. API validates current state and scope
3. API persists approval record
4. worker refreshes readiness and issue state if needed
5. API and UI expose updated readiness and approval projections

---

## Storage strategy

### PostgreSQL
Use PostgreSQL for:
- canonical part records
- manufacturer and provider records
- source records
- supply offerings and price breaks
- normalized metrics
- connector relations
- asset metadata
- generation requests and workflows
- source extraction signals
- review and validation records
- approval records
- risk flags
- issue records
- internal usage and notes
- export state
- readiness summaries or materialized projections where useful

### JSONB
Use JSONB for:
- raw provider payload snapshots
- parser and intermediate artifacts
- source-specific details that should not pollute the canonical model
- explainable readiness evidence fragments where appropriate

### Object storage
Use object storage for:
- downloaded datasheets and CAD files
- generated assets
- preview files
- export bundles

---

## Architectural rules

### Rule 1
Do not wire the platform directly to a single distributor, manufacturer, or CAD source.

### Rule 2
Do not perform live scraping in user-facing request paths.

### Rule 3
Do not let UI components interpret provider-specific quirks.

### Rule 4
Do not collapse provenance, review, approval, readiness, and export trust into one vague status.

### Rule 5
Do not imply “exportable” unless the underlying asset bundle is truly ready.

### Rule 6
Do not imply “approved for design” unless a part-level approval record or derived policy supports that claim.

### Rule 7
Do not let seed data mask DB-backed failures except in explicit local fallback mode.

### Rule 8
Do not hide readiness blockers inside opaque scores or background-only logic.

---

## Long-term architectural direction

The long-term goal is not just to store part files.

The long-term goal is to build a platform that can reliably answer:

- what the correct part is
- whether the identity is trustworthy
- what mates with it
- what else is required
- which assets are trustworthy
- what can be recovered when files are missing
- what risks or blockers remain
- whether the part is approved for design use
- what is truly ready to move into engineering design tools

That is the architectural standard.
