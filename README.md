# EE Library Starter Pack

This pack gives you a sane starting point for building an **advanced EE library platform** with Codex.

## Included
- `AGENTS.md` - repo rules for Codex and other coding agents
- `docs/PRODUCT_REQUIREMENTS.md` - product scope and feature priorities
- `docs/SYSTEM_ARCHITECTURE.md` - system design and module boundaries
- `docs/DATA_MODEL.md` - normalized entities and ingestion model
- `docs/UI_UX_BRIEF.md` - page map and interface direction
- `docs/ROADMAP.md` - phased implementation plan

## Product truth
A platform that exposes **every** component footprint, 3D model, and perfect datasheet metric does not exist by magic.

Some parts will have:
- incomplete metadata
- no STEP file
- terrible PDF formatting
- licensing limits on redistribution
- conflicting package data across sources

So build this as a **normalized engineering asset system**, not as a naive scraper.

## Best first milestone
1. Search
2. Component detail page
3. Asset registry
4. Export bundle flow

That gets you to something useful instead of a massive half-built cathedral.

## Phase 0 and Phase 1 scaffold
- `apps/web` - Next.js search and component detail shell.
- `apps/api` - provider-neutral HTTP API skeleton over seeded shared data.
- `apps/worker` - worker boundary with documented ingestion stages only.
- `packages/shared` - normalized domain types, seed records, search helpers, and export availability rules.
- `packages/ui` - provider-neutral dark-mode UI primitives.
- `infra/postgres` - Phase 1 SQL schema aligned to `docs/DATA_MODEL.md`.

## Phase 2 data flow
- `apps/worker` includes a `local-catalog` provider adapter that reads deterministic provider payloads, normalizes them through shared helpers, and persists canonical rows into Postgres.
- `infra/postgres/002_phase2_asset_registry.sql` adds source-record provenance, record update timestamps, and asset lifecycle states: `missing`, `referenced`, `downloaded`, `validated`, and `failed`.
- `infra/postgres/003_connector_intelligence_hardening.sql` upgrades older databases with connector relationship tables, asset provenance/status columns, generation workflows, and conservative backfills.
- `apps/api` reads parts, facets, and details from Postgres when `DATABASE_URL` is configured and reachable. It uses seed data only when `EE_LIBRARY_ALLOW_SEED_FALLBACK=true` is explicitly set for local development.
- `apps/web` stays provider-neutral and reads provenance, asset state, confidence, and updated timestamps from the API response.
- Export actions require validated downloadable assets with storage and hash evidence. Referenced URLs do not count as downloaded files.

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

For DB-backed local ingestion, start Postgres and set `DATABASE_URL` before running `npm run ingest:local`.
For seed-only local API development, set `EE_LIBRARY_ALLOW_SEED_FALLBACK=true`; DB schema or access failures are otherwise returned explicitly.
Seed assets intentionally mix referenced metadata, missing files, validated files, and export-verified files so export actions can demonstrate strict gating.
The web app reads search and detail data through `apps/api`; run `npm run dev` for both services together.
