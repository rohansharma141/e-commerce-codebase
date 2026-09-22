import { NotFoundException } from '@nestjs/common';
import {
  CHANNEL_UNSERVABLE,
  unservableChannel,
  type PricingScope,
  type TenantConfig,
} from '@platform/modules/pricing/contracts';
import { TotalsService } from './totals.service';
import { UnservableChannelException } from './unservable-channel.exception';

/**
 * C-32a: the price list refuses a channel it cannot serve.
 *
 * `pricing.prices` holds one integer per product in the price list's currency.
 * Before this, `compute` never asked which channel it was pricing for, so a
 * cart in a EUR channel was charged the GBP integers — seen live on
 * 2026-09-19 as `channel = de | currency = GBP`.
 *
 * ── What each prints if the refusal did nothing ───────────────────────────
 *
 *   - the rule's "refuses" cases         — `null`, i.e. EUR declared servable
 *   - "refuses before reading a price"   — resolves, and a GBP total is
 *                                          returned for a EUR channel, which is
 *                                          the G-4 bug itself
 *   - "…without reading prices"          — the prices repository was consulted
 *                                          for a request that was always going
 *                                          to be refused
 *   - `assertServable` refusing EUR      — resolves, and a cart gets created in
 *                                          a channel nothing can be sold in
 *
 * Every refusal is paired with an allowed case on the same fixture, because a
 * rule that refuses everything passes a suite of refusals.
 */

const GBP_LIST: TenantConfig = {
  tenantId: 't-fashion',
  currency: 'GBP',
  taxRateBps: 875,
  locale: 'en-GB',
  updatedAt: '2026-09-22T00:00:00.000Z',
};

const UK: PricingScope = { key: 'uk', currencyCode: 'GBP' };
const DE: PricingScope = { key: 'de', currencyCode: 'EUR' };
const PRODUCT = '33333333-3333-4333-8333-333333333333';

describe('unservableChannel — the rule', () => {
  it('serves a channel whose currency is the price list currency', () => {
    expect(unservableChannel('GBP', UK)).toBeNull();
  });

  it('refuses one whose currency differs, saying which and why', () => {
    expect(unservableChannel('GBP', DE)).toEqual({
      code: CHANNEL_UNSERVABLE,
      channel: 'de',
      channelCurrency: 'EUR',
      priceListCurrency: 'GBP',
    });
  });

  it('compares codes, not spellings: case and padding do not make a currency different', () => {
    // pricing.tenant_config.currency is char(3); letter case is not a currency.
    expect(unservableChannel('gbp ', { key: 'uk', currencyCode: ' GBP' })).toBeNull();
    expect(unservableChannel('gbp', DE)).toMatchObject({ priceListCurrency: 'GBP' });
  });
});

describe('TotalsService — the money path', () => {
  function setup(config: TenantConfig | null = GBP_LIST) {
    const findByProductIds = jest.fn(
      async () => new Map([[PRODUCT, { tenantId: 't-fashion', productId: PRODUCT, unitPriceCents: 1000 }]]),
    );
    const listActiveCandidates = jest.fn(async () => []);
    const service = new TotalsService(
      { findOptional: async () => config } as never,
      { findByProductIds } as never,
      { listActiveCandidates } as never,
    );
    return { service, findByProductIds, listActiveCandidates };
  }

  const lines = [{ productId: PRODUCT, qty: 2 }];

  it('prices a servable channel in the price list currency', async () => {
    const { service } = setup();
    const totals = await service.compute({ tenantId: 't-fashion', scope: UK, lines });
    expect(totals.currency).toBe('GBP');
    expect(totals.subtotalCents).toBe(2000);
  });

  it('refuses an unservable channel with a 422 carrying the code and both currencies', async () => {
    const { service } = setup();
    const refusal = service.compute({ tenantId: 't-fashion', scope: DE, lines });

    await expect(refusal).rejects.toBeInstanceOf(UnservableChannelException);
    await expect(refusal).rejects.toMatchObject({
      status: 422,
      response: {
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'channel.unservable',
        channel: 'de',
        channelCurrency: 'EUR',
        priceListCurrency: 'GBP',
      },
    });
  });

  it('refuses before reading a single price or promotion', async () => {
    const { service, findByProductIds, listActiveCandidates } = setup();
    await expect(
      service.compute({ tenantId: 't-fashion', scope: DE, lines }),
    ).rejects.toBeInstanceOf(UnservableChannelException);
    expect(findByProductIds).not.toHaveBeenCalled();
    expect(listActiveCandidates).not.toHaveBeenCalled();
  });

  it('still answers a tenant with no price list with its own 404, not a channel refusal', async () => {
    const { service } = setup(null);
    await expect(
      service.compute({ tenantId: 't-new', scope: DE, lines }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TotalsService.assertServable — refusing before there is anything to price', () => {
  const service = (config: TenantConfig | null) =>
    new TotalsService({ findOptional: async () => config } as never, {} as never, {} as never);

  it('resolves for a servable channel', async () => {
    await expect(service(GBP_LIST).assertServable('t-fashion', UK)).resolves.toBeUndefined();
  });

  it('refuses an unservable one with the same exception compute throws', async () => {
    await expect(service(GBP_LIST).assertServable('t-fashion', DE)).rejects.toBeInstanceOf(
      UnservableChannelException,
    );
  });

  it('resolves for a tenant with no price list: there is no currency to contradict', async () => {
    await expect(service(null).assertServable('t-new', DE)).resolves.toBeUndefined();
  });
});
