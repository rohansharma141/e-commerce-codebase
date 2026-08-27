import { randomUUID } from 'node:crypto';
import { print } from 'graphql';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import {
  CatalogSearchDocument,
  ProductDetailDocument,
  TenantThemeDocument,
  type CartWithTotals,
  type CreateCartResponse,
  type Order,
} from '@platform/api-client';

/**
 * Storefront → API contract conformance.
 *
 * The ESLint boundary proves the storefront never *imports* across the line.
 * It says nothing about whether the public surface actually returns what the
 * generated types promise. That gap is what this file closes: every operation
 * the storefront issues in production is issued here against a live api, and
 * the response is checked against the shape the storefront relies on.
 *
 * Two failure modes are in scope:
 *
 *   1. The api stops returning a field the storefront reads. React renders
 *      `undefined` silently, so nothing would catch this at build time — the
 *      generated types would still typecheck against stale codegen output.
 *   2. The hand-mirrored REST types in api-client drift from the api's real
 *      payloads. There is no compiler link between them, by design
 *      (ADR-0010), so a runtime check is the only link available.
 *
 * Requires the seeded docker stack. Skipped when TEST_API_URL is unset, the
 * same convention the module integration specs use:
 *
 *   TEST_API_URL=http://localhost:3000 pnpm nx test storefront
 *
 * Do NOT run this in the same invocation as the module integration suites.
 * Those drop and rebuild the catalog, pricing and orders schemas to get a
 * clean slate, which deletes the seeded prices this suite checks out against.
 * The two have contradictory requirements — one wants a disposable database,
 * this one wants a populated one. Run the module suites, re-run `pnpm seed`,
 * then run this.
 */

const API_URL = process.env['TEST_API_URL'];
const TENANT = process.env['TEST_TENANT_ID'] ?? 't-fashion';

const describeLive = API_URL ? describe : describe.skip;

async function graphql<TData, TVars>(
  document: TypedDocumentNode<TData, TVars>,
  variables: TVars,
): Promise<TData> {
  const res = await fetch(`${API_URL}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT },
    body: JSON.stringify({ query: print(document), variables }),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { data?: TData; errors?: unknown };
  expect(json.errors).toBeUndefined();
  expect(json.data).toBeDefined();
  return json.data as TData;
}

/**
 * `instanceof Object` is unreliable here: bodies come back through undici's
 * JSON parser, so they carry a different realm's Object prototype and the
 * check fails on a perfectly good object. Structural test instead.
 */
function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function rest<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': TENANT,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
  };
}

describeLive('storefront ↔ api contract', () => {
  beforeAll(async () => {
    // Fail with the actual cause rather than a confusing assertion twenty
    // lines into the purchase flow. An empty index almost always means the
    // seed hasn't run, or a module integration suite dropped the schemas
    // after it did.
    const probe = await graphql(CatalogSearchDocument, { input: { limit: 1 } });
    if (probe.search.total === 0) {
      throw new Error(
        `api at ${API_URL} has no products for tenant "${TENANT}". Run \`pnpm seed\` ` +
          `(the module integration suites drop the catalog/pricing/orders schemas, so a ` +
          `full test run leaves the database empty).`,
      );
    }
  });

  describe('GraphQL read edge', () => {
    it('CatalogSearch returns every field the browse page renders', async () => {
      const data = await graphql(CatalogSearchDocument, {
        input: { facets: ['color', 'size', 'brand'], limit: 24 },
      });

      const search = data.search;
      expect(typeof search.total).toBe('number');
      expect(typeof search.latencyMs).toBe('number');
      expect(Array.isArray(search.items)).toBe(true);
      expect(search.items.length).toBeGreaterThan(0);

      for (const item of search.items) {
        expect(typeof item.id).toBe('string');
        expect(typeof item.sku).toBe('string');
        expect(typeof item.name).toBe('string');
        // `attributes` is a JSON scalar. The product card reads arbitrary
        // tenant-defined keys off it, so the only structural promise is that
        // it is an object rather than null or a string.
        expect(isPlainObject(item.attributes)).toBe(true);
      }

      for (const facet of search.facets) {
        expect(typeof facet.attribute).toBe('string');
        for (const bucket of facet.buckets) {
          expect(typeof bucket.value).toBe('string');
          expect(typeof bucket.count).toBe('number');
        }
      }
    });

    it('aggregates facets over the whole result set, not the returned page', async () => {
      const data = await graphql(CatalogSearchDocument, {
        input: { facets: ['color'], limit: 5 },
      });
      const search = data.search;
      if (search.total <= 5) return; // nothing to prove on a tiny index

      const colour = search.facets.find((f) => f.attribute === 'color');
      expect(colour).toBeDefined();
      const bucketed = (colour?.buckets ?? []).reduce((sum, b) => sum + b.count, 0);
      // If facets were computed from the page we'd see at most 5.
      expect(bucketed).toBeGreaterThan(search.items.length);
    });

    it('paginates by cursor without repeating the first page', async () => {
      const first = await graphql(CatalogSearchDocument, { input: { limit: 5 } });
      if (!first.search.nextCursor) return;

      const second = await graphql(CatalogSearchDocument, {
        input: { limit: 5, cursor: first.search.nextCursor },
      });
      const firstIds = first.search.items.map((i) => i.id);
      const secondIds = second.search.items.map((i) => i.id);
      expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    });

    it('ProductDetail resolves an id taken from search', async () => {
      const list = await graphql(CatalogSearchDocument, { input: { limit: 1 } });
      const seed = list.search.items[0];
      expect(seed).toBeDefined();

      const data = await graphql(ProductDetailDocument, { id: seed!.id });
      expect(data.product).not.toBeNull();
      expect(data.product?.id).toBe(seed!.id);
      expect(typeof data.product?.sku).toBe('string');
      expect(typeof data.product?.name).toBe('string');
      expect(isPlainObject(data.product?.attributes)).toBe(true);
    });

    it('TenantTheme returns a fully-populated theme', async () => {
      const { theme } = await graphql(TenantThemeDocument, {});
      // The layout applies these directly as CSS variables and header text.
      // A null here doesn't throw — it paints an unbranded, unreadable page,
      // which is why every field is asserted rather than the object alone.
      for (const field of [
        'brandName',
        'tagline',
        'logoMark',
        'brandHsl',
        'brandFgHsl',
        'pageBgHsl',
        'fontSans',
      ] as const) {
        expect(typeof theme[field]).toBe('string');
        expect(theme[field]).not.toHaveLength(0);
      }
    });
  });

  describe('REST write path — the mirrored types in api-client', () => {
    it('carries a cart through checkout with the payload shapes the storefront expects', async () => {
      const product = (await graphql(CatalogSearchDocument, { input: { limit: 1 } })).search
        .items[0];
      expect(product).toBeDefined();

      // 1. create
      const created = await rest<CreateCartResponse>('/storefront/carts', { method: 'POST' });
      expect(created.status).toBe(201);
      expect(typeof created.body.cartId).toBe('string');
      const cartId = created.body.cartId;

      // 2. add a line
      const added = await rest<CartWithTotals>(`/storefront/carts/${cartId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          productId: product!.id,
          sku: product!.sku,
          name: product!.name,
          qty: 2,
        }),
      });
      // 201, not 200: the route has no @HttpCode override, so Nest's POST
      // default applies. docs/HANDOVER.md claimed 200 here — the code is the
      // contract, and pinning it stops the next reader trusting the doc.
      expect(added.status).toBe(201);

      // 3. read back with totals
      const fetched = await rest<CartWithTotals>(`/storefront/carts/${cartId}`);
      expect(fetched.status).toBe(200);
      const cart = fetched.body;

      expect(Object.keys(cart).sort()).toEqual(
        ['couponCode', 'createdAt', 'id', 'lines', 'tenantId', 'totals', 'updatedAt'].sort(),
      );
      expect(cart.id).toBe(cartId);
      expect(cart.tenantId).toBe(TENANT);
      expect(cart.lines).toHaveLength(1);
      expect(cart.lines[0]).toEqual({
        productId: product!.id,
        sku: product!.sku,
        name: product!.name,
        qty: 2,
      });

      const totals = cart.totals;
      expect(typeof totals.currency).toBe('string');
      expect(Number.isInteger(totals.subtotalCents)).toBe(true);
      expect(Number.isInteger(totals.grandTotalCents)).toBe(true);
      // Money is integer cents end to end; a float anywhere here means
      // someone reintroduced dollars.
      for (const value of [
        totals.subtotalCents,
        totals.discountCents,
        totals.taxedAmountCents,
        totals.taxCents,
        totals.grandTotalCents,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
      }
      expect(totals.taxedAmountCents).toBe(totals.subtotalCents - totals.discountCents);
      expect(totals.grandTotalCents).toBe(totals.taxedAmountCents + totals.taxCents);

      // 4. checkout
      const checkout = await rest<Order>('/storefront/checkout', {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify({ cartId }),
      });
      expect([200, 201]).toContain(checkout.status);
      const order = checkout.body;

      // An added field here means the api's order shape changed. The types
      // are generated now, so a regenerate would absorb that silently and the
      // storefront would keep compiling against a surface nobody decided to
      // accept. This assertion is what makes that a decision: widen the list
      // deliberately, don't loosen it.
      expect(Object.keys(order).sort()).toEqual(
        [
          'appliedPromotion',
          'createdAt',
          'currency',
          'discountCents',
          'grandTotalCents',
          'id',
          'lines',
          'status',
          'subtotalCents',
          'taxCents',
          'taxRateBps',
          'tenantId',
        ].sort(),
      );
      expect(order.status).toBe('created');
      expect(order.tenantId).toBe(TENANT);
      expect(order.lines).toHaveLength(1);
      expect(order.lines[0]?.qty).toBe(2);
      expect(order.lines[0]?.lineTotalCents).toBe(
        (order.lines[0]?.unitPriceCents ?? 0) * 2,
      );

      // 5. the confirmation page re-reads the order
      const reread = await rest<Order>(`/admin/orders/${order.id}`);
      expect(reread.status).toBe(200);
      expect(reread.body.grandTotalCents).toBe(order.grandTotalCents);
    });

    it('rejects a tenant-scoped call with no tenant header', async () => {
      // The storefront always attaches the header via middleware; this pins
      // the api's fail-closed posture that makes that safe to rely on.
      const res = await fetch(`${API_URL}/storefront/carts`, { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });
});
