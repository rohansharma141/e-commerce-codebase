import type { Sql } from 'postgres';

/**
 * Channel fixtures (C-11a).
 *
 * The tenants are fixtures we generate, so the seed writes real values rather
 * than deriving them. Gate G-3 closed on exactly this: careful
 * data-preservation machinery for rows we can regenerate at will was the wrong
 * instinct, and it was in an earlier draft of the design.
 *
 * **`t-fashion` gets TWO channels, and that is not decoration.** ADR-0014's
 * negative control for channel resolution is *"two channels with different
 * currencies; assert responses differ"* — because one channel per tenant passes
 * even if resolution is hardcoded to the default. Three identical `USD`/`en-US`
 * tenants cannot fail that check. `t-fashion` is what makes C-12, C-18 and
 * C-19 falsifiable, and it exercises a different currency, locale, country and
 * timezone in a single fixture.
 *
 * The default channel is the one an unscoped request resolves to, so each
 * tenant gets exactly one and it is `active`.
 */

export interface ChannelFixture {
  readonly key: string;
  readonly name: string;
  readonly isDefault: boolean;
  /** null on any field means inherit from the tenant defaults below. */
  readonly currencyCode: string | null;
  readonly defaultLocale: string | null;
  readonly supportedLocales: readonly string[] | null;
  readonly country: string | null;
  readonly timezone: string | null;
}

export interface TenantDefaultsFixture {
  readonly currencyCode: string;
  readonly defaultLocale: string;
  readonly supportedLocales: readonly string[];
  readonly country: string;
  readonly timezone: string;
  readonly taxDisplay: 'gross' | 'net';
  readonly taxRateBps: number;
}

/**
 * `taxDisplay` is `net` for every tenant, because that is what the pricing
 * engine is configured to do here. C-29 taught it `gross`, but until C-30 makes
 * the field editable and removes the `EXCLUSIVE` hardcode from capabilities,
 * seeding a `gross` tenant would advertise a presentation the API does not yet
 * report. A fixture that lies is worse than a fixture that is dull.
 */
export const TENANT_DEFAULTS: Record<string, TenantDefaultsFixture> = {
  't-fashion': {
    currencyCode: 'GBP',
    defaultLocale: 'en-GB',
    supportedLocales: ['en-GB'],
    country: 'GB',
    timezone: 'Europe/London',
    taxDisplay: 'net',
    taxRateBps: 875,
  },
  't-electronics': {
    currencyCode: 'USD',
    defaultLocale: 'en-US',
    supportedLocales: ['en-US'],
    country: 'US',
    timezone: 'America/New_York',
    taxDisplay: 'net',
    taxRateBps: 625,
  },
  't-books': {
    currencyCode: 'USD',
    defaultLocale: 'en-US',
    supportedLocales: ['en-US'],
    country: 'US',
    timezone: 'America/New_York',
    taxDisplay: 'net',
    taxRateBps: 0,
  },
};

export const CHANNELS_BY_TENANT: Record<string, readonly ChannelFixture[]> = {
  // Two channels, differing in currency AND locale AND country AND timezone.
  // `uk` inherits everything (proving inheritance resolves); `de` overrides
  // everything (proving an override wins). One fixture, both directions.
  't-fashion': [
    {
      key: 'uk',
      name: 'United Kingdom',
      isDefault: true,
      currencyCode: null,
      defaultLocale: null,
      supportedLocales: null,
      country: null,
      timezone: null,
    },
    {
      key: 'de',
      name: 'Germany',
      isDefault: false,
      currencyCode: 'EUR',
      defaultLocale: 'de-DE',
      supportedLocales: ['de-DE'],
      country: 'DE',
      timezone: 'Europe/Berlin',
    },
  ],
  't-electronics': [
    {
      key: 'us',
      name: 'United States',
      isDefault: true,
      currencyCode: null,
      defaultLocale: null,
      supportedLocales: null,
      country: null,
      timezone: null,
    },
  ],
  't-books': [
    {
      key: 'us',
      name: 'United States',
      isDefault: true,
      currencyCode: null,
      defaultLocale: null,
      supportedLocales: null,
      country: null,
      timezone: null,
    },
  ],
};

export interface ChannelsSeedSummary {
  readonly tenantId: string;
  readonly channels: number;
  readonly defaultKey: string;
}

/**
 * Writes the tenant defaults and channels for one tenant.
 *
 * Assumes `app.tenant_id` is already bound on this connection — the caller
 * binds it once for the whole tenant, the same pattern the pricing seed uses.
 * Without it the RLS `WITH CHECK` clause rejects every insert, which is the
 * correct behaviour and a confusing failure if you have forgotten why.
 *
 * Wipes and re-populates so the seed is repeatable. The delete is scoped by
 * RLS to the bound tenant, not by an explicit WHERE — relying on the policy
 * here is deliberate, since it is the same mechanism the request path uses.
 */
export async function seedChannelsForTenant(
  tenantId: string,
  sql: Sql,
): Promise<ChannelsSeedSummary> {
  const defaults = TENANT_DEFAULTS[tenantId];
  const fixtures = CHANNELS_BY_TENANT[tenantId];
  if (!defaults || !fixtures) {
    throw new Error(
      `no channel fixtures for tenant "${tenantId}". Add them to channels-seed.ts — ` +
        `a tenant without a default channel resolves no requests at all.`,
    );
  }

  await sql`DELETE FROM channels.channels`;
  await sql`DELETE FROM channels.tenant_defaults`;

  await sql`
    INSERT INTO channels.tenant_defaults
      (tenant_id, currency_code, default_locale, supported_locales, country, timezone,
       tax_display, tax_rate_bps, updated_at)
    VALUES
      (${tenantId}, ${defaults.currencyCode}, ${defaults.defaultLocale},
       ${sql.array([...defaults.supportedLocales])}, ${defaults.country}, ${defaults.timezone},
       ${defaults.taxDisplay}, ${defaults.taxRateBps}, now())
  `;

  for (const c of fixtures) {
    await sql`
      INSERT INTO channels.channels
        (tenant_id, key, name, status, is_default, currency_code, default_locale,
         supported_locales, country, timezone, updated_at)
      VALUES
        (${tenantId}, ${c.key}, ${c.name}, 'active', ${c.isDefault},
         ${c.currencyCode}, ${c.defaultLocale},
         ${c.supportedLocales ? sql.array([...c.supportedLocales]) : null},
         ${c.country}, ${c.timezone}, now())
    `;
  }

  const defaultKey = fixtures.find((c) => c.isDefault)?.key;
  if (!defaultKey) {
    // Guarded rather than assumed: the partial unique index enforces *at most*
    // one default, and nothing in the database enforces at least one.
    throw new Error(`channel fixtures for "${tenantId}" declare no default channel`);
  }

  return { tenantId, channels: fixtures.length, defaultKey };
}
