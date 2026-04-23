# Roadmap

This document is forward-looking. For what is already shipped in the repo, use `docs/IMPLEMENTATION_STATUS.md`.

This roadmap is organized around the product capabilities that make EE Library valuable as an **engineering part onboarding and readiness platform**, not just as a catalog or CAD file utility.

The core direction of the platform is:

- part onboarding and readiness
- connector intelligence
- engineering asset truth
- missing-CAD recovery
- approval and trust workflows
- strict export honesty

The long-term goal is to help users move from a raw manufacturer part number to an **engineer-ready internal part record** with clear trust, compatibility, CAD readiness, and approval state.

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

Note:
- this phase established core catalog truth, but not full engineer-readiness workflows yet

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

## Phase 3A: Engineering Asset Truth Foundation
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
- honest unavailable, requestable, and review-required cases

Outcome:
- the platform can now show when missing CAD can be recovered and track the request path honestly

---

## Phase 4A: Review and Approval Workflow for Assets
Add the trust gate that separates generated or sourced assets from export-trusted assets.

Delivered:
- review queue
- approve / reject / changes requested workflow
- explicit review records
- reviewed vs verified_for_export separation
- review-aware export gating
- review state UI and local/dev review actions

Outcome:
- generated or newly sourced assets become trustworthy only through explicit review

Note:
- this phase establishes asset-level trust, but not yet full part-level approval for engineering use

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
- the platform begins operating on real external part data instead of only local or seed fixtures

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

## Phase 5A: Structured Extraction Groundwork
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

## Phase 5B: Draft Asset Generation Engine
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

## Phase 6A: Part Readiness Model and User Experience
Shift the product from “catalog plus assets” into a real engineer-readiness workflow.

Planned:
- part-level readiness summary model
- identity status resolution such as verified, ambiguous, conflicted, or unverified
- overall readiness state such as engineer_ready, needs_review, or blocked
- explicit blocker summaries
- readiness-oriented homepage or quick intake flow
- readiness-oriented part detail layout
- readiness filters in search and browse workflows

Outcome:
- the product answers “Can I use this part yet?” instead of only “What data do we have?”

---

## Phase 6B: Part Approval and Operational Issue Queue
Add part-level approval and issue-driven triage for real engineering onboarding.

Planned:
- part approval states such as draft, pending_review, approved_for_design, restricted, and rejected
- approval records with reviewer, rationale, and scope of use
- part issue model for unresolved readiness blockers
- admin queue for:
  - failed intake
  - low-confidence identity
  - missing mates
  - missing accessories
  - missing footprint
  - missing symbol
  - missing 3D model
  - conflicting source data
  - duplicate candidates
  - pending approval
- lifecycle risk / obsolete parts
- issue assignment, review, and resolution flow

Now shipped:
- backend-derived duplicate-candidate issue projection
- admin duplicate queue visibility when DB-backed evidence exists
- operator issue workflow state with assignee, resolution notes, resolve, reopen, and in-review actions

Outcome:
- the platform becomes operationally useful for part librarians, admins, and engineering review workflows

---

## Phase 6C: Connector Intelligence Expansion
Deepen the most differentiated area of the product.

Now shipped:
- structured connector warning model for buildable mating sets
- alternate-mate visibility in the connector contract and detail UI
- connector confidence breakdown instead of a single opaque score
- evidence-weighted mate and accessory confidence that distinguishes provider-backed, datasheet-backed, reviewed, inferred, and rejected mappings
- note-derived cable assumptions for gauge, shielding, termination style, and usage context
- DB-backed cable constraints persisted on cable compatibility rows
- DB-backed connector-family conflict persistence derived from stored best-mate and alternate-mate evidence
- persisted family-confusion warnings surfaced through API, detail, and admin workflows
- clearer connector-specific warnings in readiness and detail views

Planned:
- broader near-match and family-confusion evidence from more providers
- richer accessory dependency modeling
- improved buildable mating set reasoning

Outcome:
- the platform becomes more useful for the messy real-world connector decisions that common part sites do not solve well

---

## Phase 7: Internal Engineering Knowledge and Reuse
Capture internal truth that public sites cannot provide.

Planned:
- part notes
- internal usage history
- project usage context
- approved-parts vault
- project-aware part recommendations
- richer provenance and trust overlays from internal review
- institutional memory for part corrections, cautions, and usage notes

Outcome:
- the platform compounds value over time instead of only reformatting public data

---

## Phase 8: Engineering Decision and Workflow Tools
Expand the platform from part readiness into broader engineering workflow support.

Planned:
- side-by-side compare
- alternate part ranking
- package and revision risk warnings
- lifecycle and sourcing risk overlays
- BOM ingestion
- companion-part guidance improvements
- engineering calculators
- reference circuit patterns
- package and footprint validation helpers
- compatibility explanation tools

Outcome:
- the platform becomes a broader engineering workspace rather than just a part readiness system

---

## Phase 9: Ingestion Scale and Automation
Increase ingestion breadth without losing truth and review boundaries.

Planned:
- multi-provider ingestion
- provider reconciliation UI
- richer source conflict resolution
- broader source freshness dashboards
- freshness tracking and sync scheduling
- extraction job execution pipeline
- automated asset generation pipeline with review gates
- bulk ingestion scheduling

Now shipped:
- operator source reconciliation records with preferred-source selection or mixed-source acceptance
- source-conflict admin actions that refresh part projections from persisted reconciliation state

Outcome:
- the platform scales provider coverage while preserving provenance, trust, and readiness logic

---

## Long-term direction

The long-term goal is not to become another generic component search site.

The long-term goal is to become the engineering platform that helps users answer:

- What is the right part?
- Is the identity trustworthy?
- What mates with it?
- What else do I need to build with it?
- Which assets are trustworthy?
- What risks or blockers remain?
- Is this part approved for design use?
- What can I export now?
- What can I recover if the files do not exist?

That is the standard.
