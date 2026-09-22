import { BadRequestException } from '@nestjs/common';
import { runWithTenant } from '@platform/shared/tenant-context';
import type { ChannelConfig, IChannelsQuery } from '@platform/modules/channels/contracts';
import {
  unservableChannel,
  type ITotalsService,
  type PricingScope,
} from '@platform/modules/pricing/contracts';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';
import { inMemoryTenantRedis } from './testing/in-memory-redis';

/**
 * C-32a from the cart's side: it asks the price list before it writes, and it
 * prices a basket in the basket's own channel.
 *
 * The rule itself — which currencies a price list can serve — is pricing's,
 * and is tested there. What can go wrong HERE is the cart asking the wrong
 * question, or asking it too late:
 *
 *   - "writes nothing"                 — a cart is stored in a channel nothing
 *                                        can be sold in, and fails only later
 *   - "asks with the request's channel" / "…the tenant default"
 *                                      — the check runs against some other
 *                                        channel and passes for the wrong one
 *   - "prices a cart in its own channel"
 *                                      — `trade` is not the default, so a cart
 *                                        priced "in the default" instead of in
 *                                        its channel fails this by name
 *   - "…stops being servable"          — a basket built while its channel was
 *                                        servable is priced after it is not
 *
 * The totals service is a fake that applies pricing's real rule to a GBP price
 * list. It cannot be pricing's real exception: a module's spec may not import
 * another module's `src`, spec files included.
 */

const TENANT = 't-fashion';
const UK = '11111111-1111-4111-8111-111111111111';
const DE = '22222222-2222-4222-8222-222222222222';
const TRADE = '44444444-4444-4444-8444-444444444444';

class Refused extends Error {}

function setup() {
  const configs: Record<string, ChannelConfig> = {
    [UK]: { channelId: UK, key: 'uk', isDefault: true, currencyCode: 'GBP' } as ChannelConfig,
    [DE]: { channelId: DE, key: 'de', isDefault: false, currencyCode: 'EUR' } as ChannelConfig,
    [TRADE]: { channelId: TRADE, key: 'trade', isDefault: false, currencyCode: 'GBP' } as ChannelConfig,
  };
  const channels: IChannelsQuery = {
    findDefault: async () => configs[UK] as ChannelConfig,
    findByKey: async () => null,
    findById: async (_tenantId, channelId) => configs[channelId] ?? null,
    listActive: async () => [],
  };

  const refuseUnservable = (scope: PricingScope) => {
    if (unservableChannel('GBP', scope)) throw new Refused(scope.key);
  };
  const assertServable = jest.fn(async (_tenantId: string, scope: PricingScope) =>
    refuseUnservable(scope),
  );
  const compute = jest.fn(async (input: { scope: PricingScope }) => {
    refuseUnservable(input.scope);
    return { currency: 'GBP' };
  });
  const totals = { assertServable, compute } as unknown as ITotalsService;

  const { client, store } = inMemoryTenantRedis();
  const svc = new CartService(new CartRepository(client), totals, channels);
  return { svc, store, configs, assertServable, compute };
}

const inChannel = <T>(channelId: string | undefined, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId: TENANT, requestId: 'r', channelId }, fn);

describe('creating a cart', () => {
  it('refuses a channel the price list cannot serve, and writes nothing', async () => {
    const { svc, store } = setup();
    await expect(inChannel(DE, () => svc.create(TENANT))).rejects.toBeInstanceOf(Refused);
    expect(store.size).toBe(0);
  });

  it('creates one in a servable channel, asking with the request channel', async () => {
    const { svc, store, assertServable } = setup();
    const cart = await inChannel(TRADE, () => svc.create(TENANT));

    expect(cart.channelId).toBe(TRADE);
    expect(store.size).toBe(1);
    expect(assertServable).toHaveBeenCalledWith(TENANT, expect.objectContaining({ key: 'trade' }));
  });

  it('asks with the tenant default when the request names no channel', async () => {
    const { svc, assertServable } = setup();
    await inChannel(undefined, () => svc.create(TENANT));
    expect(assertServable).toHaveBeenCalledWith(TENANT, expect.objectContaining({ key: 'uk' }));
  });
});

describe('pricing a cart', () => {
  it("prices a cart in its own channel, not the tenant default", async () => {
    const { svc, compute } = setup();
    const cart = await inChannel(TRADE, () => svc.create(TENANT));
    await inChannel(TRADE, () => svc.get(TENANT, cart.id));

    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute.mock.calls[0]?.[0].scope).toMatchObject({ key: 'trade', currencyCode: 'GBP' });
  });

  it('refuses to price a cart whose channel stopped being servable after it was built', async () => {
    const { svc, configs } = setup();
    const cart = await inChannel(TRADE, () => svc.create(TENANT));
    configs[TRADE] = { ...(configs[TRADE] as ChannelConfig), currencyCode: 'EUR' };

    await expect(inChannel(TRADE, () => svc.get(TENANT, cart.id))).rejects.toBeInstanceOf(Refused);
  });

  it('refuses a cart whose channel no longer resolves, rather than pricing it in the default', async () => {
    // Archived between being built and being read. The request itself would
    // be stopped earlier by the middleware's 404; this is the cart-side half.
    const { svc, configs } = setup();
    const cart = await inChannel(TRADE, () => svc.create(TENANT));
    delete configs[TRADE];

    await expect(inChannel(TRADE, () => svc.get(TENANT, cart.id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
