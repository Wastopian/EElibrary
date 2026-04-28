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
- `apps/api` reads parts, facets, and details from Postgres when `DATABASE_URL` is configured and reachable. It falls back to seed data only when the database is not configured or unavailable.
- `apps/web` stays provider-neutral and reads provenance, asset state, confidence, and updated timestamps from the API response.
- Export actions require validated downloadable assets with storage and hash evidence. Referenced URLs do not count as downloaded files.

## Local workflow

The fast path on a clean clone:

```bash
npm install
npm run setup:dev
npm run dev
```

`npm run setup:dev` is idempotent and does the full local bootstrap:
1. Copies `.env.example` to `.env` if missing.
2. Generates `AUTH_SECRET` if missing.
3. Starts the Docker services in `compose.yaml` (Postgres, Redis, MinIO).
4. Waits for Postgres to accept connections.
5. Applies all migrations in `infra/postgres/`.
6. Seeds a local admin user (`admin@ee-library.local` / `localdev-admin`).
7. Seeds a few demo parts so search returns results immediately.
8. Prints the web/API URLs and follow-up commands.

After setup, the day-to-day commands:

```bash
npm run dev            # web + api together
npm run dev:web
npm run dev:api
npm run dev:worker
npm run ingest:local

npm run db:status      # show applied/pending migrations
npm run db:migrate     # apply pending migrations
npm run db:reset       # drop + re-apply schema (localhost DATABASE_URL only; pass -- --force otherwise)

npm run seed:admin                         # create admin if missing (no-op when present)
npm run seed:admin -- --reset-password     # rotate the admin password to the default
npm run seed:admin -- --email me@x.dev --password chang3me!   # custom credentials
npm run seed:parts                         # re-run the demo catalog seed (idempotent)

npm run typecheck
npm run build
npm test
```

The current seed data is intentionally metadata-only for assets. Export actions stay disabled until validated downloadable assets exist.
The web app reads search and detail data through `apps/api`; run `npm run dev` for both services together.

### Manual verification path

After a fresh `git clone`:
1. `npm install`
2. `npm run setup:dev`
3. `npm run dev`
4. Open the printed Web URL, search for `TPS7A02DBVR`, and confirm the seeded part appears.
5. The admin login (`admin@ee-library.local` / `localdev-admin`) is printed at the end of `setup:dev` for use by future protected admin/import flows.
