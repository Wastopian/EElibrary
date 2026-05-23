# EE Library — active backlog

**Updated:** 2026-05-23

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

### 0. Team readiness — next major direction (best tool for engineering teams)

The shipped product is a strong **single-operator** engineering memory. The next arc makes it genuinely **multi-engineer** — shared, governed, accountable, concurrent — without weakening imported ≠ approved ≠ export-ready. Full vision: `docs/ROADMAP.md` ("The Best Tool for Engineering Teams") and `docs/IMPLEMENTATION_STATUS.md` ("Team Collaboration and Governance").

**Governance foundation already shipped (do not rebuild):** request-pipeline **audit log** (`apps/api/src/audit-log.ts`, `flushRequestAuditEvent`), single-stage **project revision approval gate** (`ProjectRevisionApprovalGatePanel`), **controlled document revisions / ACL / redlines** (`apps/api/src/document-control.ts`, incl. `itar_controlled` access level + download-grant resolver), and a **vendor notebook** (`/vendors`).

Active, in leverage order:

1. **RBAC expansion** — move beyond `admin | user` (`apps/web/src/auth.ts`, `apps/web/src/middleware.ts`) to scoped roles (viewer / contributor / reviewer / approver / exporter / admin) with per-project / per-program scope. Generalize the shipped document-control ACL principal/permission model (`user|team|role` × `view|review|approve|admin`) — do not invent a second model. **Highest-leverage next piece.** Honesty: roles decide who *may* act; the shipped audit log records what they *did*.
2. **OIDC SSO** — Okta / Azure AD / Ping through the existing NextAuth shell.
3. **ECN/ECO multi-stage change workflow** — grow the shipped single-stage approval gate + document redlines into multi-stage approvals with effectivity dates, assignment, and notifications.
4. **Concurrent editing safety** — optimistic version checks + lightweight presence ("Sarah is viewing this"); no full CRDT for v1.
5. **Real ECAD/MCAD emission** — deterministic KiCad `.kicad_sym` / `.kicad_mod` / `.step` emission first, then a SolidWorks add-in, so export lands in the engineer's tool. Generated library content stays `generated`, never `official`.
6. **Live distributor pricing/stock** — read-only Octopart/Nexar + distributor data beside the shipped supply-offer summary; never live procurement authority.
7. **ITAR/EAR part classification + enforced download gating** — build on the shipped document access levels + download-grant resolver; depends on RBAC (#1).
8. **Interoperability bridges** — PLM (Aras first), ERP CSV/AVL export, Jama requirements linkage.

Cross-cutting: every new write path stays audited + provenance-bearing; every new surface keeps explicit empty / loading / error / `setup_required`.

### 1. Documentation and contract truth

These keep onboarding and boundaries honest for contributors and operators.

1. **Periodic README ↔ implementation-status pass** — After any nav or major route change, verify [`README.md`](README.md) “Current Capabilities”, “Still Planned”, and “Current Boundaries” match [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) (for example sidebar workspaces such as `/compare`, `/tools`, and `/system`).
2. **UI/UX brief vs shipped surfaces** — When adding or changing primary workspaces, update [`docs/UI_UX_BRIEF.md`](docs/UI_UX_BRIEF.md) only where it describes **live** behavior, or call out intentional deltas in the implementation matrix.

### 2. Core build priorities ([`AGENTS.md`](AGENTS.md) order)

1. **Asset preview (continued)** — _Second increment landed 2026-05-06: image formats (`png`/`jpg`/`jpeg`/`webp`) are now first-class `FileFormat` values, inline preview supports stored images in addition to stored PDFs, and worker persistence now guards `previewStatus = ready` so it is written only for embeddable, locally stored artifacts. **Third increment landed 2026-05-13: real 3D/STEP preview pipeline** — the source `assets` row is extended with four preview-artifact columns (`preview_artifact_storage_key`, `preview_artifact_format`, `preview_artifact_generated_at`, `preview_artifact_source`); the worker `three-d-preview` job converts STEP (and other source 3D formats) to viewer-only glTF/glb with deterministic per-asset storage keys; a new `/parts/:id/assets/:assetId/preview-artifact/download` route serves the derived artifact distinct from the source; the UI mounts a lazy-loaded Google `<model-viewer>` (`apps/web/src/components/ThreeDInlinePreview.tsx`) and exposes new preview states `stored_three_d_inline` and `three_d_preview_pending_artifact`. Honesty rules carried forward: the derived preview never promotes the source asset (validation/approval/export state unchanged), and STEP without a converted artifact stays `preview_pending` rather than silently falling back to a download link._ This item is now complete; future work would be net-new (e.g. lightweight inline schematic viewer for `.kicad_sch`).
2. **Deeper compare (continued)** — _Second increment landed 2026-05-06: `/compare` now includes a **per-asset trust-stage diff** section (by asset class) so generated/approved/verified states can be compared side-by-side instead of inferred from aggregate badges. **Third increment landed 2026-05-13: side-by-side CAD preview band** — `apps/web/src/components/CompareAssetPreviewBand.tsx` + `buildCompareAssetPreviewRows` in `apps/web/src/lib/part-compare.ts` render per-part inline previews for Symbol / Footprint / 3D using the shared `AssetInlinePreview` honesty matrix; the band sits directly adjacent to the per-asset trust-stage diff row so previews are never mistaken for an equivalence or approval signal._ Remaining: richer datasheet-revision diff once parser confidence is consistent.
3. **Export bundle pipeline (follow-on)** — _First increment landed 2026-05-08: bundle creation now queues `assembly_status = pending` / `not_required` and the worker `assemble-bundles` command copies each verified asset's bytes into a deterministic per-bundle prefix, persisting structured `assembly_error` JSONB telemetry (phase + failed asset path) on per-asset failures. ExportBundlePanel surfaces the assembly state and the failure phase inline. Second increment landed 2026-05-08: assembly now also writes a deterministic single-archive `bundle.tar.gz` (POSIX ustar + zero-mtime gzip) at `archive_storage_key`, the API resolves `archiveAvailability` honestly against storage, and the ExportBundlePanel offers a "Download archive (.tar.gz)" link alongside the manifest download. Third increment landed 2026-05-08: the worker daemon now drains pending bundle assemblies on a 30s tick (and once at startup) so engineers do not need to invoke the CLI after generating a bundle. **Fourth increment landed 2026-05-13: cryptographic provenance** — every assembled archive now carries a deterministic `archive_sha256` + `manifest_sha256` (computed after the gzip step), a `bundle.tar.gz.sha256` sidecar next to the archive, and an embedded `manifest.json.sha256` entry inside the archive itself. When `EE_LIBRARY_BUNDLE_SIGNING_KEY` (Ed25519 PEM) is configured the worker also writes a detached `bundle.tar.gz.sig` and persists the signer's public-key fingerprint; without a key the bundle stays `unsigned`, never silently `signed`. The new admin-gated `POST /export-bundles/:id/verify` route re-reads the archive, recomputes the hash, validates the signature against `EE_LIBRARY_BUNDLE_VERIFICATION_KEY`, and persists `signature_status = signed` / `verification_failed` (with a structured reason: `archive_hash_mismatch`, `signature_missing`, `verification_key_unavailable`, `verification_key_fingerprint_mismatch`, `signature_mismatch`, etc). The recorded `archive_sha256` is intentionally never overwritten — it is the audit anchor. ExportBundlePanel renders a per-row **Provenance** column with the signature badge, truncated archive hash, signer fingerprint, "Re-verify" action, and inline recovery copy keyed off the structured reason._ The original §2.3 follow-on is now complete; future export-bundle work would be net-new (e.g. signed download URLs with bounded TTL, retention policy, multi-signer trust chains).
4. **Tools / calculators** — _First increment landed 2026-05-23: `/tools` now exists as a dedicated engineering scratchpad workspace in the sidebar. It ships voltage-divider tolerance/load-shift, pull-up edge timing, and package power-derating calculators (`apps/web/src/lib/engineering-tools.ts`, `apps/web/src/components/EngineeringToolsWorkspace.tsx`, `apps/web/src/app/tools/page.tsx`). Each tool produces a copyable evidence-note draft and writes no project, approval, validation, or export state._ Remaining: broader BOM-adjacent/package/cable helpers once there is a persisted workflow worth supporting.
5. **Circuit-block headline (continued)** — _Increments 1-4 shipped the reuse-readiness strip, reuse history, filter-aware library, part-detail circuit-block surfacing, project instantiation picker, and block-level known risks._ **Fifth increment landed 2026-05-22: instantiation-vs-current drift signal** — reuse history now compares each generated project BOM instantiation with the block's current scoped role pattern and summarizes whether it still matches, needs review, or has drifted. **Sixth increment landed 2026-05-23: linked-part metric rollup** — circuit-block detail now shows a datasheet-style rollup of normalized metrics from linked parts, including role coverage and min/average source confidence. This stays read-only engineering memory and never changes block reuse approval, linked-part approval, asset validation, or export readiness. Remaining: a small set of deterministic seeded high-value patterns (LDO + caps, USB-C front-end, RS-485 transceiver, sealed connector set). See `docs/FUTURE_DIFFERENTIATORS.md` for items 2-7 of the broader strategic review.

6. **File-grounded asset validation jobs** — _First increment landed 2026-05-13: two file-grounded validators are shipped — **footprint geometry sanity** (parses the stored KiCad footprint and asserts pad count matches the part's pin count when known, and that pad positions fall within the package body bounding box) and **symbol pin-count cross-check** (parses the stored KiCad symbol and compares pin count to high-confidence datasheet extraction signals when present). Each run writes an `asset_validation_records` row with `provenance = 'generated'`, deterministic ids, a versioned `validator_id`, and structured `validation_notes`. Validators **never auto-promote**: `verified` records do not change `assets.validation_status`, `review_status`, or `export_status`. The daemon drains both queues on a 60s tick alongside other worker jobs (`npm run dev:worker`); explicit CLI entry points (`npm run validate-footprints`, `npm run validate-symbol-pin-counts`) remain for one-shot ops. **Second increment landed 2026-05-15: engineer-facing trust-check UI** — part detail now shows plain trust-check badges in the top files/downloads panel, each asset card surfaces a visible Trust check summary before the audit disclosure, and `/admin` has a "CAD trust checks needing attention" worklist that pulls failed/review-required validation evidence plus CAD assets marked for validation review without durable evidence yet. The operations queue count now uses that actionable worklist instead of only recent validation-record counts._ Remaining: a third validator for STEP integrity (header + topology sanity) and richer cross-reference (e.g. footprint pad pitch vs package dimensions on the part).
7. **Day-zero project overlap panel** — _First increment landed 2026-05-13: project detail now leads with a `Prior project overlap` panel (`apps/web/src/components/ProjectOverlapPanel.tsx` + `apps/api/src/project-memory-store.ts: readProjectOverlapPanelFromDatabase` + `GET /projects/:projectId/overlap`) that ranks prior projects by shared *confirmed-usage* parts and reports connector and circuit-block where-used hits inside this BOM. **Second increment landed 2026-05-15:** the panel now mounts on project detail, adds per-shared-part prior usage clues (revision, designators, quantity, status, usage row count), and previews the matching circuit-block roles with links to the block and part. The panel uses only existing project-memory tables (no new schema), is a **reuse signal**, never an approval signal, and renders explicit empty states when no confirmed usage exists or no prior projects share parts._ This item is now complete; future project-memory reuse work would be net-new (for example overlap filters or connector-specific mate reuse drill-down).

### 3. Planned extensions already named in README

1. **Subcategory search facets** — Ship only when **persisted** catalog fields and indexing justify filters; avoid dead UI facets.
2. **Provider merge, extraction, and CAD depth** — Incremental milestones: richer multi-provider merge policy, broader datasheet extraction, production-grade CAD outputs—each scoped with matrix updates, not “big bang” claims.

3. **Distributor offer ingestion** - _Foundation landed 2026-05-11 and was tightened 2026-05-13: `supply_offerings` / `price_breaks`, worker persistence, JLC/LCSC, Octopart/Nexar, and local-catalog snapshot normalization, supplier identity, retired-offer policy, read-only part-detail panel, CLI refresh, and daemon stale-refresh scheduling now exist for source-linked commercial snapshots. **Merge-summary increment landed 2026-05-23:** `PartSupplyOfferSummary` now reports current/stale offer split, provider count, named supplier count, per-provider summaries, and best current in-stock price tier so part detail can compare source snapshots without presenting procurement approval or live stock._ Remaining: broader distributor/provider coverage and future procurement approval workflows.

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
