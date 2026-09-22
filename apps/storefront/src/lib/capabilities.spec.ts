/**
 * Money is formatted in the request's channel (C-19b).
 *
 * The tenant-level fields are deprecated aliases that answer for the default
 * channel whatever the request named (ADR-0014 §7). Reading them on `/trade`
 * would format with `uk`'s currency and locale — the display-level half of the
 * money bug G-4 was opened for — so the channel's own fields win.
 */
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('./tenant', () => ({ getTenantId: () => 't-fashion' }));

let answer: unknown;
jest.mock('./api-graphql', () => ({
  graphqlQuery: async () => answer,
}));

import { getMoneyFormat } from './capabilities';

describe('getMoneyFormat', () => {
  it("formats in the channel's currency and locale, not the default's aliases", async () => {
    // Every field differs between the two, so each one fails by name if it
    // follows the wrong source.
    answer = {
      capabilities: {
        currency: 'GBP',
        currencyMinorUnits: 2,
        defaultLocale: 'en-GB',
        channel: { key: 'jp', currency: 'JPY', currencyMinorUnits: 0, defaultLocale: 'ja-JP' },
      },
    };

    await expect(getMoneyFormat()).resolves.toEqual({
      currency: 'JPY',
      minorUnits: 0,
      locale: 'ja-JP',
    });
  });

  it('falls back to the tenant-level fields only for a tenant with no channel', async () => {
    answer = {
      capabilities: { currency: 'USD', currencyMinorUnits: 2, defaultLocale: 'en-US', channel: null },
    };

    await expect(getMoneyFormat()).resolves.toEqual({
      currency: 'USD',
      minorUnits: 2,
      locale: 'en-US',
    });
  });
});
