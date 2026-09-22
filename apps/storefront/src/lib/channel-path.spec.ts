import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_SEGMENTS, splitChannelPrefix, withChannelPrefix } from './channel-path';

describe('splitChannelPrefix (C-19a)', () => {
  it.each([
    ['/trade/c/dresses', 'trade', '/c/dresses'],
    ['/trade/p/abc', 'trade', '/p/abc'],
    ['/trade/cart', 'trade', '/cart'],
    ['/trade', 'trade', '/'],
    ['/trade/', 'trade', '/'],
    ['/trade/api/suggest', 'trade', '/api/suggest'],
  ])('reads %s as channel %s, path %s', (pathname, channelKey, path) => {
    expect(splitChannelPrefix(pathname)).toEqual({ channelKey, path });
  });

  it.each(['/', '/c/dresses', '/p/abc', '/cart', '/orders/o-1', '/api/suggest'])(
    'reads %s as the default channel, untouched',
    (pathname) => {
      expect(splitChannelPrefix(pathname)).toEqual({ channelKey: null, path: pathname });
    },
  );

  it('never reads one of its own routes as a channel, even though every one is a legal key', () => {
    // `c`, `p`, `cart`, `orders` and `api` all match the api's key grammar, so
    // nothing but this list stops `/cart` meaning "the channel keyed cart".
    for (const segment of ROUTE_SEGMENTS) {
      expect(splitChannelPrefix(`/${segment}/x`).channelKey).toBeNull();
    }
  });

  it('leaves the key percent-encoded, as it arrived', () => {
    // The key goes on into a request header and an api path segment. Decoded,
    // `%0A` would become a line break inside the header and `%2F` a new
    // segment in the api's URL; encoded, it is only an unknown key, which the
    // api answers with a 404.
    expect(splitChannelPrefix('/%74rade/c/x')).toEqual({ channelKey: '%74rade', path: '/c/x' });
    expect(splitChannelPrefix('/a%2Fb/c/x')).toEqual({ channelKey: 'a%2Fb', path: '/c/x' });
  });
});

describe('withChannelPrefix (C-19a)', () => {
  it.each([
    [null, '/c/dresses', '/c/dresses'],
    [null, '/', '/'],
    ['trade', '/', '/trade'],
    ['trade', '/c/dresses', '/trade/c/dresses'],
    ['trade', '/?q=shirt', '/trade?q=shirt'],
    ['trade', '/c/dresses?page=2', '/trade/c/dresses?page=2'],
    ['trade', '/api/suggest?q=sh', '/trade/api/suggest?q=sh'],
  ])('puts %s in front of %s as %s', (channelKey, path, expected) => {
    expect(withChannelPrefix(channelKey, path)).toBe(expected);
  });

  it.each(['/trade/c/dresses', '/trade/p/abc', '/trade/cart', '/c/dresses', '/'])(
    'round-trips %s through split and prefix',
    (pathname) => {
      const { channelKey, path } = splitChannelPrefix(pathname);
      expect(withChannelPrefix(channelKey, path)).toBe(pathname);
    },
  );
});

/**
 * The first URL segments the app directory defines. A route group — `(shop)` —
 * adds nothing to the URL, so its children are first segments themselves.
 */
function firstSegments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => (/^\(.+\)$/.test(e.name) ? firstSegments(join(dir, e.name)) : [e.name]));
}

describe('ROUTE_SEGMENTS', () => {
  it('lists every top-level route the app directory defines', () => {
    // A route added without being listed would be read as a channel key: its
    // pages would ask the api for a channel of that name and render a 404.
    const routes = firstSegments(join(__dirname, '..', 'app')).sort();

    // Five, not "more than zero": a walk that stopped at `(shop)` would find
    // only `api`, and a list of one would still be compared honestly.
    expect(routes).toHaveLength(5);
    expect([...ROUTE_SEGMENTS].sort()).toEqual(routes);
  });
});
