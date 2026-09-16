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

/**
 * How the channel looked when the order was placed.
 *
 * A copy, not a reference. The channel can be renamed, or archived when a
 * market closes; neither may change what an existing order says it was — the
 * same reason the applied promotion and the unit prices are snapshotted rather
 * than joined.
 *
 * `null` on an order placed before this tenant had channels. The backfill can
 * say which channel it *was* (the tenant had exactly one selling context, which
 * is what the default channel represents) but cannot invent what that channel
 * was called before it existed, so the display fields stay absent rather than
 * borrowing today's.
 */
export interface OrderChannelSnapshot {
  readonly channelId: string;
  /** Null for orders that predate channels; see above. */
  readonly key: string | null;
  readonly name: string | null;
  /**
   * Decimal places for `Order.currency` as charged.
   *
   * Stored rather than derived, unlike everywhere else. An order must render
   * exactly as it was charged even if ISO 4217 later changes an exponent —
   * config derives so there is one source of truth, snapshots store so history
   * is preserved. Different rules for different lifetimes.
   */
  readonly currencyMinorUnits: number | null;
}

export interface Order {
  readonly id: string;
  readonly tenantId: string;
  readonly status: OrderStatus;
  readonly currency: string;
  /** Null only for orders placed before the channels slice landed. */
  readonly channel: OrderChannelSnapshot | null;
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
