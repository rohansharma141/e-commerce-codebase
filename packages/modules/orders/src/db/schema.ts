import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  char,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const ordersSchema = pgSchema('orders');

export const orders = ordersSchema.table(
  'orders',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: text('tenant_id').notNull(),
    status: text('status').notNull().default('created'),
    currency: char('currency', { length: 3 }).notNull(),
    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull(),
    discountCents: bigint('discount_cents', { mode: 'number' }).notNull().default(0),
    taxRateBps: integer('tax_rate_bps').notNull(),
    taxCents: bigint('tax_cents', { mode: 'number' }).notNull(),
    grandTotalCents: bigint('grand_total_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('orders_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

export const orderLines = ordersSchema.table(
  'order_lines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    qty: integer('qty').notNull(),
    lineTotalCents: bigint('line_total_cents', { mode: 'number' }).notNull(),
  },
  (t) => ({
    orderIdx: index('order_lines_order_idx').on(t.orderId),
  }),
);

export const orderPromotionSnapshot = ordersSchema.table('order_promotion_snapshot', {
  orderId: uuid('order_id')
    .primaryKey()
    .references(() => orders.id, { onDelete: 'cascade' }),
  promotionId: uuid('promotion_id').notNull(),
  kind: text('kind').notNull(),
  code: text('code'),
  actionType: text('action_type').notNull(),
  actionValue: bigint('action_value', { mode: 'number' }).notNull(),
  discountCents: bigint('discount_cents', { mode: 'number' }).notNull(),
});

export const idempotencyKeys = ordersSchema.table('idempotency_keys', {
  tenantId: text('tenant_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  orderId: uuid('order_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OrderRow = typeof orders.$inferSelect;
export type OrderLineRow = typeof orderLines.$inferSelect;
export type OrderPromotionSnapshotRow = typeof orderPromotionSnapshot.$inferSelect;
