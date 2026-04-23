# Implementation Status

This document maps the product and architecture docs to the code that is actually shipped today.

Status legend:

- `Shipped` - present in the repo and intended for use
- `Partial` - present, but intentionally limited or still missing planned depth
- `Planned` - documented target, not shipped yet

## Surface Matrix

| Area | Source Doc | Status | Current Repo Surface | Notes |
| --- | --- | --- | --- | --- |
| Quick Part Readiness Check | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Shipped | `apps/web/src/app/page.tsx` | Homepage is the primary quick-check workspace. Supports MPN, provider part reference, provider URL, and datasheet URL intake. |
| Search filters and triage | `PRODUCT_REQUIREMENTS.md` | Shipped | `apps/web/src/app/page.tsx`, `apps/api/src/catalog-store.ts` | Search supports readiness, approval, CAD availability, lifecycle, manufacturer, package, and connector-class filtering. |
| Subcategory search | `PRODUCT_REQUIREMENTS.md` | Planned | Not surfaced | Hidden until worker persistence exists for real subcategory data. |
| PartReadinessSummary contract | `SYSTEM_ARCHITECTURE.md` | Shipped | `packages/shared/src/part-readiness.ts`, `apps/api/src/catalog-store.ts`, `apps/worker/src/catalog-repository.ts` | Persisted and exposed as backend truth for search and detail. |
| Whole-part approval, issues, and risk flags | `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` | Shipped | `packages/shared/src/types.ts`, `apps/api/src/catalog-store.ts`, `apps/web/src/app/parts/[partId]/page.tsx` | UI consumes API truth instead of inventing whole-part readiness in view-model helpers. |
| Connector buildable set | `PRODUCT_REQUIREMENTS.md`, `DATA_MODEL.md` | Shipped | `packages/shared/src/connector-intelligence.ts`, `apps/worker/src/catalog-repository.ts`, `apps/api/src/catalog-store.ts`, `apps/web/src/app/parts/[partId]/page.tsx` | Includes optional accessories, alternate mates, evidence-weighted mate/accessory confidence, compact warning details, DB-backed cable constraints, persisted connector-family conflicts from best/alternate mate evidence, and note-derived cable assumptions only as fallback context. |
| Asset truth and export gating | `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` | Shipped | `packages/shared/src/asset-state.ts`, `packages/shared/src/review-workflow.ts`, `apps/web/src/lib/detail-view-model.ts` | Export actions stay disabled unless verified file-backed assets exist. |
| Review and promotion workflow | `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` | Shipped | `apps/api/src/catalog-store.ts`, `apps/web/src/app/admin/page.tsx` | Review and explicit verified-for-export promotion remain separate. |
| Admin issue-driven queues | `PRODUCT_REQUIREMENTS.md`, `UI_UX_BRIEF.md` | Partial | `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/admin/AdminQueuePresentation.tsx` | Review/promotion/import/validation sections ship today. Identity, approval, CAD-gap, connector, duplicate, lifecycle, and source-conflict queues appear only when backend evidence exists. Issue workflow state, assignee, resolution notes, and resolve/reopen actions are shipped. Duplicate merge automation remains planned. |
| Provider import intake expansion | `PRODUCT_REQUIREMENTS.md` | Shipped | `apps/api/src/provider-import-request.ts`, `apps/web/src/components/ImportByMpnPanel.tsx` | Intake accepts provider URL and datasheet URL without changing the provider-neutral contract boundary. |
| Provider conflict resolution | `SYSTEM_ARCHITECTURE.md`, `ROADMAP.md` | Partial | `apps/api/src/catalog-store.ts`, `apps/web/src/app/admin/page.tsx` | Source-conflict issue surfacing plus preferred-source or mixed-source reconciliation actions are shipped. Broader multi-provider merge policy and richer reconciliation tooling remain planned. |
| Datasheet extraction and CAD generation depth | `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md` | Partial | Worker extraction signals and draft generation exist | Structured extraction groundwork and draft symbol/footprint generation ship today; broader parsing and production-grade generation remain planned. |
| Compare and tools pages | `UI_UX_BRIEF.md`, `ROADMAP.md` | Planned | Hidden from primary navigation | Kept out of nav until functional. |

## Coordination Rules

- The source docs describe product intent and architectural direction.
- This file records what is implemented right now.
- If a contract, workflow, filter, or page behavior changes, update this file and the relevant source doc in the same change set.
