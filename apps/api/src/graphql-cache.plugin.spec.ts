import type { GraphQLRequestContextWillSendResponse } from '@apollo/server';
import { VARY, graphqlCachePlugin } from './graphql-cache.plugin';

/**
 * The GraphQL cache headers (H-3b, extended by C-4).
 *
 * This plugin had no spec until C-4. It is four lines, and every one of them
 * is load-bearing for a failure that looks like a fast, working site: a
 * missing `Vary` serves one tenant's catalogue to another, and since C-12 it
 * would serve one channel's EUR prices to a shopper on the GBP channel of the
 * same tenant. The live specs already compare scoped against unscoped headers;
 * this pins the *values* so a regression cannot pass by regressing both sides
 * equally.
 *
 * ── What each prints if the plugin did nothing ────────────────────────────
 *
 *   - "names both scope headers"            — `vary` is unset
 *   - "on POST as well as GET"              — the POST branch has no `vary`,
 *                                             which is exactly the branch a
 *                                             reader assumes does not matter
 *   - "cache-control on GET only"           — a POST answered `private`
 *                                             instead of Apollo's `no-store`,
 *                                             letting a mutation's response be
 *                                             stored
 *   - "does not touch cache-control on POST" — same, from the other side
 */

type Ctx = GraphQLRequestContextWillSendResponse<Record<string, unknown>>;

/** The smallest object Apollo's hook actually reads from. */
function fakeContext(method: 'GET' | 'POST'): {
  ctx: Ctx;
  headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  const ctx = {
    request: { http: { method } },
    response: { http: { headers } },
  } as unknown as Ctx;
  return { ctx, headers };
}

async function send(method: 'GET' | 'POST'): Promise<Map<string, string>> {
  const listeners = await graphqlCachePlugin.requestDidStart!(
    {} as never,
  );
  const { ctx, headers } = fakeContext(method);
  await listeners!.willSendResponse!(ctx);
  return headers;
}

describe('Vary', () => {
  it('names both scope headers', async () => {
    const headers = await send('GET');
    const vary = headers.get('vary') ?? '';
    // Order-insensitive: `Vary` is a list, and a reader comparing strings
    // would break on a harmless reorder while missing a genuinely absent name.
    const names = vary.split(',').map((s) => s.trim().toLowerCase()).sort();
    expect(names).toEqual(['x-channel-id', 'x-tenant-id']);
  });

  it('is emitted on POST as well as GET', async () => {
    // The branch that "does not matter" because POST is uncacheable anyway.
    // It matters because it means scope isolation never depends on someone
    // remembering which branch they are in.
    const headers = await send('POST');
    expect(headers.get('vary')).toBe(VARY);
  });

  it('the exported constant is what is actually sent', async () => {
    // The storefront spec and the scoped-read spec assert against VARY. If the
    // plugin ever set a literal instead, they would be asserting a value the
    // api no longer emits.
    const headers = await send('GET');
    expect(headers.get('vary')).toBe(VARY);
  });
});

describe('cache-control', () => {
  it('replaces no-store on GET, so Next can store the response', async () => {
    const headers = await send('GET');
    expect(headers.get('cache-control')).toBe('private, max-age=0');
  });

  it('does not touch cache-control on POST', async () => {
    // A GET is a read by construction -- Apollo rejects mutations over GET --
    // so it is the only shape safe to describe as cacheable without inspecting
    // the operation. Describing a POST as cacheable lets a mutation's response
    // be stored.
    const headers = await send('POST');
    expect(headers.has('cache-control')).toBe(false);
  });
});
