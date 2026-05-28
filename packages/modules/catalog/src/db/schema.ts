import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const catalogSchema = pgSchema('catalog');

export const attributeDefinitions = catalogSchema.table(
  'attribute_definitions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: text('tenant_id').notNull(),
    code: text('code').notNull(),
    type: text('type').notNull(),
    multiValue: boolean('multi_value').notNull().default(false),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('attribute_definitions_tenant_idx').on(t.tenantId),
    tenantCodeUnique: uniqueIndex('attribute_definitions_tenant_code_unique').on(t.tenantId, t.code),
  }),
);

export const products = catalogSchema.table(
  'products',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: text('tenant_id').notNull(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    attributes: jsonb('attributes').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('products_tenant_idx').on(t.tenantId),
    tenantSkuUnique: uniqueIndex('products_tenant_sku_unique').on(t.tenantId, t.sku),
  }),
);

export type AttributeDefinitionRow = typeof attributeDefinitions.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
