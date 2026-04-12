# AGENTS.md

## Project
Build **EE Library**, an engineering-first platform for:
- part search
- normalized datasheet metrics
- footprint / symbol / 3D asset access
- export flows for Altium and SolidWorks
- future EE tools

## Non-negotiables
1. Keep `web`, `api`, and `worker` separated.
2. Keep provider-specific logic out of UI components.
3. Never present uncertain metadata as certain.
4. Export actions must reflect real file availability.
5. Preserve provenance for normalized fields and assets.
6. Prefer deterministic naming for bundles and assets.
7. Desktop-first UX. This is an engineering workstation, not a phone toy.

## Priority order
1. Search and filtering
2. Component detail workspace
3. Asset registry and preview
4. Export adapters
5. Validation and trust scoring
6. Compare, BOM tools, and calculators

## Definition of done
A feature is done only when:
- types are clean
- error/loading/empty states exist
- provenance is not lost
- UI is coherent
- the feature helps search -> inspect -> trust -> export
