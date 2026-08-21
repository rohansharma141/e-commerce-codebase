import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EventBus, IdempotencyTracker, type DomainEvent } from '@platform/shared/event-bus';
import {
  SEARCH_EVENTS,
  type ProductIndexedPayload,
} from '@platform/modules/search/contracts';
import {
  CATALOG_EVENTS,
  type AttributeDefinitionCreatedPayload,
  type ProductCreatedPayload,
  type ProductDeletedPayload,
  type ProductUpdatedPayload,
} from '@platform/modules/catalog/contracts';
import {
  PRICING_EVENTS,
  type PriceUpsertedPayload,
} from '@platform/modules/pricing/contracts';
import {
  TENANT_SEARCH_CLIENT,
  type TenantIndex,
  type TenantSearchClient,
} from '@platform/shared/opensearch';
import { productToDocument } from './document-builder';
import {
  BASE_PROPERTIES,
  attributeFieldName,
  attributePropertiesFor,
  osTypeFor,
} from './mapping-manager';

/**
 * Consumes catalog.* events and keeps OpenSearch in sync.
 *
 * Each handler is idempotent (dedupe by eventId), so a redeliver-on-error bus
 * doesn't double-index. ensureIndex is idempotent; putMapping is additive-only
 * and OpenSearch accepts a "no-op" add of an existing field.
 */
@Injectable()
export class ProductIndexerService implements OnModuleInit {
  private readonly logger = new Logger(ProductIndexerService.name);
  private readonly dedupe = new IdempotencyTracker();
  /**
   * Cache of in-flight (or completed) ensureIndex promises keyed by index name.
   * Storing the promise (not just a boolean) is what closes the race when two
   * events for a fresh tenant arrive at once — the second caller awaits the
   * first's create instead of issuing its own.
   */
  private readonly ensuredIndices = new Map<string, Promise<void>>();

  constructor(
    private readonly bus: EventBus,
    @Inject(TENANT_SEARCH_CLIENT) private readonly searchClient: TenantSearchClient,
  ) {}

  onModuleInit(): void {
    // The bus delivers DomainEvent<string, unknown>; the catalog publishes
    // the typed payload at the producer end (see catalog services). We narrow
    // back to the typed payload at subscribe time — safe because the event
    // name is the discriminator.
    this.bus.subscribe<DomainEvent<string, AttributeDefinitionCreatedPayload>>(
      CATALOG_EVENTS.AttributeDefinitionCreated,
      (e) => this.handle(e, this.onAttributeDefinitionCreated),
    );
    this.bus.subscribe<DomainEvent<string, ProductCreatedPayload>>(
      CATALOG_EVENTS.ProductCreated,
      (e) => this.handle(e, this.onProductCreated),
    );
    this.bus.subscribe<DomainEvent<string, ProductUpdatedPayload>>(
      CATALOG_EVENTS.ProductUpdated,
      (e) => this.handle(e, this.onProductUpdated),
    );
    this.bus.subscribe<DomainEvent<string, ProductDeletedPayload>>(
      CATALOG_EVENTS.ProductDeleted,
      (e) => this.handle(e, this.onProductDeleted),
    );
    // Pricing owns the canonical price; the index carries a denormalised copy
    // that browse, sort-by-price and the PDP all read. Without this
    // subscription that copy only refreshed when the *catalog* next touched
    // the product, so a price change through the admin API was invisible on
    // the storefront until an unrelated edit happened to fix it.
    //
    // Subscribing here rather than having pricing write to OpenSearch keeps
    // the direction of knowledge right: pricing announces that a price
    // changed, and the module that owns the index decides what that means for
    // a document. Pricing never learns the document's shape.
    this.bus.subscribe<DomainEvent<string, PriceUpsertedPayload>>(
      PRICING_EVENTS.PriceUpserted,
      (e) => this.handle(e, this.onPriceUpserted),
    );
    this.logger.log('indexer subscribed to catalog.*, pricing.price.upserted');
  }

  /** Idempotency wrapper around every handler — see CLAUDE.md "events are network-strict". */
  private async handle<E extends DomainEvent>(
    event: E,
    handler: (e: E) => Promise<void>,
  ): Promise<void> {
    await this.dedupe.runOnce(event.eventId, async () => {
      try {
        await handler.call(this, event);
      } catch (err) {
        this.logger.error(
          `indexer handler failed for ${event.name} (eventId=${event.eventId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }
    });
  }

  /**
   * Ensures the tenant's index exists with the base mapping. Memoized in
   * this.ensuredIndices to avoid hitting OS on every event; that cache is
   * cleared when this module restarts.
   */
  private async ensureIndex(tenantId: string): Promise<TenantIndex> {
    const idx = this.searchClient.forTenant(tenantId);
    let pending = this.ensuredIndices.get(idx.indexName);
    if (!pending) {
      pending = idx.ensureIndex({ properties: BASE_PROPERTIES });
      this.ensuredIndices.set(idx.indexName, pending);
      // On failure, evict so a retry can re-attempt rather than re-failing.
      pending.catch(() => this.ensuredIndices.delete(idx.indexName));
    }
    await pending;
    return idx;
  }

  // --- handlers --------------------------------------------------------------

  private async onAttributeDefinitionCreated(
    event: DomainEvent<string, AttributeDefinitionCreatedPayload>,
  ): Promise<void> {
    const def = event.payload.definition;
    const idx = await this.ensureIndex(def.tenantId);
    await idx.putMapping(attributePropertiesFor([def]));
    this.logger.log(
      `mapping: ${idx.indexName} += ${attributeFieldName(def.code)} (${osTypeFor(def).type})`,
    );
  }

  private async onProductCreated(
    event: DomainEvent<string, ProductCreatedPayload>,
  ): Promise<void> {
    const product = event.payload.product;
    const idx = await this.ensureIndex(product.tenantId);
    await idx.indexDoc(product.id, productToDocument(product), { refresh: 'wait_for' });
    await this.announceIndexed(product.tenantId, product.id, 'created');
  }

  private async onProductUpdated(
    event: DomainEvent<string, ProductUpdatedPayload>,
  ): Promise<void> {
    const product = event.payload.product;
    const idx = await this.ensureIndex(product.tenantId);
    await idx.indexDoc(product.id, productToDocument(product), { refresh: 'wait_for' });
    await this.announceIndexed(product.tenantId, product.id, 'updated');
  }

  private async onProductDeleted(
    event: DomainEvent<string, ProductDeletedPayload>,
  ): Promise<void> {
    const product = event.payload.product;
    const idx = this.searchClient.forTenant(product.tenantId);
    await idx.deleteDoc(product.id, { refresh: 'wait_for' });
    await this.bus.publish({
      name: SEARCH_EVENTS.ProductRemoved,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId: product.tenantId,
      payload: {
        tenantId: product.tenantId,
        productId: product.id,
      } as never,
    });
  }

  /**
   * Announce that the index now serves this product. Published only after the
   * write is searchable, so anything that reacts by re-reading gets the new
   * state rather than racing the write that caused it.
   */
  private async announceIndexed(
    tenantId: string,
    productId: string,
    reason: ProductIndexedPayload['reason'],
  ): Promise<void> {
    await this.bus.publish({
      name: SEARCH_EVENTS.ProductIndexed,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: { tenantId, productId, reason } as never,
    });
  }

  /**
   * Patch the denormalised price on an already-indexed product.
   *
   * Unit conversion is the load-bearing detail. Pricing stores integer cents,
   * because that is the only safe representation for money. The `price`
   * attribute on a product document is a tenant-defined catalog attribute in
   * major units — that is what the seed writes, what the range filter compares
   * against, and what the storefront formats. Writing cents into that field
   * would silently multiply every displayed price by 100 and quietly break
   * every price-range filter.
   */
  private async onPriceUpserted(
    event: DomainEvent<string, PriceUpsertedPayload>,
  ): Promise<void> {
    const price = event.payload.price;
    const idx = this.searchClient.forTenant(price.tenantId);
    const patched = await idx.updateDoc(
      price.productId,
      { [attributeFieldName('price')]: price.unitPriceCents / 100 },
      { refresh: 'wait_for' },
    );
    if (!patched) {
      // Priced before indexed — normal, and self-correcting: whenever the
      // product is indexed it carries whatever price it has then.
      this.logger.debug(
        `price update skipped, no document yet: ${idx.indexName}/${price.productId}`,
      );
      return;
    }
    this.logger.log(
      `price: ${idx.indexName}/${price.productId} → ${price.unitPriceCents} cents`,
    );
    await this.announceIndexed(price.tenantId, price.productId, 'price-changed');
  }
}
