# Engineering memory and roadmap archive

This document captures **what is done**, **how the merged product is operated**, and **where to look next**. It intentionally avoids duplicating tables that already live in [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md).

- **Active backlog only:** [`TODO.md`](../TODO.md) in the repo root.
- **Completed FUNC / backlog narratives (frozen):** [`docs/TODO_COMPLETED_ARCHIVE.md`](./TODO_COMPLETED_ARCHIVE.md).
- **Dated worktree / integration notes:** [`REGISTER.md`](../REGISTER.md).
- **Agent / repo rules:** [`AGENTS.md`](../AGENTS.md).

---

## Repo integration note (2026-05-03)

`main` was previously the slimmer **phase-2-foundation** line (catalog search/detail + worker ingest) after PR #1. The full **engineering-memory** implementation lived on branch `cursor/2026-05-03-7o4u-787f9` (tip `d559ca4`), including the FUNC-numbered backlog now preserved in [`docs/TODO_COMPLETED_ARCHIVE.md`](./TODO_COMPLETED_ARCHIVE.md). There were **no git stashes** and **no extra linked worktrees**; only stale metadata could have suggested otherwise.

Those histories were merged at their common base (`3a0d598`). **`main` now contains the full stack** (projects, BOM memory, circuit blocks, evidence vault, export bundles, provider import, admin queues, etc.). If anything still looks missing locally, run migrations and scripts from [`README.md`](../README.md).

---

## How an engineer uses the site today (summary)

Typical flow (details and commands in [`README.md`](../README.md)):

1. **Catalog** — Open `/` or `/catalog`: dense search, filters (readiness, approval, CAD, lifecycle, connectors, …), exact-MPN provider import when there is no internal match.
2. **Part detail** — `/parts/[partId]`: answer-first readiness, datasheet and CAD/export state, connector buildable set, provenance, admin-aligned actions.
3. **Project memory** — `/projects`: create projects and revisions, CSV/XLSX BOM import and mapping, match rows to catalog parts, BOM diagnostics, revision compare, fleet risk on the dashboard, follow-ups, export bundle history and downloads where file-backed.
4. **Cross-cutting** — `/where-used`, `/circuit-blocks`, `/evidence`, `/admin`, `/system/health` (see implementation matrix).

Honesty rules (export gating, weak vs matched BOM lines, evidence vs approval) are documented in [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) and enforced in API/store code—not re-stated here.

---

## Delivered milestones (pointer)

Shipped vs foundation vs planned is maintained in:

- [`docs/IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) — source-of-truth matrix for code vs docs.
- [`TODO.md`](../TODO.md) — **active** backlog only.
- [`docs/TODO_COMPLETED_ARCHIVE.md`](./TODO_COMPLETED_ARCHIVE.md) — frozen FUNC1–FUNC18 narratives and related completion prose from the former root `TODO.md`.

When you **finish** work: update [`TODO.md`](../TODO.md) (remove or tighten items), update [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md), and add a **short dated bullet** under **Archive log** below only if you need narrative beyond the matrix. Large historical FUNC write-ups remain in the completed archive.

### Archive log

- **2026-05-03** — Merged engineering-memory branch into `main`; restored root `TODO.md`; marked **FUNC14** (lifecycle regression / `lifecycle_risk_changed` BOM health finding) complete in `TODO.md` to match `apps/api/src/project-memory-store.ts` and tests.
- **2026-05-04** — Closed the original engineering-memory FUNC backlog by shipping the last two items.
  - **FUNC15 (Connector Set Catalog View)** added the `/connector-sets` workspace, a typed `ConnectorSetListResponse` plus mate-pair types, the `GET /connector-sets[?connectorClass=…&q=…]` API route, and `readConnectorSetCatalogFromDatabase` in `apps/api/src/project-memory-store.ts`. Reuses `parts`, `manufacturers`, `part_readiness_summaries`, `part_approvals`, `mate_relations`, and an aggregated `project_part_usages` count — no new schema. Pg-mem fixture extended with a `mate_relations` table and a JST connector seed; tests cover groups, mate-pair counts, confidence values, the class/query filters, and the boundary copy.
  - **FUNC16 (Approval Batch Workflow From Project BOM Context)** added the project-scoped approval queue (`GET /projects/:projectId/approval-candidates`) and admin-gated bulk action (`POST /projects/:projectId/approval-batch`), backed by `readApprovalBatchCandidatesFromDatabase` and `applyApprovalBatchInDatabase`. Approval state is the only field changed; readiness summaries, assets, and part issues stay untouched. Project context is recorded in the `evidence` array (`project:<id>`, `project_key:<key>`, `triggered_by:approval_batch`, `decided_by:<actor>`). New `ApprovalBatchPanel` mounted on the project detail page with select-all/clear, action selector, optional notes, and per-part outcome summary. Tests cover the candidates query, the bulk action with `applied`/`skipped_already_approved`/`not_found` outcomes, and validation for empty `partIds`, an unsupported action, and a missing project.
  - With FUNC1 through FUNC16 now complete, the original engineering-memory roadmap has shipped. The next planning wave starts from this baseline.
- **2026-05-04 (doc pass)** — Synced `docs/IMPLEMENTATION_STATUS.md`, `README.md`, and `docs/ROADMAP.md` with the shipped surface so public docs no longer describe matching, where-used, BOM health, evidence vault, circuit blocks, connector catalog, or approval batch as “planned” only. [`TODO.md`](../TODO.md) Project Review Findings updated accordingly; next build priorities point at asset preview and compare (`AGENTS.md`).
- **2026-05-03 (README + backlog alignment)** — Corrected [`README.md`](../README.md) (basic `/compare` shipped and in nav; `/tools` still absent). Updated [`docs/IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) foundation row for compare/tools vs nav. Rewrote root [`TODO.md`](../TODO.md) into goal-aligned sections (doc truth, AGENTS build order, README-named extensions, usability).
- **2026-05-05** — Shipped **FUNC17** (inline **stored PDF** preview on part detail when `previewStatus` is ready and the file is local) and **FUNC18** ( **`/compare`** for up to four parts, `buildCompareUrl`, sidebar nav, part-detail link, `part-compare` helpers + tests). Deeper non-PDF / 3D preview and rich connector-side-by-side compare remain future work; see `IMPLEMENTATION_STATUS.md` “Foundation and Partial” rows.
- **2026-05-05 (backlog split)** — Migrated the long “done” narrative from root `TODO.md` to [`docs/TODO_COMPLETED_ARCHIVE.md`](./TODO_COMPLETED_ARCHIVE.md). Root [`TODO.md`](../TODO.md) is **active tasks only**; use the archive for FUNC history and the matrix for shipped truth.
