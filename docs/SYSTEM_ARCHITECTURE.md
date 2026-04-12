# System Architecture

## Recommended stack
### Frontend
- Next.js + TypeScript
- Tailwind or similar fast UI system
- reusable shared UI package

### Backend
- dedicated API service
- separate worker for ingestion, parsing, and export packaging

### Data
- PostgreSQL for normalized entities
- JSONB for raw provider payloads
- S3-compatible storage for datasheets and CAD files
- Redis queue for background jobs

## Core services
### Web
- search
- component detail
- compare
- tools
- admin

### API
- part search
- component detail data
- asset manifests
- export requests
- admin actions

### Worker
- provider sync
- PDF extraction
- CAD metadata extraction
- normalization
- bundle creation
- validation runs

## Architectural rule
Use a **provider adapter layer** from the beginning.
Do not wire your whole codebase directly to one distributor or one CAD source unless you enjoy rebuilding it later for sport.
