# Roadmap

This document is forward-looking. For what is already shipped in the repo, use `docs/IMPLEMENTATION_STATUS.md`.

EE Library is being built as a **private engineering memory system for hardware teams**, not a public catalog replacement. Provider and catalog data are input; the long-term product value is the internal record of parts, BOMs, connectors, reusable circuit blocks, evidence, approvals, and risk over time.

The current implemented foundation is **part readiness** plus a full **project/BOM engineering-memory** track (matching, usage, where-used, BOM health, evidence, circuit blocks, export bundles, connector catalog, approval batch). See `docs/IMPLEMENTATION_STATUS.md` for the live matrix.

```txt
search -> import exact MPN when needed -> inspect -> trust -> export
project -> BOM intake -> match -> usage -> health / where-used / evidence / reuse -> export when verified
```

The next major direction is **workbench depth** without losing honesty:

```txt
asset preview and trust -> compare and selection tools -> calculators and BOM-adjacent utilities
```

---

## Roadmap Priority (next)

After the FUNC1–FUNC18 wave (history: `docs/TODO_COMPLETED_ARCHIVE.md`), near-term product priority follows `AGENTS.md` and root `TODO.md`:

1. **Asset registry and preview (incremental)** — FUNC17 ships **stored PDF** iframe preview when preview state + storage align; extend next with non-PDF honesty rules (STEP/thumbnails only when real previews exist).
2. **Export adapters** — keep bundle generation deterministic and visible end-to-end.
3. **Validation and trust scoring** — surface evidence without conflating approval and export.
4. **Compare (incremental)** — FUNC18 ships `/compare` for metrics/readiness/bundle gate; add connector/CAD depth when data contracts are ready.
5. **BOM tools and calculators** — first `/tools` scratchpads are shipped; broaden only where the output can flow back into project evidence or review.

`docs/IMPLEMENTATION_STATUS.md` is the source of truth for what is already shipped; this section is forward-looking only.

---

## Delivered Foundation

These phases created the part-readiness base that project memory will build on.

### Platform and Canonical Catalog

Delivered:

- monorepo setup
- web / api / worker separation
- local Postgres-backed development stack
- shared domain types
- canonical part, manufacturer, package, metric, source, and asset records
- MPN-driven search and detail surfaces
- deterministic local fixture import path

Outcome:

- a provider-neutral engineering catalog foundation

### Connector Intelligence

Delivered:

- connector family support
- mate relationships
- accessory requirements
- cable compatibility
- buildable mating set logic
- DB-backed connector intelligence persistence
- confidence warnings and family-confusion handling

Outcome:

- the platform can model what actually mates together and what is required to build with a connector

### Engineering Asset Truth

Delivered:

- grouped engineering assets
- best-available asset resolution
- provenance-aware asset ranking
- bundle readiness summaries
- precise asset/export wording
- review-aware export gating
- validation evidence and promotion audit backbone

Outcome:

- the platform can explain which files exist, which are trusted, and whether a part is truly ready for export

### Provider Import and Source Evidence

Delivered:

- first structured metadata provider adapter through the worker layer
- JLCPCB/LCSC metadata import path
- local-catalog deterministic development provider
- normalized ingestion into canonical manufacturer, part, package, metric, source, datasheet, and asset records
- source last-seen/import diagnostics
- structured extraction signals for source-backed CAD recovery decisions

Outcome:

- public provider data can enter the system as traceable input without becoming unquestioned internal truth

### Review, Approval, and Operational Queues

Delivered:

- asset review states
- explicit verified-for-export promotion
- part-level readiness projection
- whole-part approval and issue projections
- admin surfaces for review, promotion, import, validation, and issue-driven operations queues
- source conflict surfacing and preferred-source or mixed-source reconciliation actions

Outcome:

- imported, reviewed, approved, validated, and export-ready states remain separate

---

## Next Major Direction: Project Memory Foundation

This is the next product expansion. It should be implemented without weakening the shipped part-readiness truth boundaries.

### Phase PM1: Project Records

Foundation shipped:

- project entity
- project metadata such as name, owner, status, and notes
- project dashboard and detail shell
- project creation with an initial draft revision

Still planned:

- project editing
- richer project-level source file history
- links from projects to BOM imports and part usage records

Outcome:

- EE Library can represent a hardware project as a durable internal engineering object

### Phase PM2: BOM Upload, Import, and Column Mapping

Foundation shipped:

- CSV BOM upload
- column mapping for MPN, manufacturer, quantity, designator, description, notes, and supplier references
- preservation of original row data

Still planned:

- XLSX or broader structured BOM upload
- import diagnostics for unmapped, ambiguous, or weak rows
- exact-MPN intake follow-up for missing parts

Outcome:

- BOMs can enter the system without losing original project context

### Phase PM3: Part-to-Project Usage History

Planned:

- usage records that connect parts to project BOM rows
- designator and quantity history
- project usage summary on part detail pages
- project usage filters in search
- usage provenance and import source tracking

Outcome:

- engineers can see whether a part is new to the organization or already used in prior designs

### Phase PM4: Where-Used Search

Planned:

- where-used lookup for parts
- where-used lookup for connector sets
- where-used lookup for trusted assets
- where-used lookup for circuit blocks
- filters by project, status, lifecycle, approval, and risk

Outcome:

- internal reuse becomes searchable instead of tribal memory

### Phase PM5: BOM Health Dashboard

Planned:

- BOM-level readiness summary
- approval gaps
- lifecycle and sourcing risk
- missing evidence
- missing verified CAD/export assets
- connector buildability gaps
- duplicate and source-conflict warnings
- follow-up issue generation

Outcome:

- hardware leads can review project risk across a whole BOM instead of opening every part one by one

### Phase PM6: Evidence Attachments

Planned:

- project and part evidence attachments
- validation reports
- review notes
- source snapshots
- file hash and storage metadata
- attachment provenance and review state

Outcome:

- engineering decisions become auditable over time

### Phase PM7: Circuit Block Records

Shipped foundation:

- reusable circuit block entity
- associated parts and known-good connector sets
- design notes and constraints
- validation evidence
- project usage history
- risk and allowed reuse scope
- linked-part metric rollups with source confidence
- instantiation history with current-pattern drift

Outcome:

- proven circuits become structured engineering knowledge, not loose notes

---

## Later Direction

### Multi-Provider Trust and Reconciliation

Planned:

- additional provider adapters
- richer source conflict policies
- provider reconciliation UI
- source freshness dashboards
- scheduled sync and bulk ingestion

Outcome:

- provider coverage grows without losing provenance or internal trust boundaries

### Asset Generation and Validation Depth

Planned:

- extraction jobs beyond provider-structured source signals
- richer generated CAD draft pipeline
- 3D draft generation
- preview generation
- production validation jobs
- review queue and permission hardening

Outcome:

- missing assets can be recovered with reviewable evidence rather than vague automation claims

### Engineering Decision Tools

Shipped and planned:

- side-by-side compare is shipped for parts, CAD status, trust-stage rows, CAD previews, connector context, and export readiness
- first engineering calculators are shipped in `/tools`: divider tolerance/load shift, pull-up edge timing, and package power derating with evidence-note drafts
- alternate ranking
- package and revision risk warnings
- lifecycle and sourcing overlays
- companion-part guidance improvements
- package and footprint validation helpers
- compatibility explanation tools

Outcome:

- EE Library grows into a broader engineering workspace while keeping internal truth as the product center

---

## Long-Term Standard

The long-term goal is not to become another generic component search site.

The long-term goal is to help users answer:

- What is the right part?
- Is the identity trustworthy?
- Where has it been used before?
- What mates with it?
- What else do I need to build with it?
- Which assets and evidence are trustworthy?
- What risks or blockers remain?
- Is this part approved for design use?
- Is it verified for export?
- Which circuit blocks or known-good sets can be safely reused?
- What does this BOM need before the project can move forward?

That is the standard.
