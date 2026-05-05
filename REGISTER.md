# Working-tree and worktree register

## 2026-05-03

### Git worktrees

- Before cleanup, `git worktree list` reported two auxiliary entries under `.claude/worktrees/` (`happy-poincare-43d3a0`, `mystifying-dhawan-8404d0`) marked **prunable** because the linked directories were gone from disk.
- Ran `git worktree prune -v`; those registration entries were removed.
- **Canonical tree**: `C:/Users/might/Documents/Projects/EE`, branch `codex/fix-catalog-repository-typecheck`, HEAD `7d92db8`.
- No other local worktrees were present after prune; all in-flight work for this date is in that single working tree (including uncommitted changes).

### Working tree snapshot (2026-05-03)

Uncommitted and untracked work registered in git status at register time includes, in summary:

- **API / DB**: `apps/api/src/index.ts`, `project-memory-store.ts`, migration smoke and store tests; `packages/db/src/schema.ts`; incremental SQL `infra/postgres/025`–`030` (project health evidence, circuit blocks, follow-ups, export bundles, instantiation, part substitutions).
- **Web**: new areas under `apps/web/src/app/` for `circuit-blocks`, `evidence`, `where-used`; project/part pages, navigation, globals; panels for BOM diagnostics/match, circuit blocks, evidence vault, export bundles, follow-ups, substitutions, project edit; `api-client` and BOM import updates.
- **Shared**: `packages/shared` types and BOM CSV (including XLSX-related packaging); `scripts/__tests__/migrations.test.mjs` and lockfile updates.

### Follow-ups

- If public docs drift from shipped behavior, align `README.md` with `docs/IMPLEMENTATION_STATUS.md` (source of truth); active tasks stay in root `TODO.md`.
