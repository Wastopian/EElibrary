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

Planned:
- first official metadata provider adapter
- normalized ingestion into canonical DB records
- source freshness tracking
- source conflict policy
- initial asset reference ingestion
- no runtime scraping dependency

Outcome:
- the platform begins operating on real external part data instead of only local/seed fixtures

---

## Phase 5: Datasheet Extraction and Asset Generation Engine
Build the recovery engine that turns source material into draft engineering assets.

Planned:
- datasheet extraction groundwork
- structured package/mechanical extraction
- pin-table extraction
- mechanical drawing extraction
- footprint generation pipeline
- symbol generation pipeline
- 3D draft generation pipeline
- review-required outputs by default

Outcome:
- the platform can recover missing engineering assets from source material in a controlled, reviewable way

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
