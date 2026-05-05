# EE Library — active backlog

**Updated:** 2026-05-03

## Where things live

| Need | Document |
|------|----------|
| **Open tasks only (this file)** | [`TODO.md`](TODO.md) |
| **Completed FUNC / P0-MEM narratives, execution plans, regression lists** | [`docs/TODO_COMPLETED_ARCHIVE.md`](docs/TODO_COMPLETED_ARCHIVE.md) |
| **Operating narrative + milestone archive log** | [`docs/ENGINEERING_MEMORY_ROADMAP.md`](docs/ENGINEERING_MEMORY_ROADMAP.md) |
| **Shipped vs planned (live contract)** | [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) |
| **Repo rules & priority order** | [`AGENTS.md`](AGENTS.md) |
| **Product intent & UX thesis** | [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md), [`docs/UI_UX_BRIEF.md`](docs/UI_UX_BRIEF.md) |
| **Worktree / integration notes** | [`REGISTER.md`](REGISTER.md) |

---

## Goals (README alignment)

[`README.md`](README.md) promises a **private engineering memory**: search → inspect → trust → export, plus project/BOM memory, evidence, connector buildability, reuse, and honest boundaries. Usability is **desktop-first**, dense, and must never present uncertain metadata as certain.

Use this list to close gaps between **documented intent**, **`IMPLEMENTATION_STATUS.md`**, and **actual operator experience**—in that order where docs drift.

---

## Active work

### 1. Documentation and contract truth

These keep onboarding and boundaries honest for contributors and operators.

1. **Periodic README ↔ implementation-status pass** — After any nav or major route change, verify [`README.md`](README.md) “Current Capabilities”, “Still Planned”, and “Current Boundaries” match [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) (e.g. `/compare` in nav vs `/tools` absent).
2. **UI/UX brief vs shipped surfaces** — When adding or changing primary workspaces, update [`docs/UI_UX_BRIEF.md`](docs/UI_UX_BRIEF.md) only where it describes **live** behavior, or call out intentional deltas in the implementation matrix.

### 2. Core build priorities ([`AGENTS.md`](AGENTS.md) order)

1. **Export path hardening** — Bundle generation and download flows: deterministic IDs, storage/auth failures surfaced end-to-end (API ↔ worker ↔ UI), no silent missing downloads when the matrix claims file-backed exports.
2. **Validation and trust surfacing** — Make validation evidence, trust signals, and promotion/export boundaries **scannable** on part detail, admin queues, and project BOM context without blurring “imported”, “reviewed”, “approved”, and “verified-for-export”.
3. **Asset preview (incremental)** — Honest **3D/STEP** or **image** preview only when a real preview artifact or pipeline exists; extend FUNC17 PDF behavior with explicit non-preview fallbacks for everything else.
4. **Deeper compare** — Extend `/compare` with connector- and CAD-depth rows when shared types and persisted fields support them; keep basic compare honest when data is missing.
5. **Tools / calculators** — Introduce a dedicated `/tools` (or equivalent) workspace after compare and export stories stay trustworthy; first tools should reinforce engineering memory, not toy demos.

### 3. Planned extensions already named in README

1. **Subcategory search facets** — Ship only when **persisted** catalog fields and indexing justify filters; avoid dead UI facets.
2. **Provider merge, extraction, and CAD depth** — Incremental milestones: richer multi-provider merge policy, broader datasheet extraction, production-grade CAD outputs—each scoped with matrix updates, not “big bang” claims.

### 4. Usability and workstation UX

1. **System health discoverability** — `/system/health` and worker/async status are easy to miss (banner-only today). Add a deliberate affordance: e.g. sidebar “System” link, footer strip, or documented entry from catalog—without turning the shell into a noisy dashboard.
2. **Empty and recovery states** — Pass across **catalog**, **projects**, **compare** (no `parts` query), **where-used**, and **evidence**: each should match [`README.md`](README.md) first loops (clear next action, no fake data). Include API-down / `setup_required` paths.
3. **Cross-workspace wayfinding** — Strengthen obvious paths from **part detail → compare → project BOM** (links, copy, and empty hints) so README’s “First Workbench Loop” and “Project memory loop” are achievable without hunting URLs.

### Hygiene

- When you **complete** an item: tighten or remove it here; update [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md); add a short **Archive log** line in [`docs/ENGINEERING_MEMORY_ROADMAP.md`](docs/ENGINEERING_MEMORY_ROADMAP.md) only if the matrix is not enough.
- Do **not** paste long completion essays here — use the completed archive + implementation status.

---

## Definition of done

Per [`AGENTS.md`](AGENTS.md): types clean; loading / error / empty states; provenance not lost; UI coherent; the change strengthens **search → inspect → trust → export**.
