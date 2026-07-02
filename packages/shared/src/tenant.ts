/**
 * File header: Tenant id helpers shared by the API and worker.
 *
 * Multi-tenancy stamps every team-data row with an `org_id`, but several entity ids are also derived
 * deterministically from a natural key (a project key, a circuit-block key, a provider part key). Those
 * ids are the primary key, so two different orgs deriving the same natural key would collide. This
 * namespaces such ids per tenant — while keeping the historical unprefixed form for `org-default` so
 * every existing row, foreign-key reference, and deterministic re-import/refresh keeps matching.
 */

/** DEFAULT_ORG_ID is the tenant every existing user and pre-multi-tenant row belongs to. */
export const DEFAULT_ORG_ID = "org-default";

/**
 * Namespaces a deterministically-derived entity id to its owning org so two tenants that derive the
 * same natural key never collide on a primary key.
 *
 * `org-default` keeps the legacy (unprefixed) id for backward compatibility: existing rows, the
 * foreign keys pointing at them, and deterministic `ON CONFLICT` re-imports all continue to resolve to
 * the same id. Every other org gets an `<orgId>__<legacyId>` id. The result is used verbatim as a
 * primary key / URL path segment — never re-slugified — so the separator stays intact.
 */
export function scopeEntityId(orgId: string, legacyId: string): string {
  return orgId === DEFAULT_ORG_ID ? legacyId : `${orgId}__${legacyId}`;
}
