import type { AppliedPromotionSnapshot, PricedLine, ComputedTotals } from './';
import { clampNonNegative, mulBps } from './money-ops';

export interface TotalsCalculatorInput {
  readonly currency: string;
  readonly taxRateBps: number;
  readonly lines: readonly PricedLine[];
  readonly appliedPromotion: AppliedPromotionSnapshot | null;
}

/**
 * Pure computation of cart/order totals. No DB, no IO.
 *   subtotal       = sum(line.lineTotalCents)
 *   discount       = appliedPromotion?.discountCents ?? 0  (clamped to subtotal)
 *   taxedAmount    = subtotal - discount
 *   tax            = mulBps(taxedAmount, taxRateBps)       (banker's rounded)
 *   grandTotal     = taxedAmount + tax
 */
export function computeTotals(input: TotalsCalculatorInput): ComputedTotals {
  const subtotalCents = input.lines.reduce((acc, l) => acc + l.lineTotalCents, 0);
  const discountCents = clampNonNegative(
    Math.min(subtotalCents, input.appliedPromotion?.discountCents ?? 0),
  );
  const taxedAmountCents = clampNonNegative(subtotalCents - discountCents);
  const taxCents = mulBps(taxedAmountCents, input.taxRateBps);
  const grandTotalCents = taxedAmountCents + taxCents;

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
