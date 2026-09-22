/**
 * The storefront's channel grammar (C-19a).
 *
 *   /{channelKey}/…   a named channel:    /trade/c/dresses
 *   /…                the tenant default: /c/dresses
 *
 * Mirrors the api's `/api/{tenant}/{channelKey}/graphql`, where the default is
 * likewise the omitted segment rather than a reserved word — so a channel an
 * operator keys `default` is as reachable as any other.
 *
 * Pure and dependency-free on purpose: three callers need it and each runs
 * somewhere different — the middleware on the edge runtime, server components
 * in node, and the search bar in the browser.
 */

/**
 * The internal request header the middleware sets to the channel it read from
 * the path. Never trusted from outside: the middleware deletes any inbound
 * copy before deciding, so a client cannot name a channel by header that its
 * URL does not name.
 */
export const CHANNEL_KEY_HEADER = 'x-channel-key';

/**
 * The storefront's own first path segments, never read as a channel key.
 *
 * Channel keys match `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`, which admits
 * every one of these, so a channel keyed `cart` is unreachable by prefix —
 * `/cart` is the cart page. The api avoids the same collision by putting
 * tenants under a reserved `/api`; a storefront whose URLs a shopper reads
 * spends that segment on the channel instead, and records the cost in
 * CAVEATS. `channel-path.spec.ts` fails if a top-level route is added
 * without being listed here.
 */
export const ROUTE_SEGMENTS: ReadonlySet<string> = new Set(['api', 'c', 'cart', 'orders', 'p']);

export interface ChannelPath {
  /** The segment as it arrived, still percent-encoded; null for the default. */
  channelKey: string | null;
  /** The path the storefront's routes see, with the prefix removed. */
  path: string;
}

const FIRST_SEGMENT_RE = /^\/([^/]+)(\/.*)?$/;

/**
 * Reads the channel off a pathname. Whether the key names a real channel is
 * not decided here: the api answers that, and an unknown key is a `404`
 * rather than the default (see `resolveChannel`).
 */
export function splitChannelPrefix(pathname: string): ChannelPath {
  const match = FIRST_SEGMENT_RE.exec(pathname);
  const first = match?.[1];
  if (!first || ROUTE_SEGMENTS.has(first)) {
    return { channelKey: null, path: pathname };
  }
  return { channelKey: first, path: match[2] ?? '/' };
}

/**
 * The inverse: a storefront path, under the prefix of the channel the current
 * page was reached through. A link that dropped the prefix would move the
 * shopper to the default channel on their next click.
 */
export function withChannelPrefix(channelKey: string | null, path: string): string {
  if (!channelKey) return path;
  if (path === '/') return `/${channelKey}`;
  // `/?q=shirt` is the home page with a query, not a path under it.
  if (path.startsWith('/?')) return `/${channelKey}${path.slice(1)}`;
  return `/${channelKey}${path}`;
}
