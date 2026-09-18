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
import { CartRepository } from '@platform/modules/cart/src/cart.repository';
import { CartService } from '@platform/modules/cart/src/cart.service';
import { TenantConfigRepository } from '@platform/modules/pricing/src/tenant-config/tenant-config.repository';
import { TenantConfigService } from '@platform/modules/pricing/src/tenant-config/tenant-config.service';
import { PricesRepository } from '@platform/modules/pricing/src/prices/prices.repository';
import { PromotionsRepository } from '@platform/modules/pricing/src/promotions/promotions.repository';
import { TotalsService } from '@platform/modules/pricing/src/totals/totals.service';
import type { Promotion } from '@platform/modules/pricing/contracts';
import { CheckoutService } from '@platform/modules/orders/src/checkout.service';
import { ChannelsRepository } from '@platform/modules/channels/src/channels.repository';
import { ChannelsService } from '@platform/modules/channels/src/channels.service';
import { ChannelTransactedConsumer } from '@platform/modules/channels/src/channel-transacted.consumer';

/**
 * This spec lives in apps/api rather than in the orders module, because what
 * it does — wiring cart, pricing and orders together into one working object
 * graph — is composition-root work. A module may not reach into another
 * module's src, and a test is not an exemption from that; it just needs to
 * live where the wiring legitimately happens.
 */
const MODULES = join(__dirname, '..', '..', '..', 'packages', 'modules');

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
  let channelsRepo: ChannelsRepository;
  let channelsService: ChannelsService;
  let transactedConsumer: ChannelTransactedConsumer;

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
    await sql.unsafe('DROP SCHEMA IF EXISTS channels CASCADE');
    await runner.apply(join(MODULES, 'pricing', 'src', 'db', 'migrations'), 'pricing');
    // Channels before orders: orders' 0003 backfills channel_id from
    // channels.channels. It is guarded on the table existing, so either order
    // *works*, but applying them in dependency order here means this spec
    // exercises the path a warm production database takes.
    await runner.apply(join(MODULES, 'channels', 'src', 'db', 'migrations'), 'channels');
    await runner.apply(join(MODULES, 'orders', 'src', 'db', 'migrations'), 'orders');

    bus = new EventBus();
    const tenantConfigRepo = new TenantConfigRepository(tenantDrizzleAccessor);
    tenantConfigService = new TenantConfigService(tenantConfigRepo, bus);
    pricesRepo = new PricesRepository(tenantDrizzleAccessor);
    promotionsRepo = new PromotionsRepository(tenantDrizzleAccessor);
    const totalsService = new TotalsService(tenantConfigService, pricesRepo, promotionsRepo);
    const cartRepo = new CartRepository(new TenantRedisClient(redis));
    // CartService now needs channel resolution (C-16b). The channels stack is
    // built further down, so the cart service is constructed after it.
    // The real channels stack, not a stub: this spec is composition-root work,
    // and the point of C-16a is that checkout snapshots what the channels
    // module actually resolves. A stub would pass whatever it was told.
    channelsRepo = new ChannelsRepository(tenantDrizzleAccessor);
    channelsService = new ChannelsService(channelsRepo, bus);
    cartService = new CartService(cartRepo, totalsService, channelsService);
    // Subscribed to the same bus checkout publishes on, as in production. It
    // gets the RAW sql client, not the tenant-bound accessor: the consumer must
    // bind its tenant from the event, and handing it an ambient connection here
    // would hide exactly the dependency it is written to avoid.
    transactedConsumer = new ChannelTransactedConsumer(sql, bus);
    transactedConsumer.onModuleInit();
    checkout = new CheckoutService(
      tenantDrizzleAccessor,
      cartService,
      tenantConfigService,
      pricesRepo,
      promotionsRepo,
      bus,
      new HookRegistry(),
      channelsService,
    );

    // Bootstrap each tenant's pricing config + prices.
    for (const t of [t1, t2]) {
      await asT(t, async () => {
        await tenantConfigService.upsert(t, { currency: 'USD', taxRateBps: 875 });
        await channelsRepo.upsertTenantDefaults(t, {
          currencyCode: 'USD',
          defaultLocale: 'en-US',
          supportedLocales: ['en-US'],
          country: 'US',
          timezone: 'America/New_York',
          taxDisplay: 'net',
          taxRateBps: 875,
        });
        const web = await channelsRepo.create(t, { key: 'web', name: 'Web Store', status: 'active' });
        await channelsRepo.promoteDefault(t, web.id);
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

  describe('channel snapshot (C-16a)', () => {
    /**
     * The stated check: rename a channel after an order exists and the order
     * still renders its original key and name. Without the snapshot it renders
     * the new one -- history quietly rewritten by an edit nobody connected to it.
     */
    it('a rename does not rewrite an existing order', async () => {
      const cartId = await newCart(t1);
      const { order } = await asT(t1, () => checkout.checkout(t1, cartId));

      expect(order.channel).not.toBeNull();
      expect(order.channel?.key).toBe('web');
      expect(order.channel?.name).toBe('Web Store');
      expect(order.channel?.currencyMinorUnits).toBe(2);

      // Rename the live channel. A draft channel is the only one whose key may
      // change, so the name is what moves here -- which is the display fact an
      // order is most likely to have copied by reference.
      const live = (await asT(t1, () => channelsRepo.list(t1)))[0]!;
      // Read the version rather than assuming 1: promoteDefault already bumped
      // it during setup. The first draft of this test hardcoded 1 and got a
      // 409 -- optimistic concurrency catching a stale assumption, which is
      // exactly what it is for, and worth leaving a note about.
      const before = (await asT(t1, () =>
        channelsRepo.getWithVersion(t1, live.config.channelId),
      ))!;
      await asT(t1, () =>
        channelsService.update(
          t1,
          live.config.channelId,
          { name: 'Renamed Store' },
          before.version,
        ),
      );

      // Re-read the order from storage -- not the in-memory object returned
      // above, which could hold a stale copy and pass regardless.
      const reFetched = await asT(t1, () => checkout['findOrderOrThrow'](t1, order.id));
      expect(reFetched.channel?.name).toBe('Web Store');

      // And the channel really did change, so the assertion above is about the
      // snapshot rather than about a rename that silently failed.
      const after = (await asT(t1, () => channelsRepo.list(t1)))[0]!;
      expect(after.config.name).toBe('Renamed Store');
    });

    it('snapshots the tenant default when the request names no channel', async () => {
      // The absent-channel fallback: this spec binds no x-channel-id, so
      // resolution takes the default. An order with a null channel here would
      // mean the write path silently skipped the snapshot.
      const cartId = await newCart(t2);
      const { order } = await asT(t2, () => checkout.checkout(t2, cartId));
      expect(order.channel?.key).toBe('web');
    });
  });

  describe('currency freezes once a channel has transacted (C-17)', () => {
    /** A request scoped to a specific channel, as ChannelScopeMiddleware would bind it. */
    const inChannel = <T>(tenantId: string, channelId: string, fn: () => Promise<T>): Promise<T> =>
      runWithTenant({ tenantId, requestId: randomUUID(), channelId }, () =>
        withTenantConnection(sql, tenantId, fn),
      );

    const freshChannel = (t: string, label: string) =>
      asT(t, () =>
        channelsService.create(t, {
          key: `${label}-${randomUUID().slice(0, 6)}`,
          name: label,
          status: 'active',
          currencyCode: 'USD',
        }),
      );

    /**
     * Polls until `ok`, or gives up and returns the last value so the caller's
     * assertion fails on a real reading rather than on a timeout.
     *
     * Needed because the bus is genuinely asynchronous: `publish()` schedules
     * handlers on a microtask and returns, so `checkout()` resolves BEFORE the
     * consumer's transaction commits. The first draft of these tests read the
     * flag immediately after checkout and saw `false` while the consumer's own
     * log line said it had marked the channel -- the test was wrong, not the
     * consumer. The freeze is eventually consistent, and a test of it has to be
     * written that way.
     */
    const eventually = async <T>(
      read: () => Promise<T>,
      ok: (v: T) => boolean,
      ms = 3000,
    ): Promise<T> => {
      const deadline = Date.now() + ms;
      for (;;) {
        const v = await read();
        if (ok(v) || Date.now() > deadline) return v;
        await new Promise((r) => setTimeout(r, 25));
      }
    };

    const rawOf = (t: string, channelId: string) =>
      asT(t, async () => (await channelsRepo.getRaw(t, channelId))!);

    /**
     * Places an order in a channel and waits for the consumer to have marked it,
     * so every test leaves the bus quiescent instead of racing a pending handler
     * against the next test or the pool being closed.
     */
    const orderIn = async (t: string, channelId: string) => {
      const cartId = await inChannel(t, channelId, async () => {
        const c = await cartService.create(t);
        await cartService.addItem(t, c.id, { productId: productA, sku: 'A', name: 'A', qty: 1 });
        return c.id;
      });
      const placed = await inChannel(t, channelId, () => checkout.checkout(t, cartId));
      await eventually(() => rawOf(t, channelId), (c) => c.hasTransacted);
      return placed;
    };

    it('an order freezes the currency of the channel it was placed in -- and only that one', async () => {
      const fresh = await freshChannel(t1, 'c17');
      const bystander = await freshChannel(t1, 'c17-bystander');
      expect(fresh.hasTransacted).toBe(false);

      // BEFORE any order: the currency is freely editable. Without this half, a
      // rule that refused every currency change would pass the half below.
      const edited = await asT(t1, () =>
        channelsService.update(t1, fresh.id, { currencyCode: 'EUR' }, fresh.version),
      );
      expect(edited.currencyCode).toBe('EUR');

      const { order } = await orderIn(t1, fresh.id);
      expect(order.channel?.channelId).toBe(fresh.id);

      // AFTER: marked, by the consumer, from the event alone -- eventually.
      // If the consumer were not wired, `eventually` times out and this reads
      // false, which is the "before the consumer is wired, the change succeeds"
      // state the backlog describes.
      const raw = await eventually(() => rawOf(t1, fresh.id), (c) => c.hasTransacted);
      expect(raw.hasTransacted).toBe(true);

      await expect(
        asT(t1, () => channelsService.update(t1, fresh.id, { currencyCode: 'GBP' }, raw.version)),
      ).rejects.toMatchObject({
        response: {
          violations: expect.arrayContaining([
            expect.objectContaining({ code: 'currency.frozen' }),
          ]),
        },
      });

      // Freezing the currency freezes ONLY the currency. And the version was
      // not bumped by the mark, so an operator's in-flight rename still lands
      // rather than 409ing against a change they did not conflict with.
      expect(raw.version).toBe(edited.version);
      const renamed = await asT(t1, () =>
        channelsService.update(t1, fresh.id, { name: 'Renamed after first order' }, raw.version),
      );
      expect(renamed.name).toBe('Renamed after first order');

      // The channel nobody ordered in is untouched.
      const other = (await asT(t1, () => channelsRepo.getRaw(t1, bystander.id)))!;
      expect(other.hasTransacted).toBe(false);
    });

    it('a redelivered event changes nothing -- not even updated_at', async () => {
      // The bus redelivers. The UPDATE is conditional on has_transacted = false,
      // so a second delivery matches zero rows.
      const fresh = await freshChannel(t1, 'c17-redeliver');
      const { order } = await orderIn(t1, fresh.id);
      const afterFirst = await rawOf(t1, fresh.id); // orderIn already waited
      expect(afterFirst.hasTransacted).toBe(true);

      expect(await transactedConsumer.handle(t1, { order })).toBe('unchanged');
      expect(await transactedConsumer.handle(t1, { order })).toBe('unchanged');

      const afterThird = (await asT(t1, () => channelsRepo.getRaw(t1, fresh.id)))!;
      expect(afterThird.updatedAt).toBe(afterFirst.updatedAt);
    });

    it('the tenant comes from the event, and RLS scopes the write', async () => {
      // A forged event: tenant t2 naming one of t1's channels. The consumer
      // binds t2, RLS hides t1's row, and the UPDATE matches nothing. If the
      // consumer used an unscoped connection this would mark another tenant's
      // channel.
      const victim = await freshChannel(t1, 'c17-victim');
      const { order } = await orderIn(t1, (await freshChannel(t1, 'c17-source')).id);
      const forged = { order: { ...order, channel: { ...order.channel!, channelId: victim.id } } };

      expect(await transactedConsumer.handle(t2, forged)).toBe('unchanged');

      const after = (await asT(t1, () => channelsRepo.getRaw(t1, victim.id)))!;
      expect(after.hasTransacted).toBe(false);
    });

    it('an order that predates channels marks nothing and does not throw', async () => {
      const { order } = await orderIn(t1, (await freshChannel(t1, 'c17-legacy')).id);
      expect(await transactedConsumer.handle(t1, { order: { ...order, channel: null } })).toBe(
        'no-channel',
      );
    });
  });
});
