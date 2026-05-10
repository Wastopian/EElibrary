# Audit Log — Design

## Why

Every enterprise security review will ask "show me who did what and when." Today EE Library captures `created_by` on a few tables (e.g., `export_bundles`) but has no system-wide, queryable audit trail. The trust lineage already models the *engineering* trust chain (imported → reviewed → approved → verified for export). This design extends that spine to *user actions*.

Audit log is the foundation that unlocks:
- ECN/ECO workflow (every approval needs an attribution)
- RBAC enforcement traces (denied actions still get recorded)
- Document control (who superseded which datasheet revision)
- ITAR/EAR gating (every controlled-asset download must be logged)
- SOC 2 / CMMC compliance evidence

## Non-goals (v1)

- **Not** a full SIEM — events are queryable from the admin UI but not streamed to Splunk/Sentinel yet (later: webhook + opentelemetry exporter)
- **Not** cryptographically tamper-proof — append-only at the application layer first; chain hashing is a v2 hardening
- **Not** retention-policy-driven yet — events accumulate indefinitely; pruning policy comes when storage is a real concern
- **Not** instrumenting every mutation in v1 — the 6 highest-stakes operations first; expand iteratively

## Schema

```sql
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- actor (who)
  actor_user_id UUID REFERENCES users(id),  -- null for system / worker / script
  actor_email TEXT,                          -- denormalized so audit survives user deletion
  actor_role TEXT,                           -- snapshot of role at action time
  actor_ip TEXT,                             -- requester IP if known
  actor_user_agent TEXT,                     -- requester user agent

  -- action (what)
  action TEXT NOT NULL,                      -- e.g. 'project.create', 'asset.promote'
  entity_type TEXT NOT NULL,                 -- e.g. 'project', 'asset', 'review_record'
  entity_id TEXT NOT NULL,                   -- the affected entity id
  result_status TEXT NOT NULL,               -- 'success' | 'denied' | 'failed'

  -- context
  route TEXT,                                -- HTTP route that triggered, if any
  request_id TEXT,                           -- correlation id
  reason TEXT,                               -- optional explanation provided by the user

  -- payload
  before_state JSONB,                        -- previous entity state, if applicable
  after_state JSONB,                         -- new entity state after the action

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_occurred ON audit_events (occurred_at DESC);
CREATE INDEX idx_audit_events_actor    ON audit_events (actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_events_entity   ON audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_events_action   ON audit_events (action, occurred_at DESC);

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_result_status_check
  CHECK (result_status IN ('success', 'denied', 'failed'));
```

**Why this shape:**

- Append-only at the app layer (no UPDATE/DELETE handlers exposed). Postgres ROW LEVEL SECURITY for hardening comes later.
- `actor_email` denormalized so the audit record stands even if the user is deleted or renamed.
- `before_state` / `after_state` as JSONB so diffs work for arbitrary entities without schema churn.
- `result_status` separates "did X" from "tried X but was denied" — important for security review.
- Indexed for the common query patterns: timeline, by user, by entity, by action.

## Recording API

```typescript
// apps/api/src/audit-log.ts

export type AuditContext = {
  actorUserId?: string;
  actorEmail?: string;
  actorRole?: string;
  actorIp?: string;
  actorUserAgent?: string;
  route?: string;
  requestId?: string;
  reason?: string;
};

export type AuditEventInput = {
  action: string;
  entityType: string;
  entityId: string;
  resultStatus: "success" | "denied" | "failed";
  beforeState?: unknown;
  afterState?: unknown;
};

/**
 * Records one audit event. Never throws — audit failure must not block the user action.
 * If recording fails, logs to stderr so the loss is visible but the user request continues.
 */
export async function recordAuditEvent(
  context: AuditContext,
  event: AuditEventInput
): Promise<void>;

/**
 * Builds an AuditContext from an HTTP request by reading X-Actor-* headers and
 * the request's IP / user-agent. Returns a system context when no actor headers present.
 */
export function buildAuditContextFromRequest(request: IncomingMessage): AuditContext;
```

## Threading actor identity from web → API

Today the API service has no auth — it trusts whoever calls it. NextAuth lives only in the web layer. To get a meaningful "who" into the audit log without rewriting auth, the web layer passes the session user as headers when calling the API:

- `X-Actor-User-Id`
- `X-Actor-Email`
- `X-Actor-Role`
- `X-Request-Id` (optional correlation)

This is **not** authenticated cross-service auth. It's a pragmatic v1 that:
1. Surfaces user identity in the audit log immediately
2. Documents the boundary so it can be hardened later (signed JWT, mTLS)
3. Doesn't block any other work

`apps/web/src/lib/api-client.ts` becomes responsible for adding these headers when called from a server action with a NextAuth session in scope.

A follow-up task will replace the headers with a signed token. Tracked in design as a known gap.

## Action vocabulary (v1 set)

| Action | Entity type | When recorded |
|---|---|---|
| `project.create` | `project` | After successful `POST /projects` |
| `project.update` | `project` | After successful `PATCH /projects/:id` |
| `bom.import` | `bom_import` | After successful `POST /projects/:id/bom-imports` |
| `review.create` | `review_record` | After successful `POST /parts/:id/reviews` |
| `asset.promote` | `asset` | After successful `POST /parts/:id/assets/:assetId/promotion` |
| `generation.request` | `generation_request` | After successful `POST /parts/:id/generation-requests` |

The first 6 are the highest-stakes mutations: project lifecycle, BOM ingest, review sign-off, asset promotion to verified-for-export, and generation-request initiation. This is the smallest set that exercises the recording pipeline end to end and gives a meaningful first admin view.

## Admin UI — `/admin/audit-log`

A new page with:

- A timeline table (newest first): timestamp, actor email/role, action, entity (linked when possible), result, optional reason
- Filters: date range, actor (search by email), action (multi-select), entity type, result status
- Per-row expand: before/after JSONB diff (collapsed by default)
- Pagination (page-based; 50 per page)
- Empty state when no events match filters

Later: per-entity history strip (e.g., on `/parts/:id` show "12 events for this part" link → filtered audit log).

## Failure modes

| Failure | Behavior |
|---|---|
| `audit_events` table missing (DB not migrated) | Recording helper logs to stderr and returns; user action proceeds |
| Insert fails (DB down) | Recording helper logs to stderr and returns; user action proceeds |
| Actor headers missing | Recording helper records with `actor_user_id` null and `actor_email = "system"`; flags in audit view |
| `before_state` / `after_state` too large | Truncate JSONB to `{ "_truncated": true, "size_bytes": N }`; cap at ~64 KB per side |

## Out of scope for this PR

- Cryptographic chain hashing (v2)
- Webhook / streaming export to SIEM (v2)
- Retention policy + pruning (when storage matters)
- Per-entity audit history view on detail pages (next PR)
- Replacing X-Actor headers with signed JWT (next PR after that)
- Worker-originated mutations (worker doesn't run user actions in v1)

## Test plan

- Unit: `recordAuditEvent` survives DB outage, truncates large payloads, builds correct context from request
- Integration: instrumented routes write the expected audit row on success/failure paths
- View: admin page renders timeline, filters work, pagination works, empty state shows

## Files affected (this PR)

- `infra/postgres/033_audit_events.sql` — migration (new)
- `packages/db/src/schema.ts` — Drizzle table mapping
- `apps/api/src/audit-log.ts` — helper (new)
- `apps/api/src/audit-log.test.ts` — tests (new)
- `apps/api/src/audit-log-store.ts` — read API for the admin view (new)
- `apps/api/src/index.ts` — instrument routes + register `GET /admin/audit-log`
- `apps/web/src/lib/api-client.ts` — pass actor headers from session
- `apps/web/src/app/admin/audit-log/page.tsx` — admin view (new)
- `apps/web/src/app/admin/audit-log/page.test.ts` — admin view tests (new)
- `packages/shared/src/types.ts` — `AuditEvent` shape

Estimated total: 1 week of focused work for a developer; this PR aims for the schema, helper, 3 instrumented routes (project.create, asset.promote, review.create), and a minimal admin view as a working spine. Remaining instrumentations are mechanical and can land in follow-ups.
