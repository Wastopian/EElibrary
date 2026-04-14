# EE Library

EE Library is a normalized engineering platform for electrical engineers that helps users:

- find the right part
- resolve the right mates and companion parts
- understand which CAD/assets actually exist
- track provenance and trust
- recover missing CAD through datasheet-driven generation workflows
- export only when assets are truly ready

This is **not** a naive scraper and **not** just another footprint download site.

It is built around canonical part records, connector intelligence, engineering asset truth, and strict export honesty.

---

## Core differentiators

### Connector Intelligence
For connector parts, the platform can model:

- best mate
- alternate mates
- required accessories
- optional accessories
- cable compatibility
- buildable mating sets

### Engineering Asset Truth
Each engineering asset is tracked with explicit provenance and lifecycle state.

Examples:
- official
- trusted external
- generated
- manual internal
- reviewed
- verified for export

Lifecycle states include:
- missing
- referenced
- downloaded
- validated
- failed

### Datasheet-to-CAD Recovery
When symbol, footprint, or 3D assets are missing, the platform can expose fallback generation workflows based on available source material such as:

- package/mechanical data
- pin table data
- mechanical drawings

### Honest Export Gating
Export actions are enabled only when validated, downloadable assets truly exist.
Referenced URLs alone do not count as exportable files.

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
- strict seed fallback controls for local development only

### Not yet implemented
- production provider integrations
- large-scale external ingestion
- full datasheet parsing/extraction engine
- automatic CAD generation

---

## Monorepo structure

- `apps/web` - Next.js UI for search, detail views, engineering assets, and workflow states
- `apps/api` - provider-neutral HTTP API over DB-backed catalog data
- `apps/worker` - ingestion and persistence boundary for provider adapters and workflow jobs
- `packages/shared` - canonical domain types, runtime resolvers, and catalog logic
- `packages/ui` - reusable UI primitives and design system
- `infra/postgres` - incremental SQL schema and migrations

---

## Product truth

A platform that exposes every component footprint, 3D model, perfect metric, and perfect mate does not exist by magic.

Some parts will have:

- incomplete metadata
- missing CAD
- conflicting source data
- messy datasheets
- licensing limits on redistribution

EE Library is designed to handle that reality explicitly through normalization, provenance, workflow state, and reviewable generation paths.

---

## Architecture principles

- canonical DB is the source of truth
- UI stays provider-neutral
- source provenance is explicit
- generated assets never pretend to be official
- export readiness must be earned
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
```
