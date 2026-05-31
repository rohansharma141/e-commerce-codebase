import { selectBest, type Promotion } from '@platform/modules/pricing/contracts';

const now = new Date('2026-06-01T00:00:00Z');

const promo = (partial: Partial<Promotion>): Promotion => ({
  id: 'pr-default',
  tenantId: 't',
  kind: 'automatic',
  code: null,
  condition: { type: 'always', value: {} },
  action: { type: 'percent', value: 1000 }, // 10%
  expiresAt: null,
  maxUses: null,
  usesCount: 0,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...partial,
});

describe('selectBest', () => {
  it('returns null with no candidates', () => {
    expect(selectBest([], { subtotalCents: 1000, lineProductIds: ['p'] }, now)).toBeNull();
  });

  it('skips inactive promotions', () => {
    const p = promo({ id: 'a', active: false });
    expect(selectBest([p], { subtotalCents: 1000, lineProductIds: ['p'] }, now)).toBeNull();
  });

  it('skips expired promotions', () => {
    const p = promo({ id: 'a', expiresAt: '2026-05-01T00:00:00Z' });
    expect(selectBest([p], { subtotalCents: 1000, lineProductIds: ['p'] }, now)).toBeNull();
  });

  it('skips promotions that have reached max_uses', () => {
    const p = promo({ id: 'a', maxUses: 3, usesCount: 3 });
    expect(selectBest([p], { subtotalCents: 1000, lineProductIds: ['p'] }, now)).toBeNull();
  });

  it('skips coupon-code promos when no matching code is presented', () => {
    const p = promo({ id: 'a', kind: 'coupon-code', code: 'SAVE10' });
    expect(
      selectBest([p], { subtotalCents: 1000, lineProductIds: ['p'] }, now),
    ).toBeNull();
    expect(
      selectBest(
        [p],
        { subtotalCents: 1000, lineProductIds: ['p'], appliedCouponCode: 'WRONG' },
        now,
      ),
    ).toBeNull();
  });

  it('matches coupon-code promos when the code is presented', () => {
    const p = promo({
      id: 'a',
      kind: 'coupon-code',
      code: 'SAVE10',
      action: { type: 'fixed', value: 250 },
    });
    const result = selectBest(
      [p],
      { subtotalCents: 1000, lineProductIds: ['p'], appliedCouponCode: 'SAVE10' },
      now,
    );
    expect(result?.discountCents).toBe(250);
    expect(result?.code).toBe('SAVE10');
  });

  it('enforces cart-total-min condition', () => {
    const p = promo({
      id: 'a',
      condition: { type: 'cart-total-min', value: { minCents: 5000 } },
    });
    expect(selectBest([p], { subtotalCents: 4999, lineProductIds: [] }, now)).toBeNull();
    const r = selectBest([p], { subtotalCents: 5000, lineProductIds: [] }, now);
    expect(r?.discountCents).toBe(500); // 10% of 5000
  });

  it('enforces contains-product condition', () => {
    const p = promo({
      id: 'a',
      condition: { type: 'contains-product', value: { productId: 'p-target' } },
    });
    expect(
      selectBest([p], { subtotalCents: 1000, lineProductIds: ['other'] }, now),
    ).toBeNull();
    const r = selectBest([p], { subtotalCents: 1000, lineProductIds: ['p-target'] }, now);
    expect(r?.discountCents).toBe(100);
  });

  it('best-single: picks the larger discount among multiple candidates', () => {
    const a = promo({ id: 'a', action: { type: 'percent', value: 500 } }); // 5%
    const b = promo({ id: 'b', action: { type: 'percent', value: 2000 } }); // 20%
    const r = selectBest([a, b], { subtotalCents: 10_000, lineProductIds: ['p'] }, now);
    expect(r?.promotionId).toBe('b');
    expect(r?.discountCents).toBe(2000);
  });

  it('best-single: ties broken by lexicographic promotion id', () => {
    const x = promo({ id: 'x', action: { type: 'fixed', value: 500 } });
    const a = promo({ id: 'a', action: { type: 'fixed', value: 500 } });
    const r = selectBest([x, a], { subtotalCents: 10_000, lineProductIds: ['p'] }, now);
    expect(r?.promotionId).toBe('a');
  });

  it('coupon vs automatic: coupon wins if it discounts more', () => {
    const auto = promo({ id: 'a', action: { type: 'percent', value: 500 } });
    const coupon = promo({
      id: 'c',
      kind: 'coupon-code',
      code: 'BIG',
      action: { type: 'percent', value: 2500 },
    });
    const r = selectBest(
      [auto, coupon],
      { subtotalCents: 10_000, lineProductIds: ['p'], appliedCouponCode: 'BIG' },
      now,
    );
    expect(r?.promotionId).toBe('c');
    expect(r?.discountCents).toBe(2500);
  });

  it('fixed-action: caps discount at subtotal (no negative grand total)', () => {
    const p = promo({ id: 'a', action: { type: 'fixed', value: 999_999 } });
    const r = selectBest([p], { subtotalCents: 500, lineProductIds: ['p'] }, now);
    expect(r?.discountCents).toBe(500);
  });
});
