# UI / UX Brief

This document describes the target UX direction. For current shipped surfaces and intentional gaps, use `docs/IMPLEMENTATION_STATUS.md`.

## UI thesis

EE Library should feel like a serious **private engineering memory system for hardware teams**.

It should not feel like:
- a distributor storefront
- a generic SaaS dashboard
- a flashy sci-fi concept piece
- a passive footprint download site
- a marketing-style landing page with technical decorations

The interface should help engineers answer practical questions fast:

- What part is this?
- Is the identity verified or ambiguous?
- Where has this part, connector set, or circuit block been used before?
- Which project or BOM introduced this decision?
- Can I actually use this part in a design yet?
- What mates with it?
- What else do I need?
- Which assets exist?
- Which assets are trustworthy?
- Which evidence supports this decision?
- What blockers or risks remain?
- Is it approved for design use?
- What can I export now?
- What can I recover if files are missing?
- What is risky across this project BOM?

The product should feel **precise, trustworthy, efficient, and operational**.

---

## Product feel

### Core adjectives
- precise
- industrial
- trustworthy
- technical
- calm
- fast to scan
- data-dense without feeling cramped
- operational
- deliberate

### Experience goals
- engineers should be able to understand part readiness in seconds
- trust boundaries should be visible without reading paragraphs
- project and BOM context should make prior decisions easy to reuse
- important actions should feel deliberate, not vague
- dense data should feel organized, not buried
- blockers should be obvious
- uncertainty should be visible, not hidden behind polished UI language
- cross-workspace actions should use plain labels so operators do not need to understand query strings or internal route structure
- system health, setup-required states, and empty workspaces should give visible next actions instead of expecting terminal, URL, or backend knowledge
- the product should reward serious use, not just first impressions

---

## Design direction

### Primary visual style
Use a **Precision Lab** design language:

- clean engineering workspace
- restrained technical polish
- professional and premium
- subtle schematic/grid influence
- modern without becoming flashy
- slightly industrial, but still readable for long sessions

### Layout style
- lighter main workspace surfaces for readability
- darker embedded technical panels for file viewers, status panels, or audit-oriented sections
- dense but structured information hierarchy
- clear separation between summary, technical detail, and workflow/action panels
- visible right-rail or side-panel space for blockers, approval state, or next actions where useful

### Visual tone
The interface should look like a product an engineer could comfortably use for hours.

That means:
- low visual noise
- strong spacing rhythm
- crisp tables
- meaningful badges
- subtle hierarchy
- no decorative clutter pretending to be value
- no fake “AI magic” styling

---

## Color direction

### Core palette
- soft off-white or cool light gray for primary workspace
- slate or charcoal text
- restrained blue as the main accent
- muted steel-blue borders and dividers

### Status colors
- muted green for verified, approved, or healthy states
- amber for review-required, caution, or partial states
- purple for generated states
- red reserved for failures, blocked states, or critical issues
- neutral gray for unknown, unresolved, or not-applicable states

### Typography
- clean sans-serif for general interface text
- mono font for:
  - MPNs
  - filenames
  - package identifiers
  - hashes
  - provider part IDs
  - status references where useful

Typography should do real work, not just decorate.

---

## Information hierarchy

The UI should consistently prioritize the following in this order:

1. current task context: part, project, BOM, or circuit block
2. identity and matching confidence
3. readiness state
4. blockers and warnings
5. buildability / compatibility
6. engineering asset truth
7. evidence and provenance
8. approval and trust state
9. where-used and reuse context when available
10. package / mechanical detail
11. export readiness
12. fallback or recovery actions

The product should not bury the important truth under decorative cards.

---

## Core UX model

The UI should revolve around this product promise:

> Raw MPN in, engineer-ready part record out.

The shipped foundation supports that part-readiness loop. The planned product direction expands the promise to:

> Project BOM in, reusable engineering memory out.

That means the UX is not just "search and browse."
It is:

- intake
- readiness evaluation
- blocker visibility
- compatibility understanding
- asset truth
- approval / trust
- recovery and next actions
- planned project/BOM memory
- planned where-used history
- planned evidence-backed circuit reuse
- planned BOM health and risk review

The UI should make it obvious what the user knows, what the system knows, and what still needs work.

---

## Main pages

## Quick Part Readiness Check
Purpose:
- give engineers the fastest path from a raw part number to a usable readiness answer

Required inputs:
- MPN
- optional manufacturer
- optional provider part reference
- optional provider URL
- optional datasheet URL

Required outputs:
- identity status
- category / package summary
- readiness summary
- key blockers
- key warnings
- mate/accessory status where relevant
- asset status
- approval state
- recommended next actions

Notes:
- this should feel like an engineering triage tool, not a search hero banner
- the result should be immediate, compact, and explainable
- this should likely become the real homepage anchor, not an empty dashboard

---

## Dashboard
Purpose:
- give engineers a useful entry point into the library when they are not starting from a new part intake

Key modules:
- global search
- recent parts
- saved filters or saved views
- recently reviewed or approved parts
- recently requested or generated asset workflows
- open issues requiring attention
- library health / catalog freshness
- quick tools

Notes:
- dashboard should feel useful immediately, not like an empty home page
- emphasize recent engineering work, open blockers, and readiness workflows over marketing-style tiles

---

## Search
Purpose:
- help users find the right part quickly and understand its readiness before opening detail

Required elements:
- filter rail
- result list / table toggle
- readiness badges
- asset badges
- connector-intelligence badges
- compare selection
- lifecycle / trust indicators
- approval indicator
- blocker count or issue hint
- bundle readiness signal

Preferred result fields:
- MPN
- manufacturer
- category / package
- connector family if relevant
- overall readiness state
- top blocker or top warning
- best mate / buildable-set hint for connectors
- generated / reviewed / verified indicators where relevant
- approval state where relevant

Notes:
- search results should feel like engineering results, not product cards
- table mode should be especially strong for power users
- results should answer “should I open this?” before the click

---

## Part Detail / Readiness Record
Purpose:
- serve as the core engineering decision page

This is the most important surface in the product.

### Required sections

#### Part hero
- MPN
- manufacturer
- category / package
- lifecycle
- readiness state
- approval state
- top status badges
- high-level bundle readiness
- trust / confidence signal where applicable

#### Readiness summary
Must show:
- overall readiness state
- explicit blockers
- key warnings
- approval state
- recommended next actions

This section should answer:
- can I use this yet
- what is stopping me
- what should I do next

#### Specs
- normalized specs table
- grouped technical metrics where useful
- source-aware confidence display

#### Package and mechanical
- package dimensions
- package metadata
- mechanical summary
- important package notes
- risk indicators when applicable

#### Engineering Assets
Must clearly show:
- symbol
- footprint
- 3D model
- datasheet
- mechanical drawing

For each asset, show:
- provenance
- availability state
- review state
- export state
- validation / preview readiness where applicable

#### Mates and accessories / Recommended Buildable Set
For connectors, this should be one of the most important panels.

Must support:
- best mate
- alternate mates
- required accessories
- optional accessories
- cable compatibility
- tooling requirements when relevant
- compatibility confidence
- uncertainty or near-match warnings where relevant

This section should feel implementation-friendly, not like a vague recommendation cloud.

#### Similar Parts
Show alternates or near-equivalents.

#### Typical Companion Parts
Show parts commonly used alongside the selected part in real circuits or assemblies.

These must remain visually distinct from Similar Parts.

#### Risk Flags / Warnings
Show:
- near-match variant risk
- family confusion
- mounting mismatch
- pinout risk
- unresolved accessory dependency
- lifecycle risk
- conflicting source data
- other engineering hazards

This section should be highly scannable and severity-based.

#### Missing Assets / Fallback Actions
Show:
- what is missing
- whether recovery is possible
- why generation is available or unavailable
- current workflow state if generation was requested

#### Approval and audit summary
Show:
- approval state
- reviewer / review metadata where appropriate
- scope of approval if applicable
- major provenance or audit trail indicators

#### Export drawer / export panel
Show:
- bundle readiness
- exact missing blockers
- supported outputs
- warnings / manifest summary

Notes:
- the detail page should feel like a real working environment, not a long landing page
- major truth should be visible near the top, not buried twenty scrolls deep

---

## Compare
Purpose:
- help engineers choose between parts without bouncing across multiple detail pages

Required comparisons:
- key specs
- package differences
- CAD completeness
- lifecycle / trust
- approval state
- readiness state
- connector readiness if relevant
- bundle readiness
- review / export status
- risk warnings where relevant

Notes:
- compare should be dense, table-heavy, and crisp
- avoid oversized cards here
- this page should feel analytical

---

## Tools
Purpose:
- extend the platform into practical EE workflows

Shipped first workspace:
- `/tools` is a local scratchpad for voltage-divider tolerance/load shift, pull-up edge timing, and package power derating
- each tool produces a copyable evidence-note draft for later attachment to a project, part, or evidence record
- tools do not write project memory, approve parts, validate assets, or unlock export bundles

Examples:
- calculators
- cross-reference tools
- BOM helpers
- package helpers
- connector / cable assistance

Notes:
- tools should feel adjacent to part workflows, not bolted on randomly
- tools should reinforce readiness and buildability, not distract from them

---

## Admin / review
Purpose:
- expose internal truth-maintenance and readiness workflows

Required modules:
- intake / import queue
- source conflicts
- failed parses
- generation jobs
- approvals / review queue
- validation issues
- open readiness issues
- duplicate candidates
- low-confidence identity cases
- obsolete or risky parts

Notes:
- admin pages should optimize for clarity and throughput, not style flourishes
- this should feel like an operations cockpit, not a prettier spreadsheet
- queue scoping should support plain search and understandable work-state filters before exposing backend-shaped identifiers

## System Health
Purpose:
- make API, database, storage, worker, and queued-job readiness easy to inspect intentionally

Required modules:
- service status cards
- worker heartbeat state
- acquisition and enrichment queue counts
- raw health endpoint access for maintainers
- plain recovery links back to Catalog, Admin queues, and setup checks

Notes:
- system health should be discoverable from the shell without becoming a noisy dashboard
- health states must remain operational signals, not trust or export signals
- recovery copy should be useful to non-software-savvy operators while still giving maintainers enough detail to fix setup

---

## Team Collaboration and Governance

As more than one engineer relies on the same memory, the UI must make access, accountability, and controlled change legible — using the same calm, honest, scannable language as the rest of the product. The governance foundation is shipped; the role-aware surfaces are the next UX direction.

### Shipped governance surfaces

- **Activity / audit history** — per-entity activity strips on part and project detail, plus an admin timeline. Each entry reads as a plain sentence: who did what, to which target, with what outcome. Never expose raw request bodies, tokens, or hashes-as-identity; hashes are integrity hints, not user-facing identifiers.
- **Project revision approval gate** — a clear approve / request-changes control over a visible revision diff, with the reviewed diff fingerprint shown so the decision's scope is unmistakable. Disabled or pending states must say exactly what is being decided and that it does not approve parts or unlock export.
- **Document control** — controlled document revisions show lifecycle, access level (incl. `itar_controlled`), expiry, and "replaces rev X" supersession; redlines are page-anchored and severity-tagged. A blocked download must say *why* (access level / ACL), not fail silently.
- **Vendor notebook** — `/vendors` reads like a trusted-supplier address book with files and usage references, not a procurement catalog.

### Planned role-aware UX

- **Roles and scope** — surfaces must adapt to the viewer's role (viewer / contributor / reviewer / approver / exporter / admin) and project scope: hide or disable actions the role cannot perform, and explain *why* an action is unavailable rather than hiding it without a reason.
- **SSO sign-in** — a single, unsurprising OIDC sign-in path.
- **Multi-stage ECN/ECO** — show the change's current stage, who must act next, and the redline diff, as a calm pipeline rather than a noisy workflow engine.
- **Presence and concurrency** — lightweight "who else is here" indicators and clear, recoverable conflict messages instead of last-write-wins surprises.

Governance honesty rules:

- authorization state (who *may* act) and audit state (what *was* done) are shown as distinct concepts, never merged into one vague "status"
- disabled governance actions explain the missing role, scope, or access level
- an approval's scope is always visible; nothing implies an approval is broader than it is
- governance never collapses the imported → reviewed → approved → verified_for_export lineage

---

## Project Memory Screens (shipped)

> **Status note (2026-05-23):** The screens in this section have **shipped** (projects, BOM import/mapping, BOM health, where-used, circuit blocks, evidence). They are kept here as the UX reference for those surfaces; they are no longer "planned." Defer to `docs/IMPLEMENTATION_STATUS.md` for current status.

### Projects Dashboard
Purpose:
- show active projects, recent BOM imports, unresolved project risks, and where engineering follow-up is needed

Required modules:
- project list with status and owner
- latest revision or BOM import state
- high-level BOM health signal
- unresolved risk count
- recent activity and follow-up actions

### Project Detail
Purpose:
- provide the project-level workspace for revisions, BOMs, part usage, evidence, and risks

Required modules:
- project identity and revision selector
- BOM import history
- part usage summary
- unresolved risk findings
- evidence and source file references
- links to BOM health and where-used views

### BOM Import / Mapping Flow
Purpose:
- let users upload a BOM, map columns, preserve original row context, and create follow-up work for weak rows

Required modules:
- file upload
- column mapping for MPN, manufacturer, quantity, designator, description, notes, and supplier references
- row preview with raw values
- match diagnostics for unmatched, ambiguous, and weak rows
- import summary before committing usage records

### BOM Health Dashboard
Purpose:
- review risk across a whole project BOM without opening every part one by one

Required modules:
- matched and unmatched row counts
- approval gaps
- lifecycle and sourcing risk
- missing evidence
- missing verified CAD/export assets
- connector buildability gaps
- source-conflict and duplicate warnings
- recommended next actions

### Where-Used View
Purpose:
- answer where a part, connector set, asset, or circuit block has appeared before

Required modules:
- project and revision usage table
- designators, quantities, and usage status
- released vs prototype context
- related circuit blocks
- risk findings tied to usage

### Circuit Block Library
Purpose:
- treat reusable circuit blocks as structured engineering knowledge, not loose notes

Required modules:
- block list with status, owner, and reuse scope
- required and optional parts
- evidence and validation state
- constraints and known risks
- where-used context

### Evidence Panel
Purpose:
- show the evidence behind a part, asset, project decision, BOM row, risk finding, or circuit block

Required modules:
- evidence type
- provenance
- file/link state
- review status
- attached object context
- notes and audit metadata

### Risk / Next-Action Queue
Purpose:
- make BOM, project, part, connector, asset, and circuit-block risks actionable

Required modules:
- risk type and severity
- affected object
- recommended action
- assignment and status
- evidence links
- resolution notes

---

## Core interface modules

### Readiness Summary
This is one of the most important modules in the product.

Must make it instantly clear:
- whether the part is engineer-ready
- what blockers remain
- what warnings matter
- what next action is most useful

### Engineering Assets
This is one of the most important modules in the product.

Must make it instantly clear:
- what exists
- what is only referenced
- what was generated
- what was reviewed
- what is verified for export

### Buildable Mating Set
This is one of the core differentiators of the product.

It should feel like:
- a confident recommendation system
- a buildable implementation guide
- not an overwhelming list of vaguely compatible junk

### Risk Flags / Warnings
This module should make dangerous ambiguity visible.

### Missing Assets / Fallback Actions
This module should make missing CAD feel actionable, not dead-ended.

### Bundle Readiness
This should be visible early and consistently.

Preferred labels:
- bundle ready
- partial bundle
- references only
- no usable assets

### Planned Where-Used Summary
This module should make internal reuse visible once project usage history exists.

Must make it clear:
- which projects and revisions used the item
- whether usage was prototype, review, released, or deprecated
- whether usage is approved reuse or only historical context
- what risks are attached to that usage

### Planned Evidence Panel
This module should make support for decisions visible without implying more trust than exists.

Must make it clear:
- what evidence exists
- where it came from
- what object it supports
- whether it was reviewed or validated
- what it does and does not prove

### Planned BOM Health Summary
This module should make project-level risk scannable.

Must make it clear:
- which rows are matched, weak, ambiguous, or unmatched
- which rows lack approval, evidence, or verified CAD/export assets
- which connector sets are not buildable
- what the highest-priority next actions are

### Planned Circuit Block Card
This module should keep reusable circuits structured.

Must make it clear:
- block status and owner
- required parts and optional parts
- evidence and validation state
- constraints and reuse scope
- known risks and where-used context

---

## UI behavior rules

### Trust and honesty rules
- generated assets must always show a generated label
- generated assets must never appear as official
- referenced assets must not appear downloadable
- reviewed assets must not automatically appear verified for export
- approved assets must not automatically imply the full part is approved for design use
- disabled export actions must explain exactly what verified file-backed assets are missing
- requestable generation must not appear available unless source-readiness rules support it
- uncertain connector compatibility must remain visibly uncertain
- blocked readiness states must explain the blockers directly
- any unimplemented project/BOM, where-used, circuit block, evidence vault, or BOM health depth must be labeled as planned until it ships
- evidence attachments must not imply validation, approval, or export readiness by themselves
- project usage history must not imply approved reuse unless approval and risk state support that claim
- circuit block membership must not hide part-level blockers or constraints

### Status communication rules
Use short, precise, engineering-oriented labels.

Prefer:
- verified
- ambiguous
- conflicted
- generated
- review required
- approved for design
- restricted
- verified for export
- referenced only
- validated
- bundle ready
- blocked
- needs review

Avoid vague language like:
- available
- complete
- ready
- supported
- good
- usable

unless the status is explicitly proven by the data model.

### Density rules
- dense data is good if hierarchy is strong
- use tables where tables are the honest format
- avoid huge empty card layouts for technical information
- do not force everything into decorative widgets
- reserve large visual emphasis for readiness, blockers, and next actions

---

## Interaction rules

### Search and filtering
- filtering should feel immediate and serious
- filters should support engineering workflows, not just marketing categories
- readiness and approval filters should be first-class
- saved views should be easy to use

### Detail page actions
- the most important actions should be obvious:
  - inspect assets
  - inspect mates
  - review blockers
  - request missing asset recovery
  - approve or review when relevant
  - export when ready

### Workflow visibility
- generation workflows should be visible where the missing asset appears
- review state should be visible where the asset appears
- approval state should be visible near readiness state
- export blockers should be visible where export is attempted
- issue and warning visibility should not require a separate admin page to discover
- future BOM row matching should show weak, ambiguous, and unmatched states directly in the import flow
- future where-used views should preserve project, revision, and usage status context

---

## Claude Design guidance

When using Claude Design, prioritize exploration of:
- overall layout / structure
- component interactions
- navigation patterns
- typography
- how readiness, blockers, approval, and trust can be communicated clearly without clutter

Preferred concept directions:
1. Clean Professional Utility
2. Technical Operations Console
3. Industrial Refined

Claude should avoid:
- giant hero sections
- soft consumer-app cards everywhere
- startup-dashboard gradients
- decorative sci-fi chrome
- vague status language
- overly sparse layouts that hide operational truth

Claude concepts should show:
- quick readiness check flow
- search with readiness signals
- part detail / readiness record
- connector intelligence view
- admin review / issue queue
- asset truth and export gating behavior
- planned project dashboard and BOM health flow where relevant
- planned where-used and circuit block views where relevant

---

## Long-term UX direction

As the platform grows, the UX should continue moving toward:

- an engineering workspace
- a trustworthy decision system
- a part readiness assistant
- a recovery path for missing CAD
- a practical buildability assistant
- an operational review surface for internal truth maintenance
- a project/BOM memory surface
- a where-used and reuse decision system
- an evidence-backed circuit block library
- a BOM health and risk review workspace

The goal is not to look impressive for thirty seconds.

The goal is to make engineers faster, more confident, and less likely to waste time chasing bad files, wrong mates, ambiguous variants, forgotten project decisions, risky BOM rows, or fake readiness.
