# Implementation Status

This document maps the product and architecture docs to the code that is actually shipped today.

For dated **git worktree / working-tree registration** (for example same-day integration notes), see [`REGISTER.md`](../REGISTER.md) in the repo root.

Status legend:

- `Shipped` - present in the repo and intended for use
- `Foundation` - underlying model or workflow exists, but the full product surface is not complete
- `Partial` - user-facing behavior exists, but intentionally limited or missing planned depth
- `Planned` - documented target, not shipped yet

---

## Mission Alignment

EE Library is a **private engineering memory system for hardware teams**. The repo ships a full **part-readiness loop** (search, import, detail, admin review, export gating) plus a **project/BOM memory** track: persisted projects and revisions, CSV and XLSX BOM intake, column mapping, deterministic row matching, confirmed `project_part_usages`, explainable **BOM health** and **fleet risk**, **revision compare**, **where-used** (parts, circuit blocks, connector sets, assets), **evidence** workspace, **circuit blocks** (library, detail, instantiation, reuse signals), **export bundles** with download UI, **approved substitutes**, **lifecycle regression** findings, **`/connector-sets`** catalog (FUNC15), and **approval batch** actions from project context (FUNC16).

Public provider/catalog data is input. Internal engineering truth is the product: approvals, evidence, usage history, risk findings, and follow-ups—not distributor browse parity.

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
| Approved part substitutions | `PRODUCT_REQUIREMENTS.md` | Shipped | `apps/web/src/components/PartSubstitutionPanel.tsx`, `apps/api/src/project-memory-store.ts`, `infra/postgres/030_part_substitutions.sql` | Engineering sign-off for alternates; hints surface on weak BOM rows where applicable. |
| Connector buildable set | `PRODUCT_REQUIREMENTS.md`, `DATA_MODEL.md` | Shipped | `packages/shared/src/connector-intelligence.ts`, `apps/worker/src/catalog-repository.ts`, `apps/api/src/catalog-store.ts`, `apps/web/src/app/parts/[partId]/page.tsx` | Includes best mate, optional accessories, alternate mates, evidence-weighted mate/accessory confidence, cable constraints, family-confusion warnings, and fallback note-derived cable assumptions. |
| Connector set catalog | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/app/connector-sets/page.tsx`, `apps/api/src/project-memory-store.ts` | `/connector-sets`: browse by `connector_class`, mate pairs from `mate_relations`, project usage counts (FUNC15). |
| Asset truth and export gating | `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` | Shipped | `packages/shared/src/asset-state.ts`, `packages/shared/src/review-workflow.ts`, `apps/web/src/lib/detail-view-model.ts` | Export actions stay disabled unless verified file-backed assets exist. Approved does not mean export-ready. |
| Review and promotion workflow | `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` | Shipped | `apps/api/src/catalog-store.ts`, `apps/web/src/app/admin/page.tsx` | Review approval, validation evidence, and explicit verified-for-export promotion remain separate. |
| Admin operations surfaces | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/AdminQueuePresentation.tsx` | Admin surfaces review, promotion, failed import, validation, and issue-driven operations queues. |
| Authenticated shell (non-admin routes) | `SYSTEM_ARCHITECTURE.md` | Shipped | `apps/web/src/middleware.ts`, `apps/web/src/auth.ts`, `apps/web/src/app/sign-in/page.tsx` | Session required for workspaces; `/admin` additionally requires admin role. |
| System health | `SYSTEM_ARCHITECTURE.md` | Shipped | `apps/api/src/system-health.ts`, `packages/shared/src/system-health-types.ts`, `apps/web/src/components/WorkerStatusBanner.tsx` | Reports API, database, storage, worker heartbeat, and async queue state. |
| Project records and dashboard | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/app/projects/page.tsx`, `apps/web/src/app/projects/[projectId]/page.tsx`, `apps/api/src/project-memory-store.ts` | Project creation, revisions, fleet risk summary, metadata editing. |
| CSV / XLSX BOM upload and mapping | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/components/BomImportPanel.tsx`, `apps/api/src/project-memory-store.ts`, `packages/shared/src/bom-csv.ts` | Preview, map columns, persist `BomImport` / `BomLine` rows with raw payloads. Does not by itself create catalog parts. |
| BOM row matching and confirmed usage | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Shipped | `apps/web/src/components/BomImportMatchPanel.tsx`, `apps/api/src/project-memory-store.ts` (`matchBomImportRowsInDatabase`) | Deterministic matching creates/updates `project_part_usages` when evidence supports exact internal identity. |
| BOM health, diagnostics, follow-ups | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Shipped | `apps/web/src/components/BomDiagnosticsPanel.tsx`, `FollowUpPanel.tsx`, `apps/api/src/project-memory-store.ts` | Explainable findings, sync to follow-up records, lifecycle regression (`lifecycle_risk_changed`), substitution hints. |
| Approval batch from project BOM context | `PRODUCT_REQUIREMENTS.md` | Shipped | `apps/web/src/components/ApprovalBatchPanel.tsx`, `apps/api/src/project-memory-store.ts` | Candidates + bulk approve / flag-for-review with project-context evidence only on `part_approvals` (FUNC16). |
| Project revision BOM compare | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Shipped | `BomDiagnosticsPanel` revision compare section, `readProjectRevisionCompareFromDatabase` | Diff across revisions with grouped change kinds. |
| Where-used search | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Shipped | `apps/web/src/app/where-used/page.tsx`, `apps/api/src/project-memory-store.ts` | Parts, circuit blocks, connector sets (via `mate_relations`), assets (via export bundle manifests). |
| Evidence vault workspace | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Shipped | `apps/web/src/app/evidence/page.tsx`, evidence attachment panels, storage-backed upload path | Central browse/filter/review; metadata targets projects, BOM lines, parts, findings, blocks. |
| Circuit block library and detail | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Shipped | `apps/web/src/app/circuit-blocks/`, `apps/api/src/project-memory-store.ts` | CRUD-style editing boundaries, part roles, reuse intelligence, instantiation into BOM. |
| Export bundles (project) | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Shipped | `apps/web/src/components/ExportBundlePanel.tsx`, `apps/api/src/project-memory-store.ts` | Manifest-first bundles; download links when file-backed storage keys exist. |
| Part compare workspace | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md`, `AGENTS.md` | Shipped | `apps/web/src/app/compare/page.tsx`, `apps/web/src/lib/part-compare.ts`, `buildCompareUrl` in `apps/web/src/lib/api-client.ts` | `/compare?parts=id1,id2,...` (up to four parts): identity, readiness, approval, bundle gate, union of normalized metrics. Sidebar nav includes Compare. |
| Stored PDF inline preview (asset cards) | `PRODUCT_REQUIREMENTS.md`, `AGENTS.md` | Partial | `apps/web/src/components/AssetInlinePreview.tsx`, existing `/parts/:id/assets/:assetId/download` | Embeds stored PDFs when `previewStatus` is `ready`, `fileFormat` is `pdf`, and availability is `downloaded` or `validated`. Reference-only PDFs stay download-only with explicit copy. STEP/CAD formats remain download-only. |

---

## Foundation and Partial Matrix

| Area | Source Doc | Status | Current Repo Surface | What Remains |
| --- | --- | --- | --- | --- |
| Admin issue-driven queues | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Partial | `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/AdminQueuePresentation.tsx` | Queues render when backend evidence exists. Duplicate merge automation and broader assignment workflow remain planned. |
| Provider conflict resolution | `SYSTEM_ARCHITECTURE.md`, `ROADMAP.md` | Partial | `apps/api/src/catalog-store.ts`, `apps/web/src/app/admin/page.tsx` | Source-conflict surfacing and reconciliation actions exist. Richer multi-provider merge policy remains planned. |
| Datasheet extraction and CAD generation depth | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Foundation | Worker extraction signals, draft generation paths | Broader parsing, 3D/preview generation, production-grade CAD outputs remain planned. |
| Compare depth and EE tools | `UI_UX_BRIEF.md`, `ROADMAP.md` | Partial | Basic `/compare` in primary nav (`apps/web/src/app/compare/page.tsx`, `AppNavigation.tsx`); no `/tools` route yet | Deeper connector/CAD compare matrices and EE calculators remain incremental (`AGENTS.md` priority). |

---

## Planned Product Extensions

| Area | Source Doc | Status | Planned Surface | Notes |
| --- | --- | --- | --- | --- |
| Tools / calculators | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md`, `AGENTS.md` | Planned | `/tools` or similar | EE calculators once compare and BOM workflows stay stable. |
| Richer admin automation | `PRODUCT_REQUIREMENTS.md` | Planned | Assignment, bulk merge, notifications | Beyond current queue surfacing. |
| Deeper compare dimensions | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Planned | Connector diff, side-by-side CAD preview | Basic compare shipped; richer CAD/connector matrices remain incremental work. |

---

## Coordination Rules

- The source docs describe product intent and architectural direction.
- This file records what is implemented right now.
- Public provider data should be described as input, not as the product itself.
- Do not describe **tools/calculators**, **production-grade extraction/generation**, or **deep connector/CAD compare matrices** as shipped until this matrix includes them. Basic `/compare` for metrics and readiness **is** shipped.
- If a contract, workflow, filter, page behavior, or product framing changes, update this file and the relevant source doc in the same change set.
