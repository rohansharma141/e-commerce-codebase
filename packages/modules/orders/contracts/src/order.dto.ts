import type { AppliedPromotionSnapshot } from '@platform/modules/pricing/contracts';

export type OrderStatus = 'created'; // future: 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled'

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
