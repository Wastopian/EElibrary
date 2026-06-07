# Plain-language copy glossary

This is the standardized vocabulary for every user-facing string in EE Library.
It captures the wording agreed in the recent plain-language sweeps and is the
reference you can point to in code review when copy starts drifting back toward
internal-workflow jargon.

## Why this exists

EE Library's primary audience is **older electrical engineers who are not
software-savvy**. They need to sit down and get real work done without translating
implementation language in their head. Workflow words like *promote*, *enrichment*,
*acquisition*, *provenance*, *truth*, *gate*, *file-backed*, *backend-backed*,
*asset class* mean nothing to that audience and make the app feel inscrutable.

Sweep history that produced this glossary:

- [#28](https://github.com/Wastopian/EElibrary/pull/28) Part detail page split (structural — no copy change)
- [#30](https://github.com/Wastopian/EElibrary/pull/30) Catalog first-run auto-open + doc catch-up
- [#31](https://github.com/Wastopian/EElibrary/pull/31) Part-detail plain-language sweep
- [#32](https://github.com/Wastopian/EElibrary/pull/32) Admin plain-language sweep
- [#33](https://github.com/Wastopian/EElibrary/pull/33) Cross-page consistency audit
- [#34](https://github.com/Wastopian/EElibrary/pull/34) `packages/shared` + view-model label audit

## Principles

1. **Plain over precise.** Say "stored file" not "file-backed asset," "import"
   not "acquisition," "background update" not "enrichment job." If you find
   yourself reaching for a workflow noun, ask whether an engineer with no
   knowledge of our internals would recognize it.
2. **Action before structure.** "Mark this file verified" beats "Promote to
   verified for export." The user wants to know what the button does, not
   which state machine transition it triggers.
3. **State, not "truth."** Say "status," "state," or "what's on file." Never say
   "truth" in user-facing copy — that's an internal modeling word.
4. **Boundary copy stays honest.** When you need to make the trust boundary
   explicit ("approving the part does not verify its files"), do it in plain
   language. Don't reach for "remains separate from generated asset review and
   explicit export promotion" — say "does not review its files or mark them
   ready for export."
5. **Empty states explain what to do next.** "No imports recorded in the current
   catalog window" → "No source imports recorded in the current catalog window."
   Avoid passive constructions that read like API documentation.
6. **Don't overuse "explicit," "evidence," "workflow," "boundary."** They're
   fine in moderation but they pile up fast and start to sound technical.

## The glossary

If the column on the left appears in user-facing copy, change it to the column
on the right.

### Imports and background work

| Don't say | Say |
| --- | --- |
| Acquisition (queue, summary, history) | Import / Imports |
| Acquisition provenance | Where this part came from |
| Acquisition note | Import note |
| Acquisition job / acquisition results | Background import / background import results |
| Background enrichment | Background data updates |
| Enrichment (queue, label, history) | Background update / Background updates |
| Enrichment note | Update note |
| Latest enrichment failed | Latest update failed |
| Enrichment unavailable | Updates unavailable |
| Source-record-linked / source provenance | Source / source record / on file |
| Requested lookup | What we searched for |
| Supplier part key | Supplier's ID for this part |
| Provider source rows | Provider source records |
| Source URL recorded | Source link recorded |
| No source URL | No source link |
| Source row stored | Source on file |
| Captured evidence | Recorded evidence (or just "on file") |

### Files and CAD assets

| Don't say | Say |
| --- | --- |
| Asset class | File type |
| Asset rows (when user-facing) | Files |
| File-backed asset | Stored file |
| File-backed CAD asset | Stored CAD file |
| File-backed evidence | Stored evidence file |
| File evidence incomplete | Verification incomplete |
| Stored asset | Stored file |
| URL-only references | Link-only records |
| Reference-only rows | Link-only records |
| Referenced metadata | Link on file (or "link to source") |
| CAD references only | CAD links only |
| No usable assets | No usable files |
| No asset rows are attached | No files are attached |
| No stored asset or requestable recovery workflow | No file or recovery request on file |

### Verification, approval, export

| Don't say | Say |
| --- | --- |
| Promote / Promotion (button, queue, audit, candidates) | Mark verified / Verify / Verification |
| Promote to verified for export | Mark this file verified |
| Export promotion | Mark verified for export |
| Promotion queue | Files to mark verified |
| Promotion candidates | Files waiting to verify |
| Eligible now / Eligible promotions | Ready to verify |
| Blocked promotions | Blocked from verify |
| Promotion audit history | Verification audit history |
| Promotion outcomes remain auditable even when denied | Verification outcomes are recorded even when denied |
| Promotion stays explicit | Marking files verified stays a separate step |
| Approved drafts are not yet verified for export | Approving a draft is not the same as verifying it for export |
| Approval alone does not verify export | Approving alone does not verify files for export |
| Approval does not make export available | Approving a part does not make exports available |
| Whole-part approval remains separate from generated asset review and explicit export promotion | Approving the part does not review its files or mark them ready for export |
| Whole-part approval gate | Approval step |
| Approval/review state column | Approval/review state (stays — already plain) |
| Bundle gate | Export readiness |
| Bundle ready | Bundle ready (stays — already plain) |
| Partial bundle | Partial package |
| References only (in BundleReadiness label) | Links only |
| No usable assets (in BundleReadiness label) | No usable files |
| Export bundle (workspace label) | Export package |
| Export bundle assembly (queue) | Export package assembly |
| Export lane open / Export lane blocked | Ready to download / Not ready |
| Generation workflow status | File generation status |
| Tracks async work separately from stored official or verified file assets | Tracks background work separately from stored official or verified files |
| Signals sufficient / Signals incomplete | Enough info to generate / Not enough info yet |
| Source check (generation form) | Source check (stays — already plain) |
| Structured signals | Available info |
| Creates a tracked request in the catalog | Adds a tracked request to the catalog |

### Trust framing — never use "truth" in user copy

| Don't say | Say |
| --- | --- |
| Asset truth / review truth / export truth / approval truth / trust truth / stored truth | Approval state / review state / export status / file state / state / status |
| Review and export truth | Review and export status |
| Trust state (in user copy) | Status / state (or specifically: approval, review, export status) |
| Trust lineage (heading or aria label) | Verification steps |
| CAD truth (workflow signal label prefix) | CAD status |
| Whole-part readiness | Part readiness |
| Readiness record | Where this part stands |
| Library readiness does not override lifecycle risk | A "ready" library record does not override lifecycle risk |

### Workflow nouns

| Don't say | Say |
| --- | --- |
| Operations queues (stays) | Operations queues |
| Queues only appear when records exist | Queues only appear when there is something in them |
| Queued provider work | Background provider work |
| backend-backed rows | rows |
| Top blockers | What is blocking this part |
| Blockers and next actions | What to do next |
| Inspect assets | Review files |
| Review export blockers | See what is blocking export |
| Class state | File status |
| Review lane | Review step |
| Implementation-friendly mate and accessory context | Mates and accessories you need to build with this connector |
| Buildable set reflects stored relationship mapping | Based on the mate and accessory relationships we have on file |
| Connector build set | Connector build set (stays — domain term) |

### Empty states and "not recorded" copy

| Don't say | Say |
| --- | --- |
| Not recorded (acceptable but vary it) | Not recorded / No revision recorded / No source on file |
| Quantity not captured | Quantity not recorded |
| Packaging not captured | Packaging not recorded |
| Tiers captured | Tiers recorded |
| No source record | No source on file |
| Source row | Source record / source |
| Reference only | Link only |

### Evidence framing

| Don't say | Say |
| --- | --- |
| Evidence is provenance | Evidence is a record, not a gate |
| Without changing target trust state | Without changing approval or export status |
| Project usage and circuit-block dependency do not approve this part or make exports available | Showing this part in projects or circuit blocks does not approve it or make it ready to export |

## Terms we deliberately keep

Some words look technical but are correct for the audience and stay:

- **CAD**, **MPN**, **BOM**, **footprint**, **symbol**, **3D model**, **datasheet**,
  **pitch**, **lifecycle**, **package** — EE domain words; older engineers know
  these and would find them missing if we plain-languaged them.
- **Bundle ready** (label) — paired with "Export readiness" in display, common
  enough as a phrase for engineers.
- **Approval** — clear and direct. "Approving a part" is fine.
- **Review** — fine as a noun and a verb.
- **Verified for export** — the deliberately-chosen long form; the action
  button label is "Mark verified" or "Mark this file verified" but the concept
  name is "verified for export."
- **Catalog**, **admin**, **vendor**, **project**, **revision**, **circuit
  block**, **connector set** — workspace nouns. Stay.

## What to do in review

When you see jargon in a PR diff:

1. Check this glossary for the standardized phrase.
2. If the term isn't here yet but feels technical, raise it on the PR and
   propose a plain-language replacement.
3. If the replacement is broadly useful, add it to this glossary in the same PR
   (or a quick follow-up).
4. Internal type names, JSDoc, schema column names, and field identifiers are
   out of scope — only user-facing strings change. The shared `acquisition`/
   `enrichment` field names on `SystemHealthResponse` stay; the labels we
   render on top of them ("Imports" / "Background updates") are what we
   standardize.

## Where this is enforced

- `apps/web/src/` — every user-facing string the UI renders directly.
- `apps/web/src/lib/detail-view-model.ts` — formatters and summary labels that
  feed multiple pages.
- `packages/shared/src/asset-resolution.ts` — `BundleReadinessSummary.label`
  and `.reason` (rendered across catalog, compare, part detail).
- `packages/shared/src/part-readiness.ts` — risk-flag detail strings and
  missing-CAD reason copy.
- `apps/web/src/lib/import-ui-copy.ts` — provider-import workflow strings.

Persistent type names (`PartAcquisitionSummary`, `ProviderEnrichmentJob`,
`AssetClassReadiness`, etc.), database column names, and API contract field
names are intentionally **not** rewritten. Renaming those would be a contract
change with no user-visible benefit.
