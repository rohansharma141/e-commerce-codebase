import { randomUUID } from 'node:crypto';

/**
 * Admin API conventions conformance (C-1).
 *
 * The conventions in docs/design/ADMIN-API.md are only real if the admin
 * surface obeys them. This file is what makes that true rather than stated:
 * it walks every admin list endpoint and asserts the same properties of each,
 * so "we use cursor pagination" cannot mean "one endpoint does".
 *
 * Why it runs over HTTP rather than against repositories, unlike
 * checkout.integration.spec.ts: the conventions ARE the HTTP surface. A
 * controller that accepts `cursor` and never passes it down is exactly the
 * bug this catches, and a repository-level test cannot see it.
 *
 * ── What each assertion prints if the change did nothing ──────────────────
 *
 * Before C-1's migration, four of the five endpoints return a bare
 * `{ items }` with no cursor support at all, so:
 *
 *   - "exposes { items, nextCursor }"        fails: nextCursor is undefined
 *   - "honours limit"                        fails on promotions and
 *                                            attribute-definitions, which
 *                                            ignore `limit` entirely
 *   - "offers a cursor when more rows remain" fails: nextCursor is undefined
 *   - "second page does not repeat the first" fails: there is no second page
 *   - "cursor walk agrees with a single read" fails for the same reason
 *
 * That was confirmed by running this file against the unmigrated surface
 * before writing a line of the migration: 16 failed, 22 passed, with
 * /admin/products — which already conformed — passing everything.
 *
 * Each is parameterised by endpoint, so removing one endpoint from the
 * migration turns the suite red on exactly that endpoint by name rather than
 * failing somewhere generic. That is the property the backlog asks for.
 *
 * ── Ordering, and what these checks do and do not prove ───────────────────
 *
 * Cursor pagination is meaningless without a total order: keyset paging over
 * an unordered scan silently skips and repeats rows. Three of these endpoints
 * had no ORDER BY at all before C-1.
 *
 * "cursor walk agrees with a single read" is the check aimed at that. It does
 * not *prove* a total order exists — Postgres may return an unordered scan in
 * a stable sequence by luck, particularly on a small table. What it does is
 * fail loudly when the two disagree, which is the observable symptom. The
 * guarantee itself comes from the ORDER BY in the repository; this is the
 * regression net under it.
 *
 * ── Running it ────────────────────────────────────────────────────────────
 *
 *   TEST_API_URL=http://localhost:3000 pnpm nx test api --skipNxCache
 *
 * `--skipNxCache` is not optional when you have run `pnpm nx test api`
 * without the variable first. Nx caches `test` on file inputs only — env vars
 * are not part of the cache key — so a cached "skipped" run replays as a pass
 * and this suite silently never executes.
 *
 * It costs 79 requests against a 200/min per-tenant throttle. Running it twice
 * in a minute, or alongside the storefront conformance suite and some manual
 * curl, exhausts the budget — and a 429 read as an ordinary response makes
 * healthy endpoints look broken. That misdiagnosis happened twice while this
 * file was being written, which is why `get()` raises on 429 by name.
 *
 * Needs the seeded docker stack. Do NOT run in the same invocation as the
 * module integration suites: they drop and rebuild the catalog, pricing and
 * orders schemas, which deletes the rows this suite pages through. Run those,
 * re-run `pnpm seed`, then run this.
 */

const API_URL = process.env['TEST_API_URL'];
const TENANT = process.env['TEST_TENANT_ID'] ?? 't-fashion';

const describeLive = API_URL ? describe : describe.skip;

jest.setTimeout(60_000);

interface ListResponse {
  readonly items?: readonly Record<string, unknown>[];
  readonly nextCursor?: string | null;
}

interface ListEndpoint {
  /** Route under test. */
  readonly path: string;
  /**
   * Stable identity of a row, used to detect repeats across pages.
   *
   * `pricing.prices` is keyed on (tenant_id, product_id) and has no `id`
   * column, so it identifies — and cursors — on productId. That asymmetry is
   * a property of the table, not an oversight; ADMIN-API.md records it.
   */
  readonly idOf: (item: Record<string, unknown>) => string;
}

const LIST_ENDPOINTS: readonly ListEndpoint[] = [
  // Added by C-10. This is C-10's stated verification: a new endpoint must
  // satisfy the conventions rather than the conventions being restated for it.
  //
  // It needs at least two rows, which is why it could only be added once
  // C-11a's seed wrote channel fixtures — and it is `t-fashion` specifically
  // that has two, since every other tenant seeds one. A single-channel tenant
  // would make the pagination assertions unfalsifiable here for the same
  // reason it makes channel resolution unfalsifiable in C-12.
  { path: '/admin/channels', idOf: (i) => String((i['config'] as Record<string, unknown>)['key']) },
  { path: '/admin/products', idOf: (i) => String(i['id']) },
  { path: '/admin/orders', idOf: (i) => String(i['id']) },
  { path: '/admin/prices', idOf: (i) => String(i['productId']) },
  { path: '/admin/promotions', idOf: (i) => String(i['id']) },
  { path: '/admin/attribute-definitions', idOf: (i) => String(i['id']) },
];

async function get<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'x-tenant-id': TENANT, ...(init.headers ?? {}) },
  });
  // The api throttles at 200 requests per minute per tenant. This suite is
  // request-heavy by nature, and a 429 read as an ordinary response makes a
  // healthy endpoint look non-conforming — an early run of this file "found"
  // two failures in /admin/products that were nothing but exhausted budget.
  // Say so instead of letting it surface as a shape assertion.
  if (res.status === 429) {
    throw new Error(
      `${path} returned 429 (rate limited). The api allows 200 req/min per ` +
        `tenant; this suite costs 79 (measured, not estimated). Two runs plus ` +
        `the storefront conformance suite inside one window exceeds it. Wait a ` +
        `minute and re-run.`,
    );
  }
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

async function page(
  path: string,
  limit: number,
  cursor?: string | null,
): Promise<ListResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  const { status, body } = await get<ListResponse>(`${path}?${qs.toString()}`);
  expect(status).toBe(200);
  return body;
}

/** Pages through `path` one row at a time, returning ids in visit order. */
async function walk(
  ep: ListEndpoint,
  maxPages: number,
): Promise<{ ids: string[]; exhausted: boolean }> {
  const ids: string[] = [];
  let cursor: string | null | undefined;

  for (let i = 0; i < maxPages; i += 1) {
    const body: ListResponse = await page(ep.path, 1, cursor);
    for (const item of body.items ?? []) ids.push(ep.idOf(item));
    cursor = body.nextCursor;
    if (!cursor) return { ids, exhausted: true };
  }
  return { ids, exhausted: false };
}

describeLive('admin API conventions', () => {
  beforeAll(async () => {
    // Fail on the real cause rather than twenty assertions deep. An empty
    // list here almost always means the seed has not run, or a module
    // integration suite dropped the schemas after it did.
    for (const ep of LIST_ENDPOINTS) {
      const { status, body } = await get<ListResponse>(ep.path);
      if (status !== 200) {
        throw new Error(`${ep.path} returned ${status}; is the api at ${API_URL} up?`);
      }
      const count = body.items?.length ?? 0;
      if (count < 2) {
        throw new Error(
          `${ep.path} has ${count} row(s) for tenant "${TENANT}". This suite pages ` +
            `through them, so it needs at least 2. Run \`pnpm seed\`.`,
        );
      }
    }
  });

  describe.each(LIST_ENDPOINTS.map((ep) => [ep.path, ep] as const))(
    '%s',
    (_path, ep: ListEndpoint) => {
      it('exposes { items, nextCursor }', async () => {
        const { body } = await get<ListResponse>(ep.path);
        expect(Array.isArray(body.items)).toBe(true);
        // Presence, not truthiness: a fully-read list correctly reports null.
        // `toBeDefined()` alone would pass on a body that omits the key.
        expect(Object.prototype.hasOwnProperty.call(body, 'nextCursor')).toBe(true);
        expect(
          body.nextCursor === null || typeof body.nextCursor === 'string',
        ).toBe(true);
      });

      it('honours limit', async () => {
        const body = await page(ep.path, 1);
        expect(body.items).toHaveLength(1);
      });

      it('offers a cursor when more rows remain', async () => {
        const body = await page(ep.path, 1);
        // Guarded by beforeAll: every endpoint has at least 2 rows, so a
        // 1-row page always has a successor.
        expect(typeof body.nextCursor).toBe('string');
      });

      it('second page does not repeat the first', async () => {
        const first = await page(ep.path, 1);
        expect(first.nextCursor).toBeTruthy();

        const second = await page(ep.path, 1, first.nextCursor);
        const firstIds = (first.items ?? []).map(ep.idOf);
        const secondIds = (second.items ?? []).map(ep.idOf);

        expect(secondIds).not.toHaveLength(0);
        expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
      });

      it('cursor walk agrees with a single read, and repeats no row', async () => {
        // One walk, two assertions, because each page costs a request and the
        // api throttles per tenant. Splitting these into two tests doubled the
        // walk traffic for no extra coverage.
        const walked = await walk(ep, 4);

        // The walk must actually have walked. Without this, an endpoint that
        // offers no cursor stops after one page and then trivially "agrees"
        // with a one-row read — the assertions below would pass on exactly
        // the surface this suite exists to reject.
        expect(walked.ids.length).toBeGreaterThan(1);

        const single = await page(ep.path, walked.ids.length);
        const singleIds = (single.items ?? []).map(ep.idOf);

        // No repeats: the symptom of paging over an unordered scan.
        expect(new Set(walked.ids).size).toBe(walked.ids.length);
        // Same rows, same sequence. Divergence means paging and reading
        // disagree about the order, which is what a missing ORDER BY looks
        // like from outside.
        expect(walked.ids).toEqual(singleIds);
      });

      it('rejects a malformed cursor instead of silently restarting', async () => {
        // Falling back to page one is the failure mode where a paginating
        // client loops over the first page forever, and every individual
        // response looks perfectly healthy while it does.
        const { status } = await get<unknown>(`${ep.path}?cursor=not-a-real-cursor`);
        expect(status).toBe(400);
      });

      it('a fully-walked list ends with a null cursor', async () => {
        // Only meaningful where the list is small enough to exhaust. Large
        // ones (products, prices) are covered by the checks above.
        const probe = await page(ep.path, 100);
        if (probe.nextCursor) return;

        const total = (probe.items ?? []).length;
        const { ids, exhausted } = await walk(ep, total + 1);
        expect(exhausted).toBe(true);
        // The walk visited exactly the same set as the single read — no rows
        // skipped, which is the other half of what a missing order costs.
        expect(new Set(ids)).toEqual(new Set((probe.items ?? []).map(ep.idOf)));
      });
    },
  );

  describe('error envelope', () => {
    const hasEnvelope = (body: Record<string, unknown>): void => {
      expect(typeof body['message']).not.toBe('undefined');
      expect(typeof body['statusCode']).toBe('number');
    };

    it('404 carries the standard envelope', async () => {
      const { status, body } = await get<Record<string, unknown>>(
        `/admin/orders/${randomUUID()}`,
      );
      expect(status).toBe(404);
      hasEnvelope(body);
      expect(body['statusCode']).toBe(404);
    });

    it('400 carries the standard envelope', async () => {
      const { status, body } = await get<Record<string, unknown>>(
        '/admin/orders/not-a-uuid',
      );
      expect(status).toBe(400);
      hasEnvelope(body);
      expect(body['statusCode']).toBe(400);
    });

    it('rejects an admin call with no tenant header', async () => {
      const res = await fetch(`${API_URL}/admin/products`);
      expect(res.status).toBe(400);
    });
  });
});
