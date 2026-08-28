import {
  computeTotals,
  mulBps,
  taxIncludedIn,
  type PricedLine,
} from '@platform/modules/pricing/contracts';

/**
 * Tax-inclusive (gross) pricing — C-29.
 *
 * Gross mode is the European retail convention: the shelf price already
 * includes VAT and the customer pays exactly what is advertised, so tax is
 * decomposed out of the total rather than added to it.
 *
 * ── What these print if the engine ignored the mode ───────────────────────
 *
 * Every case here is asserted **side by side against net mode on identical
 * input**. If `taxMode` were dropped on the floor, gross results would equal
 * net results and every `not.toEqual` below fails. That contrast is the whole
 * test: a gross suite on its own would pass against an engine that silently
 * computed net, which is exactly the "control wired to nothing" failure this
 * work exists to prevent.
 */

const line = (cents: number): PricedLine => ({
  productId: 'p',
  qty: 1,
  unitPriceCents: cents,
  lineTotalCents: cents,
});

const totals = (
  cents: number,
  bps: number,
  taxMode: 'net' | 'gross',
  discountCents?: number,
) =>
  computeTotals({
    currency: 'GBP',
    taxRateBps: bps,
    lines: [line(cents)],
    taxMode,
    appliedPromotion:
      discountCents === undefined
        ? null
        : {
            promotionId: 'promo',
            kind: 'automatic',
            code: null,
            actionType: 'fixed',
            actionValue: discountCents,
            discountCents,
          },
  });

describe('taxIncludedIn', () => {
  it('extracts VAT from a round tax-inclusive amount', () => {
    // £120.00 including 20% VAT is £100.00 + £20.00.
    expect(taxIncludedIn(12_000, 2000)).toBe(2000);
  });

  it('is NOT the same as applying the rate to the gross amount', () => {
    // The bug this function exists to prevent: 20% *of* £120 is £24, but the
    // VAT *inside* £120 is £20. Reaching for mulBps here overstates tax by 20%
    // on every gross order, and the receipt still adds up, so nothing else
    // notices.
    expect(mulBps(12_000, 2000)).toBe(2400);
    expect(taxIncludedIn(12_000, 2000)).toBe(2000);
  });

  it.each([
    // gross,   bps,  expected tax
    [12_000, 2000, 2000], // 20% VAT on £100
    [10_000, 2000, 1667], // £83.33 + £16.67
    [1_000, 875, 80], // 8.75%
    [11_900, 1900, 1900], // 19% German VAT on €100
    [10_500, 500, 500], // 5% on 100.00
    [1, 2000, 0], // a single cent contains no whole cent of tax
  ])('taxIncludedIn(%i, %i) = %i', (gross, bps, expected) => {
    expect(taxIncludedIn(gross, bps)).toBe(expected);
  });

  it.each([
    // Exact .5 ties — where banker's rounding differs from half-up, and the
    // only cases that can tell the two policies apart. Both of these were
    // written half-up first and the test caught it, which is the argument for
    // pinning them rather than trusting the arithmetic in a comment.
    //
    // gross, bps,  half-even, (half-up would give)
    [999, 2000, 166, 167], // 166.5 → 166, even
    [3, 2000, 0, 1], //   0.5 → 0,   even
    [2_997, 2000, 500, 500], // 499.5 → 500, even (the tie rounding UP)
  ])('taxIncludedIn(%i, %i) = %i, not %i', (gross, bps, halfEven) => {
    expect(taxIncludedIn(gross, bps)).toBe(halfEven);
  });

  it('returns 0 for a zero rate or a zero amount', () => {
    expect(taxIncludedIn(12_000, 0)).toBe(0);
    expect(taxIncludedIn(0, 2000)).toBe(0);
  });

  it('rejects non-integer and negative-rate input rather than rounding it away', () => {
    expect(() => taxIncludedIn(100.5, 2000)).toThrow(/integer/);
    expect(() => taxIncludedIn(100, 20.5)).toThrow(/integer/);
    expect(() => taxIncludedIn(100, -2000)).toThrow(/non-negative/);
  });

  it('holds at a scale where float math would have drifted', () => {
    // £10,000,000.00 including 20% VAT. A float intermediate loses cents here;
    // the BigInt path is exact.
    expect(taxIncludedIn(1_000_000_000, 2000)).toBe(166_666_667);
  });

  it('never extracts more tax than the amount itself', () => {
    for (const gross of [1, 2, 3, 7, 99, 100, 12_345]) {
      for (const bps of [1, 500, 875, 2000, 10_000, 50_000]) {
        const tax = taxIncludedIn(gross, bps);
        expect(tax).toBeGreaterThanOrEqual(0);
        expect(tax).toBeLessThanOrEqual(gross);
      }
    }
  });
});

describe('computeTotals — golden cases, both modes on identical input', () => {
  it.each([
    // cents,   bps,  net grand, gross grand, gross tax, gross net
    [10_000, 2000, 12_000, 10_000, 1667, 8_333],
    [12_000, 2000, 14_400, 12_000, 2000, 10_000],
    [10_000, 875, 10_875, 10_000, 805, 9_195],
    [9_999, 1900, 11_899, 9_999, 1596, 8_403],
    [100, 2000, 120, 100, 17, 83],
  ])(
    '%i cents @ %i bps',
    (cents, bps, netGrand, grossGrand, grossTax, grossNet) => {
      const net = totals(cents, bps, 'net');
      const gross = totals(cents, bps, 'gross');

      // Net: tax is added on top of the listed price.
      expect(net.grandTotalCents).toBe(netGrand);
      expect(net.taxedAmountCents).toBe(cents);

      // Gross: the listed price IS what is charged; tax is carved out of it.
      expect(gross.grandTotalCents).toBe(grossGrand);
      expect(gross.taxCents).toBe(grossTax);
      expect(gross.taxedAmountCents).toBe(grossNet);

      // The contrast. With the mode ignored these would be equal.
      expect(gross.grandTotalCents).not.toBe(net.grandTotalCents);
    },
  );

  it('a zero tax rate makes the two modes agree, and that is correct', () => {
    // The one input where equality is right rather than a bug. Stated so the
    // `not.toBe` assertions above are understood as rate-dependent, not as a
    // universal law.
    const net = totals(10_000, 0, 'net');
    const gross = totals(10_000, 0, 'gross');
    expect(net.grandTotalCents).toBe(10_000);
    expect(gross.grandTotalCents).toBe(10_000);
    expect(gross.taxCents).toBe(0);
  });
});

describe('computeTotals — invariants', () => {
  const cases: readonly (readonly [number, number])[] = [
    [10_000, 2000],
    [9_999, 1900],
    [1, 2000],
    [12_345, 875],
    [7, 10_000],
  ];

  it.each(cases)('gross: taxedAmount + tax === grandTotal (%i @ %i)', (cents, bps) => {
    // Exact by construction: net is derived by subtracting tax from gross
    // rather than being rounded independently. Rounding both halves separately
    // loses or invents a cent on roughly half of all amounts, and that cent
    // lands on a customer's receipt.
    const t = totals(cents, bps, 'gross');
    expect(t.taxedAmountCents + t.taxCents).toBe(t.grandTotalCents);
  });

  it.each(cases)('net: taxedAmount + tax === grandTotal (%i @ %i)', (cents, bps) => {
    const t = totals(cents, bps, 'net');
    expect(t.taxedAmountCents + t.taxCents).toBe(t.grandTotalCents);
  });

  it('gross: the customer pays exactly the advertised price', () => {
    // The defining property of tax-inclusive pricing. If tax were added on top
    // this is the assertion that fails.
    const t = totals(12_000, 2000, 'gross');
    expect(t.grandTotalCents).toBe(t.subtotalCents);
  });

  it('gross: a discount reduces the tax inside proportionally', () => {
    // 10% off a £120 VAT-inclusive item is £108, containing £18 VAT — not £108
    // plus some separately-computed VAT figure.
    const t = totals(12_000, 2000, 'gross', 1_200);
    expect(t.grandTotalCents).toBe(10_800);
    expect(t.taxCents).toBe(1_800);
    expect(t.taxedAmountCents).toBe(9_000);
  });

});

describe('net mode is untouched by gross mode existing', () => {
  // The backlog's stated check: net outputs byte-identical to before. These
  // pin the exact numbers the engine produced prior to C-29.
  it('omitting taxMode computes net, as every existing caller relies on', () => {
    const explicit = totals(10_000, 875, 'net');
    const implicit = computeTotals({
      currency: 'GBP',
      taxRateBps: 875,
      lines: [line(10_000)],
      appliedPromotion: null,
    });
    expect(implicit).toEqual(explicit);
  });

  it('reproduces the pre-C-29 numbers exactly', () => {
    const t = computeTotals({
      currency: 'USD',
      taxRateBps: 875,
      lines: [line(1_000), line(1_000), line(2_500)],
      appliedPromotion: null,
    });
    expect(t.subtotalCents).toBe(4_500);
    expect(t.discountCents).toBe(0);
    expect(t.taxedAmountCents).toBe(4_500);
    // 8.75% of 4500 = 393.75, banker's-rounded to 394 — the value
    // checkout.integration.spec.ts has asserted since step 5.
    expect(t.taxCents).toBe(394);
    expect(t.grandTotalCents).toBe(4_894);
  });
});
