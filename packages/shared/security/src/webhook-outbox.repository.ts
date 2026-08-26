import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import { DATABASE } from '@platform/shared/database';

export interface NewOutboxEntry {
  readonly tenantId: string;
  readonly event: string;
  readonly productId?: string | null;
}

export interface OutboxDelivery {
  readonly id: string;
  readonly tenantId: string;
  readonly event: string;
  readonly productId: string | null;
  readonly attempts: number;
}

interface OutboxRow {
  id: string;
  tenant_id: string;
  event: string;
  product_id: string | null;
  attempts: number;
}

/**
 * Persistence for pending storefront webhooks.
 *
 * Everything here runs outside a request — enqueues come from event-bus
 * subscribers, delivery from a timer — so nothing can rely on the
 * request-scoped tenant binding. Each method opens a transaction and sets the
 * GUC it needs locally, which keeps RLS in force without depending on ambient
 * context that may already be gone:
 *
 *   enqueue()  sets `app.tenant_id` from the event, so the insert is scoped to
 *              exactly the tenant the event belongs to.
 *
 *   claimDue() and the mark* methods set `app.system_worker`, because the
 *              worker legitimately spans tenants. See
 *              0004_webhook_outbox_rls.sql for why that setting exists and how
 *              narrow it is.
 *
 * `true` as set_config's third argument scopes the setting to the transaction,
 * so it can't leak onto a pooled connection that later serves something else.
 *
 * Raw SQL rather than Drizzle because claiming work needs `FOR UPDATE SKIP
 * LOCKED` inside a subquery. That is the whole point: two api instances
 * polling the same table must never claim the same row, and neither should
 * block waiting on the other.
 */
@Injectable()
export class WebhookOutboxRepository {
  constructor(@Inject(DATABASE) private readonly sql: Sql) {}

  /**
   * Queue a webhook for delivery.
   *
   * Binds the tenant explicitly instead of inheriting the request's reserved
   * connection, because the caller is an event-bus subscriber and by the time
   * it runs the originating request is usually over — the indexer waits for
   * the search index to become readable before announcing, which takes up to a
   * refresh interval, and the reserved connection is released when the
   * response closes. Reaching for the request's connection here would work in
   * a test and fail intermittently in production, which is the worst
   * combination.
   *
   * The tenant still comes from the event, RLS still applies to the insert,
   * and `true` keeps the setting transaction-local so it cannot leak onto the
   * pooled connection.
   */
  async enqueue(entry: NewOutboxEntry): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${entry.tenantId}, true)`;
      await tx`
        INSERT INTO audit.webhook_outbox (tenant_id, event, product_id)
        VALUES (${entry.tenantId}, ${entry.event}, ${entry.productId ?? null})
      `;
    });
  }

  /**
   * Atomically take up to `limit` due deliveries, incrementing attempts as
   * part of the claim so a crash between claiming and delivering still counts
   * as a try rather than looping forever on the same row.
   *
   * Pushing `next_attempt_at` forward during the claim doubles as a visibility
   * timeout: if this process dies mid-delivery the row becomes eligible again
   * after the backoff instead of being stuck claimed.
   */
  async claimDue(limit: number, backoffSeconds: number): Promise<OutboxDelivery[]> {
    const rows = await this.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.system_worker', 'on', true)`;
      return tx<OutboxRow[]>`
        UPDATE audit.webhook_outbox
           SET attempts = attempts + 1,
               next_attempt_at = now() + ${backoffSeconds}::int * interval '1 second'
         WHERE id IN (
           SELECT id
             FROM audit.webhook_outbox
            WHERE delivered_at IS NULL
              AND next_attempt_at <= now()
            ORDER BY next_attempt_at
            FOR UPDATE SKIP LOCKED
            LIMIT ${limit}
         )
        RETURNING id, tenant_id, event, product_id, attempts
      `;
    });

    return (rows as unknown as OutboxRow[]).map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      event: r.event,
      productId: r.product_id,
      attempts: r.attempts,
    }));
  }

  async markDelivered(id: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.system_worker', 'on', true)`;
      await tx`
        UPDATE audit.webhook_outbox
           SET delivered_at = now(), last_error = NULL
         WHERE id = ${id}
      `;
    });
  }

  /** Records the failure and schedules the next attempt. */
  async markFailed(id: string, error: string, retryInSeconds: number): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.system_worker', 'on', true)`;
      await tx`
        UPDATE audit.webhook_outbox
           SET last_error = ${error.slice(0, 500)},
               next_attempt_at = now() + ${retryInSeconds}::int * interval '1 second'
         WHERE id = ${id}
      `;
    });
  }

  /**
   * Gives up on a delivery. Marked delivered so it stops being retried, and
   * flagged exhausted so the sweep can tell it apart from one that actually
   * arrived, with the reason preserved — a row with `delivered_at` set and `last_error`
   * populated is the record of a webhook that never made it, which is exactly
   * what you want to be able to query after an incident.
   */
  async markExhausted(id: string, error: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.system_worker', 'on', true)`;
      await tx`
        UPDATE audit.webhook_outbox
           SET delivered_at = now(),
               exhausted = true,
               last_error = ${`gave up after retries: ${error}`.slice(0, 500)}
         WHERE id = ${id}
      `;
    });
  }

  /**
   * Re-drive dead letters.
   *
   * The worker's give-up is deliberate — six attempts over roughly two
   * minutes is the right patience for a redeploy, not for an outage. What was
   * missing is the other half: an outage longer than that used to leave rows
   * that nothing would ever retry, recoverable only by hand.
   *
   * Resets the row to pending and counts the re-queue. The count is the point:
   * a consumer that is gone for good stops being chased after `maxRequeues`
   * rounds, so this recovers from downtime without becoming an infinite
   * retry loop wearing a different name.
   */
  async sweepExhausted(maxRequeues: number, limit: number): Promise<number> {
    const rows = await this.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.system_worker', 'on', true)`;
      return tx<Array<{ id: string }>>`
        UPDATE audit.webhook_outbox
           SET delivered_at = NULL,
               exhausted = false,
               attempts = 0,
               requeues = requeues + 1,
               next_attempt_at = now()
         WHERE id IN (
           SELECT id
             FROM audit.webhook_outbox
            WHERE exhausted
              AND requeues < ${maxRequeues}
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT ${limit}
         )
        RETURNING id
      `;
    });
    return (rows as unknown as Array<{ id: string }>).length;
  }
}
