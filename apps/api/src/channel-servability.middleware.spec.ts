import type { Request, Response } from 'express';
import { runWithTenant } from '@platform/shared/tenant-context';
import {
  NoDefaultChannelError,
  type ChannelConfig,
  type IChannelsQuery,
} from '@platform/modules/channels/contracts';
import {
  unservableChannel,
  type ITotalsService,
  type PricingScope,
} from '@platform/modules/pricing/contracts';
import { UnservableChannelException } from '@platform/modules/pricing/src';
import { ChannelServabilityMiddleware } from './channel-servability.middleware';

/**
 * C-32b: every storefront request in a channel the price list cannot serve is
 * refused; every correct request is let through.
 *
 * The totals service is a stand-in applying pricing's REAL rule and throwing
 * pricing's REAL exception to a GBP price list, so what is tested here is the
 * middleware's own job: choosing which channel to ask about, and passing the
 * cases that are not a known mismatch.
 *
 * ── What each prints if the middleware did nothing ────────────────────────
 *
 *   - "refuses a request in an unservable channel"  — next() is called, and a
 *                                                     `de` search answers with
 *                                                     GBP figures
 *   - "refuses an unscoped request when the default is unservable"
 *                                                   — the default is never
 *                                                     checked, so the rule
 *                                                     follows the key instead
 *                                                     of the currencies
 *   - "does not swallow any other failure"          — a database error while
 *                                                     finding the default is
 *                                                     waved through as "no
 *                                                     default"
 *
 * Refusals assert next() was NOT called: a middleware that threw after calling
 * next() would have served the request anyway.
 */

const TENANT = 't-fashion';
const UK = '11111111-1111-4111-8111-111111111111';
const DE = '22222222-2222-4222-8222-222222222222';
const TRADE = '44444444-4444-4444-8444-444444444444';

const config = (channelId: string, key: string, currencyCode: string, isDefault = false) =>
  ({ channelId, key, currencyCode, isDefault }) as ChannelConfig;

function setup(opts: { defaultChannel?: ChannelConfig | Error } = {}) {
  const byId: Record<string, ChannelConfig> = {
    [UK]: config(UK, 'uk', 'GBP', true),
    [DE]: config(DE, 'de', 'EUR'),
    [TRADE]: config(TRADE, 'trade', 'GBP'),
  };
  const defaultChannel = opts.defaultChannel ?? byId[UK];
  const channels: IChannelsQuery = {
    findById: async (_tenantId, channelId) => byId[channelId] ?? null,
    findDefault: async () => {
      if (defaultChannel instanceof Error) throw defaultChannel;
      return defaultChannel as ChannelConfig;
    },
    findByKey: async () => null,
    listActive: async () => [],
  };
  const assertServable = jest.fn(async (_tenantId: string, scope: PricingScope) => {
    const refusal = unservableChannel('GBP', scope);
    if (refusal) throw new UnservableChannelException(refusal);
  });
  const totals = { assertServable } as unknown as ITotalsService;
  const next = jest.fn();
  const middleware = new ChannelServabilityMiddleware(channels, totals);
  const run = (channelId?: string) =>
    runWithTenant({ tenantId: TENANT, requestId: 'r', channelId }, () =>
      middleware.use({} as Request, {} as Response, next),
    );
  return { run, next, assertServable };
}

describe('a request that names a channel', () => {
  it('lets a servable channel through, having asked about that channel', async () => {
    const { run, next, assertServable } = setup();
    await run(TRADE);
    expect(next).toHaveBeenCalledTimes(1);
    expect(assertServable).toHaveBeenCalledWith(TENANT, expect.objectContaining({ key: 'trade' }));
  });

  it('refuses an unservable channel with the 422, and never calls next', async () => {
    const { run, next } = setup();
    await expect(run(DE)).rejects.toMatchObject({
      status: 422,
      response: { code: 'channel.unservable', channel: 'de', channelCurrency: 'EUR' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes a named channel that stopped resolving on to the handler', async () => {
    const { run, next, assertServable } = setup();
    await run('99999999-9999-4999-8999-999999999999');
    expect(next).toHaveBeenCalledTimes(1);
    expect(assertServable).not.toHaveBeenCalled();
  });
});

describe('a request that names no channel', () => {
  it('lets it through when the tenant default is servable', async () => {
    const { run, next, assertServable } = setup();
    await run(undefined);
    expect(next).toHaveBeenCalledTimes(1);
    expect(assertServable).toHaveBeenCalledWith(TENANT, expect.objectContaining({ key: 'uk' }));
  });

  it('refuses it when the tenant default itself is unservable -- the rule follows currencies, not keys', async () => {
    const { run, next } = setup({ defaultChannel: config(UK, 'uk', 'EUR', true) });
    await expect(run(undefined)).rejects.toBeInstanceOf(UnservableChannelException);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets a tenant with no default channel through, as before channels existed', async () => {
    const { run, next, assertServable } = setup({ defaultChannel: new NoDefaultChannelError(TENANT) });
    await run(undefined);
    expect(next).toHaveBeenCalledTimes(1);
    expect(assertServable).not.toHaveBeenCalled();
  });

  it('does not swallow any other failure while finding the default', async () => {
    const boom = new Error('connection terminated');
    const { run, next } = setup({ defaultChannel: boom });
    await expect(run(undefined)).rejects.toBe(boom);
    expect(next).not.toHaveBeenCalled();
  });
});
