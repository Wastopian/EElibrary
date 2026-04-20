# EE Library

EE Library is an **engineering part onboarding and readiness platform**.

It helps electrical and hardware engineers take a raw manufacturer part number and turn it into an **engineer-ready internal part record** that can actually be trusted in design work.

EE Library is especially valuable for **connectors and electromechanical parts**, where engineers often need more than basic catalog data. It is built to answer questions like:

- What exactly is this part?
- What mates with it?
- What accessories or companion parts are required?
- Which CAD assets actually exist?
- Which assets are official, external, generated, or internally reviewed?
- Can missing assets be recovered from datasheets or source material?
- Is this part actually ready to export into design workflows?
- What is the provenance and confidence level of the data?

This is **not** a naive scraper, **not** just another footprint download site, and **not** a generic electronics search engine.

EE Library is built around **canonical part records**, **connector intelligence**, **engineering asset truth**, **approval workflows**, and **strict export honesty**.

---

## Product vision

The goal of EE Library is simple:

> Turn raw part intake into a verified, enriched, engineer-ready record.

That means the platform is not just about finding parts. It is about making parts **usable with confidence**.

A successful part record should support:
- identity verification
- normalized specifications
- mate and accessory resolution
- CAD asset readiness
- provenance and trust
- review and approval
- honest export gating

---

## Core differentiators

### Part Readiness
EE Library centers on **part readiness**, not just part existence.

A part is not "ready" just because it was found in a provider catalog.  
It becomes ready when the system can clearly represent:

- what the part is
- how trustworthy the data is
- what related parts are required
- what CAD assets are available
- what still needs review before engineering use

### Connector Intelligence
For connector and electromechanical parts, the platform can model:

- best mate
- alternate mates
- required accessories
- optional accessories
- cable compatibility
- buildable mating sets
- near-match or family-confusion risk

This is where simple part search tools usually fall apart.

### Engineering Asset Truth
Each engineering asset is tracked with explicit provenance and lifecycle state.

Examples of provenance:
- official
- trusted external
- generated
- manual internal
- reviewed
- verified for export

Examples of lifecycle state:
- missing
- referenced
- downloaded
- validated
- failed

EE Library does not pretend all CAD is equally trustworthy.

### Datasheet-to-CAD Recovery
When symbol, footprint, or 3D assets are missing, the platform can expose fallback generation workflows based on available source material such as:

- package/mechanical data
- pin table data
- mechanical drawings

Generation is part of a **reviewable readiness pipeline**, not a magical black box.

### Honest Export Gating
Export actions are enabled only when validated, downloadable assets truly exist.

Referenced URLs alone do not count as exportable files.

The system is designed to be honest about what is actually ready, because false confidence in engineering data is how teams end up wasting time and building dumb mistakes into real hardware.

---

## Core workflow

EE Library is designed around this flow:

1. **Part intake**
   - Enter an MPN, provider reference, or source link

2. **Normalization**
   - Build or update a canonical part record

3. **Enrichment**
   - Resolve normalized specs, connector relationships, and asset state

4. **Readiness evaluation**
   - Determine what exists, what is missing, and what can be trusted

5. **Recovery / review**
   - Route missing or low-confidence assets and data into generation or approval workflows

6. **Export**
   - Allow export only when the required assets are truly ready

---

## Current implementation status

### Implemented
- monorepo foundation for web, API, worker, UI, and shared packages
- canonical domain types and normalized catalog model
- DB-backed catalog flows
- connector intelligence foundation
- engineering asset ranking and grouped asset summaries
- bundle readiness and precise asset/export wording
- generation request and workflow state pipeline
- review/approval workflow for generated and sourced engineering assets
- review-assisted promotion from approved drafts to verified-for-export assets
- first structured provider metadata adapter for JLCPCB/LCSC data through the worker layer
- idempotent provider import persistence with source freshness and failure diagnostics
- structured source extraction signals for missing-CAD requestability groundwork
- draft footprint and symbol generation from structured extraction signals
- validation evidence and promotion audit records for verified-for-export transitions
- strict seed fallback controls for local development only

### In progress / not yet implemented
- richer multi-provider ingestion and provider conflict resolution
- large-scale external ingestion
- full datasheet parsing/extraction engine
- production-grade automatic CAD generation
- 3D draft generation from mechanical drawings
- connector intelligence expansion for deeper mate/accessory resolution
- readiness scoring and workflow surfacing in the UI
- broader approval workflows for part onboarding and review

---

## Monorepo structure

- `apps/web` - Next.js UI for intake, readiness views, detail records, engineering assets, and workflow states
- `apps/api` - provider-neutral HTTP API over DB-backed catalog and workflow data
- `apps/worker` - ingestion and persistence boundary for provider adapters and workflow jobs
- `packages/shared` - canonical domain types, runtime resolvers, readiness logic, and catalog modeling
- `packages/ui` - reusable UI primitives and design system
- `infra/postgres` - incremental SQL schema and migrations

---

## Product truth

A platform that exposes every footprint, 3D model, exact metric, correct mate, and complete accessory set does not exist by magic.

Some parts will have:

- incomplete metadata
- missing CAD
- conflicting source data
- messy datasheets
- family ambiguity
- licensing limits on redistribution

EE Library is designed to handle that reality explicitly through normalization, provenance, workflow state, reviewable generation paths, and honest readiness reporting.

The point is not to fake completeness.  
The point is to make incompleteness **visible, actionable, and recoverable**.

---

## Architecture principles

- the canonical DB is the source of truth
- UI stays provider-neutral
- source provenance is explicit
- generated assets never pretend to be official
- export readiness must be earned
- part readiness is more important than raw import success
- connector and asset relationships must be modeled, not hand-waved
- DB failures must not be silently masked by seed data except in explicit local fallback mode

---

## Local workflow

```bash
npm install
npm run typecheck
npm run build
npm run dev
npm run dev:web
npm run dev:api
npm run dev:worker
npm run ingest:local
npm run ingest:jlcparts
npm run imports:providers