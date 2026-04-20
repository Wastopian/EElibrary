# UI / UX Brief

## UI thesis

EE Library should feel like a serious **engineering part readiness workspace**.

It should not feel like:
- a distributor storefront
- a generic SaaS dashboard
- a flashy sci-fi concept piece
- a passive footprint download site
- a marketing-style landing page with technical decorations

The interface should help engineers answer practical questions fast:

- What part is this?
- Is the identity verified or ambiguous?
- Can I actually use this part in a design yet?
- What mates with it?
- What else do I need?
- Which assets exist?
- Which assets are trustworthy?
- What blockers or risks remain?
- Is it approved for design use?
- What can I export now?
- What can I recover if files are missing?

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
- important actions should feel deliberate, not vague
- dense data should feel organized, not buried
- blockers should be obvious
- uncertainty should be visible, not hidden behind polished UI language
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

1. part identity
2. readiness state
3. blockers and warnings
4. buildability / compatibility
5. engineering asset truth
6. critical specs
7. approval and trust state
8. package / mechanical detail
9. export readiness
10. fallback or recovery actions

The product should not bury the important truth under decorative cards.

---

## Core UX model

The UI should revolve around this product promise:

> Raw MPN in, engineer-ready part record out.

That means the primary UX is not just “search and browse.”
It is:

- intake
- readiness evaluation
- blocker visibility
- compatibility understanding
- asset truth
- approval / trust
- recovery and next actions

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

---

## Long-term UX direction

As the platform grows, the UX should continue moving toward:

- an engineering workspace
- a trustworthy decision system
- a part readiness assistant
- a recovery path for missing CAD
- a practical buildability assistant
- an operational review surface for internal truth maintenance

The goal is not to look impressive for thirty seconds.

The goal is to make engineers faster, more confident, and less likely to waste time chasing bad files, wrong mates, ambiguous variants, or fake readiness.