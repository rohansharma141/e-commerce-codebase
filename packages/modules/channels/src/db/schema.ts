import {
  boolean,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle mirror of `0001_init.sql`.
 *
 * The SQL is the source of truth — migrations are hand-written here, not
 * generated — so this file exists to give the repository typed column
 * references, not to define the tables. Anything added to one must be added to
 * the other; the two are kept honest by the repository failing to compile
 * against a column that does not exist here, and by the migration failing to
 * apply against a database where it does not.
 */
export const channelsSchema = pgSchema('channels');

export const tenantDefaults = channelsSchema.table('tenant_defaults', {
  tenantId: text('tenant_id').primaryKey(),
  currencyCode: text('currency_code').notNull(),
  defaultLocale: text('default_locale').notNull(),
  supportedLocales: text('supported_locales').array().notNull(),
  country: text('country').notNull(),
  timezone: text('timezone').notNull(),
  taxDisplay: text('tax_display').$type<'gross' | 'net'>().notNull(),
  taxRateBps: integer('tax_rate_bps'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const channels = channelsSchema.table(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    status: text('status').$type<'draft' | 'active' | 'archived'>().notNull().default('draft'),
    isDefault: boolean('is_default').notNull().default(false),
    hasTransacted: boolean('has_transacted').notNull().default(false),
    version: integer('version').notNull().default(1),

    // null means inherit from tenantDefaults
    currencyCode: text('currency_code'),
    defaultLocale: text('default_locale'),
    supportedLocales: text('supported_locales').array(),
    country: text('country'),
    timezone: text('timezone'),
    taxDisplay: text('tax_display').$type<'gross' | 'net'>(),
    taxRateBps: integer('tax_rate_bps'),

    externalRef: text('external_ref'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantKeyUnique: uniqueIndex('channels_tenant_key_unique').on(t.tenantId, t.key),
    // NOTE: `channels_one_default_per_tenant` is a PARTIAL unique index
    // (`WHERE is_default`) and is intentionally absent here. Drizzle would
    // describe it without the predicate, which would read as "one channel per
    // tenant" — a materially wrong constraint for anyone using this file to
    // understand the schema. The real definition is in 0001_init.sql.
  }),
);

export type ChannelRow = typeof channels.$inferSelect;
export type TenantDefaultsRow = typeof tenantDefaults.$inferSelect;
