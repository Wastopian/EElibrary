# Future differentiators

Strategic items that came out of the 2026-05-12 "what makes us shine vs the big dogs" review.
Item 1 (reusable circuit blocks as the headline feature) is currently in flight and tracked in
[`TODO.md`](../TODO.md) plus [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md); items 2–7
below are captured here as forward-looking direction so the strategic context is not lost.

These are **not** shipped capabilities — keep them out of README "Current Capabilities" and
out of the implementation-status matrix until real work lands. Each item is anchored against
the project's existing honesty discipline (imported ≠ approved ≠ export-ready) and against
the small-team product wedge.

Each item lists: **why it matters**, **what is already in the repo to build on**, and a
**concrete first slice** that could be picked up later without breaking the boundaries above.

---

## 2. Connector intelligence that resolves intent → buildable set

**Why it matters.** Connector buildability is the single hardest part-selection question a
hardware engineer faces, and no public catalog or PLM solves it well. The shipped data model
already captures mate, accessory, cable, tooling, and confidence — turning that into a
free-text/structured intent resolver would be a feature nobody else has.

**Existing foundations.**

- `packages/shared/src/connector-intelligence.ts` (best mate, alternates, accessories, family
  confusion, mating confidence).
- `apps/api/src/catalog-store.ts` and `apps/worker/src/catalog-repository.ts` persistence of
  mate relations, accessories, cable, tooling.
- `/connector-sets` workspace listing connector families plus mate pairs and project usage.

**Concrete first slice.**

- Add a `resolveConnectorSetIntent({ class, pinCount?, sealing?, cableGauge?, ... })` helper
  that returns one or more `{ connector, mate, requiredAccessories, optionalAccessories,
  cableOption?, tooling? }` candidates with explicit confidence and family-confusion warnings.
- Surface it as a typed API route plus a search box on `/connector-sets`.
- Seed 10–20 high-value families (JST PH/ZH/SH, Molex Pico-EZmate, Hirose DF13, Phoenix MC,
  TE AMPSEAL, Deutsch DT, Amphenol C091 family) deterministically through the worker so the
  resolver is useful on day one.

**Honesty rules.** Resolver output must include confidence per candidate; family-confusion
warnings stay distinct from "buildable"; missing accessories degrade to `pending` instead of
being hidden.

---

## 3. Honest LLM-assisted triage that respects the trust contract

**Why it matters.** Every competitor that adds AI right now degrades trust (auto-generated
CAD, hallucinated specs, opaque substitutes). The repo's existing `confidence` + `provenance`
+ trust-lineage discipline is the exact harness needed to add LLM features that *strengthen*
trust instead of weakening it. Local-first extraction is also a real moat for small teams in
aerospace / medical / defense that cannot upload datasheets to a SaaS.

**Existing foundations.**

- Worker extraction signals and provider-neutral source records (sources retain
  `importStatus`, raw payload, and provenance type).
- `packages/shared/src/types.ts` already carries `confidence` and `provenance` on
  metrics, mates, accessories, and assets.
- Admin queues already route review and promotion; LLM output can be routed through
  `imported → reviewed` without bypassing it.

**Concrete first slice.**

- Add a worker-only datasheet summarizer that produces normalized metric *candidates*. Land
  them as `SourceRecord` rows with `provenance: "generated"` and `importStatus: "imported"`
  but never `approval_status: "approved"` — they must traverse the review gate.
- Add an LLM-suggested-substitute job that proposes alternates from `parametric_metrics` and
  parameter ranges, recorded as `part_substitutions` with explicit `approval_status:
  "pending_review"`.
- Keep all calls server-side in `apps/worker`, configurable per-deployment, with a local
  fallback (no network) for air-gapped operators.

**Honesty rules.** LLM-derived rows are always `pending` until an operator promotes them.
Never overwrite a manual or provider-imported value; always sit beside it as a conflicting
source row.

---

## 4. Side-by-side CAD / asset overlay in `/compare`

**Why it matters.** `/compare` already covers metric union, asset-class readiness, per-asset
trust-stage diff, and connector depth. Visual side-by-side preview of footprints, symbols,
and STEPs is the natural payoff of the asset-preview pipeline and turns `/compare` into a
single-screen part-selection workspace. Even Altium 365 does not do this well across parts
that came from different sources.

**Existing foundations.**

- `apps/web/src/app/compare/page.tsx` plus `apps/web/src/lib/part-compare.ts` and
  `apps/web/src/components/CompareCellTable.tsx`.
- `AssetInlinePreview` already supports inline PDF + image previews with the
  five-state matrix (`stored_pdf_inline`, `pdf_reference_only`, `ready_unsupported_format`,
  `preview_pending`, `preview_not_available`).
- Per-asset trust-stage rows already exist in compare so the verdict is unambiguous when the
  files do not match in trust.

**Concrete first slice.**

- Once a 3D/STEP preview artifact lands (currently `Planned` in `TODO.md` §2.1), add a
  "Visual diff" section in `/compare` that renders the per-part preview of each engineering
  asset class side-by-side, with explicit "Reference only" / "Preview pending" /
  "Not available" copy when previews are not embeddable.
- Add a per-asset-class toggle so engineers can choose which class to align in the row.
- Keep one row per asset class so missing classes stay visible instead of disappearing
  (matches the existing `buildCompareAssetClassRows` honesty rule).

**Honesty rules.** Never imply two assets are equivalent because they preview side-by-side;
keep the trust-stage diff row immediately adjacent.

---

## 5. Day-zero value from a single CSV ✅ first slice shipped (2026-05-13)

**Why it matters.** The biggest reason small teams stay on Excel is "I would have to set up
the new tool." If a brand-new operator can drop one BOM CSV and immediately see BOM health,
lifecycle exposure, weak-row diagnostics, and follow-up candidates *in the same screen
without configuring anything*, then a second BOM produces overlap and where-used context with
zero additional setup. This converts the demo.

**Existing foundations.**

- `apps/web/src/components/BomImportPanel.tsx` (CSV + XLSX intake, column mapping, persisted
  raw rows).
- `apps/web/src/components/BomImportMatchPanel.tsx` (deterministic row matching).
- `apps/web/src/components/BomDiagnosticsPanel.tsx` (BOM health, fleet risk, revision compare,
  follow-ups, lifecycle regression).
- `apps/web/src/components/EvidenceAttachmentPanel.tsx` and the searchable persisted-target
  picker shipped 2026-05-07.

**Concrete first slice.**

- ✅ `POST /projects/from-csv` (`apps/api/src/index.ts`) chains
  `createProjectFromCsvInDatabase` (`apps/api/src/project-memory-store.ts`) so one call
  derives a project name/key from the dropped filename, creates the project + first draft
  revision, persists the BOM import with the auto-mapped column layout, and runs deterministic
  matching — all four steps in one HTTP call.
- ✅ `/projects/new` (`apps/web/src/app/projects/new/page.tsx`) renders a server-action drop
  zone, redirects to the project's diagnostics anchor on success, and surfaces targeted
  recovery copy for missing-MPN-mapping, project-key conflicts, unsupported formats,
  oversized files, parse errors, unauthorized callers, and not-configured persistence.
- ✅ Projects index page (`apps/web/src/app/projects/page.tsx`) leads with a "Drop a BOM, see
  your project" CTA pointing at `/projects/new`.
- Next slice (still pending): add a "Compare against existing projects" overlap panel that
  runs where-used overlap automatically when other projects exist; surface BOM health + fleet
  risk inline on first landing instead of requiring a follow-up navigation.

**Honesty rules.** Matching never silently invents catalog rows; weak rows stay distinct from
matched usages; "compare against existing" never claims overlap that does not exist. The
shipped chained helper enforces this by refusing the upload when no MPN column is
recognizable (operator is told to map columns manually in the per-project panel), by
preserving the imported/reviewed/approved/verified_for_export trust lineage, and by
explicitly distinguishing matched (confirmed usage) from weak/ambiguous (saved but separate).

---

## 6. Cryptographic / verifiable provenance on export bundles ✅ shipped (2026-05-13)

**Why it matters.** Reproducible export bundles (`bundle.tar.gz` with POSIX ustar + zero-mtime
gzip) already mean "what shipped in revision A is bit-for-bit recoverable." Adding a SHA-256
manifest + an optional detached signature converts the bundle into something a small medical,
aerospace, or defense shop can present to a customer or auditor. This is not a feature
DigiKey, Mouser, SnapEDA, or Altium 365 will ever ship.

**Shipped.**

- ✅ `infra/postgres/039_export_bundle_cryptographic_provenance.sql` adds `archive_sha256`,
  `manifest_sha256`, `signature_status` (CHECK-pinned to `unsigned`/`signed`/`verification_failed`),
  `signature_algorithm`, `signature_public_key_fingerprint`, `signature_storage_key`,
  `signature_signed_at`. The signature_status default is `'unsigned'` and the migration is
  idempotent across replays.
- ✅ `apps/worker/src/export-bundle-assembly.ts` computes archive + manifest SHA-256 after the
  deterministic gzip step (so identical inputs yield identical hashes), writes a
  `bundle.tar.gz.sha256` sidecar, and embeds a `manifest.json.sha256` entry inside the archive.
  When `EE_LIBRARY_BUNDLE_SIGNING_KEY` (Ed25519 PEM) is configured the worker also signs the
  lowercase-hex archive hash and writes a detached `bundle.tar.gz.sig` plus the public-key
  SHA-256 fingerprint.
- ✅ `apps/worker/src/export-bundle-verification.ts` exports `verifyAssembledExportBundle` —
  the inverse of assembly. It re-reads the archive, recomputes the hash, validates the Ed25519
  signature against `EE_LIBRARY_BUNDLE_VERIFICATION_KEY`, and returns one of `unsigned` /
  `signed` / `verification_failed` with a structured `reason` (`archive_hash_mismatch`,
  `signature_missing`, `verification_key_unavailable`, `verification_key_fingerprint_mismatch`,
  `signature_mismatch`, etc).
- ✅ Admin-gated `POST /export-bundles/:id/verify` route + `verifyExportBundleInDatabase`
  store helper persist the new signature_status (so list reads see the failure) and return
  `ExportBundleVerifyResponse` with the recorded vs recomputed hashes side-by-side. The
  recorded `archive_sha256` is intentionally never overwritten — it is the audit anchor.
- ✅ `ExportBundlePanel` per-row **Provenance** column (`BundleProvenanceCell`) renders the
  signature badge, truncated SHA-256 with full hash on hover, recorded signer fingerprint, an
  admin **Re-verify** action, and inline recovery copy keyed off the structured failure reason.

**Honesty rules.** A bundle without a signature is `unsigned`, not `verified`. A signature
mismatch is `verification_failed` with a structured reason, never silently suppressed. A
deployment without a verification key configured surfaces `verification_key_unavailable`
rather than pretending the bundle is unsigned. Resolving a verification failure preserves the
recorded hash so a project that downloaded the bundle while it was healthy remains auditable.

---

## 7. Data ownership as a marketed virtue

**Why it matters.** Self-hosting is already implicit in the codebase. Making it explicit —
"the entire engineering memory is in a Postgres database you own, and here is the one
command to get a portable archive" — directly addresses the single largest reason small teams
refuse SaaS PLMs: BOMs are sensitive and engineers do not want their internal trust scoring
living in someone else's tenant.

**Existing foundations.**

- `apps/api`, `apps/worker`, and `apps/web` are already deployment-portable.
- `infra/postgres` incremental migrations are deterministic and replayable.
- `npm run setup:dev` is honest about preflight (Docker check shipped 2026-05-08).
- `FileStorageClient` already abstracts local + not-configured backends and exposes
  `exists()` / `read()`.

**Concrete first slice.**

- Add a `npm run export:engineering-memory -- --out path.tar.gz` command in `apps/worker`
  that streams every internal table (projects, BOMs, parts, assets, evidence, circuit blocks,
  instantiations, follow-ups, approvals, validations, promotion audits, supply offers) plus
  the local storage prefix into a single deterministic archive — using the existing
  `tar-archive.ts` writer.
- Add a `npm run import:engineering-memory -- --in path.tar.gz --target-database-url=...`
  inverse command for the same archive shape.
- Document the round-trip in `README.md` and add a short doc page that names the schema
  versions covered by each archive.

**Honesty rules.** Never strip provenance during export. Never let an import silently
overwrite a row with different provenance — surface conflicts the same way the existing
multi-provider source reconciliation already does.

---

## Cross-cutting boundaries

These apply to every item above:

- Imported still does not mean approved; approved still does not mean export-ready.
- Generated assets remain `generated`, not `official`, no matter how confident the source.
- LLM and resolver outputs traverse the existing `imported → reviewed → approved →
  verified_for_export` gates without shortcuts.
- Reuse-friendly features must not silently invent catalog identity.
- Empty / loading / error / `setup_required` states stay explicit on every new surface.

## When something here ships

When work from this document lands, do all three:

1. Move the relevant subsection into `TODO.md` only while it is being actively built.
2. Add a row (or update an existing one) in
   [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) with explicit status.
3. Update or delete the subsection here so this file remains "forward direction, not shipped."
