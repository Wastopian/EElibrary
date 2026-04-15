# System Architecture

EE Library is a provider-neutral engineering platform, not a distributor clone and not a passive CAD file mirror.

The architecture is designed around five core goals:

1. maintain a canonical engineering record for each part
2. model connector compatibility and buildable relationships explicitly
3. track engineering asset truth, readiness, and trust boundaries
4. support missing-CAD recovery through typed workflows
5. allow export only when assets are truly ready and appropriately reviewed

---

## Architectural principles

### 1. Canonical database is the source of truth
The application must not depend on live external sites at request time.

External sources are ingested into a normalized internal model.
The web app and API read from the canonical database, not directly from distributor pages or CAD provider pages.

### 2. Provider neutrality is mandatory
The system must use a provider adapter layer from the beginning.

No UI, shared runtime logic, or core API contract should be tightly coupled to one distributor, one CAD source, or one scraping strategy.

### 3. Trust boundaries must be explicit
The architecture must preserve the distinction between:

- sourced data
- normalized data
- generated data
- reviewed data
- verified-for-export data

Generated outputs must never silently cross into trusted/exportable status.

### 4. Request-time behavior must stay deterministic
Search, detail views, connector intelligence, and asset status must be served from internal state.

Long-running work such as ingestion, extraction, generation, validation, and bundling must happen asynchronously through worker pipelines.

### 5. Runtime paths must remain seed-free
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
- separate worker service for ingestion, extraction, normalization, generation, validation, and export packaging

### Data and infrastructure
- PostgreSQL for canonical normalized entities
- JSONB for raw provider payloads and source snapshots where appropriate
- S3-compatible object storage for datasheets, CAD files, previews, generated assets, and export bundles
- Redis-backed queue for ingestion, generation, validation, review, and export jobs

---

## System layers

## 1. Web application layer

The web layer is the engineering workspace presented to the user.

Responsibilities:
- search and discovery
- component detail workspace
- connector intelligence presentation
- engineering asset presentation
- missing-asset fallback actions
- review and workflow state presentation
- compare and future engineering tools

The web layer must remain:
- provider-neutral
- trust-aware
- explicit about uncertainty
- incapable of implying file existence or export readiness beyond what the API proves

### Key surfaces
- Search
- Component detail
- Recommended Buildable Set
- Engineering Assets
- Missing Assets / Fallback Actions
- Similar Parts
- Typical Companion Parts
- Compare
- Admin / review tools

---

## 2. API layer

The API is the contract boundary between the UI and the engineering platform state.

Responsibilities:
- part search
- component detail resolution
- connector relationship projection
- buildable mating set projection
- grouped asset summaries
- bundle readiness summaries
- generation request creation
- workflow status exposure
- review status exposure
- export request handling
- admin/review actions

The API must:
- return typed, deterministic responses
- distinguish between unavailable, incomplete, and ready states
- never silently mask DB or schema failures with fake success behavior
- expose derived projections without leaking provider-specific logic

### Important derived API concepts
- BuildableMatingSet
- EngineeringAssetSummary
- AssetBundleReadiness
- SourceReadiness
- GenerationRequestability
- ReviewStatus
- ExportReadiness

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
- export bundle creation

The worker layer is the correct home for:
- provider-specific mapping
- heuristics
- extraction logic
- normalization pipelines
- generation orchestration

The worker layer must not push provider-specific assumptions into the API or UI.

---

## 4. Canonical data layer

The canonical data layer stores the platform’s normalized engineering truth.

Core responsibilities:
- canonical part identity
- source-backed engineering metrics
- connector families and compatibility relations
- asset metadata and availability state
- generation requests and workflows
- review records
- export trust state

This layer is what allows the platform to answer engineering questions consistently even when source systems are incomplete, conflicting, or temporarily unavailable.

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
- verified for export

---

## 6. Queue and workflow layer

Background jobs and workflow orchestration must be explicit.

Primary workflow families:
- ingestion jobs
- normalization jobs
- generation request jobs
- validation jobs
- review-preparation jobs
- export bundle jobs

This layer exists to keep user-facing requests fast and deterministic while allowing the system to do heavier engineering work in the background.

---

## Core subsystems

## Connector Intelligence Subsystem

This subsystem is one of the key differentiators of the platform.

Responsibilities:
- store connector relationships in normalized tables
- model best mate and alternate mates
- model required and optional accessories
- model cable compatibility
- expose a provider-neutral Buildable Mating Set
- preserve confidence and provenance for all relationship records

Rules:
- relationships must be structured records, not loose notes
- uncertain compatibility remains labeled as uncertain
- required accessories must be included in buildable-set outputs
- provider-specific heuristics stay in worker adapters, not the UI

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

## Review and Approval Subsystem

This subsystem creates the trust gate between “generated or sourced” and “safe to use for export.”

Responsibilities:
- track review records
- support approve / reject / changes requested workflows
- separate reviewed from verified_for_export
- store validation evidence before export promotion
- audit successful and denied export-promotion attempts
- expose review state to API and UI
- preserve reviewer notes and auditability

Rules:
- generated does not imply approved
- approved does not automatically imply verified_for_export; a separate promotion step must satisfy export rules
- promotion to verified_for_export requires qualifying validation evidence
- export readiness must be explicit and earned

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

---

## Ingestion architecture

The ingestion pipeline should follow this general pattern:

1. fetch source payload from provider adapter
2. store raw source snapshot
3. normalize into canonical contract
4. register or update source record
5. record source freshness, import status, and any import failure details
6. register or update extracted source-readiness signals
7. register or update part metrics
8. register or update asset metadata
9. register or update connector and recommendation relationships
10. run validation and readiness updates
11. publish searchable canonical state

This architecture allows the system to absorb data from multiple providers without letting any one provider dictate the internal model.

---

## Request-time architecture

Typical user request flow:

### Search
1. user submits query
2. web calls API
3. API reads canonical DB/search projection
4. API returns normalized part summaries, asset readiness, and filters
5. web renders provider-neutral engineering search results

### Component detail
1. user opens a part
2. web calls API
3. API resolves:
   - canonical part data
   - normalized metrics
   - connector intelligence
   - grouped engineering assets
   - bundle readiness
   - generation requestability
   - review/export state
4. web renders the engineering workspace

### Generation request
1. user requests missing asset recovery
2. API validates requestability
3. API persists generation request
4. worker processes workflow asynchronously
5. API and UI expose workflow state
6. outputs enter review-aware asset flow

---

## Storage strategy

### PostgreSQL
Use PostgreSQL for:
- canonical part records
- source records
- normalized metrics
- connector relations
- asset metadata
- generation requests and workflows
- source extraction signals
- review records
- export state

### JSONB
Use JSONB for:
- raw provider payload snapshots
- parser/intermediate artifacts
- source-specific details that should not pollute the canonical model

### Object storage
Use object storage for:
- downloaded datasheets and CAD files
- generated assets
- preview files
- export bundles

---

## Architectural rules

### Rule 1
Do not wire the platform directly to a single distributor or CAD source.

### Rule 2
Do not perform live scraping in user-facing request paths.

### Rule 3
Do not let UI components interpret provider-specific quirks.

### Rule 4
Do not collapse provenance, review, and export trust into one vague status.

### Rule 5
Do not imply “exportable” unless the underlying asset bundle is truly ready.

### Rule 6
Do not let seed data mask DB-backed failures except in explicit local fallback mode.

---

## Long-term architectural direction

The long-term goal is not just to store part files.

The long-term goal is to build a platform that can reliably answer:

- what the correct part is
- what mates with it
- what else is required
- which assets are trustworthy
- what can be recovered when files are missing
- what is truly ready to move into engineering design tools

That is the architectural standard.
