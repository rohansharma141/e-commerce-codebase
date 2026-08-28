import { createServer, request as httpRequest, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * URL-scoped GraphQL reads (C-2).
 *
 * Two things are under test, and only one of them is about routing.
 *
 *  1. The grammar works and the trust rule holds: `/api/{tenant}/graphql`
 *     reaches the same handler as `/graphql`, the URL segment is asserted
 *     against `x-tenant-id`, and a mismatch is a 400 in both directions.
 *
 *  2. The reason the grammar exists at all. `describe('cache keying')` below
 *     puts a proxy in front that keys on URL alone — the behaviour of a real
 *     CDN that ignores `Vary` over custom headers — and shows it serving one
 *     tenant's body to another through the unscoped path, then shows the
 *     scoped path making that impossible. Without that contrast this file
 *     would only assert that a rewrite rewrites.
 *
 * ── What these print if the change did nothing ────────────────────────────
 *
 * With the middleware removed, `/api/{tenant}/graphql` is not a route:
 *
 *   - "reaches the graphql handler"     fails: 404 rather than 200
 *   - "rejects a header/URL mismatch"   fails: 404 rather than 400
 *   - "a tenant named admin resolves"   fails: 404
 *   - "scoped paths cache separately"   fails: the second tenant is served
 *                                       the first's cached body, which is
 *                                       exactly the bug being prevented
 *
 * Requires the seeded docker stack; skipped when TEST_API_URL is unset.
 *
 *   TEST_API_URL=http://localhost:3000 pnpm nx test api --skipNxCache
 *
 * See the note in admin-conventions.integration.spec.ts about --skipNxCache
 * and about the per-tenant request throttle.
 */

const API_URL = process.env['TEST_API_URL'];
const describeLive = API_URL ? describe : describe.skip;

jest.setTimeout(30_000);

/** A query every tenant answers, including one that has never been seeded. */
const QUERY = '{ capabilities { tenantId currency } }';

interface GraphQLBody {
  readonly data?: { readonly capabilities?: { readonly tenantId?: string } };
  readonly errors?: unknown;
}

async function post(
  path: string,
  tenant: string | undefined,
): Promise<{ status: number; body: GraphQLBody }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (tenant !== undefined) headers['x-tenant-id'] = tenant;

  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: QUERY }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as GraphQLBody };
}

describeLive('URL-scoped GraphQL', () => {
  describe('grammar', () => {
    it('reaches the graphql handler and answers for the named tenant', async () => {
      const { status, body } = await post('/api/t-fashion/graphql', 't-fashion');
      expect(status).toBe(200);
      expect(body.errors).toBeUndefined();
      expect(body.data?.capabilities?.tenantId).toBe('t-fashion');
    });

    it('answers identically to the unscoped path', async () => {
      // One handler, reached two ways. If the scoped path were served by a
      // second Apollo registration the two could drift silently.
      const scoped = await post('/api/t-books/graphql', 't-books');
      const unscoped = await post('/graphql', 't-books');
      expect(scoped.status).toBe(200);
      expect(scoped.body).toEqual(unscoped.body);
    });

    it('leaves the unscoped path working, so the shipped storefront is unaffected', async () => {
      const { status, body } = await post('/graphql', 't-fashion');
      expect(status).toBe(200);
      expect(body.data?.capabilities?.tenantId).toBe('t-fashion');
    });

    it('works over GET, which is the whole point', async () => {
      // The storefront's reads are GET (H-3b moved them there so Next's data
      // cache would store them), and GET is the only method a shared cache
      // stores. A scoped path that only worked for POST would carry scope on
      // exactly the requests no cache keys.
      const qs = new URLSearchParams({ query: QUERY });
      const res = await fetch(`${API_URL}/api/t-fashion/graphql?${qs.toString()}`, {
        headers: { 'x-tenant-id': 't-fashion', 'apollo-require-preflight': 'true' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as GraphQLBody;
      expect(body.errors).toBeUndefined();
      expect(body.data?.capabilities?.tenantId).toBe('t-fashion');
    });

    it('asserts the tenant on GET too, query string and all', async () => {
      const qs = new URLSearchParams({ query: QUERY });
      const res = await fetch(`${API_URL}/api/t-books/graphql?${qs.toString()}`, {
        headers: { 'x-tenant-id': 't-fashion', 'apollo-require-preflight': 'true' },
      });
      expect(res.status).toBe(400);
    });

    it('preserves the cache headers the unscoped GET path sets', async () => {
      // graphql-cache.plugin.ts sets `vary: x-tenant-id` and a GET-only
      // `cache-control`. The rewrite must reach the same plugin, or scoped
      // reads would quietly become uncacheable and H-3b's work would be
      // undone for exactly the paths meant to be cached.
      const qs = new URLSearchParams({ query: QUERY });
      const headers = { 'x-tenant-id': 't-fashion', 'apollo-require-preflight': 'true' };
      const scoped = await fetch(`${API_URL}/api/t-fashion/graphql?${qs}`, { headers });
      const unscoped = await fetch(`${API_URL}/graphql?${qs}`, { headers });

      expect(scoped.headers.get('cache-control')).toBe(unscoped.headers.get('cache-control'));
      expect(scoped.headers.get('vary')).toBe(unscoped.headers.get('vary'));
      expect(scoped.headers.get('cache-control')).toBeTruthy();
    });

    it('a tenant named `admin` resolves as a tenant, not as the admin surface', async () => {
      // The whole reason `/api` is a reserved prefix. Tenant ids admit
      // `admin`, `health` and `graphql`; on a bare `/{tenant}/…` grammar this
      // request would 404 or, worse, route into the admin controllers.
      // `admin` is not a seeded tenant, so capabilities reports it unconfigured
      // — which is the correct answer and still proves the path resolved.
      const { status, body } = await post('/api/admin/graphql', 'admin');
      expect(status).toBe(200);
      expect(body.errors).toBeUndefined();
      expect(body.data?.capabilities?.tenantId).toBe('admin');
    });
  });

  describe('the URL never establishes identity', () => {
    it('rejects a header/URL mismatch', async () => {
      const { status } = await post('/api/t-books/graphql', 't-fashion');
      expect(status).toBe(400);
    });

    it('rejects the mismatch in the other direction too', async () => {
      // Asserted both ways round so the check cannot pass by comparing a
      // value against itself.
      const { status } = await post('/api/t-fashion/graphql', 't-books');
      expect(status).toBe(400);
    });

    it('does not silently prefer either side', async () => {
      // The dangerous near-miss: "prefer the header" would answer 200 with
      // t-fashion's data, turning a mismatch into an exploit rather than an
      // error. Assert no body came back at all.
      const { status, body } = await post('/api/t-books/graphql', 't-fashion');
      expect(status).toBe(400);
      expect(body.data).toBeUndefined();
    });

    it('reports a scope mismatch with the standard error envelope', async () => {
      const res = await fetch(`${API_URL}/api/t-books/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': 't-fashion' },
        body: JSON.stringify({ query: QUERY }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['statusCode']).toBe(400);
      expect(typeof body['message']).toBe('string');
    });

    it('falls through to the usual missing-header error, not a second dialect', async () => {
      const scoped = await post('/api/t-fashion/graphql', undefined);
      const unscoped = await post('/graphql', undefined);
      expect(scoped.status).toBe(400);
      expect(scoped.status).toBe(unscoped.status);
    });
  });

  /**
   * The argument for URL scoping, demonstrated rather than asserted.
   *
   * The proxy below caches on URL alone. That is not a straw man: `Vary` over
   * a custom request header is handled inconsistently by real CDNs, ranging
   * from ignoring it — serving one tenant's response to another, at a layer
   * the application cannot observe — to refusing to cache at all. CAVEATS
   * already records cross-tenant cache serving as the worst failure available
   * here.
   *
   * The api currently answers `cache-control: private`, so nothing shared
   * stores these responses today. This proxy ignores that header deliberately:
   * the test is what happens *if shared caching is ever enabled*, which is the
   * decision URL scoping is taken in advance of.
   */
  describe('cache keying', () => {
    let proxy: Server;
    let proxyUrl: string;
    const cache = new Map<string, { status: number; body: string }>();

    beforeAll(async () => {
      proxy = createServer((req, res) => {
        const key = req.url ?? '';
        const hit = cache.get(key);
        if (hit) {
          res.writeHead(hit.status, { 'content-type': 'application/json', 'x-cache': 'HIT' });
          res.end(hit.body);
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const upstream = new URL(`${API_URL}${key}`);
          const fwd = httpRequest(
            {
              hostname: upstream.hostname,
              port: upstream.port,
              path: upstream.pathname + upstream.search,
              method: req.method,
              headers: { ...req.headers, host: upstream.host },
            },
            (up) => {
              const out: Buffer[] = [];
              up.on('data', (c: Buffer) => out.push(c));
              up.on('end', () => {
                const body = Buffer.concat(out).toString('utf8');
                // Cache on URL only — no Vary, no cache-control. This is the
                // behaviour under test.
                cache.set(key, { status: up.statusCode ?? 200, body });
                res.writeHead(up.statusCode ?? 200, {
                  'content-type': 'application/json',
                  'x-cache': 'MISS',
                });
                res.end(body);
              });
            },
          );
          fwd.end(Buffer.concat(chunks));
        });
      });
      await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
      proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    });

    const viaProxy = async (path: string, tenant: string): Promise<GraphQLBody> => {
      const res = await fetch(`${proxyUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenant },
        body: JSON.stringify({ query: QUERY }),
      });
      return (await res.json()) as GraphQLBody;
    };

    it('THE BUG: on the unscoped path, one tenant is served the other from cache', async () => {
      cache.clear();
      const first = await viaProxy('/graphql', 't-fashion');
      const second = await viaProxy('/graphql', 't-books');

      expect(first.data?.capabilities?.tenantId).toBe('t-fashion');
      // Both requests share the cache key `/graphql`, so t-books receives
      // t-fashion's body. This assertion documents the failure; if it ever
      // stops holding, the demonstration below has lost its contrast and this
      // whole describe block needs rethinking rather than deleting.
      expect(second.data?.capabilities?.tenantId).toBe('t-fashion');
    });

    it('THE FIX: scoped paths are distinct cache keys, so each tenant gets its own', async () => {
      cache.clear();
      const first = await viaProxy('/api/t-fashion/graphql', 't-fashion');
      const second = await viaProxy('/api/t-books/graphql', 't-books');

      expect(first.data?.capabilities?.tenantId).toBe('t-fashion');
      expect(second.data?.capabilities?.tenantId).toBe('t-books');
      expect(cache.size).toBe(2);
    });
  });
});
