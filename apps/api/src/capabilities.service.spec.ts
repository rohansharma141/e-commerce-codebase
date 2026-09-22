import { runWithTenant } from '@platform/shared/tenant-context';
import {
  NoDefaultChannelError,
  type ChannelConfig,
  type IChannelsQuery,
} from '@platform/modules/channels/contracts';
import type { ITenantConfigQuery, TenantConfig } from '@platform/modules/pricing/contracts';
import { CapabilitiesService } from './capabilities.module';

/**
 * C-18: capabilities describe the request's channel, and the deprecated
 * tenant-level fields keep answering for the tenant default.
 *
 * ── Why the second channel differs in EVERY field ─────────────────────────
 *
 * The row's negative control: an alias wired to the request's channel instead
 * of the default passes any test where the two channels agree. `jp` differs
 * from `uk` in key, currency, minor units, locale, country and timezone, so
 * each alias fails by name if it follows the wrong channel.
 *
 * ── What each prints if the change did nothing ────────────────────────────
 *
 *   - "describes the channel the request named"  — `channel` is undefined:
 *                                                  capabilities never learned
 *                                                  about channels
 *   - "aliases answer for the default"           — jp's values where uk's are
 *                                                  expected: the alias follows
 *                                                  the request
 *   - "minor units from the currency"            — 2 for KWD: the hand-kept
 *                                                  table's fallback is back
 *   - "tax from the price list"                  — 0: a channel's configured
 *                                                  rate advertised although
 *                                                  checkout charges 875
 */

const TENANT = 't-fashion';
const UK_ID = '11111111-1111-4111-8111-111111111111';
const JP_ID = '55555555-5555-4555-8555-555555555555';

const channel = (over: Partial<ChannelConfig>): ChannelConfig =>
  ({
    tenantId: TENANT,
    status: 'active',
    taxDisplay: 'net',
    taxRateBps: 875,
    ...over,
  }) as ChannelConfig;

const UK = channel({
  channelId: UK_ID,
  key: 'uk',
  name: 'United Kingdom',
  isDefault: true,
  currencyCode: 'GBP',
  currencyMinorUnits: 2,
  defaultLocale: 'en-GB',
  supportedLocales: ['en-GB'],
  country: 'GB',
  timezone: 'Europe/London',
});

const JP = channel({
  channelId: JP_ID,
  key: 'jp',
  name: 'Japan',
  isDefault: false,
  currencyCode: 'JPY',
  currencyMinorUnits: 0,
  defaultLocale: 'ja-JP',
  supportedLocales: ['ja-JP', 'en-GB'],
  country: 'JP',
  timezone: 'Asia/Tokyo',
  // A configured rate checkout does not charge (C-38).
  taxRateBps: 0,
});

const GBP_LIST: TenantConfig = {
  tenantId: TENANT,
  currency: 'GBP',
  taxRateBps: 875,
  locale: 'en-US', // the drifted pricing copy; a channel-aware answer ignores it
  updatedAt: '2026-09-22T00:00:00.000Z',
};

function service(opts: { config?: TenantConfig | null; defaultChannel?: ChannelConfig | Error } = {}) {
  const byId: Record<string, ChannelConfig> = { [UK_ID]: UK, [JP_ID]: JP };
  const defaultChannel = opts.defaultChannel ?? UK;
  const channels: IChannelsQuery = {
    findById: async (_t, id) => byId[id] ?? null,
    findDefault: async () => {
      if (defaultChannel instanceof Error) throw defaultChannel;
      return defaultChannel;
    },
    findByKey: async () => null,
    listActive: async () => [],
  };
  const config = opts.config === undefined ? GBP_LIST : opts.config;
  const tenantConfig = { findOptional: async () => config } as unknown as ITenantConfigQuery;
  return new CapabilitiesService(tenantConfig, channels);
}

const describeIn = (svc: CapabilitiesService, channelId?: string) =>
  runWithTenant({ tenantId: TENANT, requestId: 'r', channelId }, () => svc.describe());

describe('a request that names no channel', () => {
  it('describes the tenant default, and the deprecated fields agree with it', async () => {
    const caps = await describeIn(service());
    expect(caps.channel).toEqual({
      key: 'uk',
      name: 'United Kingdom',
      isDefault: true,
      currency: 'GBP',
      currencyMinorUnits: 2,
      defaultLocale: 'en-GB',
      locales: ['en-GB'],
      country: 'GB',
      timezone: 'Europe/London',
    });
    // The row's stated check: deprecated and new agree for the default channel.
    expect(caps.currency).toBe(caps.channel?.currency);
    expect(caps.currencyMinorUnits).toBe(caps.channel?.currencyMinorUnits);
    expect(caps.defaultLocale).toBe(caps.channel?.defaultLocale);
    expect(caps.locales).toEqual(caps.channel?.locales);
  });

  it('takes locale from the channel, not the drifted pricing copy', async () => {
    const caps = await describeIn(service());
    expect(caps.defaultLocale).toBe('en-GB'); // pricing says en-US
  });
});

describe('a request that names a channel', () => {
  it('describes the channel the request named', async () => {
    const caps = await describeIn(service(), JP_ID);
    expect(caps.channel).toMatchObject({
      key: 'jp',
      isDefault: false,
      currency: 'JPY',
      currencyMinorUnits: 0,
      defaultLocale: 'ja-JP',
      locales: ['ja-JP', 'en-GB'],
      country: 'JP',
      timezone: 'Asia/Tokyo',
    });
  });

  it('keeps every deprecated field answering for the default, not the named channel', async () => {
    const caps = await describeIn(service(), JP_ID);
    expect({
      currency: caps.currency,
      currencyMinorUnits: caps.currencyMinorUnits,
      defaultLocale: caps.defaultLocale,
      locales: caps.locales,
    }).toEqual({ currency: 'GBP', currencyMinorUnits: 2, defaultLocale: 'en-GB', locales: ['en-GB'] });
  });
});

describe('what stays tenant-level, and why', () => {
  it('reports the tax rate checkout charges, not a channel’s configured one', async () => {
    const caps = await describeIn(service(), JP_ID);
    expect(caps.taxRateBps).toBe(875);
  });
});

describe('a tenant with no channel at all (the C-35 gap)', () => {
  it('has no channel, and describes itself from its price list as it did before channels', async () => {
    const caps = await describeIn(service({ defaultChannel: new NoDefaultChannelError(TENANT) }));
    expect(caps.channel).toBeNull();
    expect(caps).toMatchObject({
      currency: 'GBP',
      currencyMinorUnits: 2,
      defaultLocale: 'en-US',
      configured: true,
    });
  });

  it('takes minor units from the currency itself, not a table with a fallback of 2', async () => {
    const kwd = { ...GBP_LIST, currency: 'KWD' };
    const caps = await describeIn(
      service({ config: kwd, defaultChannel: new NoDefaultChannelError(TENANT) }),
    );
    expect(caps.currencyMinorUnits).toBe(3);
  });

  it('falls back to platform defaults, flagged unconfigured, with no price list either', async () => {
    const caps = await describeIn(
      service({ config: null, defaultChannel: new NoDefaultChannelError(TENANT) }),
    );
    expect(caps).toMatchObject({ currency: 'USD', configured: false, channel: null });
  });

  it('does not mistake any other failure for "no channel"', async () => {
    const boom = new Error('connection terminated');
    await expect(describeIn(service({ defaultChannel: boom }))).rejects.toBe(boom);
  });
});
