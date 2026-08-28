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

/**
 * Whether listed prices exclude tax (US convention, tax added at checkout) or
 * already include it (European retail).
 *
 * Declared here rather than imported from the channels contracts: pricing does
 * not depend on channels, and a two-value union is not worth a module edge.
 * The channels module carries the same values under the same names, and the
 * composition root maps between them — the duplication is the boundary rule
 * showing through, the way `CartAppliedPromotion` and `OrderAppliedPromotion`
 * already do.
 */
export type TaxMode = 'net' | 'gross';

export interface ComputedTotals {
  readonly currency: string;
  readonly lines: readonly PricedLine[];
  /**
   * Sum of line totals **as priced**. In `net` mode that is tax-exclusive; in
   * `gross` mode it already includes tax. This is the one field whose base
   * differs by mode, because it mirrors whatever the price list holds.
   */
  readonly subtotalCents: number;
  readonly discountCents: number;
  /**
   * The tax base — always **tax-exclusive**, in both modes.
   *
   * In `net` mode it is `subtotal - discount`, unchanged from before gross mode
   * existed. In `gross` mode it is `grandTotal - tax`, because the discounted
   * gross amount is what the customer pays and the net is derived out of it.
   *
   * The invariant that holds in both modes is `taxedAmount + tax ===
   * grandTotal`. The one that does NOT survive gross mode is `taxedAmount ===
   * subtotal - discount`; anything asserting that is assuming net.
   */
  readonly taxedAmountCents: number;
  readonly taxRateBps: number;
  /**
   * In `net` mode, tax added on top. In `gross` mode, the tax already contained
   * within `grandTotalCents` — informational for the receipt, not an addition.
   */
  readonly taxCents: number;
  /** What the customer pays. `taxedAmountCents + taxCents` in both modes. */
  readonly grandTotalCents: number;
  readonly appliedPromotion: AppliedPromotionSnapshot | null;

  // NOTE: the tax mode is deliberately NOT a field here.
  //
  // It is an input to the calculation, not part of its result. A consumer that
  // needs to know whether to render "£100 + £8.75 tax" or "£108.75 incl.
  // £8.75 tax" reads `capabilities.taxDisplay`, which is where "how to read
  // this tenant's prices" already lives and which the storefront already
  // fetches. Repeating it on every cart and order response would be a second
  // source for one fact, and the two would eventually disagree.
}

export interface TotalsComputeInput {
  readonly tenantId: string;
  readonly lines: readonly LineInput[];
  readonly couponCode?: string;
}
