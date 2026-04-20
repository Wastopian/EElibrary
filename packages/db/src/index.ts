import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export * from "./schema.js";

export type DbPool = ReturnType<typeof createDbPool>;

export function createDbPool(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}
