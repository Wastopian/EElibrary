# EE Library

EE Library is an engineering-first part readiness workspace for electrical and hardware teams.

The product is built around one flow:

`search -> inspect -> trust -> export`

Instead of treating catalog presence as success, EE Library keeps part identity, connector buildability, asset truth, approval state, and export readiness explicit.

## What Ships Today

- provider-neutral part search with readiness, approval, and connector-class filters
- homepage quick part readiness check for MPN, provider part reference, provider URL, and datasheet URL intake
- part detail workspace with backend-provided readiness summary, issues, risk flags, and export blockers
- connector buildable-set projection with best mate, required accessories, optional accessories, cables, and confidence warnings
- asset truth, validation, review, and explicit verified-for-export promotion flow
- admin workspace for review, promotion, import, validation, and issue-driven operations queues
- worker-backed provider import pipeline with persisted part-level readiness and approval projections

## Current Boundaries

- compare and tools pages are intentionally hidden until they are functional
- subcategory search facets are still planned and should not be surfaced until persisted data exists
- multi-provider conflict resolution, broad datasheet extraction, and production-grade automatic CAD generation remain planned work

## Monorepo Layout

- `apps/web` - Next.js engineering workspace
- `apps/api` - provider-neutral HTTP API and workflow actions
- `apps/worker` - provider adapters, ingestion, normalization, and readiness recomputation
- `packages/shared` - canonical types, readiness logic, search/runtime helpers
- `packages/db` - typed database schema
- `packages/ui` - shared UI primitives
- `infra/postgres` - incremental SQL migrations

## Docs Map

- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) - shipped vs planned status matrix
- [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md) - product intent and scope
- [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) - system boundaries and runtime responsibilities
- [`docs/UI_UX_BRIEF.md`](docs/UI_UX_BRIEF.md) - engineering-first UI guidance
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) - canonical entity and relationship model
- [`docs/ROADMAP.md`](docs/ROADMAP.md) - staged delivery plan

The deeper docs describe product intent. `docs/IMPLEMENTATION_STATUS.md` tracks what is actually live in the repo today. Contract or workflow changes should update both the relevant source doc and the implementation-status matrix in the same change set.

## Local Development

```bash
npm install
npm run typecheck
npm test
npm run dev
```

Useful service-specific commands:

```bash
npm run dev:web
npm run dev:api
npm run dev:worker
npm run ingest:local
npm run ingest:jlcparts
npm run imports:providers
```

## Product Rules

- keep `web`, `api`, and `worker` separated
- keep provider-specific logic out of UI components
- never present uncertain metadata as certain
- keep export actions tied to real file availability
- preserve provenance for normalized data and assets
