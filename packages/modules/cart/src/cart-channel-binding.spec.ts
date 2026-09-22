import { BadRequestException } from '@nestjs/common';
import { runWithTenant } from '@platform/shared/tenant-context';
import type { ChannelConfig, IChannelsQuery } from '@platform/modules/channels/contracts';
import type { ITotalsService } from '@platform/modules/pricing/contracts';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';
import { inMemoryTenantRedis } from './testing/in-memory-redis';

/**
 * Carts are bound to the channel they were created in (C-16b).
 *
 * ── Why this is the check, and not the one the backlog first wrote ─────────
 *
 * The row originally asked to "assert the resolved currency on a cart read
 * follows the cart's channel, not the request's". That check cannot fail yet:
 * pricing is still tenant-level until C-32 (gate G-4), so both of t-fashion's channels
 * price in GBP and the assertion would pass whether or not binding existed. A
 * check that cannot fail is not a check. What CAN fail today is the binding
 * itself — a cart built in one channel being used in another — so that is what
 * is tested, and C-32 inherits the currency half.
 *
 * ── What each prints if the binding did nothing ───────────────────────────
 *
 *   - "refuses a cart from another channel"  — resolves, and the basket is
 *                                              silently used in a market it was
 *                                              not built in
 *   - "...without writing"                   — a line is saved into a cart the
 *                                              request had no right to touch
 *   - "every operation enforces it"          — whichever operation skipped the
 *                                              check, by name
 *   - "carries channelId through a save"     — the first mutation unbinds the
 *                                              cart, after which any channel can
 *                                              use it
 *
 * The REAL CartRepository runs here, over an in-memory Redis. A fake repository
 * would test the service's intent and miss the repository dropping the field on
 * save — which is the more likely bug, because `save` rebuilds the stored object
 * field by field.
 */

const UK = '11111111-1111-4111-8111-111111111111';
const DE = '22222222-2222-4222-8222-222222222222';
const TENANT = 't-fashion';
const PRODUCT = '33333333-3333-4333-8333-333333333333';

// Both channels price in GBP here on purpose: this spec is about binding, and
// C-32a's refusal of a channel the price list cannot serve has its own spec
// (cart-servability.spec.ts). Giving `de` its real EUR would make every test
// below fail for a reason that is not the one it is testing.
const CONFIGS: Record<string, ChannelConfig> = {
  [UK]: { channelId: UK, key: 'uk', isDefault: true, currencyCode: 'GBP' } as ChannelConfig,
  [DE]: { channelId: DE, key: 'de', isDefault: false, currencyCode: 'GBP' } as ChannelConfig,
};

const channels: IChannelsQuery = {
  // `uk` is t-fashion's default, as in the seed.
  findDefault: async () => CONFIGS[UK] as ChannelConfig,
  findByKey: async () => null,
  findById: async (_tenantId, channelId) => CONFIGS[channelId] ?? null,
  listActive: async () => [],
};

const totals = {
  compute: async () => ({ currency: 'GBP' }),
  assertServable: async () => undefined,
} as unknown as ITotalsService;

function setup(): {
  svc: CartService;
  repo: CartRepository;
  store: Map<string, string>;
  saves: () => number;
} {
  const { client, store } = inMemoryTenantRedis();
  const repo = new CartRepository(client);
  let saveCount = 0;
  const realSave = repo.save.bind(repo);
  repo.save = async (cart) => {
    saveCount += 1;
    return realSave(cart);
  };
  return { svc: new CartService(repo, totals, channels), repo, store, saves: () => saveCount };
}

/** Runs `fn` as a request scoped to `channelId`, or to no channel at all. */
const inChannel = <T>(channelId: string | undefined, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId: TENANT, requestId: 'r', channelId }, fn);

const item = { productId: PRODUCT, sku: 'SKU', name: 'Thing', qty: 1 };

describe('binding at creation', () => {
  it('binds to the named channel', async () => {
    const { svc } = setup();
    const cart = await inChannel(DE, () => svc.create(TENANT));
    expect(cart.channelId).toBe(DE);
  });

  it('binds to the CONCRETE default id when no channel is named', async () => {
    // Stored as an id, not as "default". A cart built on the default must stay
    // on that channel if another is later promoted, rather than moving markets
    // with the promotion.
    const { svc } = setup();
    const cart = await inChannel(undefined, () => svc.create(TENANT));
    expect(cart.channelId).toBe(UK);
  });
});

describe('refusing a cart from another channel', () => {
  it('refuses to read a uk cart in the de channel', async () => {
    const { svc } = setup();
    const cart = await inChannel(UK, () => svc.create(TENANT));
    await expect(inChannel(DE, () => svc.get(TENANT, cart.id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses to add to it without writing', async () => {
    // The half that matters: a service that threw AFTER saving would pass an
    // assertion that only checked the throw.
    const { svc, saves } = setup();
    const cart = await inChannel(UK, () => svc.create(TENANT));
    const before = saves();

    await expect(
      inChannel(DE, () => svc.addItem(TENANT, cart.id, item)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(saves()).toBe(before);
  });

  it('allows the channel it was built in, so the check is not refusing everything', async () => {
    const { svc } = setup();
    const cart = await inChannel(UK, () => svc.create(TENANT));
    await inChannel(UK, () => svc.addItem(TENANT, cart.id, item));
    const read = await inChannel(UK, () => svc.get(TENANT, cart.id));
    expect(read.lines).toHaveLength(1);
  });

  it('treats an absent channel as the default, so a de cart is refused without a header', async () => {
    // Absent means "the tenant default", not "any channel". A client that built
    // a basket in de and then dropped the header would otherwise be served the
    // de cart in the uk context.
    const { svc } = setup();
    const cart = await inChannel(DE, () => svc.create(TENANT));
    await expect(inChannel(undefined, () => svc.get(TENANT, cart.id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reports both channel ids, so the failure is diagnosable', async () => {
    const { svc } = setup();
    const cart = await inChannel(UK, () => svc.create(TENANT));
    try {
      await inChannel(DE, () => svc.get(TENANT, cart.id));
      throw new Error('expected a rejection');
    } catch (e) {
      const body = (e as BadRequestException).getResponse() as Record<string, unknown>;
      expect(body['cartChannelId']).toBe(UK);
      expect(body['requestChannelId']).toBe(DE);
    }
  });
});

describe('every operation enforces it', () => {
  // Parameterised by name so a skipped check fails on exactly that operation.
  const ops: Record<string, (svc: CartService, id: string) => Promise<unknown>> = {
    get: (svc, id) => svc.get(TENANT, id),
    addItem: (svc, id) => svc.addItem(TENANT, id, item),
    setItemQty: (svc, id) => svc.setItemQty(TENANT, id, PRODUCT, 0),
    applyCoupon: (svc, id) => svc.applyCoupon(TENANT, id, 'SPRING25'),
    removeCoupon: (svc, id) => svc.removeCoupon(TENANT, id),
  };

  it.each(Object.keys(ops))('%s refuses a cart from another channel', async (name) => {
    const { svc } = setup();
    const cart = await inChannel(UK, () => svc.create(TENANT));
    await expect(inChannel(DE, () => ops[name]!(svc, cart.id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('persistence', () => {
  it('carries channelId through a save', async () => {
    // The repository rebuilds the stored object field by field on save. If it
    // dropped channelId, the FIRST mutation would unbind the cart, and every
    // check above would pass while a real cart became usable from any channel.
    const { svc } = setup();
    const cart = await inChannel(DE, () => svc.create(TENANT));
    await inChannel(DE, () => svc.addItem(TENANT, cart.id, item));
    await inChannel(DE, () => svc.applyCoupon(TENANT, cart.id, 'SPRING25'));

    const read = await inChannel(DE, () => svc.get(TENANT, cart.id));
    expect(read.channelId).toBe(DE);
    // And it is still bound: after two saves, uk is still refused.
    await expect(inChannel(UK, () => svc.get(TENANT, cart.id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a cart written before binding existed reads back as null, not undefined', async () => {
    // The contract promises `string | null`. An undefined would make the key
    // appear and disappear by the cart's age, which the storefront's pinned key
    // list would catch as a contract change.
    const { repo, store } = setup();
    store.set(
      `${TENANT}|cart:${PRODUCT}`,
      JSON.stringify({
        id: PRODUCT,
        tenantId: TENANT,
        lines: [],
        couponCode: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }),
    );
    const legacy = await repo.findById(TENANT, PRODUCT);
    expect(legacy).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(legacy, 'channelId')).toBe(true);
    expect(legacy!.channelId).toBeNull();
  });

  it('a legacy cart is treated as the default channel', async () => {
    const { svc, store } = setup();
    store.set(
      `${TENANT}|cart:${PRODUCT}`,
      JSON.stringify({
        id: PRODUCT,
        tenantId: TENANT,
        lines: [],
        couponCode: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }),
    );
    // Usable in the default, refused elsewhere.
    await expect(inChannel(undefined, () => svc.get(TENANT, PRODUCT))).resolves.toBeDefined();
    await expect(inChannel(DE, () => svc.get(TENANT, PRODUCT))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
