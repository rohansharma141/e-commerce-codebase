import { mulBps, clampNonNegative } from '@platform/modules/pricing/contracts';

describe('mulBps', () => {
  it('handles round numbers', () => {
    expect(mulBps(10_000, 875)).toBe(875); // 8.75% of $100.00
    expect(mulBps(10_000, 1000)).toBe(1000);
    expect(mulBps(10_000, 10_000)).toBe(10_000); // 100%
  });

  it('returns 0 on zero inputs', () => {
    expect(mulBps(0, 1234)).toBe(0);
    expect(mulBps(1234, 0)).toBe(0);
  });

  it('rounds half-to-even on exact .5 — the banker\'s-rounding pin', () => {
    // sentinel from the comment in money-ops.ts
    // 125 * 50 / 10000 = 0.625 → not exactly .5, rounds DOWN per standard
    expect(mulBps(125, 50)).toBe(1); // 0.625 → rounds up (>0.5)
    // True .5 cases: choose values whose product mod 10000 === 5000 exactly.
    // e.g. 100 * 50 = 5000; 5000 / 10000 = 0.5; should round to 0 (even).
    expect(mulBps(100, 50)).toBe(0);
    // 300 * 50 = 15000; / 10000 = 1.5; rounds to 2 (even).
    expect(mulBps(300, 50)).toBe(2);
    // 500 * 50 = 25000; / 10000 = 2.5; rounds to 2 (even).
    expect(mulBps(500, 50)).toBe(2);
    // 700 * 50 = 35000; / 10000 = 3.5; rounds to 4 (even).
    expect(mulBps(700, 50)).toBe(4);
  });

  it('handles large amounts without float drift (BigInt-backed)', () => {
    // 100_000_000 cents (= $1,000,000.00) at 8875 bps (8.875%)
    //   = 100_000_000 * 8875 / 10_000 = 88_750_000 cents = $887,500.00
    expect(mulBps(100_000_000, 8875)).toBe(88_750_000);
  });

  it('refuses non-integer inputs', () => {
    expect(() => mulBps(1.5, 100)).toThrow(/integer/);
    expect(() => mulBps(100, 1.5)).toThrow(/integer/);
  });
});

describe('clampNonNegative', () => {
  it('passes through positives', () => {
    expect(clampNonNegative(5)).toBe(5);
    expect(clampNonNegative(0)).toBe(0);
  });
  it('clamps negatives to 0', () => {
    expect(clampNonNegative(-1)).toBe(0);
    expect(clampNonNegative(-9999)).toBe(0);
  });
});
