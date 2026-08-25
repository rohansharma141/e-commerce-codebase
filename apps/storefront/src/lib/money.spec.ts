import { formatMajorUnits, formatMinorUnits, formatMinorUnitsIn, type MoneyFormat } from './money';

const USD: MoneyFormat = { currency: 'USD', minorUnits: 2, locale: 'en-US' };
const JPY: MoneyFormat = { currency: 'JPY', minorUnits: 0, locale: 'ja-JP' };

/**
 * These pin the bug this module was written to remove: the storefront used to
 * divide every amount by 100 and format as en-US/USD regardless of what the
 * api said. That is invisible while every tenant is American and silently
 * wrong the moment one isn't.
 *
 * Assertions avoid exact symbol/space matching where ICU output varies by
 * Node version — the numeric part is what the scaling bug corrupts, so that
 * is what's asserted precisely.
 */
describe('formatMinorUnits', () => {
  it('scales by the currency exponent, not by a hardcoded 100', () => {
    expect(formatMinorUnits(19999, USD)).toContain('199.99');
    // The whole point: 1000 JPY is ¥1,000, not ¥10.
    expect(formatMinorUnits(1000, JPY)).toContain('1,000');
    expect(formatMinorUnits(1000, JPY)).not.toContain('10.00');
  });

  it('renders zero-decimal currencies without decimals', () => {
    expect(formatMinorUnits(1000, JPY)).not.toContain('.');
  });

  it('uses the advertised currency symbol', () => {
    expect(formatMinorUnits(500, USD)).toContain('$');
    expect(formatMinorUnits(500, JPY)).toContain('￥');
  });

  it('returns an em-dash for non-finite input rather than NaN', () => {
    expect(formatMinorUnits(Number.NaN, USD)).toBe('—');
    expect(formatMinorUnits(Number.POSITIVE_INFINITY, USD)).toBe('—');
  });

  it('handles zero', () => {
    expect(formatMinorUnits(0, USD)).toContain('0.00');
  });
});

describe('formatMajorUnits', () => {
  it('does not rescale — search attributes are already in major units', () => {
    expect(formatMajorUnits(199.99, USD)).toContain('199.99');
  });

  it('tolerates the junk a tenant-defined attribute can hold', () => {
    // A tenant may not define `price` at all, or may type it as a string.
    // The grid must not collapse.
    for (const junk of [undefined, null, 'free', {}, [], Number.NaN]) {
      expect(formatMajorUnits(junk, USD)).toBe('—');
    }
  });
});

describe('formatMinorUnitsIn', () => {
  it('prefers the currency named by the payload', () => {
    // Carts and orders each state their own currency. Today it always matches
    // the tenant's, but an order must never be relabelled if that changes.
    expect(formatMinorUnitsIn(1000, 'JPY', { ...JPY, currency: 'USD' })).toContain('￥');
  });

  it('falls back to the tenant format when the payload omits a currency', () => {
    expect(formatMinorUnitsIn(19999, undefined, USD)).toContain('199.99');
  });

  it('keeps the tenant exponent when the currency matches', () => {
    expect(formatMinorUnitsIn(19999, 'USD', USD)).toContain('199.99');
  });
});
