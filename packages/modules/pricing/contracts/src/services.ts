import type { ComputedTotals, LineInput } from './totals.dto';
import type { Price } from './price.dto';
import type { Promotion } from './promotion.dto';
import type { TenantConfig } from './tax.dto';

/**
 * Service-interface contracts. Other modules import these tokens + interfaces
 * from `@platform/modules/pricing/contracts` and inject via Nest DI; the
 * concrete implementations live in pricing/src and are registered against
 * these tokens by the pricing module. This is what keeps cart and orders
 * from reaching into pricing/src directly.
 */

export const TOTALS_SERVICE = Symbol('TOTALS_SERVICE');
export interface ITotalsService {
  compute(input: {
    readonly tenantId: string;
    readonly lines: readonly LineInput[];
    readonly couponCode?: string;
  }): Promise<ComputedTotals>;
}

export const PRICES_QUERY = Symbol('PRICES_QUERY');
export interface IPricesQuery {
  findByProductIds(tenantId: string, productIds: readonly string[]): Promise<ReadonlyMap<string, Price>>;
}

export const PROMOTIONS_QUERY = Symbol('PROMOTIONS_QUERY');
export interface IPromotionsQuery {
  listActiveCandidates(tenantId: string): Promise<readonly Promotion[]>;
  /**
   * Atomic, conditional `uses_count` increment. Returns true iff the row was
   * successfully consumed (still within max_uses). False indicates the promo
   * was just exhausted by a racing checkout.
   */
  tryIncrementUsesCount(tenantId: string, promotionId: string): Promise<boolean>;
}

export const TENANT_CONFIG_QUERY = Symbol('TENANT_CONFIG_QUERY');
export interface ITenantConfigQuery {
  get(tenantId: string): Promise<TenantConfig>;
  findOptional(tenantId: string): Promise<TenantConfig | null>;
}
