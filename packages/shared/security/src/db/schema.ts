import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  index,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const auditSchema = pgSchema('audit');

export const auditLog = auditSchema.table(
  'audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: text('tenant_id').notNull(),
    actor: text('actor'),
    method: text('method').notNull(),
    path: text('path').notNull(),
    status: integer('status').notNull(),
    requestId: text('request_id').notNull(),
    bodySummary: jsonb('body_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

export type AuditLogRow = typeof auditLog.$inferSelect;

export const webhookOutbox = auditSchema.table(
  'webhook_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: text('tenant_id').notNull(),
    event: text('event').notNull(),
    productId: text('product_id'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** True when the worker gave up. Distinguishes a failure from a success:
     *  both set deliveredAt, only one of them is a dead letter. */
    exhausted: boolean('exhausted').notNull().default(false),
    /** How many times a sweep has re-driven this row. Bounded so a permanently
     *  unreachable consumer cannot make the sweep spin forever. */
    requeues: integer('requeues').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('webhook_outbox_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

export type WebhookOutboxRow = typeof webhookOutbox.$inferSelect;
