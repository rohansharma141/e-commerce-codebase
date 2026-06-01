import {
  Injectable,
  Logger,
  Module,
  type OnModuleInit,
} from '@nestjs/common';
import { EventBus, type DomainEvent } from '@platform/shared/event-bus';
import {
  CATALOG_EVENTS,
  type ProductCreatedPayload,
  type ProductDeletedPayload,
  type ProductUpdatedPayload,
} from '@platform/modules/catalog/contracts';

/**
 * Webhook dispatcher for storefront revalidation.
 *
 * Subscribes to catalog.product.{created,updated,deleted} on the in-process
 * bus and POSTs a small event-shaped payload to the storefront's
 * `/api/revalidate` endpoint. The storefront knows how to map the event
 * type into Next.js cache-tag invalidations — this side stays semantic.
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
 * The dispatcher is fire-and-forget — webhook failures are logged but do not
 * fail the originating mutation. The storefront's 1-hour fetch-cache
 * fallback covers dropped webhooks; this dispatcher just makes the fast
 * path fast.
 */
@Injectable()
class StorefrontWebhookDispatcher implements OnModuleInit {
  private readonly logger = new Logger(StorefrontWebhookDispatcher.name);
  private readonly url = process.env['STOREFRONT_REVALIDATE_URL'];
  private readonly secret = process.env['STOREFRONT_REVALIDATE_SECRET'];

  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    if (!this.url || !this.secret) {
      this.logger.log(
        'STOREFRONT_REVALIDATE_URL/SECRET unset — storefront webhooks disabled',
      );
      return;
    }
    this.logger.log(`subscribing to catalog.product.* → ${this.url}`);
    this.bus.subscribe<DomainEvent<string, ProductCreatedPayload>>(
      CATALOG_EVENTS.ProductCreated,
      (e) =>
        this.dispatch({
          event: e.name,
          tenantId: e.tenantId,
          productId: e.payload.product.id,
        }),
    );
    this.bus.subscribe<DomainEvent<string, ProductUpdatedPayload>>(
      CATALOG_EVENTS.ProductUpdated,
      (e) =>
        this.dispatch({
          event: e.name,
          tenantId: e.tenantId,
          productId: e.payload.product.id,
        }),
    );
    this.bus.subscribe<DomainEvent<string, ProductDeletedPayload>>(
      CATALOG_EVENTS.ProductDeleted,
      (e) =>
        this.dispatch({
          event: e.name,
          tenantId: e.tenantId,
          productId: e.payload.product.id,
        }),
    );
  }

  private async dispatch(payload: {
    event: string;
    tenantId: string;
    productId?: string;
  }): Promise<void> {
    if (!this.url || !this.secret) return; // re-check (TS narrows)
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.secret}`,
        },
        body: JSON.stringify(payload),
        // Generous timeout — storefront revalidate should be fast, but we
        // don't want a hung edge to back-pressure the api's microtask queue.
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `webhook ${payload.event} HTTP ${res.status} for ${payload.tenantId}/${payload.productId ?? '-'}: ${text.slice(0, 200)}`,
        );
      } else {
        this.logger.log(
          `webhook ${payload.event} ok tenant=${payload.tenantId} product=${payload.productId ?? '-'}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `webhook ${payload.event} failed for ${payload.tenantId}/${payload.productId ?? '-'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

@Module({
  providers: [StorefrontWebhookDispatcher],
})
export class StorefrontWebhookModule {}
