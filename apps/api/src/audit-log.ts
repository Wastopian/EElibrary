/**
 * File header: Records and reads append-only audit events for user-driven mutations.
 *
 * The recording helper is defensive: it never throws and never blocks the originating
 * user action. Failures (DB unreachable, table missing) are logged to stderr so the
 * loss is visible without breaking the user experience. See docs/AUDIT_LOG_DESIGN.md.
 */

import type { IncomingMessage } from "node:http";
import { Pool, type PoolClient } from "pg";
import type { ApiSession } from "./auth";

/** AuditContext carries the actor and HTTP context for one mutation request. */
export type AuditContext = {
  actorUserId?: string | undefined;
  actorEmail?: string | undefined;
  actorRole?: string | undefined;
  actorIp?: string | undefined;
  actorUserAgent?: string | undefined;
  route?: string | undefined;
  requestId?: string | undefined;
  reason?: string | undefined;
};

/** AuditResultStatus narrows the recorded outcome to the constraint values. */
export type AuditResultStatus = "success" | "denied" | "failed";

/** AuditEventInput is the smallest shape callers need to record one event. */
export type AuditEventInput = {
  action: string;
  entityType: string;
  entityId: string;
  resultStatus: AuditResultStatus;
  beforeState?: unknown | undefined;
  afterState?: unknown | undefined;
};

/** AuditEvent describes one recorded row as returned from the read API. */
export type AuditEvent = {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  actorIp: string | null;
  actorUserAgent: string | null;
  action: string;
  entityType: string;
  entityId: string;
  resultStatus: AuditResultStatus;
  route: string | null;
  requestId: string | null;
  reason: string | null;
  beforeState: unknown;
  afterState: unknown;
};

/** AuditEventListFilters lets the admin view narrow the timeline. */
export type AuditEventListFilters = {
  actorEmail?: string | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  resultStatus?: AuditResultStatus | undefined;
  occurredSince?: string | undefined;
  occurredUntil?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
};

/** AuditEventListResult separates page data from total count for honest pagination. */
export type AuditEventListResult = {
  events: AuditEvent[];
  totalRecords: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const MAX_STATE_BYTES = 64 * 1024;
const TRUNCATED_PAYLOAD = { _truncated: true } as const;

let pool: Pool | null = null;

/**
 * Returns the audit pool, creating it on first use if DATABASE_URL is set.
 */
function getAuditPool(): Pool | null {
  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

/**
 * Builds an AuditContext from an incoming HTTP request and the verified session
 * (from requireAuth / requireAdmin). The actor identity comes from the JWT-verified
 * session — never from raw headers — so the audit log cannot be spoofed by a caller
 * that bypasses the web layer.
 *
 * When the session is null (anonymous read, or a path that does not require auth),
 * the actor is recorded as "system" by the recording helper.
 */
export function buildAuditContextFromRequest(request: IncomingMessage, session: ApiSession | null): AuditContext {
  return {
    actorUserId: session?.sub,
    actorEmail: undefined,
    actorRole: session?.role,
    actorIp: readClientIp(request),
    actorUserAgent: readHeader(request, "user-agent"),
    route: request.url ?? undefined,
    requestId: readHeader(request, "x-request-id")
  };
}

/**
 * Records one audit event. Returns immediately on any error — auditing must
 * never block or fail the originating user action. Errors are logged so the
 * loss is observable.
 */
export async function recordAuditEvent(context: AuditContext, event: AuditEventInput): Promise<void> {
  const auditPool = getAuditPool();

  if (!auditPool) {
    return;
  }

  let client: PoolClient | null = null;

  try {
    client = await auditPool.connect();
    await client.query(
      `
        INSERT INTO audit_events (
          actor_user_id,
          actor_email,
          actor_role,
          actor_ip,
          actor_user_agent,
          action,
          entity_type,
          entity_id,
          result_status,
          route,
          request_id,
          reason,
          before_state,
          after_state
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
      `,
      [
        context.actorUserId ?? null,
        context.actorEmail ?? "system",
        context.actorRole ?? null,
        context.actorIp ?? null,
        context.actorUserAgent ?? null,
        event.action,
        event.entityType,
        event.entityId,
        event.resultStatus,
        context.route ?? null,
        context.requestId ?? null,
        context.reason ?? null,
        toBoundedJson(event.beforeState),
        toBoundedJson(event.afterState)
      ]
    );
  } catch (error) {
    // Audit recording must never block. Log and continue.
    process.stderr.write(`audit-log: failed to record event ${event.action} on ${event.entityType}/${event.entityId}: ${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    client?.release();
  }
}

/**
 * Reads recent audit events for the admin view, with the supplied filters and pagination.
 */
export async function listAuditEventsFromDatabase(filters: AuditEventListFilters): Promise<AuditEventListResult | null> {
  const auditPool = getAuditPool();

  if (!auditPool) {
    return null;
  }

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(filters.pageSize ?? 50)));

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.actorEmail) {
    values.push(`%${filters.actorEmail.toLowerCase()}%`);
    conditions.push(`lower(COALESCE(u.email, a.actor_email)) LIKE $${values.length}`);
  }

  if (filters.action) {
    values.push(filters.action);
    conditions.push(`a.action = $${values.length}`);
  }

  if (filters.entityType) {
    values.push(filters.entityType);
    conditions.push(`a.entity_type = $${values.length}`);
  }

  if (filters.entityId) {
    values.push(filters.entityId);
    conditions.push(`a.entity_id = $${values.length}`);
  }

  if (filters.resultStatus) {
    values.push(filters.resultStatus);
    conditions.push(`a.result_status = $${values.length}`);
  }

  if (filters.occurredSince) {
    values.push(filters.occurredSince);
    conditions.push(`a.occurred_at >= $${values.length}`);
  }

  if (filters.occurredUntil) {
    values.push(filters.occurredUntil);
    conditions.push(`a.occurred_at <= $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const client = await auditPool.connect();

  try {
    // The audit table denormalizes actor_email at write time, but we LEFT JOIN users
    // for the live email so renames are visible. Actors from the system path show as
    // "system" via COALESCE.
    const totalResult = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM audit_events a
        LEFT JOIN users u ON a.actor_user_id = u.id
        ${whereClause}
      `,
      values
    );
    const totalRecords = Number.parseInt(totalResult.rows[0]?.count ?? "0", 10);
    const totalPages = totalRecords === 0 ? 1 : Math.max(1, Math.ceil(totalRecords / pageSize));

    const offset = (page - 1) * pageSize;
    const pageValues = [...values, pageSize, offset];

    const rowResult = await client.query(
      `
        SELECT
          a.id,
          a.occurred_at,
          a.actor_user_id,
          COALESCE(u.email, a.actor_email, 'system') AS actor_email,
          a.actor_role,
          a.actor_ip,
          a.actor_user_agent,
          a.action,
          a.entity_type,
          a.entity_id,
          a.result_status,
          a.route,
          a.request_id,
          a.reason,
          a.before_state,
          a.after_state
        FROM audit_events a
        LEFT JOIN users u ON a.actor_user_id = u.id
        ${whereClause}
        ORDER BY a.occurred_at DESC, a.id DESC
        LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}
      `,
      pageValues
    );

    const events: AuditEvent[] = rowResult.rows.map(mapRowToAuditEvent);

    return {
      events,
      totalRecords,
      page,
      pageSize,
      totalPages
    };
  } catch (error) {
    process.stderr.write(`audit-log: list query failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Maps one Postgres row into an AuditEvent for the admin view.
 */
function mapRowToAuditEvent(row: Record<string, unknown>): AuditEvent {
  const occurredAt = row["occurred_at"];

  return {
    id: String(row["id"]),
    occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : String(occurredAt ?? ""),
    actorUserId: row["actor_user_id"] === null || row["actor_user_id"] === undefined ? null : String(row["actor_user_id"]),
    actorEmail: row["actor_email"] === null ? null : String(row["actor_email"] ?? ""),
    actorRole: row["actor_role"] === null ? null : String(row["actor_role"] ?? "") || null,
    actorIp: row["actor_ip"] === null ? null : String(row["actor_ip"] ?? "") || null,
    actorUserAgent: row["actor_user_agent"] === null ? null : String(row["actor_user_agent"] ?? "") || null,
    action: String(row["action"]),
    entityType: String(row["entity_type"]),
    entityId: String(row["entity_id"]),
    resultStatus: String(row["result_status"]) as AuditResultStatus,
    route: row["route"] === null ? null : String(row["route"] ?? "") || null,
    requestId: row["request_id"] === null ? null : String(row["request_id"] ?? "") || null,
    reason: row["reason"] === null ? null : String(row["reason"] ?? "") || null,
    beforeState: row["before_state"] ?? null,
    afterState: row["after_state"] ?? null
  };
}

/**
 * Returns a JSON-safe payload bounded by MAX_STATE_BYTES so a runaway entity
 * cannot blow out the audit table. Truncated payloads keep their size for triage.
 */
function toBoundedJson(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }

  let serialized: string;

  try {
    serialized = JSON.stringify(value);
  } catch {
    return { _truncated: true, _reason: "non_serializable" };
  }

  if (serialized.length <= MAX_STATE_BYTES) {
    return value;
  }

  return { ...TRUNCATED_PAYLOAD, _size_bytes: serialized.length };
}

/**
 * Reads one trusted single-value HTTP header.
 */
function readHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value ?? undefined;
}

/**
 * Reads the requester IP from forwarded headers when present, falling back to socket.
 */
function readClientIp(request: IncomingMessage): string | undefined {
  const forwarded = readHeader(request, "x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim();
  }

  return request.socket?.remoteAddress ?? undefined;
}

/**
 * Resets the cached pool. Test-only — the API service shares one pool for its lifetime.
 */
export function __resetAuditPoolForTests(): void {
  pool = null;
}
