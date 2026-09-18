import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Sql } from 'postgres';
import { DATABASE } from '@platform/shared/database';
import { EventBus } from '@platform/shared/event-bus';
import { ORDERS_EVENTS, type OrderCreatedPayload } from '@platform/modules/orders/contracts';

/**
 * Marks a channel as having transacted when an order is placed in it (C-17).
 *
 * `has_transacted` is what freezes `currency_code` (the rule itself is C-8a's
 * `currency.frozen`, already enforced by the service). Orders store money as
 * integers in the currency's minor units, so changing a channel's currency
 * after money has moved silently reinterprets every existing order — snapshots
 * protect how an order *renders*, not what it *aggregates to*. This consumer is
 * what connects the rule to real orders; before it, the flag never became true
 * and the rule could never fire.
 *
 * ── Why it binds the tenant from the EVENT, not from ambient context ──────
 *
 * The bus is asynchronous: `publish()` schedules each handler on a microtask
 * and returns, so checkout resolves — and the request's reserved, tenant-bound
 * connection can be released — BEFORE this handler's database work runs. The
 * first draft of this comment claimed the handler "happens to run within the
 * request"; the integration test disproved that on its first run, reading the
 * flag straight after checkout and finding it still false while this class's
 * own log line reported the mark. Reaching for the ambient connection here
 * would therefore be a race against its release: passing whenever the handler
 * wins, failing whenever the response closes first. The outbox's `enqueue`
 * documents the same trap.
 *
 * So this opens its own transaction and sets `app.tenant_id` from the event,
 * exactly as the outbox does. RLS still applies: an event for tenant A naming
 * tenant B's channel matches zero rows.
 *
 * The consequence for callers: the freeze is **eventually consistent**. There
 * is a window, microseconds to milliseconds wide, after an order commits in
 * which the channel's currency is still editable. Closing it would need the
 * mark inside checkout's transaction — a cross-module write, which the
 * architecture forbids — and the window only matters for a channel's very first
 * order racing an operator's currency edit.
 *
 * ── The event is sufficient on its own ───────────────────────────────────
 *
 * Since C-16a the order payload carries its channel snapshot, so which channel
 * transacted is in the event. No follow-up read into orders — which the
 * architecture forbids anyway.
 *
 * ── Idempotent, and self-healing ─────────────────────────────────────────
 *
 * The bus redelivers, so the UPDATE is conditional on `has_transacted = false`:
 * a second delivery matches zero rows and writes nothing, not even `updated_at`.
 *
 * The same condition gives a useful recovery property. Handler failures are
 * isolated by the bus — a failed mark must never fail a customer's checkout —
 * which means a dropped event leaves the channel unfrozen. But *every* later
 * order in that channel re-attempts the mark, so the gap lasts only until the
 * next order. The residual exposure is a channel whose only-ever order had its
 * event dropped; CAVEATS records it.
 *
 * ── `version` is deliberately NOT bumped ─────────────────────────────────
 *
 * This is not an operator edit. Bumping would hand an operator with the channel
 * open a `409` on their next save — even a rename — for a change they did not
 * conflict with. Without the bump a rename still succeeds, and a currency edit
 * gets the far more useful `400 currency.frozen`, which says what happened and
 * why rather than "someone else wrote first".
 */
@Injectable()
export class ChannelTransactedConsumer implements OnModuleInit {
  private readonly logger = new Logger(ChannelTransactedConsumer.name);

  constructor(
    @Inject(DATABASE) private readonly sql: Sql,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(ORDERS_EVENTS.Created, async (e) => {
      await this.handle(e.tenantId, e.payload as OrderCreatedPayload);
    });
  }

  /**
   * Returns what happened, so tests and a future observability point (C-25)
   * can tell a first mark from a redelivery:
   *
   *   - `marked`     — this order was the channel's first
   *   - `unchanged`  — already transacted, or no such channel for this tenant
   *                    (RLS makes the two indistinguishable, which is correct:
   *                    confirming another tenant's channel id exists would leak)
   *   - `no-channel` — an order that predates channels; nothing to mark
   */
  async handle(
    tenantId: string,
    payload: OrderCreatedPayload,
  ): Promise<'marked' | 'unchanged' | 'no-channel'> {
    const channelId = payload.order.channel?.channelId;
    if (!channelId) return 'no-channel';

    const result = await this.sql.begin(async (tx) => {
      // Transaction-local (`true`), so the binding cannot leak onto the pool.
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx`
        UPDATE channels.channels
           SET has_transacted = true,
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND id = ${channelId}::uuid
           AND has_transacted = false
      `;
    });

    if (result.count > 0) {
      this.logger.log(
        `channel ${channelId} (tenant ${tenantId}) has transacted; its currency is now frozen`,
      );
      return 'marked';
    }
    return 'unchanged';
  }
}
