import type { AppliedPromotionSnapshot } from './promotion.dto';

export interface LineInput {
  readonly productId: string;
  readonly qty: number;
}

export interface PricedLine {
  readonly productId: string;
  readonly qty: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
}

export interface ComputedTotals {
  readonly currency: string;
  readonly lines: readonly PricedLine[];
  readonly subtotalCents: number;
  readonly discountCents: number;
  /** subtotal - discount; the base for tax. */
  readonly taxedAmountCents: number;
  readonly taxRateBps: number;
  readonly taxCents: number;
  readonly grandTotalCents: number;
  readonly appliedPromotion: AppliedPromotionSnapshot | null;
}

export interface TotalsComputeInput {
  readonly tenantId: string;
  readonly lines: readonly LineInput[];
  readonly couponCode?: string;
}
