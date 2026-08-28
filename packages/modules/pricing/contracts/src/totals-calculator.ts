import type { AppliedPromotionSnapshot, PricedLine, ComputedTotals, TaxMode } from './';
import { clampNonNegative, mulBps, taxIncludedIn } from './money-ops';

export interface TotalsCalculatorInput {
  readonly currency: string;
  readonly taxRateBps: number;
  readonly lines: readonly PricedLine[];
  readonly appliedPromotion: AppliedPromotionSnapshot | null;
  /**
   * Defaults to `net`, which is what every caller did before gross mode
   * existed and what the engine has always computed. Defaulting rather than
   * requiring keeps existing call sites byte-identical; the per-channel control
   * that will actually set this is C-30.
   */
  readonly taxMode?: TaxMode;
}

/**
 * Pure computation of cart/order totals. No DB, no IO.
 *
 * Common to both modes:
 *   subtotal    = sum(line.lineTotalCents)
 *   discount    = appliedPromotion?.discountCents ?? 0   (clamped to subtotal)
 *
 * **net** — listed prices exclude tax; it is added at checkout (US convention):
 *   taxedAmount = subtotal - discount
 *   tax         = mulBps(taxedAmount, taxRateBps)        (banker's rounded)
 *   grandTotal  = taxedAmount + tax
 *
 * **gross** — listed prices already include tax (European retail). The customer
 * pays exactly the advertised, discounted price, so nothing is added; the tax
 * is decomposed back out of it for the receipt:
 *   grandTotal  = subtotal - discount
 *   tax         = taxIncludedIn(grandTotal, taxRateBps)
 *   taxedAmount = grandTotal - tax
 *
 * Note the discount is applied **before** the tax split in gross mode, on the
 * gross amount. Discounting a tax-inclusive price reduces the tax inside it
 * proportionally, which is what a customer expects: 10% off a £120 VAT-inclusive
 * item is £108, containing £18 VAT — not £108 plus some other VAT figure.
 *
 * `taxedAmount + tax === grandTotal` in both modes. `taxedAmount === subtotal -
 * discount` holds only in net mode.
 */
export function computeTotals(input: TotalsCalculatorInput): ComputedTotals {
  const taxMode: TaxMode = input.taxMode ?? 'net';
  const subtotalCents = input.lines.reduce((acc, l) => acc + l.lineTotalCents, 0);
  const discountCents = clampNonNegative(
    Math.min(subtotalCents, input.appliedPromotion?.discountCents ?? 0),
  );
  const discounted = clampNonNegative(subtotalCents - discountCents);

  let taxedAmountCents: number;
  let taxCents: number;
  let grandTotalCents: number;

  if (taxMode === 'gross') {
    grandTotalCents = discounted;
    taxCents = taxIncludedIn(discounted, input.taxRateBps);
    // Derived by subtraction, never rounded independently, so the decomposition
    // is exact: net + tax is the gross the customer was quoted, to the cent.
    taxedAmountCents = discounted - taxCents;
  } else {
    taxedAmountCents = discounted;
    taxCents = mulBps(discounted, input.taxRateBps);
    grandTotalCents = discounted + taxCents;
  }

  return {
    currency: input.currency,
    lines: input.lines,
    subtotalCents,
    discountCents,
    taxedAmountCents,
    taxRateBps: input.taxRateBps,
    taxCents,
    grandTotalCents,
    appliedPromotion: input.appliedPromotion,
  };
}
