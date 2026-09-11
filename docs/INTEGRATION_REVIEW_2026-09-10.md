# Pending fixes integration review — 2026-09-10

Reviewed and combined GitHub PRs #111–#123 from `f574dd8`, preserving their commit ancestry.
The `web`, `api`, and `worker` boundaries remain intact. Existing local navigation, catalog,
styling, and server documentation edits are separate from this integration.

| PR | Integrated behavior |
| --- | --- |
| #111 | Team invites and administration use the live account role; token issuance reflects demotion. |
| #112 | Abandoned provider imports return to the queue; active imports send heartbeats. |
| #113 | Provider imports return and look up the requesting team's stored IDs. |
| #114 | Worker validation evidence and generated drafts inherit their part's team. |
| #115 | Raw storage downloads require a reference owned by the requesting team. |
| #116 | Audit reads and supplier notebook folders are scoped to the requesting team. |
| #117 | Export workers claim pending bundles; the UI waits for completed, available archives. |
| #118 | Sparse imports preserve package measurements and datasheet extraction results; trailing pin counts take precedence. |
| #119 | SI prefixes and scientific notation survive metric normalization; Octopart shares the parser. |
| #120 | Automated readiness refreshes preserve recorded human approval decisions. |
| #121 | Two teams can queue the same provider part independently. |
| #122 | Duplicate detection and affected-part refreshes stay within one team. |
| #123 | Bulk approval supplies the team ID required by row-level security. |

## Corrections made during review

- **Cookie-only privilege bypass:** preserving an incoming bearer token alone did not fix
  direct proxy requests. Middleware now runs on Node.js and checks the live account before
  routing admin pages or minting proxy tokens. Missing accounts and lookup failures fail
  closed. The lookup reuses a single pool instead of allocating one on every session read.
- **Stale export writer:** `assembly_status = 'assembling'` did not identify which worker
  owned a reclaimed job. Claiming now increments `assembly_attempt_count`; completion must
  match that number. Bytes go to `export-bundles/<project>/<bundle>/attempt-<number>/`, so a
  resumed worker cannot overwrite a newer archive. Jobs are claimed immediately before
  processing. The regression test pauses two actual assembly calls and resumes the older
  one while the newer claim is still active.
- **Test merge conflict:** retained both abandoned-import recovery and independent-team
  queue regressions from #112 and #121.

## Database update

Apply migrations before restarting the API and worker. Stop older workers during the update:
they do not understand numbered claims or the `assembling` state.

The new files are `062_acquisition_jobs_org_unique.sql`, `062_audit_events_org_id.sql`, and
`063_export_bundle_assembly_claim.sql`. Both `062` filenames are retained deliberately:
migrations are ordered and recorded by their full filename, not the numeric prefix. Renaming
an already-applied branch migration would give it a new identity. The two migrations are
independent and were applied together, followed by a no-op second migration run.

Existing archives remain readable at their stored paths. New assembly attempts use numbered
directories. Interrupted or superseded attempts can leave unreferenced files; this change
does not delete them automatically. Import recovery uses a 15-minute heartbeat timeout;
export recovery uses a 30-minute claim timeout. API bearer tokens already issued retain
their existing 30-second lifetime.

## Validation

- TypeScript checks and production Next.js build.
- Repository unit and script tests, including live-role and overlapping-export regressions.
- Full SQL migration sequence on an isolated PostgreSQL 17 database, then a no-op rerun.
- Live API smoke against a non-owner, non-superuser role without RLS bypass: search,
  project BOM, where-used, project files, interconnects, and cross-team isolation.
- Targeted real-Postgres checks: two teams queue the same provider key, bulk approval
  records a human decision, foreign audit rows are hidden, and raw file downloads allow
  owned bytes while returning 404 for the same key from another team.

These checks do not constitute deployment or a complete browser/production Docker review.
The user's existing database and stored engineering files were not migrated or altered.
