/**
 * Placeholder for the shared DB connection. The actual ORM is deliberately not
 * chosen yet (DECISIONS D-09 "left open"); step 2 picks Prisma or Drizzle
 * against real query patterns and wires the connection here. Modules access
 * the DB through repositories that depend on this token, never via direct
 * client imports — that's how we keep the ORM swappable.
 */
export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');

export interface DatabaseConnection {
  readonly url: string;
}
