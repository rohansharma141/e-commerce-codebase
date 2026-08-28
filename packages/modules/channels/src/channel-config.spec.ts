import {
  InvalidCurrencyCodeError,
  minorUnitsFor,
  resolveChannelConfig,
  type Channel,
  type TenantDefaults,
} from '@platform/modules/channels/contracts';

/**
 * Inheritance resolution and currency exponent derivation.
 *
 * These live in `contracts/` (pure, dependency-free, reused by the repository,
 * the consuming read-models and the back office) and are tested from `src/`,
 * following `money-ops.spec.ts` — the same split the pricing module uses.
 *
 * The tests below assert both directions everywhere it is possible to: that an
 * omitted field inherits AND that a set field does not. A coalesce written the
 * wrong way round still passes a suite that only checks overrides.
 */

const DEFAULTS: TenantDefaults = {
  tenantId: 't-fashion',
  currencyCode: 'USD',
  defaultLocale: 'en-US',
  supportedLocales: ['en-US'],
  country: 'US',
  timezone: 'America/New_York',
  taxDisplay: 'net',
  taxRateBps: 875,
  version: 1,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};

/** A channel that overrides nothing — every config field null. */
const INHERITING: Channel = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 't-fashion',
  key: 'uk',
  name: 'United Kingdom',
  status: 'active',
  isDefault: false,
  hasTransacted: false,
  version: 1,
  currencyCode: null,
  defaultLocale: null,
  supportedLocales: null,
  country: null,
  timezone: null,
  taxDisplay: null,
  taxRateBps: null,
  externalRef: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};

describe('resolveChannelConfig', () => {
  it('a channel overriding nothing resolves entirely to tenant defaults', () => {
    const { config } = resolveChannelConfig(INHERITING, DEFAULTS);

    expect(config.currencyCode).toBe('USD');
    expect(config.defaultLocale).toBe('en-US');
    expect(config.supportedLocales).toEqual(['en-US']);
    expect(config.country).toBe('US');
    expect(config.timezone).toBe('America/New_York');
    expect(config.taxDisplay).toBe('net');
    expect(config.taxRateBps).toBe(875);
  });

  it('an override wins, and changes only its own field', () => {
    // The other direction. With the coalesce inverted this fails while the
    // inherit test above still passes, which is why both exist.
    const { config } = resolveChannelConfig(
      { ...INHERITING, currencyCode: 'GBP' },
      DEFAULTS,
    );

    expect(config.currencyCode).toBe('GBP');
    // Everything else still inherited — an override must not cascade.
    expect(config.defaultLocale).toBe('en-US');
    expect(config.country).toBe('US');
    expect(config.taxRateBps).toBe(875);
  });

  it('reports which fields were inherited, and which were not', () => {
    const { inherited } = resolveChannelConfig(
      { ...INHERITING, currencyCode: 'GBP', country: 'GB' },
      DEFAULTS,
    );

    expect(inherited.has('currencyCode')).toBe(false);
    expect(inherited.has('country')).toBe(false);
    expect(inherited.has('defaultLocale')).toBe(true);
    expect(inherited.has('timezone')).toBe(true);
  });

  it('distinguishes inherited from a value that merely equals the default', () => {
    // The reason provenance is tracked at all. Both channels resolve to 'USD';
    // only one of them will change when tenant defaults are edited, and the
    // back office has to render that difference.
    const implicit = resolveChannelConfig(INHERITING, DEFAULTS);
    const explicit = resolveChannelConfig(
      { ...INHERITING, currencyCode: 'USD' },
      DEFAULTS,
    );

    expect(implicit.config.currencyCode).toBe(explicit.config.currencyCode);
    expect(implicit.inherited.has('currencyCode')).toBe(true);
    expect(explicit.inherited.has('currencyCode')).toBe(false);
  });

  it('treats a null taxRateBps on the channel as inherit, not as "no tax"', () => {
    // taxRateBps is nullable on both sides, so this is the one genuinely
    // ambiguous field. It resolves as inherit, consistently with every other
    // field; "no tax" is expressed at tenant level.
    const { config, inherited } = resolveChannelConfig(INHERITING, DEFAULTS);
    expect(config.taxRateBps).toBe(875);
    expect(inherited.has('taxRateBps')).toBe(true);
  });

  it('carries a null tenant-level taxRateBps through as null', () => {
    const { config } = resolveChannelConfig(INHERITING, { ...DEFAULTS, taxRateBps: null });
    expect(config.taxRateBps).toBeNull();
  });

  it('lets a channel override a rate of 0, which is not the same as inheriting', () => {
    // The classic falsy-coalesce bug: `channel.taxRateBps || defaults.taxRateBps`
    // would silently give this channel 875 instead of 0 — a tax-free market
    // quietly charging 8.75%. Only an explicit null check gets this right.
    const { config, inherited } = resolveChannelConfig(
      { ...INHERITING, taxRateBps: 0 },
      DEFAULTS,
    );
    expect(config.taxRateBps).toBe(0);
    expect(inherited.has('taxRateBps')).toBe(false);
  });

  it('lets a channel override supportedLocales with a longer list', () => {
    const { config } = resolveChannelConfig(
      { ...INHERITING, supportedLocales: ['en-GB', 'cy-GB'] },
      DEFAULTS,
    );
    expect(config.supportedLocales).toEqual(['en-GB', 'cy-GB']);
  });

  it('copies identity and lifecycle straight off the channel, never the defaults', () => {
    const { config } = resolveChannelConfig(INHERITING, DEFAULTS);
    expect(config.channelId).toBe(INHERITING.id);
    expect(config.key).toBe('uk');
    expect(config.name).toBe('United Kingdom');
    expect(config.status).toBe('active');
    expect(config.isDefault).toBe(false);
  });

  it('derives minor units from the RESOLVED currency, not the tenant default', () => {
    // The failure this prevents: a JPY channel under a USD tenant rendering
    // every price a hundred times too small.
    const { config } = resolveChannelConfig(
      { ...INHERITING, currencyCode: 'JPY' },
      DEFAULTS,
    );
    expect(config.currencyCode).toBe('JPY');
    expect(config.currencyMinorUnits).toBe(0);
  });

  it('does not list currencyMinorUnits as inheritable', () => {
    // It is derived, not overridable. Listing it would invite a back office to
    // render an override affordance for a value nobody may set.
    const { inherited } = resolveChannelConfig(INHERITING, DEFAULTS);
    expect(inherited.has('currencyMinorUnits')).toBe(false);
  });
});

describe('minorUnitsFor', () => {
  it.each([
    ['USD', 2],
    ['EUR', 2],
    ['GBP', 2],
    ['JPY', 0],
    ['CLP', 0],
    // Three-decimal Gulf currencies. These are what a hand-maintained table
    // typically gets wrong, and the reason this derives from CLDR instead.
    ['KWD', 3],
    ['BHD', 3],
  ])('%s has %i minor units', (code, expected) => {
    expect(minorUnitsFor(code)).toBe(expected);
  });

  it('normalises case', () => {
    expect(minorUnitsFor('jpy')).toBe(0);
  });

  it.each(['', 'US', 'USDD', 'US1', '  ', 'US$'])(
    'rejects the malformed code %p',
    (code) => {
      expect(() => minorUnitsFor(code)).toThrow(InvalidCurrencyCodeError);
    },
  );

  it('KNOWN LIMIT: a well-formed but unassigned code silently yields 2', () => {
    // Pinned rather than left to be discovered. Intl reports the CLDR default
    // for codes it does not recognise instead of failing, so this function
    // cannot tell a typo from a real 2-decimal currency. Catching that is
    // write-time validation's job (C-8), not this function's.
    //
    // If a future runtime starts throwing here, this test failing is the
    // intended signal to revisit that boundary — not to delete the assertion.
    expect(minorUnitsFor('XYZ')).toBe(2);
  });
});
