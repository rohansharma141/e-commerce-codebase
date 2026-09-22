/**
 * What the middleware hands the routes (C-19a).
 *
 * Next applies a middleware's decisions through response headers it reads
 * back before routing: `x-middleware-rewrite` names the path the routes see,
 * `x-middleware-override-headers` lists every request header the routes will
 * receive — anything absent from it is dropped — and
 * `x-middleware-request-<name>` carries each value. Those are what is asserted
 * here, because they are the whole of what the rest of the app can observe.
 */
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const ORIGIN = 'http://t-fashion.localhost:3001';

function run(path: string, headers: Record<string, string> = {}) {
  const req = new NextRequest(`${ORIGIN}${path}`, {
    headers: { host: 't-fashion.localhost:3001', ...headers },
  });
  const res = middleware(req);
  const rewrite = res.headers.get('x-middleware-rewrite');
  const forwarded = (res.headers.get('x-middleware-override-headers') ?? '').split(',');
  return {
    res,
    /** The path the routes render, or null when the request was not rewritten. */
    routedTo: rewrite ? new URL(rewrite).pathname + new URL(rewrite).search : null,
    /** The channel header the routes will read, or null if they get none. */
    channel: forwarded.includes('x-channel-key')
      ? res.headers.get('x-middleware-request-x-channel-key')
      : null,
    tenant: res.headers.get('x-middleware-request-x-tenant-id'),
  };
}

describe('middleware channel prefix (C-19a)', () => {
  it('routes /trade/c/dresses to the category page, in channel trade', () => {
    const { routedTo, channel, tenant } = run('/trade/c/dresses');
    expect(routedTo).toBe('/c/dresses');
    expect(channel).toBe('trade');
    expect(tenant).toBe('t-fashion');
  });

  it('routes a bare prefix to the home page, keeping the query', () => {
    const { routedTo, channel } = run('/trade?q=shirt');
    expect(routedTo).toBe('/?q=shirt');
    expect(channel).toBe('trade');
  });

  it('leaves an unprefixed path alone, with no channel: the tenant default', () => {
    const { routedTo, channel, tenant } = run('/c/dresses');
    expect(routedTo).toBeNull();
    expect(channel).toBeNull();
    expect(tenant).toBe('t-fashion');
  });

  it('drops a channel header the client sent, so only the path can name a channel', () => {
    // Without the delete, this request would reach the routes in `de` under
    // the default channel's URL — and any cache keyed on that URL would keep
    // `de`'s answer for every later shopper.
    const { channel } = run('/c/dresses', { 'x-channel-key': 'de' });
    expect(channel).toBeNull();
  });

  it('lets the path win over a client-sent channel header', () => {
    const { channel } = run('/trade/c/dresses', { 'x-channel-key': 'de' });
    expect(channel).toBe('trade');
  });

  it('never reads its own routes as a channel', () => {
    expect(run('/cart').channel).toBeNull();
    expect(run('/orders/o-1').channel).toBeNull();
    expect(run('/api/suggest?q=sh').channel).toBeNull();
  });

  it('sets the CSP whether or not it rewrites', () => {
    // A rewrite builds a different response object; forgetting the policy on
    // that branch would ship every channel page without one.
    expect(run('/trade/c/dresses').res.headers.get('content-security-policy')).toContain('nonce-');
    expect(run('/c/dresses').res.headers.get('content-security-policy')).toContain('nonce-');
  });
});
