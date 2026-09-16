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
  /**
   * The channel this cart was created in, and the only channel it may be used in.
   *
   * A basket belongs to a market. Adding to it, repricing it or checking it out
   * under a different channel would price goods chosen in one market under
   * another's rules — once C-18 makes currency channel-aware, a different
   * currency. So the binding is fixed at creation and every later operation is
   * checked against it.
   *
   * Stored as the concrete channel id even when the cart was created with no
   * channel named (the tenant default). A cart built on the default stays on
   * *that* channel if another is later promoted to default, rather than
   * silently moving markets with the promotion.
   *
   * Null only for carts created before this field existed. Carts expire after
   * 24 hours, so that is a transitional state, and a null is treated as the
   * tenant default.
   */
  readonly channelId: string | null;
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
