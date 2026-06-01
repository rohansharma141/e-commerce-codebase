import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const pricingSchema = pgSchema('pricing');

export const tenantConfig = pricingSchema.table('tenant_config', {
  tenantId: text('tenant_id').primaryKey(),
  currency: char('currency', { length: 3 }).notNull(),
  taxRateBps: integer('tax_rate_bps').notNull().default(0),
  // Storefront branding (colors, brand name, etc). Nullable — falls back to
  // a hard-coded default theme in the read path so api-only customers
  // never have to populate this. See pricing/contracts/theme.dto.ts.
  theme: jsonb('theme').$type<Record<string, unknown> | null>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prices = pricingSchema.table(
  'prices',
  {
    tenantId: text('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('prices_tenant_product_pk').on(t.tenantId, t.productId),
    tenantIdx: index('prices_tenant_idx').on(t.tenantId),
  }),
);

export const promotions = pricingSchema.table(
  'promotions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: text('tenant_id').notNull(),
    kind: text('kind').notNull(),
    code: text('code'),
    conditionType: text('condition_type').notNull(),
    conditionValue: jsonb('condition_value').notNull().default(sql`'{}'::jsonb`),
    actionType: text('action_type').notNull(),
    actionValue: bigint('action_value', { mode: 'number' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    maxUses: integer('max_uses'),
    usesCount: integer('uses_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantKindActiveIdx: index('promotions_tenant_kind_active_idx').on(t.tenantId, t.kind, t.active),
  }),
);

export type TenantConfigRow = typeof tenantConfig.$inferSelect;
export type PriceRow = typeof prices.$inferSelect;
export type PromotionRow = typeof promotions.$inferSelect;
