# Commercial Roadmap

This document is the **commercial / enterprise-facing** roadmap for EE Library. It is separate from `docs/ROADMAP.md`, which tracks internal product priorities and team-facing direction. This file captures the path from the current open-source-style codebase to an enterprise product that defense-adjacent engineering organizations (Tier-2/3 defense subcontractors, defense startups, contract design houses, university programs, and eventually primes like Leidos) would buy.

---

## Strategic frame

EE Library's wedge is **opinionated trust + cross-discipline approachability + clean modern UX**. Most legacy PLM is genuinely terrible to use, and engineers hate it. A modern, opinionated tool that engineers actually like will pull users away from incumbents — slowly, but durably.

Two sales motions, one product:

- **Replacement** for greenfield programs, defense Tier-2/3 subs, defense startups (Anduril/Shield AI/Saronic/etc.), contract design houses, and university programs that currently live in spreadsheets + Arena or want out of legacy PLM.
- **Augmentation** for primes (Leidos, Lockheed, Northrop, Raytheon) where Teamcenter or Windchill is the system of record. Position EE Library as a guardrail layer or "the readable face of the parts library" alongside the PLM. Same product, different talk track.

The integrations (PLM bridges, CAD round-trips, ERP exports) serve both audiences — they let us coexist with Teamcenter when we have to, and they prove we handle real engineering data when we don't.

---

## Wedge features (win the demo)

These are visible, demo-able, and differentiate us from incumbents in a 30-minute call.

| Feature | Why it wins | Rough size |
|---|---|---|
| **Versioned BOMs with side-by-side diff + approval gate** | Visceral, demo-able, makes "trust" visible. Builds on existing revision foundation. | 1–2 months for first-class |
| **Live distributor data (Octopart)** | Closes the embarrassing "Pricing and stock are not shown here" gap. Octopart has a clean GraphQL API and fits the existing provider adapter pattern. | 3–4 weeks read-only |
| **Concurrent editing baseline** | Modern delight that contrasts viscerally with Excel/Teamcenter. Optimistic locking + presence indicators ("Sarah is viewing this") + WebSocket-pushed updates is enough for v1 — we don't need full Figma-style CRDTs. | 1–2 months |
| **ECN/ECO with multi-stage approval and redline diffs** | This is the workflow engineers complain about most in legacy PLM. A clean modern version is a real "wow" moment. | 2–3 months |

## Foundation features (close the deal)

These get raised in security review and procurement; without them the demo doesn't matter.

| Feature | Why it matters | Rough size |
|---|---|---|
| **Audit log with foundation middleware** | #1 thing security reviewers check. Trust lineage already gives the conceptual spine. Unlocks RBAC enforcement, ECN/ECO, document control, ITAR gating. | 1 week foundation; ongoing instrumentation |
| **Document control with revision history & supersession** | Datasheets and drawings need controlled-access ACLs, expiry, "this rev replaces rev X" linkage. Asset model already has the bones. | 1 month |
| **Real ECAD library** (KiCad first, then Altium) | KiCad is fastest path — open format, growing defense adoption. Altium needs Concord Pro source integration; larger lift but defense is mostly Altium. | KiCad emission: 1 mo. KiCad round-trip: 3 mo. Altium Concord Pro: 3–6 mo. |
| **SolidWorks add-in** | C# add-in using the SolidWorks API. New skill set on the team. The add-in pulls verified parts with metadata into the active design. | 3–4 mo (experienced SW dev), 6+ (learning) |
| **PLM bridge — start with Aras** | Aras has the most modern REST/OData of the big three. Mapping schemas is the hard part. | 2–3 mo for read+write OData adapter |
| **ERP export — start with structured CSV** | A well-structured AVL/BOM export that ERP teams can swallow buys 80% of the value at 10% of the cost vs SAP IDoc integration. | 2–4 weeks CSV; 2–3 mo for IDoc later |
| **Requirements traceability (Jama first)** | Jama has the cleanest modern REST API. DOORS NG, Polarion, Codebeamer are spec-checkbox follow-ups. | 1–2 mo Jama read-only linkage |
| **OIDC SSO** (Okta, Azure AD, Ping) | Every enterprise sale gates on this. NextAuth supports OIDC; this is config + hardening. | 1–2 weeks for basic; weeks more to harden |
| **RBAC expansion** | Beyond `admin | user`. Need viewer / contributor / reviewer / approver / exporter, plus per-project / per-program scopes. | 3–4 weeks |
| **ITAR/EAR classification fields with download gating** | Defense-specific table-stakes. First-class part classification, foreign-person flag, download acknowledgment, audit trail. | 2–3 weeks |

---

## 12-month sequenced plan

Assumes a small team: founder + 1–2 senior engineers + part-time integrations contractor for the SolidWorks/Altium work.

### Months 1–3 — "It's real"

- Versioned BOM diff + approval gate
- Octopart live distributor data
- Audit log foundation (every mutation: who/when/what/why)
- Concurrent editing baseline (optimistic locking + presence indicators)

**Outcome**: a first demo that doesn't have the "Pricing not shown" hole and shows the trust workflow in motion. Suitable for first design partner conversations.

### Months 4–6 — "It's deep"

- ECN/ECO workflow with multi-stage approvals, redlines, effectivity dates
- Document control with supersession and access tiers
- KiCad library emission (deterministic .kicad_sym / .kicad_mod / .step)

**Outcome**: a real engineering change can run end-to-end. KiCad users can pull verified libraries. Worthy of a paid pilot at a defense Tier-2.

### Months 7–9 — "It plays well with others"

- SolidWorks add-in (basic — pull verified STEP into active design with metadata)
- Aras OData bridge (read+write, mirror part records)
- Jama requirements traceability (link parts to requirements)

**Outcome**: can sit next to the incumbent stack at a Tier-2 defense customer. Augmentation pitch is concrete.

### Months 10–12 — "It survives security review"

- ITAR/EAR classification fields with download gating
- OIDC SSO (Okta, Azure AD, Ping)
- RBAC expansion (viewer / contributor / reviewer / approver / exporter)
- SOC 2 Type II prep starts (~6 months runway after this)
- ERP CSV export

**Outcome**: can hand a security questionnaire to a prime and not get bounced. SOC 2 attestation in motion.

### Beyond 12 months

Sequence depends on first-customer pull:

- Altium Concord Pro integration (defense-heavy)
- Teamcenter bridge (the harder one)
- Polarion / DOORS NG / Codebeamer requirements integrations
- KiCad round-trip (engineers commit changes back)
- SAP IDoc integration
- FedRAMP Moderate (only if hosting customer data; on-prem sidesteps this)
- CMMC 2.0 Level 2/3 readiness assessment

---

## Highest-leverage next single piece

**Audit log middleware + foundation**.

- Small (1 week of focused work)
- Unlocks every later feature: ECN/ECO, RBAC enforcement, document control, ITAR gating
- #1 thing security reviewers check
- Trust lineage already gives the conceptual spine — extending it to user actions is the natural next step

After that, in order of leverage:

1. **Octopart provider adapter** — closes the most embarrassing gap, fits the existing pattern, ~3 weeks
2. **BOM revision diff + approval gate** — extends an existing surface, demo-ready, ~3 weeks
3. **Optimistic locking + presence indicators** — modern feel, prevents data loss, ~3 weeks

---

## Compliance ladder (for reference)

These are not on the build roadmap directly but gate certain customers.

| Tier | Required | Cost / time |
|---|---|---|
| **Self-host (on-prem)** | Documented install, FIPS-validated crypto option | Built-in once packaged |
| **Hosted commercial** | SOC 2 Type II | 6–12 months, ~$30–60k/audit cycle |
| **Defense subcontractor** | NIST 800-171, DFARS 252.204-7012, CMMC 2.0 L2 | 6–12 months program work |
| **DoD / classified** | CMMC 2.0 L3, on-prem only, FIPS | Multi-year |
| **Government cloud hosting** | FedRAMP Moderate or High | 1–2 years, multi-million $ |

Most B2B sales sidestep FedRAMP by selling on-prem only.

---

## What we are not building (intentionally)

These are out of scope to keep the wedge sharp:

- **Schematic capture / PCB layout**. KiCad and Altium do this; we feed them.
- **3D CAD authoring**. SolidWorks/Creo/NX do this; we feed them.
- **Procurement automation**. ERP does this; we export to it.
- **Requirements authoring**. Jama/DOORS do this; we link to them.
- **Project management / scheduling**. Jira/Confluence/MS Project do this; out of scope.

The product is the **opinionated, trust-first parts and BOM record** that bridges these systems with engineers who currently bridge them by hand.

---

## Outstanding strategic questions

To resolve before serious commercialization:

1. **Pricing unit** — per program, per seat, per part record, per export? Probably hybrid (named-user seats + program tiers).
2. **Open source vs proprietary** — open core (Apache 2.0 kernel, commercial enterprise edition) is the GitLab/Mattermost/Sentry path and probably the highest-leverage option for a small team. Builds developer credibility and creates a moat that legacy PLM cannot easily copy.
3. **Hosting posture** — on-prem only, hosted only, or both? On-prem first sidesteps FedRAMP but raises support cost.
4. **First design partner profile** — defense Tier-2 contract design house is the most plausible first paid customer; defense startup is more aligned with the modern UX pitch.
5. **Sales hire timing** — typically after 3–5 design-partner customers prove the pitch.

---

*This document should be reviewed quarterly. Feature sizes are educated guesses and will calibrate as work begins.*
