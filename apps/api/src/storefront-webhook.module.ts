import {
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EventBus, type DomainEvent } from '@platform/shared/event-bus';
import {
  WebhookOutboxRepository,
  type OutboxDelivery,
} from '@platform/shared/security';
import {
  SEARCH_EVENTS,
  type ProductIndexedPayload,
  type ProductRemovedPayload,
} from '@platform/modules/search/contracts';
import {
  PRICING_EVENTS,
  type PromotionCreatedPayload,
  type PromotionUpdatedPayload,
  type TenantConfigUpdatedPayload,
} from '@platform/modules/pricing/contracts';

/**
 * Webhook dispatcher for storefront revalidation.
 *
 * Subscribes to search.product.{indexed,removed} and the tenant-wide pricing
 * events on the in-process bus, and POSTs a small event-shaped payload to the
 * storefront's `/api/revalidate` endpoint. The storefront knows how to map the
 * event type into Next.js cache-tag invalidations — this side stays semantic
 * and never learns the storefront's cache topology.
 *
 * Configuration via env:
 *
 *   STOREFRONT_REVALIDATE_URL     — e.g. http://storefront:3001/api/revalidate
 *                                   (or http://host.docker.internal:3001/...
 *                                   when api is containerised but storefront runs on host).
 *                                   When unset, this service is a no-op so
 *                                   api-only deployments don't try to call out.
 *   STOREFRONT_REVALIDATE_SECRET  — Bearer token shared with the storefront.
 *
 * Delivery goes through a transactional outbox rather than an inline POST.
 * The subscriber writes a row saying a webhook is owed; WebhookOutboxWorker
 * below delivers it with exponential backoff. Two things that were previously
 * untrue become true: a storefront that is briefly unreachable no longer means
 * a permanently stale page (it means a retried delivery), and a webhook that
 * never arrived leaves a record saying so instead of a log line that scrolled
 * away.
 *
 * A failed enqueue still never fails the originating mutation — an admin write
 * must not depend on the storefront existing at all.
 */
@Injectable()
class StorefrontWebhookDispatcher implements OnModuleInit {
  private readonly logger = new Logger(StorefrontWebhookDispatcher.name);
  private readonly url = process.env['STOREFRONT_REVALIDATE_URL'];
  private readonly secret = process.env['STOREFRONT_REVALIDATE_SECRET'];

  constructor(
    private readonly bus: EventBus,
    private readonly outbox: WebhookOutboxRepository,
  ) {}

  onModuleInit(): void {
    if (!this.url || !this.secret) {
      this.logger.log(
        'STOREFRONT_REVALIDATE_URL/SECRET unset — storefront webhooks disabled',
      );
      return;
    }
    this.logger.log(`subscribing to search.product.*, pricing.* → ${this.url}`);

    // Product-scoped invalidation keys off the SEARCH events, not the catalog
    // or pricing ones that ultimately caused them.
    //
    // The reason is the bus's fan-out semantics: publish() delivers to every
    // subscriber concurrently and awaits none of them. Subscribing to
    // `catalog.product.updated` here would race the indexer — when this
    // handler wins, the storefront drops its cached page and immediately
    // rebuilds it by querying an index that hasn't been updated yet, so the
    // stale render gets cached again and stays until the hourly backstop. The
    // symptom is an edit that appears not to have worked.
    //
    // `search.product.indexed` is published only once the document is written
    // and searchable, so by the time this fires a rebuild is guaranteed to see
    // the new state. Every path that changes what a product looks like —
    // create, update, price change — funnels through it.
    this.bus.subscribe<DomainEvent<string, ProductIndexedPayload>>(
      SEARCH_EVENTS.ProductIndexed,
      (e) =>
        this.dispatch({
          event: e.name,
          tenantId: e.payload.tenantId,
          productId: e.payload.productId,
        }),
    );
    this.bus.subscribe<DomainEvent<string, ProductRemovedPayload>>(
      SEARCH_EVENTS.ProductRemoved,
      (e) =>
        this.dispatch({
          event: e.name,
          tenantId: e.payload.tenantId,
          productId: e.payload.productId,
        }),
    );

    // Promotions and tenant config are tenant-wide, touch no document, and so
    // have no read model to wait for — they dispatch straight from the domain
    // event.
    this.bus.subscribe<DomainEvent<string, PromotionCreatedPayload>>(
      PRICING_EVENTS.PromotionCreated,
      (e) => this.dispatch({ event: e.name, tenantId: e.tenantId }),
    );
    this.bus.subscribe<DomainEvent<string, PromotionUpdatedPayload>>(
      PRICING_EVENTS.PromotionUpdated,
      (e) => this.dispatch({ event: e.name, tenantId: e.tenantId }),
    );
    this.bus.subscribe<DomainEvent<string, TenantConfigUpdatedPayload>>(
      PRICING_EVENTS.TenantConfigUpdated,
      (e) => this.dispatch({ event: e.name, tenantId: e.tenantId }),
    );
  }

  /**
   * Records the webhook rather than sending it.
   *
   * The event handler's job ends at "this is durably recorded as owed". It
   * runs inside the originating request, on that request's tenant-bound
   * connection, so the insert is ordinary RLS-scoped work. Delivery is the
   * worker's problem, which is what stops a slow or restarting storefront from
   * adding latency to an admin API call.
   */
  private async dispatch(payload: {
    event: string;
    tenantId: string;
    productId?: string;
  }): Promise<void> {
    if (!this.url || !this.secret) return; // re-check (TS narrows)
    try {
      await this.outbox.enqueue({
        tenantId: payload.tenantId,
        event: payload.event,
        productId: payload.productId ?? null,
      });
    } catch (err) {
      // Losing the enqueue must not fail the originating mutation — the page
      // just stays stale until the storefront's own time-based backstop.
      this.logger.warn(
        `outbox enqueue failed for ${payload.event} ${payload.tenantId}/${payload.productId ?? '-'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/**
 * Delivers queued webhooks with exponential backoff.
 *
 * Polls rather than being triggered by the enqueue, for two reasons: a row
 * written by a request that later rolls back must never be delivered, and rows
 * left behind by a process that died have to be picked up by whatever is
 * running now. Polling makes both cases the same case.
 *
 * The interval is short enough that revalidation still feels immediate — the
 * storefront rebuild lands about a second after the admin call, versus the
 * hour it would take the time-based fallback.
 */
@Injectable()
class WebhookOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookOutboxWorker.name);
  private readonly url = process.env['STOREFRONT_REVALIDATE_URL'];
  private readonly secret = process.env['STOREFRONT_REVALIDATE_SECRET'];
  private readonly pollMs = Number.parseInt(
    process.env['STOREFRONT_WEBHOOK_POLL_MS'] ?? '1000',
    10,
  );
  private readonly batchSize = 32;
  private readonly maxAttempts = 6;
  private timer?: NodeJS.Timeout;
  /** Guards against a slow tick overlapping the next one. */
  private running = false;

  constructor(private readonly outbox: WebhookOutboxRepository) {}

  onModuleInit(): void {
    if (!this.url || !this.secret) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    // Don't hold the process open on shutdown for the sake of a poll.
    this.timer.unref();
    this.logger.log(
      `outbox worker polling every ${this.pollMs}ms → ${this.url} (max ${this.maxAttempts} attempts)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Backoff doubles per attempt from 2s, capped at 5 minutes: 2s, 4s, 8s,
   * 16s, 32s, 64s. A storefront that is redeploying is back well inside that,
   * and a storefront that is genuinely gone stops being retried after six
   * tries rather than being hammered forever.
   */
  private backoffFor(attempts: number): number {
    return Math.min(2 ** attempts, 300);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // The claim pushes next_attempt_at forward by one backoff step, so a
      // crash mid-delivery leaves the row eligible again rather than claimed
      // forever.
      const due = await this.outbox.claimDue(this.batchSize, this.backoffFor(1));
      for (const delivery of due) {
        await this.deliver(delivery);
      }
    } catch (err) {
      this.logger.warn(
        `outbox tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async deliver(delivery: OutboxDelivery): Promise<void> {
    if (!this.url || !this.secret) return;
    const label = `${delivery.event} ${delivery.tenantId}/${delivery.productId ?? '-'}`;
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.secret}`,
          // Lets the storefront discard a duplicate that a retry produced
          // after a delivery that actually succeeded but whose response was
          // lost. At-least-once delivery is the guarantee; this is how the
          // consumer makes it look like exactly-once.
          'x-delivery-id': delivery.id,
        },
        body: JSON.stringify({
          event: delivery.event,
          tenantId: delivery.tenantId,
          productId: delivery.productId ?? undefined,
          deliveryId: delivery.id,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        await this.outbox.markDelivered(delivery.id);
        this.logger.log(`webhook ${label} delivered (attempt ${delivery.attempts})`);
        return;
      }

      const text = await res.text().catch(() => '');
      await this.recordFailure(delivery, `HTTP ${res.status}: ${text.slice(0, 200)}`, label);
    } catch (err) {
      await this.recordFailure(
        delivery,
        err instanceof Error ? err.message : String(err),
        label,
      );
    }
  }

  private async recordFailure(
    delivery: OutboxDelivery,
    reason: string,
    label: string,
  ): Promise<void> {
    if (delivery.attempts >= this.maxAttempts) {
      await this.outbox.markExhausted(delivery.id, reason);
      this.logger.error(
        `webhook ${label} exhausted after ${delivery.attempts} attempts: ${reason}`,
      );
      return;
    }
    const retryIn = this.backoffFor(delivery.attempts);
    await this.outbox.markFailed(delivery.id, reason, retryIn);
    this.logger.warn(
      `webhook ${label} attempt ${delivery.attempts} failed, retrying in ${retryIn}s: ${reason}`,
    );
  }
}

@Module({
  providers: [StorefrontWebhookDispatcher, WebhookOutboxWorker],
})
export class StorefrontWebhookModule {}
