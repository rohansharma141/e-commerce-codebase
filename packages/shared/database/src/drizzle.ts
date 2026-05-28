import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PostgresClient } from './pool';

export type DrizzleClient = PostgresJsDatabase<Record<string, never>>;

export function createDrizzle(sql: PostgresClient): DrizzleClient {
  return drizzle(sql);
}
