# AGENTS.md

## Project
Build **EE Library**, an engineering-first platform for:
- part search
- normalized datasheet metrics
- footprint / symbol / 3D asset access
- export flows for Altium and SolidWorks
- project/BOM memory, reuse, and risk review
- team collaboration and governance (roles, audit, controlled change)
- future EE tools

The current direction is to become the **best tool for engineering teams**: take the shipped single-operator engineering memory and make it genuinely multi-engineer — shared, governed, accountable, concurrent. See `docs/ROADMAP.md` and `docs/IMPLEMENTATION_STATUS.md`.

## Non-negotiables
1. Keep `web`, `api`, and `worker` separated.
2. Keep provider-specific logic out of UI components.
3. Never present uncertain metadata as certain.
4. Export actions must reflect real file availability.
5. Preserve provenance for normalized fields and assets.
6. Prefer deterministic naming for bundles and assets.
7. Desktop-first UX. This is an engineering workstation, not a phone toy.
8. Authorization (who *may* act) and audit (what was *done*) are separate from, and never collapse, the trust lineage. Every new mutating path stays audited; access denies by default when a role or ACL does not grant.

## Priority order
1. Search and filtering
2. Component detail workspace
3. Asset registry and preview
4. Export adapters
5. Validation and trust scoring
6. Compare, BOM tools, and calculators
7. Team collaboration and governance — RBAC + scopes, OIDC SSO, multi-stage ECN/ECO, concurrency (foundation shipped: audit log, approval gate, document control, vendors)

## Definition of done
A feature is done only when:
- types are clean
- error/loading/empty states exist
- provenance is not lost
- UI is coherent
- the feature helps search -> inspect -> trust -> export
