# Product Requirements

This document captures target product intent. For shipped-vs-planned status, use `docs/IMPLEMENTATION_STATUS.md`.

## Product Thesis

EE Library is a **private engineering memory system for hardware teams**.

It preserves internal engineering truth around parts, BOMs, connectors, reusable circuit blocks, evidence, approvals, and risk over time. Public provider and catalog data are useful input, but they are not the product itself. The product is the team-owned record of what was used, why it was trusted, what evidence supported it, what risks remained, and where that decision should be reused.

The first implemented slice is a part readiness loop:

```txt
search -> import exact MPN when needed -> inspect -> trust -> export
```

The broader target loop is:

```txt
project/BOM intake -> find prior use -> assess readiness and risk -> reuse known-good evidence -> approve/export or create follow-up work
```

EE Library should feel like an **engineering workspace**, not a distributor clone, passive footprint download site, or pretty wrapper around provider imports.

---

## Core Product Pillars

### 1. Project/BOM Import and Where-Used History

The product must become project-aware. A hardware team should be able to import a BOM, preserve original row context, associate parts with projects, and later answer where a part, connector set, asset, or circuit block has been used before.

Target capabilities:

- project records
- CSV BOM upload/import foundation
- BOM column mapping foundation
- original row, designator, quantity, and note preservation
- part-to-project usage history
- where-used search across parts, connectors, assets, and reusable circuit blocks

Project records plus CSV BOM upload and column mapping now have a first shipped foundation. Part matching, usage creation, where-used search, and broader BOM intelligence remain planned and are not fully implemented today.

### 2. Part Readiness, Approval, and Internal Reuse

The product centers on **part readiness**, not just part existence.

A part is not considered useful merely because it appears in a source catalog or has some metadata attached to it. The system must help users determine whether a part is actually ready to use in design work and whether it is trusted for internal reuse.

This includes:

- identity confidence
- normalized technical data
- datasheet evidence
- mate and accessory completeness
- CAD asset readiness
- sourcing and lifecycle visibility
- approval state
- explicit blockers and warnings

### 3. Evidence-Based Validation and Asset Trust

Engineering assets and decisions must be backed by durable evidence.

The platform must track:

- what exists
- what is only referenced
- what has been downloaded
- what has been validated
- what has been reviewed
- what is truly verified for export
- which evidence supported each decision

The platform must not imply that a part is export-ready unless the underlying assets actually support that claim.

### 4. Connector Buildability and Known-Good Connector Sets

For connectors, the platform must do more than list a part number.

It must help users understand:

- best mate
- alternate mates
- required accessories
- optional accessories
- cable compatibility
- tooling requirements
- whether the connector set is actually buildable
- whether there are near-match or family-confusion risks

Connector intelligence is one of the primary differentiators of the product because connector readiness depends on known-good sets, not isolated catalog rows.

### 5. Reusable Circuit Blocks

Reusable circuits must be treated as structured engineering knowledge, not loose notes.

Target capabilities:

- circuit block records
- approved parts attached to a block
- evidence and validation context
- design constraints and usage notes
- known risks and allowed reuse scope
- project usage history

These capabilities are planned and are not fully implemented today.

### 6. BOM Health and Risk Review

The product must help teams review risk across an entire project BOM, not only one part at a time.

Target risk dimensions:

- lifecycle and sourcing risk
- approval gaps
- missing or untrusted evidence
- missing verified CAD/export assets
- connector buildability gaps
- unresolved duplicate or source-conflict issues
- internal reuse and where-used context

The BOM health dashboard, fleet risk, revision compare, follow-ups, and lifecycle regression findings are shipped today (see `docs/IMPLEMENTATION_STATUS.md`).

### 7. Team Collaboration, Roles, and Change Governance

The product must work for a **team**, not just one librarian. As more than one engineer relies on the same engineering memory, the platform must make access, accountability, and change control first-class — without weakening the imported ≠ approved ≠ export-ready discipline.

Foundation now shipped:

- a request-pipeline **audit log** of every unsafe API action (actor, role, target, outcome, hashed source hints)
- a single-stage **project revision approval gate** pinned to the reviewed diff fingerprint
- **controlled document revisions** with lifecycle, access levels (`public` / `internal` / `restricted` / `itar_controlled`), expiry, supersession, `user | team | role` ACL principals (`view | review | approve | admin`), a per-asset download-grant resolver, and page-anchored redlines
- a **vendor notebook** for trusted suppliers

Target capabilities (planned):

- **role-based access control** beyond `admin | user`: viewer, contributor, reviewer, approver, exporter, admin, with per-project / per-program scope (generalizing the shipped document-control ACL model)
- **OIDC single sign-on** (Okta / Azure AD / Ping)
- **multi-stage ECN/ECO** change workflow with effectivity dates, assignment, and notifications
- **concurrent editing safety** (optimistic locking + presence indicators)
- **enforced ITAR/EAR classification and download gating** built on the shipped document access levels
- **real ECAD/MCAD emission** and **PLM / ERP / requirements bridges** so a team's exports and records flow into the rest of its stack

Governance rule: roles decide who *may* act; the audit log records what they *did*; the two stay separate, and a scoped approval never widens silently.

---

## Core User Problem

Electrical and hardware engineers routinely waste time on work that should not be this painful:

- hunting across distributor and manufacturer sites
- manually comparing inconsistent package data
- figuring out which connector mates are actually correct
- determining whether a connector selection is truly buildable
- searching for trustworthy symbols, footprints, and 3D models
- discovering that an available file is incomplete, outdated, or misleading
- repeating the same comparison work for similar parts
- rediscovering decisions that already happened on earlier projects
- losing the reason a part, connector set, or circuit pattern was approved
- discovering late that a part family has subtle but critical variant differences
- struggling to move part data cleanly into ECAD and MCAD tools
- lacking a trustworthy internal record of what is approved, reusable, risky, or ready

The product must reduce this friction by centralizing internal engineering truth, compatibility, readiness, evidence, approval, and project memory in one place.

---

## Primary User Outcomes

A successful product allows a user to:

1. import or search for an MPN and quickly resolve the intended part
2. understand normalized engineering data and provenance
3. determine whether identity is verified, ambiguous, or conflicted
4. see which assets exist and how trustworthy they are
5. resolve the best connector mate and required accessories
6. understand whether the part or connector set is buildable in a real design context
7. see risk flags such as family confusion, near-match variants, incomplete dependencies, or lifecycle exposure
8. understand whether the part is approved for engineering use
9. export only when the asset bundle is truly ready
10. see where a part or known-good set has been used before once project memory is implemented
11. review BOM health and create follow-up work once BOM workflows are implemented
12. reuse circuit blocks only when evidence and constraints support reuse

---

## Primary Users

The product is designed primarily for:

- electrical engineers
- hardware engineers
- ECAD librarians / component librarians
- integration and test engineers
- procurement-adjacent technical users
- technical admins reviewing part readiness and asset workflows
- hardware leads reviewing BOM risk and internal reuse decisions

There are three major user modes:

### Quick Engineering User

A user who wants a fast answer to:

- what is this part
- is it ready
- what mates with it
- what files exist
- what am I missing

### Technical Admin / Librarian User

A user who needs to:

- review unresolved issues
- manage provider imports
- approve parts
- validate assets
- resolve duplicates, conflicts, and missing data
- manage workflows for recovery and promotion

### Project / BOM Reviewer

A user who needs to:

- import or review a project BOM
- identify risky or unapproved rows
- find prior project usage
- reuse known-good parts, connectors, and circuit blocks
- assign follow-up work for evidence or asset gaps

Project/BOM reviewer workflows are planned and should not be treated as fully shipped today.

---

## Current Implemented Slice

The current working product is the part-readiness foundation:

- MPN-driven catalog workbench
- exact-MPN provider import for configured providers
- part detail workspace with readiness, evidence, provenance, CAD/export state, and next action
- connector buildable-set projection
- asset truth, validation evidence, review, and verified-for-export promotion separation
- admin surfaces for review, promotion, failed import, validation, and issue-driven operations queues
- system health reporting for API, database, storage, worker heartbeat, and async queue state

This part-readiness foundation has since been joined by the full **project/BOM memory** track (projects, revisions, CSV/XLSX BOM intake and matching, confirmed usage, where-used, BOM health and fleet risk, evidence vault, circuit blocks, connector-set catalog, export bundles with cryptographic provenance) and the **team-governance foundation** (audit log, project revision approval gate, controlled document revisions/ACL/redlines, vendor notebook). `docs/IMPLEMENTATION_STATUS.md` is authoritative for exactly what is shipped. The remaining mission is the **multi-engineer** arc in pillar 7 above: scoped RBAC, SSO, multi-stage ECN/ECO, concurrency, and real CAD emission.

---

## Functional Requirements

### 1. Quick Part Readiness Check

The platform must support a primary intake flow where a user can provide:

- MPN
- optional manufacturer
- optional provider part reference
- optional provider URL
- optional datasheet URL

The result must provide a readiness-oriented summary that includes:

- identity status
- category / package summary
- readiness summary
- key warnings
- asset status
- mate/accessory status where applicable
- next actions

This flow should feel like a practical engineering tool, not a shopping catalog.

### 2. Search and Discovery

The platform must support:

- MPN search
- manufacturer filters
- category and subcategory filters
- package filters
- lifecycle filters
- readiness filters
- CAD availability filters
- approval filters
- connector class filters such as connector, accessory, tooling, cable, and non-connector

The search experience should support engineering triage and part selection, not ecommerce-style browsing.

### 3. Part Detail / Readiness Workspace

Each part must have a detail page that acts as the core engineering workspace.

Minimum requirements:

- identity and key specs
- use decision
- readiness summary
- normalized specs
- package dimensions
- datasheet state
- engineering assets
- bundle readiness summary
- mates and accessories for connectors
- similar and companion part context where available
- risk / warning panel
- approval summary
- recovery actions for missing CAD assets when source material allows it
- export actions that reflect real file availability and trust state
- provenance or audit summary

This page should answer "Can I use this part?" before showing audit depth.

### 4. Engineering Assets

The platform must treat these as first-class asset types:

- symbol
- footprint
- 3D model
- datasheet
- mechanical drawing

For each asset, the system must track:

- provenance type
- availability state
- validation state
- review state
- export readiness
- preview readiness

Allowed provenance types:

- official
- trusted_external
- generated
- manual_internal

Generated assets must never be presented as official.

### 5. Connector Intelligence

Connector relationships must support:

- best mate
- alternate mates
- requires accessory
- optional accessory
- supports cable
- tooling requirement

The product must also resolve a **Buildable Mating Set** that surfaces:

- the selected connector
- the best mate
- required accessories
- optional accessories
- compatible cable option where applicable

Connector views must also support:

- compatibility confidence
- uncertainty labeling
- family-confusion warnings where relevant
- known-good set context once project memory is implemented

### 6. Similar Parts, Companion Parts, and Risk Warnings

The system must clearly distinguish between:

#### Similar Parts

Alternates or near-equivalents that may substitute for the selected part.

#### Typical Companion Parts

Parts commonly used alongside the selected part in real circuits or assemblies.

Examples:

- LDO + capacitors
- MCU + crystal + decoupling
- transceiver + termination + TVS
- connector + contacts + backshell + cable

#### Risk Flags / Warnings

Warnings that help prevent engineering mistakes, such as:

- near-match variant confusion
- family ambiguity
- mounting mismatch
- pinout risk
- unresolved accessory dependency
- lifecycle risk
- conflicting source data

The product must not blur these concepts together.

### 7. Datasheet-Driven Generation Workflow

When file-backed CAD assets are missing, the product must support typed recovery workflows such as:

- generate footprint from datasheet or package/mechanical dimensions
- generate symbol from pin/function tables
- generate 3D model from mechanical drawing geometry

The workflow must preserve:

- provenance
- readiness status
- confidence metadata
- review state

The product must be explicit when generation is unavailable due to insufficient source data.

### 8. Approval Workflow

The platform must support a part-level approval model that is separate from import success and separate from asset review.

A part should be able to move through states such as:

- draft
- pending review
- approved for design
- restricted
- rejected

Approval workflows must make it clear:

- who reviewed a part
- why a decision was made
- what blockers remain
- what scope of use is approved

### 9. Admin Review Queue

The platform must provide an operational review queue for unresolved readiness issues.

Minimum queue categories:

- failed intake or import
- low-confidence identity
- missing mates
- missing accessories
- missing footprint
- missing symbol
- missing 3D model
- conflicting source data
- duplicate candidates
- pending approval
- obsolete or risky parts

The admin queue should support triage, assignment, review, and resolution.

### 10. Export

The platform must support:

- Altium bundle
- SolidWorks bundle
- neutral STEP/CAD package
- manifest and warnings output

Exports may only include assets that are truly available and appropriately verified. Referenced URLs alone do not count as export-ready files.

### 11. Project/BOM Memory

The platform must add project memory as the next major product direction.

Foundation now shipped:

- project records
- CSV BOM upload/import
- BOM column mapping
- original BOM row preservation

Planned requirements:

- BOM row matching
- part-to-project usage history
- where-used search
- evidence attachments
- reusable circuit block records
- BOM health dashboard

These requirements are target behavior, not shipped behavior unless `docs/IMPLEMENTATION_STATUS.md` says otherwise.

---

## Trust and Honesty Requirements

The platform must be strict about engineering truth.

### The system must never:

- imply a file exists when it does not
- imply a referenced asset is the same as a downloaded asset
- imply a generated asset is official
- imply a reviewed asset is automatically verified for export
- imply a connector set is buildable if required relationships are incomplete
- imply a successful import means a part is approved for design use
- imply approval means export readiness
- present planned matching, where-used, circuit block, evidence vault, or BOM health workflows as shipped behavior
- hide blockers behind vague readiness labels

### The system must always:

- preserve provenance
- preserve workflow state
- preserve confidence and uncertainty where applicable
- make trust boundaries visible to the user
- explain readiness through explicit warnings, blockers, and state
- keep asset truth and part approval clearly separated
- keep review approval, validation evidence, and verified-for-export promotion separate
- make project history and where-used data first-class product concepts as those features are implemented

---

## UX and Interaction Requirements

The product should feel like an **engineering work surface**.

### The UI must prioritize:

- fast MPN-driven workflows
- project/BOM context as the product expands
- structured data presentation
- clear status communication
- readable technical density
- practical next actions
- calm, explicit error and warning states

### The UI should avoid:

- marketing-site hero layouts
- decorative emptiness
- vague status language
- flashy dashboard aesthetics that reduce clarity
- hiding technical truth behind oversimplified polish

### Key user-facing concepts that must be legible:

- readiness
- blockers
- confidence
- provenance
- approval
- export truth
- validation evidence
- where-used history
- project/BOM risk
- compatibility confidence

---

## Non-Goals for the MVP

The MVP should not attempt to:

- scrape the entire internet in real time
- support every CAD tool immediately
- auto-generate perfect CAD assets for arbitrary parts
- provide full enterprise permissions/auth complexity in the MVP itself (scoped RBAC, OIDC SSO, and enforced ITAR gating are deliberately sequenced as the post-MVP **team-readiness** direction in pillar 7, building on the shipped audit log and document-control ACL foundation — not crammed into the initial slice)
- become a distributor marketplace
- replace formal engineering review for production-critical designs
- claim universal connector compatibility across every vendor family without evidence
- claim project/BOM import, where-used search, circuit blocks, evidence vault, or BOM health dashboard are already complete

---

## Success Criteria

The product is succeeding when a user can say:

- I found the right part quickly.
- I know whether the identity is trustworthy.
- I know what mates with it.
- I know what else I need to build with it.
- I know which files are real and trustworthy.
- I know whether this part is actually approved for use.
- I know what can be exported now.
- I know what can be recovered when files are missing.
- I know what is blocking readiness if the part is not ready.
- I know where this part or known-good set has been used before.
- I know which BOM rows carry risk and which decisions need follow-up.

That is the standard.
