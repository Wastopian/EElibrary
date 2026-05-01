# Implementation Status

This document maps the product and architecture docs to the code that is actually shipped today.

Status legend:

- `Shipped` - present in the repo and intended for use
- `Foundation` - underlying model or workflow exists, but the full product surface is not complete
- `Partial` - user-facing behavior exists, but intentionally limited or missing planned depth
- `Planned` - documented target, not shipped yet

---

## Mission Alignment

EE Library is now framed as a **private engineering memory system for hardware teams**.

The current repo ships the part-readiness foundation plus the first project/BOM memory write path. It does not yet ship BOM row matching, where-used history, reusable circuit block records, an evidence vault, or a BOM health dashboard.

Public provider/catalog data is treated as input. Internal engineering truth is the product: readiness, provenance, evidence, approvals, verified export state, connector buildability, and eventually project usage history.

---

## Shipped Surface Matrix

| Area | Source Doc | Status | Current Repo Surface | Notes |
| --- | --- | --- | --- | --- |
| Catalog workbench entry | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/app/page.tsx`, `apps/web/src/app/catalog/page.tsx` | `/` and `/catalog` open into the catalog workbench instead of a marketing-only page. |
| Quick part readiness check | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/app/page.tsx`, `apps/web/src/app/catalog/page.tsx` | Supports MPN, provider part reference, provider URL, and datasheet URL intake. |
| Search filters and triage | `PRODUCT_REQUIREMENTS.md` | Shipped | `apps/web/src/app/catalog/page.tsx`, `apps/api/src/catalog-store.ts` | Search supports readiness, approval, CAD availability, lifecycle, manufacturer, package, category, sort, and connector-class filtering. |
| Dense search results table | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/components/CatalogResultsPresentation.tsx` | Results expose identity, datasheet, CAD/export state, readiness, and next action. |
| Exact-MPN provider import | `PRODUCT_REQUIREMENTS.md` | Shipped | `apps/api/src/provider-import-request.ts`, `apps/web/src/components/ImportByMpnPanel.tsx` | Concrete no-match MPN searches can use direct provider import from configured providers. This is not broad live provider search. |
| Supported MVP import providers | `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` | Shipped | `apps/worker/src/providers`, `apps/worker/src/local-catalog-provider.ts` | `local-catalog` supports deterministic development fixtures; `jlcparts` supports JLCPCB/LCSC metadata intake. |
| Part readiness summary contract | `SYSTEM_ARCHITECTURE.md` | Shipped | `packages/shared/src/part-readiness.ts`, `apps/api/src/catalog-store.ts`, `apps/worker/src/catalog-repository.ts` | Persisted and exposed as backend truth for search and detail. |
| Part detail answer-first surface | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/app/parts/[partId]/page.tsx` | Detail pages start with use decision, datasheet state, CAD/export state, provenance, and next action. |
| Next-action model | `PRODUCT_REQUIREMENTS.md` | Shipped | `apps/web/src/lib/detail-view-model.ts`, `apps/web/src/app/catalog/page.tsx`, `apps/web/src/app/parts/[partId]/page.tsx` | Readiness issues map to concrete follow-up actions in catalog rows and detail pages. |
| Whole-part approval, issues, and risk flags | `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` | Shipped | `packages/shared/src/types.ts`, `apps/api/src/catalog-store.ts`, `apps/web/src/app/parts/[partId]/page.tsx` | UI consumes API truth instead of inventing whole-part readiness in view-model helpers. Imported does not mean approved. |
| Connector buildable set | `PRODUCT_REQUIREMENTS.md`, `DATA_MODEL.md` | Shipped | `packages/shared/src/connector-intelligence.ts`, `apps/worker/src/catalog-repository.ts`, `apps/api/src/catalog-store.ts`, `apps/web/src/app/parts/[partId]/page.tsx` | Includes best mate, optional accessories, alternate mates, evidence-weighted mate/accessory confidence, cable constraints, family-confusion warnings, and fallback note-derived cable assumptions. |
| Asset truth and export gating | `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` | Shipped | `packages/shared/src/asset-state.ts`, `packages/shared/src/review-workflow.ts`, `apps/web/src/lib/detail-view-model.ts` | Export actions stay disabled unless verified file-backed assets exist. Approved does not mean export-ready. |
| Review and promotion workflow | `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` | Shipped | `apps/api/src/catalog-store.ts`, `apps/web/src/app/admin/page.tsx` | Review approval, validation evidence, and explicit verified-for-export promotion remain separate. |
| Admin operations surfaces | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/AdminQueuePresentation.tsx` | Admin surfaces review, promotion, failed import, validation, and issue-driven operations queues. |
| System health | `SYSTEM_ARCHITECTURE.md` | Shipped | `apps/api/src/system-health.ts`, `packages/shared/src/system-health-types.ts`, `apps/web/src/components/WorkerStatusBanner.tsx` | Reports API, database, storage, worker heartbeat, and async queue state. |
| Project records and dashboard | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/app/projects/page.tsx`, `apps/web/src/app/projects/[projectId]/page.tsx`, `apps/api/src/project-memory-store.ts` | Users can create project records, create an initial revision, and view persisted project/revision/BOM/usage foundations. |
| CSV BOM upload and column mapping | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/components/BomImportPanel.tsx`, `apps/api/src/project-memory-store.ts`, `packages/shared/src/bom-csv.ts` | Users can preview CSV rows, map columns, and persist raw/mapped `BomImport` and `BomLine` rows. Upload does not create parts, matches, usage, approvals, or risk findings. |

---

## Foundation and Partial Matrix

| Area | Source Doc | Status | Current Repo Surface | What Remains |
| --- | --- | --- | --- | --- |
| Admin issue-driven queues | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Partial | `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/AdminQueuePresentation.tsx` | Identity, approval, CAD-gap, connector, duplicate, lifecycle, and source-conflict queues appear when backend evidence exists. Duplicate merge automation and broader assignment workflow remain planned. |
| Provider conflict resolution | `SYSTEM_ARCHITECTURE.md`, `ROADMAP.md` | Partial | `apps/api/src/catalog-store.ts`, `apps/web/src/app/admin/page.tsx` | Source-conflict issue surfacing plus preferred-source or mixed-source reconciliation actions are shipped. Broader multi-provider merge policy and richer reconciliation tooling remain planned. |
| Datasheet extraction and CAD generation depth | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Foundation | Worker extraction signals and draft generation paths | Structured extraction groundwork and draft symbol/footprint generation exist. Broader parsing, 3D generation, preview generation, and production-grade generation remain planned. |
| Evidence-based validation | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Foundation | Validation evidence and promotion audit records | Asset validation evidence exists for export promotion. A broader evidence vault for project, BOM, review, and circuit-block decisions remains planned. |
| Internal reuse concepts | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Foundation | Readiness, approval, connector, asset, provenance, project, and BOM import records | The repo has the part-readiness and BOM intake truth needed for internal reuse, but matching, usage creation, and where-used search are not shipped. |
| Compare and tools pages | `UI_UX_BRIEF.md`, `ROADMAP.md` | Planned | Hidden from primary navigation | Kept out of nav until functional. |

---

## Planned Engineering Memory Matrix

These capabilities are product direction, not current shipped behavior.

| Area | Source Doc | Status | Planned Surface | Notes |
| --- | --- | --- | --- | --- |
| BOM row matching | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Planned | Matching flow for exact, ambiguous, weak, and unmatched rows | Required before uploaded BOM rows can become confirmed usage. |
| Part-to-project usage history | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Planned | Usage records linking confirmed internal parts to projects and BOM rows | The table exists, but upload does not create usage. This remains planned until matching exists. |
| Where-used search | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Planned | Search across parts, connector sets, assets, and circuit blocks | Must not be implied until usage records exist. |
| BOM health dashboard | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Planned | Project-level risk dashboard | Should summarize approval, lifecycle, CAD/export, evidence, connector, and reuse risk. |
| Evidence attachments / evidence vault | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Planned | Attachment model and evidence workspace | Broader than shipped asset validation evidence. |
| Circuit block records | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Planned | Structured reusable circuit block entity | Circuit blocks should be engineering knowledge with parts, evidence, constraints, risk, and usage history. |

---

## Coordination Rules

- The source docs describe product intent and architectural direction.
- This file records what is implemented right now.
- Public provider data should be described as input, not as the product itself.
- Planned matching, where-used, circuit block, evidence vault, and BOM health workflows must stay out of shipped-feature claims until implemented.
- If a contract, workflow, filter, page behavior, or product framing changes, update this file and the relevant source doc in the same change set.
