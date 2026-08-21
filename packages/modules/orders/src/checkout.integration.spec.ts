/**
 * Integration tests for the orders checkout flow. Requires a real Postgres
 * (TEST_DATABASE_URL) and a real Redis (TEST_REDIS_URL); skipped otherwise.
 *
 * Covers the load-bearing claims for step 5:
 *  - happy-path: cart → order, totals snapshotted, cart cleared
 *  - idempotency: same Idempotency-Key never produces two orders
 *  - promo race: two concurrent checkouts both try to consume a max_uses=1
 *    promo; exactly one wins the discount, the other falls back to no-promo
 *  - snapshot integrity: editing a promotion AFTER checkout doesn't mutate
 *    the historical order
 *  - tenant isolation: order created as t1 is invisible to t2 (RLS does
 *    the actual blocking)
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import IORedis from 'ioredis';
import { EventBus } from '@platform/shared/event-bus';
import { HookRegistry } from '@platform/shared/hooks';
import { runWithTenant } from '@platform/shared/tenant-context';
import {
  MigrationRunner,
  tenantDrizzleAccessor,
  withTenantConnection,
} from '@platform/shared/database';
import { TenantRedisClient } from '@platform/shared/redis';
import { CartRepository } from '../../cart/src/cart.repository';
import { CartService } from '../../cart/src/cart.service';
import { TenantConfigRepository } from '../../pricing/src/tenant-config/tenant-config.repository';
import { TenantConfigService } from '../../pricing/src/tenant-config/tenant-config.service';
import { PricesRepository } from '../../pricing/src/prices/prices.repository';
import { PromotionsRepository } from '../../pricing/src/promotions/promotions.repository';
import { TotalsService } from '../../pricing/src/totals/totals.service';
import type { Promotion } from '@platform/modules/pricing/contracts';
import { CheckoutService } from './checkout.service';

const PG_URL = process.env['TEST_DATABASE_URL'];
const REDIS_URL = process.env['TEST_REDIS_URL'];
const describeIf = PG_URL && REDIS_URL ? describe : describe.skip;

jest.setTimeout(30_000);

describeIf('orders checkout integration', () => {
  let sql: Sql;
  let redis: IORedis;
  let bus: EventBus;
  let checkout: CheckoutService;
  let promotionsRepo: PromotionsRepository;
  let pricesRepo: PricesRepository;
  let cartService: CartService;
  let tenantConfigService: TenantConfigService;

  const productA = randomUUID();
  const productB = randomUUID();

  const t1 = `t1-${randomUUID().slice(0, 8)}`;
  const t2 = `t2-${randomUUID().slice(0, 8)}`;

  /**
   * Binds both halves of a tenant-scoped request: the ALS context the
   * services read (`currentTenantOrThrow`, and what events are stamped with)
   * and the reserved Postgres connection RLS predicates evaluate against. The
   * api's middleware chain does exactly this pairing — binding only one here
   * would test a state the running system never reaches.
   */
  const asT = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    runWithTenant({ tenantId, requestId: randomUUID() }, () =>
      withTenantConnection(sql, tenantId, fn),
    );

  beforeAll(async () => {
    sql = postgres(PG_URL as string, { max: 6 });
    redis = new IORedis(REDIS_URL as string);

    const runner = new MigrationRunner(sql);
    // Reset schemas for repeatable runs. ORDER MATTERS: orders has FK-like
    // references conceptually but no cross-schema FKs; pricing is independent.
    await sql.unsafe('DROP SCHEMA IF EXISTS orders CASCADE');
    await sql.unsafe('DROP SCHEMA IF EXISTS pricing CASCADE');
    await runner.apply(
      join(__dirname, '..', '..', 'pricing', 'src', 'db', 'migrations'),
      'pricing',
    );
    await runner.apply(join(__dirname, 'db', 'migrations'), 'orders');

    bus = new EventBus();
    const tenantConfigRepo = new TenantConfigRepository(tenantDrizzleAccessor);
    tenantConfigService = new TenantConfigService(tenantConfigRepo, bus);
    pricesRepo = new PricesRepository(tenantDrizzleAccessor);
    promotionsRepo = new PromotionsRepository(tenantDrizzleAccessor);
    const totalsService = new TotalsService(tenantConfigService, pricesRepo, promotionsRepo);
    const cartRepo = new CartRepository(new TenantRedisClient(redis));
    cartService = new CartService(cartRepo, totalsService);
    checkout = new CheckoutService(
      tenantDrizzleAccessor,
      cartService,
      tenantConfigService,
      pricesRepo,
      promotionsRepo,
      bus,
      new HookRegistry(),
    );

    // Bootstrap each tenant's pricing config + prices.
    for (const t of [t1, t2]) {
      await asT(t, async () => {
        await tenantConfigService.upsert(t, { currency: 'USD', taxRateBps: 875 });
        await pricesRepo.upsert(t, productA, 1000); // $10.00
        await pricesRepo.upsert(t, productB, 2500); // $25.00
      });
    }
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    redis?.disconnect();
  });

  afterEach(async () => {
    await sql`TRUNCATE orders.orders, orders.idempotency_keys RESTART IDENTITY CASCADE`;
    await sql`TRUNCATE pricing.promotions RESTART IDENTITY`;
    // Carts use the redis namespace t:{tenant}:cart:*; tests use unique cartIds so cross-test
    // bleed is impossible. No-op cleanup.
  });

  const newCart = async (t: string): Promise<string> =>
    asT(t, async () => {
      const c = await cartService.create(t);
      await cartService.addItem(t, c.id, { productId: productA, sku: 'SKU-A', name: 'A', qty: 2 });
      await cartService.addItem(t, c.id, { productId: productB, sku: 'SKU-B', name: 'B', qty: 1 });
      return c.id;
    });

  it('happy path: cart → order, totals snapshotted, cart cleared', async () => {
    const cartId = await newCart(t1);
    const { order, createdNew } = await asT(t1, () => checkout.checkout(t1, cartId));

    expect(createdNew).toBe(true);
    expect(order.tenantId).toBe(t1);
    expect(order.status).toBe('created');
    expect(order.currency).toBe('USD');
    expect(order.subtotalCents).toBe(2 * 1000 + 2500); // 4500
    expect(order.discountCents).toBe(0); // no promos set
    expect(order.taxCents).toBe(394); // 8.75% of 4500 = 393.75 → banker's-rounded to 394
    expect(order.grandTotalCents).toBe(4500 + 394);
    expect(order.lines).toHaveLength(2);
    expect(order.appliedPromotion).toBeNull();

    // Cart is gone.
    await expect(asT(t1, () => cartService.get(t1, cartId))).rejects.toThrow(/not found/);
  });

  it('idempotency: same Idempotency-Key never produces two orders', async () => {
    const cartId = await newCart(t1);
    const key = randomUUID();

    const first = await asT(t1, () => checkout.checkout(t1, cartId, key));
    // Try again with the SAME key. Cart is gone but the idempotency lookup
    // should return the existing order before we even touch the cart.
    const second = await asT(t1, () => checkout.checkout(t1, cartId, key));

    expect(first.createdNew).toBe(true);
    expect(second.createdNew).toBe(false);
    expect(second.order.id).toBe(first.order.id);
  });

  it('snapshot integrity: editing a promotion after checkout does not mutate the order', async () => {
    const promo: Promotion = await asT(t1, () =>
      promotionsRepo.insert({
        tenantId: t1,
        kind: 'automatic',
        code: null,
        condition: { type: 'always', value: {} },
        action: { type: 'percent', value: 1000 }, // 10%
        expiresAt: null,
        maxUses: null,
        active: true,
      }),
    );

    const cartId = await newCart(t1);
    const { order } = await asT(t1, () => checkout.checkout(t1, cartId));

    expect(order.appliedPromotion?.discountCents).toBe(450); // 10% of 4500
    const expectedDiscountAtCheckout = order.appliedPromotion!.discountCents;

    // Mutate the live promotion to a much bigger discount.
    await asT(t1, () =>
      promotionsRepo.update(t1, promo.id, { action: { type: 'percent', value: 5000 } }),
    );

    // Re-fetch the order via repository — the snapshot must not have changed.
    const reFetched = await asT(t1, async () => {
      const ord = await checkout['findOrderOrThrow'](t1, order.id);
      return ord;
    });
    expect(reFetched.appliedPromotion?.discountCents).toBe(expectedDiscountAtCheckout);
    expect(reFetched.appliedPromotion?.actionValue).toBe(1000); // snapshot, not 5000
  });

  it('promo race: concurrent checkouts on a max_uses=1 promo: one wins discount, other falls back', async () => {
    const promo: Promotion = await asT(t1, () =>
      promotionsRepo.insert({
        tenantId: t1,
        kind: 'coupon-code',
        code: 'ONCE',
        condition: { type: 'always', value: {} },
        action: { type: 'fixed', value: 500 },
        expiresAt: null,
        maxUses: 1,
        active: true,
      }),
    );

    // Two distinct carts, each with the coupon applied.
    const cartA = await asT(t1, async () => {
      const c = await cartService.create(t1);
      await cartService.addItem(t1, c.id, { productId: productA, sku: 'A', name: 'A', qty: 1 });
      await cartService.applyCoupon(t1, c.id, 'ONCE');
      return c.id;
    });
    const cartB = await asT(t1, async () => {
      const c = await cartService.create(t1);
      await cartService.addItem(t1, c.id, { productId: productA, sku: 'A', name: 'A', qty: 1 });
      await cartService.applyCoupon(t1, c.id, 'ONCE');
      return c.id;
    });

    // Fire both at once; the tryIncrementUsesCount race decides which one
    // gets the discount.
    const [resA, resB] = await Promise.all([
      asT(t1, () => checkout.checkout(t1, cartA)),
      asT(t1, () => checkout.checkout(t1, cartB)),
    ]);

    const ordersWithPromo = [resA, resB].filter((r) => r.order.appliedPromotion !== null);
    const ordersWithout = [resA, resB].filter((r) => r.order.appliedPromotion === null);

    expect(ordersWithPromo).toHaveLength(1);
    expect(ordersWithout).toHaveLength(1);
    expect(ordersWithPromo[0]?.order.discountCents).toBe(500);
    expect(ordersWithout[0]?.order.discountCents).toBe(0);

    // The promo's uses_count is now 1 (the winning order consumed it).
    const refreshed: Promotion | null = await asT(t1, () =>
      promotionsRepo.findById(t1, promo.id),
    );
    expect(refreshed?.usesCount).toBe(1);
  });

  it('tenant isolation: an order created as t1 is invisible to t2 (RLS-enforced)', async () => {
    const cartId = await newCart(t1);
    const { order } = await asT(t1, () => checkout.checkout(t1, cartId));

    // From t2's connection, the order should not be visible. checkout's
    // findOrderOrThrow uses a tenant-WHERE'd query AND the RLS policy
    // blocks the row regardless — so this should 404 either way.
    await expect(
      asT(t2, () => checkout['findOrderOrThrow'](t2, order.id)),
    ).rejects.toThrow(/not found/);
  });
});
