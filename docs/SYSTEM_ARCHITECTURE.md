# System Architecture

## Recommended stack
### Frontend
- Next.js + TypeScript
- Tailwind or similar fast UI system
- reusable shared UI package

### Backend
- dedicated API service
- separate worker for ingestion, parsing, asset generation, and export packaging

### Data
- PostgreSQL for normalized entities
- JSONB for raw provider payloads
- S3-compatible storage for datasheets and CAD files
- Redis queue for background jobs

## Core services
### Web
- search
- component detail
- connector relationships workspace
- asset registry and preview
- compare
- tools
- admin

### API
- part search
- component detail data
- connector relationship graph
- asset manifests
- generation workflow state
- export requests
- admin actions

### Worker
- provider sync
- PDF extraction
- mechanical drawing extraction
- CAD metadata extraction
- normalization
- datasheet-driven footprint/symbol/3D generation
- validation runs
- bundle creation

## Connector intelligence subsystem
- Store connector relationships in normalized tables.
- Compute a provider-neutral `buildable mating set` projection in API.
- Include confidence and provenance in all relationship records.
- Keep heuristics and provider mapping in worker adapters, not UI.

## Asset intelligence subsystem
- Treat symbol, footprint, 3D model, datasheet, and mechanical drawing as first-class assets.
- Separate `asset provenance` from `validation status` and from `export verification`.
- Never map generated assets to official provenance.
- Gate export actions on true file-backed assets plus verification state.

## Architectural rule
Use a **provider adapter layer** from the beginning.
Do not wire your whole codebase directly to one distributor or one CAD source unless you enjoy rebuilding it later for sport.
