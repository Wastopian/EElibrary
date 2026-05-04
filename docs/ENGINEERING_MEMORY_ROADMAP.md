# Engineering memory and roadmap archive

This document captures **what is done**, **how the merged product is operated**, and **where to look next**. It intentionally avoids duplicating tables that already live in [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md).

- **Active FUNC backlog and completion notes:** [`TODO.md`](../TODO.md) in the repo root.
- **Dated worktree / integration notes:** [`REGISTER.md`](../REGISTER.md).
- **Agent / repo rules:** [`AGENTS.md`](../AGENTS.md).

---

## Repo integration note (2026-05-03)

`main` was previously the slimmer **phase-2-foundation** line (catalog search/detail + worker ingest) after PR #1. The full **engineering-memory** implementation lived on branch `cursor/2026-05-03-7o4u-787f9` (tip `d559ca4`), including the original FUNC-numbered [`TODO.md`](../TODO.md). There were **no git stashes** and **no extra linked worktrees**; only stale metadata could have suggested otherwise.

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
- [`TODO.md`](../TODO.md) — FUNC1–FUNC14 completion narratives; remaining **P2-FUNC15 / FUNC16** and any doc-sync items.

When you finish a FUNC item, update **`TODO.md`** first, then add a **short dated bullet** under this section if you need a narrative archive beyond the FUNC completion notes.

### Archive log

- **2026-05-03** — Merged engineering-memory branch into `main`; restored root `TODO.md`; marked **FUNC14** (lifecycle regression / `lifecycle_risk_changed` BOM health finding) complete in `TODO.md` to match `apps/api/src/project-memory-store.ts` and tests.
