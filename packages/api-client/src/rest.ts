/**
 * Hand-mirrored types for the api's REST surface (cart, checkout, orders).
 *
 * Why mirrored instead of imported from each module's contracts package:
 * the api-client is the PUBLIC contract surface for the storefront and any
 * future external client. The module contracts package is the api's
 * INTERNAL contract surface — modules import each other's contracts to wire
 * up, but external consumers (storefront, partner integrations) get a
 * separate, intentionally curated, mirrored type set. That separation lets
 * the api refactor its internal contracts without breaking the storefront
 * contract.
 *
 * Why still mirrored rather than generated: this is being retired, one
 * module at a time. Cart now publishes real OpenAPI schemas (R-1), orders
 * does not yet (R-2), and nothing generates from them until R-3a. Mirroring
 * by hand stays the honest move only while the document is incomplete —
 * once it is not, this file goes.
 */

// ─── Cart ──────────────────────────────────────────────────────────────────

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

export interface CreateCartResponse {
  readonly cartId: string;
}

export interface AddItemDto {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly qty: number;
}

export interface SetItemQtyDto {
  readonly qty: number;
}

export interface ApplyCouponDto {
  readonly code: string;
}

// ─── Pricing ───────────────────────────────────────────────────────────────

export interface PricedLine {
  readonly productId: string;
  readonly qty: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
}

export type PromotionKind = 'coupon-code' | 'automatic';
export type PromotionActionType = 'percent' | 'fixed';

export interface AppliedPromotionSnapshot {
  readonly promotionId: string;
  readonly kind: PromotionKind;
  readonly code: string | null;
  readonly actionType: PromotionActionType;
  readonly actionValue: number;
  readonly discountCents: number;
}

export interface ComputedTotals {
  readonly currency: string;
  readonly lines: readonly PricedLine[];
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly taxedAmountCents: number;
  readonly taxRateBps: number;
  readonly taxCents: number;
  readonly grandTotalCents: number;
  readonly appliedPromotion: AppliedPromotionSnapshot | null;
}

// ─── Orders ────────────────────────────────────────────────────────────────

export type OrderStatus = 'created';

export interface OrderLine {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly unitPriceCents: number;
  readonly qty: number;
  readonly lineTotalCents: number;
}

export interface Order {
  readonly id: string;
  readonly tenantId: string;
  readonly status: OrderStatus;
  readonly currency: string;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly taxRateBps: number;
  readonly taxCents: number;
  readonly grandTotalCents: number;
  readonly lines: readonly OrderLine[];
  readonly appliedPromotion: AppliedPromotionSnapshot | null;
  readonly createdAt: string;
}

export interface CheckoutDto {
  readonly cartId: string;
}
