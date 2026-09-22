/**
 * Which channel every api call names (C-19b).
 *
 * The api is going to stop treating an absent channel as the default (C-42,
 * ADR-0014 §8 as amended), so an unprefixed page has to name the default by
 * its key. These pin where that key comes from, and that asking for it is not
 * itself a scoped request — discovery cannot require what it discovers.
 */
jest.mock('server-only', () => ({}), { virtual: true });

let pathChannel: string | null = null;
jest.mock('next/headers', () => ({
  headers: () => ({
    get: (name: string) => (name === 'x-channel-key' ? pathChannel : null),
  }),
}));
jest.mock('./tenant', () => ({ getTenantId: () => 't-fashion' }));

import { ApiError } from './api-rest';
import { requestChannelKey } from './channel-key';

function mockFetch(body: unknown, status = 200): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('requestChannelKey', () => {
  beforeEach(() => {
    pathChannel = null;
  });

  it('uses the key the path named, without asking the api', async () => {
    const fetchMock = mockFetch({});
    pathChannel = 'trade';

    await expect(requestChannelKey()).resolves.toBe('trade');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the default by its key on an unprefixed page, learned from /system/capabilities', async () => {
    const fetchMock = mockFetch({ channel: { key: 'uk', isDefault: true } });

    await expect(requestChannelKey()).resolves.toBe('uk');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { next?: { tags?: string[] } }];
    expect(new URL(url).pathname).toBe('/system/capabilities');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-tenant-id']).toBe('t-fashion');
    // The discovery read is the one that names no channel. Sending one would
    // make it ask about a channel it has not found yet.
    expect(headers['x-channel-id']).toBeUndefined();
    // Cached under the tag `channels.default-changed` drops, so a new default
    // reaches unprefixed pages at once rather than after the hourly fallback.
    expect(init.next?.tags).toEqual(['capabilities:t-fashion']);
  });

  it('is null only for a tenant with no channel at all', async () => {
    mockFetch({ channel: null });

    await expect(requestChannelKey()).resolves.toBeNull();
  });

  it('surfaces a refused discovery with its status, rather than reading unscoped', async () => {
    // A default channel the price list cannot serve (C-32b) refuses the whole
    // unprefixed storefront. Falling back to an unscoped read would serve it
    // anyway — the refusal C-32b exists to make.
    mockFetch({ message: 'channel.unservable' }, 422);

    await expect(requestChannelKey()).rejects.toBeInstanceOf(ApiError);
    await expect(requestChannelKey()).rejects.toMatchObject({ status: 422 });
  });
});
