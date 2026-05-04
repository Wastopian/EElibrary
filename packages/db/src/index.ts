/**
 * File header: Exposes the shared database schema and pool factory for source-transpiled workspace consumers.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export * from "./schema";

export type DbPool = ReturnType<typeof createDbPool>;

/**
 * createDbPool wires the shared Drizzle schema into a pooled Postgres client for app and worker callers.
 */
export function createDbPool(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}
