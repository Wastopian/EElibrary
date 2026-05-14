# EE Library — active backlog

**Updated:** 2026-05-11

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

Primary operator lens: an older or highly experienced engineer will use EE Library as the durable memory for every part used across projects. Review, import, and install/download flows must be obvious, readable, low-surprise, and recoverable without asking the operator to guess what data is real.

Non-software-savvy operator lens: normal product workflows must not assume comfort with terminals, query strings, internal ids, or backend jargon. Use plain labels, guided actions, clear disabled states, and copyable recovery steps only where setup work is truly outside the app.

Use this list to close gaps between **documented intent**, **`IMPLEMENTATION_STATUS.md`**, and **actual operator experience**—in that order where docs drift.

---

## Active work

### 1. Documentation and contract truth

These keep onboarding and boundaries honest for contributors and operators.

1. **Periodic README ↔ implementation-status pass** — After any nav or major route change, verify [`README.md`](README.md) “Current Capabilities”, “Still Planned”, and “Current Boundaries” match [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) (e.g. `/compare` in nav vs `/tools` absent).
2. **UI/UX brief vs shipped surfaces** — When adding or changing primary workspaces, update [`docs/UI_UX_BRIEF.md`](docs/UI_UX_BRIEF.md) only where it describes **live** behavior, or call out intentional deltas in the implementation matrix.

### 2. Core build priorities ([`AGENTS.md`](AGENTS.md) order)

1. **Asset preview (continued)** — _Second increment landed 2026-05-06: image formats (`png`/`jpg`/`jpeg`/`webp`) are now first-class `FileFormat` values, inline preview supports stored images in addition to stored PDFs, and worker persistence now guards `previewStatus = ready` so it is written only for embeddable, locally stored artifacts._ Remaining: real **3D/STEP** preview artifact + viewer pipeline.
2. **Deeper compare (continued)** — _Second increment landed 2026-05-06: `/compare` now includes a **per-asset trust-stage diff** section (by asset class) so generated/approved/verified states can be compared side-by-side instead of inferred from aggregate badges._ Remaining: side-by-side CAD preview (gated on asset-preview pipeline) and richer datasheet-revision diff once parser confidence is consistent.
3. **Export bundle pipeline (follow-on)** — _First increment landed 2026-05-08: bundle creation now queues `assembly_status = pending` / `not_required` and the worker `assemble-bundles` command copies each verified asset's bytes into a deterministic per-bundle prefix, persisting structured `assembly_error` JSONB telemetry (phase + failed asset path) on per-asset failures. ExportBundlePanel surfaces the assembly state and the failure phase inline. Second increment landed 2026-05-08: assembly now also writes a deterministic single-archive `bundle.tar.gz` (POSIX ustar + zero-mtime gzip) at `archive_storage_key`, the API resolves `archiveAvailability` honestly against storage, and the ExportBundlePanel offers a "Download archive (.tar.gz)" link alongside the manifest download. Third increment landed 2026-05-08: the worker daemon now drains pending bundle assemblies on a 30s tick (and once at startup) so engineers do not need to invoke the CLI after generating a bundle._ The original §2.3 follow-on is now complete; future export-bundle work would be net-new (e.g. signed download URLs, retention policy).
4. **Tools / calculators** — Introduce a dedicated `/tools` (or equivalent) workspace after compare and export stories stay trustworthy; first tools should reinforce engineering memory, not toy demos.
5. **Circuit-block headline (continued)** — _First increment landed 2026-05-12 (reuse-readiness strip + reuse history). Second increment landed 2026-05-12: library is now **scan-first and filter-aware** — server-side filters (`q`, `type`, `status`, `owner`, `readiness`) with response-echoed applied filters, a filter bar on `/circuit-blocks`, a per-row **Reuse** column sharing logic with the detail strip via the new `packages/shared/src/circuit-block-readiness.ts`, a **Next workspaces** cross-nav panel on the detail page, and a filter + reuse-verdict selector on the project-detail `CircuitBlockInstantiationPanel` so engineers do not accidentally instantiate blocked blocks. **Third increment landed 2026-05-12: bidirectional surfacing on part detail** — `PartWhereUsedResponse` now carries `circuitBlockDependencies` (per-block grouping with the matching role rows and the shared reuse-readiness headline), and the part-detail `PartWhereUsedPanel` renders a dedicated `Circuit blocks` section beside `Projects` so engineers viewing a part can see every reusable block depending on it without re-opening the global where-used search. **Fourth increment landed 2026-05-13: block-level known risks & limitations** — new `circuit_block_known_risks` table (migration 038) with explicit provenance (`recorded_by`, `recorded_at`, `resolved_at`, `resolved_by`, `resolution_notes`, optional `evidence_url`) and an enforced four-level severity (`info` / `limitation` / `caution` / `blocking`). `CircuitBlockSummary` now carries `activeKnownRiskCount` and `activeBlockingRiskCount`; the shared reuse-readiness helper blocks the **reusable** stage with `unresolved_blocking_risk` whenever an unresolved blocking risk exists (deprecated still wins), and surfaces open non-blocking risks in the detail copy without gating reuse. New `POST /circuit-blocks/:id/known-risks` (create) and `POST /circuit-blocks/:id/known-risks/:riskId/resolve` (resolve, preserving the row) admin routes, a new `CircuitBlockKnownRisksPanel` on the detail page (active + resolved lists, severity badges, record + resolve forms), and a new **Risks** column + library snapshot tile so the library scans for `N active · M blocking` at a glance. Reuse readiness still never implies part approval or export readiness._ Remaining: a datasheet-style rollup of linked-part metrics with confidence (read-only summary, not a new approval gate), a small set of deterministic seeded high-value patterns (LDO + caps, USB-C front-end, RS-485 transceiver, sealed connector set), and an instantiation-vs-current diff so engineers can see when a project that instantiated this block has drifted from the current pattern. See `docs/FUTURE_DIFFERENTIATORS.md` for items 2–7 of the broader strategic review.

### 3. Planned extensions already named in README

1. **Subcategory search facets** — Ship only when **persisted** catalog fields and indexing justify filters; avoid dead UI facets.
2. **Provider merge, extraction, and CAD depth** — Incremental milestones: richer multi-provider merge policy, broader datasheet extraction, production-grade CAD outputs—each scoped with matrix updates, not “big bang” claims.

3. **Distributor offer ingestion** - _Foundation landed 2026-05-11 and was tightened 2026-05-13: `supply_offerings` / `price_breaks`, worker persistence, JLC/LCSC, Octopart/Nexar, and local-catalog snapshot normalization, supplier identity, retired-offer policy, read-only part-detail panel, CLI refresh, and daemon stale-refresh scheduling now exist for source-linked commercial snapshots._ Remaining: broader distributor/provider coverage, richer multi-provider merge policy, and future procurement approval workflows.

### 4. Usability and workstation UX

1. **Compare selection ergonomics** — _Completed 2026-05-06: `/compare` now has an in-page selection tray (add/remove part ids), and catalog rows expose direct compare actions so engineers no longer need manual query-string editing for normal compare flow._
2. **Project usage readability** — _Completed 2026-05-06: project “Confirmed usage” rows now show MPN/manufacturer first, with internal part id preserved as secondary metadata._
3. **Evidence attach target picker** — _Completed 2026-05-07: `/evidence` attach flow now has a searchable persisted-target picker seeded from current vault targets, projects, catalog parts/assets, project BOM imports/lines/usages, BOM health findings, and circuit block roles, while preserving explicit ID override._
4. **Where-used query guidance** — _Completed 2026-05-07: `/where-used` now shows target-specific query examples and no-result recovery hints for part id vs MPN, circuit block id vs block key, connector-set searches, and asset bundle-manifest searches._
5. **Cross-workspace wayfinding** — _Completed 2026-05-07: part detail and project detail now include "Next workspaces" action panels that link operators into compare, where-used, connector sets/circuit blocks, evidence, and export/install flows without manual URL editing._
6. **Admin queue scope controls** — _Completed 2026-05-07: admin operations queues now include plain row search plus a work-state scope filter (all, needs attention, blocked, ready/informational) over backend-backed review, promotion, issue, import, and validation rows._
7. **System health discoverability** — _Completed 2026-05-07: the sidebar now exposes a deliberate `/system` workspace with API, database, storage, worker, queue counts, raw health endpoint access, and recovery links without turning the shell into a noisy dashboard._
8. **Empty and recovery states** — _Completed 2026-05-07: catalog/projects already preserve setup and empty states; compare, where-used, and evidence now use plain recovery actions (Catalog, Projects, Attach evidence, System/Admin checks) instead of query-string or fake-data assumptions, while API-down and `setup_required` paths stay explicit._

### Hygiene

- When you **complete** an item: tighten or remove it here; update [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md); add a short **Archive log** line in [`docs/ENGINEERING_MEMORY_ROADMAP.md`](docs/ENGINEERING_MEMORY_ROADMAP.md) only if the matrix is not enough.
- Do **not** paste long completion essays here — use the completed archive + implementation status.

---

## Definition of done

Per [`AGENTS.md`](AGENTS.md): types clean; loading / error / empty states; provenance not lost; UI coherent; the change strengthens **search → inspect → trust → export**.
