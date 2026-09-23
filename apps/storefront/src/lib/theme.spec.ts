/**
 * The frame renders even when the api answers nothing (C-19d).
 *
 * A tenant whose default channel is unservable has no channel to read in: the
 * theme read is refused like every other, and the discovery call before it.
 * The frame still has to draw, because the message inside it — that the market
 * is not open — is the one useful thing left to say.
 *
 * Pinned here rather than only live because the live reproduction needs a
 * tenant's default currency edited away from its price list, which is exactly
 * what C-37 is going to refuse.
 */
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('./tenant', () => ({ getTenantId: () => 't-fashion' }));

let answer: () => unknown;
jest.mock('./api-graphql', () => ({
  ...jest.requireActual('./api-graphql'),
  graphqlQuery: async () => answer(),
}));

import { GraphqlError } from './api-graphql';
import { ApiError } from './api-rest';
import { getTenantTheme } from './theme';

const THEME = {
  brandName: 'Vesper & Co.',
  tagline: 'Quietly considered apparel.',
  logoMark: '✦',
  brandHsl: '0 0% 0%',
  brandFgHsl: '0 0% 100%',
  pageBgHsl: '0 0% 100%',
  pageFgHsl: '0 0% 10%',
  fontSans: 'serif',
};

describe('getTenantTheme', () => {
  beforeEach(() => {
    answer = () => ({ theme: THEME });
  });

  it("returns the tenant's theme", async () => {
    await expect(getTenantTheme()).resolves.toEqual(THEME);
  });

  it('falls back to a neutral theme when the api refuses the read and it was asked to', async () => {
    answer = () => {
      throw new ApiError(422, '/system/capabilities', 'channel.unservable');
    };

    const theme = await getTenantTheme({ fallbackOnRefusal: true });
    expect(theme.brandName).toBe('Store');
    // Every field the layout writes into CSS variables must be present, or the
    // page renders with `--brand: undefined`.
    expect(Object.keys(theme).sort()).toEqual(Object.keys(THEME).sort());
  });

  it('throws when not asked to fall back, so a refusal is not hidden', async () => {
    answer = () => {
      throw new GraphqlError('HTTP 422', null, 422);
    };

    await expect(getTenantTheme()).rejects.toBeInstanceOf(GraphqlError);
  });

  it('throws on any other failure, even when asked to fall back', async () => {
    answer = () => {
      throw new GraphqlError('HTTP 500', null, 500);
    };

    await expect(getTenantTheme({ fallbackOnRefusal: true })).rejects.toBeInstanceOf(GraphqlError);
  });
});
