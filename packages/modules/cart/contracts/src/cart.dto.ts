import type { ComputedTotals } from '@platform/modules/pricing/contracts';

/**
 * Cart line carries product identity AND a snapshot of sku/name at add-time.
 * The storefront already has these from the search result; sending them avoids
 * a cross-module catalog lookup at checkout. Price is NOT cached here — that's
 * read live from pricing on every totals computation so cart never goes stale
 * on price changes.
 */
export interface CartLine {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly qty: number;
}

export interface Cart {
  readonly id: string;
  readonly tenantId: string;
  readonly lines: readonly CartLine[];
  readonly couponCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CartWithTotals extends Cart {
  readonly totals: ComputedTotals;
}

export interface AddItemDto {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly qty: number;
}

export interface SetItemQtyDto {
  /** 0 removes the line. */
  readonly qty: number;
}

export interface ApplyCouponDto {
  readonly code: string;
}

export interface CreateCartResponse {
  readonly cartId: string;
}
