/**
 * File header: Per-request tenant context.
 *
 * Carries the acting organization (orgId) through the call stack with AsyncLocalStorage so store
 * queries can scope by tenant without threading orgId through every function signature.
 *
 * Fail-closed discipline: a read with no org context naturally matches no rows (its `org_id = $orgId`
 * param is null, so the SQL equality is never true); a write calls requireRequestOrgId() and throws
 * when there is no tenant. handleRequest establishes the context for every HTTP request; tests set it
 * explicitly with runWithRequestContext.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { CatalogStoreError } from "./catalog-store";

/** RequestContext is the per-request state carried through the async call stack. */
interface RequestContext {
  /** Organization the request acts within, or null when unauthenticated / no tenant resolved. */
  orgId: string | null;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

/** Runs a function with the given tenant in scope for the duration of its async work. */
export function runWithRequestContext<T>(orgId: string | null, fn: () => T): T {
  return requestContext.run({ orgId }, fn);
}

/**
 * Test-only: binds the tenant for the remainder of the current async execution. Unit tests call a
 * synchronous harness helper at the top of each test body (createProjectMemoryPool); calling
 * enterWith there propagates the context to every subsequent awaited store call in that test without
 * wrapping each one in runWithRequestContext. Not used in production, where handleRequest wraps each
 * request with runWithRequestContext instead.
 */
export function enterRequestContextForTests(orgId: string | null): void {
  requestContext.enterWith({ orgId });
}

/** Reads the current request's organization, or null when there is no tenant context. */
export function getRequestOrgId(): string | null {
  return requestContext.getStore()?.orgId ?? null;
}

/**
 * Returns the current organization or throws when there is none. Use for writes, which must never
 * run without a tenant; reads instead use getRequestOrgId() directly so a null tenant fails closed
 * (matches no rows) rather than erroring.
 */
export function requireRequestOrgId(): string {
  const orgId = getRequestOrgId();
  if (!orgId) {
    throw new CatalogStoreError("query_failed", "No tenant context for this operation.", new Error("missing_org_context"));
  }
  return orgId;
}
