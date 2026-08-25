import { sql } from 'drizzle-orm';
import { jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

export const brandingSchema = pgSchema('branding');

/**
 * One row per tenant. The theme stays a jsonb blob rather than typed columns:
 * every field is presentational, all of them have defaults in the contract,
 * and adding one should not need a migration.
 */
export const theme = brandingSchema.table('theme', {
  tenantId: text('tenant_id').primaryKey(),
  theme: jsonb('theme').$type<Record<string, unknown> | null>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ThemeRow = typeof theme.$inferSelect;
