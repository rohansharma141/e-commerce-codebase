import type { Price } from './price.dto';
import type { Promotion } from './promotion.dto';

/**
 * Pricing domain events.
 *
 * Same discipline as the catalog module's: plain serializable payloads that
 * carry everything a consumer needs, so no subscriber has to call back into
 * pricing to make sense of one. Written as if they already cross a network,
 * because they will if this module is ever extracted.
 *
 * Two consumers exist today, and they want different things from the same
 * event, which is why the payload carries the full row rather than just an id:
 *
 *   - the search indexer patches the denormalised price on the product
 *     document, so browse and PDP reads reflect the new price;
 *   - the storefront webhook dispatcher turns it into a cache invalidation.
 *
 * Neither knows about the other, and pricing knows about neither.
 */
export const PRICING_EVENTS = {
  PriceUpserted: 'pricing.price.upserted',
  PromotionCreated: 'pricing.promotion.created',
  PromotionUpdated: 'pricing.promotion.updated',
  TenantConfigUpdated: 'pricing.tenant-config.updated',
} as const;

export type PricingEventName = (typeof PRICING_EVENTS)[keyof typeof PRICING_EVENTS];

export interface PriceUpsertedPayload {
  readonly price: Price;
}

export interface PromotionCreatedPayload {
  readonly promotion: Promotion;
}

export interface PromotionUpdatedPayload {
  readonly promotion: Promotion;
}

/**
 * Deliberately does not carry the config itself. Tenant config holds tax rates
 * and currency — the storefront needs to know *that* it changed so it can drop
 * cached renders, but broadcasting the values would put tax configuration on
 * the bus for every subscriber, present and future. Consumers that need the
 * values read them through the contract.
 */
export interface TenantConfigUpdatedPayload {
  readonly tenantId: string;
}
