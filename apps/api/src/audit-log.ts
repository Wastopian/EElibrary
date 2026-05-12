/**
 * File header: Persists and reads general API user-action audit events.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { CatalogStoreError } from "./catalog-store";
import type {
  AuditActorRole,
  AuditEvent,
  AuditEventListResponse,
  AuditEventMetadata,
  AuditEventOutcome,
  AuditEventTargetType
} from "@ee-library/shared/types";

/** AUDIT_EVENT_BOUNDARY_COPY keeps reviewers clear on what is and is not persisted. */
export const AUDIT_EVENT_BOUNDARY_COPY =
  "Audit events record API action metadata, actor, target, outcome, and hashed source hints. They intentionally do not store request bodies, evidence bytes, passwords, tokens, or controlled document contents.";

/** AuditEventCreateInput is the safe route/action context accepted by the audit writer. */
export interface AuditEventCreateInput {
  requestId: string;
  actorId: string | null;
  actorRole: AuditActorRole | null;
  action: string;
  targetType: AuditEventTargetType;
  targetId: string | null;
  method: string;
  path: string;
  operation: string;
  statusCode: number;
  outcome: AuditEventOutcome;
  requestIpHash: string | null;
  userAgentHash: string | null;
  metadata: AuditEventMetadata;
}

/** AuditEventWriteResult reports whether an event was persisted or audit storage is unavailable. */
export type AuditEventWriteResult =
  | { status: "created"; eventId: string }
  | { status: "not_configured" };

/** AuditEventReadResult reports the recent event list for admin review. */
export type AuditEventReadResult =
  | { status: "available"; response: AuditEventListResponse }
  | { status: "not_configured" };

/** pool is initialized lazily so audit middleware does not require a database in tests. */
let pool: Pool | null = null;

/** auditLogPoolOverride lets tests share a pg-mem pool without touching DATABASE_URL. */
let auditLogPoolOverride: Pool | null | undefined;

/**
 * Overrides the audit-log pool for tests.
 */
export function setAuditLogPoolForTests(databasePool: Pool | null): void {
  auditLogPoolOverride = databasePool;
}

/**
 * Writes one API user-action audit event.
 */
export async function createAuditEventInDatabase(input: AuditEventCreateInput): Promise<AuditEventWriteResult> {
  const databasePool = getAuditLogDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  const eventId = randomUUID();

  try {
    await databasePool.query(
      `
        INSERT INTO audit_events (
          id,
          request_id,
          occurred_at,
          actor_id,
          actor_role,
          action,
          target_type,
          target_id,
          method,
          path,
          operation,
          status_code,
          outcome,
          request_ip_hash,
          user_agent_hash,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
      `,
      [
        eventId,
        input.requestId,
        new Date(),
        input.actorId,
        input.actorRole,
        input.action,
        input.targetType,
        input.targetId,
        input.method,
        input.path,
        input.operation,
        input.statusCode,
        input.outcome,
        input.requestIpHash,
        input.userAgentHash,
        JSON.stringify(input.metadata)
      ]
    );

    return { eventId, status: "created" };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Audit event write failed.", error);
  }
}

/**
 * Reads recent audit events for the admin workspace.
 */
export async function readAuditEventsFromDatabase(limit: number): Promise<AuditEventReadResult> {
  const databasePool = getAuditLogDatabasePool();

  if (!databasePool) {
    return { status: "not_configured" };
  }

  try {
    const result = await databasePool.query<DatabaseAuditEventRow>(
      `
        SELECT
          id,
          request_id,
          occurred_at,
          actor_id,
          actor_role,
          action,
          target_type,
          target_id,
          method,
          path,
          operation,
          status_code,
          outcome,
          request_ip_hash,
          user_agent_hash,
          metadata
        FROM audit_events
        ORDER BY occurred_at DESC, id DESC
        LIMIT $1
      `,
      [Math.max(1, Math.min(100, Math.trunc(limit)))]
    );

    const events = result.rows.map(mapAuditEventRow);

    return {
      response: {
        boundary: AUDIT_EVENT_BOUNDARY_COPY,
        events,
        state: events.length > 0 ? "available" : "empty"
      },
      status: "available"
    };
  } catch (error) {
    throw new CatalogStoreError("query_failed", "Audit event read failed.", error);
  }
}

/** DatabaseAuditEventRow is the persisted row shape for audit_events. */
interface DatabaseAuditEventRow {
  id: string;
  request_id: string;
  occurred_at: Date | string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  method: string;
  path: string;
  operation: string;
  status_code: number;
  outcome: string;
  request_ip_hash: string | null;
  user_agent_hash: string | null;
  metadata: unknown;
}

/**
 * Maps a database audit row into the shared API response shape.
 */
function mapAuditEventRow(row: DatabaseAuditEventRow): AuditEvent {
  return {
    action: row.action,
    actorId: row.actor_id,
    actorRole: toAuditActorRole(row.actor_role),
    id: row.id,
    metadata: toAuditEventMetadata(row.metadata),
    method: row.method,
    occurredAt: toIsoTimestamp(row.occurred_at),
    operation: row.operation,
    outcome: toAuditEventOutcome(row.outcome),
    path: row.path,
    requestId: row.request_id,
    requestIpHash: row.request_ip_hash,
    statusCode: Number(row.status_code),
    targetId: row.target_id,
    targetType: toAuditEventTargetType(row.target_type),
    userAgentHash: row.user_agent_hash
  };
}

/**
 * Lazily creates the Postgres pool when DATABASE_URL exists.
 */
function getAuditLogDatabasePool(): Pool | null {
  if (auditLogPoolOverride !== undefined) {
    return auditLogPoolOverride;
  }

  if (process.env.NODE_ENV === "test") {
    return null;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL
  });

  return pool;
}

/**
 * Converts database timestamps into ISO strings.
 */
function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Narrows stored actor roles without inventing authentication state.
 */
function toAuditActorRole(value: string | null): AuditActorRole | null {
  return value === "admin" || value === "user" ? value : null;
}

/**
 * Narrows stored outcomes while treating unknown future values as failed.
 */
function toAuditEventOutcome(value: string): AuditEventOutcome {
  if (value === "succeeded" || value === "denied") {
    return value;
  }
  return "failed";
}

/**
 * Narrows stored target labels while falling back to the generic API route target.
 */
function toAuditEventTargetType(value: string): AuditEventTargetType {
  const allowed: AuditEventTargetType[] = [
    "api_route",
    "asset",
    "bom_import",
    "circuit_block",
    "circuit_block_part",
    "document_revision",
    "evidence_attachment",
    "follow_up",
    "part",
    "project",
    "project_revision",
    "project_revision_approval_gate",
    "provider_acquisition_job",
    "provider_import",
    "substitution",
    "vendor"
  ];

  return allowed.includes(value as AuditEventTargetType) ? (value as AuditEventTargetType) : "api_route";
}

/**
 * Normalizes JSONB metadata to the safe scalar record exposed through the API.
 */
function toAuditEventMetadata(value: unknown): AuditEventMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const metadata: AuditEventMetadata = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null ||
      (Array.isArray(entry) && entry.every((item) => typeof item === "string"))
    ) {
      metadata[key] = entry;
    }
  }

  return metadata;
}
