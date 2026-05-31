import {
  computeTotals,
  type AppliedPromotionSnapshot,
  type PricedLine,
} from '@platform/modules/pricing/contracts';

const line = (partial: Partial<PricedLine>): PricedLine => ({
  productId: 'p',
  qty: 1,
  unitPriceCents: 1000,
  lineTotalCents: 1000,
  ...partial,
});

describe('computeTotals', () => {
  it('sums lines and applies no discount when no promo', () => {
    const totals = computeTotals({
      currency: 'USD',
      taxRateBps: 0,
      lines: [line({ lineTotalCents: 1000 }), line({ lineTotalCents: 500 })],
      appliedPromotion: null,
    });
    expect(totals.subtotalCents).toBe(1500);
    expect(totals.discountCents).toBe(0);
    expect(totals.taxCents).toBe(0);
    expect(totals.grandTotalCents).toBe(1500);
  });

  it('applies tax on subtotal when no promo (banker\'s rounded)', () => {
    const totals = computeTotals({
      currency: 'USD',
      taxRateBps: 875, // 8.75%
      lines: [line({ lineTotalCents: 10_000 })],
      appliedPromotion: null,
    });
    expect(totals.subtotalCents).toBe(10_000);
    expect(totals.taxCents).toBe(875);
    expect(totals.grandTotalCents).toBe(10_875);
  });

  it('applies discount before tax (tax-on-discounted-subtotal convention)', () => {
    const promo: AppliedPromotionSnapshot = {
      promotionId: 'pr',
      kind: 'coupon-code',
      code: 'SAVE10',
      actionType: 'percent',
      actionValue: 1000,
      discountCents: 1000, // 10% off 10000 = 1000
    };
    const totals = computeTotals({
      currency: 'USD',
      taxRateBps: 1000, // 10%
      lines: [line({ lineTotalCents: 10_000 })],
      appliedPromotion: promo,
    });
    expect(totals.subtotalCents).toBe(10_000);
    expect(totals.discountCents).toBe(1000);
    expect(totals.taxedAmountCents).toBe(9000);
    expect(totals.taxCents).toBe(900); // 10% of 9000
    expect(totals.grandTotalCents).toBe(9900);
  });

  it('caps discount to subtotal (never goes negative)', () => {
    const promo: AppliedPromotionSnapshot = {
      promotionId: 'pr',
      kind: 'coupon-code',
      code: 'BIG',
      actionType: 'fixed',
      actionValue: 99_999,
      discountCents: 99_999,
    };
    const totals = computeTotals({
      currency: 'USD',
      taxRateBps: 800,
      lines: [line({ lineTotalCents: 5000 })],
      appliedPromotion: promo,
    });
    expect(totals.discountCents).toBe(5000);
    expect(totals.taxedAmountCents).toBe(0);
    expect(totals.taxCents).toBe(0);
    expect(totals.grandTotalCents).toBe(0);
  });

  it('handles empty cart', () => {
    const totals = computeTotals({
      currency: 'USD',
      taxRateBps: 875,
      lines: [],
      appliedPromotion: null,
    });
    expect(totals.subtotalCents).toBe(0);
    expect(totals.grandTotalCents).toBe(0);
  });
});
