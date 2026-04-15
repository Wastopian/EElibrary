# Roadmap

This roadmap is organized around the product capabilities that make EE Library valuable, not just around generic infrastructure milestones.

The core direction of the platform is:

- connector intelligence
- engineering asset truth
- missing-CAD recovery
- buildable engineering workflows
- strict export honesty

---

## Phase 0: Platform Foundation
Establish the base repo and runtime structure for a serious engineering platform.

Delivered:
- monorepo setup
- web / api / worker skeleton
- Postgres / Redis / object storage local stack
- shared domain types
- reusable UI shell

Outcome:
- a clean platform foundation with provider-neutral boundaries

---

## Phase 1: Canonical Catalog Foundation
Define the canonical engineering catalog and make the first end-to-end UI useful.

Delivered:
- part, manufacturer, and package schema
- seeded sample data
- search UI
- component detail page shell

Outcome:
- a usable engineering catalog prototype backed by a normalized model

---

## Phase 2: Connector Intelligence and Trust Hardening
Turn the platform from a simple catalog into a compatibility-aware engineering tool.

Delivered:
- connector family support
- mate relationships
- accessory requirements
- cable compatibility
- buildable mating set logic
- DB-backed connector intelligence persistence
- strict DB truth behavior
- no silent seed fallback masking DB/schema failures
- more explicit UI honesty around trust and readiness

Outcome:
- the platform can now model what actually mates together and what is required to build with a connector

---

## Phase 3A: Engineering Asset Pipeline Foundation
Make engineering assets first-class and resolve what is truly available.

Delivered:
- grouped engineering assets
- best-available asset resolution
- provenance-aware asset ranking
- bundle readiness summaries
- precise asset/export wording
- mixed asset-state seed coverage
- DB-backed asset lookup support

Outcome:
- the platform can now explain which files exist, which are best, and whether a part is truly bundle-ready

---

## Phase 3B: Missing-CAD Recovery Workflow
Turn missing asset actions into real typed workflows instead of vague promises.

Delivered:
- source-readiness evaluation
- generation request model
- generation workflow states
- DB-backed generation request persistence
- UI for requestability, readiness reasons, and workflow state
- honest unavailable/requestable/review-required cases

Outcome:
- the platform can now show when missing CAD can be recovered and track the request path honestly

---

## Phase 4A: Review and Approval Workflow
Add the trust gate that separates generated/sourced assets from export-trusted assets.

Delivered:
- review queue
- approve / reject / changes requested workflow
- explicit review records
- reviewed vs verified_for_export separation
- review-aware export gating
- review state UI and local/dev review actions

Outcome:
- generated or newly sourced assets become trustworthy only through explicit review

---

## Phase 4B: First Real Provider Integration
Connect the platform to real external sources through one production-style ingestion path.

Delivered:
- first structured metadata provider adapter through the worker layer
- lookup/import by MPN or LCSC id for the initial JLCPCB/LCSC metadata slice
- normalized ingestion into canonical manufacturer, part, package, metric, source, datasheet, and asset records
- initial reference-only datasheet asset ingestion
- no runtime scraping dependency

Outcome:
- the platform begins operating on real external part data instead of only local/seed fixtures

Still planned:
- multi-provider ingestion
- source conflict policy
- broader source freshness dashboards

---

## Phase 4C: Provider Ingestion Hardening
Make the first real provider import path more reliable before adding more sources.

Delivered:
- repeat imports upsert canonical manufacturer, package, part, and source rows
- source last seen and last imported metadata
- import status and error diagnostics on source records
- worker command for recent and failed import diagnostics
- hardened JLCPCB/LCSC manufacturer, package, and category normalization
- repeat-import and migration smoke coverage for source freshness fields

Outcome:
- the first provider slice is safer to run repeatedly and easier to diagnose without introducing multi-provider conflict resolution yet

Still planned:
- cross-provider conflict policy
- provider reconciliation UI
- bulk ingestion scheduling

---

## Phase 5A: Datasheet Extraction Groundwork
Make missing-CAD recovery depend on structured extraction evidence instead of coarse source flags.

Delivered:
- source extraction signal model for package/mechanical dimensions, pin tables, and mechanical drawings
- DB-backed source_extraction_signals persistence and API projection
- worker mapping of extraction signals for local fixture data and the first JLCPCB/LCSC provider slice
- source-readiness evaluation based on extracted evidence and confidence
- UI wording for extraction support, missing signals, and review-required source evidence

Outcome:
- generation requestability is now grounded in explicit source evidence without claiming OCR, full PDF parsing, or generated CAD success

Still planned:
- actual extraction jobs
- generated CAD draft pipeline
- review preparation for generated outputs

---

## Phase 5B: Datasheet Extraction and Asset Generation Engine
Build the recovery engine that turns source material into draft engineering assets.

Delivered:
- worker-side draft footprint generation from structured package/mechanical extraction signals
- worker-side draft symbol generation from structured pin-table extraction signals
- deterministic draft asset records linked to generation workflows
- generated outputs marked generated, review_required, needs_review, and not_exportable by default
- API/detail and UI coverage for generated draft truth labels

Outcome:
- the platform can recover missing engineering assets from source material in a controlled, reviewable way

Still planned:
- extraction job execution beyond provider-structured source signals
- 3D draft generation pipeline
- richer draft artifact storage and preview generation

---

## Phase 5C: Review-Assisted Promotion Workflow
Separate generated, approved, and verified-for-export states with explicit promotion.

Delivered:
- approval, rejection, and changes-requested review transitions for generated drafts
- approved drafts remain non-exportable until a separate promotion action succeeds
- explicit asset promotion API action for eligible approved file-backed CAD assets
- UI wording for generated draft, approved draft, rejected draft, changes requested, and verified for export
- export gating tests before and after explicit promotion

Outcome:
- generated draft assets can move toward trusted export state without collapsing review and export verification

Still planned:
- production validation jobs beyond manually recorded evidence
- richer review queues and permissions

---

## Phase 5D: Validation and Promotion Audit Backbone
Make verified-for-export promotion depend on durable evidence and leave an audit trail.

Delivered:
- asset validation evidence records
- export-promotion audit records for promoted and denied attempts
- promotion rules that require qualifying validation evidence
- API/detail exposure of validation evidence, promotion history, and blocker reasons
- UI wording for validation evidence and promotion audit state

Outcome:
- verified_for_export transitions are now evidence-backed and auditable instead of only an asset-state mutation

---

## Phase 6: Engineering Decision and Workflow Tools
Expand the platform from part intelligence into broader engineering workflow support.

Planned:
- side-by-side compare
- alternate part ranking
- package/revision risk warnings
- BOM ingestion
- project-aware recommendations
- approved-parts vault
- companion-part guidance improvements
- engineering calculators
- reference circuit patterns

Outcome:
- the platform becomes a broader engineering workspace rather than just a part intelligence tool

---

## Long-term direction
The long-term goal is not to become another generic component search site.

The long-term goal is to become the engineering platform that helps users answer:

- What is the right part?
- What mates with it?
- What else do I need?
- Which assets are trustworthy?
- What can I export now?
- What can I recover if the files do not exist?
