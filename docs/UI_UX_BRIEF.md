# UI / UX Brief

## UI thesis

EE Library should feel like a serious engineering workspace.

It should not feel like:
- a distributor storefront
- a generic SaaS dashboard
- a flashy sci-fi concept piece
- a passive footprint download site

The interface should help engineers answer practical questions fast:

- What part is this?
- What matters technically?
- What mates with it?
- What else do I need?
- Which assets exist?
- Which assets are trustworthy?
- What can I export now?
- What can I recover if files are missing?

The product should feel **precise, trustworthy, and efficient**.

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

### Experience goals
- engineers should be able to understand part status in seconds
- trust boundaries should be visible without reading paragraphs
- important actions should feel deliberate, not vague
- dense data should feel organized, not buried

---

## Design direction

### Primary visual style
Use a **Precision Lab** design language:

- clean engineering workspace
- restrained technical polish
- professional and premium
- subtle schematic/grid influence
- modern without becoming flashy

### Layout style
- lighter main workspace surfaces for readability
- darker embedded technical panels for viewers and file-centric areas
- dense but structured information hierarchy
- clear separation between summary, technical detail, and workflow/action panels

### Visual tone
The interface should look like a product an engineer could comfortably use for hours.

That means:
- low visual noise
- strong spacing rhythm
- crisp tables
- meaningful badges
- subtle hierarchy
- no decorative clutter pretending to be value

---

## Color direction

### Core palette
- soft off-white / cool light gray for primary workspace
- slate / charcoal text
- restrained blue as the main accent
- muted steel-blue borders and dividers

### Status colors
- muted green for verified / healthy states
- amber for review-required / caution states
- purple for generated states
- red reserved for failures / blocking issues

### Typography
- clean sans-serif for general interface text
- mono font for:
  - MPNs
  - filenames
  - package identifiers
  - hashes / status references where useful

---

## Information hierarchy

The UI should consistently prioritize the following in this order:

1. part identity
2. buildability / compatibility
3. engineering asset truth
4. critical specs
5. package / mechanical detail
6. export readiness
7. fallback or recovery actions

The product should not bury the important truth under decorative cards.

---

## Main pages

## Dashboard
Purpose:
- give engineers a fast, useful entry point into the library

Key modules:
- global search
- recent parts
- saved filters or saved views
- quick tools
- library health / catalog freshness
- recently requested or reviewed asset workflows

Notes:
- dashboard should feel useful immediately, not like an empty home page
- emphasize search and recent engineering work over marketing-style tiles

---

## Search
Purpose:
- help users find the right part quickly and understand its readiness before opening detail

Required elements:
- filter rail
- result list / table toggle
- asset badges
- connector-intelligence badges
- compare selection
- lifecycle / trust indicators
- bundle readiness signal

Preferred result fields:
- MPN
- manufacturer
- category / package
- connector family if relevant
- top readiness / asset signal
- best mate/buildable-set hint for connectors
- generated/review/verified indicators where relevant

Notes:
- search results should feel like engineering results, not product cards
- table mode should be especially strong for power users

---

## Component detail workspace
Purpose:
- serve as the core engineering decision page

### Required sections

#### Part hero
- MPN
- manufacturer
- category / package
- lifecycle
- trust signal
- high-level bundle readiness
- key status badges

#### Specs
- normalized specs table
- grouped technical metrics where useful
- source-aware confidence display

#### Package and mechanical
- package dimensions
- package metadata
- mechanical summary
- important package notes / risk indicators when applicable

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
- validation/preview readiness where applicable

#### Recommended Buildable Set
For connectors, this should be one of the most important panels.

Must support:
- best mate
- alternate mates
- required accessories
- optional accessories
- cable compatibility
- tooling requirements when relevant

This section should feel procurement-friendly and implementation-friendly.

#### Similar Parts
Show alternates or near-equivalents.

#### Typical Companion Parts
Show parts commonly used alongside the selected part in real circuits.

These must remain visually distinct from Similar Parts.

#### Missing Assets / Fallback Actions
Show:
- what is missing
- whether recovery is possible
- why generation is available or unavailable
- current workflow state if generation was requested

#### Export drawer / export panel
Show:
- bundle readiness
- exact missing blockers
- supported outputs
- warnings / manifest summary

Notes:
- the detail page is the most important product surface
- it should feel like a real working environment, not a long landing page

---

## Compare
Purpose:
- help engineers choose between parts without bouncing across multiple detail pages

Required comparisons:
- key specs
- package differences
- CAD completeness
- lifecycle / trust
- connector readiness if relevant
- bundle readiness
- review/export status

Notes:
- compare should be dense, table-heavy, and crisp
- avoid oversized cards here; this page should feel analytical

---

## Tools
Purpose:
- extend the platform into practical EE workflows

Examples:
- calculators
- cross-reference tools
- BOM helpers
- package helpers
- connector/cable assistance

Notes:
- tools should feel adjacent to part workflows, not bolted on randomly

---

## Admin / review
Purpose:
- expose internal truth-maintenance workflows

Required modules:
- ingest queue
- source conflicts
- failed parses
- generation jobs
- approvals / review queue
- validation issues

Notes:
- admin pages should optimize for clarity and throughput, not style flourishes

---

## Core interface modules

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
- disabled export actions must explain exactly what verified file-backed assets are missing
- requestable generation must not appear available unless source-readiness rules support it
- uncertain connector compatibility must remain visibly uncertain

### Status communication rules
Use short, precise, engineering-oriented labels.

Prefer:
- official
- trusted external
- generated
- review required
- approved
- verified for export
- referenced only
- validated
- bundle ready

Avoid vague language like:
- available
- complete
- ready
- supported

unless the status is explicitly proven by the data model.

### Density rules
- dense data is good if hierarchy is strong
- use tables where tables are the honest format
- avoid huge empty card layouts for technical information
- do not force everything into decorative widgets

---

## Interaction rules

### Search and filtering
- filtering should feel immediate and serious
- filters should support engineering workflows, not just marketing categories
- saved views should be easy to use

### Detail page actions
- the most important actions should be obvious:
  - inspect assets
  - inspect mates
  - request missing asset recovery
  - export when ready

### Workflow visibility
- generation workflows should be visible where the missing asset appears
- review state should be visible where the asset appears
- export blockers should be visible where export is attempted

---

## Long-term UX direction

As the platform grows, the UX should continue moving toward:

- an engineering workspace
- a trustworthy decision system
- a recovery path for missing CAD
- a practical buildability assistant

The goal is not to look impressive for thirty seconds.

The goal is to make engineers faster, more confident, and less likely to waste time chasing bad files or wrong mates.